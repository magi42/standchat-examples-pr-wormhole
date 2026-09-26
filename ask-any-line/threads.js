// Many threads, one Stand conversation. Every visitor message starts with
// where it was asked, in words a person on the team can read at a glance:
//
//   ⌘ server.py L20 (Python) — amount: Why 2000 and not 20?
//   ¶ Step 4 “Handle webhooks”: “Reply with a 2xx” — Even for events I ignore?
//   ¶ Step 3 “Collect card details”: Does this work with Apple's autofill?
//   § Accept a payment: Can I charge in euros?
//
// The same prefix puts the message back in its thread after a reload, so the
// transcript is the only storage threads need. Replies belong to the thread
// of the latest visitor message before them.

import { PARTS, REFERENCES } from './catalog.js';
import { isConversation, parseCard } from './stand-visitor.js';

export const PAGE_TITLE = 'Accept a payment';

const LINE = /^⌘ (\S+) L(\d+) \(([^)]*)\) — (.+?): ([\s\S]*)$/;
const QUOTE = /^¶ Step (\d+) “([^”]*)”: “([^”]*)” — ([\s\S]*)$/;
const STEP = /^¶ Step (\d+) “([^”]*)”: ([\s\S]*)$/;
const PAGE = /^§ ([^:\n]+): ([\s\S]*)$/;

export const normalize = (text) => String(text).toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/\s+/g, ' ').replace(/[.,;:!?…]+$/, '').trim();

