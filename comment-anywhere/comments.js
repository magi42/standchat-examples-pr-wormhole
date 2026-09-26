// Comment anywhere: the whole page is a canvas visitors can comment on.
//
// Press C, or pick the comment tool, and click anything: a pin drops with a
// composer. Every pin is a thread, and all threads share one Stand
// conversation (threads.js), so the team reads exactly where each question was
// asked. The team shows up as a cursor (presence.js) that flies to the pin,
// answers in the thread, and selects the part of the page it talks about.
//
// This file is presentation only. stand-visitor.js talks to Stand, threads.js
// turns its transcript into threads, anchors.js knows where things are.

import { buildThreads, cleanLabel, formatComment, parseComment, referencesIn, safeUrl, splitReferences, time } from './threads.js';
import { Anchors } from './anchors.js';
import { COLORS, Presence } from './presence.js';

const STORE = 'comment-anywhere:v1:ui'; // pins, read markers and resolved threads
const SEP = ' › ';
const narrow = matchMedia('(max-width: 640px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const ERRORS = {
  connect: 'Couldn’t reach the team. Check your connection and try again.',
  start: 'Your comment didn’t go through. Check who’s around, then post it again.',
  uncertain: 'We couldn’t confirm your first comment arrived. It may have started a conversation.',
  send: 'Not delivered.',
  lost: 'The conversation ended before your comment was confirmed.',
  gone: 'This conversation is no longer available.',
  paused: 'Lost the connection for now.',
  refresh: 'Reconnecting to check for replies…',
  end: 'Couldn’t end the conversation. Try again.',
  email: 'That email didn’t go through. Check it and try again.',
  offer: 'That follow-up offer has expired.',
};

