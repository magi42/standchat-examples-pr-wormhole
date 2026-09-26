// The issue model: one Stand conversation, many issues.
//
// Every visitor message starts with its issue's ID. "SW-12 [High · Migration]:
// Can we keep story points?" files SW-12, and "SW-12: And estimates?" comments
// on it. Replies belong to the issue of the latest visitor message before them;
// system cards (a person joining, the end) belong to the whole conversation.
// All of it is derived from the transcript, so a reload rebuilds the same
// issues. Only what the transcript can't know, like an issue you marked Done,
// comes from the page's own storage. No DOM, no network.

import { isConversation, parseCard } from './stand-visitor.js';
import { PEOPLE, SEEDED, TEAM } from './seed.js';

export const PRIORITIES = [
  { id: 'none', name: 'No priority', key: '0' },
  { id: 'urgent', name: 'Urgent', key: '1' },
  { id: 'high', name: 'High', key: '2' },
  { id: 'medium', name: 'Medium', key: '3' },
  { id: 'low', name: 'Low', key: '4' },
];

export const LABELS = [
  { id: 'migration', name: 'Migration', color: '#B08CF8' },
  { id: 'pricing', name: 'Pricing', color: '#4CB782' },
  { id: 'security', name: 'Security', color: '#EB5757' },
  { id: 'integrations', name: 'Integrations', color: '#4EA7FC' },
  { id: 'workflow', name: 'Workflow', color: '#26B5CE' },
];

// In list order: new questions land in Triage, answered ones end in Done.
export const STATUSES = [
  { id: 'triage', name: 'Triage' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'In Review' },
  { id: 'todo', name: 'Todo' },
  { id: 'backlog', name: 'Backlog' },
  { id: 'done', name: 'Done' },
  { id: 'canceled', name: 'Canceled' },
];

export const CLOSED = new Set(['done', 'canceled']);
export const YOU = { name: 'You', kind: 'visitor' };
const VISITOR = { name: 'Website visitor', kind: 'visitor' };
// After this long without a reply or any activity, another issue may be filed.
const REPLY_LOCK = 60000;

const byId = (list) => new Map(list.map((item) => [item.id, item]));
const PRIORITY = byId(PRIORITIES);
const LABEL = byId(LABELS);
export const STATUS = byId(STATUSES);

export const priorityName = (id) => PRIORITY.get(id)?.name ?? 'No priority';
export const labelName = (id) => LABEL.get(id)?.name ?? id;
export const labelColor = (id) => LABEL.get(id)?.color ?? '#8A8F98';
export const statusName = (id) => STATUS.get(id)?.name ?? id;
export const issueId = (number) => `${TEAM.key}-${number}`;
export const issueNumber = (id) => Number(/-(\d+)$/.exec(id)?.[1] ?? 0);

// Messages ------------------------------------------------------------------

// "SW-12 [High · Migration, Security]: " files an issue; "SW-12: " comments.
const PREFIX = new RegExp(`^${TEAM.key}-(\\d{1,6})(?:[ \\t]*\\[([^\\]\\n]{0,160})\\])?[ \\t]*:[ \\t]*`);

export function newIssueMessage({ id, title, description = '', priority = 'none', labels = [] }) {
  const meta = [priorityName(priority), labels.map(labelName).join(', ')].filter(Boolean).join(' · ');
  const head = `${id} [${meta}]: ${title.replace(/\s+/g, ' ').trim()}`;
  return description.trim() ? `${head}\n\n${description.trim()}` : head;
}

export function commentMessage(id, text) {
  return `${id}: ${text.trim()}`;
}

/** Reads a visitor message back: { id, kind: 'issue' | 'comment', … } or null. */
export function parseVisitorText(body) {
  const match = PREFIX.exec(String(body));
  if (!match) return null;
  const id = issueId(Number(match[1]));
  const rest = String(body).slice(match[0].length);
  if (match[2] === undefined) return { id, kind: 'comment', text: rest.trim() };
  let priority = 'none';
  const labels = [];
  for (const part of match[2].split('·')) {
    const name = part.trim().toLowerCase();
    const known = PRIORITIES.find((p) => p.name.toLowerCase() === name);
    if (known) priority = known.id;
    else for (const label of part.split(',')) {
      const found = LABELS.find((l) => l.name.toLowerCase() === label.trim().toLowerCase());
      if (found && !labels.includes(found.id)) labels.push(found.id);
    }
  }
  const [title, ...more] = rest.split('\n');
  return { id, kind: 'issue', title: title.trim(), description: more.join('\n').trim(), priority, labels };
}

