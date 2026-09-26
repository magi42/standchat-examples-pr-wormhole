// Small DOM helpers shared by the tracker and its overlays.

import { ICONS } from './icons.js';
import { blocks, safeUrl } from './model.js';

/** Creates an element. `html` is only ever used with this folder's own icon markup. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') el.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : String(child));
  }
  return el;
}

/** Replaces an element's children, skipping the empty ones (null, false, []). */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((child) => child != null && child !== false));
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The command key as people know it: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

/** Scrolls `container` just enough to show `el`. Unlike scrollIntoView, never moves the page. */
export function keepInView(container, el, { top = 0 } = {}) {
  if (!container || !el || container.scrollHeight <= container.clientHeight) return;
  const box = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (rect.top < box.top + top) container.scrollTop -= box.top + top - rect.top;
  else if (rect.bottom > box.bottom) container.scrollTop += rect.bottom - box.bottom;
}

/** Plays a Web Animation unless the visitor prefers reduced motion. */
export function animate(el, keyframes, options) {
  if (!el?.animate || reducedMotion()) return null;
  return el.animate(keyframes, { duration: 220, easing: 'cubic-bezier(.16, 1, .3, 1)', ...options });
}

/**
 * Keeps `parent`'s children in the order of `items`, reusing elements by key.
 * New elements get `data-new` for one render, so callers can animate them in.
 */
export function reconcile(parent, items, key, create, update) {
  const existing = new Map();
  for (const el of parent.children) if (el.dataset.key) existing.set(el.dataset.key, el);
  let previous = null;
  const added = [];
  for (const item of items) {
    const k = key(item);
    let el = existing.get(k);
    if (el) existing.delete(k);
    else {
      el = create(item);
      el.dataset.key = k;
      added.push(el);
    }
    update?.(el, item);
    const next = previous ? previous.nextElementSibling : parent.firstElementChild;
    if (el !== next) parent.insertBefore(el, next);
    previous = el;
  }
  for (const el of existing.values()) el.remove();
  return added;
}

// People --------------------------------------------------------------------

const initials = (name) => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
};

const hueOf = (name) => [...String(name)].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 360, 7);

/**
 * An avatar: the responder's picture when Stand has one, a spark for an AI
 * Stand-in without one, initials for people, a dashed ring for nobody yet.
 */
export function avatar(person, size = 18) {
  const el = h('span', { class: 'tk-av', 'aria-hidden': 'true', style: `--size: ${size}px` });
  if (!person) {
    el.dataset.kind = 'none';
    el.innerHTML = ICONS.user;
    return el;
  }
  el.dataset.kind = person.kind || 'rep';
  if (person.kind === 'visitor') {
    el.innerHTML = ICONS.person;
    return el;
  }
  el.style.setProperty('--hue', person.hue ?? hueOf(person.name));
  const fallback = () => {
    if (person.kind === 'standin') el.innerHTML = ICONS.sparkle;
    else el.textContent = initials(person.name);
  };
  const url = safeUrl(person.avatar);
  if (url) {
    const img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => {
      img.remove();
      fallback();
    }, { once: true });
    el.append(img);
    el.dataset.photo = '';
  } else {
    fallback();
  }
  return el;
}

/** "Stand Chat Demo AI": the name exactly as Stand gives it, and what it is. */
export function who(person, { strong = true } = {}) {
  const name = h(strong ? 'b' : 'span', { class: 'tk-who', text: person?.name || 'Someone' });
  if (person?.kind !== 'standin') return name;
  return [name, h('span', { class: 'tk-ai', title: 'An AI Stand-in answers here', text: 'AI' })];
}

// Time ----------------------------------------------------------------------

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const FULL = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export function ago(ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return MONTH_DAY.format(ms);
}

export function shortDate(ms, now = Date.now()) {
  if (!ms) return '';
  return new Date(ms).toDateString() === new Date(now).toDateString() ? 'Today' : MONTH_DAY.format(ms);
}

export function timeEl(ms, format = ago) {
  return h('time', { datetime: new Date(ms || Date.now()).toISOString(), title: FULL.format(ms || Date.now()), dataset: { at: String(ms || Date.now()), format: format === ago ? 'ago' : 'short' }, text: format(ms) });
}

/** Refreshes every relative time inside `root`. */
export function refreshTimes(root, now = Date.now()) {
  for (const el of root.querySelectorAll('time[data-at]')) {
    const ms = Number(el.dataset.at);
    const text = el.dataset.format === 'short' ? shortDate(ms, now) : ago(ms, now);
    if (el.textContent !== text) el.textContent = text;
  }
}

// Message text ---------------------------------------------------------------

/**
 * Reply text as DOM: paragraphs, lists, bold, code, links and references.
 * Built with text nodes, so no message can ever inject markup.
 * `ref(token)` returns a node for a reference, or null to show it as text.
 */
export function richText(text, ref) {
  const frag = document.createDocumentFragment();
  const inline = (tokens) => tokens.map((token) => {
    switch (token.t) {
      case 'b': return h('strong', { text: token.v });
      case 'code': return h('code', { text: token.v });
      case 'link': return h('a', { href: token.href, target: '_blank', rel: 'noopener noreferrer', text: token.v });
      case 'ref': return ref?.(token) ?? document.createTextNode(token.v);
      default: return document.createTextNode(token.v);
    }
  });
  for (const block of blocks(text)) {
    if (block.type === 'ul') frag.append(h('ul', {}, block.items.map((item) => h('li', {}, inline(item)))));
    else frag.append(h('p', {}, block.lines.map((line, i) => [i ? h('br') : null, inline(line)])));
  }
  return frag;
}
