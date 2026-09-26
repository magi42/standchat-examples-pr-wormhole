// The conversation model: what a visitor message carries, how the transcript
// groups into exchanges, and how replies point at apps and flows. No DOM, no
// network: omnibox.js renders it, stand-visitor.js moves it.
//
// Context rides along as a short prefix on the visitor's message, so the team
// reads it in Stand and this page can parse it back after a reload:
//   (searching “Acme ERP” · no match · closest: Ledgerly · stack: Formlane, Pipewell) Can I sync invoices?

import { isConversation, parseCard } from './stand-visitor.js';
import { APPS, FLOWS } from './catalog.js';

// Segments, in the order they're written. Each parses back from its text.
const SEGMENTS = [
  ['search', (v) => `searching “${v}”`, /^searching “([^”]{1,80})”$/],
  ['noMatch', () => 'no match', /^no match$/],
  ['closest', (v) => `closest: ${v.join(', ')}`, /^closest: (.{1,160})$/],
  ['app', (v) => `app: ${v}`, /^app: (.{1,60})$/],
  ['triggers', (v) => `triggers: ${v.join(', ')}`, /^triggers: (.{1,300})$/],
  ['actions', (v) => `actions: ${v.join(', ')}`, /^actions: (.{1,300})$/],
  ['missing', () => 'missing trigger or action', /^missing trigger or action$/],
  ['flow', (v) => `flow: ${v}`, /^flow: (.{1,120})$/],
  ['steps', (v) => `steps: ${v}`, /^steps: (.{1,200})$/],
  ['stack', (v) => `stack: ${v.length ? v.join(', ') : 'none'}`, /^stack: (.{1,400})$/],
];
const LISTS = new Set(['closest', 'triggers', 'actions', 'stack']);

