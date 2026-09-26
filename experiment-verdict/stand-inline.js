// <stand-inline>: the whole Stand conversation, right where the question comes up.
//
//   <script type="module" src="stand-inline.js"></script>
//   <stand-inline site="YOUR-SITE-ID" look="field" placeholder="Ask about this product"></stand-inline>
//
// Five looks set how present it is before anyone types: whisper, line, field,
// card and stage. Three growth modes set what happens once the conversation
// starts: unfold in place, follow the visitor as a dock, or lift into focus.
// It inherits the page's font and colors; --si-* custom properties and ::part()
// restyle the rest. Reference: https://examples.stand.chat/stand-inline/
//
// Built on Stand's visitor API (beta) through stand-visitor.js. Public domain.

import { getClient, isConversation, parseCard } from './stand-visitor.js';

const LOOKS = ['whisper', 'line', 'field', 'card', 'stage'];
const GROWS = ['unfold', 'follow', 'focus'];

export const STRINGS = {
  placeholder: 'Ask a question',
  reply: 'Reply…',
  send: 'Send',
  you: 'You',
  ai: 'AI',
  aiTitle: 'AI Stand-in',
  personTitle: 'Online now',
  someone: 'Chat',
  expand: 'Open full view',
  collapse: 'Back to the page',
  hideDock: 'Hide',
  back: 'Back to where you asked',
  end: 'End chat',
  ended: 'This conversation has ended.',
  newChat: 'Start a new conversation',
  reconnect: 'Reconnect',
  retrySend: 'Retry',
  sending: 'Sending…',
  notDelivered: 'Not delivered.',
  continue: 'Continue your conversation',
  poweredBy: 'Powered by Stand',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  unavailable: 'Nobody can answer right now. Please try again later.',
  emailLabel: 'Your email',
  emailSend: 'Send',
  askSelection: 'Ask about this',
  removeQuote: 'Remove',
  quotePlaceholder: 'Ask about this…',
  sample: 'Sample conversation · nothing is sent',
  conversation: 'Conversation with {name}',
  cards: {
    'session-start': '{name}, an AI Stand-in, is answering',
    handoff: '{name} joined the conversation',
    'human-transfer': '{name} took over the conversation',
    'standin-takeover': '{name}, an AI Stand-in, took over',
    'session-end': 'Conversation ended',
    'rep-followup-offer': '{name} can follow up by email.',
    'rep-followup-confirmation': 'Thanks! You’ll get a reply by email.',
  },
  errors: {
    connect: 'Couldn’t reach the chat. Check your connection.',
    start: 'The chat couldn’t start. Please try again.',
    uncertain: 'We couldn’t confirm that your chat started. Your message is back in the box: start again when you’re ready.',
    send: 'Your message wasn’t confirmed yet.',
    lost: 'The chat ended before your last message was confirmed.',
    gone: 'This conversation is no longer available.',
    paused: 'Connection lost. Reconnect to see new replies.',
    refresh: 'Couldn’t load new replies. Reconnecting…',
    end: 'Couldn’t end the chat. Please try again.',
    email: 'Couldn’t send your email. Check it and try again.',
    offer: 'That offer has expired.',
  },
};

const ICONS = {
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
  lead: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1.3 0-2.5-.3-3.6-.8L4 19.5l1.2-3.6A7.2 7.2 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c.5 4.3 2.2 6 6.5 6.5-4.3.5-6 2.2-6.5 6.5-.5-4.3-2.2-6-6.5-6.5 4.3-.5 6-2.2 6.5-6.5ZM18.5 15c.2 1.7.8 2.3 2.5 2.5-1.7.2-2.3.8-2.5 2.5-.2-1.7-.8-2.3-2.5-2.5 1.7-.2 2.3-.8 2.5-2.5Z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4l-6.5 6.5M14 4.5V10h5.5M4 20l6.5-6.5M10 19.5V14H4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 12l6-6 6 6"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7"/></svg>',
  quote: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18c2.5-1.5 4-3.8 4-7V7H5v5h3M13 18c2.5-1.5 4-3.8 4-7V7h-4v5h3"/></svg>',
};

// Elements that share a client share one conversation. The owner shows it; the
// others offer to continue it there.
const peers = new WeakMap();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

class StandInline extends HTMLElement {
  static observedAttributes = ['site', 'api', 'scope', 'look', 'grow', 'placeholder', 'greeting', 'suggestions', 'focus-at', 'ask-selection'];

