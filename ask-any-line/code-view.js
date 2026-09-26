// Draws code as rows you can ask about, with room between the rows for
// annotations. Knows nothing about Stand: app.js decides what goes where.
//
// One CodeLines draws the desktop panel's file. On phones, one per sub-step
// draws just that sub-step's lines, with "⋯" rows for the lines in between.

import { highlightLine } from './highlight.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class CodeLines {
  /**
   * @param {HTMLElement} el      where the rows go
   * @param {object} options      { onAsk(n), describe(n) → extra words for a line's label }
   */
  constructor(el, { onAsk, describe = () => '' }) {
    this.el = el;
    this.el.classList.add('code');
    this.onAsk = onAsk;
    this.describe = describe;
    this.rows = new Map(); // line number → row
    this.slots = new Map(); // line number → slot after that row
    this.current = 0; // the row that takes Tab (roving tabindex)
    this.entry = null;
    this.el.addEventListener('keydown', (e) => this.#key(e));
    this.el.addEventListener('click', (e) => this.#click(e));
    this.el.addEventListener('focusin', (e) => {
      const row = e.target.closest?.('.ln');
      if (row && this.rows.get(Number(row.dataset.n)) === row) this.#setCurrent(Number(row.dataset.n));
    });
  }

  /**
   * Draws a file. `show` limits it to some line numbers (phone blocks), with a
   * "⋯ N lines" row for each gap; `open` lists gaps already expanded.
   */
  render(entry, { show = null, onGap = null, label = '' } = {}) {
    this.entry = entry;
    const keep = new Map(this.slots); // slots survive a redraw; app.js re-places them
    this.el.replaceChildren();
    this.rows.clear();
    this.slots.clear();
    this.el.setAttribute('role', 'group');
    if (label) this.el.setAttribute('aria-label', label);
    let last = 0;
    for (const line of entry.lines) {
      if (show && !show.has(line.n)) continue;
      if (show && line.n > last + 1 && last) {
        const gap = document.createElement('button');
        gap.type = 'button';
        gap.className = 'cb-gap';
        const from = last + 1;
        const to = line.n - 1;
        gap.textContent = `⋯ ${to - from + 1} ${to === from ? 'line' : 'lines'}`;
        gap.setAttribute('aria-label', `Show lines ${from} to ${to}`);
        gap.addEventListener('click', () => onGap?.(from, to));
        this.el.append(gap);
      }
      last = line.n;
      this.el.append(this.#row(line, entry.lang));
    }
    for (const slot of keep.values()) slot.remove();
    const first = [...this.rows.keys()].find((n) => !this.rows.get(n).classList.contains('is-blank'));
    this.#setCurrent(this.rows.has(this.current) ? this.current : first ?? 0);
    return keep;
  }

  #row(line, lang) {
    const row = document.createElement('div');
    row.className = 'ln';
    row.dataset.n = line.n;
    if (line.id) row.dataset.id = line.id;
    const blank = !line.text.trim();
    // Indentation becomes padding, so a long line wraps under itself (a hanging
    // indent) instead of leaving its spaces alone on the first row.
    const lead = line.text.match(/^[\t ]*/)[0];
    const indent = lead.replace(/\t/g, '    ').length;
    row.innerHTML = `<span class="ln-gut"><span class="ln-add" aria-hidden="true">+</span><span class="ln-mark" hidden></span></span><span class="ln-no" aria-hidden="true">${line.n}</span><span class="ln-code" style="--indent: ${indent}">${highlightLine(line.text.slice(lead.length), lang) || ' '}</span>`;
    if (blank) {
      row.classList.add('is-blank');
      row.setAttribute('aria-hidden', 'true');
    } else {
      row.tabIndex = -1;
      row.setAttribute('role', 'button');
      this.#label(row, line);
    }
    this.rows.set(line.n, row);
    return row;
  }

  #label(row, line) {
    const extra = this.describe(line.n);
    row.setAttribute('aria-label', `Line ${line.n}: ${line.text.trim()}. ${extra || 'Press Enter to ask about this line.'}`);
  }

  /** Refreshes each line's label (after its threads change). */
  relabel() {
    if (!this.entry) return;
    for (const line of this.entry.lines) {
      const row = this.rows.get(line.n);
      if (row && !row.classList.contains('is-blank')) this.#label(row, line);
    }
  }

  #setCurrent(n) {
    if (!n || !this.rows.has(n)) return;
    this.rows.get(this.current)?.setAttribute('tabindex', '-1');
    this.current = n;
    this.rows.get(n).setAttribute('tabindex', '0');
  }

  focusLine(n) {
    if (!this.rows.has(n)) return;
    this.#setCurrent(n);
    this.rows.get(n).focus({ preventScroll: true });
    this.scrollToLine(n, { block: 'nearest' });
  }

  #key(e) {
    const row = e.target.closest?.('.ln');
    if (!row || e.target !== row) return;
    const n = Number(row.dataset.n);
    const order = [...this.rows.keys()].filter((k) => !this.rows.get(k).classList.contains('is-blank'));
    const at = order.indexOf(n);
    const go = (i) => {
      e.preventDefault();
      this.focusLine(order[Math.max(0, Math.min(order.length - 1, i))]);
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'PageDown') go(at + 10);
    else if (e.key === 'PageUp') go(at - 10);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(order.length - 1);
    else if (e.key === 'Enter' || e.key === ' ' || e.key === '?') {
      e.preventDefault();
      this.onAsk(n, { keyboard: true });
    }
  }

  #click(e) {
    const row = e.target.closest?.('.ln');
    if (!row || row.classList.contains('is-blank') || this.rows.get(Number(row.dataset.n)) !== row) return;
    // The + asks. On touch screens, so does a tap anywhere on the line.
    const touch = e.pointerType === 'touch' || matchMedia('(hover: none)').matches;
    if (e.target.closest('.ln-add') || e.target.closest('.ln-mark.is-button') || touch) {
      if (touch && getSelection()?.toString()) return;
      this.onAsk(Number(row.dataset.n), { keyboard: false });
    }
  }

  /** The slot after line n, for annotations. Created on demand. */
  slot(n) {
    if (this.slots.has(n)) return this.slots.get(n);
    const row = this.rows.get(n);
    if (!row) return null;
    const slot = document.createElement('div');
    slot.className = 'an-slot';
    slot.dataset.after = n;
    slot.innerHTML = '<div class="an-inner"></div>';
    row.after(slot);
    this.slots.set(n, slot);
    return slot;
  }

  /**
   * Puts elements after their lines: placements is Map<n, element[]>.
   * New slots open by pushing the code down; emptied ones close.
   */
  place(placements, { animate = true } = {}) {
    for (const [n, elements] of placements) {
      const fresh = !this.slots.has(n);
      const slot = this.slot(n);
      if (!slot) continue;
      const inner = slot.firstElementChild;
      const now = [...inner.children];
      if (now.length !== elements.length || now.some((el, i) => el !== elements[i])) inner.replaceChildren(...elements);
      if (fresh && animate && !reduced()) openSlot(slot);
    }
    for (const [n, slot] of this.slots) {
      if (placements.has(n)) continue;
      this.slots.delete(n);
      if (animate && !reduced() && slot.isConnected) closeSlot(slot);
      else slot.remove();
    }
  }

  setFocus(numbers) {
    const set = new Set(numbers);
    this.el.classList.toggle('has-focus', set.size > 0);
    for (const [n, row] of this.rows) row.classList.toggle('is-focus', set.has(n));
  }

  /** Gutter marks: Map<n, 'thread' | 'resolved' | 'tip'>. */
  setMarks(marks) {
    for (const [n, row] of this.rows) {
      const mark = row.querySelector('.ln-mark');
      const kind = marks.get(n);
      mark.hidden = !kind;
      mark.className = `ln-mark${kind === 'resolved' ? ' is-resolved is-button' : kind === 'tip' ? ' is-tip' : ''}`;
    }
  }

  flash(numbers) {
    for (const n of numbers) {
      const row = this.rows.get(n);
      if (!row) continue;
      row.classList.remove('is-flash');
      void row.offsetWidth; // restart the animation
      row.classList.add('is-flash');
      setTimeout(() => row.classList.remove('is-flash'), 1700);
    }
  }

  /** Scrolls the nearest scrolling box so line n shows. */
  scrollToLine(n, { block = 'center', smooth = true } = {}) {
    const row = this.rows.get(n);
    if (!row) return;
    const box = this.el.closest('.cp-body');
    if (!box) {
      row.scrollIntoView({ block, behavior: smooth && !reduced() ? 'smooth' : 'instant' });
      return;
    }
    const top = row.offsetTop - (block === 'start' ? 24 : block === 'center' ? box.clientHeight * 0.32 : 0);
    if (block === 'nearest') {
      const r = row.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (r.top >= b.top + 8 && r.bottom <= b.bottom - 8) return;
      box.scrollTo({ top: r.top < b.top ? row.offsetTop - 24 : row.offsetTop - box.clientHeight + 60, behavior: smooth && !reduced() ? 'smooth' : 'instant' });
      return;
    }
    box.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduced() ? 'smooth' : 'instant' });
  }
}

// Height from 0 to auto, by animating grid rows: the lines below slide down.
export function openSlot(slot) {
  slot.classList.add('is-entering');
  void slot.offsetHeight;
  slot.classList.add('is-open');
  slot.classList.remove('is-entering');
  slot.addEventListener('transitionend', () => slot.classList.remove('is-open'), { once: true });
}

export function closeSlot(slot) {
  slot.classList.add('is-open');
  void slot.offsetHeight;
  slot.classList.add('is-entering');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    slot.remove();
  };
  slot.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 450);
}

/** Measures elements, then (after the caller moves them) slides them from there. */
export function flip(elements) {
  if (reduced()) return () => {};
  const before = new Map(elements.filter((el) => el.isConnected).map((el) => [el, el.getBoundingClientRect().top]));
  return () => {
    for (const [el, top] of before) {
      if (!el.isConnected) continue;
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  };
}
