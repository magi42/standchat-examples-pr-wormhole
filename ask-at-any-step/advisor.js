// The conversation model behind "ask at any step". No DOM, no network.
//
// One Stand conversation carries every question. Each visitor message starts
// with the step it was asked on and the answers given so far:
//
//   [Step 3 · Markets · sells: physical · customers: FI (home), DE, US] Do I need VAT in Germany?
//
// Your team reads exactly that in Stand. This page parses it back to put each
// question, and the replies that follow it, into the right step.

import { isConversation, parseCard } from './stand-visitor.js';
import { CATALOG, CHANNELS, REFERENCES, SELLS, STEPS, TEAM, home, plan, salesLabel, shownPlan } from './steps.js';

export const SEP = ' · ';
const MARKER = /^\[Step (\d+)((?: · [^\]]*)?)\]\s*/;
const PROMPT_LIMIT = 2000;

// Private context for whoever answers, sent once with the first question.
export const PROMPT_BASE = `You are answering visitors on the website of Awning, a fictional commerce platform (a demo page on examples.stand.chat; Awning is invented). Speak as Awning's team. Keep replies short: 1-3 sentences unless asked for detail. If a fact isn't below, say you're not sure and offer to bring in someone from the team. Only state features, prices and limits listed below.

Facts: 14-day free trial, no card; switch or cancel plans any time. Plans, USD/month: Kiosk $9 (no store); Corner $32 (online store, 2 staff); Main Street $89 (5 staff, Subscriptions and Bookings apps); Flagship $319 (15 staff, local currency/language/domain per country, duties at checkout); Landmark from $2,100 (unlimited staff, B2B). Card rates 2.9/2.6/2.4/2.1% + 30c, Corner up. Payments: cards, wallets, bank transfer; 2-day payouts. Checkout adds VAT/sales tax; you register and file, with our reports. EU: under €10k/year of sales to other EU countries, charge home VAT; above, buyer's VAT via One-Stop Shop. Shipping zones per country, cheaper labels in US/UK/DE/FR, pickup. POS app free; Tap reader $59, works offline. Bookings app: time slots, deposits, reminders. Subscriptions and Bookings apps $10/month on Corner; Downloads app free. Made-to-order lead times. Free name.awning.shop; own domain $14/year. Free importer.

The page is a setup wizard. Visitor messages start with [Step N · step · answers so far]; answer for that step and those answers; don't repeat the brackets. When part of the wizard helps, point to it by writing its exact name from this list in double square brackets, like [[Checklist: Taxes]]. Step: Products, Channels, Markets, Size, Name, Plan. Plan: Corner, Main Street, Flagship, Landmark. Checklist: Payments, Taxes, Shipping, Point of sale, Domain, Import. App: Subscriptions, Bookings, Downloads. At most two per reply; no other brackets.`;