  #client = null;
  #customClient = null;
  #strings = STRINGS;
  #unsubscribe = null;
  #unmount = null;
  #els = {};
  #nodes = new Map(); // messageId -> row
  #greetingRow = null;
  #queued = false;
  #rendered = false; // first render done: later rows animate in
  #lastState = null;
  #view = 'idle';
  #ui = { focusWithin: false, pointer: false, hasText: false, quote: '', expanded: false, inView: true, dockHidden: false, autoExpanded: false, interacted: 0, waiting: false, unanswered: false };
  #observer = null;
  #themeObserver = null;
  #rotation = { timer: 0, list: [], index: 0, length: 0, deleting: false };
  #selection = { timer: 0, text: '', scroll: null };
  #revealed = false;
  #stick = true;
  #following = 0;
  #autoScrollUntil = 0;
  #responder = '';
  #lastHostId = '';

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${TEMPLATE}`;
    for (const node of root.querySelectorAll('[data-el]')) this.#els[node.dataset.el] = node;
    // Rows that move in and out of the transcript.
    this.#els.pending.remove();
    this.#els.activity.remove();
    this.#wire();
  }

  // Public API ----------------------------------------------------------------

  /** A client other than the shared one for `site`, e.g. a scripted sample. */
  get client() {
    return this.#client;
  }

  set client(client) {
    this.#customClient = client ?? null;
    if (this.isConnected) this.#connectClient();
  }

  /** Override any UI text: { reply: 'Antwoord…', cards: { handoff: '…' } }. */
  get strings() {
    return this.#strings;
  }

  set strings(value) {
    const v = value ?? {};
    this.#strings = { ...STRINGS, ...v, cards: { ...STRINGS.cards, ...v.cards }, errors: { ...STRINGS.errors, ...v.errors } };
    this.#schedule();
  }

  /** The visitor's unsent text. */
  get draft() {
    return this.#els.input.value;
  }

  set draft(value) {
    this.#els.input.value = value ?? '';
    this.#afterInput(false);
  }

  /** A quote to send with the next message, as "Ask about this" does for selected text. */
  get quote() {
    return this.#ui.quote;
  }

  set quote(value) {
    this.#ui.quote = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
    this.#render();
  }

  /** Read-only view of the conversation for page code. */
  get state() {
    const s = this.#client?.getSnapshot();
    if (!s) return null;
    return {
      phase: s.phase,
      view: this.#view,
      busy: s.busy,
      responder: { name: s.host.name, title: s.host.title, avatar: s.host.avatar, human: s.host.kind === 'rep' },
      messages: s.messages.filter(isConversation).map((m) => ({ from: from(m), text: m.body, type: m.type })),
    };
  }

  /** Sends text as the visitor. Starts the conversation when needed. */
  ask(text) {
    return this.#submit(String(text ?? ''), { from: 'api' });
  }

  /** Moves focus to the message box. */
  focus(options) {
    this.#els.input.focus(options);
  }

  /** Lifts the conversation into a focused view over the page. */
  expand() {
    const { dialog, sheet, convo } = this.#els;
    if (this.#ui.expanded || !this.isConnected) return;
    const origin = convo.getBoundingClientRect();
    this.#ui.expanded = true;
    this.#els.away.style.height = `${origin.height}px`;
    sheet.append(convo);
    this.#previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    dialog.showModal();
    this.#render();
    const box = sheet.getBoundingClientRect();
    if (!reducedMotion.matches && origin.width) {
      sheet.style.transformOrigin = `${origin.left + origin.width / 2 - box.left}px ${origin.top + origin.height / 2 - box.top}px`;
      sheet.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    this.#toBottom();
    this.#els.input.focus({ preventScroll: true });
    this.#emit('expand');
  }

  /** Returns the conversation to its place in the page. */
  collapse() {
    if (!this.#ui.expanded) return;
    const { dialog, sheet } = this.#els;
    if (reducedMotion.matches) return dialog.close();
    sheet.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 160, easing: 'ease-in' })
      .finished.then(() => dialog.close(), () => dialog.close());
  }

  /** Ends the conversation. */
  end() {
    return this.#client?.end();
  }

  /** Re-reads colors from the page, after a theme switch for example. */
  refreshTheme() {
    this.#theme();
  }

  // Lifecycle -----------------------------------------------------------------

  connectedCallback() {
    this.#connectClient();
    this.#observer = new IntersectionObserver(([entry]) => {
      this.#ui.inView = entry.isIntersecting;
      this.#schedule();
    });
    this.#observer.observe(this.#els.convo);
    requestAnimationFrame(() => this.#theme());
    this.#themeObserver = new MutationObserver(() => this.#themeSoon());
    for (const node of [document.documentElement, document.body]) {
      if (node) this.#themeObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] });
    }
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', this.#themeSoon);
    this.#rotate();
    this.#watchSelection();
  }

  disconnectedCallback() {
    this.#disconnectClient();
    this.#observer?.disconnect();
    this.#themeObserver?.disconnect();
    matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.#themeSoon);
    clearTimeout(this.#rotation.timer);
    this.#unwatchSelection();
    if (this.#ui.expanded) this.#els.dialog.close();
  }

  attributeChangedCallback(name, before, after) {
    if (before === after || !this.isConnected) return;
    if (name === 'site' || name === 'api' || name === 'scope') return this.#connectClient();
    if (name === 'placeholder') this.#rotate();
    if (name === 'ask-selection') this.#watchSelection();
    if (name === 'look') this.#themeSoon();
    this.#schedule();
  }

  // Wiring --------------------------------------------------------------------

  #previousOverflow = '';

  #wire() {
    const e = this.#els;
    e.composer.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#submit(e.input.value, { from: 'input' });
    });
    e.input.addEventListener('input', () => this.#afterInput(true));
    e.input.addEventListener('keydown', (event) => this.#enterToSend(event, () => e.composer.requestSubmit()));
    const own = (event) => !event.composedPath().includes(e.offline);
    e.si.addEventListener('focusin', (event) => {
      if (!own(event)) return;
      this.#ui.focusWithin = true;
      this.#ui.interacted = Date.now();
      this.#schedule();
    });
    e.si.addEventListener('focusout', (event) => {
      if (e.si.contains(event.relatedTarget)) return;
      // Late: a click on a suggestion must land before the suggestions fold away.
      setTimeout(() => {
        if (e.si.contains(this.shadowRoot.activeElement)) return;
        this.#ui.focusWithin = false;
        this.#client?.typing(false);
        this.#schedule();
      }, 180);
    });
    e.si.addEventListener('pointerdown', (event) => {
      if (!own(event)) return;
      this.#ui.pointer = true;
      this.#ui.interacted = Date.now();
      addEventListener('pointerup', () => setTimeout(() => {
        this.#ui.pointer = false;
        this.#schedule();
      }, 220), { once: true });
    });
    e.chips.addEventListener('click', (event) => {
      const chip = event.target.closest('button');
      if (chip) void this.#submit(chip.textContent, { from: 'chip' });
    });
    e.log.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-card]');
      if (link) this.#client?.trackLinkClick(link.dataset.card, link.href);
    });
    e.scroller.addEventListener('scroll', () => {
      const s = e.scroller;
      // A follow in progress, or our own smooth scroll, owns the position until it lands.
      if (this.#following || performance.now() < this.#autoScrollUntil) return;
      this.#stick = s.scrollHeight - s.scrollTop - s.clientHeight < 48;
    }, { passive: true });
    e.expand.addEventListener('click', () => this.expand());
    e.collapse.addEventListener('click', () => this.collapse());
    e.end.addEventListener('click', () => void this.#client?.end());
    e.brand.addEventListener('click', () => this.#client?.trackAttributionClick());
    e.bannerButton.addEventListener('click', () => this.#bannerAction());
    e.pendingRetry.addEventListener('click', () => void this.#client?.send());
    e.quoteRemove.addEventListener('click', () => {
      this.#ui.quote = '';
      this.#render();
      e.input.focus();
    });
    e.followup.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (await this.#client?.submitEmail(e.email.value)) e.email.value = '';
    });
    e.continue.addEventListener('click', () => this.#continueHere());
    e.dialog.addEventListener('close', () => this.#afterCollapse());
    e.dialog.addEventListener('click', (event) => {
      if (event.target === e.dialog) this.collapse(); // The backdrop.
    });
    // The dock: a small version of the conversation that follows the visitor.
    e.dockSummary.addEventListener('click', () => this.#backToInline());
    e.dockExpand.addEventListener('click', () => this.expand());
    e.dockClose.addEventListener('click', () => {
      this.#ui.dockHidden = true;
      this.#render();
    });
    e.dockComposer.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = e.dockInput.value;
      e.dockInput.value = '';
      this.#autosize(e.dockInput);
      void this.#submit(text, { from: 'dock' });
    });
    e.dockInput.addEventListener('input', () => {
      this.#autosize(e.dockInput);
      e.dockSend.disabled = !e.dockInput.value.trim();
      this.#client?.typing(Boolean(e.dockInput.value.trim()));
    });
    e.dockInput.addEventListener('keydown', (event) => this.#enterToSend(event, () => e.dockComposer.requestSubmit()));
    e.selask.addEventListener('pointerdown', (event) => event.preventDefault()); // Keep the selection.
    e.selask.addEventListener('click', () => this.#askAboutSelection());
  }

  #enterToSend(event, submit) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  }

  #afterInput(typed) {
    const e = this.#els;
    this.#autosize(e.input);
    const hasText = Boolean(e.input.value.trim());
    if (hasText !== this.#ui.hasText) {
      this.#ui.hasText = hasText;
      this.#schedule();
    }
    if (typed) {
      this.#ui.interacted = Date.now();
      if (this.#isOwner()) this.#client?.setDraft(e.input.value);
      this.#client?.typing(hasText);
    }
    e.send.disabled = !this.#canSend();
  }

  #autosize(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
  }

  #connectClient() {
    this.#disconnectClient();
    const site = this.getAttribute('site');
    const api = this.getAttribute('api') || undefined;
    const scope = this.getAttribute('scope') || '';
    this.#client = this.#customClient ?? (site ? getClient({ site, api, scope }) : null);
    if (!this.#client) {
      // Page code may still hand it a client (el.client = …) right after it connects.
      setTimeout(() => {
        if (!this.#client && this.isConnected) console.warn('<stand-inline> needs a site attribute: your Stand Site ID, or "demo" to try it.');
      });
      return this.#render();
    }
    if (!peers.has(this.#client)) peers.set(this.#client, new Set());
    peers.get(this.#client).add(this);
    this.#unsubscribe = this.#client.subscribe(() => this.#schedule());
    this.#unmount = this.#client.mount();
    this.#rendered = false;
    Object.assign(this.#ui, { quote: '', autoExpanded: false, dockHidden: false });
    this.#lastHostId = '';
    // Not now: elements parsed together connect one after another, and the
    // one that holds the conversation can only be known once all have.
    this.#schedule();
    // Page code that follows the conversation starts over from el.state.
    queueMicrotask(() => this.isConnected && this.#emit('reset', this.state ?? {}));
  }

  #disconnectClient() {
    if (!this.#client) return;
    peers.get(this.#client)?.delete(this);
    this.#unsubscribe?.();
    this.#unmount?.();
    this.#unsubscribe = this.#unmount = null;
    for (const row of this.#nodes.values()) row.remove();
    this.#nodes.clear();
    this.#greetingRow?.remove();
    this.#greetingRow = null;
    this.#lastState = null;
    this.#client = null;
  }

  // Sending -------------------------------------------------------------------

  #context() {
    return {
      owner: this.#key(),
      greeting: this.getAttribute('greeting')?.trim() || '',
      prompt: this.getAttribute('prompt')?.trim() || '',
      analyticsId: this.getAttribute('analytics-id') || '',
      identity: this.hasAttribute('visitor-id')
        ? { externalId: this.getAttribute('visitor-id'), name: this.getAttribute('visitor-name') || '' }
        : null,
    };
  }

  #canSend() {
    const s = this.#client?.getSnapshot();
    if (!s || s.busy || (s.pending && !s.pending.creating)) return false;
    return ['available', 'active', 'loading', 'ended'].includes(s.phase) && Boolean(this.#els.input.value.trim());
  }

  // A question asked while Stand is still looking for a responder waits for it.
  async #ready(client) {
    if (client.getSnapshot().phase !== 'loading') return;
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        stop();
        resolve();
      };
      const stop = client.subscribe((state) => state.phase !== 'loading' && done());
      const timer = setTimeout(done, 10000);
    });
  }

  async #submit(value, { from = 'input' } = {}) {
    const client = this.#client;
    if (!client || !value.trim()) return false;
    // B. Waiting for Stand to find a responder shows; nobody to answer says so.
    this.#ui.waiting = client.getSnapshot().phase === 'loading';
    if (this.#ui.waiting) this.#render();
    await this.#ready(client);
    if (client.getSnapshot().phase === 'ended' && !client.getSnapshot().busy) {
      await client.newChat();
      await this.#ready(client);
    }
    this.#ui.waiting = false;
    const s = client.getSnapshot();
    let text = value.trim();
    if (client !== this.#client || s.busy || !['available', 'active'].includes(s.phase)) {
      this.#ui.unanswered = s.phase === 'unavailable';
      this.#render();
      return false;
    }
    if (s.pending && !s.pending.creating) return false; // Retry that one first.
    if (this.#ui.quote) text = `${this.#ui.quote.split('\n').map((line) => `> ${line}`).join('\n')}\n\n${text}`;
    this.#ui.quote = '';
    this.#ui.interacted = Date.now();
    this.#ui.dockHidden = false;
    this.#stick = true;
    // The box empties when its own text was sent, or when a page (or a sample)
    // asked exactly what's in it. Anything else the visitor typed stays.
    if (from === 'input' || this.#els.input.value.trim() === value.trim()) {
      this.#els.input.value = '';
      this.#afterInput(false);
    }
    client.setOwner(this.#key());
    client.setDraft('');
    // grow="focus": the conversation lifts off the page once it gets going.
    const depth = s.messages.filter((m) => m.senderType === 'visitor' && isConversation(m)).length + 1;
    const focusAt = Math.max(1, parseInt(this.getAttribute('focus-at') ?? '1', 10) || 1);
    if (this.#grow() === 'focus' && depth >= focusAt && !this.#ui.autoExpanded && !this.#ui.expanded) {
      this.#ui.autoExpanded = true;
      queueMicrotask(() => this.expand());
    }
    const started = !s.messages.length;
    const ok = await client.send(text, this.#context());
    if (ok && started) this.#emit('start', {});
    return ok;
  }

  #bannerAction() {
    const client = this.#client;
    const s = client?.getSnapshot();
    if (!s) return;
    if (s.phase === 'ended' || s.phase === 'uncertain') {
      this.#ui.autoExpanded = false;
      void client.newChat().then(() => {
        const draft = client.getSnapshot().draft;
        if (draft) this.draft = draft;
        this.#els.input.focus();
      });
    } else if (s.pending && !s.pending.creating && !s.busy) {
      void client.send();
    } else {
      void client.retry();
    }
  }

  #continueHere() {
    const owner = this.#ownerElement();
    if (owner && owner !== this && owner.#isRendered()) {
      reveal(owner.#els.convo);
      owner.focus({ preventScroll: true });
    } else {
      this.#client?.setOwner(this.#key());
      queueMicrotask(() => this.#els.input.focus());
    }
  }

  #backToInline() {
    reveal(this.#els.convo);
    this.#els.input.focus({ preventScroll: true });
  }

  #afterCollapse() {
    const { si, convo } = this.#els;
    this.#ui.expanded = false;
    si.insertBefore(convo, this.#els.away);
    document.documentElement.style.overflow = this.#previousOverflow;
    this.#render();
    const box = convo.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) reveal(convo, false);
    this.#els.input.focus({ preventScroll: true });
    this.#toBottom();
    this.#emit('collapse');
  }

  // Ownership -----------------------------------------------------------------

  #key() {
    if (this.id) return `#${this.id}`;
    if (this.getAttribute('analytics-id')) return this.getAttribute('analytics-id');
    const all = this.#peers();
    return `@${all.indexOf(this)}`;
  }

  #peers() {
    const set = peers.get(this.#client);
    if (!set) return [this];
    return [...set].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  #isRendered() {
    return this.isConnected && this.getClientRects().length > 0;
  }

  #ownerElement() {
    const s = this.#client?.getSnapshot();
    const all = this.#peers();
    const rendered = all.filter((el) => el.#isRendered());
    return rendered.find((el) => el.#key() === s?.owner) ?? all.find((el) => el.#key() === s?.owner && !rendered.length) ?? rendered[0] ?? all[0];
  }

  #isOwner() {
    return this.#ownerElement() === this;
  }

  // Rendering -----------------------------------------------------------------

