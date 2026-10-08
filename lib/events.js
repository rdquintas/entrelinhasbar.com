'use strict';
/**
 * Prepara os eventos: gera slugs, ordena por data/hora e
 * calcula os campos derivados (resumo, etiqueta do tipo, datas, YouTube).
 */
const { slugify, parseYoutubeId, truncate, isSafeUrl } = require('./util');
const { cleanImage, isObj, hasText, resolveText } = require('./content');

const RESUMO_MAX = 160;
const bool = (v, def) => (typeof v === 'boolean' ? v : def);

/** i18n { pt, en } a partir de um valor que pode ser texto simples ou objeto. */
function i18n(val, langs) {
  if (isObj(val)) return val;
  return Object.fromEntries(langs.map((l) => [l.codigo, val == null ? '' : String(val)]));
}

function prepareEvents(rawList, { langs, defaultLang, ui, report }) {
  const list = Array.isArray(rawList) ? rawList : [];
  const codes = langs.map((l) => l.codigo);

  const events = list
    .filter(isObj)
    .map((ev) => {
      const titulo = i18n(ev.titulo, langs);
      const descritivo = i18n(ev.descritivo, langs);

      // Resumo: o escrito pelo editor ou, em falta, o descritivo truncado (por idioma).
      const resumoRaw = isObj(ev.resumo) ? ev.resumo : {};
      const resumo = {};
      for (const code of codes) {
        resumo[code] = hasText(resumoRaw[code])
          ? resumoRaw[code]
          : truncate(resolveText(descritivo, { lang: code, defaultLang }), RESUMO_MAX);
      }

      // Imagens sem alt herdam o título do evento.
      const withAlt = (img) => {
        if (!cleanImage(img)) return null;
        const hasAlt = isObj(img.alt) ? Object.values(img.alt).some((x) => hasText(String(x ?? ''))) : hasText(img.alt);
        return hasAlt ? img : { ...img, alt: titulo };
      };

      const links = (Array.isArray(ev.links) ? ev.links : [])
        .filter((l) => isObj(l) && hasText(l.url) && isSafeUrl(l.url))
        .map((l) => ({ nome: i18n(l.nome, langs), url: l.url.trim() }));

      const ytId = parseYoutubeId(ev.youtube);

      // Tipo por defeito: concerto.
      const tipo = hasText(String(ev.tipo ?? '')) ? ev.tipo : 'concerto';

      return {
        titulo,
        descritivo,
        resumo,
        tipo,
        tipo_label: (ui.tipos || {})[tipo] || tipo,
        data: ev.data,
        hora: ev.hora,
        datetime: `${ev.data}T${ev.hora}`,
        imagem_horizontal: withAlt(ev.imagem_horizontal),
        imagem_vertical: withAlt(ev.imagem_vertical),
        // Um evento cancelado nunca fica em destaque, mesmo que o campo esteja marcado.
        destaque: !bool(ev.cancelado, false) && bool(ev.destaque, false),
        cancelado: bool(ev.cancelado, false),
        link_bilhetes: hasText(ev.link_bilhetes) && isSafeUrl(ev.link_bilhetes) ? ev.link_bilhetes.trim() : '',
        youtube_id: ytId || '',
        youtube_embed: ytId ? `https://www.youtube-nocookie.com/embed/${ytId}` : '',
        links,
        _slugBase: hasText(String(ev.slug ?? '')) ? String(ev.slug) : slugify(resolveText(titulo, { lang: defaultLang, defaultLang }) || 'evento'),
      };
    });

  // Ordem ascendente por data/hora (independente da ordem no YAML).
  const key = (e) => `${e.datetime}|${slugify(resolveText(e.titulo, { lang: defaultLang, defaultLang }))}`;
  events.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

  // Slugs únicos: base -> base-AAAA-MM-DD -> base-2, base-3...
  const used = new Set();
  for (const e of events) {
    let slug = e._slugBase || 'evento';
    if (used.has(slug)) {
      const withDate = `${slug}-${e.data}`;
      let candidate = withDate;
      let n = 2;
      while (used.has(candidate)) candidate = `${withDate}-${n++}`;
      report.warn(`Título repetido: o evento "${resolveText(e.titulo, { lang: defaultLang, defaultLang })}" (${e.data}) ficou com o URL "${candidate}". Para controlar o URL, preencher o campo "slug".`);
      slug = candidate;
    }
    used.add(slug);
    e.slug = slug;
    delete e._slugBase;
  }
  return events;
}

/** Formata a data (YYYY-MM-DD) no locale pedido, sem deslocações de fuso. */
function formatDate(data, locale) {
  const [y, m, d] = data.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Data "dd/Mês" a partir de YYYY-MM-DD, sem deslocações de fuso.
 * month 'short' -> 10/Out, 10/Oct · 'long' -> 20/Março, 20/March
 */
function formatDateShort(data, locale, month = 'short') {
  const [y, m, d] = data.split('-').map(Number);
  const name = new Intl.DateTimeFormat(locale, { month, timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace('.', '');
  return `${String(d).padStart(2, '0')}/${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

module.exports = { prepareEvents, formatDate, formatDateShort, i18n };
