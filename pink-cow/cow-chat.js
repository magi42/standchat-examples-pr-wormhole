// The chat card that unfolds out of the cow: a small custom chat UI on Stand's
// Visitor API, rendered from the StandClient's state. Plain DOM, no framework.
// Its metrics (header height, corner radius, fonts) match the paper card the
// stage folds, so the two can cross-fade.

import { safeUrl } from './stand-client.js';
import { GLYPH_COLOR, SPOT_COLOR, spotIconPolygons } from './cow-glyph.js';

/** Humans can take a while; the dots stop after this. */
const THINKING_TIMEOUT_MS = 45_000;
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SYSTEM_LABELS = {
  handoff: 'A person from the team joined the chat.',
  'human-transfer': 'Your conversation moved to a person on the team.',
  'standin-takeover': 'An AI Stand-in joined the chat.',
  'session-end': 'Conversation ended.',
  'rep-followup-offer': 'The team offered to follow up by email.',
  'rep-followup-confirmation': 'Your follow-up request was received.',
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const isSpoken = (message) => message.type === 'text' || message.type === 'standin-idle-prompt';

// Paragraphs, simple lists, bold, italics and links: enough for chat replies, never HTML.
const INLINE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])|\*\*([^*\n]+)\*\*|(?<![\w*])[*_]([^*_\n]+)[*_](?![\w*])/g;

function inline(text, onLink) {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) fragment.append(text.slice(last, match.index));
    const [whole, label, labelUrl, bareUrl, bold, italic] = match;
    const url = safeUrl(labelUrl || bareUrl);
    if (bold) fragment.append(el('strong', '', bold));
    else if (italic) fragment.append(el('em', '', italic));
    else if (url) {
      const link = el('a', 'pc-link', label || bareUrl);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', () => onLink(url));
      fragment.append(link);
    } else fragment.append(whole);
    last = match.index + whole.length;
  }
  if (last < text.length) fragment.append(text.slice(last));
  return fragment;
}

function richText(body, onLink) {
  const fragment = document.createDocumentFragment();
  for (const block of body.trim().split(/\n{2,}/)) {
    const lines = block.split('\n');
    const bullets = lines.every((line) => /^\s*[-*•]\s+/.test(line));
    const numbered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
    if (bullets || numbered) {
      const list = el(bullets ? 'ul' : 'ol', 'pc-list');
      for (const line of lines) {
        const item = el('li');
        item.append(inline(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), onLink));
        list.append(item);
      }
      fragment.append(list);
    } else {
      const paragraph = el('p', 'pc-p');
      paragraph.append(inline(block, onLink));
      fragment.append(paragraph);
    }
  }
  return fragment;
}

export function spotIconSvg(size = 48) {
  const { blob, glyph } = spotIconPolygons(0, 0, size);
  const points = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size * 0.82}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size * 0.82);
  svg.setAttribute('aria-hidden', 'true');
  for (const [shape, color] of [[blob, SPOT_COLOR], ...glyph.map((g) => [g, GLYPH_COLOR])]) {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', points(shape));
    polygon.setAttribute('fill', color);
    svg.append(polygon);
  }
  return svg;
}

/**
 * @param {object} options
 * @param {import('./stand-client.js').StandClient} options.client  Mounted by the card; released on destroy.
 * @param {{ title: string, subtitle: string, greeting: string, suggestions: string[], placeholder: string, links: {label: string, href: string}[] }} options.copy
 * @param {() => void} options.onClose
 * @param {(thinking: boolean) => void} [options.onThinking]  True while a reply is on its way.
 * @param {(name: string, detail?: object) => void} [options.onEvent]  chat-started, link-clicked.
 */