// Replies are asked not to repeat the ID, but a stray "SW-12:" is stripped anyway.
const stripPrefix = (text) => String(text).replace(PREFIX, '');

// Stand's timestamps carry nanoseconds; Date.parse only promises milliseconds.
export function time(value) {
  const ms = Date.parse(String(value ?? '').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : 0;
}

// The conversation -------------------------------------------------------------

/**
 * Builds every issue on the page from the client's state and the page's own
 * storage: { meta: { [id]: { status, after, priority, labels, read } }, archive }.
 */
export function buildModel(state, local = {}, now = Date.now()) {
  const meta = local.meta ?? {};
  const live = deriveConversation(state, meta, now);
  const seeded = SEEDED.map((seed) => seededIssue(seed, meta[seed.id]));
  const liveIds = new Set(live.issues.map((issue) => issue.id));
  const archived = (Array.isArray(local.archive) ? local.archive : [])
    .filter((issue) => issue && !liveIds.has(issue.id))
    .map((issue) => withLocal({ ...issue, source: 'archived' }, meta[issue.id]));
  const issues = [...live.issues, ...archived, ...seeded];
  const numbers = issues.map((issue) => issue.number);
  const mine = issues.filter((issue) => issue.source !== 'seed');
  return {
    ...live,
    issues,
    byId: new Map(issues.map((issue) => [issue.id, issue])),
    nextId: issueId(Math.max(SEEDED.length, ...numbers) + 1),
    counts: {
      inbox: mine.filter((issue) => issue.unread > 0).length,
      mine: mine.filter((issue) => !CLOSED.has(issue.status)).length,
      triage: issues.filter((issue) => issue.status === 'triage').length,
    },
  };
}

function deriveConversation(state, meta, now) {
  const threads = new Map();
  const timeline = []; // who answered from which point on: { seq, host }
  const current = hostOf(state.host);
  const hostAt = (seq) => timeline.findLast((entry) => entry.seq <= seq)?.host ?? current;
  let thread = null; // the issue that replies belong to right now
  let lastConversation = null;
  let endedAt = 0;
  let offer = null;

  const open = (id, message, parsed) => {
    let t = threads.get(id);
    if (!t) {
      t = {
        id, number: issueNumber(id),
        title: parsed.kind === 'issue' ? parsed.title : clip(parsed.text),
        description: parsed.kind === 'issue' ? parsed.description : '',
        priority: parsed.priority ?? 'none', labels: parsed.labels ?? [],
        createdSeq: message.seq, createdAt: time(message.sentAt) || now, createdId: message.messageId,
        items: [], lastVisitorSeq: message.seq, lastReplySeq: -1, lastSeq: message.seq, pickup: null,
      };
      threads.set(id, t);
      if (parsed.kind === 'comment' && parsed.text) t.items.push(comment(message, YOU, parsed.text, true));
    } else {
      const text = parsed.kind === 'issue' ? [parsed.title, parsed.description].filter(Boolean).join('\n\n') : parsed.text;
      t.items.push(comment(message, YOU, text, true));
      t.lastVisitorSeq = message.seq;
    }
    t.lastSeq = Math.max(t.lastSeq, message.seq);
    return t;
  };

  for (const m of state.messages) {
    if (m.type === 'system-prompt' || m.senderType === 'system-prompt') continue;
    if (m.type === 'system-card' || m.senderType === 'system-card') {
      const card = parseCard(m.body);
      const at = time(m.sentAt) || now;
      switch (card.cardType) {
        case 'session-start':
          timeline.push({ seq: m.seq, host: { ...current, name: text(card.standinName) || (current.kind === 'standin' ? current.name : 'AI Stand-in'), kind: 'standin', avatar: current.kind === 'standin' ? current.avatar : '' } });
          if (thread && !thread.pickup) thread.pickup = { seq: m.seq, at, host: hostAt(m.seq) };
          break;
        case 'handoff':
        case 'human-transfer': {
          const host = { name: text(card.repName) || 'Someone from the team', title: text(card.repTitle), avatar: text(card.repAvatar), kind: 'rep' };
          timeline.push({ seq: m.seq, host });
          thread?.items.push({ kind: 'joined', key: m.messageId, seq: m.seq, at, who: host, message: text(card.message) });
          break;
        }
        case 'standin-takeover': {
          const host = { name: text(card.standinName) || 'AI Stand-in', title: text(card.standinTitle), avatar: text(card.standinAvatar), kind: 'standin' };
          timeline.push({ seq: m.seq, host });
          thread?.items.push({ kind: 'takeover', key: m.messageId, seq: m.seq, at, who: host, message: text(card.message) });
          break;
        }
        case 'rep-followup-offer':
          offer = { kind: 'offer', key: m.messageId, seq: m.seq, at, who: { name: text(card.repName) || hostAt(m.seq).name, kind: 'rep' }, message: text(card.message) };
          thread?.items.push(offer);
          break;
        case 'rep-followup-confirmation':
          thread?.items.push({ kind: 'followup', key: m.messageId, seq: m.seq, at, message: text(card.message) });
          break;
        case 'session-end':
          endedAt = at;
          break;
        default:
          // session-start aside, cards like link-clicked are bookkeeping: never shown.
      }
      continue;
    }
    if (!isConversation(m)) continue;
    lastConversation = m;
    if (m.senderType === 'visitor') {
      const parsed = parseVisitorText(m.body)
        ?? (thread ? { id: thread.id, kind: 'comment', text: m.body } : { id: issueId(nextNumber(threads)), kind: 'issue', title: clip(m.body), description: '' });
      thread = open(parsed.id, m, parsed);
      continue;
    }
    if (!thread) continue; // A reply before any question: nothing to attach it to.
    const who = replyAuthor(m, hostAt(m.seq));
    if (m.type === 'link-card') {
      const card = parseCard(m.body);
      const url = safeUrl(card.url);
      if (!url) continue;
      thread.items.push({ kind: 'link', key: m.messageId, messageId: m.messageId, seq: m.seq, at: time(m.sentAt) || now, who, url, title: text(card.title), description: text(card.description) });
    } else {
      thread.items.push(comment(m, who, stripPrefix(m.body), false));
    }
    thread.lastReplySeq = m.seq;
    thread.lastSeq = m.seq;
    if (!thread.pickup) thread.pickup = { seq: m.seq, at: time(m.sentAt) || now, host: hostAt(m.seq) };
  }

  // The unconfirmed message: shown at once, as "Sending…" or "Not delivered".
  const pending = state.pending?.body ? state.pending : null;
  let pendingOn = null;
  if (pending) {
    const parsed = parseVisitorText(pending.body)
      ?? (thread ? { id: thread.id, kind: 'comment', text: pending.body } : null);
    if (parsed) {
      const failed = !state.busy;
      const fake = { seq: Infinity, sentAt: '', messageId: 'pending' };
      let t = threads.get(parsed.id);
      if (!t && parsed.kind === 'issue') {
        t = open(parsed.id, fake, parsed);
        t.pending = failed ? 'failed' : 'sending';
        t.createdAt = now;
      } else {
        t ??= open(parsed.id, fake, { ...parsed, kind: 'issue', title: clip(parsed.text ?? ''), description: '' });
        const body = parsed.kind === 'issue' ? [parsed.title, parsed.description].filter(Boolean).join('\n\n') : parsed.text;
        t.items.push({ ...comment(fake, YOU, body, true), key: 'pending', state: failed ? 'failed' : 'sending', at: now });
        t.lastVisitorSeq = Infinity;
      }
      pendingOn = t.id;
    }
  }

  // Which issue a reply is due on. Until it lands, other issues wait.
  const activeThread = pendingOn ?? (lastConversation?.senderType === 'visitor' ? parseVisitorText(lastConversation.body)?.id ?? thread?.id : null);
  const replyDue = state.phase === 'active' && lastConversation?.senderType === 'visitor'
    && (state.activity || now - time(lastConversation.sentAt) < REPLY_LOCK);
  const waitingOn = pendingOn ?? (state.activity ? thread?.id : replyDue ? activeThread : null) ?? null;
  const activityOn = state.activity && state.phase === 'active' ? thread?.id ?? null : null;
  const ended = state.phase === 'ended';

  const issues = [...threads.values()].map((t) => {
    // A confirmed message means a conversation exists, and someone has it.
    const confirmed = !t.pending;
    const due = t.lastVisitorSeq > t.lastReplySeq;
    const replies = t.items.filter((item) => !item.mine && (item.kind === 'comment' || item.kind === 'link'));
    let status = !confirmed ? 'triage' : due ? 'progress' : 'review';
    // When the conversation ends, its issues close: answered ones as Done.
    if (ended && confirmed) status = replies.length ? 'done' : 'canceled';
    const mine = meta[t.id];
    const heldLocally = Boolean(mine?.status) && confirmed && t.lastVisitorSeq <= (mine.after ?? -1);
    if (heldLocally) status = mine.status;
    const pickupHost = t.pickup?.host ?? hostAt(t.createdSeq);
    const assignee = !confirmed ? null : CLOSED.has(status) ? hostAt(t.lastSeq) : current.name ? current : pickupHost;
    const feed = [{ kind: 'created', key: 'created', at: t.createdAt, who: YOU, state: t.pending ?? 'sent' }];
    if (confirmed) feed.push({ kind: 'pickup', key: 'pickup', at: t.pickup?.at ?? t.createdAt, who: pickupHost });
    feed.push(...t.items);
    if (offer && t.items.includes(offer)) offer.active = state.followupOffered && state.phase === 'active';
    if (heldLocally) insertByTime(feed, { kind: 'status', key: `status-${mine.status}`, at: mine.at ?? now, who: YOU, to: mine.status });
    if (ended) feed.push({ kind: 'ended', key: 'ended', at: endedAt || now, closedAs: heldLocally ? null : status });
    const read = mine?.read ?? -1;
    return {
      id: t.id, number: t.number, source: 'live',
      title: t.title || 'Untitled', description: t.description,
      priority: mine?.priority ?? t.priority, labels: mine?.labels ?? t.labels,
      status, assignee, creator: YOU,
      created: t.createdAt, updated: Math.max(t.createdAt, ...feed.map((item) => (Number.isFinite(item.at) ? item.at : 0))),
      feed, pending: t.pending ?? null,
      thinking: activityOn === t.id,
      waiting: CLOSED.has(status) ? null : due ? 'team' : 'you',
      unread: replies.filter((item) => item.seq > read).length,
      lastReplySeq: t.lastReplySeq, lastVisitorSeq: t.lastVisitorSeq,
    };
  });

  return {
    issues,
    phase: state.phase,
    host: current,
    ended,
    waitingOn,
    activityOn,
    activity: state.activity,
    offer: offer?.active ? offer : null,
  };

  function nextNumber(map) {
    return Math.max(SEEDED.length, ...[...map.values()].map((t) => t.number)) + 1;
  }
}

function comment(message, who, body, mine) {
  return { kind: 'comment', key: message.messageId, messageId: message.messageId, seq: message.seq, at: time(message.sentAt), who, text: String(body).trim(), mine, state: 'sent' };
}

// Who wrote a reply: the host at that point, when the sender type agrees.
function replyAuthor(message, host) {
  const kind = message.senderType === 'rep' ? 'rep' : 'standin';
  if (host.kind === kind || !host.kind) return { ...host, kind };
  return { name: kind === 'rep' ? 'Someone from the team' : 'AI Stand-in', kind };
}

function hostOf(host = {}) {
  return { name: text(host.name), title: text(host.title), avatar: text(host.avatar), kind: host.kind === 'rep' || host.kind === 'standin' ? host.kind : null };
}

// Axial's own issues ---------------------------------------------------------

function seededIssue(seed, mine) {
  const who = { ...PEOPLE[seed.assignee], kind: 'team' };
  const at = (value) => Date.parse(`${value}:00Z`);
  return withLocal({
    id: seed.id, number: issueNumber(seed.id), source: 'seed',
    title: seed.title, description: seed.description,
    priority: seed.priority, labels: seed.labels,
    status: 'done', assignee: who, creator: VISITOR,
    created: at(seed.filed), updated: at(seed.done), asked: seed.asked,
    feed: [
      { kind: 'created', key: 'created', at: at(seed.filed), who: VISITOR, state: 'sent' },
      { kind: 'pickup', key: 'pickup', at: at(seed.filed) + 60000, who },
      { kind: 'comment', key: 'answer', seq: 1, at: at(seed.answered), who, text: seed.answer, mine: false, state: 'sent' },
      { kind: 'status', key: 'done', at: at(seed.done), who, to: 'done' },
      { kind: 'asked', key: 'asked', at: at(seed.done), count: seed.asked },
    ],
    pending: null, thinking: false, waiting: null, unread: 0,
  }, mine);
}

// Status, priority and labels you set here are yours alone: Stand never sees them.
function withLocal(issue, mine) {
  if (!mine) return issue;
  const status = mine.status && mine.status !== issue.status ? mine.status : null;
  const feed = status ? [...issue.feed] : issue.feed;
  if (status && !feed.some((item) => item.key === `status-${status}`)) {
    insertByTime(feed, { kind: 'status', key: `status-${status}`, at: mine.at ?? Date.now(), who: YOU, to: status });
  }
  return {
    ...issue,
    status: status ?? issue.status,
    priority: mine.priority ?? issue.priority,
    labels: mine.labels ?? issue.labels,
    feed,
  };
}

function insertByTime(feed, item) {
  const index = feed.findLastIndex((other) => other.kind !== 'ended' && (other.at ?? 0) <= item.at);
  feed.splice(index + 1, 0, item);
}

/** A closed conversation's issues, kept so they stay in the list after a reload. */
export function archiveOf(issue) {
  return {
    id: issue.id, number: issue.number, title: issue.title, description: issue.description,
    priority: issue.priority, labels: issue.labels, status: issue.status,
    assignee: issue.assignee, creator: issue.creator, created: issue.created, updated: issue.updated,
    feed: issue.feed
      .filter((item) => item.kind !== 'offer')
      .map((item) => ({ ...item, state: item.state === 'sending' ? 'failed' : item.state })),
    pending: null, thinking: false, waiting: null, unread: 0,
  };
}

// Replies as text ------------------------------------------------------------

/**
 * Splits reply text into blocks of inline tokens: paragraphs, "- " lists,
 * **bold**, `code`, http(s) links, [[references]] and bare issue IDs. The view
 * turns tokens into DOM nodes; nothing here is ever parsed as HTML.
 */
export function blocks(value) {
  const out = [];
  for (const para of String(value).replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    let lines = [];
    let list = null;
    const flush = () => {
      if (lines.length) out.push({ type: 'p', lines: lines.map(inlines) });
      lines = [];
    };
    for (const line of para.split('\n')) {
      const item = /^\s*[-*•]\s+(.+)$/.exec(line);
      if (item) {
        flush();
        if (!list) out.push((list = { type: 'ul', items: [] }));
        list.items.push(inlines(item[1]));
      } else if (line.trim()) {
        list = null;
        lines.push(line.trim());
      }
    }
    flush();
  }
  return out;
}

const INLINE = new RegExp(String.raw`\*\*([^*\n]+?)\*\*|` + '`([^`\\n]+)`' + String.raw`|\[\[([^\[\]\n]{1,80})\]\]|(https?:\/\/[^\s<>"']+)|\b(${TEAM.key}-\d{1,6})\b`, 'g');

export function inlines(line) {
  const tokens = [];
  let last = 0;
  const plain = (value) => value && tokens.push({ t: 'text', v: value });
  for (const m of line.matchAll(INLINE)) {
    plain(line.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) tokens.push({ t: 'b', v: m[1] });
    else if (m[2]) tokens.push({ t: 'code', v: m[2] });
    else if (m[3]) {
      const target = resolveRef(m[3]);
      tokens.push(target ? { t: 'ref', v: m[3].trim(), target } : { t: 'text', v: m[3].trim() });
    } else if (m[4]) {
      // Sentence punctuation after a link isn't part of it.
      const url = m[4].replace(/[.,;:!?)\]]+$/, '');
      last -= m[4].length - url.length;
      tokens.push({ t: 'link', v: url, href: url });
    } else if (m[5]) {
      tokens.push({ t: 'ref', v: m[5], target: { kind: 'issue', id: m[5] }, bare: true });
    }
  }
  plain(line.slice(last));
  return tokens;
}

const PLAN_IDS = ['free', 'standard', 'plus', 'enterprise'];

/** Maps a [[reference]] to something on the page, or null for unknown ones. */
export function resolveRef(raw) {
  const name = String(raw).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');
  const issue = new RegExp(`^${TEAM.key.toLowerCase()}-(\\d{1,6})\\b`).exec(name);
  if (issue) return { kind: 'issue', id: issueId(Number(issue[1])) };
  const plan = /^(?:(?:plan|pricing)\s*[:›>-]?\s*)?([a-z]+)(?:\s+plan)?$/.exec(name);
  if (plan && PLAN_IDS.includes(plan[1])) return { kind: 'plan', id: plan[1] };
  return null;
}

// Helpers ---------------------------------------------------------------------

export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function clip(value, max = 80) {
  const line = String(value).split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
