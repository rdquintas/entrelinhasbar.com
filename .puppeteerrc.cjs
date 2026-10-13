// Puppeteer (usado no build para gerar a imagem da agenda, ver lib/agenda-imagem.js).
// O browser fica dentro de node_modules: o Netlify guarda node_modules em cache entre builds,
// por isso o browser e o pacote ficam sempre sincronizados. Só se descarrega o chrome-headless-shell (mais leve).
const { join } = require('path');

module.exports = {
  cacheDirectory: join(__dirname, 'node_modules', '.cache', 'puppeteer'),
  chrome: { skipDownload: true },
  'chrome-headless-shell': { skipDownload: false },
};