export class CowChat {
  #client;
  #copy;
  #onClose;
  #onThinking;
  #onEvent;
  #root;
  #parts = {};
  #unsubscribe = null;
  #unmount = null;
  #state = null;
  #keepAtBottom = true;
  #firstSend; // the suggestion that started the chat, or null for typed text
  #reportedStart = false;
  #waitingFor = null;
  #gaveUpOn = null;
  #thinkTimer = null;
  #thinking = false;
  #shown = false;
  #onKey = (event) => this.#keydown(event);
  #onDocumentKey = (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && this.#shown) this.#close();
  };

  constructor({ client, copy, onClose, onThinking, onEvent }) {
    this.#client = client;
    this.#copy = copy;
    this.#onClose = onClose;
    this.#onThinking = onThinking;
    this.#onEvent = onEvent;
    this.#root = this.#build();
  }

  get element() {
    return this.#root;
  }

  /** Add the card to the page (hidden) and connect the client. */
  mount(parent = document.body) {
    parent.append(this.#root);
    this.#unsubscribe = this.#client.subscribe((state) => this.#render(state));
    this.#unmount = this.#client.mount();
    document.addEventListener('keydown', this.#onDocumentKey);
  }

  setRect({ left, top, width, height }) {
    Object.assign(this.#root.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  /** Fade in once the folding card has landed, and take focus. */
  show() {
    if (this.#shown) return;
    this.#shown = true;
    this.#root.classList.add('pc-chat--shown');
    // Touch devices get the dialog, so the keyboard does not cover the cow straight away.
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const target = !touch && !this.#parts.composer.disabled ? this.#parts.composer : this.#root;
    target.focus({ preventScroll: true });
  }

  hide() {
    this.#shown = false;
    this.#root.classList.remove('pc-chat--shown');
  }

  destroy() {
    document.removeEventListener('keydown', this.#onDocumentKey);
    clearTimeout(this.#thinkTimer);
    this.#unsubscribe?.();
    this.#unmount?.();
    this.#root.remove();
  }

  // Building ------------------------------------------------------------------

  #build() {
    const id = `pc-${Math.random().toString(36).slice(2, 8)}`;
    const root = el('div', 'pc-chat');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', `${id}-title`);
    root.setAttribute('aria-describedby', `${id}-subtitle`);
    root.tabIndex = -1;
    root.addEventListener('keydown', this.#onKey);

    const header = el('header', 'pc-chat__header');
    header.append(spotIconSvg(48));
    const titles = el('div', 'pc-chat__titles');
    const title = el('h2', 'pc-chat__title', this.#copy.title);
    title.id = `${id}-title`;
    const subtitle = el('p', 'pc-chat__subtitle', this.#copy.subtitle);
    subtitle.id = `${id}-subtitle`;
    titles.append(title, subtitle);
    const close = el('button', 'pc-chat__close');
    close.type = 'button';
    close.setAttribute('aria-label', "Close the pink cow's chat");
    close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
    close.addEventListener('click', () => this.#close());
    header.append(titles, close);

    const host = el('div', 'pc-chat__host');
    const who = el('p', 'pc-chat__who');
    const avatar = el('span', 'pc-chat__avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const name = el('b', 'pc-chat__name', 'Stand team');
    const role = el('span', 'pc-chat__role');
    who.append(avatar, name, role);
    const status = el('p', 'pc-chat__status');
    status.setAttribute('role', 'status');
    const dot = el('i');
    dot.setAttribute('aria-hidden', 'true');
    const statusLabel = el('span', '', 'Checking…');
    status.append(dot, statusLabel);
    host.append(who, status);

    const log = el('div', 'pc-chat__log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-label', 'Conversation');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-relevant', 'additions text');
    log.addEventListener('scroll', () => {
      this.#keepAtBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    });

    const foot = el('div', 'pc-chat__foot');
    const error = el('p', 'pc-chat__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const notice = el('p', 'pc-chat__notice');
    notice.hidden = true;

    const form = el('form', 'pc-chat__composer');
    const label = el('label', 'pc-sr', 'Message');
    label.htmlFor = `${id}-message`;
    const composer = el('textarea', 'pc-chat__input');
    composer.id = `${id}-message`;
    composer.rows = 1;
    composer.placeholder = this.#copy.placeholder;
    composer.addEventListener('input', () => {
      this.#client.setDraft(composer.value);
      composer.style.height = 'auto';
      composer.style.height = `${Math.min(composer.scrollHeight, 104)}px`;
    });
    composer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!this.#parts.send.disabled) form.requestSubmit();
      }
    });
    const send = el('button', 'pc-chat__send');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Send message');
    send.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    form.append(label, composer, send);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#send();
    });

    const ended = el('div', 'pc-chat__ended');
    ended.hidden = true;
    const endedText = el('span');
    const newChat = el('button', 'pc-chat__text-button', 'New chat');
    newChat.type = 'button';
    newChat.addEventListener('click', () => {
      this.#keepAtBottom = true;
      void this.#client.newChat();
    });
    ended.append(endedText, newChat);

    const retry = el('button', 'pc-chat__text-button pc-chat__retry', 'Retry message');
    retry.type = 'button';
    retry.hidden = true;
    retry.addEventListener('click', () => void this.#client.send());
    const reconnect = el('button', 'pc-chat__text-button pc-chat__retry', 'Try again');
    reconnect.type = 'button';
    reconnect.hidden = true;
    reconnect.addEventListener('click', () => void this.#client.retry());

    const links = el('p', 'pc-chat__links');
    const built = el('span');
    built.append('Built on the Stand visitor API.');
    this.#copy.links.forEach((item, index) => {
      built.append(index === 0 ? ' ' : ' · ');
      const link = el('a', 'pc-link', item.label);
      link.href = item.href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.addEventListener('click', () => this.#onEvent?.('link-clicked', { url: item.href }));
      built.append(link);
    });
    const powered = el('a', 'pc-chat__powered', 'Powered by Stand');
    powered.target = '_blank';
    powered.rel = 'noopener noreferrer';
    powered.hidden = true;
    powered.addEventListener('click', () => this.#client.badgeClick());
    links.append(built, powered);

    foot.append(error, notice, form, ended, retry, reconnect, links);
    root.append(header, host, log, foot);
    this.#parts = { avatar, name, role, dot, statusLabel, log, error, notice, form, composer, send, ended, endedText, retry, reconnect, powered };
    return root;
  }

  // Behaviour -----------------------------------------------------------------

  #send(text) {
    const client = this.#client;
    if (text !== undefined) {
      client.setDraft(text);
      // The suggestions disappear once used; keep focus inside the dialog.
      this.#root.focus({ preventScroll: true });
    }
    const body = (text ?? client.state.draft).trim();
    if (!body) return;
    this.#keepAtBottom = true;
    if (this.#firstSend === undefined) this.#firstSend = text ?? null;
    void client.send();
  }

  #close() {
    // The cow leaves for good, so its conversation ends with it.
    if (this.#client.state.phase === 'active') void this.#client.end();
    this.#onClose();
  }

  #keydown(event) {
    if (event.key !== 'Tab') return;
    const focusable = [...this.#root.querySelectorAll(FOCUSABLE)].filter((node) => !node.hidden && node.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === this.#root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  #trackLink(messageId, url) {
    this.#onEvent?.('link-clicked', { url });
    if (messageId) void this.#client.trackLinkClick(messageId, url);
  }

  // Rendering -----------------------------------------------------------------

  #render(state) {
    this.#state = state;
    const p = this.#parts;
    const spoken = state.messages.filter(isSpoken);
    const lastSpoken = spoken[spoken.length - 1];
    const visitorSpoke = spoken.some((m) => m.senderType === 'visitor') || Boolean(state.pending);
    const canCompose = state.phase === 'available' || state.phase === 'active';

    // Count a chat once Stand has created the conversation, not on the attempt.
    if (state.phase === 'active' && !this.#reportedStart) {
      this.#reportedStart = true;
      this.#onEvent?.('chat-started', { suggestion: this.#firstSend ?? null });
    }

    // Header row: responder and connection.
    const hostName = state.host.name && state.host.name !== 'Stand' ? state.host.name : 'Stand team';
    const hostRole = state.host.kind === 'standin' ? 'AI Stand-in' : state.host.kind === 'rep' ? 'Team' : '';
    p.name.textContent = hostName;
    p.role.textContent = hostRole ? ` · ${hostRole}` : '';
    const avatarUrl = safeUrl(state.host.avatar);
    if (avatarUrl && p.avatar.dataset.src !== avatarUrl) {
      p.avatar.dataset.src = avatarUrl;
      p.avatar.style.backgroundImage = `url("${avatarUrl.replace(/"/g, '%22')}")`;
    }
    const status = state.phase === 'loading' ? 'Checking…'
      : state.phase === 'available' || (state.phase === 'active' && state.connection === 'online') ? 'Online'
        : state.phase === 'active' ? 'Reconnecting…'
          : state.phase === 'ended' ? 'Chat ended' : 'Resting';
    p.statusLabel.textContent = status;
    p.dot.classList.toggle('pc-chat__dot--online', status === 'Online');

    // The greeting is shown before any message; Stand records it as the opening line.
    const showGreeting = !state.messages.some((m) => isSpoken(m) && m.senderType !== 'visitor');
    if (showGreeting && canCompose) this.#client.showGreeting(state.greeting || this.#copy.greeting);

    // Thinking: a reply is on its way. Streamed previews replace the dots.
    const awaiting = state.phase === 'active' && (state.typing || Boolean(state.pending) || lastSpoken?.senderType === 'visitor');
    const waitingFor = awaiting ? state.pending?.clientMessageId ?? lastSpoken?.messageId ?? 'typing' : null;
    if (waitingFor !== this.#waitingFor) {
      this.#waitingFor = waitingFor;
      clearTimeout(this.#thinkTimer);
      if (waitingFor !== null) this.#thinkTimer = setTimeout(() => { this.#gaveUpOn = waitingFor; this.#render(this.#state); }, THINKING_TIMEOUT_MS);
    }
    const thinking = waitingFor !== null && this.#gaveUpOn !== waitingFor && !state.preview;
    if (thinking !== this.#thinking) {
      this.#thinking = thinking;
      this.#onThinking?.(thinking);
    }

    this.#renderLog(state, { showGreeting, visitorSpoke, canCompose, thinking });

    // Footer.
    p.error.hidden = !state.error;
    p.error.textContent = state.error || '';
    p.notice.hidden = !state.notice;
    p.notice.textContent = state.notice || '';
    const over = state.phase === 'ended' || state.phase === 'uncertain';
    p.form.hidden = over;
    p.ended.hidden = !over;
    p.endedText.textContent = state.phase === 'ended' ? 'This conversation has ended.' : 'The first message may not have arrived.';
    p.composer.disabled = !canCompose || state.busy || Boolean(state.pending);
    p.composer.placeholder = canCompose ? this.#copy.placeholder : state.phase === 'loading' ? 'Opening the cow…' : 'The cow is resting';
    if (document.activeElement !== p.composer && p.composer.value !== state.draft) p.composer.value = state.draft;
    p.send.disabled = p.composer.disabled || !state.draft.trim();
    p.retry.hidden = !(state.pending && !state.busy && state.phase === 'active');
    p.reconnect.hidden = !(!state.pending && !state.busy && (state.phase === 'unavailable' || (state.phase === 'active' && state.connection === 'offline')));
    const attribution = safeUrl(state.poweredByUrl);
    p.powered.hidden = !attribution;
    if (attribution) p.powered.href = attribution;
  }

  #renderLog(state, { showGreeting, visitorSpoke, canCompose, thinking }) {
    const log = this.#parts.log;
    const children = [];
    const hostBubble = (content) => {
      const row = el('div', 'pc-row');
      const bubble = el('div', 'pc-msg pc-msg--host');
      bubble.append(el('span', 'pc-sr', 'Stand: '), content);
      row.append(bubble);
      return row;
    };

    if (showGreeting) children.push(hostBubble(richText(state.greeting || this.#copy.greeting, (url) => this.#trackLink(null, url))));

    for (const message of state.messages) {
      const node = this.#renderMessage(message);
      if (node) children.push(node);
    }
    if (state.pending && !state.messages.some((m) => m.clientMessageId === state.pending.clientMessageId)) {
      const row = el('div', 'pc-row pc-row--visitor');
      const bubble = el('div', 'pc-msg pc-msg--visitor pc-msg--pending');
      bubble.append(el('p', 'pc-p', state.pending.body), el('p', 'pc-msg__meta', state.busy ? 'Sending…' : 'Not delivered yet'));
      row.append(bubble);
      children.push(row);
    }
    if (state.preview?.text) {
      const bubble = el('p', 'pc-p pc-msg--preview', state.preview.text);
      children.push(hostBubble(bubble));
    } else if (thinking) {
      const row = el('div', 'pc-row');
      row.setAttribute('role', 'status');
      row.setAttribute('aria-label', 'Waiting for a reply');
      const dots = el('div', 'pc-msg pc-msg--host pc-thinking');
      for (let i = 0; i < 3; i += 1) dots.append(el('i'));
      row.append(dots);
      children.push(row);
    }
    if (state.phase === 'unavailable') {
      const note = el('div', 'pc-msg--note');
      note.append("The cow's chat is resting right now. ");
      const [first] = this.#copy.links;
      if (first) {
        note.append('You can still see what custom chat UIs can do at ');
        const link = el('a', 'pc-link', first.href.replace(/^https?:\/\//, '').replace(/\/$/, ''));
        link.href = first.href;
        link.target = '_blank';
        link.rel = 'noopener';
        note.append(link, '.');
      }
      children.push(note);
    }
    if (canCompose && !visitorSpoke && state.messages.length === 0 && this.#copy.suggestions.length) {
      const chips = el('div', 'pc-chips');
      chips.setAttribute('aria-label', 'Suggested questions');
      for (const suggestion of this.#copy.suggestions) {
        const chip = el('button', 'pc-chip', suggestion);
        chip.type = 'button';
        chip.disabled = state.busy;
        chip.addEventListener('click', () => this.#send(suggestion));
        chips.append(chip);
      }
      children.push(chips);
    }
    if (state.followupOffered && state.phase === 'active') children.push(this.#followupForm(state));

    log.replaceChildren(...children);
    if (this.#keepAtBottom) log.scrollTop = log.scrollHeight;
  }

  #renderMessage(message) {
    if (message.type === 'system-prompt' || message.senderType === 'system-prompt') return null;
    if (isSpoken(message)) {
      const visitor = message.senderType === 'visitor';
      const row = el('div', visitor ? 'pc-row pc-row--visitor' : 'pc-row');
      const bubble = el('div', visitor ? 'pc-msg pc-msg--visitor' : 'pc-msg pc-msg--host');
      bubble.append(el('span', 'pc-sr', visitor ? 'You: ' : 'Stand: '));
      if (visitor) bubble.append(el('p', 'pc-p', message.body));
      else bubble.append(richText(message.body, (url) => this.#trackLink(message.messageId, url)));
      row.append(bubble);
      return row;
    }
    let card;
    try {
      card = JSON.parse(message.body);
      if (!card || typeof card !== 'object' || Array.isArray(card)) return null;
    } catch {
      return null;
    }
    if (message.type === 'link-card') {
      const url = safeUrl(card.url);
      if (!url) return null;
      const link = el('a', 'pc-card');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', () => this.#trackLink(message.messageId, url));
      link.append(el('span', 'pc-card__title', typeof card.title === 'string' ? card.title : url));
      if (typeof card.description === 'string') link.append(el('span', 'pc-card__text', card.description));
      return link;
    }
    if (message.type !== 'system-card' || typeof card.cardType !== 'string') return null;
    const label = SYSTEM_LABELS[card.cardType];
    return label ? el('p', 'pc-system', label) : null;
  }

  #followupForm(state) {
    const form = el('form', 'pc-followup');
    const id = `${this.#root.getAttribute('aria-labelledby')}-email`;
    const label = el('label', 'pc-followup__label', 'Your email');
    label.htmlFor = id;
    const help = el('p', 'pc-followup__help', 'The team will follow up on this conversation.');
    const row = el('div', 'pc-followup__row');
    const input = el('input', 'pc-followup__input');
    input.id = id;
    input.type = 'email';
    input.autocomplete = 'email';
    input.required = true;
    input.disabled = state.busy;
    const submit = el('button', 'pc-followup__send', 'Send');
    submit.type = 'submit';
    submit.disabled = state.busy;
    row.append(input, submit);
    form.append(label, help, row);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#client.submitEmail(input.value);
    });
    return form;
  }
}
