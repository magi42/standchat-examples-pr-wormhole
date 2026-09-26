// Questions pinned to moments of the tour, all in one Stand conversation.
//
// Every visitor message starts with the moment it's about, like
// "⏱ 0:42 Breakpoints: Does desktop change too?". Stand shows the team exactly
// where the question came from, and this module reads the threads back from
// the transcript after a reload, so nothing else needs saving. Replies belong
// to the thread of the latest visitor message before them.

import { isConversation, parseCard } from './stand-visitor.js';
import { CHAPTERS, DURATION, chapterAt, formatTime, momentAt } from './tour-script.js';

const MARK = '⏱';
const VS16 = String.fromCharCode(0xfe0f); // Some keyboards add it to the emoji.
const PREFIX = new RegExp(`^\\s*${MARK}${VS16}?\\s*(\\d{1,2}):([0-5]\\d)(?:\\s+[^:\\n]{1,40})?:\\s*`);

// Cards the visitor sees. Others (session-start, link-clicked, followup-requested
// and anything new) are bookkeeping and stay out of the way.
const NOTICES = new Set(['handoff', 'human-transfer', 'standin-takeover', 'session-end', 'rep-followup-offer', 'rep-followup-confirmation']);

/** The message a question is sent as. */
export function formatQuestion(time, text) {
  const at = Math.floor(time);
  return `${MARK} ${formatTime(at)} ${chapterAt(at).name}: ${text.trim()}`;
}

/** "⏱ 0:42 Breakpoints: …" → { time: 42, text: "…" }, or null for anything else. */
export function parseQuestion(body) {
  const match = PREFIX.exec(String(body));
  if (!match) return null;
  const time = Number(match[1]) * 60 + Number(match[2]);
  return time <= DURATION ? { time, text: String(body).slice(match[0].length) } : null;
}

export function describeMoment(time) {
  return { time: Math.floor(time), stamp: formatTime(time), chapter: chapterAt(time).name, label: momentAt(time).label };
}

/**
 * Turns Stand's transcript into threads, one per moment, plus the notices that
 * concern the whole conversation.
 */
export function buildThreads(state) {
  const threads = new Map();
  const notices = [];
  let current = null;
  let aiName = state.host.kind === 'standin' ? state.host.name : '';
  let personName = state.host.kind === 'rep' ? state.host.name : '';

  const threadAt = (time) => {
    const key = time === null ? 'general' : String(time);
    if (!threads.has(key)) threads.set(key, { key, time, ...(time === null ? {} : describeMoment(time)), items: [] });
    return threads.get(key);
  };

  for (const m of state.messages) {
    if (m.type === 'system-prompt' || m.senderType === 'system-prompt') continue; // Our own prompt, echoed back.
    if (m.type === 'system-card' || m.senderType === 'system-card') {
      const card = parseCard(m.body);
      if (card.cardType === 'session-start' && typeof card.standinName === 'string') aiName = card.standinName;
      if (card.cardType === 'standin-takeover' && typeof card.standinName === 'string') aiName = card.standinName;
      if ((card.cardType === 'handoff' || card.cardType === 'human-transfer') && typeof card.repName === 'string') personName = card.repName;
      if (NOTICES.has(card.cardType)) notices.push({ id: m.messageId, seq: m.seq, card });
      continue;
    }
    if (!isConversation(m)) continue;
    if (m.senderType === 'visitor') {
      const question = parseQuestion(m.body);
      current = threadAt(question ? question.time : null);
      current.items.push({ id: m.messageId, from: 'visitor', text: question ? question.text : m.body });
    } else {
      const person = m.senderType === 'rep';
      (current ?? threadAt(null)).items.push({
        id: m.messageId,
        from: person ? 'person' : 'ai',
        name: (person ? personName : aiName) || state.host.name,
        type: m.type,
        text: m.body,
      });
    }
  }

  // Sent, not confirmed yet.
  let awaiting = null;
  if (state.pending?.body) {
    const question = parseQuestion(state.pending.body);
    const thread = threadAt(question ? question.time : null);
    thread.items.push({ id: `pending:${state.pending.clientMessageId || 'start'}`, from: 'visitor', text: question ? question.text : state.pending.body, pending: true });
    awaiting = thread.key;
  }
  // A reply is due in the thread of the latest question.
  const lastSpoken = state.messages.findLast(isConversation);
  if (!awaiting && state.phase === 'active' && current && (state.activity?.kind === 'thinking' || lastSpoken?.senderType === 'visitor')) {
    awaiting = current.key;
  }

  const list = [...threads.values()].sort((a, b) => (a.time ?? -1) - (b.time ?? -1));
  return { threads: list, notices, awaiting };
}

// Answers that point at the tour -------------------------------------------------
// The prompt asks the Stand-in to write [[1:12]] or [[Chapter: CMS]]. Those are
// the whole vocabulary: anything else in double brackets is shown as plain text.

export function resolveReference(raw) {
  const name = raw.trim().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').toLowerCase();
  const stamp = /^(?:at )?(\d{1,2}):([0-5]\d)$/.exec(name);
  if (stamp) {
    const time = Number(stamp[1]) * 60 + Number(stamp[2]);
    return time <= DURATION ? { kind: 'time', time, label: formatTime(time) } : null;
  }
  const chapter = CHAPTERS.find((c) => c.name.toLowerCase() === name.replace(/^chapter:\s*/, ''));
  return chapter ? { kind: 'chapter', time: chapter.start, label: chapter.name } : null;
}

const INLINE = /\[\[([^[\]\n]{1,40})\]\]|\*\*([^*\n]+)\*\*|`([^`\n]+)`|(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]])/g;

/**
 * Message text as DOM, never as HTML: paragraphs, "- " lists, **bold**,
 * `code`, links, and tour references as buttons made by `makeRef`.
 */
export function renderText(text, { makeRef }) {
  const fragment = document.createDocumentFragment();
  for (const block of String(text).trim().split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-•]\s+/.test(line))) {
      const list = document.createElement('ul');
      for (const line of lines) {
        const item = document.createElement('li');
        inline(item, line.replace(/^\s*[-•]\s+/, ''), makeRef);
        list.append(item);
      }
      fragment.append(list);
    } else {
      const p = document.createElement('p');
      lines.forEach((line, i) => {
        if (i) p.append(document.createElement('br'));
        inline(p, line, makeRef);
      });
      fragment.append(p);
    }
  }
  return fragment;
}

function inline(parent, line, makeRef) {
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    parent.append(line.slice(last, match.index));
    last = match.index + match[0].length;
    const [, ref, bold, code, url] = match;
    if (ref !== undefined) {
      const target = resolveReference(ref);
      parent.append(target ? makeRef(target) : ref);
    } else if (bold !== undefined) {
      parent.append(Object.assign(document.createElement('strong'), { textContent: bold }));
    } else if (code !== undefined) {
      parent.append(Object.assign(document.createElement('code'), { textContent: code }));
    } else {
      const a = Object.assign(document.createElement('a'), { href: url, textContent: url, target: '_blank', rel: 'noopener noreferrer' });
      parent.append(a);
    }
  }
  parent.append(line.slice(last));
}

/** Only http(s) links leave the page. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
