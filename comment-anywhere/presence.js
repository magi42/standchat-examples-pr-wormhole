// Who's here: the team's cursors on the page. No network, no conversation.
//
// Whoever answers in Stand shows up as a multiplayer cursor with a name tag:
// the AI Stand-in, or a person after a handoff. It idles near what you're
// reading without covering it, flies to a pin to answer it, and selects the
// part of the page a reply points at, with a design tool's selection box,
// handles and size badge. Click its face in the facepile to follow it.
//
// Etiquette: it never parks on text, pins or open threads, keeps its distance
// from your pointer, rests while the tab is hidden, and with reduced motion it
// doesn't glide or drift at all: it just appears where it's needed.

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Who answers, by color: white name tags on these pass WCAG AA.
export const COLORS = { standin: '#8B3DFF', rep: '#D93A16' };
const BUSY = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,a,button,summary,kbd,label,input,textarea,select,figure,img,video,blockquote,table';
const now = () => performance.now();

class Cursor {
  constructor(layer, kind) {
    this.kind = kind;
    this.x = -200;
    this.y = -200;
    this.flight = 0;
    this.el = document.createElement('div');
    this.el.className = 'mp-cursor';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.setProperty('--mp-c', COLORS[kind]);
    this.el.innerHTML = `
      <svg class="mp-cursor-arrow" viewBox="0 0 20 24" width="20" height="24"><path d="M2 1.5v18.8l5.1-4.8 3.4 7.5 3.2-1.4-3.4-7.4H17z"/></svg>
      <span class="mp-cursor-tag"><span class="mp-cursor-name"></span><span class="mp-cursor-ai">AI</span><span class="mp-cursor-dots"><i></i><i></i><i></i></span></span>`;
    this.tag = this.el.querySelector('.mp-cursor-tag');
    layer.append(this.el);
  }

  setIdentity(name, ai) {
    this.el.querySelector('.mp-cursor-name').textContent = name || (ai ? 'AI Stand-in' : 'The team');
    this.el.querySelector('.mp-cursor-ai').hidden = !ai;
  }

  get visible() {
    return !this.el.hidden && !this.el.classList.contains('is-leaving');
  }

  /** The cursor and its name tag, as a box around the tip, for finding free space. */
  get size() {
    return { w: (this.tag.offsetWidth || 150) + 18, h: 48 };
  }

  place(x, y) {
    this.x = x;
    this.y = y;
    this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    // Near the right edge, the name tag goes to the left of the arrow.
    const flip = this.forceFlip ?? x - scrollX + this.size.w > document.documentElement.clientWidth - 8;
    this.el.classList.toggle('is-flipped', flip);
  }

  show() {
    clearTimeout(this.leaving);
    this.el.hidden = false;
    this.el.classList.remove('is-leaving');
  }

  leave() {
    if (this.el.hidden) return;
    this.el.classList.add('is-leaving');
    this.leaving = setTimeout(() => (this.el.hidden = true), 400);
  }

  /**
   * Flies along a gentle curve, fast off the mark and slow into place. Resolves
   * true on arrival, or false when another flight took over.
   */
  fly(x, y) {
    this.stop();
    this.el.classList.remove('is-parked');
    const from = { x: this.x, y: this.y };
    const dx = x - from.x;
    const dy = y - from.y;
    const distance = Math.hypot(dx, dy);
    if (reduced.matches || this.el.hidden || distance < 1) {
      this.place(x, y);
      return Promise.resolve(true);
    }
    // A hand doesn't move in straight lines: bend the path a little to one side.
    const bend = (Math.random() < 0.5 ? -1 : 1) * Math.min(140, distance * (0.1 + Math.random() * 0.12));
    const nx = -dy / distance;
    const ny = dx / distance;
    const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend };
    const c2 = { x: from.x + dx * 0.78 + nx * bend * 0.35, y: from.y + dy * 0.78 + ny * bend * 0.35 };
    const duration = Math.min(1350, 260 + 175 * Math.log2(1 + distance / 40));
    const start = now();
    return new Promise((done) => {
      this.cancel = () => {
        cancelAnimationFrame(this.flight);
        this.cancel = null;
        done(false);
      };
      const step = () => {
        const t = Math.min(1, (now() - start) / duration);
        const s = t * t * t * (10 - 15 * t + 6 * t * t); // minimum jerk
        const u = 1 - s;
        this.place(
          u * u * u * from.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s * s * s * x,
          u * u * u * from.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s * s * s * y,
        );
        if (t < 1) this.flight = requestAnimationFrame(step);
        else {
          this.cancel = null;
          done(true);
        }
      };
      this.flight = requestAnimationFrame(step);
    });
  }

  get flying() {
    return Boolean(this.cancel);
  }

  stop() {
    this.cancel?.();
  }

  press() {
    if (reduced.matches) return;
    this.el.classList.remove('is-pressing');
    void this.el.offsetWidth;
    this.el.classList.add('is-pressing');
  }

  think(on) {
    this.el.classList.toggle('is-thinking', on);
  }
}