/** A store name that can't break the prefix: no brackets, no separators. */
export function cleanName(name) {
  return String(name ?? '').replace(/[[\]·]/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * The answers so far: "sells: physical, subscriptions", "customers: FI (home), DE"…
 * `max` shortens long lists ("+3"), for the prompt's 2,000 characters.
 */
export function answerFields(a, { max = Infinity } = {}) {
  const fields = [];
  const cap = (items) => (items.length > max ? [...items.slice(0, max), `+${items.length - max}`] : items).join(', ');
  const short = (options, ids) => cap(ids.map((id) => options.find((o) => o.id === id)?.short).filter(Boolean));
  if (a.sells.length) fields.push(`sells: ${short(SELLS, a.sells)}`);
  if (a.channels.length) fields.push(`today: ${short(CHANNELS, a.channels)}`);
  // The home market is a guess from the browser until the visitor has seen step 3.
  if (a.seen.includes(3) && a.markets.length) {
    fields.push(`customers: ${cap(a.markets.map((code, i) => (i === 0 && a.markets.length > 1 ? `${code} (home)` : code)))}`);
  }
  if (a.seen.includes(4)) {
    const sales = a.sales === 0 ? 'no sales yet' : `${salesLabel(a.sales, home(a).currency)}/mo`;
    const team = a.team === 0 ? 'just me' : `team of ${TEAM[a.team]}`;
    fields.push(`size: ${sales}, ${CATALOG[a.catalog]} products, ${team}`);
  }
  const name = cleanName(a.name);
  if (name) fields.push(`name: ${name}`);
  if (a.seen.includes(6)) fields.push(`plan: ${plan(shownPlan(a)).name}`);
  return fields;
}

export function composeQuestion(stepN, answers, text) {
  const step = STEPS[stepN - 1] ?? STEPS[0];
  const fields = answerFields(answers).map((f) => `${SEP}${f}`).join('');
  return `[Step ${step.n}${SEP}${step.name}${fields}] ${String(text).trim()}`;
}

/** Reads a visitor message back: its step, the answers it carried, and the question. */
export function parseQuestion(body) {
  const match = MARKER.exec(body);
  if (!match) return { step: 0, name: '', fields: [], text: String(body).trim() };
  const step = STEPS.find((s) => s.n === Number(match[1]));
  const parts = match[2].split(SEP).map((part) => part.trim()).filter(Boolean);
  const name = parts[0] && !parts[0].includes(':') ? parts.shift() : step?.name ?? '';
  return { step: step?.n ?? 0, name, fields: parts, text: body.slice(match[0].length).trim() };
}

/** The per-session prompt: the base, then the answers at the first question. */
export function buildPrompt(answers, stepN) {
  const step = STEPS[stepN - 1] ?? STEPS[0];
  const room = PROMPT_LIMIT - PROMPT_BASE.length - 2;
  const say = (fields) => `First asked on Step ${step.n} (${step.name}) with: ${fields.join('; ') || 'no answers yet'}.`;
  let context = say(answerFields(answers));
  // Too long? Shorten the lists, then leave out the least telling answers.
  // The first message carries all of them in its prefix anyway.
  if (context.length > room) {
    const fields = answerFields(answers, { max: 3 });
    const order = ['plan:', 'name:', 'today:', 'sells:'];
    while (say(fields).length > room && order.length) {
      const at = fields.findIndex((f) => f.startsWith(order[0]));
      if (at >= 0) fields.splice(at, 1);
      else order.shift();
    }
    context = say(fields);
  }
  return `${PROMPT_BASE}\n\n${context}`.slice(0, PROMPT_LIMIT);
}

// Cards everyone should see, wherever the visitor is. The rest stay silent.
const SHOWN_CARDS = new Set(['handoff', 'human-transfer', 'standin-takeover', 'session-end', 'rep-followup-offer', 'rep-followup-confirmation']);

/**
 * Groups the canonical transcript into exchanges: a question with its step,
 * then what followed it until the next question. `items` keeps replies and
 * cards (a person joining, an email offer) in the order they happened.
 */
export function buildConversation(state) {
  const exchanges = [];
  const events = []; // Cards before any question, if a conversation ever starts with one.
  let current = null;
  let standin = state.host.kind === 'standin' ? state.host.name : '';
  let rep = state.host.kind === 'rep' ? state.host.name : '';
  const open = (id, seq) => {
    // Something before any question, like an opening greeting: file it with step 1.
    current = { id: `before-${id}`, seq, step: 1, name: STEPS[0].name, fields: [], text: '', replies: [], items: [] };
    exchanges.push(current);
  };

  for (const m of state.messages) {
    if (m.type === 'system-card' || m.senderType === 'system-card') {
      const card = parseCard(m.body);
      if (card.cardType === 'session-start' || card.cardType === 'standin-takeover') standin = str(card.standinName) || standin;
      if (card.cardType === 'handoff' || card.cardType === 'human-transfer') rep = str(card.repName) || rep;
      if (!SHOWN_CARDS.has(card.cardType)) continue;
      const event = { kind: 'event', id: m.messageId, seq: m.seq, card };
      if (current) current.items.push(event);
      else events.push(event);
      continue;
    }
    if (!isConversation(m)) continue; // Includes hiding our own prompt, echoed back as system-prompt.
    if (m.senderType === 'visitor') {
      current = { id: m.messageId, seq: m.seq, ...parseQuestion(m.body), replies: [], items: [] };
      exchanges.push(current);
    } else {
      if (!current) open(m.messageId, m.seq);
      const person = m.senderType === 'rep';
      const reply = {
        kind: 'reply',
        id: m.messageId,
        seq: m.seq,
        type: m.type,
        body: m.body,
        from: person ? 'person' : 'ai',
        author: person ? rep || 'Someone from the team' : standin || state.host.name || 'AI Stand-in',
      };
      current.replies.push(reply);
      current.items.push(reply);
    }
  }

  if (state.pending) {
    exchanges.push({ id: 'pending', seq: Infinity, ...parseQuestion(state.pending.body), replies: [], items: [], pending: true, creating: Boolean(state.pending.creating) });
  }

  // A reply is due on the latest question: while it is, other steps wait.
  const lastSaid = state.messages.findLast(isConversation);
  const due = state.phase === 'active' && (state.activity?.kind === 'thinking' || lastSaid?.senderType === 'visitor');
  const latest = exchanges.at(-1) ?? null;
  const waitingOn = state.pending ? latest : due ? latest : null;

  return {
    exchanges,
    events,
    latest,
    waitingStep: waitingOn ? waitingOn.step || 1 : 0,
    started: exchanges.length > 0,
  };
}

// References: [[Checklist: Taxes]] in a reply points at the page. Names are
// matched loosely (case, punctuation, "Step 3 · Markets" or just "Markets").
export const REFERENCE_PATTERN = /\[\[([^[\]\n]{1,60})\]\]/g;
const normalize = (text) => String(text).toLowerCase().replace(/[:·–—-]/g, ' ').replace(/[.,;!?]+$/g, '').replace(/^the /, '').replace(/\s+/g, ' ').trim();
const INDEX = new Map();
for (const ref of REFERENCES) {
  for (const key of [ref.name, ...ref.aliases]) if (!INDEX.has(normalize(key))) INDEX.set(normalize(key), ref);
}

export function findReference(raw) {
  return INDEX.get(normalize(raw)) ?? null;
}

/** A reply shouldn't echo our prefix, but if one does, don't show it. */
export function stripPrefix(text) {
  return String(text).replace(MARKER, '');
}

const str = (value) => (typeof value === 'string' ? value : '');
