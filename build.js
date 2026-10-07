'use strict';
/**
 * build.js — orquestrador. Lê content/*.yaml e src/templates, gera /dist.
 *   1. carrega e valida o conteúdo (falha com mensagens claras)
 *   2. prepara eventos e otimiza as imagens referenciadas
 *   3. copia CSS/JS (com hash no nome) e ficheiros estáticos
 *   4. renderiza cada página em cada idioma + uma página por evento ativo
 *   5. gera _redirects, sitemap.xml, robots.txt e 404.html
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  Report, BuildError, escapeHtml, imageName, paragraphs, parseYoutubeId, formatBytes,
} = require('./lib/util');
const content = require('./lib/content');
const { prepareEvents, formatDate } = require('./lib/events');
const { createImages, convertDirToAvif } = require('./lib/images');
const { createEngine } = require('./lib/template');

const ROOT = __dirname;
const DIR = {
  content: path.join(ROOT, 'content'),
  templates: path.join(ROOT, 'src/templates'),
  css: path.join(ROOT, 'src/css/style.css'),
  js: path.join(ROOT, 'src/js/main.js'),
  masonry: path.join(ROOT, 'node_modules/masonry-layout/dist/masonry.pkgd.min.js'),
  static: path.join(ROOT, 'src/static'),
  theme: ['css', 'js', 'fonts'].map((d) => path.join(ROOT, 'src', d)),
  images: path.join(ROOT, 'src/images'),
  dist: path.join(ROOT, 'dist'),
  cache: path.join(ROOT, '.cache/images'),
};
const MAX_SLIDES = 5;
/** Páginas do tema sem YAML próprio (src/templates/<nome>.html) e o respetivo título. */
const THEME_PAGES = {
  programming: 'Programming',
  event: 'Velvet Pulse + Guests',
  venue: 'Venue',
  aboutus: 'About Us',
  contacts: 'Contact Us',
};
const NAV_PAGES = ['index', ...Object.keys(THEME_PAGES)];
const cleanImage = content.cleanImage;

const write = (rel, data) => {
  const file = path.join(DIR.dist, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

/** Ficheiros de texto em /dist onde se procuram referências a imagens. */
const TEXT_EXT = new Set(['.html', '.css', '.js', '.json', '.xml', '.webmanifest', '.svg']);
function* textFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* textFiles(f);
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) yield f;
  }
}

