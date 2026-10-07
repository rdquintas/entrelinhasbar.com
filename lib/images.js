'use strict';
/**
 * Otimização de imagens com sharp: tudo é convertido para AVIF (responsivo para as imagens
 * dos YAML, tamanho original para as restantes de src/images), EXIF aplicado, metadados
 * removidos, cache por hash de conteúdo e geração do HTML (<img>/<picture>).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { BuildError, escapeHtml, formatBytes, slugify } = require('./util');

/* =====================  CONFIGURAÇÃO — altera aqui  ===================== */
const CONFIG = {
  // Formatos de entrada aceites (SVG é rasterizado; de um GIF animado fica só o 1.º frame).
  acceptedFormats: ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'gif', 'avif', 'svg'],
  // Larguras geradas (nunca se amplia: se o original for menor, gera só até à sua largura).
  widths: [480, 960, 1600],
  avifQuality: 50, // 1–100 (≈50 é um bom equilíbrio)
  avifEffort: 4, // 0–9 (mais alto = ficheiros menores, build mais lento)
  // Fallback WebP para browsers sem AVIF. false = servir só AVIF.
  webpFallback: false,
  webpQuality: 75,
  // Falha o build se o original for maior do que isto.
  maxFileBytes: 15 * 1024 * 1024,
  limitInputPixels: 100_000_000, // proteção contra imagens gigantes/maliciosas
  concurrency: 2, // imagens processadas em paralelo (memória do Netlify é limitada)
  heroBreakpoint: 768, // px: abaixo disto usa-se a imagem vertical do hero
  // Imagem de partilha social (og:image), também em AVIF.
  // Nota: algumas redes (Facebook, WhatsApp, LinkedIn) ainda não mostram pré-visualizações AVIF.
  og: { width: 1200, height: 630, quality: 60 },
  // SVG dos YAML: densidade (dpi) para rasterizar (144 = 2x, nítido em ecrãs retina).
  svgDensity: 144,
};
const CACHE_VERSION = 'v2'; // mudar para invalidar toda a cache

/** Atributo `sizes` por contexto de utilização. */
const PRESETS = {
  hero: '100vw',
  slide: '100vw',
  card: '(min-width: 900px) 33vw, (min-width: 600px) 50vw, 100vw',
  galeria: '(min-width: 900px) 20vw, (min-width: 600px) 33vw, 50vw',
  mural: '(min-width: 1100px) 25vw, (min-width: 800px) 33vw, 50vw',
};
/* ======================================================================= */

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const SETTINGS_HASH = sha(JSON.stringify([CACHE_VERSION, CONFIG.widths, CONFIG.avifQuality, CONFIG.avifEffort,
  CONFIG.webpFallback, CONFIG.webpQuality, CONFIG.og, CONFIG.svgDensity, CONFIG.limitInputPixels])).slice(0, 12);

function computeWidths(origWidth) {
  const max = Math.max(...CONFIG.widths);
  const top = Math.min(origWidth, max);
  const list = CONFIG.widths.filter((w) => w < top);
  list.push(top);
  return [...new Set(list)].sort((a, b) => a - b);
}

