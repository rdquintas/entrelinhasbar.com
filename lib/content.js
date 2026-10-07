'use strict';
/**
 * Carrega os YAML de /content, valida-os (todos os erros de uma vez, com
 * ficheiro e chave) e oferece utilitários partilhados com scripts/clean-images.js.
 * NÃO importa o sharp: pode correr em ambientes sem binários de imagem.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { BuildError, imageName, isSafeUrl, parseYoutubeId } = require('./util');

const PAGES = ['index', 'agenda', 'mural', 'contactos'];
const TIPOS = ['concerto', 'workshop', 'outro'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'gif', 'avif', 'svg'];
const MAX_INDEX_IMAGES = 10;
const MAX_EVENT_LINKS = 5;

/** Textos de interface obrigatórios em site.yaml > ui (cada um com versões por idioma). */
const REQUIRED_UI = [
  'menu_principal', 'idioma', 'ir_conteudo', 'contactos', 'saber_mais', 'cancelado',
  'voltar_agenda', 'sem_eventos', 'galeria', 'video_titulo', 'destaques', 'slide',
  'ampliar', 'reproduzir', 'fechar', 'telefone', 'email', 'morada', 'horario', 'mapa',
  'ver_no_maps', 'faq', 'redes', 'pagina_nao_encontrada', 'voltar_inicio', 'mural_sem_js',
];

const rel = (file) => path.relative(process.cwd(), file).split(path.sep).join('/');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasText = (v) => typeof v === 'string' && v.trim() !== '';

/* ------------------------------------------------------------------ YAML */

/** Lê um YAML. Schema "core": datas e horas ficam como texto (sem conversões surpresa). */
function loadYamlFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new BuildError(`Ficheiro de conteúdo em falta: ${rel(file)}`);
  }
  try {
    const data = yaml.load(text, { schema: yaml.CORE_SCHEMA, filename: file });
    return data == null ? {} : data;
  } catch (e) {
    const pos = e.mark ? ` (linha ${e.mark.line + 1}, coluna ${e.mark.column + 1})` : '';
    throw new BuildError(
      `YAML inválido em ${rel(file)}${pos}: ${e.reason || e.message}\n` +
      '   Como corrigir: verificar indentação (só espaços), aspas e dois-pontos perto da linha indicada.',
    );
  }
}

/**
 * Carrega site.yaml e as 4 páginas base. Qualquer OUTRO content/<nome>.yaml é uma
 * "página extra" simples (título + hero) renderizada com src/templates/<nome>.html.
 */
function loadAll(contentDir) {
  const out = { site: loadYamlFile(path.join(contentDir, 'site.yaml')), extras: {} };
  for (const p of PAGES) out[p] = loadYamlFile(path.join(contentDir, `${p}.yaml`));
  const core = new Set(['site', ...PAGES]);
  for (const f of fs.readdirSync(contentDir).sort()) {
    const m = /^([a-z0-9][a-z0-9-]*)\.ya?ml$/.exec(f);
    if (m && !core.has(m[1])) out.extras[m[1]] = loadYamlFile(path.join(contentDir, f));
  }
  return out;
}

/* --------------------------------------------------------- imagens/textos */

/** Devolve o objeto de imagem se tiver ficheiro; null caso contrário (campo vazio do CMS). */
function cleanImage(v) {
  return isObj(v) && imageName(v.ficheiro) ? v : null;
}

/**
 * Percorre um objeto e chama cb(imagem, caminho) para cada { ficheiro: ... }.
 * Por defeito ignora tudo o que tenha `ativo: false` (conteúdo "apagado").
 */
function walkImages(node, p, cb, opts = {}) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => walkImages(n, `${p}[${i}]`, cb, opts));
    return;
  }
  if (!isObj(node)) return;
  if (!opts.includeInactive && node.ativo === false) return;
  if (imageName(node.ficheiro)) cb(node, p);
  for (const [k, v] of Object.entries(node)) {
    if (k !== 'alt') walkImages(v, p ? `${p}.${k}` : k, cb, opts);
  }
}

