'use strict';
/**
 * Remove os eventos que já passaram (data anterior a hoje, em Lisboa):
 *   - apaga a entrada em content/agenda.yaml (edição do texto: comentários e formatação mantêm-se);
 *   - apaga de src/images/ as imagens desses eventos que não são usadas em mais lado nenhum.
 * As páginas /event/<slug>/ deixam de ser geradas porque o evento já não existe (o /dist é recriado).
 *
 * Segurança: se o YAML editado não der exatamente a lista original sem os eventos passados,
 * não escreve nada e só avisa. Imagens referenciadas noutro YAML, template ou CSS nunca são apagadas.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { collectImageNames, loadYamlFile, isObj } = require('./content');
const { imageName } = require('./util');

const TIME_ZONE = 'Europe/Lisbon';

/** Hoje (YYYY-MM-DD) no fuso do site. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());

/**
 * Devolve [{ start, end }] (índices de linhas) de cada item da lista "eventos:" no topo do YAML,
 * ou null se a lista não estiver no formato habitual (bloco com "- ").
 */
function eventBlocks(lines) {
  const head = lines.findIndex((l) => /^eventos:\s*(#.*)?$/.test(l));
  if (head < 0) return null;
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (/^[^\s#-]/.test(lines[i])) { end = i; break; } // próxima chave de topo
  }
  const first = lines.slice(head + 1, end).find((l) => /^\s*- /.test(l));
  if (!first) return null;
  const indent = first.match(/^\s*/)[0];
  const itemRe = new RegExp(`^${indent}- `);
  const starts = [];
  for (let i = head + 1; i < end; i++) if (itemRe.test(lines[i])) starts.push(i);
  return starts.map((s, k) => ({ start: s, end: k + 1 < starts.length ? starts[k + 1] : end }));
}

function prunePastEvents({ contentDir, imagesDir, refDirs = [], report }) {
  const file = path.join(contentDir, 'agenda.yaml');
  const text = fs.readFileSync(file, 'utf8');
  const agenda = loadYamlFile(file);
  const eventos = Array.isArray(agenda.eventos) ? agenda.eventos : [];
  const now = today();
  const isPast = (ev) => isObj(ev) && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.data)) && String(ev.data) < now;
  const past = eventos.filter(isPast);
  if (!past.length) return { removed: [], images: [] };

  const label = (ev) => `"${(isObj(ev.titulo) ? ev.titulo.pt || Object.values(ev.titulo)[0] : ev.titulo) || '?'}" (${ev.data})`;

  // 1) YAML: remove os blocos de texto dos eventos passados
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const blocks = eventBlocks(lines);
  if (!blocks || blocks.length !== eventos.length) {
    report.warn(`Eventos passados não removidos: não foi possível localizar a lista "eventos:" em content/agenda.yaml. Remover à mão: ${past.map(label).join(', ')}`);
    return { removed: [], images: [] };
  }
  const drop = new Set();
  eventos.forEach((ev, i) => {
    if (!isPast(ev)) return;
    for (let l = blocks[i].start; l < blocks[i].end; l++) drop.add(l);
  });
  const kept = eventos.filter((ev) => !isPast(ev));
  let out = lines.filter((_, i) => !drop.has(i));
  if (!kept.length) out = out.map((l) => (/^eventos:\s*(#.*)?$/.test(l) ? l.replace(/^eventos:/, 'eventos: []') : l));
  const newText = out.join(eol);

  let check;
  try { check = yaml.load(newText, { schema: yaml.CORE_SCHEMA }) || {}; } catch { check = null; }
  if (!check || JSON.stringify(check.eventos || []) !== JSON.stringify(kept)) {
    report.warn(`Eventos passados não removidos: a edição automática de content/agenda.yaml não deu o resultado esperado. Remover à mão: ${past.map(label).join(', ')}`);
    return { removed: [], images: [] };
  }
  fs.writeFileSync(file, newText);

  // 2) Imagens dos eventos removidos que já não são usadas em nenhum YAML, template ou CSS
  const referenced = new Set();
  for (const f of fs.readdirSync(contentDir).filter((n) => /\.ya?ml$/.test(n))) {
    collectImageNames(loadYamlFile(path.join(contentDir, f))).forEach((n) => referenced.add(n));
  }
  const otherText = [];
  const readAll = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) readAll(f);
      else if (/\.(html|css|js)$/i.test(e.name)) otherText.push(fs.readFileSync(f, 'utf8'));
    }
  };
  refDirs.forEach(readAll);
  const usedElsewhere = (n) => otherText.some((t) => t.includes(n));

  const images = [...collectImageNames(past)]
    .filter((n) => imageName(n) === n && !referenced.has(n) && !usedElsewhere(n))
    .filter((n) => {
      const full = path.resolve(imagesDir, n);
      return full.startsWith(path.resolve(imagesDir) + path.sep) && fs.existsSync(full);
    })
    .sort();
  images.forEach((n) => fs.unlinkSync(path.join(imagesDir, n)));

  return { removed: past.map(label), images };
}

module.exports = { prunePastEvents };
