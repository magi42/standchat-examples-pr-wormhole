// Phones and tablets: instead of a side panel, each sub-step gets a small code
// block with just its lines, in the current language. "⋯ N lines" rows unfold
// what's between, and "All N lines" shows the whole file. A line with a thread
// on it always shows, in the block nearest to it.

import { CodeLines } from './code-view.js';
import { el } from './dom.js';

const FILE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.3h3.5"/></svg>';

export class StepBlocks {
  /** { subs, focusLines(sub), onAsk(file, n), describe(file, n), onChange() } */
  constructor(options) {
    this.options = options;
    this.list = [];
    this.expanded = new Set(); // sub-steps showing their whole file
    this.gaps = new Map(); // sub-step id → [from, to] ranges the visitor unfolded
  }

  build() {
    const { subs, onAsk, describe, onChange } = this.options;
    this.list = subs.map((sub) => {
      const root = el('div', 'cb');
      root.innerHTML = `<div class="cb-head"><span class="cb-name">${FILE_ICON}<span></span></span><span class="cb-range"></span><button class="link-btn cb-toggle" type="button"></button></div><div class="cb-body"></div>`;
      const lines = new CodeLines(root.querySelector('.cb-body'), {
        onAsk: (n) => onAsk(sub.file, n),
        describe: (n) => describe(sub.file, n),
      });
      root.querySelector('.cb-toggle').addEventListener('click', () => {
        if (this.expanded.has(sub.id)) this.expanded.delete(sub.id);
        else this.expanded.add(sub.id);
        onChange();
      });
      const label = sub.el.querySelector('.tn-side');
      if (label) label.before(root);
      else sub.el.append(root);
      return { sub, root, lines, key: '', shown: undefined };
    });
  }

  drop() {
    for (const block of this.list) block.root.remove();
    this.list = [];
  }

  /** Unfolds lines in a block, then redraws. */
  unfold(block, from, to) {
    const list = this.gaps.get(block.sub.id) ?? [];
    list.push([from, to]);
    this.gaps.set(block.sub.id, list);
    this.options.onChange();
  }

  /** The block showing line n of a file; with unfold, the nearest one learns to show it. */
  blockFor(file, n, { unfold = false } = {}) {
    const showing = this.list.find((b) => b.sub.file === file && (b.shown === null || b.shown?.has(n)));
    if (showing || !unfold) return showing ?? null;
    const nearest = this.nearest(file, n);
    if (nearest) this.unfold(nearest, n, n);
    return nearest;
  }

  rowFor(file, n) {
    return this.list.find((b) => b.sub.file === file && b.lines.rows.has(n))?.lines.rows.get(n) ?? null;
  }

  nearest(file, n) {
    let best = null;
    let distance = Infinity;
    for (const b of this.list) {
      if (b.sub.file !== file) continue;
      for (const f of this.options.focusLines(b.sub)) {
        if (Math.abs(f - n) < distance) {
          distance = Math.abs(f - n);
          best = b;
        }
      }
    }
    return best;
  }

  /**
   * Draws every block for the language, making room for items: [{ file, n }].
   * Sets item.block to the block each item belongs in.
   */
  draw(items, { catalog, lang }) {
    const { focusLines } = this.options;
    const extras = new Map(this.list.map((b) => [b, new Set()]));
    for (const item of items) {
      const home = this.list.find((b) => b.sub.file === item.file && (this.expanded.has(b.sub.id) || focusLines(b.sub).includes(item.n)));
      item.block = home ?? this.nearest(item.file, item.n);
      extras.get(item.block)?.add(item.n);
    }
    for (const block of this.list) {
      const entry = catalog.file(block.sub.file, lang);
      const shown = this.#lines(block, entry, extras.get(block));
      block.shown = shown;
      const empty = shown && !shown.size;
      block.root.hidden = empty;
      const key = `${lang}|${shown ? [...shown].join(',') : 'all'}`;
      if (empty || block.key === key) continue;
      block.key = key;
      const where = block.sub.file === 'client' ? 'the browser' : catalog.langLabel(lang);
      block.lines.render(entry, {
        show: shown,
        label: `${entry.name}, ${where}. Tap a line to ask about it.`,
        onGap: (from, to) => this.unfold(block, from, to),
      });
      const numbers = shown ? [...shown] : entry.lines.map((l) => l.n);
      block.root.querySelector('.cb-name span').textContent = entry.name;
      block.root.querySelector('.cb-range').textContent = numbers.length ? `L${Math.min(...numbers)}–${Math.max(...numbers)}` : '';
      const toggle = block.root.querySelector('.cb-toggle');
      toggle.textContent = shown ? `All ${entry.lines.length} lines` : 'Fewer lines';
      toggle.setAttribute('aria-expanded', String(!shown));
    }
  }

  // A block's lines: its sub-step's, joined across small gaps, plus the extras.
  #lines(block, entry, extra) {
    if (this.expanded.has(block.sub.id)) return null;
    const set = new Set();
    const focus = this.options.focusLines(block.sub).sort((a, b) => a - b);
    focus.forEach((n, i) => {
      set.add(n);
      const next = focus[i + 1];
      if (next && next - n <= 3) for (let k = n + 1; k < next; k++) set.add(k);
    });
    for (const n of extra ?? []) set.add(n);
    for (const [from, to] of this.gaps.get(block.sub.id) ?? []) for (let k = from; k <= to; k++) set.add(k);
    // No blank lines at the edges.
    const sorted = [...set].filter((n) => entry.lines[n - 1]).sort((a, b) => a - b);
    while (sorted.length && !entry.lines[sorted[0] - 1].text.trim()) sorted.shift();
    while (sorted.length && !entry.lines[sorted.at(-1) - 1].text.trim()) sorted.pop();
    return new Set(sorted);
  }
}