/** Conjunto dos nomes de ficheiro de imagem referenciados. */
function collectImageNames(node, opts = {}) {
  const set = new Set();
  walkImages(node, '', (img) => set.add(imageName(img.ficheiro)), opts);
  return set;
}

function isI18n(val, langCodes) {
  if (!isObj(val)) return false;
  const keys = Object.keys(val);
  return keys.length > 0 && keys.some((k) => langCodes.has(k));
}

/** Texto no idioma pedido; fallback para o idioma por defeito (com aviso) e depois qualquer outro. */
function resolveText(val, { lang, defaultLang, report, label }) {
  if (val == null) return '';
  if (typeof val !== 'object') return String(val);
  const pick = (k) => (val[k] != null && String(val[k]).trim() !== '' ? String(val[k]) : '');
  if (pick(lang)) return pick(lang);
  const fallback = pick(defaultLang) || Object.keys(val).map(pick).find(Boolean) || '';
  if (fallback && report) {
    report.warn(`Tradução em falta (${lang}) em ${label}: usado o texto de outro idioma.`);
  }
  return fallback;
}

/* ------------------------------------------------------------ validação */

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

/** Contexto de validação de um ficheiro. */
function makeChecker(file, report, env) {
  const c = {
    err: (key, msg, fix) => report.error(`${file} › ${key}`, msg, fix),
    warn: (key, msg) => report.warn(`${file} › ${key}: ${msg}`),
  };

  c.text = (val, key, { required = false } = {}) => {
    const empty = val == null || (typeof val === 'string' && !val.trim())
      || (isObj(val) && !Object.values(val).some((x) => hasText(String(x ?? ''))));
    if (empty) {
      if (required) c.err(key, 'Falta o texto (obrigatório).', `preencher a versão em "${env.defaultLang}" (idioma por defeito).`);
      return;
    }
    if (typeof val === 'string') return;
    if (!isObj(val)) {
      c.err(key, 'O texto deve ter uma versão por idioma (ex.: pt e en).', 'usar o formato "pt: ..." e "en: ...".');
      return;
    }
    for (const k of Object.keys(val)) {
      if (!env.langCodes.has(k)) c.warn(key, `idioma "${k}" não existe em site.yaml; será ignorado.`);
    }
    if (required && !hasText(String(val[env.defaultLang] ?? ''))) {
      c.err(key, `Falta a versão em "${env.defaultLang}" (idioma por defeito).`, `preencher "${env.defaultLang}".`);
    }
  };

  c.image = (val, key, { required = false, altWarn = true } = {}) => {
    if (!cleanImage(val)) {
      if (required) c.err(key, 'Falta a imagem (obrigatória).', 'escolher uma imagem (campo "ficheiro").');
      else if (val != null && !isObj(val)) c.err(key, 'Formato de imagem inválido.', 'usar { ficheiro: "nome.jpg", alt: { pt: "...", en: "..." } }.');
      return null;
    }
    const name = imageName(val.ficheiro);
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) {
      c.err(`${key}.ficheiro`, `Formato de imagem não suportado: "${name}".`, `usar um de: ${IMAGE_EXT.join(', ')}.`);
    } else if (!fs.existsSync(path.join(env.imagesDir, name))) {
      c.err(`${key}.ficheiro`, `A imagem "${name}" não existe em src/images/.`, 'carregar o ficheiro para src/images/ ou corrigir o nome (atenção a maiúsculas e extensão).');
    }
    if (altWarn) {
      const alt = val.alt;
      const has = typeof alt === 'string' ? hasText(alt) : isObj(alt) && Object.values(alt).some((x) => hasText(String(x ?? '')));
      if (!has) c.warn(key, `imagem "${name}" sem texto alternativo (alt); recomendado para acessibilidade.`);
    }
    return name;
  };

  c.url = (val, key, { required = false } = {}) => {
    if (val == null || (typeof val === 'string' && !val.trim())) {
      if (required) c.err(key, 'Falta o URL.', 'indicar um endereço que comece por https://');
      return;
    }
    if (!isSafeUrl(val)) c.err(key, `URL inválido: "${val}".`, 'deve começar por https://, http://, mailto: ou tel:.');
  };

  c.youtube = (val, key) => {
    if (val == null || (typeof val === 'string' && !val.trim())) return;
    if (!parseYoutubeId(val)) c.err(key, `Vídeo do YouTube inválido: "${val}".`, 'colar o endereço do vídeo (youtube.com/watch?v=... ou youtu.be/...) ou apenas o ID de 11 caracteres.');
  };

  c.hero = (hero, key) => {
    if (!isObj(hero)) {
      c.err(key, 'Falta o hero (imagem principal da página).', 'definir "horizontal" (obrigatória) e "vertical" (opcional).');
      return;
    }
    c.image(hero.horizontal, `${key}.horizontal`, { required: true });
    c.image(hero.vertical, `${key}.vertical`, { altWarn: false });
  };

  c.page = (data, key = '') => {
    const k = (s) => (key ? `${key}.${s}` : s);
    c.text(data.titulo, k('titulo'), { required: true });
    if (data.seo != null) c.text(data.seo.descricao, k('seo.descricao'));
    c.hero(data.hero, k('hero'));
  };

  return c;
}