/** Strips what would break the prefix: brackets, the separator and quotes. */
export const clean = (value, max = 80) => String(value).replace(/[()·“”"\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The prefix for a context object, or '' when there's nothing to say. */
export function buildPrefix(context = {}) {
  const parts = [];
  for (const [key, write] of SEGMENTS) {
    const value = context[key];
    if (value === undefined || value === null || value === false) continue;
    if (LISTS.has(key)) {
      if (!Array.isArray(value) || (key !== 'stack' && !value.length)) continue;
      parts.push(write(value.map((v) => clean(v, 60)).filter(Boolean)));
    } else {
      parts.push(write(typeof value === 'string' ? clean(value, key === 'steps' ? 200 : 80) : value));
    }
  }
  return parts.length ? `(${parts.join(' · ')}) ` : '';
}

/**
 * Splits a visitor message into { context, text }. Only a prefix made of
 * known segments counts, so a visitor who starts with "(just curious)" keeps it.
 */
export function parsePrefix(body) {
  const match = /^\(([^()\n]{1,900})\)\s+/.exec(body);
  if (!match) return { context: null, text: body };
  const context = {};
  for (const part of match[1].split(' · ')) {
    const known = SEGMENTS.find(([, , pattern]) => pattern.test(part));
    if (!known) return { context: null, text: body };
    const [key, , pattern] = known;
    const value = pattern.exec(part)[1];
    if (value === undefined) context[key] = true;
    else if (LISTS.has(key)) context[key] = value === 'none' ? [] : value.split(', ');
    else context[key] = value;
  }
  return { context, text: body.slice(match[0].length) };
}

/** The stack the team last heard about, from the transcript. */
export function lastSentStack(messages, pending) {
  let stack = null;
  for (const m of [...messages, ...(pending ? [{ senderType: 'visitor', type: 'text', body: pending.body }] : [])]) {
    if (m.senderType !== 'visitor' || m.type !== 'text') continue;
    const { context } = parsePrefix(m.body);
    if (context?.stack) stack = context.stack;
  }
  return stack ?? [];
}

const SHOWN_CARDS = new Set(['handoff', 'human-transfer', 'standin-takeover', 'session-end', 'rep-followup-offer', 'rep-followup-confirmation']);

/** Messages a visitor sees: text, link cards and the cards that change the conversation. */
export function isShown(m) {
  if (isConversation(m)) return m.type !== 'link-card' || Boolean(linkCard(m));
  if (m.type !== 'system-card' && m.senderType !== 'system-card') return false;
  return SHOWN_CARDS.has(parseCard(m.body).cardType);
}

/**
 * Groups the transcript into exchanges: a visitor message and everything
 * after it until the next one. Oldest first; the view shows them newest first.
 * The unconfirmed message, if any, is the last exchange.
 */
export function toExchanges(messages, pending) {
  const exchanges = [];
  let current = null;
  for (const m of messages) {
    if (!isShown(m)) continue;
    if (m.senderType === 'visitor' && m.type === 'text') {
      current = { key: m.messageId, question: m, ...parsePrefix(m.body), items: [] };
      exchanges.push(current);
      continue;
    }
    if (m.senderType === 'visitor') continue;
    if (!current) {
      current = { key: `before-${m.messageId}`, question: null, context: null, text: '', items: [] };
      exchanges.push(current);
    }
    current.items.push(m);
  }
  if (pending?.body) exchanges.push({ key: 'pending', question: null, pending, ...parsePrefix(pending.body), items: [] });
  return exchanges;
}

/** A link card's fields, when its URL is safe to open. */
export function linkCard(m) {
  const card = parseCard(m.body);
  const url = safeUrl(card.url);
  return url ? { url, title: typeof card.title === 'string' && card.title.trim() ? card.title : url, description: typeof card.description === 'string' ? card.description : '' } : null;
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

// References --------------------------------------------------------------
// Replies name apps and flows as [[App: Name]] or [[Flow: Name]]. The names
// are a closed vocabulary; anything else is shown as plain text.

const key = (text) => String(text).toLowerCase()
  .replace(/\s*(?:->|=>|—>|–>|⟶|→)\s*/g, ' → ')
  .replace(/[“”"'’]/g, '')
  .replace(/\s+/g, ' ')
  .replace(/[\s.,;:!?]+$/, '')
  .trim();

const APP_NAMES = new Map();
for (const app of APPS) {
  APP_NAMES.set(key(app.name), app);
  APP_NAMES.set(key(`${app.name} by Hookline`), app);
}
APP_NAMES.set('webhook', APPS.find((a) => a.id === 'webhooks'));
APP_NAMES.set('http', APPS.find((a) => a.id === 'http'));

const FLOW_NAMES = new Map();
for (const flow of FLOWS) {
  FLOW_NAMES.set(key(flow.name), flow);
  FLOW_NAMES.set(key(flow.title), flow);
  const trigger = APPS.find((a) => a.id === flow.trigger[0]);
  const action = APPS.find((a) => a.id === (flow.action[0] ?? flow.fallback));
  FLOW_NAMES.set(key(`${trigger.name} → ${action.name}`), flow);
}

/** Looks up one reference: { kind: 'app', app } | { kind: 'flow', flow } | null. */
export function lookup(kind, name) {
  const k = key(name);
  const type = kind?.toLowerCase();
  const app = type !== 'flow' && APP_NAMES.get(k);
  const flow = type !== 'app' && FLOW_NAMES.get(k);
  return app ? { kind: 'app', app } : flow ? { kind: 'flow', flow } : null;
}

const REF = /\[\[\s*(?:(app|flow)\s*:\s*)?([^[\]\n]{1,100}?)\s*\]\]/gi;

/** Apps and flows a reply points at, in order, without repeats. */
export function references(text) {
  const found = [];
  const seen = new Set();
  for (const m of String(text).matchAll(REF)) {
    const ref = lookup(m[1], m[2]);
    const id = ref && `${ref.kind}:${(ref.app ?? ref.flow).id}`;
    if (ref && !seen.has(id)) {
      seen.add(id);
      found.push(ref);
    }
  }
  return found;
}

/** The reply as plain text: references become their names (for screen readers and previews). */
export function plainText(text) {
  return String(text).replace(REF, (_, kind, name) => {
    const ref = lookup(kind, name);
    return ref ? (ref.app ?? ref.flow).name : name.trim();
  }).replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1');
}

// Formatting --------------------------------------------------------------
// Replies are text. This escapes everything first, then allows a small safe
// subset: paragraphs, line breaks, lists, **bold**, `code`, http(s) links, and
// references, which `chip(ref)` turns into this page's own markup.

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const INLINE = /(\[\[[^[\]\n]{1,110}\]\])|(`[^`\n]{1,200}`)|(\*\*[^*\n]{1,200}\*\*)|(https?:\/\/[^\s<>"'`]+)/gi;

function inline(text, chip) {
  let html = '';
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    html += escape(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      const [, kind, name] = /^\[\[\s*(?:(app|flow)\s*:\s*)?(.*?)\s*\]\]$/i.exec(m[1]);
      const ref = lookup(kind, name);
      html += ref ? chip(ref) : escape(name);
    } else if (m[2]) {
      html += `<code>${escape(m[2].slice(1, -1))}</code>`;
    } else if (m[3]) {
      html += `<strong>${inline(m[3].slice(2, -2), chip)}</strong>`;
    } else {
      // Trailing punctuation belongs to the sentence, not the link.
      const [, url, tail] = /^(.*?)([.,;:!?)]*)$/.exec(m[4]);
      const safe = safeUrl(url);
      html += safe ? `<a href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a>${escape(tail)}` : escape(m[4]);
    }
  }
  return html + escape(text.slice(last));
}

/** Safe HTML for a reply. */
export function formatReply(text, chip = (ref) => escape((ref.app ?? ref.flow).name)) {
  const blocks = String(text).replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  let html = '';
  for (const block of blocks) {
    const lines = block.split('\n');
    let para = [];
    let list = null;
    const flushPara = () => {
      if (para.length) html += `<p>${para.map((l) => inline(l, chip)).join('<br>')}</p>`;
      para = [];
    };
    const flushList = () => {
      if (list) html += `<${list.tag}>${list.items.map((i) => `<li>${inline(i, chip)}</li>`).join('')}</${list.tag}>`;
      list = null;
    };
    for (const line of lines) {
      const item = /^\s*(?:([-*•])|(\d{1,2})[.)])\s+(.*)$/.exec(line);
      if (item) {
        flushPara();
        const tag = item[2] ? 'ol' : 'ul';
        if (list?.tag !== tag) {
          flushList();
          list = { tag, items: [] };
        }
        list.items.push(item[3]);
      } else if (line.trim()) {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
  }
  return html;
}