async function pool(items, n, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function createImages({ srcDir, outDir, cacheDir }) {
  const infos = new Map();
  const stats = { processed: 0, cached: 0, before: 0, after: 0 };
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const toCache = (name, buf) => fs.writeFileSync(path.join(cacheDir, name), buf);
  const publish = (name) => fs.copyFileSync(path.join(cacheDir, name), path.join(outDir, name));

  async function makeOg(buf, ogName) {
    const out = await sharp(buf, { failOn: 'error', limitInputPixels: CONFIG.limitInputPixels })
      .rotate()
      .resize(CONFIG.og.width, CONFIG.og.height, { fit: 'cover' })
      .avif({ quality: CONFIG.og.quality, effort: CONFIG.avifEffort })
      .toBuffer();
    toCache(ogName, out);
  }

  async function processOne(name, needOg) {
    const file = path.join(srcDir, name);
    let stat;
    try { stat = fs.statSync(file); } catch {
      throw new BuildError(`Imagem "${name}" não existe em src/images/.`);
    }
    if (stat.size > CONFIG.maxFileBytes) {
      throw new BuildError(`Imagem "${name}" tem ${formatBytes(stat.size)} e o limite é ${formatBytes(CONFIG.maxFileBytes)}. Reduzir o tamanho antes de a carregar (ex.: lado maior até 2400 px).`);
    }
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!CONFIG.acceptedFormats.includes(ext)) {
      throw new BuildError(`Imagem "${name}": formato .${ext} não suportado (aceites: ${CONFIG.acceptedFormats.join(', ')}).`);
    }
    const buf = fs.readFileSync(file);
    const key = sha(Buffer.concat([buf, Buffer.from(SETTINGS_HASH)])).slice(0, 8);
    const stem = slugify(path.basename(name, path.extname(name))) || 'img';
    const manifestName = `${stem}-${key}.json`;
    const manifestPath = path.join(cacheDir, manifestName);
    stats.before += stat.size;

    // 1) Cache
    if (fs.existsSync(manifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const files = m.variants.flatMap((v) => [v.avif, v.webp].filter(Boolean));
        if (needOg && !m.og) {
          m.og = `${stem}-${key}-og.avif`;
          await makeOg(buf, m.og);
          fs.writeFileSync(manifestPath, JSON.stringify(m));
        }
        if (m.og) files.push(m.og);
        if (files.every((f) => fs.existsSync(path.join(cacheDir, f)))) {
          files.forEach(publish);
          stats.cached++;
          stats.after += m.variants[m.variants.length - 1].avifBytes;
          infos.set(name, m);
          return;
        }
      } catch { /* cache corrompida: reprocessa */ }
    }

    // 2) Leitura (SVG é rasterizado com densidade extra para ficar nítido)
    const isSvg = ext === 'svg';
    const sharpOpts = { failOn: 'error', limitInputPixels: CONFIG.limitInputPixels, ...(isSvg && { density: CONFIG.svgDensity }) };
    let meta;
    try {
      meta = await sharp(buf, sharpOpts).metadata();
    } catch (e) {
      throw new BuildError(`Imagem corrompida ou ilegível: "${name}" (${e.message}).`);
    }

    // 3) -> AVIF (+ WebP)
    if (!meta.width || !meta.height) throw new BuildError(`Imagem sem dimensões legíveis: "${name}".`);
    const origW = meta.orientation >= 5 ? meta.height : meta.width;
    const variants = [];
    const open = () => sharp(buf, sharpOpts).rotate();
    try {
      for (const w of computeWidths(origW)) {
        const resized = open().resize({ width: w, withoutEnlargement: true });
        const avif = await resized.clone().avif({ quality: CONFIG.avifQuality, effort: CONFIG.avifEffort })
          .toBuffer({ resolveWithObject: true });
        const v = { w: avif.info.width, h: avif.info.height, avif: `${stem}-${key}-${w}.avif`, avifBytes: avif.data.length };
        toCache(v.avif, avif.data);
        if (CONFIG.webpFallback) {
          v.webp = `${stem}-${key}-${w}.webp`;
          toCache(v.webp, await resized.clone().webp({ quality: CONFIG.webpQuality }).toBuffer());
        }
        variants.push(v);
      }
      const m = { kind: 'raster', variants };
      // SVG: o <img> mantém as dimensões intrínsecas (o AVIF tem mais píxeis por causa da densidade)
      if (isSvg) {
        const scale = 72 / CONFIG.svgDensity;
        m.display = { w: Math.round(meta.width * scale), h: Math.round(meta.height * scale) };
      }
      if (needOg) { m.og = `${stem}-${key}-og.avif`; await makeOg(buf, m.og); }
      fs.writeFileSync(manifestPath, JSON.stringify(m));
      [...variants.flatMap((v) => [v.avif, v.webp].filter(Boolean)), ...(m.og ? [m.og] : [])].forEach(publish);
      stats.processed++;
      stats.after += variants[variants.length - 1].avifBytes;
      infos.set(name, m);
    } catch (e) {
      if (e instanceof BuildError) throw e;
      throw new BuildError(`Não foi possível processar a imagem "${name}": ${e.message}`);
    }
  }

  /** Processa todas as imagens referenciadas. Junta os erros para os mostrar de uma vez. */
  async function prepare(names, ogNames = new Set()) {
    const errors = [];
    await pool([...names].sort(), CONFIG.concurrency, async (name) => {
      try { await processOne(name, ogNames.has(name)); } catch (e) { errors.push(e.message); }
    });
    if (errors.length) throw new BuildError(errors.map((m) => `✖  IMAGEM  ${m}`).join('\n'));
  }

  const info = (name) => {
    const i = infos.get(name);
    if (!i) throw new BuildError(`Imagem "${name}" não foi preparada (erro interno).`);
    return i;
  };

  /* ------------------------------ HTML ------------------------------ */
  const srcset = (i, kind) => i.variants.map((v) => `/images/${v[kind]} ${v.w}w`).join(', ');
  const defaultSrc = (i, kind) => `/images/${(i.variants.find((v) => v.w >= 960) || i.variants[i.variants.length - 1])[kind]}`;
  const largest = (i) => i.variants[i.variants.length - 1];
  const useWebp = (i) => CONFIG.webpFallback && i.variants.every((v) => v.webp);

  function imgTag(i, { alt, sizes, eager, priority = false, cls }) {
    const c = cls ? ` class="${escapeHtml(cls)}"` : '';
    // Só o hero (LCP) leva fetchpriority="high"; outras imagens "eager" (ex.: logo) apenas não são lazy.
    const load = eager ? `loading="eager"${priority ? ' fetchpriority="high"' : ''}` : 'loading="lazy"';
    const b = i.display || largest(i);
    const kind = useWebp(i) ? 'webp' : 'avif';
    return `<img${c} src="${defaultSrc(i, kind)}" srcset="${srcset(i, kind)}" sizes="${sizes}" alt="${escapeHtml(alt)}" width="${b.w}" height="${b.h}" ${load} decoding="async">`;
  }

  /** Imagem normal: <picture> com AVIF + fallback WebP (ou só <img> AVIF se o fallback estiver desligado). */
  function render(name, { alt = '', preset = 'card', eager = false, cls = '' } = {}) {
    const i = info(name);
    const sizes = PRESETS[preset] || PRESETS.card;
    const tag = imgTag(i, { alt, sizes, eager, cls });
    if (!useWebp(i)) return tag;
    return `<picture><source type="image/avif" srcset="${srcset(i, 'avif')}" sizes="${sizes}">${tag}</picture>`;
  }

  /** Hero com direção de arte: imagem vertical em mobile, horizontal no resto. */
  function renderHero(hName, vName, { alt = '', eager = true, cls = 'hero', preset = 'hero' } = {}) {
    const h = info(hName);
    const v = vName ? info(vName) : null;
    const sizes = PRESETS[preset] || PRESETS.hero;
    const imgCls = `${cls}__img`;

    const media = `(max-width: ${CONFIG.heroBreakpoint}px)`;
    const sources = [];
    if (v) {
      sources.push(`<source media="${media}" type="image/avif" srcset="${srcset(v, 'avif')}" sizes="${sizes}">`);
      if (useWebp(v)) sources.push(`<source media="${media}" type="image/webp" srcset="${srcset(v, 'webp')}" sizes="${sizes}">`);
    }
    if (useWebp(h) || sources.length) sources.push(`<source type="image/avif" srcset="${srcset(h, 'avif')}" sizes="${sizes}">`);
    const tag = imgTag(h, { alt, sizes, eager, priority: eager, cls: imgCls });
    const inner = sources.length ? `<picture>${sources.join('')}${tag}</picture>` : tag;
    return `<div class="${escapeHtml(cls)}">${inner}</div>`;
  }

  const ogFile = (name) => (infos.get(name) && infos.get(name).og) || null;
  const summary = () => ({ ...stats });

  return { prepare, info, render, renderHero, ogFile, summary, CONFIG };
}