const ICONS = {
  move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5v15.2l4.1-3.8 2.8 6.1 2.5-1.1-2.8-6H18z" fill="currentColor"/></svg>',
  comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V11.5A7.5 7.5 0 1 1 11.5 19H5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M11.5 8v7M8 11.5h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  comments: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V11.5A7.5 7.5 0 1 1 11.5 19H5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m8.2 12.3 2.6 2.5 5-5.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18V6.5M6.5 12 12 6.5l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  frame: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2v12M11 2v12M2 5h12M2 11h12" stroke="currentColor" stroke-width="1.4"/></svg>',
  you: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#14AE5C"/><circle cx="8.6" cy="10" r="1.5" fill="#fff"/><circle cx="15.4" cy="10" r="1.5" fill="#fff"/><path d="M8.2 14.2a4.4 4.4 0 0 0 7.6 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

/**
 * client: a stand-visitor.js client. root: the part of the page that takes comments.
 * prompt(label): the private prompt for a new conversation, given its first pin's label.
 * references: the names replies may point at as [[Name]] (elements with data-ref="Name").
 * Returns a function that removes the layer.
 */
export function mountComments({ client, root, prompt = () => '', references = [], analyticsId = 'comment-anywhere' }) {
  const layer = new CommentLayer(client, root, { prompt, references, analyticsId });
  return () => layer.destroy();
}

class CommentLayer {
  mode = 'move'; // move | comment
  openLabel = ''; // the thread (or new pin) that's open
  panelOpen = false;
  showResolved = false;
  drafts = new Map(); // label -> unsent text, per thread
  seenSeq = -1; // replies up to here have been announced
  seenPending = '';

  constructor(client, root, options) {
    this.client = client;
    this.root = root;
    this.options = options;
    this.anchors = new Anchors(root);
    const saved = load();
    this.pins = new Map(Object.entries(object(saved.pins)));
    this.read = object(saved.read);
    this.resolved = object(saved.resolved);

    this.#build();
    this.presence = new Presence({
      layer: this.canvas,
      root,
      avoid: () => this.#occupied(),
      bounds: () => this.#bounds(),
      onFollowChange: (on) => this.#renderFacepile(this.state, on),
    });

    this.state = client.getSnapshot();
    this.#restoreDraft(this.state);
    this.seenSeq = Math.max(-1, ...this.state.messages.map((m) => m.seq));
    this.seenPending = this.state.pending?.clientMessageId ?? '';
    if (!this.state.messages.length) this.toolbar.querySelector('[data-tool="comment"]').classList.add('is-inviting');
    this.unsubscribe = client.subscribe((state) => this.render(state));
    this.release = client.mount();
    this.render(this.state);

    this.clock = setInterval(() => this.#renderTimes(), 30000);
    document.fonts?.ready?.then(() => this.layout());
  }

  destroy() {
    this.unsubscribe();
    this.release();
    clearInterval(this.clock);
    this.resizer.disconnect();
    for (const el of [this.toolbar, this.canvas, this.float, this.panel, this.live, this.sheetBackdrop]) el.remove();
  }

  // Building the pieces -------------------------------------------------------

  #build() {
    // The canvas layer: pins, the hover outline, cursors and selections, in page coordinates.
    this.canvas = el('div', 'mp-canvas');
    this.hover = el('div', 'mp-hover');
    this.hover.hidden = true;
    this.hover.innerHTML = '<span class="mp-hover-tag"></span><span class="mp-hover-add">Enter to comment</span>';
    this.canvas.append(this.hover);
    // Threads float above the page's sticky header.
    this.float = el('div', 'mp-float');
    this.sheetBackdrop = el('div', 'mp-backdrop');
    this.sheetBackdrop.hidden = true;
    this.sheetBackdrop.addEventListener('click', () => this.close());

    this.toolbar = el('div', 'mp-toolbar');
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Comment tools');
    this.toolbar.innerHTML = `
      <button type="button" class="mp-tool" data-tool="move" aria-label="Move" aria-keyshortcuts="V" aria-pressed="true">${ICONS.move}<span class="mp-tip" aria-hidden="true">Move <kbd>V</kbd></span></button>
      <button type="button" class="mp-tool" data-tool="comment" aria-label="Comment" aria-keyshortcuts="C" aria-pressed="false">${ICONS.comment}<span class="mp-tip" aria-hidden="true">Comment <kbd>C</kbd></span></button>
      <span class="mp-sep" aria-hidden="true"></span>
      <button type="button" class="mp-open-panel" aria-expanded="false" aria-controls="mp-panel">${ICONS.comments}<span class="mp-open-label">Comments</span><span class="mp-count">0</span><i class="mp-unread" hidden></i></button>`;
    this.toolbar.addEventListener('click', (e) => {
      const tool = e.target.closest('[data-tool]')?.dataset.tool;
      if (tool) this.setMode(tool === this.mode && tool === 'comment' ? 'move' : tool);
      if (e.target.closest('.mp-open-panel')) this.togglePanel();
    });

    this.panel = el('aside', 'mp-panel');
    this.panel.id = 'mp-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-labelledby', 'mp-panel-title');
    this.panel.innerHTML = `
      <header class="mp-panel-head">
        <h2 id="mp-panel-title" tabindex="-1">Comments</h2>
        <label class="mp-switch"><input type="checkbox"> Show resolved</label>
        <button type="button" class="mp-icon" data-act="close-panel" aria-label="Close comments">${ICONS.close}</button>
      </header>
      <div class="mp-panel-body">
        <div class="mp-panel-notes"></div>
        <ol class="mp-list"></ol>
        <div class="mp-empty"></div>
      </div>
      <footer class="mp-panel-foot"></footer>`;
    this.panel.querySelector('.mp-switch input').addEventListener('change', (e) => {
      this.showResolved = e.target.checked;
      this.render();
    });
    this.panel.addEventListener('click', (e) => this.#onPanelClick(e));

    this.live = el('div', 'mp-live');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('role', 'status');

    // Who's here: in the page's own slot if it has one, floating otherwise.
    this.facepile = document.querySelector('[data-facepile]');
    if (!this.facepile) {
      this.facepile = el('div', 'mp-facepile-float');
      document.body.append(this.facepile);
    }
    this.facepile.classList.add('mp-facepile');
    this.facepile.addEventListener('click', (e) => {
      if (e.target.closest('.mp-face-host')) this.presence.follow(!this.presence.following);
    });

    document.body.append(this.canvas, this.float, this.sheetBackdrop, this.panel, this.live);
    // Early in the tab order, like a skip link: the tools come before the page.
    this.root.before(this.toolbar);

    // Comment mode: hover highlights, a click drops a pin.
    this.root.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    this.root.addEventListener('pointerleave', () => this.mode === 'comment' && this.#highlight(null));
    this.root.addEventListener('click', (e) => this.#onClick(e), true);
    this.root.addEventListener('pointerdown', (e) => {
      if (this.mode === 'comment' && this.#commentable(e.target)) e.preventDefault();
    }, true);
    this.root.addEventListener('focusin', (e) => {
      if (this.mode === 'comment' && this.#commentable(e.target)) this.#highlightFocus(e.target);
    });
    document.addEventListener('keydown', (e) => this.#onKey(e));
    // A click elsewhere closes the open thread, as on a canvas.
    document.addEventListener('pointerdown', (e) => {
      if (!this.openLabel || narrow.matches || this.mode === 'comment' || e.target === document.documentElement) return;
      if (e.target.closest?.('.mp-thread, .mp-pin, .mp-panel, .mp-toolbar, .mp-facepile, .mp-edge, .mp-follow-tag')) return;
      this.close({ restore: false });
    });
    this.canvas.addEventListener('click', (e) => {
      const pin = e.target.closest('.mp-pin');
      if (pin) this.open(pin.dataset.label, { toggle: true });
    });

    // Pins, threads and selections follow the layout.
    const relayout = () => {
      cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = requestAnimationFrame(() => this.layout());
    };
    // The toolbar belongs to the page that takes comments: it steps aside below it.
    const away = () => {
      const r = this.root.getBoundingClientRect();
      this.toolbar.classList.toggle('is-away', r.bottom < innerHeight * 0.4);
    };
    addEventListener('scroll', () => requestAnimationFrame(away), { passive: true });
    this.resizer = new ResizeObserver(relayout);
    this.resizer.observe(this.root);
    addEventListener('resize', relayout);
    this.root.addEventListener('toggle', relayout, true);
    narrow.addEventListener?.('change', () => this.render());
  }

  // Rendering -----------------------------------------------------------------

  render(state = this.state) {
    this.state = state;
    this.#syncDraft(state);
    const model = buildThreads(state);
    this.model = model;
    this.#syncPins(model, state);
    this.#renderToolbar(model);
    this.#renderFacepile(state, this.presence.following);
    this.#renderThread(model, state);
    this.#renderPanel(model, state);
    this.#react(model, state);
    this.#renderLive();
  }

  layout() {
    for (const pin of this.canvas.querySelectorAll('.mp-pin')) this.#placePin(pin);
    this.#placeThread();
    this.presence.update();
    if (this.hoverTarget) this.#highlight(this.hoverTarget, this.hover.querySelector('.mp-hover-tag').textContent);
  }

  // Pins: one per thread, plus the one you're writing.
  #syncPins(model, state) {
    const threads = new Set(model.threads.map((t) => t.label));
    const draft = parseComment(state.draft)?.label;
    for (const label of threads) {
      if (!this.pins.has(label)) this.pins.set(label, { anchor: anchorPath(label) });
    }
    for (const label of [...this.pins.keys()]) {
      if (!threads.has(label) && label !== this.openLabel && label !== draft && !(this.drafts.get(label) ?? '').trim()) this.pins.delete(label);
    }
    this.#save();

    const existing = new Map([...this.canvas.querySelectorAll('.mp-pin')].map((p) => [p.dataset.label, p]));
    let n = 0;
    for (const [label] of this.pins) {
      n += 1;
      let pin = existing.get(label);
      existing.delete(label);
      if (!pin) {
        pin = el('button', 'mp-pin');
        pin.type = 'button';
        pin.dataset.label = label;
        pin.innerHTML = `<span class="mp-pin-av">${ICONS.you}</span><i class="mp-pin-dot"></i><span class="mp-pin-typing"><i></i><i></i><i></i></span>`;
        this.canvas.append(pin);
        if (!reduced.matches && this.ready) pin.classList.add('is-new');
      }
      const thread = model.byLabel.get(label);
      const unread = this.#unread(thread);
      const resolved = Boolean(this.resolved[label]) && !this.showResolved;
      const typing = model.current === label && Boolean(state.activity);
      pin.classList.toggle('is-open', label === this.openLabel);
      pin.classList.toggle('is-unread', unread);
      pin.classList.toggle('is-typing', typing);
      pin.classList.toggle('is-resolved', Boolean(this.resolved[label]));
      pin.classList.toggle('is-draft', !thread);
      pin.classList.toggle('is-ended', state.phase === 'ended');
      pin.hidden = resolved && label !== this.openLabel;
      pin.style.zIndex = label === this.openLabel ? 3 : unread ? 2 : 1;
      pin.setAttribute('aria-expanded', String(label === this.openLabel));
      const count = thread?.entries.length ?? 0;
      pin.setAttribute('aria-label', `Comment ${n} on ${label}${count ? `, ${count} ${count === 1 ? 'message' : 'messages'}` : ', not posted yet'}${unread ? ', new reply' : ''}${typing ? ', answer on its way' : ''}`);
      this.#placePin(pin);
    }
    for (const pin of existing.values()) pin.remove();
    this.ready = true;
  }

  #placePin(pin) {
    const point = this.#pinPoint(pin.dataset.label);
    pin.classList.toggle('is-lost', !point);
    if (point) pin.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)`;
  }

  #pinPoint(label) {
    const pin = this.pins.get(label);
    // A thread whose anchor isn't on this page (or this layout) waits at the first one.
    return pin ? this.anchors.point(pin) ?? this.anchors.point({ anchor: this.anchors.pathOf(this.anchors.all()[0]) }) : null;
  }

  #renderToolbar(model) {
    // Typing dots anywhere take the color of whoever answers.
    document.documentElement.style.setProperty('--mp-host', COLORS[this.state.host.kind === 'rep' ? 'rep' : 'standin']);
    for (const button of this.toolbar.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === this.mode));
    }
    const open = model.threads.filter((t) => !this.resolved[t.label]);
    const unread = model.threads.some((t) => this.#unread(t));
    const count = this.toolbar.querySelector('.mp-count');
    count.textContent = String(open.length);
    count.hidden = !open.length;
    this.toolbar.querySelector('.mp-unread').hidden = !unread;
    const button = this.toolbar.querySelector('.mp-open-panel');
    button.setAttribute('aria-expanded', String(this.panelOpen));
    button.setAttribute('aria-label', `Comments: ${open.length} open${unread ? ', new replies' : ''}`);
    this.toolbar.classList.toggle('is-hidden', narrow.matches && Boolean(this.openLabel || this.panelOpen));
  }

  #renderFacepile(state, following) {
    const host = state.host;
    const here = ['available', 'active'].includes(state.phase) && host.kind;
    const key = [state.phase, host.name, host.kind, host.avatar, following].join('|');
    if (key === this.faceKey) return;
    this.faceKey = key;
    this.facepile.replaceChildren();
    const you = el('span', 'mp-face mp-face-you');
    you.innerHTML = `${ICONS.you}<span class="mp-face-tip" aria-hidden="true">You</span>`;
    you.setAttribute('role', 'img');
    you.setAttribute('aria-label', 'You');
    if (here) {
      const ai = host.kind === 'standin';
      const face = el('button', `mp-face mp-face-host${following ? ' is-following' : ''}`);
      face.type = 'button';
      face.style.setProperty('--mp-c', COLORS[ai ? 'standin' : 'rep']);
      face.setAttribute('aria-pressed', String(Boolean(following)));
      face.setAttribute('aria-label', `${host.name || 'The team'}, ${ai ? 'AI Stand-in' : 'a person'}. ${following ? 'Stop following' : 'Follow their cursor'}`);
      face.append(avatar(host));
      if (ai) face.append(el('span', 'mp-face-ai', 'AI'));
      face.append(el('span', 'mp-face-tip', `${host.name || 'The team'} · ${ai ? 'AI Stand-in' : 'Person'}${following ? ' · Stop following' : ' · Click to follow'}`));
      face.lastChild.setAttribute('aria-hidden', 'true');
      this.facepile.append(you, face);
    } else {
      const empty = el('span', `mp-face mp-face-empty${state.phase === 'loading' ? ' is-loading' : ''}`);
      const text = state.phase === 'loading' ? 'Checking who’s here…' : state.phase === 'ended' ? 'The conversation has ended' : 'Nobody from the team is here right now';
      empty.setAttribute('role', 'img');
      empty.setAttribute('aria-label', text);
      empty.append(el('span', 'mp-face-tip', text));
      empty.lastChild.setAttribute('aria-hidden', 'true');
      this.facepile.append(you, empty);
    }
  }

  // The thread: a popover by its pin, or a bottom sheet on phones.
  #renderThread(model, state) {
    const label = this.openLabel;
    if (!label || !this.pins.has(label)) {
      if (this.thread) this.#closeThread();
      return;
    }
    if (!this.thread) this.#createThread();
    const t = this.thread;
    const thread = model.byLabel.get(label);
    const sheet = narrow.matches;
    t.el.classList.toggle('is-sheet', sheet);
    t.el.setAttribute('aria-modal', String(sheet));
    if (sheet && t.el.parentElement !== document.body) document.body.append(t.el);
    if (!sheet && t.el.parentElement !== this.float) this.float.append(t.el);
    this.#syncBackdrop();
    t.label.textContent = label;
    t.el.setAttribute('aria-label', `Comments on ${label}`);
    t.resolve.hidden = !thread;
    t.resolve.classList.toggle('is-on', Boolean(this.resolved[label]));
    t.resolve.setAttribute('aria-label', this.resolved[label] ? 'Reopen thread' : 'Resolve thread');
    t.resolve.setAttribute('aria-pressed', String(Boolean(this.resolved[label])));
    t.menu.querySelector('[data-act="end"]').hidden = state.phase !== 'active';

    // Messages, with the conversation-wide notices that came after the thread started.
    const items = [
      ...(thread?.entries ?? []).map((entry) => ({ seq: entry.seq, entry })),
      ...model.cards.filter((card) => thread && card.seq > thread.started).map((card) => ({ seq: card.seq, card })),
    ].sort((a, b) => a.seq - b.seq);
    const typing = model.current === label && state.activity;
    const signature = JSON.stringify([
      items.map((i) => i.entry ? [i.entry.key, i.entry.status] : i.card.key),
      typing ? [state.activity.kind, state.activity.preview] : 0,
      state.host.name, state.followupOffered, state.followupOffered && [state.busy, state.error],
    ]);
    if (signature !== t.signature) {
      t.signature = signature;
      const stick = t.body.scrollHeight - t.body.scrollTop - t.body.clientHeight < 40;
      const emailFocused = t.list.contains(document.activeElement) && document.activeElement.type === 'email';
      t.list.replaceChildren(...items.map((item) => (item.entry ? this.#message(item.entry, state) : this.#card(item.card, state))));
      if (typing) t.list.append(this.#typing(state));
      if (emailFocused) t.list.querySelector('input[type="email"]')?.focus({ preventScroll: true });
      t.body.hidden = !items.length && !typing;
      if (stick || !t.body.dataset.seen) t.body.scrollTop = t.body.scrollHeight;
      t.body.dataset.seen = '1';
    }

    // The composer, and why it can't post right now if it can't.
    const status = this.#composeStatus(model, state, label);
    t.alert.replaceChildren();
    t.alert.hidden = !status.message;
    t.alert.className = `mp-alert${status.tone ? ` is-${status.tone}` : ''}`;
    if (status.message) {
      t.alert.append(el('span', '', status.message));
      if (status.action) {
        const action = el('button', 'mp-alert-act', status.action.label);
        action.type = 'button';
        action.addEventListener('click', status.action.run);
        t.alert.append(action);
      }
    }
    const draft = this.drafts.get(label) ?? '';
    if (document.activeElement !== t.input && t.input.value !== draft) t.input.value = draft;
    t.input.placeholder = thread ? 'Reply' : 'Add a comment';
    t.input.setAttribute('aria-label', thread ? `Reply on ${label}` : `Comment on ${label}`);
    t.input.readOnly = status.locked;
    t.form.classList.toggle('is-locked', status.locked);
    t.send.disabled = !status.canPost || !t.input.value.trim();
    grow(t.input);
    t.notice.textContent = state.notice;
    t.notice.hidden = !state.notice;
    // Before the first comment in a thread: who will answer it, truthfully.
    const hint = !thread && status.canPost && state.host.name;
    t.hint.hidden = !hint;
    if (hint) {
      const av = el('span', 'mp-av');
      av.style.setProperty('--mp-c', COLORS[state.host.kind === 'rep' ? 'rep' : 'standin']);
      av.append(avatar(state.host));
      t.hint.replaceChildren(av, el('b', '', state.host.name));
      if (state.host.kind === 'standin') t.hint.append(el('span', 'mp-ai', 'AI'));
      t.hint.append(el('span', '', 'will reply in this thread'));
    }
    t.who.replaceChildren(...(['available', 'active', 'ended'].includes(state.phase) ? this.#identityLine(state) : []));
    t.who.hidden = !t.who.childElementCount;
    this.#placeThread();
    if (thread) this.#markRead(thread);
  }

  #createThread() {
    const root = el('section', 'mp-thread');
    root.setAttribute('role', 'dialog');
    root.innerHTML = `
      <header class="mp-thread-head">
        <span class="mp-thread-where">${ICONS.comments}<span class="mp-thread-label"></span></span>
        <button type="button" class="mp-icon" data-act="resolve">${ICONS.check}</button>
        <span class="mp-menu-wrap">
          <button type="button" class="mp-icon" data-act="more" aria-label="More" aria-haspopup="true" aria-expanded="false">${ICONS.more}</button>
          <span class="mp-menu" hidden>
            <button type="button" data-act="all">Show all comments</button>
            <button type="button" data-act="end">End conversation</button>
          </span>
        </span>
        <button type="button" class="mp-icon" data-act="close" aria-label="Close">${ICONS.close}</button>
      </header>
      <div class="mp-thread-body"><ol class="mp-msgs"></ol></div>
      <div class="mp-thread-foot">
        <p class="mp-alert" hidden></p>
        <p class="mp-hint" hidden></p>
        <form class="mp-composer">
          <span class="mp-composer-av">${ICONS.you}</span>
          <textarea rows="1" maxlength="1500" enterkeyhint="send"></textarea>
          <button type="submit" class="mp-send" aria-label="Post comment">${ICONS.send}</button>
        </form>
        <p class="mp-notice" hidden></p>
        <p class="mp-who"></p>
      </div>`;
    const t = {
      el: root,
      label: root.querySelector('.mp-thread-label'),
      resolve: root.querySelector('[data-act="resolve"]'),
      more: root.querySelector('[data-act="more"]'),
      menu: root.querySelector('.mp-menu'),
      body: root.querySelector('.mp-thread-body'),
      list: root.querySelector('.mp-msgs'),
      alert: root.querySelector('.mp-alert'),
      hint: root.querySelector('.mp-hint'),
      form: root.querySelector('.mp-composer'),
      input: root.querySelector('textarea'),
      send: root.querySelector('.mp-send'),
      notice: root.querySelector('.mp-notice'),
      who: root.querySelector('.mp-who'),
    };
    this.thread = t;
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.close();
      if (act === 'resolve') this.resolve(this.openLabel, !this.resolved[this.openLabel]);
      if (act === 'more') this.#toggleMenu();
      if (act === 'all') {
        this.#toggleMenu(false);
        if (narrow.matches) this.close({ restore: false }); // one sheet at a time
        this.togglePanel(true);
      }
      if (act === 'end') {
        this.#toggleMenu(false);
        void this.client.end();
      }
      const ref = e.target.closest('.mp-ref');
      if (ref) this.showReference(ref.dataset.ref);
    });
    t.input.addEventListener('input', () => {
      const text = t.input.value;
      this.drafts.set(this.openLabel, text);
      this.client.setDraft(text.trim() ? formatComment(this.openLabel, text) : '');
      if (this.state.phase === 'active') this.client.typing(Boolean(text.trim()));
      t.send.disabled = !this.#composeStatus(this.model, this.state, this.openLabel).canPost || !text.trim();
      grow(t.input);
      this.#placeThread();
    });
    t.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        t.form.requestSubmit();
      }
    });
    t.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.post(this.openLabel, t.input.value);
    });
    root.addEventListener('focusout', (e) => {
      if (!root.contains(e.relatedTarget)) this.#toggleMenu(false);
    });
  }

  #closeThread() {
    this.thread.el.remove();
    this.thread = null;
    this.#syncBackdrop();
  }

  // On phones, threads and the panel are sheets over a dimmed page.
  #syncBackdrop() {
    this.sheetBackdrop.hidden = !(narrow.matches && (this.panelOpen || this.thread));
  }

  #toggleMenu(open = this.thread?.menu.hidden) {
    if (!this.thread) return;
    this.thread.menu.hidden = !open;
    this.thread.more.setAttribute('aria-expanded', String(Boolean(open)));
    if (open) this.thread.menu.querySelector('button').focus();
  }

  // Next to its pin, on whichever side has room, inside the screen.
  #placeThread() {
    const t = this.thread;
    if (!t || narrow.matches) {
      if (t) t.el.style.transform = '';
      return;
    }
    const point = this.#pinPoint(this.openLabel);
    if (!point) return;
    const width = t.el.offsetWidth;
    const height = t.el.offsetHeight;
    const panel = this.panelOpen ? this.panel.getBoundingClientRect().left : innerWidth;
    const right = point.x - scrollX + 48;
    const side = right + width < panel - 12 ? 'right' : 'left';
    const x = side === 'right' ? point.x + 48 : Math.max(scrollX + 12, point.x - width - 14);
    const header = Math.max(0, this.root.querySelector('[data-comment-header]')?.getBoundingClientRect().bottom ?? 0);
    const min = scrollY + header + 12;
    const max = scrollY + innerHeight - height - 92;
    const y = Math.max(min, Math.min(point.y - 40, max));
    t.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    t.side = side;
  }

  #message(entry, state) {
    const li = el('li', `mp-msg mp-from-${entry.from}${entry.status ? ` is-${entry.status}` : ''}`);
    const av = el('span', 'mp-av');
    const name = this.#nameOf(entry.from, state);
    if (entry.from === 'visitor') av.innerHTML = ICONS.you;
    else {
      av.append(avatar(entry.from === state.host.kind ? state.host : { name }));
      av.style.setProperty('--mp-c', COLORS[entry.from === 'standin' ? 'standin' : 'rep']);
    }
    const main = el('div', 'mp-msg-main');
    const meta = el('p', 'mp-msg-meta');
    meta.append(el('b', '', name));
    if (entry.from === 'standin') meta.append(el('span', 'mp-ai', 'AI'));
    if (entry.status === 'sending') meta.append(el('span', 'mp-msg-status', 'Sending…'));
    else if (entry.status === 'failed') {
      meta.append(el('span', 'mp-msg-status is-error', 'Not delivered'));
      if (state.phase === 'active') {
        const retry = el('button', 'mp-retry', 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', () => void this.client.send());
        meta.append(retry);
      }
    } else {
      const at = el('time', 'mp-time', ago(entry.sentAt));
      at.dataset.at = entry.sentAt;
      at.dateTime = entry.sentAt;
      meta.append(at);
    }
    main.append(meta);
    if (entry.type === 'link') main.append(this.#linkCard(entry));
    else main.append(formatText(entry.text, this.options.references));
    li.append(av, main);
    return li;
  }

  // Who wrote it: the current responder as Stand names them, or whoever the
  // transcript's cards say answered earlier (the AI, before a handoff).
  #nameOf(from, state) {
    if (from === 'visitor') return 'You';
    if (from === state.host.kind && state.host.name) return state.host.name;
    return this.model.names[from] || (from === 'standin' ? 'AI Stand-in' : 'The team');
  }

  #linkCard(entry) {
    const a = el('a', 'mp-link-card');
    a.href = entry.link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(el('b', '', entry.link.title));
    if (entry.link.description) a.append(el('span', '', entry.link.description));
    a.append(el('small', '', new URL(entry.link.url).host));
    a.addEventListener('click', () => this.client.trackLinkClick(entry.messageId, entry.link.url));
    return a;
  }

  #card(card, state) {
    const li = el('li', `mp-sys is-${card.type}`);
    const text = {
      handoff: `${card.name || 'Someone from the team'}${card.title ? ` (${card.title})` : ''} joined the conversation.`,
      takeover: `${card.name || 'The AI Stand-in'} is answering again.`,
      offer: card.message || `${card.name || 'The team'} can follow up by email.`,
      confirmation: card.message || 'Thanks. The team will follow up by email.',
      end: 'The conversation ended.',
    }[card.type];
    li.append(el('p', '', text));
    if (card.type === 'handoff' && card.message) li.append(el('p', 'mp-sys-quote', card.message));
    // The latest offer, while it stands, comes with the form.
    const latest = this.model.cards.findLast((c) => c.type === 'offer');
    if (card.type === 'offer' && state.followupOffered && latest?.key === card.key) li.append(this.#emailForm(state));
    return li;
  }

  #emailForm(state) {
    const form = el('form', 'mp-email');
    const id = `mp-email-${Math.random().toString(36).slice(2, 8)}`;
    form.innerHTML = `<label for="${id}">Your email</label><span><input id="${id}" type="email" autocomplete="email" required placeholder="you@company.com"><button type="submit">Send</button></span>`;
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    input.value = this.email ?? '';
    input.addEventListener('input', () => (this.email = input.value));
    input.disabled = button.disabled = state.busy;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim()) void this.client.submitEmail(input.value);
    });
    if (state.error === 'email' || state.error === 'offer') form.append(el('p', 'mp-email-error', ERRORS[state.error]));
    return form;
  }

  #typing(state) {
    const li = el('li', 'mp-msg mp-typing');
    li.style.setProperty('--mp-c', COLORS[state.host.kind === 'rep' ? 'rep' : 'standin']);
    const av = el('span', 'mp-av');
    av.append(avatar(state.host));
    av.style.setProperty('--mp-c', COLORS[state.host.kind === 'rep' ? 'rep' : 'standin']);
    const main = el('div', 'mp-msg-main');
    const meta = el('p', 'mp-msg-meta');
    meta.append(el('b', '', state.host.name || 'The team'));
    if (state.host.kind === 'standin') meta.append(el('span', 'mp-ai', 'AI'));
    meta.append(el('span', 'mp-msg-status', 'is typing'));
    main.append(meta);
    if (state.activity.preview) main.append(formatText(state.activity.preview, this.options.references, 'mp-preview'));
    else main.append(el('span', 'mp-dots', '<i></i><i></i><i></i>', true));
    li.append(av, main);
    return li;
  }

  #identityLine(state) {
    const parts = [];
    const who = el('span', 'mp-who-text');
    who.textContent = state.host.kind === 'rep' ? 'Real conversation · a person, via Stand' : 'Real conversation · AI Stand-in via Stand';
    parts.push(who);
    const link = safeUrl(state.poweredByUrl);
    if (link) {
      const a = el('a', 'mp-powered', 'Powered by Stand');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', () => this.client.trackAttributionClick());
      parts.push(a);
    }
    return parts;
  }

  // Can this thread take a comment right now? If not, why, and what helps.
  #composeStatus(model, state, label) {
    const retry = { label: 'Try again', run: () => void this.client.retry() };
    const fresh = { label: 'Start a new conversation', run: () => this.#newConversation() };
    const blocked = (message, action, tone = 'info') => ({ canPost: false, locked: false, message, action, tone });
    switch (state.phase) {
      case 'loading':
        return blocked('Checking who’s around to answer…', null, 'quiet');
      case 'unavailable':
        if (state.error === 'connect' || state.error === 'start') return blocked(ERRORS[state.error], { label: 'Check again', run: () => void this.client.retry() }, 'error');
        return blocked('Nobody from the team can answer right now. Try again in a little while.', { label: 'Check again', run: () => void this.client.retry() });
      case 'uncertain':
        return { ...blocked(ERRORS.uncertain, fresh, 'error'), locked: true };
      case 'ended':
        return { ...blocked(state.error === 'gone' ? ERRORS.gone : state.error === 'lost' ? ERRORS.lost : 'This conversation has ended.', state.busy ? null : fresh), locked: true };
      default:
    }
    if (state.pending) {
      const here = model.waitingOn === label;
      if (!state.busy && here) return { canPost: false, locked: true, message: 'Your comment wasn’t delivered. Retry it above.', tone: 'error' };
      if (!here) return blocked(`Waiting for the answer on ${model.waitingOn}.`, { label: 'Show', run: () => this.open(model.waitingOn) });
      return { canPost: false, locked: false, message: '', tone: '' };
    }
    if (model.waitingOn && model.waitingOn !== label) {
      return blocked(`Waiting for the answer on ${model.waitingOn}. You can comment here once it’s in.`, { label: 'Show', run: () => this.open(model.waitingOn) });
    }
    if (state.error === 'paused') return { canPost: true, locked: false, message: ERRORS.paused, action: { label: 'Reconnect', run: retry.run }, tone: 'error' };
    if (state.error === 'refresh' || (state.phase === 'active' && state.connection !== 'online' && state.error === 'connect')) {
      return { canPost: true, locked: false, message: ERRORS.refresh, tone: 'quiet' };
    }
    if (state.error === 'end') return { canPost: true, locked: false, message: ERRORS.end, action: { label: 'End conversation', run: () => void this.client.end() }, tone: 'error' };
    return { canPost: true, locked: false, message: '', tone: '' };
  }

  #renderPanel(model, state) {
    if (!this.panelOpen) return;
    const list = this.panel.querySelector('.mp-list');
    const threads = model.threads.filter((t) => this.showResolved || !this.resolved[t.label]);
    list.replaceChildren(...threads.map((t) => this.#panelItem(t, state)));
    const empty = this.panel.querySelector('.mp-empty');
    empty.hidden = threads.length > 0;
    if (!threads.length) {
      empty.replaceChildren(
        el('span', 'mp-empty-art', `${ICONS.comment}`, true),
        el('p', '', model.threads.length ? 'All caught up. Resolved threads are hidden.' : 'No comments yet'),
        el('p', 'mp-empty-hint', narrow.matches ? 'Tap the comment tool, then tap anything on the page to ask about it.' : 'Press C, then click anything on the page to ask about it.'),
      );
    }

    // Conversation-wide notes: who's answering, handoffs, the email form, the end.
    const notes = this.panel.querySelector('.mp-panel-notes');
    notes.replaceChildren();
    const offer = model.cards.findLast((c) => c.type === 'offer');
    if (state.followupOffered && offer) notes.append(this.#card(offer, state));
    const status = this.#composeStatus(model, state, '');
    if (['unavailable', 'uncertain', 'ended'].includes(state.phase) || ['paused', 'end'].includes(state.error)) {
      const p = el('p', `mp-alert is-${status.tone || 'info'}`, status.message);
      if (status.action) {
        const b = el('button', 'mp-alert-act', status.action.label);
        b.type = 'button';
        b.addEventListener('click', status.action.run);
        p.append(b);
      }
      notes.append(p);
    }

    const foot = this.panel.querySelector('.mp-panel-foot');
    foot.replaceChildren();
    if (['available', 'active'].includes(state.phase) && state.host.name) {
      const who = el('p', 'mp-panel-host');
      const av = el('span', 'mp-av');
      av.style.setProperty('--mp-c', COLORS[state.host.kind === 'rep' ? 'rep' : 'standin']);
      av.append(avatar(state.host));
      who.append(av, el('span', '', `${state.host.name}`));
      if (state.host.kind === 'standin') who.append(el('span', 'mp-ai', 'AI'));
      who.append(el('span', 'mp-panel-role', state.host.kind === 'standin' ? 'answers as an AI Stand-in' : 'answers in person'));
      foot.append(who);
    }
    const row = el('p', 'mp-panel-row');
    if (state.phase === 'active') {
      const end = el('button', 'mp-end', 'End conversation');
      end.type = 'button';
      end.disabled = state.busy;
      end.addEventListener('click', () => void this.client.end());
      row.append(end);
    }
    row.append(...this.#identityLine(state).slice(1));
    foot.append(row);
    if (state.notice) foot.append(el('p', 'mp-notice', state.notice));
  }

  #panelItem(thread, state) {
    const li = el('li', 'mp-item');
    if (this.resolved[thread.label]) li.classList.add('is-resolved');
    const open = el('button', 'mp-item-open');
    open.type = 'button';
    open.dataset.label = thread.label;
    const last = thread.entries.at(-1);
    const unread = this.#unread(thread);
    const pin = el('span', 'mp-item-pin', ICONS.you, true);
    const main = el('span', 'mp-item-main');
    main.append(el('span', 'mp-item-where', thread.label));
    const lastLine = el('span', 'mp-item-last');
    const author = this.#nameOf(last.from, state);
    lastLine.append(el('b', '', `${author} `), document.createTextNode(plain(last.status === 'failed' ? `${last.text} (not delivered)` : last.text, this.options.references)));
    main.append(lastLine);
    const typing = this.model.current === thread.label && state.activity;
    const meta = el('span', 'mp-item-meta');
    if (typing) meta.append(el('span', 'mp-dots', '<i></i><i></i><i></i>', true));
    else if (last.sentAt) {
      const at = el('time', 'mp-time', ago(last.sentAt));
      at.dataset.at = last.sentAt;
      meta.append(at);
    }
    if (unread) meta.append(el('i', 'mp-item-dot'));
    open.append(pin, main, meta);
    open.setAttribute('aria-label', `${thread.label}. ${author}: ${plain(last.text, this.options.references)}${unread ? '. New reply' : ''}`);
    const resolve = el('button', 'mp-icon mp-item-resolve', ICONS.check, true);
    resolve.type = 'button';
    resolve.dataset.resolve = thread.label;
    resolve.setAttribute('aria-label', this.resolved[thread.label] ? `Reopen ${thread.label}` : `Resolve ${thread.label}`);
    resolve.setAttribute('aria-pressed', String(Boolean(this.resolved[thread.label])));
    li.append(open, resolve);
    return li;
  }

  #onPanelClick(e) {
    if (e.target.closest('[data-act="close-panel"]')) return this.togglePanel(false);
    const resolve = e.target.closest('[data-resolve]');
    if (resolve) return this.resolve(resolve.dataset.resolve, !this.resolved[resolve.dataset.resolve]);
    const open = e.target.closest('.mp-item-open');
    if (open) {
      if (narrow.matches) this.togglePanel(false, { restore: false });
      this.open(open.dataset.label, { reveal: true });
    }
  }

  // Reacting to the conversation: the cursor, announcements, unread markers.
  #react(model, state) {
    const here = ['available', 'active'].includes(state.phase) && state.host.kind;
    if (this.presence.setHost({ name: state.host.name, kind: here ? state.host.kind : null })) {
      // Someone's here. The first time, they say hello by selecting the element
      // marked data-comment-welcome (the tip in the hero), once the fonts have set.
      const hello = !this.welcomed && state.phase === 'available';
      this.welcomed = true;
      const waiting = model.waitingOn;
      void Promise.resolve(document.fonts?.ready).then(() => {
        const tip = hello && this.mode === 'move' && !this.openLabel ? this.#inView(this.root.querySelector('[data-comment-welcome]')) : null;
        return this.presence.enter(tip ? { select: tip, name: tip.dataset.layer } : {});
      }).then(() => {
        // Came in while an answer was due (a reload mid-reply): go wait by that pin,
        // unless the answer arrived meanwhile.
        if (waiting && this.model.waitingOn === waiting) void this.#visit(waiting);
      });
    }
    this.presence.think(Boolean(state.activity) && Boolean(model.current));

    // You posted: the cursor comes over to your pin and clicks it.
    const pendingKey = state.pending ? state.pending.clientMessageId || `creating:${state.pending.body}` : '';
    if (pendingKey && pendingKey !== this.seenPending && state.busy) {
      const label = parseComment(state.pending.body)?.label;
      if (label) void this.#visit(label);
    }
    this.seenPending = pendingKey;

    // New replies: announce them whole, mark them unread, and point at what they mention.
    const fresh = state.messages.filter((m) => m.seq > this.seenSeq);
    if (!fresh.length) return;
    this.seenSeq = Math.max(this.seenSeq, ...fresh.map((m) => m.seq));
    for (const card of model.cards.filter((c) => fresh.some((m) => m.messageId === c.key))) {
      if (card.type === 'handoff') {
        this.#announce(`${card.name || 'Someone from the team'} joined the conversation.`);
        if (card.thread) void this.#visit(card.thread);
      }
      if (card.type === 'offer') this.#announce('The team offered to follow up by email.');
      if (card.type === 'end') this.#announce('The conversation ended.');
    }
    for (const thread of model.threads) {
      const replies = thread.entries.filter((e) => e.from !== 'visitor' && fresh.some((m) => m.messageId === e.messageId));
      if (!replies.length) continue;
      for (const reply of replies) this.#announce(`${this.#nameOf(reply.from, state)} replied on ${thread.label}: ${plain(reply.text, this.options.references)}`);
      const refs = referencesIn(replies.map((r) => r.text).join(' '), this.options.references);
      const target = refs.map((name) => this.#referenceTarget(name)).find(Boolean);
      if (target) {
        // Point at it: in view, or just out of view with a pill at the edge.
        const delay = reduced.matches ? 0 : 700;
        setTimeout(() => void this.presence.select(target, target.dataset.layer || refs[0]), delay);
      } else {
        // Answered: it steps off the pin to a free spot nearby, so you can read.
        setTimeout(() => this.presence.relax(this.#pinPoint(thread.label)), reduced.matches ? 0 : 900);
      }
    }
  }

  async #visit(label) {
    const point = this.#pinPoint(label);
    if (!point) return;
    await this.presence.toPin(point);
    // Waiting for its answer: stay by the pin. Otherwise step aside to read along.
    if (this.model.waitingOn === label || this.state.activity) await this.#settle(label);
    else setTimeout(() => this.presence.relax(this.#pinPoint(label)), reduced.matches ? 0 : 1200);
  }

  // Waiting by the pin, clear of the open thread.
  async #settle(label) {
    const point = this.#pinPoint(label);
    if (!point) return;
    const side = this.thread && label === this.openLabel && !narrow.matches && this.thread.side === 'left' ? 'right' : 'left';
    await this.presence.park(point, side);
  }

  #renderLive() {
    if (!this.announcements?.length) return;
    this.live.textContent = this.announcements.join(' ');
    this.announcements = [];
  }

  #announce(text) {
    (this.announcements ??= []).push(text);
  }

  #renderTimes() {
    for (const time of document.querySelectorAll('.mp-time[data-at]')) time.textContent = ago(time.dataset.at);
  }

  // Actions -------------------------------------------------------------------

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const on = mode === 'comment';
    document.documentElement.classList.toggle('mp-commenting', on);
    for (const anchor of this.anchors.all()) {
      if (on && !anchor.hasAttribute('tabindex')) {
        anchor.setAttribute('tabindex', '0');
        anchor.dataset.mpTab = '';
      } else if (!on && 'mpTab' in anchor.dataset) {
        anchor.removeAttribute('tabindex');
        delete anchor.dataset.mpTab;
      }
    }
    if (on) {
      this.toolbar.querySelector('.is-inviting')?.classList.remove('is-inviting');
      this.presence.follow(false);
      this.#announce(narrow.matches
        ? 'Comment mode. Tap anything on the page to comment on it.'
        : 'Comment mode. Click anything on the page, or press Tab to move between parts of it and Enter to comment. Escape to stop.');
    } else {
      this.#highlight(null);
      this.#announce('Comment mode off.');
    }
    this.#renderToolbar(this.model);
    this.#renderLive();
  }

  /** Opens a thread (or the composer of a new pin). */
  open(label, { toggle = false, reveal = false, focus = true } = {}) {
    if (!label || !this.pins.has(label)) return;
    if (toggle && label === this.openLabel) return this.close();
    this.openLabel = label;
    this.#toggleMenu(false);
    if (reveal) this.#revealPin(label);
    this.render();
    requestAnimationFrame(() => this.presence.clear());
    if (focus && this.thread) {
      const target = this.thread.input.readOnly ? this.thread.el.querySelector('[data-act="close"]') : this.thread.input;
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
    if (narrow.matches) this.#revealPin(label, true);
  }

  close({ restore = true } = {}) {
    const label = this.openLabel;
    if (!label) return;
    this.openLabel = '';
    // An empty new pin goes away with its composer.
    if (!this.model.byLabel.has(label) && !(this.drafts.get(label) ?? '').trim()) {
      this.pins.delete(label);
      if (parseComment(this.state.draft)?.label === label) this.client.setDraft('');
    }
    this.render();
    if (restore) {
      const pin = this.canvas.querySelector(`.mp-pin[data-label="${CSS.escape(label)}"]`);
      (pin && !pin.hidden ? pin : this.toolbar.querySelector('[data-tool="comment"]')).focus({ preventScroll: true });
    }
  }

  togglePanel(open = !this.panelOpen, { restore = true } = {}) {
    this.panelOpen = open;
    this.panel.hidden = !open;
    this.panel.classList.toggle('is-sheet', narrow.matches);
    this.render();
    this.#syncBackdrop();
    this.#placeThread();
    if (open) this.presence.clear();
    if (open) this.panel.querySelector('h2').focus({ preventScroll: true });
    else if (restore) this.toolbar.querySelector('.mp-open-panel').focus({ preventScroll: true });
  }

  resolve(label, on) {
    if (on) this.resolved[label] = true;
    else delete this.resolved[label];
    this.#save();
    if (on && label === this.openLabel) {
      this.#announce(`Resolved ${label}.`);
      this.close();
    } else this.render();
  }

  async post(label, text) {
    const body = String(text).trim();
    const status = this.#composeStatus(this.model, this.state, label);
    if (!body || !status.canPost) return;
    const first = this.state.phase === 'available' && !this.state.messages.length;
    this.drafts.delete(label);
    if (this.thread) {
      this.thread.input.value = '';
      grow(this.thread.input);
    }
    this.client.setDraft('');
    this.resolve(label, false);
    this.setMode('move');
    await this.client.send(formatComment(label, body), first ? { prompt: this.options.prompt(label), analyticsId: this.options.analyticsId } : {});
  }

  /** A [[reference]] in a reply: scroll to it if needed, and let the cursor select it. */
  async showReference(name) {
    const target = this.#referenceTarget(name);
    if (!target) return;
    if (narrow.matches) this.close({ restore: false });
    const r = target.getBoundingClientRect();
    const header = this.root.querySelector('[data-comment-header]')?.getBoundingClientRect().bottom ?? 0;
    if (r.top < header + 8 || r.top > innerHeight * 0.55) {
      scrollTo({ top: r.top + scrollY - header - 24, behavior: reduced.matches ? 'instant' : 'smooth' });
      await scrolled();
    }
    await this.presence.select(target, target.dataset.layer || name);
  }

  #referenceTarget(name) {
    return [...this.root.querySelectorAll('[data-ref]')].find((node) => node.dataset.ref === name && node.getClientRects().length) ?? null;
  }

  #revealPin(label, aboveSheet = false) {
    const point = this.#pinPoint(label);
    if (!point) return;
    const y = point.y - scrollY;
    const bottom = aboveSheet ? innerHeight * 0.28 : innerHeight - 140;
    if (y < 90 || y > bottom) {
      scrollTo({ top: point.y - (aboveSheet ? innerHeight * 0.16 : innerHeight * 0.4), behavior: reduced.matches ? 'instant' : 'smooth' });
    }
  }

  async #newConversation() {
    const before = new Map(this.pins);
    this.pins.clear();
    this.read = {};
    this.resolved = {};
    this.drafts.clear();
    this.openLabel = '';
    this.#save();
    await this.client.newChat();
    const state = this.client.getSnapshot();
    this.#restoreDraft(state, before);
    this.lastDraft = state.draft;
    this.render();
    // Unsent text comes back in its thread, ready to review and post again.
    const draft = parseComment(state.draft);
    if (draft) this.open(draft.label, { reveal: true });
  }

  // The client keeps one draft: the comment being typed, or one that couldn't
  // be sent (a start that didn't go through). It goes back into its thread.
  #syncDraft(state) {
    if (state.draft === this.lastDraft) return;
    this.lastDraft = state.draft;
    const draft = parseComment(state.draft);
    // Typing echoes back unchanged; anything else is text the visitor should see again.
    if (!draft || (this.drafts.get(draft.label) ?? '') === draft.text) return;
    this.#restoreDraft(state);
    if (this.thread && this.openLabel === draft.label) this.thread.input.value = draft.text;
  }

  // An unsent comment saved by the client (a reload, or a start that didn't
  // go through) goes back into its thread's composer.
  #restoreDraft(state, pins = this.pins) {
    const draft = parseComment(state.draft);
    if (!draft) return;
    this.drafts.set(draft.label, draft.text);
    if (!this.pins.has(draft.label)) this.pins.set(draft.label, pins.get(draft.label) ?? { anchor: anchorPath(draft.label) });
  }

  // Comment mode input ----------------------------------------------------------

  #inView(node) {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const { top, bottom } = this.#bounds();
    return r.width && r.top > top && r.bottom < bottom + 40 ? node : null;
  }

  #commentable(target) {
    return this.root.contains(target) && !target.closest('[data-comment-header], [data-comment-ignore]') && Boolean(this.anchors.anchorOf(target));
  }

  #onPointerMove(e) {
    if (this.mode !== 'comment' || e.pointerType === 'touch') return;
    cancelAnimationFrame(this.hoverFrame);
    const { clientX: x, clientY: y } = e;
    this.hoverFrame = requestAnimationFrame(() => {
      const hit = document.elementFromPoint(x, y);
      const anchor = this.#commentable(hit) ? this.anchors.anchorOf(hit) : null;
      this.#highlight(anchor, anchor ? this.anchors.labelAt(x, y, anchor).label : '');
    });
  }

  #onClick(e) {
    if (this.mode !== 'comment' || !this.#commentable(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const anchor = this.anchors.anchorOf(e.target);
    if (e.detail === 0) {
      // A keyboard "click" (Enter on a link or button): comment on the focused element.
      this.#dropFor(e.target);
      return;
    }
    const { label } = this.anchors.labelAt(e.clientX, e.clientY, anchor);
    this.#drop(cleanLabel(label), this.anchors.pinAt(anchor, e.clientX, e.clientY));
    if (e.pointerType === 'touch' || narrow.matches) this.#flash(anchor);
  }

  #dropFor(target) {
    const { anchor, label } = this.anchors.labelFor(target);
    if (!anchor) return;
    this.#drop(cleanLabel(label), this.anchors.pinFor(anchor, target));
  }

  #drop(label, pin) {
    this.#highlight(null);
    if (!this.pins.has(label)) this.pins.set(label, pin);
    this.#save();
    this.open(label);
    this.#setLiveLabel(label);
  }

  #highlight(anchor, label = '') {
    this.hoverTarget = anchor;
    if (!anchor) {
      this.hover.hidden = true;
      return;
    }
    const r = anchor.getBoundingClientRect();
    const pad = 3; // a little air between the outline and what it outlines
    Object.assign(this.hover.style, {
      transform: `translate(${r.left + scrollX - pad}px, ${r.top + scrollY - pad}px)`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    this.hover.querySelector('.mp-hover-tag').textContent = label || this.anchors.pathOf(anchor);
    this.hover.hidden = false;
    this.#setLiveLabel(label || this.anchors.pathOf(anchor));
  }

  #highlightFocus(target) {
    const anchor = this.anchors.anchorOf(target);
    const { label } = this.anchors.labelFor(target);
    this.#highlight(anchor, label);
    this.hover.classList.add('is-focus');
    this.#announce(`${label}. Press Enter to comment.`);
    this.#renderLive();
    target.addEventListener('blur', () => this.hover.classList.remove('is-focus'), { once: true });
  }

  #flash(anchor) {
    this.#highlight(anchor, this.anchors.pathOf(anchor));
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.#highlight(null), 700);
  }

  // The explainer's live example of what the next comment will carry.
  #setLiveLabel(label) {
    for (const node of document.querySelectorAll('[data-live-label]')) node.textContent = `📍 ${cleanLabel(label)}: `;
  }

  #onKey(e) {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      if (this.thread && !this.thread.menu.hidden) return this.#toggleMenu(false), this.thread.more.focus();
      if (this.openLabel) return this.close();
      if (this.panelOpen) return this.togglePanel(false);
      if (this.mode === 'comment') return this.setMode('move');
      if (this.presence.following) return this.presence.follow(false);
      return;
    }
    if (this.mode === 'comment' && e.key === 'Enter' && !typing && this.#commentable(e.target) && !e.target.closest('a, button, summary')) {
      e.preventDefault();
      this.#dropFor(e.target);
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C') this.setMode('comment');
    else if (e.key === 'v' || e.key === 'V') this.setMode('move');
  }

  // Bookkeeping ---------------------------------------------------------------

  #unread(thread) {
    return Boolean(thread && thread.lastReplySeq > (this.read[thread.label] ?? -1) && thread.label !== this.openLabel);
  }

  #markRead(thread) {
    if ((this.read[thread.label] ?? -1) >= thread.lastReplySeq) return;
    this.read[thread.label] = thread.lastReplySeq;
    this.#save();
  }

  // The part of the screen where the page shows: under the sticky header, above
  // the toolbar, or above a bottom sheet on phones.
  #bounds() {
    const top = Math.max(0, this.root.querySelector('[data-comment-header]')?.getBoundingClientRect().bottom ?? 0);
    let bottom = innerHeight - 96;
    const sheet = narrow.matches ? (this.thread?.el.isConnected ? this.thread.el : this.panelOpen ? this.panel : null) : null;
    if (sheet) bottom = Math.min(bottom, sheet.getBoundingClientRect().top - 8);
    return { top, bottom };
  }

  #occupied() {
    const rects = [...this.canvas.querySelectorAll('.mp-pin:not([hidden])')].map((p) => inflate(p.getBoundingClientRect(), 16));
    if (this.thread && !narrow.matches) rects.push(inflate(this.thread.el.getBoundingClientRect(), 12));
    if (this.panelOpen) rects.push(this.panel.getBoundingClientRect());
    rects.push(inflate(this.toolbar.getBoundingClientRect(), 12));
    return rects;
  }

  #save() {
    const data = JSON.stringify({ pins: Object.fromEntries(this.pins), read: this.read, resolved: this.resolved });
    if (data !== this.saved) save((this.saved = data));
  }
}

