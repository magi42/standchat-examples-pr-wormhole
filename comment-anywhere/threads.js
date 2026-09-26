// Comment threads over one Stand conversation. No DOM.
//
// Every pin on the page is a thread, but they all share a single Stand session:
// one chat for the site owner, however many pins a visitor drops. Each visitor
// message starts with the pin marker and the place it's about:
//
//   📍 Pricing › Professional › “$16”: Is that per person?
//
// That prefix is the thread's identity. The team reads exactly where on the page
// each question was asked, and after a reload the threads rebuild from the
// transcript alone. Replies belong to the thread of the latest visitor message
// before them.

import { isConversation, parseCard } from './stand-visitor.js';

export const MARKER = '📍';
const PREFIX = /^📍\s*([^\n]+?):[ \t]+([\s\S]*)$/u;
const RATIO = String.fromCharCode(0x2236); // "∶" looks like a colon, but never ends a label
const REPLY_DUE = 60000; // how long a thread waits for its answer before others open up again

/** A label is one line with no colon in it, so the first ": " always ends the prefix. */
export function cleanLabel(label) {
  return String(label).replace(/📍/gu, '').replace(/:/g, RATIO).replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function formatComment(label, text) {
  return `${MARKER} ${cleanLabel(label)}: ${String(text).trim()}`;
}

/** { label, text } for a pinned comment, or null for anything else. */
export function parseComment(body) {
  const match = PREFIX.exec(String(body));
  return match ? { label: match[1].trim(), text: match[2] } : null;
}

/**
 * Groups the conversation into threads, in the order they were started.
 *
 * threads: [{ label, entries, started, lastSeq, lastReplySeq }], where an entry is
 *   { key, seq, from: 'visitor' | 'standin' | 'rep', type: 'text' | 'link', text, messageId, sentAt, status? }
 * cards: conversation-wide notices (handoff, takeover, follow-up offer, end), in order.
 * names: who answered as the AI and as a person, from the transcript's cards.
 * current: the thread of the latest comment, where the next reply will land.
 * waitingOn: the label of the thread whose answer is due, while one is.
 */
export function buildThreads(state, now = Date.now()) {
  const threads = new Map();
  const cards = [];
  const names = { standin: '', rep: '' };
  let current = null;

  const thread = (label) => {
    if (!threads.has(label)) {
      threads.set(label, { label, entries: [], started: Infinity, lastSeq: -1, lastReplySeq: -1 });
    }
    return threads.get(label);
  };
  const add = (t, entry) => {
    t.entries.push(entry);
    t.started = Math.min(t.started, entry.seq);
    t.lastSeq = Math.max(t.lastSeq, entry.seq);
    if (entry.from !== 'visitor') t.lastReplySeq = Math.max(t.lastReplySeq, entry.seq);
  };

  for (const m of state.messages) {
    if (m.type === 'system-card' || m.senderType === 'system-card') {
      const card = systemCard(m);
      if (card) cards.push({ ...card, thread: current?.label ?? '' });
      const standin = text(parseCard(m.body).standinName);
      if (standin) names.standin = standin;
      if (card?.type === 'handoff' && card.name) names.rep = card.name;
      continue;
    }
    if (!isConversation(m)) continue; // Hides system-prompt: our own prompt comes back as one.
    const from = m.senderType === 'visitor' ? 'visitor' : m.senderType === 'rep' ? 'rep' : 'standin';
    const base = { key: m.messageId, messageId: m.messageId, seq: m.seq, from, sentAt: m.sentAt };

    if (from === 'visitor') {
      const parsed = parseComment(m.body);
      current = thread(parsed ? parsed.label : 'This page');
      add(current, { ...base, type: 'text', text: parsed ? parsed.text : m.body });
    } else if (m.type === 'link-card') {
      const link = linkCard(m.body);
      if (link) add(current ?? thread('This page'), { ...base, type: 'link', text: link.title, link });
    } else {
      add(current ?? thread('This page'), { ...base, type: 'text', text: m.body });
    }
  }

  // The visitor's unconfirmed message: "Sending…", or "Not delivered" with a retry.
  const pending = state.pending;
  let pendingLabel = '';
  if (pending?.body) {
    const parsed = parseComment(pending.body);
    pendingLabel = parsed ? parsed.label : 'This page';
    const t = thread(pendingLabel);
    add(t, {
      key: `pending:${pending.clientMessageId || 'new'}`,
      seq: Number.MAX_SAFE_INTEGER,
      from: 'visitor',
      type: 'text',
      text: parsed ? parsed.text : pending.body,
      status: state.busy ? 'sending' : 'failed',
    });
  }

  // While an answer is due, other threads wait: replies are routed by order, so
  // a second question elsewhere would get the first one's answer. An unconfirmed
  // message holds everything too: the next send retries it, under its own ID.
  let waitingOn = pendingLabel;
  if (!waitingOn && state.phase === 'active') {
    const last = state.messages.findLast(isConversation);
    const recent = last?.senderType === 'visitor' && now - time(last.sentAt) < REPLY_DUE;
    if ((state.activity?.kind === 'thinking' || recent) && last?.senderType === 'visitor') {
      waitingOn = parseComment(last.body)?.label ?? 'This page';
    }
  }

  return { threads: [...threads.values()], byLabel: threads, cards, names, current: pendingLabel || current?.label || '', waitingOn };
}

// Conversation-wide notices. Everything else (session-start, link-clicked,
// followup-requested, unknown cards) stays out of sight.
function systemCard(m) {
  const card = parseCard(m.body);
  const base = { key: m.messageId, seq: m.seq };
  switch (card.cardType) {
    case 'handoff':
    case 'human-transfer':
      return { ...base, type: 'handoff', name: text(card.repName), title: text(card.repTitle), message: text(card.message) };
    case 'standin-takeover':
      return { ...base, type: 'takeover', name: text(card.standinName), message: text(card.message) };
    case 'rep-followup-offer':
      return { ...base, type: 'offer', name: text(card.repName), message: text(card.message) };
    case 'rep-followup-confirmation':
      return { ...base, type: 'confirmation', message: text(card.message) };
    case 'session-end':
      return { ...base, type: 'end', message: text(card.message) };
    default:
      return null;
  }
}

function linkCard(body) {
  const card = parseCard(body);
  const url = safeUrl(card.url);
  if (!url) return null;
  return { url, title: text(card.title).trim() || url, description: text(card.description).trim() };
}

/** Only http and https links ever render. */
export function safeUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeReference(name) {
  return String(name).toLowerCase().replace(/\s+/g, ' ').replace(/[\s.,;:!?]+$/, '').trim();
}

/**
 * Splits reply text into plain text and [[references]] to known parts of the
 * page (names). An unknown reference becomes its plain text, without brackets.
 */
export function splitReferences(value, names = []) {
  const known = new Map(names.map((name) => [normalizeReference(name), name]));
  const parts = [];
  let last = 0;
  for (const match of String(value).matchAll(/\[\[([^[\]\n]{1,60})\]\]/g)) {
    if (match.index > last) parts.push({ text: value.slice(last, match.index) });
    const name = known.get(normalizeReference(match[1]));
    parts.push(name ? { ref: name } : { text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last) });
  // Neighbouring text parts merge, so formatting never splits on a removed bracket.
  return parts.reduce((out, part) => {
    const prev = out.at(-1);
    if (part.text !== undefined && prev?.text !== undefined) prev.text += part.text;
    else out.push({ ...part });
    return out;
  }, []);
}

/** The references in a reply, in order, each once. */
export function referencesIn(value, names) {
  return [...new Set(splitReferences(value, names).filter((p) => p.ref).map((p) => p.ref))];
}

// Stand's timestamps carry nanoseconds; Date.parse only promises milliseconds.
export function time(value) {
  const ms = Date.parse(text(value).replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : 0;
}

function text(value) {
  return typeof value === 'string' ? value : '';
}
