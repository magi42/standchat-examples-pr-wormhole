// What the chat screen shows, worked out from Stand's state: blocks of text
// for replies, the visitor's own lines, notices, link cards and speaker labels.
// It decides what appears and when; screen.js decides where and how.
//
// It also sends: the visitor's lines queue here and go to Stand one at a time,
// each shown at once and confirmed when Stand has it.

import { safeUrl } from './stand-client.js';

// Visitor-facing card notices. Unknown card types are never shown.
const CARDS = {
  'handoff': (c) => `${c.repName || 'A person from the team'} joined the chat.`,
  'human-transfer': (c) => `Your chat moved to ${c.repName || 'a person from the team'}.`,
  'standin-takeover': (c) => `${c.standinName || 'An AI Stand-in'} (AI Stand-in) is covering the info desk.`,
  'session-end': () => 'The chat has ended.',
  'rep-followup-offer': (c) => `${c.repName || 'The team'} can follow up by email: choose Email below.`,
  'rep-followup-confirmation': () => 'Follow-up requested. Watch your inbox.',
};

// What a system card says to the visitor, or null for cards that stay hidden.
export function describeCard(body) {
  try {
    const card = JSON.parse(body);
    const label = CARDS[card?.cardType];
    const extra = typeof card.message === 'string' && card.message.trim() ? ` ${card.message.trim()}` : '';
    return label ? label(card) + extra : null;
  } catch {
    return null;
  }
}

// Markdown-ish text to styled runs: **bold** and `code` print bright, links
// are clickable, headings and bullets stay plain. Never HTML.
export function format(text, messageId = null) {
  const runs = [];
  const source = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s+(.*)$/gm, '**$1**')
    .replace(/^(\s*)[*•]\s+/gm, '$1• ')
    .replace(/^(\s*)-\s+/gm, '$1• ');
  const pattern = /\*\*(.+?)\*\*|__(.+?)__|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  const plain = (s) => s.replace(/(^|\W)[*_](\S[^*_\n]*?)[*_](?=\W|$)/g, '$1$2');
  for (const m of source.matchAll(pattern)) {
    if (m.index > last) runs.push({ text: plain(source.slice(last, m.index)) });
    if (m[1] ?? m[2]) runs.push({ text: m[1] ?? m[2], style: 'bright' });
    else if (m[3]) runs.push({ text: m[3], style: 'bright' });
    else {
      const label = m[4] ?? m[6];
      const url = safeUrl(m[5] ?? m[6]);
      runs.push(url ? { text: label, style: 'link', link: { url, messageId } } : { text: label });
    }
    last = m.index + m[0].length;
  }
  if (last < source.length) runs.push({ text: plain(source.slice(last)) });
  return runs;
}

let nextId = 1;

export class Transcript {
  #client;
  #state = null;
  #seen = new Set(); // canonical messages already on screen
  #echoes = []; // the visitor's lines, shown before Stand confirms them
  #outbox = []; // lines typed while a send is in flight, sent in order
  #greeting = null; // the greeting block, before the conversation exists
  #preview = null; // a streamed AI reply: { turnId, block }
  #lastError = null;
  #lastSpeaker = null;
  #carrierLost = false;
  #restored = false;
  #welcomeBack = false;

  constructor({ client, now, onBlock }) {
    this.#client = client;
    this.now = now; // () => seconds
    this.onBlock = onBlock ?? (() => {});
    this.blocks = [];
    this.version = 0; // bumps whenever blocks change
    this.typing = false;
  }

  // -- Blocks ----------------------------------------------------------------------

