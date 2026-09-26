// A thread, drawn as an annotation card: the questions, the answers with who
// wrote them, and what's happening now. Also the question box. Dark inside the
// code panel, light next to the prose; the markup is the same.

import { el } from './dom.js';
import { renderRich } from './richtext.js';

const PERSON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.6" r="2.6"/><path d="M3 13.6c.6-2.6 2.6-3.9 5-3.9s4.4 1.3 5 3.9"/></svg>';

export function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

function clock(sentAt) {
  const ms = Date.parse(String(sentAt ?? '').replace(/(\.\d{3})\d+/, '$1'));
  if (!Number.isFinite(ms)) return null;
  const t = el('time');
  t.dateTime = new Date(ms).toISOString();
  t.textContent = new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return t;
}

export function avatar({ kind, name, image }) {
  const a = el('span', `an-avatar${kind === 'standin' ? ' is-host' : kind === 'rep' ? ' is-rep' : ''}`);
  a.setAttribute('aria-hidden', 'true');
  if (kind === 'visitor') a.innerHTML = PERSON;
  else if (image && /^https?:\/\//.test(image)) {
    const img = el('img');
    img.alt = '';
    img.src = image;
    img.addEventListener('error', () => a.replaceChildren(initials(name)), { once: true });
    a.append(img);
  } else a.textContent = initials(name);
  return a;
}

export function badge(kind) {
  if (kind === 'standin') return Object.assign(el('span', 'badge is-ai', 'AI'), { title: 'An AI Stand-in answered' });
  if (kind === 'rep') return Object.assign(el('span', 'badge is-team', 'Team'), { title: 'A person from the team answered' });
  return null;
}

/**
 * A card for one thread. update() redraws only the parts whose content changed,
 * so focus inside the card (say, on Reply) survives new messages.
 */
export class ThreadCard {
  constructor(key, theme, handlers) {
    this.key = key;
    this.handlers = handlers;
    this.root = el('section', `an${theme === 'light' ? ' is-light' : ''}`);
    this.root.tabIndex = -1;
    this.root.dataset.thread = key;
    this.head = el('div', 'an-head');
    this.list = el('ol', 'an-msgs');
    this.status = el('p', 'an-status');
    this.actions = el('div', 'an-actions');
    this.replyHost = el('div', 'an-reply');
    this.root.append(this.head, this.list, this.status, this.actions, this.replyHost);
    this.sig = {};

    this.replyButton = el('button', 'link-btn is-strong', 'Reply');
    this.replyButton.type = 'button';
    this.replyButton.addEventListener('click', () => handlers.reply(this.key));
    this.resolveButton = el('button', 'link-btn', 'Resolve');
    this.resolveButton.type = 'button';
    this.resolveButton.addEventListener('click', () => handlers.resolve(this.key));
    this.actions.append(this.replyButton, this.resolveButton);
  }