function validateSite(site, report, env) {
  const file = 'content/site.yaml';
  const c = makeChecker(file, report, { ...env, langCodes: new Set(), defaultLang: '?' });

  if (!Array.isArray(site.idiomas) || !site.idiomas.length) {
    c.err('idiomas', 'Falta a lista de idiomas.', 'definir pelo menos um idioma: { codigo: pt, nome: Português, locale: pt-PT }.');
    return;
  }
  const codes = new Set();
  site.idiomas.forEach((l, i) => {
    if (!isObj(l) || !/^[a-z]{2,3}$/.test(l.codigo || '')) c.err(`idiomas[${i}].codigo`, 'Código de idioma inválido.', 'usar 2–3 letras minúsculas (ex.: pt, en).');
    else if (codes.has(l.codigo)) c.err(`idiomas[${i}].codigo`, `Idioma repetido: "${l.codigo}".`);
    else codes.add(l.codigo);
    if (isObj(l) && !hasText(l.nome)) c.err(`idiomas[${i}].nome`, 'Falta o nome do idioma (ex.: Português).');
    if (isObj(l) && !hasText(l.locale)) c.err(`idiomas[${i}].locale`, 'Falta o locale (ex.: pt-PT).');
  });
  if (!codes.has(site.idioma_padrao)) {
    c.err('idioma_padrao', `O idioma por defeito "${site.idioma_padrao}" não está na lista de idiomas.`, `usar um de: ${[...codes].join(', ')}.`);
    return;
  }
  const full = { ...env, langCodes: codes, defaultLang: site.idioma_padrao, langs: site.idiomas };
  const cc = makeChecker(file, report, full);

  cc.text(site.nome, 'nome', { required: true });
  if (site.url_base != null && site.url_base !== '' && !/^https?:\/\/[^/\s]+$/.test(String(site.url_base).replace(/\/+$/, ''))) {
    cc.err('url_base', `url_base inválido: "${site.url_base}".`, 'usar o endereço do site sem caminho (ex.: https://meusite.netlify.app).');
  }
  if (!site.url_base) report.warn(`${file} › url_base está vazio: canonical, sitemap e og:image ficam desativados.`);

  if (!Array.isArray(site.menu) || !site.menu.length) cc.err('menu', 'Falta o menu.', 'listar as páginas: index, agenda, mural, contactos.');
  else {
    site.menu.forEach((m, i) => {
      if (!isObj(m) || !env.pages.includes(m.pagina)) cc.err(`menu[${i}].pagina`, `Página desconhecida: "${m && m.pagina}".`, `usar uma de: ${env.pages.join(', ')}.`);
      cc.text(m && m.label, `menu[${i}].label`, { required: true });
    });
  }

  cc.image(site.logo, 'logo', { altWarn: true });
  cc.image(site.og_imagem, 'og_imagem', { altWarn: false });
  if (site.redes != null && !isObj(site.redes)) cc.err('redes', 'Formato inválido.', 'usar facebook / instagram / newsletter com um URL cada.');
  for (const r of ['facebook', 'instagram', 'newsletter']) cc.url(isObj(site.redes) ? site.redes[r] : null, `redes.${r}`);

  if (!isObj(site.ui)) cc.err('ui', 'Faltam os textos de interface (ui).');
  else {
    for (const k of REQUIRED_UI) cc.text(site.ui[k], `ui.${k}`, { required: true });
    for (const t of TIPOS) cc.text(site.ui.tipos && site.ui.tipos[t], `ui.tipos.${t}`, { required: true });
  }
  return full;
}