/** Troca, em todo o /dist, "images/foto.jpg" por "images/foto.avif" (renames: Map original -> avif). */
function rewriteImageRefs(renames) {
  if (!renames.size) return;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = [...renames.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
  const re = new RegExp(`(images/)(${names})(?![\\w.-])`, 'g');
  for (const f of textFiles(DIR.dist)) {
    const before = fs.readFileSync(f, 'utf8');
    const after = before.replace(re, (_, pre, name) => pre + renames.get(name));
    if (after !== before) fs.writeFileSync(f, after);
  }
}

/** Lista referências a imagens de /images/ que não sejam AVIF (devia ficar vazia). */
function findNonAvifRefs() {
  const re = /images\/[\w.%-]+?\.(?:jpe?g|png|gif|webp|svg|tiff?)(?![\w.-])/gi;
  const found = new Set();
  for (const f of textFiles(DIR.dist)) {
    for (const m of fs.readFileSync(f, 'utf8').match(re) || []) found.add(`${path.relative(DIR.dist, f)}: ${m}`);
  }
  return [...found];
}

/** Copia para /dist/assets com hash do conteúdo no nome (cache longa e segura). */
function hashedAsset(file, base, ext) {
  let buf;
  try { buf = fs.readFileSync(file); } catch {
    throw new BuildError(`Ficheiro em falta: ${path.relative(ROOT, file)}${base === 'masonry' ? ' (correr "npm install")' : ''}`);
  }
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  const name = `${base}.${hash}.${ext}`;
  write(`assets/${name}`, buf);
  return `/assets/${name}`;
}

async function main() {
  const t0 = Date.now();
  const report = new Report();
  fs.rmSync(DIR.dist, { recursive: true, force: true });
  fs.mkdirSync(DIR.dist, { recursive: true });

  /* ---------- 1. Conteúdo ---------- */
  const raw = content.loadAll(DIR.content);
  const env = content.validateAll(raw, report, { imagesDir: DIR.images });
  report.flush();

  const { langs, defaultLang, langCodes } = env;
  // Páginas extra não podem ter o nome de um idioma nem de uma pasta gerada (colidiriam na raiz).
  const reserved = new Set([...langCodes, ...NAV_PAGES, 'assets', 'images', 'css', 'js', 'fonts']);
  const clash = Object.keys(raw.extras).find((n) => reserved.has(n));
  if (clash) {
    throw new BuildError(`content/${clash}.yaml: o nome "${clash}" está reservado (idiomas, páginas do tema, assets, images, css, js, fonts). Mudar o nome do ficheiro.`);
  }
  const site = { ...raw.site, logo: cleanImage(raw.site.logo), og_imagem: cleanImage(raw.site.og_imagem) };
  const siteUrl = String(raw.site.url_base || '').replace(/\/+$/, '');
  const abs = (p) => (siteUrl ? siteUrl + p : p);

  const events = prepareEvents(raw.agenda.eventos, { langs, defaultLang, ui: raw.site.ui, report });

  /* ---------- 2. Imagens ---------- */
  const extraNames = Object.keys(raw.extras);
  const dataOf = (key) => raw[key] || raw.extras[key];
  const allContent = [raw.site, ...content.PAGES.map((k) => raw[k]), ...Object.values(raw.extras)];
  const refs = new Set();
  allContent.forEach((d) => content.collectImageNames(d).forEach((n) => refs.add(n)));
  const allRefs = new Set();
  allContent.forEach((d) => content.collectImageNames(d, { includeInactive: true }).forEach((n) => allRefs.add(n)));

  const ogNames = new Set();
  const siteOg = site.og_imagem || cleanImage(raw.index.hero && raw.index.hero.horizontal);
  if (siteOg) ogNames.add(imageName(siteOg.ficheiro));
  events.forEach((e) => ogNames.add(imageName(e.imagem_horizontal.ficheiro)));

  const images = createImages({ srcDir: DIR.images, outDir: path.join(DIR.dist, 'images'), cacheDir: DIR.cache });
  await images.prepare(refs, ogNames);

  const orphans = fs.existsSync(DIR.images)
    ? fs.readdirSync(DIR.images).filter((f) => !f.startsWith('.') && !allRefs.has(f))
    : [];
  if (orphans.length) {
    report.warn(`${orphans.length} imagem(ns) em src/images/ não estão referenciadas em nenhum YAML (convertidas para AVIF no tamanho original, sem versões responsivas):${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? ', …' : ''}`);
  }

  /* ---------- 3. Assets ---------- */
  const cssHref = hashedAsset(DIR.css, 'style', 'css');
  const jsHref = hashedAsset(DIR.js, 'main', 'js');
  const masonryHref = hashedAsset(DIR.masonry, 'masonry', 'js');
  copyDir(DIR.static, DIR.dist);
  // CSS/JS/fontes/imagens do tema, referenciados diretamente pelos templates (/css/…, /js/…, /images/…)
  DIR.theme.forEach((d) => copyDir(d, path.join(DIR.dist, path.basename(d))));
  // Imagens usadas diretamente pelos templates/CSS: convertidas para /images/<nome>.avif
  const avifRenames = await convertDirToAvif({ srcDir: DIR.images, outDir: path.join(DIR.dist, 'images'), cacheDir: DIR.cache });

  /* ---------- 4. Templates ---------- */
  const imgOf = (v) => (cleanImage(v) ? imageName(v.ficheiro) : null);
  const helpers = {
    img(e, h) {
      const v = h.get(e.pos[0]);
      const name = imgOf(v);
      if (!name) return '';
      return images.render(name, {
        alt: h.text(v.alt, `${e.pos[0]}.alt`),
        preset: e.opts.preset || 'card',
        eager: e.opts.eager === 'true',
        cls: e.opts.class || '',
      });
    },
    hero(e, h) {
      const hp = e.pos[0] || 'hero.horizontal';
      const vp = e.pos.length ? e.pos[1] : 'hero.vertical';
      const hv = h.get(hp);
      const hn = imgOf(hv);
      if (!hn) throw h.fail(`imagem "${hp}" em falta para o hero.`);
      const vn = vp ? imgOf(h.get(vp)) : null;
      return images.renderHero(hn, vn, {
        alt: h.text(hv.alt, `${hp}.alt`),
        eager: e.opts.eager !== 'false',
        cls: e.opts.class || 'hero',
        preset: e.opts.preset || 'hero',
      });
    },
    para(e, h) {
      return paragraphs(h.text(h.get(e.pos[0]), e.pos[0]));
    },
  };
  const engine = createEngine({ templatesDir: DIR.templates, helpers, report });

  // O idioma por defeito vive na raiz (/agenda/); os restantes têm prefixo (/en/agenda/).
  const langDir = (l) => (l === defaultLang ? '' : l);
  const langPrefix = (l) => (langDir(l) ? `/${l}` : '');
  const pageUrl = (key, l) => (key === 'index' ? `${langPrefix(l)}/` : `${langPrefix(l)}/${key}/`);
  const eventUrl = (slug, l) => `${langPrefix(l)}/event/${slug}/`;
  const sitemap = []; // [{ paths: {pt, en} }]
  const counts = { pages: 0, events: 0 };

  const ogFor = (name) => {
    const f = name && images.ogFile(name);
    return f && siteUrl ? `${siteUrl}/images/${f}` : '';
  };

  for (const L of langs) {
    const lang = L.codigo;
    const T = (val, label) => content.resolveText(val, { lang, defaultLang, report, label });
    const siteName = T(raw.site.nome, 'site.yaml › nome');

    /** Contexto comum a todas as páginas deste idioma. */
    const makeCtx = ({ pageKey, pathFor, title, description, ogName, noindex = false, extra = {} }) => ({
      lang,
      locale: L.locale,
      locale_og: L.locale.replace('-', '_'),
      site,
      ui: raw.site.ui,
      site_name: siteName,
      year: new Date().getFullYear(),
      css_href: cssHref,
      js_href: jsHref,
      masonry_href: masonryHref,
      home_url: pageUrl('index', lang),
      agenda_url: pageUrl('agenda', lang),
      mural_url: pageUrl('mural', lang),
      contactos_url: pageUrl('contactos', lang),
      menu: raw.site.menu.map((m) => ({ label: m.label, url: pageUrl(m.pagina, lang), current: m.pagina === pageKey })),
      urls: Object.fromEntries(NAV_PAGES.map((k) => [k, pageUrl(k, lang)])),
      nav: pageKey ? { [pageKey]: true } : {},
      alternates: pathFor ? langs.map((l) => ({
        codigo: l.codigo, nome: l.nome, href: pathFor(l.codigo), abs_href: abs(pathFor(l.codigo)), current: l.codigo === lang,
      })) : [],
      x_default: pathFor ? abs(pathFor(defaultLang)) : '',
      canonical: pathFor && siteUrl ? abs(pathFor(lang)) : '',
      seo_title: title && title !== siteName ? `${title} — ${siteName}` : siteName,
      seo_description: description || '',
      og_image: ogFor(ogName || (siteOg && imageName(siteOg.ficheiro))),
      noindex,
      ...extra,
    });

    const pageData = (key) => {
      const d = dataOf(key);
      return {
        ...d,
        hero: { horizontal: cleanImage(d.hero && d.hero.horizontal), vertical: cleanImage(d.hero && d.hero.vertical) },
      };
    };
    const seoOf = (key) => ({
      title: T(dataOf(key).titulo, `${key}.yaml › titulo`),
      description: T(dataOf(key).seo && dataOf(key).seo.descricao, `${key}.yaml › seo.descricao`),
    });

    const localized = events.map((e) => ({ ...e, url: eventUrl(e.slug, lang), data_fmt: formatDate(e.data, L.locale) }));

    const render = (tpl, ctx) => engine.render(tpl, ctx, { lang, defaultLang, langCodes });
    const emit = (relDir, tpl, ctx) => {
      write(path.posix.join(langDir(lang), relDir, 'index.html'), render(tpl, ctx));
      counts.pages++;
    };

    /* index */
    {
      const destaques = localized.filter((e) => e.destaque).slice(0, MAX_SLIDES);
      const ytId = parseYoutubeId(raw.index.video_youtube);
      emit('', 'index', makeCtx({
        pageKey: 'index', pathFor: (l) => pageUrl('index', l), ...seoOf('index'),
        extra: {
          ...pageData('index'),
          imagens: (Array.isArray(raw.index.imagens) ? raw.index.imagens : []).filter(cleanImage),
          video_embed: ytId ? `https://www.youtube-nocookie.com/embed/${ytId}` : '',
          destaques,
          destaques_multiplos: destaques.length > 1,
        },
      }));
    }

    /* páginas do tema (sem YAML) */
    for (const [name, title] of Object.entries(THEME_PAGES)) {
      emit(name, name, makeCtx({ pageKey: name, pathFor: (l) => pageUrl(name, l), title }));
    }

    /* páginas extra (content/<nome>.yaml + src/templates/<nome>.html) */
    for (const name of extraNames) {
      emit(name, name, makeCtx({
        pageKey: name, pathFor: (l) => pageUrl(name, l), ...seoOf(name),
        extra: { ...pageData(name) },
      }));
    }

    /* uma página por evento ativo, a partir de um único template */
    for (const e of localized) {
      const title = T(e.titulo, `evento "${e.slug}" › titulo`);
      const ctx = makeCtx({
        pageKey: 'event', pathFor: (l) => eventUrl(e.slug, l), title,
        description: T(e.resumo, `evento "${e.slug}" › resumo`),
        ogName: imageName(e.imagem_horizontal.ficheiro),
        extra: { ...e },
      });
      emit(path.posix.join('event', e.slug), 'event', ctx);
      counts.events++;
    }

    /* 404 (só no idioma por defeito, na raiz) */
    if (lang === defaultLang) {
      const ctx = makeCtx({ pageKey: null, pathFor: null, title: T(raw.site.ui.pagina_nao_encontrada, 'ui.pagina_nao_encontrada'), noindex: true });
      write('404.html', render('404', ctx));
    }
  }

  /* ---------- 5. Ficheiros gerados ---------- */
  // Links antigos com o prefixo do idioma por defeito (/pt/...) passam para a raiz.
  write('_redirects', `/${defaultLang}  /  301\n/${defaultLang}/*  /:splat  301\n`);

  if (siteUrl) {
    const urls = [];
    const add = (pathFor) => urls.push(pathFor);
    for (const key of [...NAV_PAGES, ...extraNames]) add((l) => pageUrl(key, l));
    for (const e of events) add((l) => eventUrl(e.slug, l));
    const xml = urls.flatMap((pathFor) => langs.map((l) => {
      const alts = langs.map((x) => `    <xhtml:link rel="alternate" hreflang="${x.codigo}" href="${escapeHtml(abs(pathFor(x.codigo)))}"/>`).join('\n');
      return `  <url>\n    <loc>${escapeHtml(abs(pathFor(l.codigo)))}</loc>\n${alts}\n    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(abs(pathFor(defaultLang)))}"/>\n  </url>`;
    })).join('\n');
    write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${xml}\n</urlset>\n`);
  }
  write('robots.txt', `User-agent: *\nAllow: /\n${siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''}`);

  /* ---------- 6. Referências a imagens -> AVIF ---------- */
  rewriteImageRefs(avifRenames);
  const nonAvif = findNonAvifRefs();
  if (nonAvif.length) {
    report.warn(`${nonAvif.length} referência(s) a imagens que não são AVIF em /dist (ficheiro inexistente em src/images/?): ${nonAvif.slice(0, 8).join(', ')}${nonAvif.length > 8 ? ', …' : ''}`);
  }

  /* ---------- Resumo ---------- */
  report.flush(); // imprime avisos acumulados durante a renderização
  const s = images.summary();
  const saved = s.before ? Math.round((1 - s.after / s.before) * 100) : 0;
  console.log('\n✔ Build concluído');
  console.log(`  Páginas: ${counts.pages} (${langs.length} idiomas) · eventos ativos: ${events.length}`);
  if (events.length) console.log(`  URLs dos eventos: ${events.map((e) => e.slug).join(', ')}`);
  console.log(`  Imagens: ${s.processed} processadas, ${s.cached} vindas da cache`);
  console.log(`  Tamanho: ${formatBytes(s.before)} (originais) → ${formatBytes(s.after)} (maior versão AVIF de cada) · poupança ${saved}%`);
  console.log(`  Tempo: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  if (e instanceof BuildError) console.error(e.message);
  else console.error(e);
  process.exit(1);
});
