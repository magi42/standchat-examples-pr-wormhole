// Small helpers shared by the page's modules.

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Only http(s) links leave this page; anything else is dropped. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ''), location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

export function newId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// Tag colors from the page's palette: background and ink.
const AVATAR_COLORS = [
  ['#E3E2E0', '#37352F'], ['#EEE0DA', '#5C3B2E'], ['#FADEC9', '#7A4417'], ['#FDECC8', '#6F5020'], ['#DBEDDB', '#255337'],
  ['#D3E5EF', '#24405F'], ['#E8DEEE', '#452C5E'], ['#F5E0E9', '#632D46'], ['#FFE2DD', '#6B312B'],
];

/**
 * An avatar: the responder's picture when Stand has one, their initial on a
 * tinted circle when it doesn't (or when the picture fails to load).
 */
export function avatarHtml(name, url, className = '') {
  const label = String(name ?? '').trim();
  const initial = label ? [...label][0].toUpperCase() : '?';
  let hash = 0;
  for (const c of label) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  const [bg, ink] = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const src = safeUrl(url);
  return `<span class="kn-av ${className}" style="--av-bg:${bg};--av-ink:${ink}" aria-hidden="true">${escapeHtml(initial)}${src ? `<img src="${escapeHtml(src)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}</span>`;
}

// A picture that fails to load leaves its initial behind.
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.parentElement?.classList.contains('kn-av')) e.target.remove();
}, true);