function validateEvent(c, ev, i) {
  const k = (s) => `eventos[${i}].${s}`;
  if (!isObj(ev)) {
    c.err(`eventos[${i}]`, 'Evento inválido.', 'cada evento deve ter campos (titulo, data, hora, ...).');
    return;
  }
  if (ev.ativo != null && typeof ev.ativo !== 'boolean') {
    c.err(k('ativo'), `Valor inválido: "${ev.ativo}".`, 'usar true ou false (sem aspas).');
    return;
  }
  if (ev.ativo === false) return; // evento "apagado": ignorado por completo

  for (const f of ['destaque', 'cancelado']) {
    if (ev[f] != null && typeof ev[f] !== 'boolean') c.err(k(f), `Valor inválido: "${ev[f]}".`, 'usar true ou false (sem aspas).');
  }
  c.text(ev.titulo, k('titulo'), { required: true });
  c.text(ev.descritivo, k('descritivo'), { required: true });
  c.text(ev.resumo, k('resumo'));
  if (!TIPOS.includes(ev.tipo)) c.err(k('tipo'), `Tipo inválido: "${ev.tipo}".`, `usar um de: ${TIPOS.join(', ')}.`);
  if (!validDate(ev.data)) c.err(k('data'), `Data inválida: "${ev.data ?? ''}".`, 'usar o formato AAAA-MM-DD (ex.: 2026-11-14).');
  if (!validTime(ev.hora)) c.err(k('hora'), `Hora inválida: "${ev.hora ?? ''}".`, 'usar o formato HH:MM de 24 horas (ex.: 21:30).');
  c.image(ev.imagem_horizontal, k('imagem_horizontal'), { required: true, altWarn: false });
  c.image(ev.imagem_vertical, k('imagem_vertical'), { altWarn: false });
  c.youtube(ev.youtube, k('youtube'));
  if (ev.slug != null && ev.slug !== '' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(ev.slug))) {
    c.err(k('slug'), `Slug inválido: "${ev.slug}".`, 'usar só minúsculas, números e hífens (ex.: tuba-ao-vivo), ou deixar vazio.');
  }
  if (ev.links != null) {
    if (!Array.isArray(ev.links)) c.err(k('links'), 'Os links devem ser uma lista.');
    else {
      const rows = ev.links.filter((l) => isObj(l) && (hasText(l.url) || Object.keys(l.nome || {}).length));
      if (rows.length > MAX_EVENT_LINKS) c.err(k('links'), `Há ${rows.length} links; o máximo é ${MAX_EVENT_LINKS}.`);
      ev.links.forEach((l, j) => {
        if (!isObj(l)) return;
        const named = isObj(l.nome) ? Object.values(l.nome).some((x) => hasText(String(x ?? ''))) : hasText(l.nome);
        if (!hasText(l.url) && !named) return; // linha vazia do CMS
        c.url(l.url, k(`links[${j}].url`), { required: true });
        c.text(l.nome, k(`links[${j}].nome`), { required: true });
      });
    }
  }
}

