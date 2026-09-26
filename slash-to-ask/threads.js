// The conversation model: one Stand conversation, many ask blocks. No DOM.
//
// Every ask block on the page is a thread, but all of them share one Stand
// session, so the visitor's questions count as one chat however many blocks they
// open. Each visitor message starts with a readable prefix that says where on the
// page it was asked:
//
//   /ask under “Importing your wiki”: Can we keep page history?
//   /ask about “unlimited guests” under “Plans and pricing”: Per workspace?
//   /reply under “Importing your wiki”: And comments?
//
// and, when the visitor's notes changed since the team last saw them, a last line:
//
//   (Doc notes: Team size: 11–50 · Needs: single sign-on)
//
// The team sees exactly where each question came from, and the page can put
// every question and answer back in its block after a reload.

import { isConversation, parseCard } from './stand-visitor.js';

export const PROMPT_LIMIT = 2000;
const QUOTE_MAX = 120;
const QUESTION_MAX = 1500;
const NO_NOTES = 'none yet';

// Cards a visitor should see. Others (session-start, link-clicked,
// followup-requested, anything new) stay out of the page.
const VISIBLE_CARDS = new Set([
  'handoff', 'human-transfer', 'standin-takeover', 'session-end', 'rep-followup-offer', 'rep-followup-confirmation',
]);

/** The message a question is sent as. */
export function formatQuestion({ reply = false, heading, quote = '', text, notes = '' }) {
  const about = quote ? `about “${clean(quote, QUOTE_MAX)}” ` : '';
  const head = `/${reply ? 'reply' : 'ask'} ${about}under “${clean(heading, 80) || 'this page'}”: ${text.trim().slice(0, QUESTION_MAX)}`;
  return notes ? `${head}\n(Doc notes: ${notes})` : head;
}

const PREFIX = /^\/(ask|reply) (?:about “([^”]*)” )?under “([^”]*)”: ?([\s\S]*)$/;
const NOTES = /\n\(Doc notes: ([^\n]*)\)\s*$/;

/** Reads a visitor message back: { reply, quote, heading, text, notes }, or null. */
export function parseQuestion(body) {
  const m = PREFIX.exec(String(body));
  if (!m) return null;
  let text = m[4];
  let notes = '';
  const n = NOTES.exec(text);
  if (n) {
    notes = n[1];
    text = text.slice(0, n.index);
  }
  return { reply: m[1] === 'reply', quote: m[2] ?? '', heading: m[3], text: text.trim(), notes };
}

/** Quotes and headings go inside “…”, so they can't contain the closing mark. */
export function clean(text, max) {
  const flat = String(text ?? '').replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Splits the canonical transcript into threads, one per ask block.
 *
 * asks: [{ id, sent: [body, …] }] — the exact bodies each block sent.
 * host: the responder from discovery, used until a card says otherwise.
 *
 * Visitor messages belong to the block that sent that exact body. Replies,
 * link cards and system cards belong to the thread of the latest visitor
 * message before them. A visitor message no block claims (the page's own notes
 * were lost, say) gets a new thread keyed `ask-r<seq>`, so the page can add a
 * block for it under the heading its prefix names.
 */
export function assignThreads(messages, asks, host = {}, knownStandin = {}) {
  const claims = asks.map((a) => ({ id: a.id, sent: a.sent ?? [], used: (a.sent ?? []).map(() => false) }));
  const threads = new Map(asks.map((a) => [a.id, []]));
  const recovered = new Map(); // id -> { heading, quote }
  const lastByHeading = new Map();
  let current = null;
  let standin = host.kind === 'standin' ? { name: host.name, avatar: host.avatar, title: '' } : { name: knownStandin.name ?? '', avatar: knownStandin.avatar ?? '', title: '' };
  let rep = { name: host.kind === 'rep' ? host.name : '', avatar: host.kind === 'rep' ? host.avatar : '', title: '' };
  const early = []; // anything before the first question

  const push = (item) => {
    if (current) threads.get(current).push(item);
    else early.push(item);
  };

  for (const m of messages) {
    if (m.type === 'system-card' || m.senderType === 'system-card') {
      const card = parseCard(m.body);
      if (card.cardType === 'session-start') standin = { ...standin, name: text(card.standinName) || standin.name };
      else if (card.cardType === 'standin-takeover') standin = { name: text(card.standinName) || standin.name, avatar: text(card.standinAvatar) || standin.avatar, title: text(card.standinTitle) };
      else if (card.cardType === 'handoff' || card.cardType === 'human-transfer') rep = { name: text(card.repName) || rep.name, avatar: text(card.repAvatar), title: text(card.repTitle) };
      if (VISIBLE_CARDS.has(card.cardType)) push({ kind: 'card', messageId: m.messageId, seq: m.seq, cardType: card.cardType, card });
      continue;
    }
    if (!isConversation(m)) continue;

    if (m.senderType === 'visitor') {
      let owner = null;
      for (const c of claims) {
        const i = c.sent.findIndex((body, k) => !c.used[k] && body === m.body);
        if (i >= 0) {
          c.used[i] = true;
          owner = c.id;
          break;
        }
      }
      const parsed = parseQuestion(m.body);
      if (!owner && parsed?.reply) owner = lastByHeading.get(parsed.heading) ?? current;
      if (!owner) {
        owner = `ask-r${m.seq}`;
        threads.set(owner, []);
        recovered.set(owner, { heading: parsed?.heading ?? '', quote: parsed?.quote ?? '', body: m.body });
      }
      current = owner;
      if (parsed) lastByHeading.set(parsed.heading, owner);
      threads.get(owner).push({
        kind: 'q',
        messageId: m.messageId,
        seq: m.seq,
        body: m.body,
        text: parsed ? parsed.text : m.body,
        quote: parsed?.quote ?? '',
        reply: Boolean(parsed?.reply),
      });
      continue;
    }

    const who = m.senderType === 'rep' ? { ...rep, kind: 'rep' } : { ...standin, kind: 'standin' };
    if (m.type === 'link-card') {
      const card = parseCard(m.body);
      push({ kind: 'link', messageId: m.messageId, seq: m.seq, url: text(card.url), title: text(card.title), description: text(card.description), who });
    } else {
      push({ kind: 'a', messageId: m.messageId, seq: m.seq, text: m.body, who });
    }
  }

  // Early cards join the first thread, so nothing a visitor should see is lost.
  const first = [...threads.values()].find((items) => items.length);
  if (first && early.length) first.unshift(...early);

  const unconfirmed = new Map(claims.map((c) => [c.id, c.sent.filter((_, k) => !c.used[k])]));
  const last = messages.findLast(isConversation);
  return {
    threads,
    recovered,
    unconfirmed,
    current, // the thread of the latest question
    due: last?.senderType === 'visitor', // that question hasn't been answered yet
  };
}

/** The notes the team saw last: the newest notes line, or the ones in the prompt. */
export function notesAtTeam(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.senderType !== 'visitor') continue;
    const notes = parseQuestion(m.body)?.notes;
    if (notes) return notes === NO_NOTES ? '' : notes;
  }
  const prompt = messages.find((m) => m.senderType === 'system-prompt' || m.type === 'system-prompt');
  const line = /\nVisitor's notes: ([^\n]*)\s*$/.exec(prompt?.body ?? '');
  return line && line[1] !== NO_NOTES ? line[1] : '';
}

