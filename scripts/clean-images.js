'use strict';
/**
 * Remove de src/images/ as imagens que pertenciam a eventos entretanto APAGADOS do YAML.
 *
 *   node scripts/clean-images.js --before <commit-anterior> [--dry] [--max N]
 *
 * Regras:
 *  - candidatas = imagens de eventos em content/agenda.yaml no commit ANTERIOR
 *                 menos tudo o que está referenciado AGORA em qualquer content/*.yaml;
 *  - imagens partilhadas com outro conteúdo (outro evento, hero, mural…) NÃO são apagadas;
 *  - nunca varre src/images/ à procura de "órfãs" (um upload recente ainda por associar seria apagado);
 *  - aborta sem apagar nada se o YAML for inválido, se não houver versão anterior
 *    ou se houver candidatas a mais (proteção contra apagamentos em massa).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { collectImageNames, loadYamlFile } = require('../lib/content');
const { imageName } = require('../lib/util');

/* ===== Configuração ===== */
const DEFAULT_MAX_DELETE = 20; // acima disto aborta (mudar com --max N)
/* ======================== */

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const IMAGES_DIR = path.join(ROOT, 'src', 'images');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const DRY = flag('--dry');
const MAX = Number(value('--max')) || DEFAULT_MAX_DELETE;
const before = value('--before');

const stop = (msg, code = 0) => { (code ? console.error : console.log)(msg); process.exit(code); };
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (!before) stop('Uso: node scripts/clean-images.js --before <commit> [--dry] [--max N]', 2);
if (/^0+$/.test(before)) stop('Primeiro push (sem versão anterior): nada a limpar.');

try { git('cat-file', '-e', `${before}^{commit}`); } catch {
  stop(`Commit anterior (${before.slice(0, 8)}) não encontrado neste clone (push forçado?). Nada foi apagado.`);
}

let oldText;
try { oldText = git('show', `${before}:content/agenda.yaml`); } catch {
  stop('content/agenda.yaml não existia no commit anterior: nada a limpar.');
}

let oldAgenda;
try { oldAgenda = yaml.load(oldText, { schema: yaml.CORE_SCHEMA }) || {}; } catch (e) {
  stop(`ABORTADO: o agenda.yaml anterior é inválido (${e.reason || e.message}). Nada foi apagado.`, 1);
}

// 1) Imagens de eventos na versão anterior
const oldEventImages = collectImageNames(oldAgenda.eventos);

// 2) Tudo o que está referenciado AGORA
const referenced = new Set();
try {
  for (const f of fs.readdirSync(CONTENT_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    collectImageNames(loadYamlFile(path.join(CONTENT_DIR, f))).forEach((n) => referenced.add(n));
  }
} catch (e) {
  stop(`ABORTADO: ${e.message}\nNada foi apagado.`, 1);
}

// 3) Candidatas = imagens de eventos que deixaram de ser referenciadas
const candidates = [...oldEventImages]
  .filter((n) => !referenced.has(n))
  .filter((n) => imageName(n) === n) // só nomes simples, nunca caminhos
  .filter((n) => {
    const full = path.resolve(IMAGES_DIR, n);
    return full.startsWith(IMAGES_DIR + path.sep) && fs.existsSync(full);
  })
  .sort();

const kept = [...oldEventImages].filter((n) => referenced.has(n));
if (kept.length) console.log(`Mantidas (ainda referenciadas): ${kept.length}`);

if (!candidates.length) stop('Nenhuma imagem de eventos apagados para remover.');

if (candidates.length > MAX) {
  stop(`ABORTADO: ${candidates.length} imagens seriam removidas (limite de segurança: ${MAX}).\n` +
    'Se for mesmo isso que queres, corre localmente: npm run clean-images -- --before <commit> --max <N>\n' +
    `Candidatas: ${candidates.join(', ')}`, 1);
}

for (const n of candidates) {
  if (DRY) console.log(`[dry] removeria src/images/${n}`);
  else {
    fs.unlinkSync(path.join(IMAGES_DIR, n));
    console.log(`Removida: src/images/${n}`);
  }
}
console.log(DRY ? `\n(dry-run) ${candidates.length} imagem(ns) seriam removidas.` : `\n${candidates.length} imagem(ns) removida(s).`);
