'use strict';
/**
 * Motor de templates mínimo (sem dependências).
 *
 *   {{a.b}}                 texto escapado (objetos de idiomas {pt,en} resolvem-se sozinhos)
 *   {{{x}}}                 HTML gerado pelo build (não escapado)
 *   {{img campo preset=card}} / {{hero H V}} / {{para campo}}   helpers (ver build.js)
 *   {{#each lista}}…{{/each}}   {{#if x}}…{{else}}…{{/if}}   {{> partial}}
 *   {{#lang pt}}…{{/lang}}  só aparece na versão desse idioma (aceita vários: {{#lang pt en}})
 *   Dentro de #each: this, @index, @number, @first, @last. Os nomes não encontrados no
 *   item procuram-se nos contextos exteriores.
 *
 * Os valores inseridos NUNCA são re-analisados: um "{{" escrito por um editor no YAML
 * não pode partir o build. Qualquer "{{" mal formado nos templates falha o build.
 */
const fs = require('fs');
const path = require('path');
const { BuildError, escapeHtml } = require('./util');
const { isI18n, resolveText, isObj } = require('./content');

const TAG_RE = /\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g;

function tokenize(src, name) {
  const tokens = [];
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;
  let last = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src))) {
    if (m.index > last) tokens.push({ type: 'text', value: src.slice(last, m.index), line: lineAt(last) });
    tokens.push(m[1] !== undefined
      ? { type: 'raw', value: m[1].trim(), line: lineAt(m.index) }
      : { type: 'tag', value: m[2].trim(), line: lineAt(m.index) });
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ type: 'text', value: src.slice(last), line: lineAt(last) });
  for (const t of tokens) {
    if (t.type === 'text' && /\{\{|\}\}/.test(t.value)) {
      throw new BuildError(`${name}:${t.line}: tag "{{ }}" mal formada ou por fechar.`);
    }
  }
  return tokens;
}

function parse(src, name) {
  const tokens = tokenize(src, name);
  let i = 0;
  const fail = (t, msg) => new BuildError(`${name}:${t.line}: ${msg}`);

  function block(stops) {
    const nodes = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.type === 'text') { nodes.push({ t: 'text', v: t.value }); i++; continue; }
      if (t.type === 'raw') { nodes.push({ t: 'raw', expr: t.value, line: t.line }); i++; continue; }
      const body = t.value;
      if (stops.includes(body)) return { nodes, stop: body };
      if (body.startsWith('#each ')) {
        i++;
        const r = block(['/each']);
        if (r.stop !== '/each') throw fail(t, '{{#each}} sem {{/each}}.');
        i++;
        nodes.push({ t: 'each', path: body.slice(6).trim(), body: r.nodes, line: t.line });
      } else if (body.startsWith('#if ')) {
        i++;
        const r = block(['else', '/if']);
        let elseNodes = [];
        if (r.stop === 'else') {
          i++;
          const r2 = block(['/if']);
          if (r2.stop !== '/if') throw fail(t, '{{#if}} sem {{/if}}.');
          elseNodes = r2.nodes;
        } else if (r.stop !== '/if') throw fail(t, '{{#if}} sem {{/if}}.');
        i++;
        nodes.push({ t: 'if', path: body.slice(4).trim(), body: r.nodes, else: elseNodes, line: t.line });
      } else if (body.startsWith('#lang ')) {
        i++;
        const r = block(['/lang']);
        if (r.stop !== '/lang') throw fail(t, '{{#lang}} sem {{/lang}}.');
        i++;
        nodes.push({ t: 'lang', codes: body.slice(6).trim().split(/\s+/), body: r.nodes, line: t.line });
      } else if (body.startsWith('>')) {
        nodes.push({ t: 'partial', name: body.slice(1).trim(), line: t.line });
        i++;
      } else if (body[0] === '#' || body[0] === '/' || body === 'else') {
        throw fail(t, `tag inesperada {{${body}}}.`);
      } else {
        nodes.push({ t: 'var', expr: body, line: t.line });
        i++;
      }
    }
    return { nodes, stop: null };
  }

  const r = block([]);
  return r.nodes;
}

function parseExpr(expr) {
  const parts = expr.split(/\s+/);
  const pos = [];
  const opts = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) opts[p.slice(0, eq)] = p.slice(eq + 1);
    else pos.push(p);
  }
  return { name: parts[0], pos, opts };
}

