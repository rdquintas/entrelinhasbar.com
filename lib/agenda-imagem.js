'use strict';
/**
 * Imagem da agenda (para a newsletter e para o botão de download da página agenda).
 * Serve o /dist num servidor local temporário, abre as páginas geradas a partir de
 * templates/agenda-imagem.html num Chrome sem interface (Puppeteer) e grava um JPEG por página.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');

const WIDTH = 1080; // largura da página (CSS px); o JPEG sai com o dobro
const SCALE = 2;
const MAX_PX = 16000; // o Chrome não fotografa mais do que ~16384px de altura
const QUALITY = 90;
const SELECTOR = '#agenda-imagem';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

/** Servidor estático mínimo sobre `root`, numa porta livre de 127.0.0.1. */
function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (rel.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function launch() {
  const puppeteer = require('puppeteer');
  // --no-sandbox: no Netlify (Linux, sem namespaces) o sandbox do Chrome não arranca; só abrimos páginas nossas.
  const opts = { headless: 'shell', args: process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [] };
  try {
    return await puppeteer.launch(opts);
  } catch (e) {
    if (!/Could not find|Browser was not found/i.test(e.message)) throw e;
    // node_modules veio da cache sem o browser descarregado: instalar e tentar outra vez.
    console.log('Chrome do Puppeteer em falta: a descarregar…');
    execSync('npx puppeteer browsers install chrome-headless-shell', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    return puppeteer.launch(opts);
  }
}

/**
 * pages: [{ src: 'caminho/em/dist.html', out: 'caminho/em/dist.jpg' }]
 * Os ficheiros `src` são apagados no fim (tenha corrido bem ou não).
 */
async function captureAgendaImages({ distDir, pages }) {
  const root = path.resolve(distDir);
  const server = await serve(root);
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const p of pages) {
      await page.setViewport({ width: WIDTH, height: 800, deviceScaleFactor: SCALE });
      await page.goto(`${base}/${p.src}`, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      const el = await page.$(SELECTOR);
      if (!el) throw new Error(`${p.src}: elemento ${SELECTOR} não encontrado`);
      const box = await el.boundingBox();
      // Agenda muito comprida: baixa a escala para não passar o limite do Chrome.
      if (box.height * SCALE > MAX_PX) {
        await page.setViewport({ width: WIDTH, height: 800, deviceScaleFactor: Math.max(1, MAX_PX / box.height) });
      }
      const out = path.join(root, p.out);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await el.screenshot({ path: out, type: 'jpeg', quality: QUALITY });
    }
  } finally {
    if (browser) await browser.close();
    server.close();
    for (const p of pages) fs.rmSync(path.join(root, p.src), { force: true });
  }
}

module.exports = { captureAgendaImages };
