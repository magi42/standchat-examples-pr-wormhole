// Small DOM helpers. html`…` escapes every value unless it's raw(), so text
// from Stand can never become markup by accident.

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new Raw(String(value));

export const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const part = (value) => {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(part).join('');
  if (value === null || value === undefined || value === false) return '';
  return esc(value);
};

/** A template literal tag: escapes values, keeps raw() ones, joins arrays. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += part(value) + strings[i + 1];
  });
  return raw(out);
}

/** Markup to a DocumentFragment. */
export function fragment(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup);
  return template.content;
}

/** Replaces an element's children with markup. */
export function setHTML(el, markup) {
  el.replaceChildren(fragment(markup));
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
