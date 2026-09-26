// The chat screen: a demo's text writer. It lays out the transcript's blocks
// in the pixel font and animates them in:
//
//   writer   replies stream in from the right like a scroller, bending along
//            the sine until each letter lands in its place
//   send     the visitor's own letters jump from the input line into the chat
//   fade     notices and labels settle in
//
// It also draws the header, the input line with its block cursor and the
// labels of the controls, and says where they are so the page can put real
// buttons on top of them.

import { CELL, LINE, BALL, wrap, graphemes } from './font.js';
import { PALETTE_INDEX as P } from './gl.js';
import { copperBar } from './effects.js';

const MAX_COLUMN = 364; // font pixels: about 64 characters
const INPUT_LINES = 4;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t) => 1 - (1 - t) ** 3;
const elastic = (t) => (t >= 1 ? 1 : 1 - Math.cos(t * Math.PI * 3.2) * Math.exp(-t * 6.5));

const PALETTE_OF = { copper: P.copper, ice: P.ice, dust: P.dust, alert: P.alert, link: P.link };

export class Screen {
  constructor(gfx, transcript, { reduced = () => false } = {}) {
    this.gfx = gfx;
    this.transcript = transcript;
    this.reduced = reduced;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.layouts = new Map(); // block id → { y, height, width, glyphs }
    this.scroll = 0; // device pixels of content above the view
    this.scrollTarget = 0;
    this.follow = true;
    this.links = []; // hit areas drawn this frame
    this.controls = []; // hit areas for the page's buttons
    this.input = { text: '', caret: 0, end: 0, born: new Map() };
    this.hovered = null;
  }

  get fp() {
    return this.gfx.px;
  }

  // -- Layout -------------------------------------------------------------------------

  // rect: the whole screen in device pixels; phone: a narrow screen.
  layout(rect, { phone = false } = {}) {
    const fp = this.fp;
    const snap = (v) => Math.round(v / fp) * fp;
    this.rect = rect;
    this.phone = phone;
    const margin = snap(phone ? 12 * fp : 28 * fp);
    const colW = snap(Math.min(rect.w - margin * 2, MAX_COLUMN * fp));
    const colX = snap(rect.x + (rect.w - colW) / 2);
    const bar = 6 * fp;
    const line = LINE * fp;
    const headerTop = rect.y + bar + 6 * fp;
    const headerBottom = headerTop + 2 * line + fp;
    const footerBottom = rect.y + rect.h - bar - 5 * fp;
    const footerTop = footerBottom - line;
    const inputBottom = footerTop - 7 * fp;
    this.col = { x: colX, w: colW };
    this.header = { top: headerTop, bottom: headerBottom, sep: headerBottom + 4 * fp };
    // The responder's glenz sits left of the title, across both header rows.
    this.icon = { x: colX + 10 * fp, y: headerTop + line - fp, r: 10 * fp };
    this.footer = { top: footerTop, bottom: footerBottom };
    this.inputBottom = inputBottom;
    this.#layoutInput();
    this.version = -1; // force block layout
  }