  update(thread, ctx) {
    this.root.setAttribute('aria-label', ctx.label);
    const set = (part, sig, draw) => {
      if (this.sig[part] === sig) return;
      this.sig[part] = sig;
      draw();
    };

    set('head', ctx.quote ?? ctx.heading ?? '', () => {
      this.head.replaceChildren();
      if (ctx.quote) {
        const q = el('p', 'an-quote');
        q.append(el('span', 'an-quote-text', `“${ctx.quote}”`));
        this.head.append(q);
      } else if (ctx.heading) {
        this.head.append(el('p', 'an-quote', ctx.heading));
      }
    });

    const items = thread.items.map((i) => i.m.messageId).join(',');
    set('list', `${items}|${thread.pending?.body ?? ''}|${ctx.lang}|${ctx.pendingState}`, () => {
      this.list.replaceChildren(...thread.items.map((item) => this.#message(item, ctx)));
      if (thread.pending) this.list.append(this.#pending(thread.pending, ctx));
    });

    set('status', ctx.status ? JSON.stringify(ctx.status) : '', () => this.#drawStatus(ctx.status));

    this.replyButton.hidden = !ctx.canReply;
    this.actions.hidden = !ctx.canReply && ctx.phase !== 'active' && ctx.phase !== 'available';
  }

  #message(item, ctx) {
    const li = el('li', `an-msg is-${item.kind === 'visitor' ? 'visitor' : 'host'}`);
    const body = el('div');
    const meta = el('p', 'an-meta');
    if (item.kind === 'visitor') {
      li.append(avatar({ kind: 'visitor' }));
      meta.append(el('b', '', 'You'));
      if (ctx.where?.(item.anchor)) meta.append(el('span', 'an-where', ctx.where(item.anchor)));
    } else {
      li.append(avatar({ kind: item.author.kind, name: item.author.name, image: item.author.kind === ctx.host.kind ? ctx.host.avatar : '' }));
      meta.append(el('b', '', item.author.name));
      const b = badge(item.author.kind);
      if (b) meta.append(b);
    }
    const time = clock(item.m.sentAt);
    if (time) meta.append(time);
    body.append(meta);

    if (item.kind === 'link') body.append(this.#link(item));
    else {
      const text = el('div', 'an-text');
      if (item.kind === 'visitor') text.append(renderRich(item.question));
      else text.append(renderRich(item.m.body, { reference: ctx.reference, link: (url, a) => a.addEventListener('click', () => ctx.linkClick(item.m.messageId, url)) }));
      body.append(text);
    }
    li.append(body);
    return li;
  }

  #link(item) {
    let card = {};
    try {
      card = JSON.parse(item.m.body);
    } catch {
      // A malformed card shows as nothing rather than as raw JSON.
    }
    let url;
    try {
      url = new URL(card.url);
    } catch {
      return el('div', 'an-text', 'A link was shared, but it could not be shown.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return el('div', 'an-text', 'A link was shared, but it could not be shown.');
    const a = el('a', 'an-linkcard');
    a.href = url.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(el('b', '', typeof card.title === 'string' && card.title ? card.title : url.hostname));
    if (typeof card.description === 'string' && card.description) a.append(el('span', '', card.description));
    a.append(el('small', '', `${url.hostname} ↗`));
    a.addEventListener('click', () => this.handlers.linkClick(item.m.messageId, url.href));
    return a;
  }

  #pending(pending, ctx) {
    const li = el('li', 'an-msg is-visitor is-pending');
    li.append(avatar({ kind: 'visitor' }));
    const body = el('div');
    const meta = el('p', 'an-meta');
    meta.append(el('b', '', 'You'));
    if (ctx.pendingState === 'failed') {
      meta.append(el('span', 'an-failed', 'Not delivered'));
      const retry = el('button', 'link-btn is-strong', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => this.handlers.retry());
      meta.append(retry);
    } else {
      meta.append(el('span', 'an-sending', 'Sending…'));
    }
    const text = el('div', 'an-text');
    text.append(renderRich(pending.question));
    body.append(meta, text);
    li.append(body);
    return li;
  }

  #drawStatus(status) {
    this.status.replaceChildren();
    this.status.className = `an-status${status?.error ? ' is-error' : ''}`;
    this.status.hidden = !status;
    if (!status) return;
    if (status.typing) {
      const dots = el('span', 'an-typing');
      dots.setAttribute('aria-hidden', 'true');
      dots.append(el('i'), el('i'), el('i'));
      this.status.append(dots, `${status.typing}`);
      if (status.preview) this.status.append(el('span', 'an-preview', status.preview));
    } else if (status.text) {
      this.status.append(status.text);
    }
  }
}

/** Where the Tender team's tip would go if it were a thread. Authored content, not a chat. */
export function tipCard({ onAsk, onHide }) {
  const root = el('aside', 'tip');
  root.setAttribute('aria-label', 'Tip from the Tender team');
  root.innerHTML = `<div class="tip-in">
    <span class="tip-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6 12.5h4M6.6 14.5h2.8M8 1.8a4.4 4.4 0 0 0-2.6 8c.4.3.6.8.6 1.2V11h4v.1c0-.5.2-.9.6-1.3A4.4 4.4 0 0 0 8 1.8z"/></svg></span>
    <div>
      <p class="tip-meta"><b>Tip</b> From the Tender docs team</p>
      <p>Amounts are in the currency's smallest unit, so <code>2000</code> is $20.00. In zero-decimal currencies like JPY, <code>2000</code> is ¥2,000.</p>
    </div>
    <div class="tip-actions"><button class="link-btn is-strong" type="button" data-tip="ask">Ask about this line</button><button class="link-btn" type="button" data-tip="hide">Hide tip</button></div>
  </div>`;
  root.querySelector('[data-tip="ask"]').addEventListener('click', onAsk);
  root.querySelector('[data-tip="hide"]').addEventListener('click', onHide);
  return root;
}

/** The question box. One at a time: app.js moves it to wherever the visitor asks. */
export class Composer {
  constructor({ onSend, onCancel, onInput }) {
    this.root = el('form', 'cmp');
    this.root.noValidate = true;
    this.head = el('p', 'cmp-head');
    this.quote = el('p', 'cmp-quote');
    this.label = el('label', 'sr-only');
    this.field = el('textarea');
    this.field.rows = 2;
    this.field.id = 'tn-ask-field';
    this.label.htmlFor = this.field.id;
    this.note = el('p', 'cmp-note');
    this.note.setAttribute('role', 'status');
    const foot = el('div', 'cmp-foot');
    this.who = el('p', 'cmp-who');
    this.who.style.margin = '0';
    const buttons = el('span', 'cmp-btns');
    this.cancel = el('button', 'btn is-quiet', 'Cancel');
    this.cancel.type = 'button';
    this.send = el('button', 'btn', 'Ask');
    this.send.type = 'submit';
    buttons.append(this.cancel, this.send);
    foot.append(this.who, buttons);
    this.fine = el('p', 'cmp-fine');
    this.notice = el('p', 'cmp-notice');
    this.root.append(this.head, this.quote, this.label, this.field, this.note, foot, this.fine, this.notice);

    this.root.addEventListener('submit', (e) => {
      e.preventDefault();
      onSend();
    });
    this.cancel.addEventListener('click', () => onCancel());
    this.field.addEventListener('input', () => {
      onInput(this.field.value);
      this.send.disabled = this.blocked || !this.field.value.trim();
      this.#grow();
    });
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!this.send.disabled) this.root.requestSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    });
  }