function lookup(p, scopes) {
  const parts = p.split('.');
  const first = parts[0];
  const top = scopes[scopes.length - 1];
  let cur;
  let found = false;
  if (first === 'this') { cur = top.value; found = true; }
  else if (first[0] === '@') {
    if (first in top.extras) { cur = top.extras[first]; found = true; }
  } else {
    for (let s = scopes.length - 1; s >= 0; s--) {
      const v = scopes[s].value;
      if (isObj(v) && first in v) { cur = v[first]; found = true; break; }
    }
  }
  if (!found) return { found: false };
  for (let k = 1; k < parts.length; k++) {
    if (cur == null || typeof cur !== 'object') return { found: false };
    cur = cur[parts[k]];
    if (cur === undefined) return { found: false };
  }
  return { found: true, value: cur };
}

function createEngine({ templatesDir, helpers, report }) {
  const cache = new Map();

  function compile(name, dir) {
    const file = path.join(dir, `${name}.html`);
    if (!cache.has(file)) {
      let src;
      try { src = fs.readFileSync(file, 'utf8'); } catch {
        throw new BuildError(`Template em falta: ${path.relative(process.cwd(), file)}`);
      }
      cache.set(file, parse(src, path.relative(process.cwd(), file)));
    }
    return cache.get(file);
  }

  function render(templateName, data, { lang, defaultLang, langCodes }) {
    const env = { lang, defaultLang, langCodes };

    const truthy = (v) => {
      if (v == null || v === false || v === 0 || v === '') return false;
      if (Array.isArray(v)) return v.length > 0;
      if (isI18n(v, langCodes)) return Object.values(v).some((x) => x != null && String(x).trim() !== '');
      if (typeof v === 'object') return Object.keys(v).length > 0;
      if (typeof v === 'string') return v.trim() !== '';
      return true;
    };

    function run(nodes, scopes, tpl) {
      let out = '';
      for (const n of nodes) {
        const fail = (msg) => new BuildError(`${tpl}:${n.line}: ${msg}`);
        const textOf = (val, label) => {
          if (val == null) return '';
          if (isI18n(val, langCodes)) return resolveText(val, { lang, defaultLang, report, label: `${tpl} › ${label}` });
          if (typeof val === 'object') throw fail(`"${label}" não é texto (é um objeto ou lista).`);
          return String(val);
        };
        switch (n.t) {
          case 'text': out += n.v; break;
          case 'raw': {
            const r = lookup(n.expr, scopes);
            if (!r.found) throw fail(`chave "${n.expr}" em falta no conteúdo.`);
            out += r.value == null ? '' : String(r.value);
            break;
          }
          case 'var': {
            const e = parseExpr(n.expr);
            if (helpers[e.name]) {
              const api = {
                lang, defaultLang,
                get: (p) => { const r = lookup(p, scopes); return r.found ? r.value : undefined; },
                text: (val, label = 'texto') => textOf(val, label),
                fail,
              };
              out += helpers[e.name](e, api);
            } else {
              if (e.pos.length || Object.keys(e.opts).length) throw fail(`helper desconhecido: "${e.name}".`);
              const r = lookup(e.name, scopes);
              if (!r.found) throw fail(`chave "${e.name}" em falta no conteúdo.`);
              out += escapeHtml(textOf(r.value, e.name));
            }
            break;
          }
          case 'if': {
            const r = lookup(n.path, scopes);
            out += run(r.found && truthy(r.value) ? n.body : n.else, scopes, tpl);
            break;
          }
          case 'each': {
            const r = lookup(n.path, scopes);
            if (!r.found || !truthy(r.value)) break;
            if (!Array.isArray(r.value)) throw fail(`"${n.path}" não é uma lista.`);
            const len = r.value.length;
            r.value.forEach((item, idx) => {
              const extras = { '@index': idx, '@number': idx + 1, '@first': idx === 0, '@last': idx === len - 1 };
              out += run(n.body, [...scopes, { value: item, extras }], tpl);
            });
            break;
          }
          case 'lang': {
            const bad = n.codes.find((c) => !langCodes.has(c));
            if (bad) throw fail(`idioma desconhecido em {{#lang}}: "${bad}".`);
            if (n.codes.includes(lang)) out += run(n.body, scopes, tpl);
            break;
          }
          case 'partial':
            out += run(compile(`partials/${n.name}`, templatesDir), scopes, `partials/${n.name}.html`);
            break;
          default:
            throw fail('nó desconhecido.');
        }
      }
      return out;
    }

    return run(compile(templateName, templatesDir), [{ value: data, extras: {} }], `${templateName}.html`);
  }

  return { render };
}

module.exports = { createEngine, parse };
