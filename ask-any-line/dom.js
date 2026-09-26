// Small DOM helpers shared by the page's modules.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Only http(s) links leave this page. */
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Copies text, and says so on the button for a moment. */
export async function copyText(text, button) {
  const label = button.querySelector('span') ?? button;
  const before = label.textContent;
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = 'Copied';
  } catch {
    label.textContent = 'Select and copy';
  }
  setTimeout(() => (label.textContent = before), 1500);
}

/** The Powered by Stand link, when Stand asks for attribution. */
export function poweredBy(url, onClick) {
  const href = safeUrl(url);
  if (!href) return null;
  const link = el('a', 'powered', 'Powered by Stand');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.addEventListener('click', onClick);
  return link;
}