  #layoutInput() {
    if (!this.col) return; // not laid out yet
    const fp = this.fp;
    const line = LINE * fp;
    const prefix = this.#prefixWidth();
    const lines = this.#inputLines(this.col.w / fp - prefix);
    const shown = Math.min(INPUT_LINES, Math.max(1, lines.length));
    this.inputTop = this.inputBottom - shown * line;
    this.inputSep = this.inputTop - 5 * fp;
    this.view = { x: this.col.x - 4 * fp, y: this.header.sep + 4 * fp, w: this.col.w + 8 * fp, h: Math.max(line, this.inputSep - 4 * fp - (this.header.sep + 4 * fp)) };
  }

  // The prompt before the input, drawn in bold.
  #prefixWidth() {
    return this.#measure(this.input.mode === 'email' ? 'Email ' : '> ', true) + 1;
  }

  #measure(text, bold = false) {
    let w = 0;
    for (const ch of graphemes(text)) w += this.gfx.advance(ch, bold);
    return Math.max(0, w - 1);
  }

  #inputLines(width) {
    const text = this.input.text;
    return wrap([{ text: text || ' ' }], Math.max(20, width), (ch) => this.gfx.advance(ch));
  }

  // Wraps every block for the column; cheap enough to redo on each change.
  #layoutBlocks() {
    const t = this.transcript;
    if (this.version === t.version && this.layoutWidth === this.col.w) return;
    this.version = t.version;
    this.layoutWidth = this.col.w;
    const fp = this.fp;
    const colFont = this.col.w / fp;
    const measure = (ch) => this.gfx.advance(ch);
    let y = 0;
    let previous = null;
    const next = new Map();
    for (const block of t.blocks) {
      // Space between blocks, in font pixels: more where the speaker changes.
      const gap = !previous ? 0 : block.kind === 'label' ? 9 : block.kind === 'visitor' || previous.kind === 'visitor' ? 8 : block.kind === 'notice' || previous.kind === 'notice' ? 7 : 5;
      y += gap * fp;
      const width = block.kind === 'visitor' ? Math.floor(colFont * 0.82) : block.kind === 'link' ? colFont - 10 : colFont;
      const lines = wrap(block.runs, width, measure);
      const status = { failed: 'Not sent. Press Enter to try again.', unconfirmed: 'Not confirmed.' }[block.kind === 'visitor' && block.status];
      if (status) lines.push(...wrap([{ text: status, style: 'status' }], width, measure));
      const blockW = Math.max(...lines.map((l) => l.width));
      const inner = block.kind === 'link' ? 5 * fp : 0;
      const glyphs = [];
      let order = 0;
      lines.forEach((line, li) => {
        // Your own lines: a block on the right, its lines starting together.
        const offset = block.align === 'right' ? colFont - blockW : block.align === 'center' ? Math.floor((colFont - line.width) / 2) : 0;
        for (const g of line.glyphs) {
          if (g.ch === ' ') continue;
          glyphs.push({
            ch: g.ch,
            entry: this.gfx.glyph(g.ch, g.run.style === 'bright'),
            x: (offset + g.x) * fp + inner,
            y: li * LINE * fp + inner,
            style: g.run.style,
            link: g.run.link ?? null,
            index: g.index,
            order: order++,
            line: li,
            status: g.run.style === 'status',
          });
        }
      });
      const height = lines.length * LINE * fp + inner * 2 - (block.kind === 'label' ? 3 * fp : 0);
      const layout = { y, height, width: blockW * fp, glyphs, lines: lines.length };
      next.set(block.id, layout);
      y += height;
      previous = block;
    }
    this.layouts = next;
    this.contentHeight = y + (t.typing ? 16 * fp : 4 * fp);
  }

  // -- Scrolling ------------------------------------------------------------------------

  get maxScroll() {
    return Math.max(0, (this.contentHeight ?? 0) - this.view.h);
  }

  scrollBy(dy) {
    this.scrollTarget = clamp(this.scrollTarget + dy, 0, this.maxScroll);
    this.follow = this.scrollTarget >= this.maxScroll - 2;
  }

  page(direction) {
    this.scrollBy(direction * this.view.h * 0.85);
  }

  toEnd() {
    this.follow = true;
    this.scrollTarget = this.maxScroll;
  }

  // -- Input ------------------------------------------------------------------------------

  // caret and end are offsets in the text, as inputs count them (UTF-16).
  setInput(text, caret, end, mode = 'message', placeholder = '') {
    const input = this.input;
    const now = this.gfx.time;
    [caret, end] = [caret, end].map((offset) => characterAt(text, offset));
    if (text !== input.text) {
      // Newly typed letters pop in; edits elsewhere just appear.
      const before = graphemes(input.text);
      const after = graphemes(text);
      let same = 0;
      while (same < before.length && same < after.length && before[same] === after[same]) same++;
      const born = new Map();
      for (const [index, time] of input.born) if (index < same && now - time < 0.4) born.set(index, time);
      if (after.length > before.length) for (let i = same; i < after.length; i++) born.set(i, now);
      input.born = born;
    }
    const changed = input.text !== text || input.mode !== mode;
    input.text = text;
    input.caret = caret;
    input.end = end;
    input.mode = mode;
    input.placeholder = placeholder;
    input.typedAt = changed ? now : input.typedAt ?? 0;
    if (changed) this.#layoutInput();
  }

  // Where each typed letter is now, by grapheme index: the send animation.
  captureInput() {
    return this.inputGlyphs ? new Map(this.inputGlyphs) : null;
  }

  // -- Morph targets ------------------------------------------------------------------------

  // Where the letters of a block will be, for the scroller's letters to land.
  targets(block) {
    this.#layoutBlocks();
    this.#settleScroll(true);
    const layout = this.layouts.get(block.id);
    if (!layout) return [];
    const fp = this.fp;
    const top = this.view.y - this.scroll + layout.y;
    const palette = PALETTE_OF[block.palette] ?? P.copper;
    return layout.glyphs.map((g) => ({ index: g.index, order: g.order, x: this.col.x + g.x, y: top + g.y, size: fp, palette: g.link ? P.link : palette, entry: g.entry, ch: g.ch }));
  }

  #settleScroll(jump = false) {
    if (this.follow) this.scrollTarget = this.maxScroll;
    this.scrollTarget = clamp(this.scrollTarget, 0, this.maxScroll);
    if (jump) this.scroll = this.scrollTarget;
  }

  // -- Drawing --------------------------------------------------------------------------

  // Draws the screen's content, clipped to frame (the copper frame's inside).
  draw(now, dt, { frame, open, header, controls, focus, cursorOn, typing }) {
    const gfx = this.gfx;
    const fp = this.fp;
    this.#layoutBlocks();
    this.#settleScroll();
    this.scroll += (this.scrollTarget - this.scroll) * Math.min(1, dt * 14);
    if (Math.abs(this.scrollTarget - this.scroll) < 0.5) this.scroll = this.scrollTarget;

    const chrome = smooth(0.55, 1, open); // header, input and footer
    const reduced = this.reduced();
    gfx.clip(frame);

    // Header: the title, then who answers and how the line is.
    const line = LINE * fp;
    const hy = this.header.top;
    const indent = header.icon ? 26 * fp : 0;
    this.#text(header.title, this.col.x + indent, hy, P.copper, chrome, true);
    const sy = hy + line + fp;
    const ball = gfx.glyph(BALL);
    const pulse = header.live ? 0.75 + 0.25 * Math.sin(now * 5) : 1;
    const dot = header.dot === 'alert' ? P.alert : header.dot === 'ice' ? P.ice : header.dot === 'dust' ? P.dust : P.barGreen;
    gfx.glyphSprite(ball, this.col.x + indent, sy - fp, fp, dot, chrome * pulse, 0.5);
    // The longest status that fits: who, then who in short, then just the state.
    const room = this.col.w / fp - indent / fp - 8;
    const status = header.status.find((s) => this.#measure(s) <= room) ?? header.status.at(-1);
    this.#text(status, this.col.x + indent + 8 * fp, sy, P.dust, chrome * 0.95);
    gfx.rect(this.col.x, this.header.sep, this.col.w, fp, P.copper, chrome * 0.8, 0.62);

    // The controls: the page lays real buttons over these labels.
    this.controls = [];
    const footerY = this.footer.top;
    let fx = this.col.x;
    let rightX = this.col.x + this.col.w;
    for (const control of controls) {
      const w = this.#measure(control.label, control.id === 'close') * fp;
      let x;
      let y;
      if (control.id === 'close') {
        x = this.col.x + this.col.w - w;
        y = hy;
      } else if (control.align === 'right') {
        x = rightX - w;
        rightX = x - 12 * fp;
        y = footerY;
      } else {
        x = fx;
        fx += w + 12 * fp;
        y = footerY;
      }
      const hot = this.hovered === control.id || focus === control.id;
      const palette = control.id === 'close' ? P.copper : hot ? P.white : control.palette ?? P.dust;
      this.#text(control.label, x, y, palette, chrome, control.id === 'close');
      if (hot) gfx.rect(x, y + 10 * fp, w, fp, P.copper, chrome);
      this.controls.push({ id: control.id, x: x - 4 * fp, y: y - 3 * fp, w: w + 8 * fp, h: line + 3 * fp });
    }

    // The transcript.
    gfx.clip(intersect(frame, this.view));
    this.links = [];
    const view = this.view;
    const top = view.y - this.scroll;
    for (const block of this.transcript.blocks) {
      const layout = this.layouts.get(block.id);
      if (!layout) continue;
      const by = top + layout.y;
      if (by > view.y + view.h + 40 * fp || by + layout.height < view.y - 60 * fp) continue;
      this.#drawBlock(block, layout, this.col.x, by, now, open, reduced);
    }
    if (typing) this.#typing(this.col.x, top + (this.contentHeight - 16 * fp) + 6 * fp, now, open);

    // The input line.
    gfx.clip(frame);
    gfx.rect(this.col.x, this.inputSep, this.col.w, fp, P.copper, chrome * 0.8, 0.62);
    this.#drawInput(now, chrome, cursorOn);
    gfx.clip(null);
  }

  #text(text, x, y, palette, alpha, bold = false) {
    const gfx = this.gfx;
    const fp = this.fp;
    let cx = x;
    for (const ch of graphemes(text)) {
      const entry = gfx.glyph(ch, bold);
      gfx.glyphSprite(entry, cx + fp, y + fp, fp, P.shadow, alpha * 0.8);
      gfx.glyphSprite(entry, cx, y, fp, palette, alpha);
      cx += entry.advance * fp;
    }
    return cx - x;
  }

  #drawBlock(block, layout, x, y, now, open, reduced) {
    const gfx = this.gfx;
    const fp = this.fp;
    const age = now - block.born;
    const palette = PALETTE_OF[block.palette] ?? P.copper;
    let alpha = block.hidden ? 0 : 1;
    if (block.status === 'sending') alpha *= 0.6 + 0.2 * Math.sin(now * 4);
    const view = this.view;

    if (block.kind === 'link') {
      // A card: a copper frame around the link, drawn with the text.
      const w = layout.width + 10 * fp;
      const h = layout.height;
      const a = alpha * (block.reveal === 'instant' || reduced ? 1 : smooth(0, 0.3, age));
      copperBar(gfx, x, y, w, fp, P.bar, a);
      copperBar(gfx, x, y + h - fp, w, fp, P.bar, a);
      gfx.rect(x, y, fp, h, P.copper, a * 0.8, 0.6);
      gfx.rect(x + w - fp, y, fp, h, P.copper, a * 0.8, 0.6);
      gfx.rect(x + fp, y + fp, w - 2 * fp, h - 2 * fp, P.night, a * 0.6);
    }

    // The writer's stream: letters leave the right edge in reading order.
    const writer = block.reveal === 'writer' && !reduced;
    const count = layout.glyphs.length;
    const rate = clamp(count / 2.2, 36, 150);
    const advance = 7 * fp;
    const speed = rate * advance * 1.45;
    const startX = this.col.x + this.col.w + 26 * fp;

    for (const g of layout.glyphs) {
      let gx = x + g.x;
      let gy = y + g.y;
      let a = alpha;
      let pal = g.status ? P.alert : g.link ? P.link : g.style === 'dim' ? P.dust : palette;
      if (gy > view.y + view.h + 12 * fp || gy + CELL * fp < view.y - 12 * fp) continue;
      if (writer) {
        const emit = g.order / rate;
        const distance = Math.max(0, startX - gx);
        const land = emit + distance / speed;
        if (age < emit) continue;
        if (age < land) {
          const travelled = (age - emit) * speed;
          const left = distance - travelled;
          gx += left;
          const k = distance > 0 ? left / distance : 0;
          gy += Math.round((Math.sin(gx / (fp * 26) - now * 7) * 4.5 * fp * Math.min(1, k * 2.5)) / fp) * fp;
          a *= smooth(0, 30 * fp, travelled);
        } else if (age < land + 0.14) {
          pal = age < land + 0.07 ? P.white : pal; // a flash as it lands
        }
      } else if (block.reveal === 'send' && block.from?.has(g.index) && !reduced) {
        const from = block.from.get(g.index);
        const u = clamp((age - g.order * 0.008) / 0.42, 0, 1);
        const e = easeOut(u);
        gx = from.x + (gx - from.x) * e;
        gy = from.y + (gy - from.y) * e - Math.sin(e * Math.PI) * 10 * fp;
      } else if (block.reveal !== 'instant' && !reduced) {
        const u = clamp((age - g.line * 0.03) / 0.3, 0, 1);
        a *= u;
        gy += Math.round(((1 - elastic(u)) * 5 * fp) / fp) * fp;
      }
      // Letters fade at the top of the view as they scroll away.
      const fade = Math.min(14 * fp, this.scroll);
      const edge = gy - view.y;
      if (fade > fp && edge < fade) a *= clamp(edge / fade, 0, 1);
      if (a <= 0.01) continue;
      const hot = g.link && this.hovered === g.link;
      gfx.glyphSprite(g.entry, gx + fp, gy + fp, fp, P.shadow, a * 0.85);
      gfx.glyphSprite(g.entry, gx, gy, fp, hot ? P.white : pal, a);
      if (g.link) {
        gfx.rect(gx, gy + 9 * fp, g.entry.advance * fp, fp, hot ? P.white : P.link, a * 0.8, 0.7);
        this.links.push({ x: gx - fp, y: gy, w: (g.entry.advance + 1) * fp, h: LINE * fp, link: g.link });
      }
    }
  }

  // Three copper balls bouncing along a sine: someone is typing.
  #typing(x, y, now, open) {
    const gfx = this.gfx;
    const fp = this.fp;
    const ball = gfx.glyph(BALL);
    for (let i = 0; i < 3; i++) {
      const lift = Math.abs(Math.sin(now * 5.2 - i * 0.7)) * 4 * fp;
      const bx = x + i * 7 * fp;
      const by = y - Math.round(lift / fp) * fp - 5 * fp;
      gfx.glyphSprite(ball, bx + fp, by + fp, fp, P.shadow, open * 0.8);
      gfx.glyphSprite(ball, bx, by, fp, i === 1 ? P.ice : P.copper, open, -CELL);
    }
  }

  #drawInput(now, alpha, cursorOn) {
    const gfx = this.gfx;
    const fp = this.fp;
    const input = this.input;
    const line = LINE * fp;
    const prefix = input.mode === 'email' ? 'Email ' : '> ';
    const prefixW = this.#prefixWidth();
    this.#text(prefix, this.col.x, this.inputTop, input.mode === 'email' ? P.copper : P.dust, alpha, true);
    const x0 = this.col.x + prefixW * fp;
    const lines = this.#inputLines(this.col.w / fp - prefixW);
    // Keep the caret's line in view.
    let caretLine = lines.length - 1;
    lines.forEach((l, li) => {
      if (l.glyphs.some((g) => g.index === input.caret)) caretLine = li;
    });
    const first = clamp(caretLine - INPUT_LINES + 1, 0, Math.max(0, lines.length - INPUT_LINES));
    const glyphs = new Map();
    let caretX = x0;
    let caretY = this.inputTop;
    const selection = Math.min(input.caret, input.end) !== Math.max(input.caret, input.end);
    const [s0, s1] = [Math.min(input.caret, input.end), Math.max(input.caret, input.end)];
    lines.forEach((l, li) => {
      if (li < first || li >= first + INPUT_LINES) return;
      const ly = this.inputTop + (li - first) * line;
      for (const g of l.glyphs) {
        const gx = x0 + g.x * fp;
        if (g.index === input.caret) {
          caretX = gx;
          caretY = ly;
        }
        if (!input.text) continue;
        if (selection && g.index >= s0 && g.index < s1) gfx.rect(gx - fp, ly + fp, g.advance * fp, 10 * fp, P.ice, alpha * 0.35, 0.8);
        if (g.ch === ' ') continue;
        const entry = this.gfx.glyph(g.ch);
        const born = input.born.get(g.index);
        let y = ly;
        if (born !== undefined && !this.reduced()) {
          const u = clamp((now - born) / 0.22, 0, 1);
          y -= Math.round(((1 - elastic(u)) * 4 * fp) / fp) * fp;
        }
        glyphs.set(g.index, { x: gx, y: ly });
        gfx.glyphSprite(entry, gx + fp, y + fp, fp, P.shadow, alpha * 0.8);
        gfx.glyphSprite(entry, gx, y, fp, P.ice, alpha);
      }
      const end = l.glyphs.at(-1);
      if (end && input.caret === end.index + 1 && input.text) {
        caretX = x0 + (end.x + end.advance) * fp;
        caretY = ly;
      }
    });
    this.inputGlyphs = glyphs;
    if (!input.text) {
      caretX = x0;
      caretY = this.inputTop;
      if (input.placeholder) this.#text(input.placeholder, x0 + 8 * fp, this.inputTop, P.dust, alpha * 0.55);
    }
    // The block cursor: solid while typing, blinking when idle.
    const blink = now - (input.typedAt ?? 0) < 0.6 || Math.floor(now * 1.9) % 2 === 0;
    if (cursorOn && blink && !selection) gfx.rect(caretX, caretY + 2 * fp, 5 * fp, 8 * fp, P.ice, alpha, 0.35);
  }

  // The link under a point (device pixels), if any.
  linkAt(x, y) {
    return this.links.find((l) => x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h)?.link ?? null;
  }
}

// The grapheme index at a UTF-16 offset: 👋🏻 is four code units but one letter.
function characterAt(text, offset) {
  let units = 0;
  let index = 0;
  for (const ch of graphemes(text)) {
    if (units >= offset) break;
    units += ch.length;
    index++;
  }
  return index;
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}