  // Grows with the question where field-sizing isn't supported.
  #grow() {
    if (CSS.supports?.('field-sizing', 'content')) return;
    this.field.style.height = 'auto';
    this.field.style.height = `${Math.min(200, this.field.scrollHeight + 2)}px`;
  }

  setTheme(theme) {
    this.root.classList.toggle('is-light', theme === 'light');
  }

  /** { head: Node[], quote, placeholder, label, who: Node[], fine: Node[], note: { text, action, warn }, canSend, notice } */
  show(view) {
    this.head.replaceChildren(...view.head);
    this.head.hidden = !view.head.length;
    this.quote.textContent = view.quote ? `“${view.quote}”` : '';
    this.quote.hidden = !view.quote;
    this.field.placeholder = view.placeholder;
    this.label.textContent = view.label;
    this.who.replaceChildren(...view.who);
    this.fine.replaceChildren(...(view.fine ?? []));
    this.fine.hidden = !view.fine?.length;
    this.note.replaceChildren();
    this.note.hidden = !view.note;
    if (view.note) {
      this.note.className = `cmp-note${view.note.warn ? ' is-warn' : ''}`;
      this.note.append(view.note.text);
      if (view.note.action) {
        const b = el('button', 'link-btn', view.note.action.label);
        b.type = 'button';
        b.addEventListener('click', view.note.action.run);
        this.note.append(' ', b);
      }
    }
    this.blocked = !view.canSend;
    this.send.disabled = this.blocked || !this.field.value.trim();
    this.field.disabled = Boolean(view.lockField);
    this.notice.textContent = view.notice ?? '';
    this.notice.hidden = !view.notice;
  }
}
