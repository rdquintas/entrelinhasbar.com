'use strict';
/**
 * build.js — orquestrador. Lê content/*.yaml e src/templates, gera /dist.
 *   0. remove os eventos passados (entrada no agenda.yaml + imagens que só eles usavam)
 *   1. carrega e valida o conteúdo (falha com mensagens claras)
 *   2. prepara eventos e otimiza as imagens referenciadas
 *   3. copia CSS/JS (com hash no nome) e ficheiros estáticos
 *   4. renderiza cada página em cada idioma + uma página por evento
 *   5. gera _redirects, sitemap.xml, robots.txt e 404.html
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  Report, BuildError, escapeHtml, imageName, paragraphs, parseYoutubeId, parseVideo, formatBytes, truncate,
} = require('./lib/util');
const content = require('./lib/content');
const { prepareEvents, formatDate, formatDateShort } = require('./lib/events');
const { createImages, convertDirToAvif } = require('./lib/images');
const { createEngine } = require('./lib/template');
const { prunePastEvents } = require('./lib/past-events');

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
const MAX_SLIDES = 10;
const AGENDA_EXCERPT_MAX = 150;
/** Páginas do tema sem YAML próprio (src/templates/<nome>.html) e o respetivo título. */
const THEME_PAGES = {
  agenda: 'Calendário',
  venue: 'Venue',
  mural: 'Mural',
  contacts: 'Contact Us',
};
const NAV_PAGES = ['index', ...Object.keys(THEME_PAGES)];
/** Textos fixos da interface ({{ui.*}} nos templates); as etiquetas dos tipos de evento vêm de site.yaml › ui.tipos. */
const UI = {
  saber_mais: { pt: 'Saber mais', en: 'Learn more' },
  cancelado: { pt: 'CANCELADO', en: 'CANCELLED' },
  video_titulo: { pt: 'Vídeo', en: 'Video' },
  destaques: { pt: 'Eventos em destaque', en: 'Featured events' },
  slide: { pt: 'Ir para o destaque', en: 'Go to featured event' },
  ampliar: { pt: 'Ampliar imagem', en: 'Enlarge image' },
  reproduzir: { pt: 'Reproduzir vídeo', en: 'Play video' },
  fechar: { pt: 'Fechar', en: 'Close' },
  pagina_nao_encontrada: { pt: 'Página não encontrada', en: 'Page not found' },
  voltar_inicio: { pt: 'Voltar ao início', en: 'Back to home' },
};
const cleanImage = content.cleanImage;
/** JSON seguro para <script type="application/json"> (um "</script>" no conteúdo não fecha a tag). */
const safeJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

