'use strict';
/**
 * Gera as imagens de teste em src/images/ (NÃO faz parte do build).
 *
 *   npm run placeholders            descarrega PNGs do placehold.co
 *   npm run placeholders -- --local gera-os localmente com o sharp (sem rede)
 *
 * Só cria ficheiros que ainda não existem (--force para refazer).
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'images');
const LOCAL = process.argv.includes('--local');
const FORCE = process.argv.includes('--force');

const COLORS = [['1f6f8b', 'ffffff'], ['99a799', '1b1b1b'], ['d3c4a1', '1b1b1b'], ['e6b89c', '1b1b1b'],
  ['6b4f7a', 'ffffff'], ['2d6a4f', 'ffffff'], ['bc4749', 'ffffff'], ['3d405b', 'ffffff']];

/** [nome, largura, altura, texto] */
const list = [];
for (const p of ['index', 'agenda', 'mural', 'contactos']) {
  list.push([`hero-${p}-h.png`, 1600, 900, `Hero ${p} horizontal`]);
  list.push([`hero-${p}-v.png`, 900, 1600, `Hero ${p} vertical`]);
}
const gal = [[800, 600], [600, 800], [800, 800], [1000, 600], [700, 700]];
for (let i = 1; i <= 10; i++) list.push([`galeria-${String(i).padStart(2, '0')}.png`, ...gal[i % gal.length], `Galeria ${i}`]);
for (let i = 1; i <= 6; i++) {
  list.push([`evento-${i}-h.png`, 1600, 900, `Evento ${i} horizontal`]);
  if (i !== 5) list.push([`evento-${i}-v.png`, 900, 1600, `Evento ${i} vertical`]);
}
const mur = [[800, 1000], [1000, 700], [700, 700], [600, 900], [1200, 800], [800, 600], [640, 960]];
for (let i = 1; i <= 14; i++) list.push([`mural-${String(i).padStart(2, '0')}.png`, ...mur[i % mur.length], `Mural ${i}`]);

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48" viewBox="0 0 160 48"><rect width="160" height="48" rx="8" fill="#1f6f8b"/><text x="80" y="31" font-family="sans-serif" font-size="18" fill="#fff" text-anchor="middle">LOGO</text></svg>\n`;

async function localPng(file, w, h, text, [bg, fg]) {
  const sharp = require('sharp');
  const fs_ = Math.round(Math.min(w, h) / 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#${bg}"/><text x="50%" y="48%" font-family="sans-serif" font-size="${fs_}" fill="#${fg}" text-anchor="middle">${text}</text><text x="50%" y="48%" dy="${Math.round(fs_ * 1.3)}" font-family="sans-serif" font-size="${Math.round(fs_ * 0.7)}" fill="#${fg}" text-anchor="middle">${w} × ${h}</text></svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(file);
}

async function remotePng(file, w, h, text, [bg, fg]) {
  const url = `https://placehold.co/${w}x${h}/${bg}/${fg}.png?text=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ao descarregar ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let made = 0;
  for (let i = 0; i < list.length; i++) {
    const [name, w, h, text] = list[i];
    const file = path.join(OUT, name);
    if (fs.existsSync(file) && !FORCE) continue;
    const colors = COLORS[i % COLORS.length];
    await (LOCAL ? localPng : remotePng)(file, w, h, text, colors);
    made++;
  }
  const logo = path.join(OUT, 'logo.svg');
  if (!fs.existsSync(logo) || FORCE) { fs.writeFileSync(logo, LOGO_SVG); made++; }
  console.log(`Placeholders: ${made} criados (${LOCAL ? 'locais' : 'placehold.co'}), ${list.length + 1 - made} já existiam.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