/** A selection, made safe to quote inside the prefix. */
export function cleanQuote(text, max = 160) {
  const flat = String(text).replace(/\s+/g, ' ').replace(/[“”]/g, '"').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The thread a part of the page gets. Code threads are per statement ("part"). */
export function threadKey(anchor) {
  switch (anchor.kind) {
    case 'line': return `line:${anchor.file}:${normalize(anchor.part)}`;
    case 'quote': return `quote:${anchor.step}:${normalize(anchor.quote).slice(0, 80)}`;
    case 'step': return `step:${anchor.step}`;
    default: return 'page';
  }
}

/** The message the visitor's question travels in. */
export function composeMessage(anchor, question, catalog) {
  const q = String(question).trim();
  switch (anchor.kind) {
    case 'line': {
      const lang = anchor.file === 'client' ? 'browser' : catalog.langLabel(anchor.lang);
      return `⌘ ${catalog.fileName(anchor.file, anchor.lang)} L${anchor.n} (${lang}) — ${prettyPart(anchor.part)}: ${q}`;
    }
    case 'quote':
      return `¶ Step ${anchor.step} “${anchor.title}”: “${cleanQuote(anchor.quote)}” — ${q}`;
    case 'step':
      return `¶ Step ${anchor.step} “${anchor.title}”: ${q}`;
    default:
      return `§ ${PAGE_TITLE}: ${q}`;
  }
}

/** Reads a message's prefix back. Returns { anchor, question }, or null for plain text. */
export function parseMessage(body, catalog) {
  const text = String(body);
  let m = text.match(LINE);
  if (m) {
    const [, fileName, n, langLabel, part, question] = m;
    const which = catalog.whichFile(fileName);
    if (which) {
      const lang = which.kind === 'client' ? null : which.lang ?? catalog.langByLabel(langLabel);
      // The part names the thread. An unknown one (an older page, a person typing
      // the format by hand) falls back to what that line is about.
      let name = normalize(part);
      if (!REFERENCES[name]) {
        const line = catalog.file(which.kind, lang ?? 'node')?.lines[Number(n) - 1];
        name = normalize(PARTS[line?.id] ?? name);
      }
      return { anchor: { kind: 'line', file: which.kind, part: name, n: Number(n), lang }, question };
    }
  }
  if ((m = text.match(QUOTE))) return { anchor: { kind: 'quote', step: Number(m[1]), title: m[2], quote: m[3] }, question: m[4] };
  if ((m = text.match(STEP))) return { anchor: { kind: 'step', step: Number(m[1]), title: m[2] }, question: m[3] };
  if ((m = text.match(PAGE))) return { anchor: { kind: 'page' }, question: m[2] };
  return null;
}

/** The logical line a code thread belongs to: its part's main line. */
export function partLine(part) {
  return REFERENCES[normalize(part)]?.[1] ?? null;
}

/** "load tender.js" → "load Tender.js": a parsed part, as the page writes it. */
export function prettyPart(part) {
  const name = normalize(part);
  return Object.values(PARTS).find((p) => normalize(p) === name) ?? part;
}

/**
 * Turns the canonical transcript into threads.
 * Returns { threads: Map<key, thread>, order: key[], cards, awaiting, typing }.
 * A thread: { key, anchor, items: [{ kind: 'visitor' | 'reply' | 'link', m, … }], pending, lastSeq }.
 */
export function deriveThreads(state, catalog, now = Date.now()) {
  const threads = new Map();
  const order = [];
  const cards = []; // conversation-wide: handoffs, follow-up offers, the end
  const ensure = (anchor) => {
    const key = threadKey(anchor);
    if (!threads.has(key)) {
      threads.set(key, { key, anchor, items: [], pending: null, lastSeq: 0 });
      order.push(key);
    }
    return threads.get(key);
  };

  // Who answered, as it changed: the session-start card names the Stand-in,
  // a handoff names the person who took over.
  let standin = state.host.kind === 'standin' ? state.host.name : '';
  let rep = state.host.kind === 'rep' ? state.host.name : '';
  let current = null; // the thread of the latest visitor message
  let lastConversation = null;

  for (const m of state.messages) {
    if (m.type === 'system-prompt' || m.senderType === 'system-prompt') continue; // our own prompt, echoed back
    if (m.type === 'system-card' || m.senderType === 'system-card') {
      const card = parseCard(m.body);
      const say = (value) => (typeof value === 'string' ? value : '');
      switch (card.cardType) {
        case 'session-start':
          standin = say(card.standinName) || standin;
          break;
        case 'handoff':
        case 'human-transfer':
          rep = say(card.repName) || rep;
          cards.push({ kind: 'handoff', seq: m.seq, name: rep, title: say(card.repTitle), message: say(card.message) });
          break;
        case 'standin-takeover':
          standin = say(card.standinName) || standin;
          cards.push({ kind: 'takeover', seq: m.seq, name: standin, message: say(card.message) });
          break;
        case 'session-end':
          cards.push({ kind: 'end', seq: m.seq, message: say(card.message) });
          break;
        case 'rep-followup-offer':
          cards.push({ kind: 'offer', seq: m.seq, name: say(card.repName), message: say(card.message) });
          break;
        case 'rep-followup-confirmation':
          cards.push({ kind: 'confirmed', seq: m.seq, message: say(card.message) });
          break;
        default: // session-start metadata, link clicks, follow-up requests, anything new: not for the visitor
      }
      continue;
    }
    if (!isConversation(m)) continue;
    lastConversation = m;
    if (m.senderType === 'visitor') {
      const parsed = parseMessage(m.body, catalog) ?? { anchor: { kind: 'page' }, question: m.body };
      const thread = ensure(parsed.anchor);
      thread.anchor = parsed.anchor; // the latest ask says where the thread is shown
      thread.items.push({ kind: 'visitor', m, question: parsed.question, anchor: parsed.anchor });
      thread.lastSeq = m.seq;
      current = thread.key;
    } else {
      const thread = current ? threads.get(current) : ensure({ kind: 'page' });
      const author = m.senderType === 'rep'
        ? { name: rep || state.host.name || 'The team', kind: 'rep' }
        : { name: standin || state.host.name || 'AI Stand-in', kind: 'standin' };
      thread.items.push({ kind: m.type === 'link-card' ? 'link' : 'reply', m, author });
      thread.lastSeq = m.seq;
    }
  }

  let pendingKey = null;
  if (state.pending?.body) {
    const parsed = parseMessage(state.pending.body, catalog) ?? { anchor: { kind: 'page' }, question: state.pending.body };
    const thread = ensure(parsed.anchor);
    thread.pending = { body: state.pending.body, question: parsed.question, anchor: parsed.anchor, creating: Boolean(state.pending.creating) };
    pendingKey = thread.key;
  }

  // Which thread is waiting for an answer. Asking elsewhere waits until it arrives.
  let awaiting = pendingKey;
  const lastIsVisitor = lastConversation?.senderType === 'visitor';
  if (!awaiting && current && state.phase === 'active') {
    if (state.activity?.kind === 'thinking') awaiting = current;
    else if (lastIsVisitor && now - time(lastConversation.sentAt) < 90000) awaiting = current;
  }
  const typing = state.phase === 'active' && state.activity ? current : null;

  return { threads, order, cards, awaiting, typing, current };
}

// Stand's timestamps carry nanoseconds; Date.parse only promises milliseconds.
function time(value) {
  const ms = Date.parse(String(value ?? '').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : 0;
}
