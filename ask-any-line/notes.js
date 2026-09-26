// Questions about the prose: a sentence someone selected, a whole step, or the
// page. Selecting text offers "Ask about this"; the note opens under the
// paragraph, or beside it in the margin on wide screens.

import { openSlot, closeSlot } from './code-view.js';
import { cleanQuote, normalize } from './threads.js';

const BLOCKS = 'p, li, td, th, h3, .tn-callout, .tn-cmd, .tn-env, .tn-snippet';
const HOSTS = '.tn-callout, .tn-cmd, .tn-env, .tn-snippet, .tn-table, ul, ol, p, h3';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Notes {
  constructor({ article, margin, button, onAsk }) {
    this.article = article;
    this.margin = margin;
    this.button = button;
    this.onAsk = onAsk;
    this.slots = new Map(); // host element → slot
    this.labels = []; // margin labels (each with .host), laid out with the notes
    this.selection = null; // { step, title, quote, host }
    this.#watchSelection();
    new ResizeObserver(() => this.layoutMargin()).observe(article);
  }

  // ---- selection → "Ask about this"

  #watchSelection() {
    let timer;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.#readSelection(), 120);
    };
    document.addEventListener('selectionchange', check);
    document.addEventListener('pointerdown', (e) => {
      if (!this.button.contains(e.target)) this.#hideButton();
    });
    this.button.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection
    this.button.addEventListener('click', () => {
      const pick = this.selection;
      this.#hideButton();
      if (pick) this.onAsk({ kind: 'quote', step: pick.step, title: pick.title, quote: pick.quote });
      getSelection()?.removeAllRanges();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.button.hidden) {
        this.#hideButton();
      } else if (e.key === '?' && this.selection && !e.target.closest?.('input, textarea, [contenteditable]')) {
        // A keyboard path: select with Shift and the arrows, then press ?
        e.preventDefault();
        this.button.click();
      }
    });
    addEventListener('scroll', () => this.#positionButton(), { passive: true });
    addEventListener('resize', () => this.#positionButton());
  }

  #readSelection() {
    const sel = getSelection();
    const text = sel?.toString() ?? '';
    if (!sel || sel.isCollapsed || !sel.rangeCount || text.trim().length < 3) return this.#hideButton();
    const range = sel.getRangeAt(0);
    const start = elementOf(range.startContainer);
    const end = elementOf(range.endContainer);
    const step = start?.closest('[data-step]');
    // Only prose inside one step, and not the ask boxes themselves.
    if (!step || !step.contains(end) || start.closest('.note-slot, .tn-step-head button, .cb')) return this.#hideButton();
    const block = start.closest(BLOCKS);
    if (!block || !step.contains(block)) return this.#hideButton();
    this.selection = {
      step: Number(step.dataset.step),
      title: step.dataset.title,
      quote: cleanQuote(text),
      range: range.cloneRange(),
    };
    this.button.hidden = false;
    this.#positionButton();
  }

  #positionButton() {
    if (this.button.hidden || !this.selection) return;
    const rects = [...this.selection.range.getClientRects()].filter((r) => r.width > 0);
    const last = rects.at(-1) ?? this.selection.range.getBoundingClientRect();
    const first = rects[0] ?? last;
    const width = this.button.offsetWidth || 140;
    const touch = matchMedia('(hover: none)').matches;
    // Below the selection on touch screens: the system's own menu sits above it.
    const top = touch ? last.bottom + 12 : first.top - this.button.offsetHeight - 10;
    const left = Math.min(Math.max(8, (touch ? last.right : (first.left + last.right) / 2) - width / 2), innerWidth - width - 8);
    this.button.style.top = `${Math.max(8, top) + scrollY}px`;
    this.button.style.left = `${left + scrollX}px`;
  }

  #hideButton() {
    this.button.hidden = true;
    this.selection = null;
  }

  // ---- where a note goes

  /** The element a prose thread hangs from, or null. */
  hostFor(anchor) {
    if (anchor.kind === 'page') return this.article.querySelector('[data-notes="page"]');
    const step = this.article.querySelector(`[data-step="${anchor.step}"]`);
    if (!step) return this.article.querySelector('[data-notes="page"]');
    if (anchor.kind === 'step') return step.querySelector('.tn-step-head');
    // A quote: find its sentence again. It was cleaned and maybe shortened with "…".
    const needle = normalize(anchor.quote.replace(/…$/, '')).slice(0, 60);
    for (const block of step.querySelectorAll(BLOCKS)) {
      if (block.closest('.note-slot')) continue;
      if (normalize(block.textContent).includes(needle)) return hostOf(block);
    }
    return step.querySelector('.tn-step-head');
  }

  /**
   * placements: Map<host element, element[]>. Inline: a slot after the host.
   * In the margin (wide screens): the same slot, positioned beside the host.
   */
  place(placements, { margin = false } = {}) {
    for (const [host, elements] of placements) {
      let slot = this.slots.get(host);
      const fresh = !slot;
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'note-slot';
        slot.innerHTML = '<div class="note-inner"></div>';
        this.slots.set(host, slot);
      }
      if (host.matches('[data-notes]')) {
        if (slot.parentElement !== host && !margin) host.append(slot);
      }
      const where = margin ? this.margin : null;
      if (where && slot.parentElement !== where) where.append(slot);
      if (!where && !host.matches('[data-notes]') && slot.previousElementSibling !== host) host.after(slot);
      const inner = slot.firstElementChild;
      const now = [...inner.children];
      if (now.length !== elements.length || now.some((el, i) => el !== elements[i])) inner.replaceChildren(...elements);
      slot.host = host;
      if (fresh && !margin && !reduced()) openSlot(slot);
    }
    for (const [host, slot] of this.slots) {
      if (placements.has(host)) continue;
      this.slots.delete(host);
      if (!margin && !reduced() && slot.isConnected) closeSlot(slot);
      else slot.remove();
    }
    this.marginMode = margin;
    this.layoutMargin();
  }

  /** Other things that live in the margin beside their host, like line-range labels. */
  setLabels(elements) {
    for (const old of this.labels) if (!elements.includes(old)) old.remove();
    this.labels = elements;
    for (const el of elements) if (el.parentElement !== this.margin) this.margin.append(el);
    this.layoutMargin();
  }

  /** In the margin, notes and labels line up with what they're about and never overlap. */
  layoutMargin() {
    if (!this.marginMode) return;
    const base = this.margin.getBoundingClientRect().top;
    const items = [...this.labels, ...[...this.slots.values()].filter((s) => s.parentElement === this.margin)]
      .map((el) => ({ el, top: el.host.getBoundingClientRect().top - base, label: this.labels.includes(el) }))
      .sort((a, b) => a.top - b.top || (a.label ? -1 : 1));
    let floor = 0;
    for (const { el, top, label } of items) {
      const y = Math.max(top + (label ? 1 : 0), floor);
      el.style.top = `${y}px`;
      floor = y + el.offsetHeight + (label ? 8 : 14);
    }
  }

  /** The sentences open notes are about, highlighted in the text, without touching the DOM. */
  highlight(anchors) {
    if (!CSS.highlights || typeof Highlight === 'undefined') return;
    const ranges = anchors.map((a) => findText(this.hostFor(a), a.quote.replace(/…$/, ''))).filter(Boolean);
    CSS.highlights.set('tn-quote', new Highlight(...ranges));
  }
}

