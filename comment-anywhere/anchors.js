// Where things are on the page: anchors, labels, quotes and pin positions.
//
// Commentable parts of the page carry data-anchor="Name". A pin's label is the
// path of names from the outside in, plus a short quote of what you clicked:
//
//   Pricing › Professional › “$16 per editor / month”
//
// A pin is stored relative to its anchor's box ({ anchor, fx, fy }, fractions of
// its width and height), so it stays on the same spot when the layout changes.
// Illustrations name their parts with data-quote; data-comment-ignore opts out.

const SEP = ' › ';
const TEXT_BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,summary,blockquote,figcaption,td,th,label,button,a';
const QUOTE_MAX = 60;

export class Anchors {
  constructor(root) {
    this.root = root;
    this.byPath = new Map();
    this.refresh();
  }

  /** Re-reads the anchors: call it when the page's structure changes. */
  refresh() {
    this.byPath.clear();
    for (const el of this.root.querySelectorAll('[data-anchor]')) {
      if (!el.closest('[data-comment-ignore]')) this.byPath.set(this.pathOf(el), el);
    }
  }

  all() {
    return [...this.byPath.values()];
  }

  pathOf(el) {
    const names = [];
    for (let node = el; node && node !== this.root.parentElement; node = node.parentElement) {
      const name = node.dataset?.anchor?.trim();
      if (name) names.unshift(name);
    }
    return names.join(SEP);
  }

  /** The innermost anchor around a node, or null. */
  anchorOf(node) {
    if (!node || !this.root.contains(node) || node.closest('[data-comment-ignore]')) return null;
    return node.closest('[data-anchor]');
  }

  /** The anchor for a path, or its nearest visible ancestor (some parts hide on phones). */
  element(path) {
    const parts = String(path).split(SEP);
    for (let n = parts.length; n > 0; n--) {
      const el = this.byPath.get(parts.slice(0, n).join(SEP));
      if (el && visible(el)) return el;
    }
    return null;
  }

  /** The label for a comment at a point: the anchor's path, plus a quote when it adds something. */
  labelAt(x, y, anchor) {
    const path = this.pathOf(anchor);
    const quote = this.quoteAt(x, y, anchor);
    return { path, label: withQuote(path, quote), quote };
  }

  /** The label for a focused element, for keyboard commenting. */
  labelFor(el) {
    const anchor = el.closest('[data-anchor]');
    const path = this.pathOf(anchor);
    const block = el === anchor ? null : el.closest(TEXT_BLOCKS);
    const quote = block && anchor.contains(block) ? trim(clean(block.textContent)) : '';
    return { anchor, path, label: withQuote(path, quote), quote };
  }

  /** A few words of what's under the pointer: the illustration part, or the sentence. */
  quoteAt(x, y, anchor) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !anchor.contains(hit)) return '';
    const named = hit.closest('[data-quote]');
    if (named && anchor.contains(named)) return clean(named.dataset.quote);
    if (hit.closest('svg')) return '';
    const block = hit.closest(TEXT_BLOCKS);
    if (!block || block === anchor || !anchor.contains(block)) return '';
    const full = block.textContent;
    const text = clean(full);
    if (text.length <= QUOTE_MAX) return text;

    // A long paragraph: quote the sentence under the pointer.
    const caret = caretAt(x, y);
    let offset = -1;
    if (caret && block.contains(caret.node)) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node === caret.node) {
          offset = seen + caret.offset;
          break;
        }
        seen += node.textContent.length;
      }
    }
    if (offset < 0) return trim(text);
    const start = Math.max(full.lastIndexOf('. ', offset), full.lastIndexOf('? ', offset), full.lastIndexOf('! ', offset));
    const end = [full.indexOf('. ', offset), full.indexOf('? ', offset), full.indexOf('! ', offset)].filter((i) => i >= 0);
    const sentence = clean(full.slice(start < 0 ? 0 : start + 2, end.length ? Math.min(...end) + 1 : full.length));
    return trim(sentence);
  }

  /** Where a pin sits, in page coordinates. A pin without a position goes to the anchor's top right. */
  point(pin) {
    const el = this.element(pin.anchor);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const exact = el === this.byPath.get(pin.anchor) && Number.isFinite(pin.fx) && Number.isFinite(pin.fy);
    const x = exact ? r.left + pin.fx * r.width : r.right - Math.min(44, r.width / 2);
    const y = exact ? r.top + pin.fy * r.height : r.top + Math.min(40, r.height / 2);
    return { x: x + scrollX, y: y + scrollY };
  }

  /** A pin position for a point on the screen, relative to an anchor. */
  pinAt(anchor, x, y) {
    const r = anchor.getBoundingClientRect();
    return {
      anchor: this.pathOf(anchor),
      fx: r.width ? clamp((x - r.left) / r.width, 0, 1) : 0,
      fy: r.height ? clamp((y - r.top) / r.height, 0, 1) : 0,
    };
  }

  /** A pin for keyboard commenting: near the element's top right. */
  pinFor(anchor, el = anchor) {
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = Math.min(r.right - 12, r.left + Math.max(r.width - 28, r.width / 2));
    const y = r.top + Math.min(20, r.height / 2);
    return {
      anchor: this.pathOf(anchor),
      fx: a.width ? clamp((x - a.left) / a.width, 0, 1) : 0,
      fy: a.height ? clamp((y - a.top) / a.height, 0, 1) : 0,
    };
  }
}

function withQuote(path, quote) {
  const last = path.split(SEP).at(-1) ?? '';
  if (!quote || quote.toLowerCase() === last.toLowerCase()) return path;
  return `${path}${SEP}“${quote.replace(/[“”"]/g, '')}”`;
}

function clean(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function trim(text) {
  if (text.length <= QUOTE_MAX) return text;
  const cut = text.slice(0, QUOTE_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), QUOTE_MAX / 2)).replace(/[\s,.;:–-]+$/, '')}…`;
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