const write = (rel, data) => {
  const file = path.join(DIR.dist, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

/** Conteúdo concatenado dos ficheiros de texto (html/css/js) de uma pasta, recursivamente. */
function readTextTree(dir) {
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return readTextTree(p);
    return /\.(html|css|js)$/i.test(entry.name) ? fs.readFileSync(p, 'utf8') : '';
  }).join('\n');
}

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

  /* ---------- 0. Eventos passados ---------- */
  const pruned = prunePastEvents({
    contentDir: DIR.content, imagesDir: DIR.images, refDirs: [DIR.templates, path.join(ROOT, 'src/css')], report,
  });
  if (pruned.removed.length) {
    console.log(`Eventos passados removidos de content/agenda.yaml: ${pruned.removed.join(', ')}`);
    if (pruned.images.length) console.log(`Imagens removidas de src/images/: ${pruned.images.join(', ')}`);
  }

  /* ---------- 1. Conteúdo ---------- */
  const raw = content.loadAll(DIR.content);
  const env = content.validateAll(raw, report, { imagesDir: DIR.images });
  report.flush();

  const { langs, defaultLang, langCodes } = env;
  // Páginas extra não podem ter o nome de um idioma nem de uma pasta gerada (colidiriam na raiz).
  const reserved = new Set([...langCodes, ...NAV_PAGES, 'event', 'assets', 'images', 'css', 'js', 'fonts']);
  const clash = Object.keys(raw.extras).find((n) => reserved.has(n));
  if (clash) {
    throw new BuildError(`content/${clash}.yaml: o nome "${clash}" está reservado (idiomas, páginas do tema, assets, images, css, js, fonts). Mudar o nome do ficheiro.`);
  }
  const site = { ...raw.site, og_imagem: cleanImage(raw.site.og_imagem) };
  const siteUrl = String(raw.site.url_base || '').replace(/\/+$/, '');
  const abs = (p) => (siteUrl ? siteUrl + p : p);

  const events = prepareEvents(raw.agenda.eventos, { langs, defaultLang, ui: raw.site.ui, report });

  /* ---------- 2. Imagens ---------- */
  const extraNames = Object.keys(raw.extras);
  const dataOf = (key) => raw[key] || raw.extras[key];
  const allContent = [raw.site, ...content.PAGES.map((k) => raw[k]), ...Object.values(raw.extras)];
  const refs = new Set();
  allContent.forEach((d) => content.collectImageNames(d).forEach((n) => refs.add(n)));

  const ogNames = new Set();
  const siteOg = site.og_imagem || cleanImage(raw.index.hero && raw.index.hero.img_horizontal);
  if (siteOg) ogNames.add(imageName(siteOg.ficheiro));
  events.forEach((e) => ogNames.add(imageName(e.imagem_horizontal.ficheiro)));
  // Thumbs (495x378) da imagem horizontal, só para a listagem da página agenda.
  const thumbNames = new Set(events.map((e) => imageName(e.imagem_horizontal.ficheiro)));
  // Recorte 1400x500 da imagem horizontal, para o topo da página de cada evento.
  const bannerNames = thumbNames;

  const images = createImages({ srcDir: DIR.images, outDir: path.join(DIR.dist, 'images'), cacheDir: DIR.cache });
  await images.prepare(refs, ogNames, thumbNames, bannerNames);

  // Imagens fora dos YAML usadas diretamente pelos templates/CSS/JS do tema (ex.: "logo_v3.avif") são normais.
  const codeText = [DIR.templates, ...DIR.theme].map(readTextTree).join('\n');
  const orphans = fs.existsSync(DIR.images)
    ? fs.readdirSync(DIR.images).filter((f) => !f.startsWith('.') && !refs.has(f)
      && !codeText.includes(f.replace(/\.[^.]+$/, '') + '.'))
    : [];
  if (orphans.length) {
    report.warn(`${orphans.length} imagem(ns) em src/images/ não são usadas em nenhum YAML, template, CSS ou JS (podem ser apagadas):${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? ', …' : ''}`);
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
      const hp = e.pos[0] || 'hero.img_horizontal';
      const vp = e.pos.length ? e.pos[1] : 'hero.img_vertical';
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
    // Texto multilinha sem <p>: cada quebra de linha passa a <br> (ex.: morada dentro de um link).
    linhas(e, h) {
      return escapeHtml(h.text(h.get(e.pos[0]), e.pos[0]).trim()).replace(/\r?\n/g, '<br>');
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
      contactos: raw.contactos,
      ui: { ...UI, tipos: raw.site.ui.tipos },
      site_name: siteName,
      year: new Date().getFullYear(),
      css_href: cssHref,
      js_href: jsHref,
      masonry_href: masonryHref,
      home_url: pageUrl('index', lang),
      agenda_url: pageUrl('agenda', lang),
      mural_url: pageUrl('mural', lang),
      contactos_url: pageUrl('contactos', lang),
      // urls.event (links de demonstração do tema) aponta para a agenda: cada evento tem a sua página.
      urls: { ...Object.fromEntries(NAV_PAGES.map((k) => [k, pageUrl(k, lang)])), event: pageUrl('agenda', lang) },
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
        hero: {
          ...d.hero,
          img_horizontal: cleanImage(d.hero && d.hero.img_horizontal),
          img_vertical: cleanImage(d.hero && d.hero.img_vertical),
        },
      };
    };
    const seoOf = (key) => ({
      title: T(dataOf(key).titulo, `${key}.yaml › titulo`),
      description: T(dataOf(key).seo && dataOf(key).seo.descricao, `${key}.yaml › seo.descricao`),
    });

    const localized = events.map((e) => ({
      ...e,
      url: eventUrl(e.slug, lang),
      data_fmt: formatDate(e.data, L.locale),
      data_curta: formatDateShort(e.data, L.locale),
      thumb_src: `/images/${images.thumbFile(imageName(e.imagem_horizontal.ficheiro))}`,
      banner_src: `/images/${images.bannerFile(imageName(e.imagem_horizontal.ficheiro))}`,
      // Original em tamanho real (convertido para /images/<nome>.avif no passo 6).
      imagem_original_src: `/images/${imageName(e.imagem_horizontal.ficheiro)}`,
      descritivo_curto: truncate(T(e.descritivo, `evento "${e.slug}" › descritivo`), AGENDA_EXCERPT_MAX).replace(/…$/, '...'),
    }));

    const render = (tpl, ctx) => engine.render(tpl, ctx, { lang, defaultLang, langCodes });
    const emit = (relDir, tpl, ctx) => {
      write(path.posix.join(langDir(lang), relDir, 'index.html'), render(tpl, ctx));
      counts.pages++;
    };

    /* index */
    {
      const destaques = localized.filter((e) => e.destaque).slice(0, MAX_SLIDES);
      emit('', 'index', makeCtx({
        pageKey: 'index', pathFor: (l) => pageUrl('index', l), ...seoOf('index'),
        extra: {
          ...pageData('index'),
          equipa: (Array.isArray(raw.index.equipa) ? raw.index.equipa : []).filter(cleanImage),
          video: parseVideo(raw.index.linkvideo),
          destaques,
          destaques_multiplos: destaques.length > 1,
        },
      }));
    }

    /* mural: itens (imagens/YouTube) para o Masonry; a ordem é baralhada no browser */
    const mural = { hero: pageData('mural').hero, mural_items: [], mural_noscript: [] };
    (Array.isArray(raw.mural.itens) ? raw.mural.itens : []).forEach((it, i) => {
      const im = cleanImage(it.imagem);
      if (im) {
        const html = images.render(imageName(im.ficheiro), { alt: T(im.alt, `mural.yaml › itens[${i}].imagem.alt`), preset: 'mural' });
        mural.mural_items.push({ k: 'img', html });
        mural.mural_noscript.push({ html });
      } else if (parseYoutubeId(it.youtube)) {
        const id = parseYoutubeId(it.youtube);
        mural.mural_items.push({ k: 'yt', id });
        mural.mural_noscript.push({ html: `<a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">YouTube</a>` });
      }
    });
    mural.mural_json = safeJson(mural.mural_items);

    /* páginas do tema (sem YAML) */
    for (const [name, title] of Object.entries(THEME_PAGES)) {
      const extra = { agenda: { eventos: localized }, mural }[name] || {};
      emit(name, name, makeCtx({
        pageKey: name, pathFor: (l) => pageUrl(name, l), title, extra,
      }));
    }

    /* páginas extra (content/<nome>.yaml + src/templates/<nome>.html) */
    for (const name of extraNames) {
      emit(name, name, makeCtx({
        pageKey: name, pathFor: (l) => pageUrl(name, l), ...seoOf(name),
        extra: { ...pageData(name) },
      }));
    }

    /* uma página por evento, a partir de um único template */
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
      const ctx = makeCtx({ pageKey: null, pathFor: null, title: T(UI.pagina_nao_encontrada, 'ui.pagina_nao_encontrada'), noindex: true });
      write('404.html', render('404', ctx));
    }
  }

  /* ---------- 5. Ficheiros gerados ---------- */
  // Links antigos com o prefixo do idioma por defeito (/pt/...) passam para a raiz.
  // A antiga página /programming/ passou a /agenda/.
  const oldPages = langs.map((l) => `${langPrefix(l.codigo)}/programming/*  ${pageUrl('agenda', l.codigo)}  301\n`).join('');
  write('_redirects', `/${defaultLang}  /  301\n/${defaultLang}/*  /:splat  301\n${oldPages}`);

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
  console.log(`  Páginas: ${counts.pages} (${langs.length} idiomas) · eventos: ${events.length}`);
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