  #schedule = () => {
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      this.#render();
    });
  };

  #look() {
    const look = this.getAttribute('look');
    return LOOKS.includes(look) ? look : 'field';
  }

  #grow() {
    const grow = this.getAttribute('grow');
    return GROWS.includes(grow) ? grow : 'unfold';
  }

  #render() {
    const e = this.#els;
    const t = this.#strings;
    const client = this.#client;
    const s = client?.getSnapshot() ?? { ...INITIAL, phase: 'unavailable' };
    const previous = this.#lastState;
    this.#lastState = s;
    const look = this.#look();
    const grow = this.#grow();
    const greeting = this.getAttribute('greeting')?.trim() || '';

    const conversing = s.messages.some(isConversation) || Boolean(s.pending) || ['active', 'ended', 'uncertain'].includes(s.phase);
    const owner = conversing && client ? this.#isOwner() : false;
    if (owner && s.owner !== this.#key()) {
      queueMicrotask(() => {
        if (this.#client === client && this.#isOwner() && client.getSnapshot().owner !== this.#key()) client.setOwner(this.#key());
      });
    }
    const engaged = this.#ui.focusWithin || this.#ui.pointer || this.#ui.hasText || Boolean(this.#ui.quote);
    const offline = s.phase === 'unavailable' && !conversing;
    // An ended chat stays with its owner; everywhere else, asking starts a new one.
    const view = conversing
      ? owner ? 'conversation' : s.phase === 'ended' ? 'idle' : 'elsewhere'
      : offline ? (this.#ui.hasText || this.#ui.unanswered ? 'idle' : 'offline') : 'idle';
    const viewChanged = view !== this.#view;
    this.#view = view;
    const active = view === 'conversation';

    // Reveal hidden wrappers once someone can answer, like <stand-button> does.
    if (!this.#revealed && (s.phase === 'available' || conversing)) {
      this.#revealed = true;
      this.hidden = false;
      const wrapper = this.closest('[data-stand-reveal]');
      if (wrapper?.hidden) wrapper.hidden = false;
      this.#emit('available', { name: s.host.name, title: s.host.title, avatar: s.host.avatar, human: s.host.kind === 'rep' });
    }
    if (previous && previous.phase !== 'unavailable' && s.phase === 'unavailable' && !conversing) this.#emit('unavailable', {});

    // Host attributes: page CSS can react to the conversation, not only style it.
    const depth = s.messages.filter((m) => m.senderType === 'visitor' && isConversation(m)).length + (s.pending?.creating ? 1 : 0);
    const hostState = view === 'idle' && s.phase === 'loading' ? 'loading' : view;
    if (this.dataset.state !== hostState) this.dataset.state = hostState;
    if (this.dataset.phase !== s.phase) this.dataset.phase = s.phase;
    if (this.hasAttribute('data-expanded') !== this.#ui.expanded) this.toggleAttribute('data-expanded', this.#ui.expanded);
    if (this.dataset.depth !== String(Math.min(depth, 9))) this.dataset.depth = String(Math.min(depth, 9));
    const offlineContent = Boolean(this.querySelector(':scope > [slot="offline"]'));
    if (this.hasAttribute('data-offline-content') !== offlineContent) this.toggleAttribute('data-offline-content', offlineContent);

    const hostKind = s.host.kind === 'rep' ? 'person' : s.host.kind === 'standin' ? 'ai' : '';
    if ((this.dataset.responder ?? '') !== hostKind) {
      if (hostKind) this.dataset.responder = hostKind;
      else delete this.dataset.responder;
    }
    Object.assign(e.si.dataset, { look, grow, view, phase: s.phase, depth: String(Math.min(depth, 3)), host: hostKind });
    e.si.toggleAttribute('data-engaged', engaged);
    e.si.toggleAttribute('data-waiting', this.#ui.waiting);
    if (s.phase !== 'unavailable') this.#ui.unanswered = false;
    e.si.toggleAttribute('data-has-text', this.#ui.hasText);
    e.si.toggleAttribute('data-expanded', this.#ui.expanded);
    e.si.toggleAttribute('data-sample', Boolean(client?.sample));
    e.convo.toggleAttribute('data-sample', Boolean(client?.sample));

    // Stage: the greeting is the headline, unless the page brings its own.
    const ownHeadline = Boolean(this.querySelector(':scope > [slot="headline"]'));
    e.headlineText.textContent = look === 'stage' && !ownHeadline ? greeting : '';
    e.headline.hidden = look !== 'stage' || (!greeting && !ownHeadline);

    // What's open, per look and moment. CSS animates the folds.
    const card = look === 'card';
    const stage = look === 'stage';
    const quiet = look === 'whisper' || look === 'line';
    const show = {
      head: active || card || (!stage && engaged && Boolean(s.host.name) && !greeting),
      log: active || card || (!stage && engaged && Boolean(greeting)),
      chips: !active && view !== 'elsewhere' && (!quiet || engaged),
      foot: active || card || (engaged && !stage),
    };
    if (this.#ui.expanded) Object.assign(show, { head: true, log: true, foot: true });
    for (const [name, open] of Object.entries(show)) e[`${name}Fold`].toggleAttribute('data-open', open);

    this.#renderIdentity(s, t);
    // Only the owner shows the transcript; the others offer to continue it there.
    // In the focused view, the stage's headline stays behind: the greeting shows as a message.
    const logLook = this.#ui.expanded ? 'sheet' : look;
    this.#renderLog(view === 'elsewhere' ? { ...s, messages: [], pending: null, activity: null } : s, t, { look: logLook, greeting, animate: this.#rendered && !viewChanged });
    this.#renderChips(active);
    this.#renderBanner(s, t, active);

    // Follow-up: someone offered to reply by email.
    e.followup.hidden = !(active && s.followupOffered && s.phase === 'active');
    e.emailButton.disabled = s.busy;
    e.emailButton.textContent = t.emailSend;
    e.email.setAttribute('aria-label', t.emailLabel);

    // Composer
    const composing = ['available', 'active', 'loading', 'ended'].includes(s.phase) && !(active && s.phase === 'ended');
    e.composer.hidden = view === 'elsewhere' || view === 'offline' || (active && s.phase === 'ended');
    e.convo.hidden = view === 'offline' || view === 'elsewhere';
    e.offline.hidden = view !== 'offline';
    e.convo.setAttribute('aria-label', fill(t.conversation, { name: s.host.name || t.someone }));
    // Never disabled while sending: that would drop focus and close a phone's keyboard.
    // #canSend() holds the next message back instead.
    e.input.disabled = !composing;
    const placeholder = this.#ui.quote ? t.quotePlaceholder : active ? (this.getAttribute('reply-placeholder') || t.reply) : null;
    if (placeholder) this.#setPlaceholder(placeholder);
    else if (!this.#rotation.list.length || this.#rotation.list.length < 2) this.#setPlaceholder(this.#placeholders()[0] ?? t.placeholder);
    e.input.setAttribute('aria-label', this.getAttribute('label') || this.#placeholders()[0] || t.placeholder);
    e.send.disabled = !this.#canSend();
    e.send.setAttribute('aria-label', t.send);
    if (owner && s.draft && !e.input.value && document.activeElement !== this) {
      e.input.value = s.draft;
      this.#afterInput(false);
    }

    // Quote from a text selection
    e.quote.toggleAttribute('data-open', Boolean(this.#ui.quote) && !e.composer.hidden);
    e.quoteText.textContent = this.#ui.quote;
    e.quoteRemove.setAttribute('aria-label', t.removeQuote);

    // Footer: the notice, End chat, and attribution.
    e.notice.textContent = s.notice;
    e.notice.hidden = !s.notice;
    e.end.textContent = t.end;
    e.end.hidden = !(active && s.phase === 'active');
    e.end.disabled = s.busy;
    const attribution = safeUrl(s.poweredByUrl);
    e.brand.hidden = !attribution;
    if (attribution) e.brand.href = attribution;
    e.brandLabel.textContent = t.poweredBy;
    e.foot.hidden = !s.notice && e.end.hidden && e.brand.hidden;

    // Elsewhere: another element on this page holds the conversation.
    e.continueLabel.textContent = t.continue;
    e.continue.hidden = view !== 'elsewhere';

    // Expanded: the conversation's place stays reserved, so the page doesn't jump.
    e.away.hidden = !this.#ui.expanded;
    e.expand.hidden = !active || this.#ui.expanded || this.hasAttribute('no-expand');
    e.expand.setAttribute('aria-label', t.expand);
    e.expand.title = t.expand;
    e.collapse.hidden = !this.#ui.expanded;
    e.collapse.setAttribute('aria-label', t.collapse);
    e.collapse.title = t.collapse;
    e.dialog.setAttribute('aria-label', fill(t.conversation, { name: s.host.name || t.someone }));
    e.sheet.dataset.look = look;
    e.sampleLabel.textContent = t.sample;

    this.#renderDock(s, t, { active, grow });
    this.#dispatchMessages(s, previous, owner);
    if (previous?.messages.length && !s.messages.length && !s.pending) this.#emit('reset', this.state ?? {});
    if (s.phase === 'ended' && previous?.phase === 'active' && owner) this.#emit('end', {});
    this.#rendered = Boolean(client);
  }

  #renderIdentity(s, t) {
    const e = this.#els;
    const known = Boolean(s.host.name);
    e.head.toggleAttribute('data-unknown', !known);
    const name = known ? s.host.name : '';
    e.name.textContent = name;
    e.badge.textContent = t.ai;
    e.badge.hidden = s.host.kind !== 'standin';
    e.live.hidden = s.host.kind !== 'rep';
    let status = s.host.title || (s.host.kind === 'standin' ? t.aiTitle : s.host.kind === 'rep' ? t.personTitle : '');
    if (s.phase === 'active' && s.connection === 'connecting') status = t.connecting;
    if (s.phase === 'active' && s.connection === 'offline') status = t.reconnecting;
    e.status.textContent = status;
    if (known) setAvatar(e.avatar, s.host);
    else {
      e.avatar.replaceChildren();
      delete e.avatar.dataset.key;
    }
  }

  #renderChips(active) {
    const e = this.#els;
    const list = split(this.getAttribute('suggestions')).slice(0, 6);
    const current = [...e.chips.children].map((c) => c.textContent);
    if (current.join('|') !== list.join('|')) {
      e.chips.replaceChildren(...list.map((text, i) => {
        const chip = h('button', 'chip');
        chip.type = 'button';
        chip.part = 'suggestion';
        chip.textContent = text;
        chip.style.setProperty('--i', i);
        return chip;
      }));
    }
    const disabled = active || !['available', 'loading', 'ended'].includes(this.#client?.getSnapshot().phase);
    for (const chip of e.chips.children) chip.disabled = disabled;
    e.chipsFold.hidden = !list.length;
  }

  #renderBanner(s, t, active) {
    const e = this.#els;
    let message = '';
    let action = '';
    if (active && s.phase === 'ended') {
      message = s.error && s.error !== 'gone' ? t.errors[s.error] ?? '' : t.ended;
      if (s.error === 'gone') message = t.errors.gone;
      action = t.newChat;
    } else if (active && s.phase === 'uncertain') {
      message = t.errors.uncertain;
      action = t.newChat;
    } else if (s.phase === 'unavailable' && (active || this.#ui.hasText || this.#ui.unanswered)) {
      message = s.error === 'connect' ? t.errors.connect : t.unavailable;
      action = s.error === 'connect' ? t.reconnect : '';
    } else if (active && s.error && !(s.error === 'send' && s.pending)) {
      message = t.errors[s.error] ?? '';
      action = ['paused', 'connect', 'refresh'].includes(s.error) ? t.reconnect : '';
    }
    e.banner.hidden = !message;
    e.bannerText.textContent = message;
    e.bannerButton.hidden = !action;
    e.bannerButton.textContent = action;
    e.bannerButton.disabled = s.busy;
  }

  #renderLog(s, t, { look, greeting, animate }) {
    const e = this.#els;
    const rows = [];
    const newRows = [];
    // At the bottom before anything changes? Rows gaining labels above the view
    // (a handoff) move it, and that scroll isn't the visitor's.
    const box = e.scroller;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
    const responder = `${s.host.kind}|${s.host.name}`;
    const handoff = this.#responder !== '' && responder !== this.#responder;
    this.#responder = responder;

    // Who said what: names and avatars change with handoffs.
    // The text of a pending bubble that was on screen: its canonical copy takes over quietly.
    const wasPending = e.pending.isConnected ? e.pending.dataset.body : null;
    const who = {
      standin: { name: s.host.kind === 'standin' ? s.host.name : '', avatar: s.host.kind === 'standin' ? s.host.avatar : '' },
      rep: { name: s.host.kind === 'rep' ? s.host.name : '', avatar: s.host.kind === 'rep' ? s.host.avatar : '' },
      unknown: { name: s.host.name, avatar: s.host.avatar },
    };
    // An opening greeting comes before the card that names its sender: look ahead.
    for (const m of s.messages) {
      if (m.type !== 'system-card') continue;
      const card = parseCard(m.body);
      if ((card.cardType === 'session-start' || card.cardType === 'standin-takeover') && card.standinName) {
        if (!who.standin.name) who.standin = { name: card.standinName, avatar: card.standinAvatar || who.standin.avatar };
        break;
      }
    }

    // Before the chat starts, the greeting shows locally, from whoever would
    // answer. Its canonical copy takes over the same row once the chat exists.
    const hasCanonicalGreeting = greeting && s.messages.some((m) => m.senderType !== 'visitor' && isConversation(m) && m.body.trim() === greeting);
    const localGreeting = greeting && look !== 'stage' && !s.messages.some(isConversation);
    if (localGreeting) {
      if (!this.#greetingRow) this.#greetingRow = this.#row({ messageId: 'greeting', type: 'text', senderType: 'standin', body: greeting });
      const kind = s.host.kind === 'rep' ? 'rep' : s.host.kind === 'standin' ? 'standin' : 'unknown';
      this.#author(this.#greetingRow, true, { senderType: kind }, who, t, s.host);
      rows.push(this.#greetingRow);
    }
    let prev = null;
    let skippedGreeting = false;
    for (const m of s.messages) {
      // Private context for whoever answers: never part of the visitor's transcript.
      if (m.senderType === 'system-prompt' || m.type === 'system-prompt') continue;
      if (m.type === 'system-card') {
        const card = parseCard(m.body);
        if (card.cardType === 'session-start') who.standin = { name: card.standinName || who.standin.name, avatar: who.standin.avatar };
        if (card.cardType === 'standin-takeover') who.standin = { name: card.standinName || who.standin.name, avatar: card.standinAvatar || who.standin.avatar };
        if (card.cardType === 'handoff' || card.cardType === 'human-transfer') who.rep = { name: card.repName || who.rep.name, avatar: card.repAvatar || '' };
      }
      // Stage shows the greeting as its headline; don't repeat it below.
      if (look === 'stage' && !skippedGreeting && hasCanonicalGreeting && m.senderType !== 'visitor' && isConversation(m) && m.body.trim() === greeting) {
        skippedGreeting = true;
        continue;
      }
      let row = this.#nodes.get(m.messageId);
      if (!row) {
        if (this.#greetingRow && m.senderType !== 'visitor' && isConversation(m) && m.body.trim() === greeting) {
          row = this.#greetingRow; // Adopt: no flash, no repeat animation.
          row.dataset.id = m.messageId;
          this.#greetingRow = null;
        } else {
          row = this.#row(m, t, who);
          if (!row) continue;
          if (m.senderType === 'visitor' && wasPending !== null && m.body.trim() === wasPending) {
            row.classList.add('replaces-pending');
          } else {
            newRows.push(row);
          }
        }
        this.#nodes.set(m.messageId, row);
      }
      const speaker = from(m);
      const first = !prev || prev.dataset.from !== speaker || prev.dataset.kind === 'system';
      row.dataset.from = speaker;
      if (row.dataset.kind !== 'system') this.#author(row, first, m, who, t, s.host);
      rows.push(row);
      prev = row.dataset.kind === 'system' ? null : row;
    }
    if (!localGreeting && this.#greetingRow) {
      this.#greetingRow.remove();
      this.#greetingRow = null;
    }

    // Pending: sent, not confirmed.
    if (s.pending) {
      const row = e.pending;
      row.dataset.body = s.pending.body.trim();
      row.querySelector('.bubble').replaceChildren(markdown(s.pending.body));
      const failed = !s.busy && !s.pending.creating;
      e.pendingStatus.textContent = failed ? t.notDelivered : t.sending;
      e.pendingRetry.hidden = !failed || s.phase !== 'active';
      e.pendingRetry.textContent = t.retrySend;
      row.toggleAttribute('data-failed', failed);
      if (!row.isConnected) newRows.push(row);
      rows.push(row);
    }

    // Activity: an AI reply on its way (streamed text when Stand sends it), or a person typing.
    const activity = s.phase === 'active' ? s.activity : null;
    if (activity) {
      const row = e.activity;
      const kind = s.host.kind === 'rep' ? 'rep' : 'standin';
      this.#author(row, true, { senderType: kind }, { [kind]: { name: s.host.name, avatar: s.host.avatar } }, t, s.host);
      const bubble = row.querySelector('.bubble');
      if (activity.preview) {
        bubble.replaceChildren(markdown(activity.preview));
        bubble.classList.add('streaming');
      } else if (!bubble.querySelector('.dots')) {
        bubble.classList.remove('streaming');
        bubble.innerHTML = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
      }
      if (!row.isConnected) newRows.push(row);
      rows.push(row);
    }

    // Reconcile the DOM in order, touching only what moved.
    const log = e.log;
    let cursor = log.firstChild;
    for (const row of rows) {
      if (row === cursor) cursor = cursor.nextSibling;
      else log.insertBefore(row, cursor);
    }
    while (cursor) {
      const next = cursor.nextSibling;
      if (cursor.dataset?.id) this.#nodes.delete(cursor.dataset.id);
      cursor.remove();
      cursor = next;
    }

    if (animate && !reducedMotion.matches) {
      for (const row of newRows) {
        row.classList.remove('enter');
        void row.offsetWidth;
        row.classList.add('enter');
        row.addEventListener('animationend', () => row.classList.remove('enter'), { once: true });
      }
    }
    if (newRows.length || activity?.preview || handoff) this.#follow(newRows, atBottom || handoff);
  }

  // A message row. Rows are keyed by messageId and kept across renders.
  #row(m, t = this.#strings, who = {}) {
    if (m.senderType === 'system-prompt' || m.type === 'system-prompt') return null;
    const row = h('div', 'row');
    row.dataset.id = m.messageId;
    const inner = h('div', 'row-in');
    row.append(inner);
    if ((m.type === 'text' || m.type === 'standin-idle-prompt') && ['visitor', 'rep', 'standin'].includes(m.senderType)) {
      const visitor = m.senderType === 'visitor';
      row.classList.add(visitor ? 'visitor' : 'host');
      row.dataset.kind = 'message';
      const msg = h('div', 'msg');
      msg.part = `message ${visitor ? 'visitor' : 'host'}`;
      const bubble = h('div', 'bubble');
      bubble.part = 'bubble';
      bubble.append(markdown(m.body));
      msg.append(bubble);
      inner.append(msg);
      return row;
    }
    if (m.type === 'link-card') {
      const card = parseCard(m.body);
      const url = safeUrl(card.url);
      if (!url) return null;
      row.classList.add('host');
      row.dataset.kind = 'link';
      const msg = h('div', 'msg');
      msg.part = 'message host';
      const link = h('a', 'link');
      link.part = 'link-card';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.card = m.messageId;
      const title = h('span', 'link-title');
      title.textContent = typeof card.title === 'string' && card.title ? card.title : url;
      link.append(title);
      if (typeof card.description === 'string' && card.description) {
        const description = h('span', 'link-description');
        description.textContent = card.description;
        link.append(description);
      }
      const where = h('span', 'link-host');
      where.textContent = new URL(url).hostname.replace(/^www\./, '');
      where.insertAdjacentHTML('beforeend', ICONS.out);
      link.append(where);
      msg.append(link);
      inner.append(msg);
      return row;
    }
    if (m.type === 'system-card') {
      const card = parseCard(m.body);
      const template = typeof card.cardType === 'string' && Object.hasOwn(t.cards, card.cardType) ? t.cards[card.cardType] : null;
      if (!template) return null; // Tracking cards and unknown cards stay out of the transcript.
      const name = card.repName || card.standinName || who.rep?.name || who.standin?.name || t.someone;
      const custom = ['handoff', 'human-transfer', 'standin-takeover', 'rep-followup-offer', 'rep-followup-confirmation'].includes(card.cardType)
        && typeof card.message === 'string' && card.message.trim();
      row.classList.add('system');
      row.dataset.kind = 'system';
      const note = h('div', 'system-note');
      note.part = 'system';
      note.textContent = custom || fill(template, { name });
      inner.append(note);
      return row;
    }
    return null;
  }

  // The name above the first message of each run. Labels that repeat the
  // header ("current") only show in the whisper thread; after a handoff, the
  // earlier speaker keeps its label.
  #author(row, show, m, who, t, host) {
    const inner = row.firstElementChild;
    let label = inner.querySelector(':scope > .author');
    if (!show) return void label?.remove();
    const visitor = m.senderType === 'visitor';
    const person = who[m.senderType] ?? {};
    const kind = m.senderType === 'rep' || m.senderType === 'standin' ? m.senderType : null;
    const current = !visitor && (kind ?? host.kind) === host.kind && (person.name || '') === (host.name || '');
    const key = visitor ? 'you' : `${m.senderType}|${person.name}|${person.avatar}|${current}`;
    if (label?.dataset.key === key) return;
    label ??= h('div', 'author');
    label.part = 'author';
    label.dataset.key = key;
    label.classList.toggle('current', current);
    if (visitor) {
      label.textContent = t.you;
    } else {
      const avatar = h('span', 'avatar small');
      avatar.part = 'avatar';
      setAvatar(avatar, { name: person.name, avatar: person.avatar });
      const name = h('span', 'author-name');
      name.textContent = person.name || t.someone;
      label.replaceChildren(avatar, name);
      if (m.senderType === 'standin') {
        const badge = h('span', 'badge');
        badge.part = 'badge';
        badge.textContent = t.ai;
        label.append(badge);
      }
    }
    inner.prepend(label);
  }

  // Keeps new messages in view: in the transcript, and on the page while the
  // visitor is watching. Long replies show from their start.
  #follow(newRows, atBottom = false) {
    const e = this.#els;
    if (atBottom) this.#stick = true;
    clearTimeout(this.#following);
    // Measure once new rows have finished growing in.
    this.#following = setTimeout(() => {
      this.#following = 0;
      const scroller = e.scroller;
      const last = newRows.at(-1) ?? e.activity;
      const tall = last && last.classList.contains('host') && last.offsetHeight > scroller.clientHeight * 0.8;
      if (tall) {
        this.#autoScrollUntil = performance.now() + 900;
        scroller.scrollTo({ top: last.offsetTop - 12, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      }
      else if (this.#stick || newRows.some((r) => r.classList.contains('visitor'))) this.#toBottom(true);

      if (this.#ui.expanded || !this.#ui.inView || Date.now() - this.#ui.interacted > 90000) return;
      const target = tall ? last : e.composer.hidden ? e.log : e.composer;
      const box = target.getBoundingClientRect();
      const margin = 24;
      if (box.bottom > innerHeight - margin && box.top > 0) {
        const by = tall ? box.top - innerHeight * 0.2 : Math.min(box.bottom - innerHeight + margin, box.top - 80);
        if (by > 0) scrollBy({ top: by, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      }
    }, reducedMotion.matches ? 0 : 440);
  }

  #toBottom(smooth = false) {
    const scroller = this.#els.scroller;
    this.#stick = true;
    this.#autoScrollUntil = performance.now() + (smooth ? 900 : 100);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto' });
  }

  #renderDock(s, t, { active, grow }) {
    const e = this.#els;
    const last = s.messages.findLast(isConversation);
    const lastHost = s.messages.findLast((m) => isConversation(m) && m.senderType !== 'visitor');
    if (lastHost && lastHost.messageId !== this.#lastHostId) {
      if (this.#lastHostId) this.#ui.dockHidden = false; // A new reply brings the dock back.
      this.#lastHostId = lastHost.messageId;
    }
    const open = grow === 'follow' && active && s.phase === 'active' && !this.#ui.expanded && !this.#ui.inView && !this.#ui.dockHidden;
    e.dock.toggleAttribute('data-open', open);
    e.dock.inert = !open;
    if (!open && e.dock.contains(this.shadowRoot.activeElement)) this.#els.input.focus({ preventScroll: true });
    setAvatar(e.dockAvatar, s.host);
    e.dockName.textContent = s.host.name || t.someone;
    e.dockBadge.hidden = s.host.kind !== 'standin';
    e.dockBadge.textContent = t.ai;
    const busy = Boolean(s.activity);
    e.dockText.hidden = busy;
    e.dockDots.hidden = !busy;
    if (!busy) {
      const message = last ?? lastHost;
      const prefix = message?.senderType === 'visitor' ? `${t.you}: ` : '';
      e.dockText.textContent = message ? prefix + plain(message) : '';
    }
    e.dockInput.placeholder = t.reply;
    e.dockInput.setAttribute('aria-label', t.reply);
    e.dockSend.setAttribute('aria-label', t.send);
    e.dockSend.disabled = !e.dockInput.value.trim() || s.busy || Boolean(s.pending && !s.pending.creating);
    e.dockSummary.setAttribute('aria-label', t.back);
    e.dockExpand.setAttribute('aria-label', t.expand);
    e.dockExpand.title = t.expand;
    e.dockClose.setAttribute('aria-label', t.hideDock);
    e.dockClose.title = t.hideDock;
  }

  // Page code can react to the conversation: stand-inline-message events.
  #dispatchMessages(s, previous, owner) {
    if (!owner || !previous) return;
    const known = new Set(previous.messages.map((m) => m.messageId));
    for (const m of s.messages) {
      if (known.has(m.messageId) || !isConversation(m)) continue;
      this.#emit('message', { from: from(m), text: m.type === 'link-card' ? parseCard(m.body).url ?? '' : m.body, type: m.type });
    }
    if (previous.host.kind !== s.host.kind || previous.host.name !== s.host.name) {
      if (previous.host.name && s.phase === 'active') this.#emit('responder', { name: s.host.name, human: s.host.kind === 'rep' });
    }
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(`stand-inline-${type}`, { bubbles: true, composed: true, detail }));
  }

  // Placeholders: several, separated by |, take turns being typed out.
  #placeholders() {
    return split(this.getAttribute('placeholder'));
  }

  #setPlaceholder(text) {
    if (this.#els.input.placeholder !== text) this.#els.input.placeholder = text;
  }

  #rotate() {
    clearTimeout(this.#rotation.timer);
    const list = this.#placeholders();
    Object.assign(this.#rotation, { list, index: 0, length: list[0]?.length ?? 0, deleting: false });
    this.#setPlaceholder(list[0] ?? this.#strings.placeholder);
    if (list.length < 2) return;
    const tick = () => {
      const r = this.#rotation;
      const idle = this.#view === 'idle' && !this.#ui.hasText && !this.#ui.focusWithin && !this.#ui.quote;
      if (!idle || reducedMotion.matches || document.hidden) {
        if (!this.#ui.quote && this.#view === 'idle') this.#setPlaceholder(r.list[r.index]);
        r.length = r.list[r.index].length;
        r.deleting = false;
        r.timer = setTimeout(tick, 700);
        return;
      }
      const current = r.list[r.index];
      let delay;
      if (!r.deleting && r.length >= current.length) {
        r.deleting = true;
        delay = 2600;
      } else if (r.deleting && r.length <= 0) {
        r.deleting = false;
        r.index = (r.index + 1) % r.list.length;
        delay = 350;
      } else {
        r.length += r.deleting ? -2 : 1;
        delay = r.deleting ? 18 : 38 + Math.random() * 40;
      }
      this.#setPlaceholder(r.list[r.index].slice(0, Math.max(0, r.length)) || '​');
      r.timer = setTimeout(tick, delay);
    };
    this.#rotation.timer = setTimeout(tick, 2600);
  }

  // Selection to ask: select text in the page, ask about it here.
  #watchSelection() {
    this.#unwatchSelection();
    if (!this.hasAttribute('ask-selection')) return;
    document.addEventListener('selectionchange', this.#onSelection);
    addEventListener('scroll', this.#placeSelectionButton, { passive: true });
    addEventListener('resize', this.#placeSelectionButton, { passive: true });
  }

  #unwatchSelection() {
    document.removeEventListener('selectionchange', this.#onSelection);
    removeEventListener('scroll', this.#placeSelectionButton);
    removeEventListener('resize', this.#placeSelectionButton);
    this.#hideSelectionButton();
  }

  #hideSelectionButton() {
    const button = this.#els.selask;
    if (!button) return;
    button.removeAttribute('data-open');
    try {
      button.hidePopover?.();
    } catch {
      // Already hidden.
    }
  }

  #onSelection = () => {
    clearTimeout(this.#selection.timer);
    this.#selection.timer = setTimeout(() => {
      const selection = getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? '';
      const scope = this.getAttribute('ask-selection') || 'main';
      const node = range?.commonAncestorContainer;
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      let within = false;
      try {
        within = Boolean(element?.closest(scope)) && !this.contains(element);
      } catch {
        within = false; // An invalid selector.
      }
      const available = ['available', 'active'].includes(this.#client?.getSnapshot().phase);
      // With several elements, the one holding the conversation answers, else the first visible one.
      const candidates = this.#peers().filter((el) => el.hasAttribute('ask-selection'));
      const handler = candidates.find((el) => el.#view === 'conversation') ?? candidates.find((el) => el.#isRendered()) ?? candidates[0];
      if (!range || selection.isCollapsed || text.length < 3 || !within || !available || handler !== this) {
        this.#selection.text = '';
        this.#hideSelectionButton();
        return;
      }
      this.#selection.text = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      this.#selection.range = range;
      this.#els.selaskLabel.textContent = this.#strings.askSelection;
      const button = this.#els.selask;
      button.setAttribute('data-open', '');
      // In the top layer, so no sticky header or stacking context covers it.
      if (button.showPopover && !button.matches(':popover-open')) button.showPopover();
      this.#placeSelectionButton();
    }, 160);
  };

  #placeSelectionButton = () => {
    const button = this.#els.selask;
    if (!button.hasAttribute('data-open') || !this.#selection.range) return;
    const rect = this.#selection.range.getBoundingClientRect();
    const width = button.offsetWidth || 150;
    const coarse = matchMedia('(pointer: coarse)').matches;
    // Below the selection on touch screens (the system menu sits above it), and
    // when there's no room above: the page's sticky header counts as no room.
    const header = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const top = coarse || rect.top - button.offsetHeight - 10 < header + 8 ? rect.bottom + 10 : rect.top - button.offsetHeight - 10;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), innerWidth - width - 8);
    button.style.top = `${Math.round(top)}px`;
    button.style.left = `${Math.round(left)}px`;
  };

  #askAboutSelection() {
    const text = this.#selection.text;
    if (!text) return;
    this.#hideSelectionButton();
    getSelection()?.removeAllRanges();
    // Elsewhere on the page, another element holds the conversation: the quote goes there.
    const target = this.#view === 'elsewhere' ? this.#ownerElement() ?? this : this;
    target.#takeQuote(text);
  }

  #takeQuote(text) {
    this.#ui.quote = text;
    this.#render();
    const box = this.#els.composer.getBoundingClientRect();
    const visible = box.top >= 0 && box.bottom <= innerHeight && this.#isRendered();
    if (visible || this.#ui.expanded) this.#els.input.focus({ preventScroll: true });
    else this.expand();
  }

  // Theme: the element reads the page's text and background colors, so it fits
  // in with no configuration. --si-* properties always win.
  #themeSoon = () => requestAnimationFrame(() => this.#theme());

  #theme() {
    if (!this.isConnected) return;
    const frame = this.#els.frame;
    frame.style.setProperty('--_auto-ink', getComputedStyle(this).color);
    const page = pageBackground(this);
    frame.style.setProperty('--_auto-page', page ?? 'Canvas');
    const probe = getComputedStyle(this.#els.probe);
    const accent = rgb(probe.color);
    const light = accent ? luminance(accent) > 0.36 : false;
    frame.style.setProperty('--_auto-accent-ink', light ? '#111' : '#fff');
    // The page color in use: --si-page when set, else the one found above.
    const background = rgb(probe.backgroundColor) ?? rgb(page ?? getComputedStyle(document.documentElement).backgroundColor) ?? [255, 255, 255];
    frame.toggleAttribute('data-dark', luminance(background) < 0.35);
  }
}

const INITIAL = { phase: 'loading', messages: [], host: { name: '', title: '', avatar: '', kind: null }, pending: null, activity: null, notice: '', poweredByUrl: '', error: '', busy: false, draft: '', owner: '', followupOffered: false };

// Scrolls a node into view. In a frame, only the frame's own page scrolls:
// scrollIntoView would also scroll the page around a same-origin frame.
function reveal(node, smooth = true) {
  const behavior = smooth && !reducedMotion.matches ? 'smooth' : 'auto';
  if (window.top === window.self) return node.scrollIntoView({ behavior, block: 'center' });
  const box = node.getBoundingClientRect();
  scrollBy({ top: box.top + box.height / 2 - innerHeight / 2, behavior });
}

function from(m) {
  return m.senderType === 'visitor' ? 'visitor' : m.senderType === 'rep' ? 'person' : m.senderType === 'standin' ? 'ai' : 'system';
}

function h(tag, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function split(value) {
  return (value ?? '').split('|').map((s) => s.trim()).filter(Boolean);
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function safeUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value, location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function initials(name) {
  const words = (name || '').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase() || '·';
}

function setAvatar(node, { name, avatar }) {
  const url = safeUrl(avatar);
  const key = `${url}|${name}`;
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  if (url) {
    const img = h('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    img.addEventListener('error', () => node.replaceChildren(initials(name)), { once: true });
    node.replaceChildren(img);
  } else {
    node.replaceChildren(initials(name));
  }
}

function plain(m) {
  if (m.type === 'link-card') {
    const card = parseCard(m.body);
    return String(card.title || card.url || '');
  }
  return markdown(m.body).textContent.replace(/\s+/g, ' ').trim();
}

function pageBackground(element) {
  let node = element.parentElement ?? element.getRootNode().host;
  while (node) {
    const color = rgb(getComputedStyle(node).backgroundColor, true);
    if (color && color[3] > 0.92) return `rgb(${color[0]} ${color[1]} ${color[2]})`;
    node = node.parentElement ?? node.getRootNode()?.host ?? null;
  }
  return null;
}

// Any CSS color to [r, g, b, a], by letting a canvas resolve it.
let paint;
function rgb(color, withAlpha = false) {
  if (!color || color === 'transparent') return null;
  const match = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    return withAlpha ? [+match[1], +match[2], +match[3], alpha] : [+match[1], +match[2], +match[3]];
  }
  paint ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!paint) return null;
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = '#000';
  paint.fillStyle = color;
  paint.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
  return withAlpha ? [r, g, b, a / 255] : [r, g, b];
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Markdown, safely: a small subset built from DOM nodes, never from HTML.
// Paragraphs, headings, lists, quotes, code, bold, italics and http(s) links.
const LIST_ITEM = /^(\s*)([*+-]|\d{1,9}[.)])\s+(.*)$/;
const INLINE = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(?<![\w*])(\*|_)(?=\S)([\s\S]*?\S)\3(?![\w*])|`([^`\n]+)`|\[([^\]\n]+)\]\(\s*(https?:\/\/[^\s)]+)\s*\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"\]])/g;

export function markdown(source) {
  const fragment = document.createDocumentFragment();
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const startsBlock = (line) => /^\s*(```|~~~)|^\s{0,3}(#{1,6}\s|>)/.test(line) || LIST_ITEM.test(line);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      i++;
    } else if ((m = line.match(/^\s*(```|~~~)/))) {
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(m[1]); i++) code.push(lines[i]);
      i++;
      const pre = h('pre');
      const inner = h('code');
      inner.textContent = code.join('\n');
      pre.append(inner);
      fragment.append(pre);
    } else if ((m = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/))) {
      const heading = h('p', 'heading');
      inline(heading, m[1]);
      fragment.append(heading);
      i++;
    } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      fragment.append(h('hr'));
      i++;
    } else if (/^\s{0,3}>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      const quote = h('blockquote');
      quote.append(markdown(quoted.join('\n')));
      fragment.append(quote);
    } else if (LIST_ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      fragment.append(list);
      i = next;
    } else {
      const paragraph = [];
      while (i < lines.length && lines[i].trim() && !(paragraph.length && startsBlock(lines[i]))) paragraph.push(lines[i++]);
      const p = h('p');
      inline(p, paragraph.join('\n'));
      fragment.append(p);
    }
  }
  return fragment;
}

function parseList(lines, start) {
  const stack = [];
  let first = null;
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(LIST_ITEM);
    if (!m) {
      if (!line.trim()) {
        const next = lines.slice(i + 1).findIndex((l) => l.trim());
        if (next >= 0 && LIST_ITEM.test(lines[i + 1 + next])) {
          i += next;
          continue;
        }
        break;
      }
      if (stack.length && /^\s/.test(line)) {
        const li = stack.at(-1).li;
        li.append(' ');
        inline(li, line.trim());
        continue;
      }
      break;
    }
    const indent = m[1].replace(/\t/g, '    ').length;
    const ordered = /\d/.test(m[2]);
    while (stack.length > 1 && indent < stack.at(-1).indent) stack.pop();
    let level = stack.at(-1);
    if (!level || (indent > level.indent + 1 && level.li)) {
      const list = h(ordered ? 'ol' : 'ul');
      const number = parseInt(m[2], 10);
      if (ordered && number > 1) list.start = number;
      if (level) level.li.append(list);
      else first = list;
      level = { indent, list, li: null };
      stack.push(level);
    }
    const li = h('li');
    inline(li, m[3]);
    level.list.append(li);
    level.li = li;
  }
  return [first, i];
}

function inline(parent, source) {
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    text(parent, source.slice(last, m.index));
    if (m[1]) {
      const strong = h('strong');
      inline(strong, m[2]);
      parent.append(strong);
    } else if (m[3]) {
      const em = h('em');
      inline(em, m[4]);
      parent.append(em);
    } else if (m[5] !== undefined) {
      const code = h('code');
      code.textContent = m[5];
      parent.append(code);
    } else {
      const url = safeUrl(m[7] ?? m[8]);
      if (url) {
        const a = h('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = m[6] ?? m[8];
        parent.append(a);
      } else {
        text(parent, m[0]);
      }
    }
    last = m.index + m[0].length;
  }
  text(parent, source.slice(last));
}

function text(parent, value) {
  value.split('\n').forEach((part, i) => {
    if (i) parent.append(h('br'));
    if (part) parent.append(part);
  });
}

const TEMPLATE = `
<div class="frame" data-el="frame">
  <span class="probe" data-el="probe"></span>
  <div class="si" part="root" data-el="si">
    <div class="headline" part="headline" data-el="headline" hidden><slot name="headline"></slot><span data-el="headlineText"></span></div>
    <section class="convo" part="conversation" data-el="convo">
      <div class="sample-label" part="sample-label" data-el="sampleLabel"></div>
      <div class="fold" data-el="headFold"><div class="fold-in">
        <header class="head" part="header" data-el="head">
          <span class="avatar" part="avatar" data-el="avatar"></span>
          <span class="who">
            <span class="name-row"><span class="name" part="name" data-el="name"></span><span class="badge" part="badge" data-el="badge" hidden></span><span class="live" part="live" data-el="live" hidden></span></span>
            <span class="status" part="status" data-el="status"></span>
          </span>
          <span class="tools" part="tools">
            <button class="tool" type="button" part="expand-button" data-el="expand" hidden>${ICONS.expand}</button>
            <button class="tool" type="button" part="collapse-button" data-el="collapse" hidden>${ICONS.collapse}</button>
          </span>
        </header>
      </div></div>
      <div class="fold grow" data-el="logFold"><div class="fold-in">
        <div class="scroller" part="transcript" data-el="scroller">
          <div class="log" role="log" aria-live="polite" aria-relevant="additions" data-el="log"></div>
        </div>
      </div></div>
      <div class="banner" part="banner" role="status" data-el="banner" hidden>
        <span data-el="bannerText"></span>
        <button type="button" part="banner-button" data-el="bannerButton"></button>
      </div>
      <form class="followup" part="followup" data-el="followup" hidden>
        <input type="email" required autocomplete="email" part="followup-input" data-el="email" placeholder="you@example.com" aria-label="Your email">
        <button type="submit" part="followup-button" data-el="emailButton">Send</button>
      </form>
      <div class="fold" data-el="chipsFold"><div class="fold-in"><div class="chips" part="suggestions" data-el="chips"></div></div></div>
      <div class="quote" part="quote" data-el="quote">
        ${ICONS.quote}<span class="quote-text" data-el="quoteText"></span>
        <button type="button" class="tool" data-el="quoteRemove">${ICONS.close}</button>
      </div>
      <form class="composer" part="composer" data-el="composer">
        <span class="lead" aria-hidden="true">${ICONS.lead}${ICONS.spark}</span>
        <textarea class="input" part="input" rows="1" enterkeyhint="send" data-el="input"></textarea>
        <button class="send" type="submit" part="send" data-el="send" disabled>${ICONS.send}</button>
      </form>
      <div class="fold" data-el="footFold"><div class="fold-in">
        <footer class="foot" part="footer" data-el="foot">
          <span class="notice" part="notice" data-el="notice" hidden></span>
          <button class="end" type="button" part="end-button" data-el="end" hidden></button>
          <a class="brand" part="attribution" data-el="brand" target="_blank" rel="noopener noreferrer" hidden><span data-el="brandLabel"></span></a>
        </footer>
      </div></div>
    </section>
    <div class="away" data-el="away" hidden></div>
    <button class="continue" type="button" part="continue" data-el="continue" hidden>${ICONS.lead}<span data-el="continueLabel"></span></button>
    <div class="offline" part="offline" data-el="offline" hidden><slot name="offline"></slot></div>
  </div>
  <div class="row visitor pending" data-el="pending"><div class="row-in"><div class="msg" part="message visitor pending"><div class="bubble" part="bubble"></div></div><div class="pending-status" part="pending-status"><span data-el="pendingStatus"></span> <button type="button" data-el="pendingRetry" hidden></button></div></div></div>
  <div class="row host activity" data-el="activity" aria-hidden="true"><div class="row-in"><div class="msg" part="message host activity"><div class="bubble" part="bubble"></div></div></div></div>
  <div class="dock" part="dock" data-el="dock" inert>
    <div class="dock-top">
      <button class="dock-summary" type="button" part="dock-summary" data-el="dockSummary">
        <span class="avatar small" data-el="dockAvatar"></span>
        <span class="dock-lines">
          <span class="dock-name-row"><span class="dock-name" data-el="dockName"></span><span class="badge" data-el="dockBadge" hidden></span></span>
          <span class="dock-text" data-el="dockText"></span>
          <span class="dots" data-el="dockDots" hidden><i></i><i></i><i></i></span>
        </span>
      </button>
      <button class="tool" type="button" data-el="dockExpand">${ICONS.expand}</button>
      <button class="tool" type="button" data-el="dockClose">${ICONS.close}</button>
    </div>
    <form class="dock-composer" data-el="dockComposer">
      <textarea class="input" rows="1" enterkeyhint="send" part="dock-input" data-el="dockInput"></textarea>
      <button class="send" type="submit" part="dock-send" data-el="dockSend" disabled>${ICONS.send}</button>
    </form>
  </div>
  <dialog class="dialog" part="dialog" data-el="dialog"><div class="sheet" part="sheet" data-el="sheet"></div></dialog>
  <button class="selask" type="button" popover="manual" part="selection-button" data-el="selask">${ICONS.spark}<span data-el="selaskLabel"></span></button>
</div>`;

const CSS = `
:host { display: block; }
:host([hidden]), :host([data-state="offline"]:not([data-offline-content])) { display: none !important; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; }
svg { width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }

.frame {
  --_ink: var(--si-ink, var(--_auto-ink, currentColor));
  --_page: var(--si-page, var(--_auto-page, Canvas));
  --_accent: var(--si-accent, var(--_ink));
  --_accent-ink: var(--si-accent-ink, var(--_auto-accent-ink, #fff));
  --_muted: var(--si-muted, color-mix(in srgb, var(--_ink) 62%, transparent));
  --_line: var(--si-line, color-mix(in srgb, var(--_ink) 15%, transparent));
  --_tint: var(--si-tint, color-mix(in srgb, var(--_ink) 5%, transparent));
  --_surface: var(--si-surface, var(--_page));
  --_visitor: var(--si-visitor-bg, color-mix(in srgb, var(--_accent) 13%, transparent));
  --_visitor-ink: var(--si-visitor-ink, var(--_ink));
  --_radius: var(--si-radius, 14px);
  --_pill: min(999px, calc(var(--_radius) * 3));
  --_leading: var(--si-leading, 1.55);
  --_shadow: var(--si-shadow, 0 1px 2px rgb(0 0 0 / .05), 0 16px 40px -18px rgb(0 0 0 / .3));
  --_lift: 0 30px 80px -24px rgb(0 0 0 / .45), 0 2px 6px rgb(0 0 0 / .06);
  --_max: var(--si-max-height, min(64vh, 620px));
  --_ease: cubic-bezier(.2, .8, .2, 1);
  --_z: var(--si-z, 2147483000);
  font-family: var(--si-font, inherit);
  color: var(--_ink);
  line-height: var(--_leading);
  -webkit-tap-highlight-color: transparent;
}
.frame[data-dark] {
  --_shadow: var(--si-shadow, 0 1px 2px rgb(0 0 0 / .3), 0 18px 44px -18px rgb(0 0 0 / .7));
  --_lift: 0 30px 90px -20px rgb(0 0 0 / .8), 0 0 0 1px rgb(255 255 255 / .06);
}
.probe { position: absolute; width: 0; height: 0; overflow: hidden; color: var(--_accent); background-color: var(--_page); }

/* Shared pieces --------------------------------------------------------- */
.si { position: relative; }
.convo { display: flex; flex-direction: column; min-width: 0; }
/* Suggestions sit under the box, except in a card, where they lead into it. */
.convo > [data-el="headFold"] { order: 0; }
.convo > [data-el="logFold"] { order: 1; }
.convo > .banner { order: 2; }
.convo > .followup { order: 3; }
.convo > .quote { order: 4; }
.convo > .composer { order: 5; }
.convo > [data-el="chipsFold"] { order: 6; }
.convo > [data-el="footFold"] { order: 7; }
.si[data-look="card"] .convo > [data-el="chipsFold"] { order: 3; }
/* Before the conversation, what opens on focus (who answers, the greeting) opens
   below the box, so the box the visitor just clicked stays where it was. */
.si:not([data-view="conversation"]):is([data-look="field"], [data-look="line"], [data-look="whisper"]) .convo > :is([data-el="headFold"], [data-el="logFold"]) { order: 6; }
.si:not([data-view="conversation"]):is([data-look="field"], [data-look="line"], [data-look="whisper"]) .convo > [data-el="chipsFold"] { order: 7; }
.si:not([data-view="conversation"]):is([data-look="field"], [data-look="line"], [data-look="whisper"]) .author.current { display: flex; }
.si:not([data-view="conversation"]):is([data-look="field"], [data-look="line"], [data-look="whisper"]) .log { padding-block: .7em .1em; }
.fold { display: grid; grid-template-rows: 0fr; opacity: 0; visibility: hidden;
  transition: grid-template-rows .42s var(--_ease), opacity .28s ease, visibility 0s .42s; }
.fold[data-open] { grid-template-rows: 1fr; opacity: 1; visibility: visible;
  transition: grid-template-rows .42s var(--_ease), opacity .32s ease .06s, visibility 0s; }
.fold-in { min-height: 0; overflow: hidden; }

.head { display: flex; align-items: center; gap: .65em; min-width: 0; padding-block: .1em .7em; }
.avatar { flex: none; display: grid; place-items: center; width: 2.25em; height: 2.25em; overflow: hidden; border-radius: 50%;
  background: color-mix(in srgb, var(--_accent) 18%, var(--_page)); color: var(--_ink); font-size: .82em; font-weight: 700; letter-spacing: .02em; line-height: 1; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar.small { width: 1.7em; height: 1.7em; font-size: .68em; }
.who { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.head[data-unknown] .avatar { background: var(--_tint); }
.head[data-unknown] .name { width: 7em; height: .8em; border-radius: .4em; background: var(--_tint); }
.name-row { display: flex; align-items: center; gap: .45em; min-width: 0; }
.name { overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.status { overflow: hidden; color: var(--_muted); font-size: .8em; text-overflow: ellipsis; white-space: nowrap; }
.badge { flex: none; padding: .16em .42em .12em; border-radius: .4em; background: color-mix(in srgb, var(--_accent) 15%, transparent);
  color: var(--_ink); font-size: .62em; font-weight: 750; letter-spacing: .08em; line-height: 1.2; }
.live { flex: none; width: .5em; height: .5em; border-radius: 50%; background: #22A55B; box-shadow: 0 0 0 .18em color-mix(in srgb, #22A55B 25%, transparent); }
.tools { display: flex; gap: .15em; margin-inline-start: auto; }
.tool { display: grid; place-items: center; width: 2.1em; height: 2.1em; padding: 0; border: 0; border-radius: .6em; background: transparent; color: var(--_muted); cursor: pointer; }
.tool:hover { background: var(--_tint); color: var(--_ink); }
.tool svg { width: 1.1em; height: 1.1em; }

.scroller { position: relative; max-height: var(--_max); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--_line) transparent; }
.log { display: flex; flex-direction: column; gap: .9em; padding-block: .35em .9em; }
.row { display: grid; grid-template-rows: 1fr; min-width: 0; }
.row-in { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; min-height: 0; }
.row.visitor .row-in { align-items: flex-end; }
.row.system .row-in { align-items: stretch; }
.row.enter { animation: si-grow .42s var(--_ease) both; }
.row.enter > .row-in { overflow: hidden; animation: si-rise .5s var(--_ease) both; }
@keyframes si-grow { from { grid-template-rows: 0fr; } }
@keyframes si-rise { from { opacity: 0; transform: translateY(.45em); } }
.msg { max-width: 100%; min-width: 0; }
.row.visitor .msg { max-width: min(86%, 36em); }
.bubble { overflow-wrap: anywhere; }
.row.visitor .bubble { padding: .5em .85em; border-radius: calc(var(--_radius) * 1.15) calc(var(--_radius) * 1.15) calc(var(--_radius) * .25) calc(var(--_radius) * 1.15);
  background: var(--_visitor); color: var(--_visitor-ink); }
.author { display: flex; align-items: center; gap: .45em; margin-bottom: .3em; color: var(--_muted); font-size: .8em; font-weight: 600; line-height: 1.3; }
.author .badge { font-size: .74em; }
.row.visitor .author, .author.current { display: none; }
.si[data-look="whisper"] .author.current, .si[data-look="whisper"] .row.visitor .author { display: flex; }
.author-name { color: var(--_ink); }
.system-note { display: flex; align-items: center; gap: .75em; width: 100%; color: var(--_muted); font-size: .78em; text-align: center; }
.system-note::before, .system-note::after { content: ''; flex: 1; height: 1px; background: var(--_line); }

.bubble > :first-child { margin-top: 0; }
.bubble > :last-child { margin-bottom: 0; }
.bubble p { margin: 0 0 .6em; }
.bubble .heading { margin: .9em 0 .35em; font-weight: 700; }
.bubble ul, .bubble ol { margin: .35em 0 .7em; padding-inline-start: 1.35em; }
.bubble li { margin: .22em 0; padding-inline-start: .15em; }
.bubble li::marker { color: var(--_muted); }
.bubble a { color: inherit; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--_accent) 70%, transparent); text-decoration-thickness: .08em; text-underline-offset: .18em; }
.bubble a:hover { text-decoration-color: currentColor; }
.bubble code { padding: .08em .32em; border-radius: .3em; background: var(--si-code-bg, var(--_tint)); font-family: var(--si-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: .88em; }
.bubble pre { margin: .5em 0 .8em; padding: .8em 1em; overflow-x: auto; border-radius: calc(var(--_radius) - 4px); background: var(--si-code-bg, var(--_tint)); font-size: .86em; line-height: 1.5; }
.bubble pre code { padding: 0; background: none; font-size: 1em; }
.bubble blockquote { margin: .3em 0 .7em; padding-inline-start: .8em; border-inline-start: 3px solid color-mix(in srgb, var(--_accent) 55%, transparent); color: var(--_muted); }
.bubble hr { height: 1px; margin: .9em 0; border: 0; background: var(--_line); }
.bubble.streaming > :last-child::after { content: ''; display: inline-block; width: .5em; height: 1em; margin-inline-start: .15em; vertical-align: -.12em; border-radius: 1px; background: currentColor; opacity: .5; animation: si-caret 1s steps(2) infinite; }
@keyframes si-caret { 50% { opacity: 0; } }

.link { display: grid; gap: .15em; max-width: 30em; padding: .75em .95em; border: 1px solid var(--_line); border-radius: var(--_radius); background: var(--_surface); color: inherit; text-decoration: none; transition: border-color .15s; }
.link:hover { border-color: color-mix(in srgb, var(--_accent) 65%, var(--_line)); }
.link-title { font-weight: 650; }
.link-description { color: var(--_muted); font-size: .9em; }
.link-host { display: inline-flex; align-items: center; gap: .25em; color: var(--_muted); font-size: .78em; }

.pending .msg { opacity: .72; }
.pending[data-failed] .bubble { outline: 1px dashed color-mix(in srgb, var(--_ink) 35%, transparent); }
.pending-status { margin-top: .3em; color: var(--_muted); font-size: .76em; }
.pending-status button { padding: 0; border: 0; background: none; color: var(--_ink); font-weight: 650; text-decoration: underline; cursor: pointer; }
.pending:not([data-failed]) .pending-status button { display: none; }
.activity .bubble { color: var(--_muted); }
.dots { display: inline-flex; gap: .24em; padding-block: .45em; }
.dots i { width: .42em; height: .42em; border-radius: 50%; background: currentColor; opacity: .3; animation: si-dot 1.2s infinite ease-in-out; }
.dots i:nth-child(2) { animation-delay: .16s; }
.dots i:nth-child(3) { animation-delay: .32s; }
@keyframes si-dot { 0%, 80%, 100% { opacity: .25; transform: none; } 40% { opacity: .85; transform: translateY(-.2em); } }

.banner { display: flex; flex-wrap: wrap; align-items: center; gap: .5em .9em; margin-block: .2em .8em; padding: .65em .85em; border-radius: calc(var(--_radius) - 3px); background: var(--_tint); font-size: .88em; line-height: 1.4; }
.banner button, .followup button { padding: .45em .85em; border: 0; border-radius: var(--_pill); background: var(--_accent); color: var(--_accent-ink); font-weight: 650; line-height: 1.2; cursor: pointer; }
.banner button:disabled { opacity: .5; }
.followup { display: flex; flex-wrap: wrap; gap: .5em; margin-block: 0 .8em; }
.followup input { flex: 1 1 14em; min-width: 0; padding: .55em .8em; border: 1px solid var(--_line); border-radius: calc(var(--_radius) - 4px); background: var(--_surface); color: inherit; font: inherit; }
.followup input:focus { outline: 2px solid color-mix(in srgb, var(--_accent) 55%, transparent); outline-offset: 1px; }

.chips { display: flex; flex-wrap: wrap; gap: .45em; padding: .75em .15em .2em; }
.chip { padding: .42em .9em; border: 1px solid var(--_line); border-radius: var(--_pill); background: transparent; color: var(--_ink); font-size: .86em; line-height: 1.3; text-align: start; cursor: pointer;
  transition: border-color .15s, background-color .15s, transform .15s; }
.chip:hover:not(:disabled) { border-color: color-mix(in srgb, var(--_accent) 60%, var(--_line)); background: color-mix(in srgb, var(--_accent) 8%, transparent); }
.chip:active:not(:disabled) { transform: scale(.97); }
.chip:disabled { opacity: .5; cursor: default; }
.fold[data-open] .chip { animation: si-rise .45s var(--_ease) both; animation-delay: calc(var(--i, 0) * 45ms + 60ms); }

.quote { display: none; align-items: flex-start; gap: .55em; margin-block: .2em .6em; padding: .55em .5em .55em .8em; border-inline-start: 3px solid var(--_accent); border-radius: .35em; background: var(--_tint); color: var(--_muted); font-size: .86em; line-height: 1.45; }
.quote[data-open] { display: flex; animation: si-rise .3s var(--_ease); }
.quote > svg { margin-top: .15em; color: var(--_accent); }
.quote-text { display: -webkit-box; flex: 1; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; font-style: italic; }
.quote .tool { width: 1.7em; height: 1.7em; margin-top: -.15em; }

.composer { position: relative; display: flex; align-items: flex-end; gap: .5em; min-width: 0; }
.lead { display: none; align-self: center; color: var(--_muted); line-height: 0; }
.lead svg { width: 1.15em; height: 1.15em; }
.lead svg + svg { display: none; }
.input { flex: 1; min-width: 0; margin: 0; padding: .5em 0; overflow-y: auto; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; line-height: 1.45; resize: none; max-height: 12em; }
.input::placeholder { color: var(--_muted); opacity: 1; }
.input:placeholder-shown { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.input:disabled { cursor: not-allowed; }
.send { display: grid; flex: none; place-items: center; width: 2.3em; height: 2.3em; padding: 0; border: 0; border-radius: var(--_pill); background: var(--_accent); color: var(--_accent-ink); cursor: pointer;
  transition: opacity .18s, transform .18s var(--_ease), background-color .18s; }
.send svg { width: 1.15em; height: 1.15em; stroke-width: 2.2; }
.send:hover:not(:disabled) { transform: translateY(-1px); }
.send:disabled { opacity: .3; cursor: default; }
.si[data-waiting] .send { animation: si-wait 1s ease-in-out infinite; }
@keyframes si-wait { 50% { opacity: .35; } }
.composer[hidden] { display: none; }

.foot { display: flex; flex-wrap: wrap; align-items: center; gap: .35em 1em; padding-top: .6em; color: var(--_muted); font-size: .76em; line-height: 1.4; }
.notice { flex-basis: 100%; }
.end { padding: 0; border: 0; background: none; color: var(--_muted); text-decoration: underline; text-underline-offset: .2em; cursor: pointer; }
.end:hover { color: var(--_ink); }
.brand { display: inline-flex; align-items: center; gap: .35em; margin-inline-start: auto; color: var(--_muted); text-decoration: none; }
.brand:hover { color: var(--_ink); }

.continue { display: inline-flex; align-items: center; gap: .5em; padding: .5em .95em; border: 1px dashed var(--_line); border-radius: var(--_pill); background: transparent; color: var(--_ink); font-size: .9em; cursor: pointer; }
.continue:hover { border-style: solid; border-color: var(--_accent); }
.continue svg { color: var(--_accent); }
.away { border-radius: var(--_radius); background: var(--_tint); }
.sample-label { display: none; order: -1; margin-bottom: .8em; color: var(--_muted); font-size: .72em; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
.convo[data-sample] .sample-label { display: block; }
.sheet .convo[data-sample] .sample-label { margin: 0; padding: .7em clamp(1em, 4vw, 2.2em) 0; }
.si:is([data-look="card"], [data-look="field"][data-view="conversation"]) .sample-label { margin: 0; padding: .85em 1.1em 0; }
.headline { margin: 0 0 .5em; font-size: var(--si-stage-size, clamp(2em, 1.1em + 3.2vw, 3.6em)); font-weight: var(--si-stage-weight, 650); line-height: 1.04; letter-spacing: -.025em; text-wrap: balance; }

:focus-visible { outline: 2px solid color-mix(in srgb, var(--_accent) 70%, transparent); outline-offset: 2px; }
.input:focus-visible { outline: 0; }

/* whisper: a line of text in the page ------------------------------------ */
.si[data-look="whisper"] .composer { max-width: 34em; gap: .45em; border-bottom: 1px dashed color-mix(in srgb, var(--_ink) 30%, transparent); align-items: center; transition: border-color .2s; }
.si[data-look="whisper"] .composer:focus-within { border-bottom: 1px solid var(--_accent); }
.si[data-look="whisper"] .lead { display: block; color: var(--_accent); }
.si[data-look="whisper"] .lead svg:first-child { display: none; }
.si[data-look="whisper"] .lead svg + svg { display: block; animation: si-breathe 4.5s ease-in-out infinite; }
.si[data-look="whisper"][data-engaged] .lead svg + svg, .si[data-look="whisper"][data-view="conversation"] .lead svg + svg { animation: none; }
@keyframes si-breathe { 0%, 70%, 100% { opacity: 1; transform: none; } 85% { opacity: .45; transform: scale(.82) rotate(20deg); } }
.si[data-look="whisper"] .input { padding: .3em 0; }
.si[data-look="whisper"] .send { width: 1.75em; height: 1.75em; opacity: 0; transform: scale(.7); pointer-events: none; }
.si[data-look="whisper"][data-has-text] .send { opacity: 1; transform: none; pointer-events: auto; }
.si[data-look="whisper"] .send:disabled { opacity: 0; }
.si[data-look="whisper"][data-has-text] .send:disabled { opacity: .3; }
.si[data-look="whisper"] .head { gap: .5em; padding-bottom: .4em; font-size: .88em; }
.si[data-look="whisper"] .head .avatar { width: 1.9em; height: 1.9em; }
.si[data-look="whisper"] .who { flex-direction: row; align-items: baseline; gap: .6em; }
.si[data-look="whisper"][data-view="conversation"] .convo, .si[data-look="whisper"][data-engaged] .convo { padding-inline-start: 1em; border-inline-start: 2px solid color-mix(in srgb, var(--_accent) 38%, transparent); transition: padding .3s var(--_ease), border-color .3s; }
.si[data-look="whisper"] .convo { border-inline-start: 2px solid transparent; }
.si[data-look="whisper"] .row.visitor .row-in { align-items: flex-start; }
.si[data-look="whisper"] .row.visitor .msg { max-width: 100%; }
.si[data-look="whisper"] .row.visitor .bubble { padding: 0; border-radius: 0; background: none; font-weight: 600; }
.si[data-look="whisper"] .chips { padding-top: .6em; }
.si[data-look="whisper"] .chip { font-size: .82em; }

/* line: a sentence-sized prompt with a rule --------------------------------- */
.si[data-look="line"] .composer { align-items: center; border-bottom: 2px solid var(--_line); transition: border-color .2s; }
.si[data-look="line"] .composer:focus-within { border-bottom-color: var(--_accent); }
.si[data-look="line"] .input { padding: .45em 0; font-size: 1.12em; }
.si[data-look="line"] .send { width: 2.15em; height: 2.15em; border: 1.5px solid var(--_line); background: transparent; color: var(--_ink); }
.si[data-look="line"][data-has-text] .send { border-color: transparent; background: var(--_accent); color: var(--_accent-ink); }
.si[data-look="line"] .send:disabled { opacity: .45; }
.si[data-look="line"][data-has-text] .send:disabled { opacity: .3; }

/* field: a box that looks like search ------------------------------------ */
.si[data-look="field"] .composer { align-items: center; padding: .3em .3em .3em .85em; border: 1px solid var(--_line); border-radius: var(--_radius); background: var(--_surface); box-shadow: 0 1px 2px rgb(0 0 0 / .04); transition: border-color .2s, box-shadow .2s; }
.si[data-look="field"] .composer:focus-within { border-color: color-mix(in srgb, var(--_accent) 70%, var(--_line)); box-shadow: 0 0 0 .22em color-mix(in srgb, var(--_accent) 16%, transparent); }
.si[data-look="field"] .lead { display: block; }
.si[data-look="field"] .send { border-radius: calc(var(--_radius) - .3em); }
/* In conversation, the field itself unfolds: same border, the box at the bottom. */
.si[data-look="field"][data-view="conversation"] .convo { overflow: hidden; border: 1px solid var(--_line); border-radius: calc(var(--_radius) * 1.15); background: var(--_surface); box-shadow: var(--_shadow); }
.si[data-look="field"][data-view="conversation"] .head { padding: .8em 1em; border-bottom: 1px solid var(--_line); }
.si[data-look="field"][data-view="conversation"] .scroller { padding-inline: 1em; }
.si[data-look="field"][data-view="conversation"] .log { padding-block: 1em .8em; }
.si[data-look="field"][data-view="conversation"] .banner,
.si[data-look="field"][data-view="conversation"] .followup,
.si[data-look="field"][data-view="conversation"] .quote { margin-inline: 1em; }
.si[data-look="field"][data-view="conversation"] .composer { padding: .35em .35em .35em 1em; border: 0; border-top: 1px solid var(--_line); border-radius: 0; box-shadow: none; }
.si[data-look="field"][data-view="conversation"] .convo:focus-within { border-color: color-mix(in srgb, var(--_accent) 55%, var(--_line)); }
.si[data-look="field"][data-view="conversation"] .lead { display: none; }
.si[data-look="field"][data-view="conversation"] .foot { padding: 0 1em .7em; }

/* card: a contained conversation --------------------------------------------- */
.si[data-look="card"] .convo { overflow: hidden; border: 1px solid var(--_line); border-radius: calc(var(--_radius) * 1.3); background: var(--_surface); box-shadow: var(--_shadow); }
.si[data-look="card"] .head { padding: .95em 1.1em; border-bottom: 1px solid var(--_line); }
.si[data-look="card"] .scroller { padding-inline: 1.1em; }
.si[data-look="card"] .log { padding-block: 1.05em .6em; }
.si[data-look="card"] .banner, .si[data-look="card"] .followup, .si[data-look="card"] .quote { margin-inline: 1.1em; }
.si[data-look="card"] .chips { padding: .1em 1.1em .1em; }
.si[data-look="card"] .composer { margin: .75em; padding: .25em .25em .25em .9em; border: 1px solid transparent; border-radius: var(--_radius); background: var(--_tint); transition: border-color .2s, background-color .2s; }
.si[data-look="card"] .composer:focus-within { border-color: color-mix(in srgb, var(--_accent) 60%, var(--_line)); background: var(--_surface); }
.si[data-look="card"] .send { border-radius: calc(var(--_radius) - .25em); }
.si[data-look="card"] .foot { margin-top: -.25em; padding: 0 1.1em .85em; }

/* stage: the conversation is the hero ------------------------------------------ */
.si[data-look="stage"] .composer { align-items: center; padding: .45em .45em .45em 1.25em; border-radius: calc(var(--_radius) * 1.8); background: var(--_surface); box-shadow: var(--_shadow), 0 0 0 1px var(--_line); font-size: 1.12em; transition: box-shadow .25s; }
.si[data-look="stage"] .composer:focus-within { box-shadow: var(--_shadow), 0 0 0 2px color-mix(in srgb, var(--_accent) 70%, transparent); }
.si[data-look="stage"] .send { width: 2.6em; height: 2.6em; }
.si[data-look="stage"] .chips { gap: .55em; padding-top: 1em; }
.si[data-look="stage"] .chip { padding: .55em 1.05em; border-color: color-mix(in srgb, var(--_ink) 22%, transparent); background: color-mix(in srgb, var(--_page) 35%, transparent); font-size: .94em; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.si[data-look="stage"] .log { font-size: 1.08em; }
.si[data-look="stage"][data-view="conversation"] .head { padding-bottom: .9em; }

/* The focused view ------------------------------------------------------------- */
.dialog { width: 100%; max-width: none; height: 100%; max-height: none; margin: 0; padding: 0; overflow: hidden; border: 0; background: transparent; color: var(--_ink); font: inherit; }
.dialog::backdrop { background: rgb(12 12 14 / .38); -webkit-backdrop-filter: blur(7px) saturate(.85); backdrop-filter: blur(7px) saturate(.85); animation: si-fade .3s ease; }
@keyframes si-fade { from { opacity: 0; } }
.dialog[open] { display: grid; place-items: center; }
.sheet { display: flex; flex-direction: column; width: min(780px, calc(100% - 32px)); height: min(88vh, 900px); overflow: hidden; border-radius: calc(var(--_radius) * 1.5); background: var(--_surface); box-shadow: var(--_lift); }
.sheet > .convo { flex: 1; min-height: 0; }
.sheet .fold { transition: none; }
.sheet .fold[data-el="logFold"] { flex: 1; min-height: 0; }
.sheet .fold[data-el="logFold"] > .fold-in { display: flex; flex-direction: column; }
.sheet .scroller { flex: 1; max-height: none; padding-inline: clamp(1em, 4vw, 2.2em); }
.sheet .log { padding-block: 1.4em 1em; font-size: 1.04em; }
.sheet .head { padding: .95em clamp(1em, 4vw, 2.2em); border-bottom: 1px solid var(--_line); }
.sheet .composer { margin: .4em clamp(.75em, 3vw, 1.8em) 0; padding: .3em .3em .3em 1em; border: 1px solid var(--_line); border-radius: calc(var(--_radius) * 1.15); background: transparent; box-shadow: none; font-size: 1em; }
.sheet .composer:focus-within { border-color: color-mix(in srgb, var(--_accent) 65%, var(--_line)); }
.sheet .lead { display: none; }
.sheet .banner, .sheet .followup, .sheet .quote { margin-inline: clamp(1em, 4vw, 2.2em); }
.sheet .foot { padding: .6em clamp(1em, 4vw, 2.2em) 1em; }
.sheet .chips { display: none; }
.sheet:is([data-look="field"], [data-look="card"]) .send { border-radius: calc(var(--_radius) - .3em); }
@media (max-width: 640px) {
  .sheet { width: 100%; height: 100%; border-radius: 0; }
}

/* The dock: follows the visitor through the page --------------------------------- */
.dock { position: fixed; bottom: max(14px, env(safe-area-inset-bottom)); left: 50%; z-index: var(--_z); display: grid; gap: .45em;
  width: min(560px, calc(100% - 20px)); padding: .55em .55em .55em .75em; border-radius: calc(var(--_radius) * 1.5); background: var(--_surface); color: var(--_ink);
  box-shadow: var(--_lift), 0 0 0 1px var(--_line); font-size: .95em; opacity: 0; pointer-events: none; transform: translate(-50%, 130%);
  transition: transform .45s var(--_ease), opacity .3s ease; }
.dock[data-open] { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
.dock-top { display: flex; align-items: center; gap: .2em; min-width: 0; }
.dock-summary { display: flex; flex: 1; align-items: center; gap: .6em; min-width: 0; padding: .2em .3em .2em 0; border: 0; background: none; text-align: start; cursor: pointer; }
.dock-lines { display: grid; min-width: 0; line-height: 1.3; }
.dock-name-row { display: flex; align-items: center; gap: .4em; font-size: .82em; font-weight: 650; }
.dock-text { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--_muted); font-size: .9em; }
.dock .dots { padding-block: .3em; color: var(--_muted); }
.dock-composer { display: flex; align-items: flex-end; gap: .4em; padding: .15em .15em .15em .8em; border: 1px solid var(--_line); border-radius: calc(var(--_radius) * 1.1); background: transparent; }
.dock-composer:focus-within { border-color: color-mix(in srgb, var(--_accent) 65%, var(--_line)); }
.dock .input { padding: .42em 0; }
.dock .send { width: 2em; height: 2em; }

.selask { position: fixed; inset: auto; z-index: var(--_z); display: none; align-items: center; gap: .45em; margin: 0; padding: .5em .9em .5em .75em; border: 0; border-radius: 999px;
  background: var(--si-selection-bg, #16181B); color: var(--si-selection-ink, #fff); box-shadow: 0 10px 30px -8px rgb(0 0 0 / .45); font-size: .86rem; font-weight: 650; line-height: 1.2; cursor: pointer; }
.selask[data-open] { display: inline-flex; animation: si-pop .2s var(--_ease); }
.selask svg { width: 1.05em; height: 1.05em; }
@keyframes si-pop { from { opacity: 0; transform: translateY(4px) scale(.96); } }

@media (prefers-reduced-motion: reduce) {
  .frame *, .frame *::before, .frame *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
}
@media (forced-colors: active) {
  .composer, .convo, .chip, .dock, .sheet { border: 1px solid CanvasText; }
  .send { border: 1px solid ButtonText; }
}
@media print { .dock, .selask, .composer, .chips { display: none !important; } }
`;

if (!customElements.get('stand-inline')) customElements.define('stand-inline', StandInline);

export { StandInline };
