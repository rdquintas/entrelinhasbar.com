/**
 * maps.js — converte o link do Google Maps (contactos.yaml › link_google_maps) num URL de embed (iframe).
 * Os links curtos (maps.app.goo.gl) não podem ser embutidos: seguimos o redirect no build para obter
 * o nome do sítio e as coordenadas do URL completo. Sem rede, usa a morada como pesquisa.
 */

async function resolveShortLink(url) {
  if (!/^https?:\/\/(maps\.app\.)?goo\.gl\//.test(url)) return url;
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
  return res.headers.get('location') || url;
}

function embedFromUrl(url) {
  // Coordenadas do sítio (!3d<lat>!4d<lng>) ou, na falta delas, do centro do mapa (@<lat>,<lng>).
  const pin = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!pin) return null;
  const place = url.match(/\/maps\/place\/([^/]+)/);
  const name = place ? decodeURIComponent(place[1].replace(/\+/g, ' ')) : '';
  // ID do sítio (!1s0x…:0x…): com ele usamos o formato de "Partilhar › Incorporar mapa", que marca o sítio com o pin vermelho.
  const id = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (id) {
    return 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1500!2d' + pin[2] + '!3d' + pin[1]
      + '!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s' + encodeURIComponent(id[1])
      + '!2s' + encodeURIComponent(name || 'Entrelinhas') + '!5e0!3m2!1spt-PT!2spt';
  }
  // Sem ID: pesquisa pelas coordenadas, que também põe um pin no local.
  return `https://maps.google.com/maps?q=${pin[1]},${pin[2]}&z=17&output=embed`;
}

async function mapsEmbedUrl(link, morada, report) {
  if (!link) return '';
  try {
    const embed = embedFromUrl(await resolveShortLink(link));
    if (embed) return embed;
    report.warn(`contactos.yaml › link_google_maps: não foi possível obter coordenadas de "${link}"; o mapa usa a morada.`);
  } catch (err) {
    report.warn(`contactos.yaml › link_google_maps: falha ao resolver "${link}" (${err.message}); o mapa usa a morada.`);
  }
  return `https://maps.google.com/maps?q=${encodeURIComponent(String(morada || '').replace(/\s+/g, ' ').trim())}&z=17&output=embed`;
}

module.exports = { mapsEmbedUrl };