// The selection a cursor makes: a frame name, a box with handles, and its size.
class Selection {
  constructor(layer) {
    this.el = document.createElement('div');
    this.el.className = 'mp-selection';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <span class="mp-sel-name"></span>
      <i class="mp-sel-h mp-sel-tl"></i><i class="mp-sel-h mp-sel-tr"></i><i class="mp-sel-h mp-sel-bl"></i><i class="mp-sel-h mp-sel-br"></i>
      <span class="mp-sel-size"></span>`;
    layer.append(this.el);
  }

  show(target, name) {
    this.target = target;
    this.el.querySelector('.mp-sel-name').textContent = name;
    this.update();
    this.el.hidden = false;
    this.el.classList.remove('is-in');
    void this.el.offsetWidth;
    this.el.classList.add('is-in');
  }

  update() {
    if (!this.target) return;
    const r = this.target.getBoundingClientRect();
    Object.assign(this.el.style, {
      transform: `translate(${r.left + scrollX}px, ${r.top + scrollY}px)`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    this.el.querySelector('.mp-sel-size').textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    this.el.classList.toggle('is-tall', r.height > innerHeight * 0.7);
  }

  hide() {
    this.target = null;
    this.el.hidden = true;
  }
}

export class Presence {
  /**
   * layer: an absolutely positioned element covering the document.
   * avoid(): extra screen rects to keep clear of (open threads, pins, toolbars).
   * bounds(): the part of the screen the page shows between the page's own
   * header and whatever covers its bottom (a toolbar, a bottom sheet).
   */
  constructor({ layer, root, avoid = () => [], bounds, onFollowChange = () => {} }) {
    this.root = root;
    this.avoid = avoid;
    this.bounds = bounds ?? (() => ({ top: this.#headerBottom(), bottom: innerHeight - 96 }));
    this.onFollowChange = onFollowChange;
    this.cursors = { standin: new Cursor(layer, 'standin'), rep: new Cursor(layer, 'rep') };
    this.selection = new Selection(layer);
    this.kind = null;
    this.name = '';
    this.pointer = { x: -1e4, y: -1e4 };
    this.busyUntil = 0; // a deliberate action (a pin, a selection) holds the idle loop off
    this.following = false;

    this.frame = document.createElement('div');
    this.frame.className = 'mp-follow';
    this.frame.hidden = true;
    this.frame.innerHTML = '<p class="mp-follow-tag"><span></span><button type="button">Stop</button></p>';
    this.frame.querySelector('button').addEventListener('click', () => this.follow(false));
    this.edge = document.createElement('button');
    this.edge.type = 'button';
    this.edge.className = 'mp-edge';
    this.edge.hidden = true;
    this.edge.addEventListener('click', () => this.follow(true));
    document.body.append(this.frame, this.edge);

    addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    }, { passive: true });
    addEventListener('scroll', () => this.#scrolled(), { passive: true });
    // Your own scrolling ends follow mode, like taking the wheel back.
    const takeOver = () => this.following && this.follow(false);
    addEventListener('wheel', takeOver, { passive: true });
    addEventListener('touchmove', takeOver, { passive: true });
    addEventListener('keydown', (e) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(e.key) && !e.target.closest?.('input, textarea')) takeOver();
    });
    document.addEventListener('visibilitychange', () => this.#schedule());
    reduced.addEventListener?.('change', () => this.#schedule());
  }

  get cursor() {
    return this.kind ? this.cursors[this.kind] : null;
  }

  /**
   * Who answers now, from Stand: kind is 'standin', 'rep' or null (nobody).
   * Returns true when someone new should come in: call enter() then.
   */
  setHost({ name, kind }) {
    const changed = kind !== this.kind;
    this.name = name;
    if (kind) this.cursors[kind].setIdentity(name, kind === 'standin');
    if (!changed) return false;
    const previous = this.cursor;
    this.kind = kind;
    this.edge.hidden = true;
    if (this.following && !kind) this.follow(false);
    if (previous) {
      // After a handoff the AI steps aside for a moment, then leaves the page.
      previous.think(false);
      setTimeout(() => previous.leave(), kind ? 2500 : 0);
      if (!kind) this.selection.hide();
    }
    return Boolean(kind);
  }

  /**
   * The cursor comes in from the side of the screen: to a free spot near what
   * you're reading, or to an element it selects to say hello (`select`).
   */
  async enter({ select, name } = {}) {
    const c = this.cursor;
    this.stepped = false;
    if (!c || c.visible) return;
    c.stop();
    const spot = select ? this.#grip(select) : this.#perch();
    if (!spot) {
      // No room to wait on this screen without covering something: come in later.
      this.stepped = true;
      return;
    }
    c.forceFlip = spot.inside || undefined;
    c.place(scrollX + innerWidth + 24, spot.y + (Math.random() - 0.5) * 120);
    c.show();
    const arrived = reduced.matches ? (c.place(spot.x, spot.y), true) : await c.fly(spot.x, spot.y);
    if (select && arrived && this.cursor === c && now() > this.busyUntil) {
      this.selection.show(select, name);
      c.press();
      this.#hold(6500);
      clearTimeout(this.clearing);
      this.clearing = setTimeout(() => this.selection.hide(), 6500);
    }
    this.#schedule();
  }

  /** Goes to a pin and clicks it: point is the pin's tip, in page coordinates. */
  async toPin(point) {
    const c = this.cursor;
    if (!c) return;
    this.#hold(12000);
    this.selection.hide();
    this.pointing = false;
    c.forceFlip = undefined;
    if (!c.visible) {
      c.place(point.x + 260, point.y - 80);
      c.show();
    }
    this.#follow(point.y);
    if (await c.fly(point.x + 24, point.y - 14)) c.press();
  }

  /**
   * Waits by a pin, clear of its thread (side: where the thread isn't). While it
   * waits for an answer, its name tag shrinks to just the typing dots.
   */
  async park(point, side = 'left') {
    const c = this.cursor;
    if (!c?.visible) return;
    this.#hold(12000);
    c.forceFlip = side === 'left';
    if (await c.fly(point.x + (side === 'left' ? -4 : 38), point.y + 6)) c.el.classList.add('is-parked');
  }

  /** Done at a pin: steps off to a free spot nearby, clear of text and threads. */
  async relax(point) {
    const c = this.cursor;
    if (!c?.visible || c.flying || this.following || this.pointing) return; // holding a selection
    const near = point ? { x: point.x - scrollX, y: point.y - scrollY } : { x: c.x - scrollX, y: c.y - scrollY };
    const spot = this.#perch(near, 360);
    if (!spot) return;
    this.#hold(4000);
    c.forceFlip = undefined;
    await c.fly(spot.x, spot.y);
  }

  /** Something opened over the page (a panel, a thread): step out from under it. */
  clear() {
    const c = this.cursor;
    if (!c?.visible || c.flying || this.following) return;
    const { w, h } = c.size;
    const box = { left: c.x - scrollX - 6, top: c.y - scrollY - 6, right: c.x - scrollX + w, bottom: c.y - scrollY + h };
    const covered = this.avoid().some((r) => r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top);
    if (covered) void this.#relocate();
  }

  think(on) {
    for (const c of Object.values(this.cursors)) c.think(on && c === this.cursor);
  }

  /** Selects an element like a designer would, and shows its name and size. */
  async select(el, frameName) {
    const c = this.cursor;
    if (!c || !el) return;
    this.#hold(14000);
    c.forceFlip = undefined;
    if (!c.visible) c.show();
    const { x, y, inside } = this.#grip(el);
    // At a top corner the name tag tucks inside the element, off its neighbors.
    c.forceFlip = inside || undefined;
    this.pointing = true;
    this.#follow(y);
    if (!(await c.fly(x, y)) || this.cursor !== c) return;
    this.selection.show(el, frameName);
    c.press();
    clearTimeout(this.clearing);
    this.clearing = setTimeout(() => {
      this.selection.hide();
      this.pointing = false;
      this.#edge();
    }, 9000);
    this.#edge();
  }

  /** Layout changed: keep the selection on its element. */
  update() {
    this.selection.update();
  }

  async follow(on) {
    const c = this.cursor;
    if (on && c && !c.visible) await this.enter();
    this.following = Boolean(on && c?.visible);
    this.frame.hidden = !this.following;
    this.frame.style.setProperty('--mp-c', COLORS[this.kind] ?? COLORS.standin);
    this.frame.querySelector('span').textContent = `Following ${this.name || 'the team'}`;
    this.onFollowChange(this.following);
    this.#edge();
    if (this.following) this.#reveal(c.y, true);
  }

  // Internals ---------------------------------------------------------------

  #hold(ms) {
    this.busyUntil = now() + ms;
    this.#schedule();
  }

  #follow(y) {
    if (this.following) this.#reveal(y, true);
  }

  #reveal(y, center) {
    const top = scrollY + 80;
    const bottom = scrollY + innerHeight - 120;
    if (!center && y > top && y < bottom) return;
    scrollTo({ top: Math.max(0, y - innerHeight * 0.4), behavior: reduced.matches ? 'instant' : 'smooth' });
  }

  #scrolled() {
    cancelAnimationFrame(this.edgeFrame);
    this.edgeFrame = requestAnimationFrame(() => this.#edge());
    clearTimeout(this.settle);
    // When you've scrolled on and it's out of sight, it comes along, once you stop.
    this.settle = setTimeout(() => {
      const c = this.cursor;
      if (this.stepped && c && !c.visible && this.#perch()) return void this.enter();
      if (!c?.visible || this.following || now() < this.busyUntil || this.#inView(c)) return;
      this.#relocate();
    }, 1200);
  }

  // Where to hold a selection: a corner you can see, clear of the toolbars.
  // inside: the name tag tucks into the element, off its neighbors.
  #grip(el) {
    const r = el.getBoundingClientRect();
    const view = this.bounds();
    const top = view.top + 16;
    const bottom = view.bottom - 24;
    const x = r.right + scrollX + 2;
    if (r.bottom < top || r.top > bottom) return { x, y: r.top + scrollY + 2, inside: true }; // out of sight: its top
    if (r.bottom <= bottom) return { x, y: r.bottom + scrollY + 2, inside: false }; // the bottom right corner
    if (r.height > 200 && r.top >= top) return { x, y: r.top + scrollY + 2, inside: true }; // tall: the top right
    // Otherwise the middle of its right edge, as much of it as shows.
    return { x, y: (Math.max(r.top, top) + Math.min(r.bottom, bottom)) / 2 + scrollY, inside: false };
  }

  #headerBottom() {
    return Math.max(0, this.root.querySelector('[data-comment-header]')?.getBoundingClientRect().bottom ?? 0);
  }

  // Comfortably on screen: not under the header or the toolbar.
  #inView(c) {
    const y = c.y - scrollY;
    const { top, bottom } = this.bounds();
    return y > top + 8 && y < bottom - 4 && c.x > scrollX && c.x < scrollX + innerWidth;
  }

  // A small pill at the edge of the screen while the cursor points at something out of sight.
  #edge() {
    const c = this.cursor;
    const y = c ? c.y - scrollY : 0;
    const out = y < 0 || y > innerHeight;
    const show = Boolean(c?.visible && this.pointing && !this.following && out);
    this.edge.hidden = !show;
    if (!show) return;
    const up = y < 0;
    this.edge.classList.toggle('is-up', up);
    this.edge.style.setProperty('--mp-c', COLORS[this.kind]);
    this.edge.style.left = `${Math.min(innerWidth - 120, Math.max(120, c.x - scrollX))}px`;
    this.edge.textContent = `${up ? '↑' : '↓'} ${this.name || 'The team'}`;
    this.edge.setAttribute('aria-label', `${this.name || 'The team'} is ${up ? 'above' : 'below'}. Follow their cursor`);
  }

  async #relocate() {
    const c = this.cursor;
    if (!c) return;
    const spot = this.#perch();
    if (!spot) {
      // Nowhere to wait without covering something (a small screen full of
      // text): step out of view, and come back when there's room or work.
      if (!this.pointing) {
        c.leave();
        this.stepped = true;
      }
      return;
    }
    this.pointing = false;
    c.forceFlip = undefined;
    await c.fly(spot.x, spot.y);
    this.#edge();
  }

  #schedule() {
    clearTimeout(this.timer);
    if (!this.cursor || document.hidden || reduced.matches) return;
    this.timer = setTimeout(() => this.#tick(), 2600 + Math.random() * 3600);
  }

  // Idling: mostly still, a small drift now and then, sometimes a new spot nearby.
  async #tick() {
    const c = this.cursor;
    this.#schedule();
    if (!c?.visible || c.flying || this.following || now() < this.busyUntil) return;
    if (!this.#inView(c)) return this.#relocate();
    const roll = Math.random();
    if (roll < 0.35) return; // a pause
    c.forceFlip = undefined;
    if (roll < 0.85) {
      const angle = Math.random() * Math.PI * 2;
      const step = 6 + Math.random() * 14;
      const x = c.x + Math.cos(angle) * step;
      const y = c.y + Math.sin(angle) * step;
      if (this.#free(x - scrollX, y - scrollY, c.size)) await c.fly(x, y);
      else await this.#relocate();
    } else {
      const spot = this.#perch({ x: c.x - scrollX, y: c.y - scrollY }, 320);
      if (spot) await c.fly(spot.x, spot.y);
    }
  }

  #busyRects() {
    const rects = [];
    for (const el of this.root.querySelectorAll(BUSY)) {
      if (el.closest('svg') || (el.closest('[aria-hidden="true"]') && el.tagName !== 'FIGURE')) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;
      rects.push(r);
    }
    const header = this.root.querySelector('[data-comment-header]')?.getBoundingClientRect();
    if (header && header.bottom > 0) rects.push(header);
    return [...rects, ...this.avoid()];
  }

  #free(x, y, size, busy = this.#busyRects(), bounds = this.bounds()) {
    const box = { left: x - 6, top: y - 6, right: x + size.w, bottom: y + size.h };
    if (box.left < 8 || box.right > document.documentElement.clientWidth - 8 || box.top < bounds.top + 8 || box.bottom > bounds.bottom) return false;
    if (Math.hypot(x - this.pointer.x, y - this.pointer.y) < 160) return false;
    return !busy.some((r) => r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top);
  }

  // A free spot on screen close to the content, preferably near `near`.
  #perch(near, within = Infinity) {
    const c = this.cursor;
    if (!c) return null;
    const size = c.size;
    const busy = this.#busyRects();
    // Only where the page that takes comments shows (not the page's other parts).
    const page = this.root.getBoundingClientRect();
    const view = this.bounds();
    const bounds = { top: Math.max(view.top, page.top), bottom: Math.min(view.bottom, page.bottom) };
    const width = document.documentElement.clientWidth;
    let best = null;
    for (let y = bounds.top + 16; y < bounds.bottom - size.h; y += 26) {
      for (let x = 16; x < width - size.w; x += 26) {
        if (!this.#free(x, y, size, busy, bounds)) continue;
        const box = { left: x, top: y, right: x + size.w, bottom: y + size.h };
        let gap = Infinity;
        for (const r of busy) {
          const dx = Math.max(r.left - box.right, box.left - r.right, 0);
          const dy = Math.max(r.top - box.bottom, box.top - r.bottom, 0);
          gap = Math.min(gap, Math.hypot(dx, dy));
        }
        const travel = near ? Math.hypot(x - near.x, y - near.y) : 0;
        if (travel > within) continue;
        // Close to the content, not lost in the margin; a little randomness.
        const score = -Math.abs(gap - 36) - travel * 0.05 - Math.abs(y - innerHeight * 0.45) * 0.04 + Math.random() * 24;
        if (!best || score > best.score) best = { x, y, score };
      }
    }
    return best && { x: best.x + scrollX, y: best.y + scrollY };
  }
}