function validateMuralItem(c, item, i) {
  const k = (s) => `itens[${i}].${s}`;
  if (!isObj(item)) return c.err(`itens[${i}]`, 'Item inválido.');
  const hasImg = !!cleanImage(item.imagem);
  const hasYt = hasText(item.youtube);
  if (hasImg === hasYt) {
    return c.err(`itens[${i}]`, hasImg ? 'O item tem imagem E vídeo.' : 'O item não tem imagem nem vídeo.', 'preencher exatamente um: "imagem" ou "youtube".');
  }
  if (hasImg) c.image(item.imagem, k('imagem'));
  else c.youtube(item.youtube, k('youtube'));
  c.text(item.legenda, k('legenda'));
}

/** Valida todo o conteúdo; os erros ficam no `report`. Devolve { langs, defaultLang, langCodes }. */
function validateAll(raw, report, { imagesDir }) {
  const env0 = { imagesDir, pages: [...PAGES, ...Object.keys(raw.extras || {})] };
  const env = validateSite(raw.site, report, env0);
  if (!env) return null;

  const checkerFor = (page) => makeChecker(`content/${page}.yaml`, report, env);

  const idx = checkerFor('index');
  idx.page(raw.index);
  if (raw.index.imagens != null) {
    if (!Array.isArray(raw.index.imagens)) idx.err('imagens', 'Deve ser uma lista de imagens.');
    else {
      const imgs = raw.index.imagens.filter(cleanImage);
      if (imgs.length > MAX_INDEX_IMAGES) idx.err('imagens', `Há ${imgs.length} imagens; o máximo é ${MAX_INDEX_IMAGES}.`);
      raw.index.imagens.forEach((im, i) => idx.image(im, `imagens[${i}]`));
    }
  }
  idx.youtube(raw.index.video_youtube, 'video_youtube');

  const ag = checkerFor('agenda');
  ag.page(raw.agenda);
  if (raw.agenda.eventos != null && !Array.isArray(raw.agenda.eventos)) ag.err('eventos', 'Deve ser uma lista de eventos.');
  (Array.isArray(raw.agenda.eventos) ? raw.agenda.eventos : []).forEach((ev, i) => validateEvent(ag, ev, i));

  const mu = checkerFor('mural');
  mu.page(raw.mural);
  if (raw.mural.itens != null && !Array.isArray(raw.mural.itens)) mu.err('itens', 'Deve ser uma lista.');
  (Array.isArray(raw.mural.itens) ? raw.mural.itens : []).forEach((it, i) => validateMuralItem(mu, it, i));

  const co = checkerFor('contactos');
  co.page(raw.contactos);
  co.url(raw.contactos.link_google_maps, 'link_google_maps');
  co.text(raw.contactos.horario, 'horario');
  if (raw.contactos.faq != null && !Array.isArray(raw.contactos.faq)) co.err('faq', 'Deve ser uma lista de perguntas.');
  (Array.isArray(raw.contactos.faq) ? raw.contactos.faq : []).forEach((q, i) => {
    if (!isObj(q)) return;
    const filled = (v) => v != null && (typeof v === 'string' ? v.trim() : Object.values(v || {}).some((x) => hasText(String(x ?? ''))));
    if (!filled(q.pergunta) && !filled(q.resposta)) return; // linha vazia do CMS
    co.text(q.pergunta, `faq[${i}].pergunta`, { required: true });
    co.text(q.resposta, `faq[${i}].resposta`, { required: true });
  });

  for (const [name, data] of Object.entries(raw.extras || {})) checkerFor(name).page(data);

  return env;
}

module.exports = {
  PAGES, TIPOS, IMAGE_EXT, MAX_INDEX_IMAGES, MAX_EVENT_LINKS,
  loadYamlFile, loadAll, cleanImage, walkImages, collectImageNames,
  isI18n, resolveText, validateAll, validDate, validTime, isObj, hasText,
};