// A Range for a quote inside root, comparing with collapsed whitespace and
// straight quotes, then mapping back to the text nodes.
function findText(root, quote) {
  if (!root || !quote) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement.closest('.note-slot')) continue;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  const raw = [];
  let flat = '';
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]) && /\s$/.test(flat)) continue;
    raw.push(i);
    flat += /\s/.test(text[i]) ? ' ' : /[“”]/.test(text[i]) ? '"' : /[‘’]/.test(text[i]) ? "'" : text[i];
  }
  const needle = quote.replace(/\s+/g, ' ').slice(0, 120).toLowerCase();
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return null;
  const locate = (offset) => {
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].start <= offset) return [nodes[i].node, offset - nodes[i].start];
    return [nodes[0].node, 0];
  };
  const range = document.createRange();
  range.setStart(...locate(raw[at]));
  range.setEnd(...locate(raw[Math.min(at + needle.length - 1, raw.length - 1)] + 1));
  return range;
}

function elementOf(node) {
  return node?.nodeType === 1 ? node : node?.parentElement ?? null;
}

// Notes go after the whole list, table or callout a sentence is in.
function hostOf(block) {
  const host = block.closest(HOSTS);
  if (host?.matches('p') && host.closest('.tn-callout')) return host.closest('.tn-callout');
  if (host?.matches('ul, ol') || host?.matches('p, h3')) return host;
  return block.closest('.tn-table') ?? host ?? block;
}
