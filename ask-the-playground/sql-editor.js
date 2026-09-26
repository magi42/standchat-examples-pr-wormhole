// A light SQL editor: a transparent textarea over highlighted code, with line
// numbers, indentation, comment toggling and ⌘/Ctrl+Enter to run. Edits go
// through the browser's own text insertion, so undo keeps working.

import { highlight } from './sql.js';

const LINE = 20; // px, matches .ed-hl and .ed-input
const PAD = 12;

export class SqlEditor extends EventTarget {
  #escaped = false; // Esc was pressed: the next Tab leaves the editor

  constructor(host, { value = '', label = 'SQL query' } = {}) {
    super();
    host.textContent = '';
    this.gutter = document.createElement('div');
    this.gutter.className = 'ed-gutter';
    this.gutter.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = 'ed-body';
    this.line = document.createElement('div');
    this.line.className = 'ed-line';
    this.hl = document.createElement('pre');
    this.hl.className = 'ed-hl';
    this.hl.setAttribute('aria-hidden', 'true');
    this.input = document.createElement('textarea');
    this.input.className = 'ed-input';
    this.input.setAttribute('aria-label', label);
    this.input.setAttribute('aria-describedby', 'ed-help');
    this.input.setAttribute('wrap', 'off');
    for (const attr of ['spellcheck', 'autocorrect', 'autocapitalize', 'autocomplete']) {
      this.input.setAttribute(attr, attr === 'spellcheck' ? 'false' : 'off');
    }
    const help = document.createElement('span');
    help.id = 'ed-help';
    help.className = 'sr-only';
    help.textContent = 'Press Command or Control plus Enter to run. Tab indents; press Escape, then Tab, to leave the editor.';
    body.append(this.line, this.hl, this.input);
    host.append(this.gutter, body, help);

    this.input.value = value;
    this.input.addEventListener('input', () => {
      this.#render();
      this.dispatchEvent(new Event('input'));
    });
    this.input.addEventListener('scroll', () => this.#sync());
    this.input.addEventListener('keydown', (event) => this.#key(event));
    this.input.addEventListener('focus', () => this.#caret());
    this.input.addEventListener('blur', () => { this.line.hidden = true; });
    for (const type of ['keyup', 'pointerup', 'select']) this.input.addEventListener(type, () => this.#caret());
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === this.input) this.#caret();
    });
    this.line.hidden = true;
    this.#render();
  }

  get value() {
    return this.input.value;
  }

  /** Replaces the text (a snippet, an answer): starts a fresh undo history. */
  set value(text) {
    this.input.value = text;
    this.input.setSelectionRange(0, 0);
    this.input.scrollTop = 0;
    this.input.scrollLeft = 0;
    this.markError(0);
    this.#render();
  }

  /** The selected text, when the selection covers more than whitespace. */
  get selection() {
    const { selectionStart: a, selectionEnd: b, value } = this.input;
    const text = value.slice(a, b);
    return text.trim() ? text : '';
  }

  focus() {
    this.input.focus({ preventScroll: true });
  }

  /** Marks a 1-based line as the error's line; 0 clears it. */
  markError(line) {
    this.errorLine = line;
    this.#gutter();
  }

  #render() {
    this.hl.innerHTML = `${highlight(this.input.value)}\n`;
    this.#gutter();
    this.#sync();
  }

  #gutter() {
    const count = this.input.value.split('\n').length;
    const current = this.#currentLine();
    let html = '';
    for (let i = 1; i <= count; i++) {
      const cls = i === this.errorLine ? 'is-error' : i === current && document.activeElement === this.input ? 'is-current' : '';
      html += `<span${cls ? ` class="${cls}"` : ''}>${i}</span>`;
    }
    this.gutter.innerHTML = `<div class="ed-gutter-in" style="padding-top:${PAD}px">${html}</div>`;
    this.#sync();
  }

  #currentLine() {
    return this.input.value.slice(0, this.input.selectionStart).split('\n').length;
  }

  #caret() {
    const line = this.#currentLine();
    const collapsed = this.input.selectionStart === this.input.selectionEnd;
    this.line.hidden = !collapsed || document.activeElement !== this.input;
    this.line.style.top = `${PAD + (line - 1) * LINE - this.input.scrollTop}px`;
    for (const span of this.gutter.querySelectorAll('span')) {
      span.classList.toggle('is-current', Number(span.textContent) === line && document.activeElement === this.input);
    }
  }

  #sync() {
    const { scrollTop: top, scrollLeft: left } = this.input;
    this.hl.style.transform = `translate(${-left}px, ${-top}px)`;
    const inner = this.gutter.firstElementChild;
    if (inner) inner.style.transform = `translateY(${-top}px)`;
    if (!this.line.hidden) this.#caret();
  }

  #key(event) {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      this.dispatchEvent(new Event('run'));
      return;
    }
    if (event.key === 'Escape') {
      this.#escaped = true;
      return;
    }
    if (event.key === 'Tab' && !this.#escaped && !mod && !event.altKey) {
      event.preventDefault();
      this.#indent(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key !== 'Shift') this.#escaped = false;
    if (mod && event.key === '/') {
      event.preventDefault();
      this.#toggleComment();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing) {
      const { value, selectionStart } = this.input;
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const indent = value.slice(lineStart, selectionStart).match(/^[ \t]*/)[0];
      const extra = /\(\s*$/.test(value.slice(lineStart, selectionStart)) ? '  ' : '';
      if (indent || extra) {
        event.preventDefault();
        this.#insert(`\n${indent}${extra}`);
      }
    }
  }

  // Inserts text at the selection through the browser, so undo keeps working.
  #insert(text) {
    this.input.focus();
    if (!document.execCommand?.('insertText', false, text)) {
      this.input.setRangeText(text, this.input.selectionStart, this.input.selectionEnd, 'end');
      this.input.dispatchEvent(new Event('input'));
    }
  }

  // The full lines the selection touches.
  #lines() {
    const { value, selectionStart: a, selectionEnd: b } = this.input;
    const start = value.lastIndexOf('\n', a - 1) + 1;
    let end = value.indexOf('\n', b > a && value[b - 1] === '\n' ? b - 1 : b);
    if (end === -1) end = value.length;
    return { start, end, text: value.slice(start, end), a, b };
  }

  #replaceLines(transform) {
    const { start, end, text, a, b } = this.#lines();
    const lines = text.split('\n');
    const next = lines.map(transform).join('\n');
    this.input.setSelectionRange(start, end);
    this.#insert(next);
    const delta = next.length - text.length;
    if (a === b) {
      const shift = next.split('\n')[0].length - lines[0].length;
      this.input.setSelectionRange(Math.max(start, a + shift), Math.max(start, a + shift));
    } else {
      this.input.setSelectionRange(start, end + delta);
    }
    this.#caret();
  }

  #indent(direction) {
    const { a, b, text } = this.#lines();
    if (direction > 0 && a === b) return this.#insert('  ');
    if (direction > 0 && !text.includes('\n') && this.input.value.slice(a, b) !== text) return this.#insert('  ');
    this.#replaceLines((line) => (direction > 0 ? `  ${line}` : line.replace(/^( {1,2}|\t)/, '')));
  }

  #toggleComment() {
    const { text } = this.#lines();
    const lines = text.split('\n').filter((l) => l.trim());
    const commented = lines.length && lines.every((l) => /^\s*--/.test(l));
    this.#replaceLines((line) => {
      if (!line.trim()) return line;
      return commented ? line.replace(/^(\s*)-- ?/, '$1') : line.replace(/^(\s*)/, '$1-- ');
    });
  }
}