  #add(block) {
    const b = { id: nextId++, born: this.now(), reveal: 'fade', align: 'left', palette: 'copper', ...block };
    this.blocks.push(b);
    this.version++;
    this.onBlock(b);
    return b;
  }

  #remove(block) {
    this.blocks = this.blocks.filter((b) => b !== block);
    this.version++;
  }

  #change(block, patch) {
    Object.assign(block, patch);
    this.version++;
  }

  #label(kind, state) {
    if (this.#lastSpeaker === kind) return;
    this.#lastSpeaker = kind;
    if (kind !== 'host') return;
    const host = state?.host ?? {};
    const who = host.kind === 'rep' ? 'from the team' : host.kind === 'standin' ? 'AI Stand-in' : '';
    this.#add({ kind: 'label', runs: [{ text: [host.name || 'Info desk', who].filter(Boolean).join(' · ') }], palette: 'dust', reveal: 'fade' });
  }

  notice(text, palette = 'dust') {
    const runs = [{ text: `✦ ${text} ✦` }];
    const last = this.blocks.at(-1);
    if (last?.kind === 'notice' && last.runs[0].text === runs[0].text) return last; // said already
    this.#lastSpeaker = 'system';
    return this.#add({ kind: 'notice', runs, align: 'center', palette, reveal: 'fade' });
  }

  #say(state, body, { messageId = null, reveal = 'writer', turnId = null } = {}) {
    this.#label('host', state);
    return this.#add({ kind: 'host', runs: format(body, messageId), messageId, turnId, reveal });
  }

  #linkCard(card, messageId, reveal) {
    const url = safeUrl(card.url);
    if (!url) return;
    this.#label('host', this.#state);
    const link = { url, messageId, card: true };
    const runs = [{ text: String(card.title || url).trim(), style: 'bright', link }];
    const description = String(card.description ?? '').trim();
    if (description) runs.push({ text: `\n${description}`, style: 'dim', link });
    runs.push({ text: `\n${url}`, style: 'link', link });
    this.#add({ kind: 'link', runs, messageId, reveal });
  }

  // -- Called by the page ------------------------------------------------------------

  // Shows the greeting before a conversation exists: the scroller's words.
  showGreeting(state, reveal = 'instant') {
    if (this.#greeting || state.messages.length || state.phase !== 'available') return this.#greeting;
    this.#label('host', state);
    this.#greeting = this.#add({ kind: 'host', runs: format(state.greeting || 'Hi! What can I help you with?'), reveal, greeting: true });
    this.#client.showGreeting(state.greeting);
    return this.#greeting;
  }

  // The visitor pressed Enter with text. Returns true when it was taken.
  send(text, from = null) {
    const phase = this.#state?.phase;
    const body = text.trim();
    if (!body) return false;
    if (phase !== 'available' && phase !== 'active') {
      if (phase === 'ended' || phase === 'uncertain') this.notice('This chat is closed. Choose New chat to start again.', 'alert');
      else if (phase === 'unavailable') this.notice('Nobody is at the info desk right now. Try again in a moment.', 'alert');
      else this.notice('Still connecting, one moment…');
      return false;
    }
    if (phase === 'available' && !this.#greeting) this.showGreeting(this.#state);
    this.#lastSpeaker = 'visitor';
    const block = this.#add({ kind: 'visitor', runs: [{ text: body }], align: 'right', palette: 'ice', reveal: from ? 'send' : 'fade', from, status: 'sending' });
    this.#echoes.push({ body, clientMessageId: null, block });
    this.#outbox.push(body);
    this.#pump();
    return true;
  }

  // Sends queued lines one at a time: Stand confirms each before the next.
  #pump() {
    const state = this.#client.state;
    if (!this.#outbox.length || state.busy || state.pending || !['available', 'active'].includes(state.phase)) return;
    const body = this.#outbox.shift();
    const echo = this.#echoes.find((e) => e.body === body && !e.clientMessageId && !e.sent);
    if (echo) echo.sent = true;
    this.#client.setDraft(body);
    void this.#client.send();
    if (echo) echo.clientMessageId = this.#client.state.pending?.clientMessageId ?? null;
  }

  // Stand's state changed.
  update(state) {
    const previous = this.#state;
    this.#state = state;

    // After a reload, the saved conversation comes back at once, while the
    // client reconnects (or as it was, if it had ended). Only what arrives
    // after that is news.
    if (!this.#restored && (state.messages.length || state.phase !== 'loading')) {
      this.#restored = true;
      if (state.messages.length) {
        this.#print(state, 'instant');
        this.#welcomeBack = true;
      }
    }
    if (this.#welcomeBack && state.phase !== 'loading') {
      this.#welcomeBack = false;
      if (state.phase === 'active') this.notice('Welcome back. The chat is still open.');
    }
    this.#print(state, 'writer');
    this.#printPreview(state);
    this.#transitions(previous, state);
    this.#pump();
    this.#markPending(state);
    const typing = state.phase === 'active' && (state.typing || Boolean(state.busy && !state.pending && this.#echoes.length));
    if (typing !== this.typing) {
      this.typing = typing;
      this.version++;
    }
  }

  #markPending(state) {
    for (const echo of this.#echoes) {
      const failed = !state.busy && state.pending && echo.clientMessageId === state.pending.clientMessageId && Boolean(state.error);
      const status = failed ? 'failed' : 'sending';
      if (echo.block.status !== status) this.#change(echo.block, { status });
    }
  }

  // Prints canonical messages that aren't on screen yet, in order.
  #print(state, reveal) {
    for (const m of state.messages) {
      if (this.#seen.has(m.messageId)) continue;
      this.#seen.add(m.messageId);
      if (m.type === 'system-prompt' || m.senderType === 'system-prompt') continue;
      if (m.type === 'text' || m.type === 'standin-idle-prompt') {
        if (m.senderType === 'visitor') {
          const echo = this.#echoes.find((e) => (e.clientMessageId && e.clientMessageId === m.clientMessageId) || (!e.clientMessageId && e.body === m.body.trim()));
          if (echo) {
            this.#echoes = this.#echoes.filter((e) => e !== echo);
            this.#change(echo.block, { status: null, messageId: m.messageId });
            continue;
          }
          this.#lastSpeaker = 'visitor';
          this.#add({ kind: 'visitor', runs: [{ text: m.body }], align: 'right', palette: 'ice', reveal: reveal === 'instant' ? 'instant' : 'fade', messageId: m.messageId });
          continue;
        }
        // The opening greeting comes back from Stand as the first message.
        if (this.#greeting && m.body.trim() === this.#greeting.runs.map((r) => r.text).join('').trim()) {
          this.#change(this.#greeting, { messageId: m.messageId, greeting: false });
          this.#greeting = null;
          continue;
        }
        if (this.#preview && (!m.turnId || m.turnId === this.#preview.turnId)) {
          this.#change(this.#preview.block, { runs: format(m.body, m.messageId), messageId: m.messageId, preview: false });
          this.#preview = null;
          continue;
        }
        this.#say(state, m.body, { messageId: m.messageId, reveal, turnId: m.turnId });
      } else if (m.type === 'link-card') {
        try {
          this.#linkCard(JSON.parse(m.body), m.messageId, reveal === 'instant' ? 'instant' : 'fade');
        } catch {
          // Malformed cards are skipped.
        }
      } else if (m.type === 'system-card' || m.senderType === 'system-card') {
        let card;
        try {
          card = JSON.parse(m.body);
        } catch {
          continue;
        }
        if (card?.cardType === 'session-start') continue; // the label already says who answers
        const text = describeCard(m.body);
        if (text) this.notice(text, card.cardType === 'handoff' || card.cardType === 'human-transfer' ? 'link' : 'dust');
      }
    }
  }

  // A streamed AI reply appears before it is complete.
  #printPreview(state) {
    const preview = state.preview;
    if (!preview) {
      if (this.#preview && !state.typing) {
        this.#remove(this.#preview.block);
        this.#preview = null;
      }
      return;
    }
    if (this.#preview?.turnId === preview.turnId) this.#change(this.#preview.block, { runs: format(preview.text) });
    else this.#preview = { turnId: preview.turnId, block: this.#say(state, preview.text, { reveal: 'writer' }) };
    this.#preview.block.preview = true;
  }

  #transitions(previous, state) {
    if (previous?.phase !== state.phase) {
      if (state.phase === 'ended' && previous?.phase === 'active') {
        if (state.pending) this.notice(`Not confirmed before the chat ended: "${state.pending.body}"`, 'alert');
        this.notice('Choose New chat to start again.');
      }
      if (state.phase === 'uncertain') this.notice('Could not confirm whether your chat started. Choose New chat to try again.', 'alert');
      if (state.phase === 'unavailable' && previous) this.notice('Nobody is at the info desk right now. Try again in a moment.', 'alert');
      if (['ended', 'unavailable', 'uncertain'].includes(state.phase)) {
        if (this.#outbox.length) this.notice(`Not sent: ${this.#outbox.map((t) => `"${t}"`).join(', ')}`, 'alert');
        this.#outbox = [];
        // Lines Stand never confirmed stay on screen, marked as such.
        for (const echo of this.#echoes) this.#change(echo.block, { status: 'unconfirmed' });
        this.#echoes = [];
      }
    }
    if (state.phase === 'active' && previous?.phase === 'active' && previous.connection !== state.connection) {
      if (state.connection === 'offline' && previous.connection === 'online' && !this.#carrierLost) {
        this.#carrierLost = true;
        this.notice('Connection lost. Reconnecting…', 'alert');
      } else if (state.connection === 'online' && this.#carrierLost) {
        this.#carrierLost = false;
        this.notice('Connected again.');
      }
    }
    if (state.phase !== 'active') this.#carrierLost = false;
    if (state.error && state.error !== this.#lastError) this.notice(state.error, 'alert');
    this.#lastError = state.error;
  }

  // New chat: the old conversation stays on screen above a divider.
  reset() {
    this.#echoes = [];
    this.#outbox = [];
    this.#greeting = null;
    this.#preview = null;
    this.#lastSpeaker = null;
    this.notice('New chat');
  }

  // The last thing the responder said, for the scroller while the chat is closed.
  lastReply() {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      if (b.kind === 'host' && !b.preview) return { id: b.id, text: b.runs.map((r) => r.text).join('') };
    }
    return null;
  }
}
