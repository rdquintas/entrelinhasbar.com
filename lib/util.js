'use strict';
/**
 * Utilitários partilhados: erros de build, relatório (erros + avisos),
 * escape de HTML, slugs, URLs seguras, YouTube e texto multilinha.
 */

class BuildError extends Error {}

/** Escapa texto para HTML (conteúdo e atributos). */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** "Workshop de Cozinha — José" -> "workshop-de-cozinha-jose" */
function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * O YAML guarda só o nome do ficheiro, mas o Pages CMS pode gravar um caminho
 * ("/images/x.jpg", "src/images/x.jpg"). Usamos sempre só o nome.
 */
function imageName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().split(/[\\/]/).pop();
  return name || null;
}

/** Só aceita http(s), mailto e tel (bloqueia javascript:, data:, etc.). */
function isSafeUrl(value) {
  return typeof value === 'string' && /^(https?:\/\/|mailto:|tel:)/i.test(value.trim());
}

/** Aceita um ID de 11 caracteres ou um URL do YouTube; devolve o ID ou null. */
function parseYoutubeId(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^[\w-]{11}$/.test(v)) return v;
  try {
    const u = new URL(v);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
        if (m) id = m[1];
      }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Link de vídeo do YouTube, Facebook ou Instagram -> { origem, embed, formato } ou null.
 * formato: "horizontal" (16:9) ou "vertical" (reels/Instagram).
 */
function parseVideo(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ytId = parseYoutubeId(value);
  if (ytId) return { origem: 'youtube', embed: `https://www.youtube-nocookie.com/embed/${ytId}`, formato: 'horizontal' };
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|web)\./, '');
  if (host === 'facebook.com' || host === 'fb.watch') {
    const isVideo = host === 'fb.watch' || /^\/(watch|reel|share\/[rv])\b|\/videos\//.test(u.pathname);
    if (!isVideo) return null;
    const href = `https://${host === 'fb.watch' ? 'fb.watch' : 'www.facebook.com'}${u.pathname}${u.search}`;
    return {
      origem: 'facebook',
      embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`,
      formato: /^\/(reel|share\/r)\b/.test(u.pathname) ? 'vertical' : 'horizontal',
    };
  }
  if (host === 'instagram.com') {
    const m = u.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
    if (!m) return null;
    const tipo = m[1] === 'reels' ? 'reel' : m[1];
    return { origem: 'instagram', embed: `https://www.instagram.com/${tipo}/${m[2]}/embed/`, formato: 'vertical' };
  }
  return null;
}

/** Texto multilinha -> HTML seguro: linhas em branco = <p>, quebras simples = <br>. */
function paragraphs(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!t) return '';
  return t.split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** Corta em fronteira de palavra e acrescenta reticências. */
function truncate(text, max = 160) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = cut.lastIndexOf(' ');
  return `${(i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Recolhe erros (bloqueiam o build) e avisos (só informam). */
class Report {
  constructor() {
    this.errors = [];
    this.warnings = new Set();
  }

  error(where, message, fix) {
    this.errors.push({ where, message, fix });
  }

  warn(message) {
    this.warnings.add(message);
  }

  print() {
    for (const w of this.warnings) console.warn(`⚠  AVISO  ${w}`);
    for (const e of this.errors) {
      console.error(`\n✖  ERRO  ${e.where}\n   ${e.message}${e.fix ? `\n   Como corrigir: ${e.fix}` : ''}`);
    }
  }

  /** Imprime tudo e falha se houver erros. */
  flush() {
    this.print();
    this.warnings.clear();
    if (this.errors.length) {
      const n = this.errors.length;
      throw new BuildError(`\nBuild interrompido: ${n} ${n === 1 ? 'erro' : 'erros'} no conteúdo. O deploy anterior mantém-se online.`);
    }
  }
}

module.exports = {
  BuildError, Report, escapeHtml, slugify, imageName, isSafeUrl,
  parseYoutubeId, parseVideo, paragraphs, truncate, formatBytes,
};
