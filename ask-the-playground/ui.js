// Small DOM helpers shared by the dashboard and the assistant. Text always goes
// in as text. The only HTML is the SQL highlighter's output, which escapes it.

import { highlight } from './sql.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'sql') el.innerHTML = highlight(value); // highlight() escapes everything
    else if (key === 'style') el.style.cssText = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** A user's round initial, or a symbol for the two roles that aren't people. */
export function avatar(user, cls = '') {
  const el = h('span', { class: `avatar avatar-${user.id} ${cls}`.trim(), 'aria-hidden': 'true' });
  if (user.id === 'service_role') el.append(icon('key'));
  else el.textContent = user.id === 'anon' ? '∅' : user.label[0];
  return el;
}

export const plural = (n, word, many = `${word}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;

export function ms(value) {
  if (!Number.isFinite(value)) return '';
  return value < 10 ? `${value.toFixed(1)} ms` : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

/** A results grid. Values arrive as text, numbers, booleans or null. */
export function gridTable(result, { limit = Infinity, fresh = false } = {}) {
  // Columns fit their content; an empty last column takes the rest of the width.
  const head = h('tr', {}, h('th', { class: 'rownum', scope: 'col' }, h('span', { class: 'sr-only', text: 'Row' })));
  for (const field of result.fields) {
    head.append(h('th', { scope: 'col', title: `${field.name} (${field.type})` }, field.name, h('small', { text: field.type })));
  }
  head.append(h('th', { class: 'fill', 'aria-hidden': 'true' }));
  const body = h('tbody');
  result.rows.slice(0, limit).forEach((row, i) => {
    const tr = h('tr', { class: fresh ? 'is-new' : '' }, h('td', { class: 'rownum', text: String(i + 1) }));
    row.forEach((value, c) => {
      const numeric = result.fields[c]?.numeric;
      const text = value === null ? 'NULL' : String(value);
      tr.append(h('td', {
        class: value === null ? 'is-null' : numeric ? 'is-num' : '',
        title: text.length > 36 ? text : null,
        text,
      }));
    });
    tr.append(h('td', { class: 'fill', 'aria-hidden': 'true' }));
    body.append(tr);
  });
  return h('table', { class: 'grid-table' }, h('thead', {}, head), body);
}

/** Moves focus into an element and back out again, for dialogs and sheets. */
export function focusables(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.closest('[hidden]') && el.getClientRects().length);
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** sessionStorage that never throws: storage can be blocked or full. */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The page still works; it just forgets on reload.
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Nothing to do.
    }
  },
};