/**
 * Converte cada imagem de srcDir para AVIF no tamanho original (<nome>.avif) em outDir.
 * São as imagens usadas diretamente pelos templates/CSS (/images/…). Ficheiros .avif são
 * copiados tal como estão. Devolve um Map nome original -> nome AVIF.
 */
async function convertDirToAvif({ srcDir, outDir, cacheDir }) {
  const renames = new Map();
  if (!fs.existsSync(srcDir)) return renames;
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const files = fs.readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((n) => CONFIG.acceptedFormats.includes(path.extname(n).slice(1).toLowerCase()));

  // Dois originais não podem dar o mesmo .avif (ex.: foto.jpg e foto.png)
  const avifName = (n) => `${path.basename(n, path.extname(n))}.avif`;
  const owners = new Map();
  for (const name of files) {
    const out = avifName(name);
    if (owners.has(out)) {
      throw new BuildError(`src/images/: "${owners.get(out)}" e "${name}" dariam ambos "${out}". Mudar o nome de um deles.`);
    }
    owners.set(out, name);
  }

  const errors = [];
  await pool(files, CONFIG.concurrency, async (name) => {
    const outName = avifName(name);
    const outFile = path.join(outDir, outName);
    const buf = fs.readFileSync(path.join(srcDir, name));
    if (path.extname(name).toLowerCase() === '.avif') {
      fs.writeFileSync(outFile, buf);
      return;
    }
    const cached = path.join(cacheDir, `full-${sha(Buffer.concat([buf, Buffer.from(SETTINGS_HASH)])).slice(0, 16)}.avif`);
    try {
      if (!fs.existsSync(cached)) {
        const out = await sharp(buf, { failOn: 'error', limitInputPixels: CONFIG.limitInputPixels })
          .rotate()
          .avif({ quality: CONFIG.avifQuality, effort: CONFIG.avifEffort })
          .toBuffer();
        fs.writeFileSync(cached, out);
      }
      fs.copyFileSync(cached, outFile);
      renames.set(name, outName);
    } catch (e) {
      errors.push(`✖  IMAGEM  Não foi possível converter "${name}" para AVIF: ${e.message}`);
    }
  });
  if (errors.length) throw new BuildError(errors.join('\n'));
  return renames;
}

module.exports = { createImages, convertDirToAvif, CONFIG, PRESETS };