// Helpers ---------------------------------------------------------------------

function el(tag, className, content, html = false) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node[html ? 'innerHTML' : 'textContent'] = content;
  return node;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function load() {
  try {
    return object(JSON.parse(sessionStorage.getItem(STORE) || '{}'));
  } catch {
    return {};
  }
}

function save(json) {
  try {
    sessionStorage.setItem(STORE, json);
  } catch {
    // Storage can be denied or full: pins then last as long as the page.
  }
}

/** The anchor part of a label: everything but a trailing quote. */
function anchorPath(label) {
  const parts = label.split(SEP);
  if (parts.length > 1 && parts.at(-1).startsWith('“')) parts.pop();
  return parts.join(SEP);
}

function avatar(host) {
  const src = safeUrl(host?.avatar);
  const initials = el('span', 'mp-initials', initialsOf(host?.name));
  if (!src) return initials;
  const img = el('img', 'mp-img');
  img.alt = '';
  img.src = src;
  img.addEventListener('error', () => img.replaceWith(initials), { once: true });
  return img;
}

function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join('') || 'AI').toUpperCase();
}

function ago(value) {
  const at = time(value);
  if (!at) return '';
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function plain(text, references) {
  return splitReferences(String(text), references).map((p) => p.text ?? p.ref).join('').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
}

// Replies are text: escaped by construction (DOM nodes, never HTML), with a
// tiny safe subset: paragraphs, line breaks, "- " lists, **bold**, `code`,
// http(s) links, and [[references]] to parts of the page as chips.
function formatText(text, references, className = 'mp-msg-text') {
  const box = el('div', className);
  for (const block of String(text).trim().split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (lines.length && lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
      const ul = el('ul');
      for (const line of lines) ul.append(inline(el('li'), line.replace(/^\s*[-*•]\s+/, ''), references));
      box.append(ul);
    } else {
      const p = el('p');
      lines.forEach((line, i) => {
        if (i) p.append(el('br'));
        inline(p, line, references);
      });
      box.append(p);
    }
  }
  return box;
}

function inline(parent, text, references) {
  for (const part of splitReferences(text, references)) {
    if (part.ref) {
      const chip = el('button', 'mp-ref');
      chip.type = 'button';
      chip.dataset.ref = part.ref;
      chip.innerHTML = ICONS.frame;
      chip.append(document.createTextNode(part.ref));
      chip.setAttribute('aria-label', `Show ${part.ref} on the page`);
      parent.append(chip);
      continue;
    }
    const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
    let last = 0;
    for (const m of part.text.matchAll(pattern)) {
      if (m.index > last) parent.append(document.createTextNode(part.text.slice(last, m.index)));
      if (m[1]) parent.append(el('strong', '', m[1]));
      else if (m[2]) parent.append(el('code', '', m[2]));
      else {
        const a = el('a', '', m[3]);
        a.href = safeUrl(m[3]) || '#';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        parent.append(a);
      }
      last = m.index + m[0].length;
    }
    if (last < part.text.length) parent.append(document.createTextNode(part.text.slice(last)));
  }
  return parent;
}

function grow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
}

function inflate(r, by) {
  return { left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by };
}

function scrolled() {
  return new Promise((done) => {
    const finish = () => {
      clearTimeout(timer);
      removeEventListener('scrollend', finish);
      done();
    };
    const timer = setTimeout(finish, 900);
    addEventListener('scrollend', finish, { once: true });
  });
}