/** The visitor's notes in one compact line, or '' when there are none. */
export function notesText({ size = '', tools = [], moving = '', mustNot = '', needs = [] } = {}) {
  const parts = [];
  if (size) parts.push(`Team: ${size}`);
  if (tools.length) parts.push(`Tools: ${tools.join(', ').toLowerCase()}`);
  if (moving) parts.push(`Moving: ${moving.toLowerCase()}`);
  if (mustNot.trim()) parts.push(`Must not break: ${clean(mustNot, 70)}`);
  if (needs.length) parts.push(`Needs: ${needs.map((n) => clean(n, 44)).join(', ')}`);
  return parts.join(' · ');
}

// Private context for whoever answers: the Stand-in, and your team in Stand.
// Order: who's speaking and the ground rules, the facts, how this page works,
// then the visitor's notes at the moment of the first question.
const PROMPT = `You are answering visitors on the website of Kenning, a fictional connected workspace (a demo page on examples.stand.chat; Kenning is invented). Speak as Kenning's team. Keep replies short: 1–3 sentences unless asked for detail.
If a fact isn't below, say you're not sure and offer to bring in someone from the team. Don't invent prices, limits or features.

Facts: per member per month, billed yearly (monthly +25%); guests free. Free $0: 3 members, 5 guests, 7-day history. Plus $8: 50 guests, 30-day history. Business $16: 250 guests, 1-year history, SAML SSO, private spaces, old-link redirects. Enterprise (custom): unlimited guests and history, SCIM, audit log, EU hosting. 14-day Business trial, no card. Nonprofits, schools: 50% off. Imports from wikis, docs suites, Markdown, HTML and CSV keep comments, mentions and history (to the plan's limit), up to 50,000 pages. 2FA on all plans; encrypted at rest and in transit; SOC 2 Type II. Apps for Mac, Windows, Linux, iOS, Android; recent pages work offline. REST API on all plans; webhooks and AI assistant on Business and up; content never trains models.

This page is an editable doc. Messages start with /ask under “section”: (or /ask about “quote” under “section”: for selected text; /reply for follow-ups). Answer about that part; don't repeat the marker. “(Doc notes: …)” updates the visitor's notes.
Point to the page by exact name in double brackets, at most two per reply: [[Heading: About your team]] [[Heading: Importing your wiki]] [[Database: Plans]] [[Toggle: How pricing works]] [[Toggle: Can we try Business first?]] [[Heading: Security and admin]] [[Heading: Apps, offline and API]]`;

/** The per-session prompt, with the visitor's notes, within Stand's 2,000 characters. */
export function buildPrompt(notes) {
  const head = `${PROMPT}\n\nVisitor's notes: `;
  const room = PROMPT_LIMIT - head.length;
  const line = notes || NO_NOTES;
  return head + (line.length > room ? `${line.slice(0, room - 1)}…` : line);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}
