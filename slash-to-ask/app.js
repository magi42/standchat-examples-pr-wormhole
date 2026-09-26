// Type / to ask: a document whose slash menu can ask the team.
//
//   stand-visitor.js  the network: discovery, one session, sends, replies, recovery
//   threads.js        the conversation model: message format, threads, notes, prompt
//   doc.js, menus.js  the editor: blocks, the slash menu, the selection toolbar
//   ask.js            how an ask block looks
//   widgets.js        the notes about your team, and the Plans database
//   outline.js        the floating outline on wide screens
//
// This file keeps each ask block's own state (the exact messages it sent, its
// draft, whether it's folded) and turns Stand's state into what every block
// shows. Stand's transcript stays the source of truth for the conversation.

import { getClient } from './stand-visitor.js';
import { assignThreads, buildPrompt, formatQuestion, notesAtTeam, notesText, parseQuestion, PROMPT_LIMIT } from './threads.js';
import { createDoc } from './doc.js';
import { createAskElement, renderAsk, replyText } from './ask.js';
import { mountPop, openMenu, closePop } from './menus.js';
import { initDatabase, initProps } from './widgets.js';
import { createOutline } from './outline.js';
import { avatarHtml, escapeHtml, newId, safeUrl } from './util.js';

const SEED = 'kenning-1'; // Bump when the published page changes shape; old saved edits are then ignored.
const DOC_KEY = 'slash-to-ask:v1:doc';
const $ = (selector) => document.querySelector(selector);
const coarse = matchMedia('(pointer: coarse)');

const client = getClient({ site: 'demo' }); // Stand Chat's shared demo site: answers on any domain.

// Human-sized messages for the client's error codes.
const ERRORS = {
  connect: "Can't reach the team right now.",
  start: "Your question didn't go through, so nothing was started.",
  uncertain: "We couldn't confirm your question arrived. It may have started a conversation already.",
  send: 'Not delivered.',
  lost: 'Your last message wasn’t confirmed before the conversation ended.',
  gone: 'This conversation is no longer available.',
  paused: 'Connection paused. Replies may be waiting.',
  refresh: 'Couldn’t refresh the answers. Reconnecting…',
  end: 'Couldn’t end the conversation. Try again.',
  email: 'That email didn’t go through. Check it and try again.',
  offer: 'That offer has expired.',
};

// ---------- Ask blocks' own state ----------

/** Per block: what it sent (exact bodies), its drafts, and how it's folded. */
const asks = new Map();

function askModel(data = {}) {
  const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  return {
    heading: str(data.heading, 100),
    quote: str(data.quote, 160),
    draft: str(data.draft, 1500),
    sent: Array.isArray(data.sent) ? data.sent.filter((b) => typeof b === 'string').slice(-60) : [],
    reply: data.reply === true,
    replyDraft: str(data.replyDraft, 1500),
    replyQuote: str(data.replyQuote, 160),
    resolved: data.resolved === true,
    open: data.open === true,
    archived: data.archived === true,
    snapshot: Array.isArray(data.snapshot) ? data.snapshot.filter((i) => i && typeof i === 'object').slice(-40) : [],
  };
}

// Render state: the last thread split, the previous Stand state, and what's shown.
let lastResult = null;
let prevState = null;
let frame = 0;
let shownIdentity = '';
let knownStandin = {}; // The AI Stand-in seen in discovery, in case a transcript never names it.
const announced = new Set();
let primed = false;

// ---------- The document ----------

let props = null;
let database = null;
const pageState = { style: 'default', small: false, wide: false };

const doc = createDoc({
  page: $('#doc'),
  root: $('#doc-body'),
  title: $('#doc-title'),
  crumb: $('#crumb-title'),
  storageKey: DOC_KEY,
  seed: SEED,
  types: {
    ask: {
      create(id, data) {
        asks.set(id, askModel(data));
        return createAskElement(id);
      },
      serialize: (el) => asks.get(el.id),
      removable: (el) => !asks.get(el.id)?.sent.length,
      menuItems: (el) => askMenuItems(el.id, false),
    },
  },
  hooks: {
    onAsk: ({ block, replace, before }) => insertAsk({ after: block, replace, before }),
    onAskAbout: ({ block, quote, node }) => askAbout(block, quote, node),
    onEdited: () => ($('#edited').hidden = false),
    onChange: () => renderSoon(),
    onStructure: () => renderSoon(),
    announce,
    pageState: () => ({ ...pageState }),
    staticState: () => ({ props: props?.state(), db: database?.state() }),
  },
});

const saved = doc.restore();
props = initProps($('#props-team'), saved?.statics?.props, () => doc.changed());
database = initDatabase($('#db-plans'), saved?.statics?.db, () => doc.saveSoon());
applyPageState(saved?.page);
const outline = createOutline({ root: $('#doc-body'), onGo: (id) => doc.reveal(id, { light: false }) });

// ---------- Asking ----------

/** A new ask block: after a block, in place of an empty line, or before the invite line. */
function insertAsk({ after, replace = false, before = false, quote = '' }) {
  const id = newId('ask');
  asks.set(id, askModel({ heading: doc.headingFor(after, { self: !replace && !before }), quote }));
  const el = createAskElement(id);
  if (replace) doc.replace(after, el);
  else if (before) doc.insertBefore(after, el);
  else doc.insertAfter(after, el);
  render();
  el.querySelector('.ask-input').focus();
  el.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  doc.save();
  return el;
}

/** "Ask about this": below the block the words came from, or as a reply when they're from an answer. */
function askAbout(block, quote, node) {
  const from = (node instanceof Element ? node : node?.parentElement)?.closest('.blk[data-block="ask"]');
  const ask = from && asks.get(from.id);
  if (ask && ask.sent.length && !ask.archived && client.getSnapshot().phase === 'active') {
    ask.reply = true;
    ask.replyQuote = quote.slice(0, 160);
    ask.resolved = false;
    render();
    from.querySelector('.ask-input').focus();
    doc.save();
    return;
  }
  const el = insertAsk({ after: ask ? from : block, quote });
  announce(`New question about “${quote}”. Type it, then press Enter.`);
  return el;
}

async function sendFrom(id, text) {
  const ask = asks.get(id);
  const state = client.getSnapshot();
  if (!ask || !gateFor(state, lastResult, id).ok) return;
  const reply = ask.reply && ask.sent.length > 0;
  const first = state.phase !== 'active';
  const notes = currentNotes();
  // Later questions carry the notes only when they changed since the team last saw them.
  const changedNotes = !first && notes !== notesAtTeam(state.messages) ? notes : '';
  const body = formatQuestion({
    reply,
    heading: ask.heading,
    quote: reply ? ask.replyQuote : ask.quote,
    text,
    notes: changedNotes,
  });
  ask.sent.push(body);
  if (reply) Object.assign(ask, { reply: false, replyDraft: '', replyQuote: '' });
  else ask.draft = '';
  const el = document.getElementById(id);
  el.querySelector('.ask-input').textContent = '';
  // Saved before the request: after a reload mid-send, the page still knows this was ours.
  doc.save();
  render();
  el.querySelector('.ask').tabIndex = -1;
  el.querySelector('.ask').focus({ preventScroll: true });
  await client.send(body, first ? { prompt: buildPrompt(notes), analyticsId: 'slash-to-ask' } : {});
}

async function startNewConversation() {
  const result = lastResult;
  // Nothing is replayed into the new conversation: unsent words become drafts the visitor sends again.
  for (const el of askElements()) {
    const ask = asks.get(el.id);
    const unsent = result?.unconfirmed.get(el.id) ?? [];
    const answered = (result?.threads.get(el.id) ?? []).length > 0;
    const words = unsent.map((body) => parseQuestion(body)?.text ?? body).join('\n');
    ask.sent = ask.sent.filter((body) => !unsent.includes(body));
    if (answered || ask.snapshot.length) {
      ask.archived = true;
      if (words) {
        const next = createAskElement(newId('ask'));
        asks.set(next.id, askModel({ heading: ask.heading, draft: words }));
        doc.insertAfter(el, next, { quiet: true });
      }
    } else if (words) {
      ask.draft = [words, ask.draft].filter(Boolean).join('\n');
    }
  }
  doc.save();
  await client.newChat();
}

// ---------- Actions from ask blocks ----------

const actions = {
  send: (id, text) => void sendFrom(id, text),
  draft(id, text) {
    const ask = asks.get(id);
    if (!ask) return;
    if (ask.reply) ask.replyDraft = text;
    else ask.draft = text;
    doc.saveSoon();
  },
  cancel(id, empty) {
    const ask = asks.get(id);
    const el = document.getElementById(id);
    if (!ask || !el) return;
    if (ask.reply) {
      Object.assign(ask, { reply: false, replyQuote: '' });
      render();
      el.querySelector('.ask-fbtn')?.focus();
    } else if (empty && !ask.sent.length) {
      // An empty question block goes away again, like an empty line.
      const prev = el.previousElementSibling;
      doc.remove(el);
      asks.delete(id);
      if (prev?.matches('.blk')) doc.focusBlock(prev, 'end');
    } else {
      el.querySelector('.ask-input').blur();
    }
    doc.save();
  },
  more(id, button) {
    openMenu({ items: askMenuItems(id, true), anchor: button, label: 'Question options', className: 'blockmenu', returnFocus: button, align: 'end' });
  },
  fold(id) {
    const ask = asks.get(id);
    ask.open = !ask.open;
    render();
    doc.save();
  },
  act(name, id) {
    const ask = asks.get(id);
    if (name === 'reply' && ask) {
      Object.assign(ask, { reply: true, replyQuote: '', resolved: false });
      render();
      document.getElementById(id)?.querySelector('.ask-input').focus();
    } else if (name === 'resolve' && ask) {
      Object.assign(ask, { resolved: !ask.resolved, open: false, reply: false });
      render();
      document.getElementById(id)?.querySelector(ask.resolved ? '.ask-fold' : '.ask-fbtn')?.focus();
      announce(ask.resolved ? 'Resolved. The question is folded away.' : 'Reopened.');
    } else if (name === 'retry') {
      void client.retry();
    } else if (name === 'retrySend') {
      void client.send();
    } else if (name === 'newChat') {
      void startNewConversation();
    } else if (name === 'end') {
      void client.end();
    } else if (name === 'attribution') {
      client.trackAttributionClick();
    }
    doc.save();
  },
  email: (value) => void client.submitEmail(value),
  link: (messageId, url) => client.trackLinkClick(messageId, url),
  resolve: (name) => resolveRef(name),
};

function askMenuItems(id, fromBlock) {
  const ask = asks.get(id);
  if (!ask) return [];
  const phase = client.getSnapshot().phase;
  return [
    ...(ask.sent.length ? [{ label: ask.resolved ? 'Reopen' : 'Resolve', icon: 'ui-resolve', run: () => actions.act('resolve', id) }] : []),
    ...(fromBlock && !ask.sent.length ? [{ label: 'Remove this question', icon: 'ui-trash', run: () => actions.cancel(id, true) }] : []),
    ...(phase === 'active' ? [{ separator: true }, { label: 'End conversation', icon: 'ui-close', danger: true, run: () => void client.end() }] : []),
  ];
}

// ---------- References in answers ----------

// Case, spaces and trailing punctuation don't matter when matching a name.
const normalize = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');

// Names the prompt teaches, mapped to their blocks, so they keep working after the
// visitor renames a heading. Other headings, toggles and the database resolve by
// their current names too.
const REFS = new Map([
  ['Heading: About your team', 'h-team'],
  ['Heading: What moves over', 'h-moves'],
  ['Heading: Importing your wiki', 'h-import'],
  ['Heading: Plans and pricing', 'h-plans'],
  ['Database: Plans', 'db-plans'],
  ['Toggle: How pricing works', 't-pricing'],
  ['Toggle: Can we try Business first?', 't-trial'],
  ['Toggle: Discounts', 't-discounts'],
  ['Toggle: What if our export is huge?', 't-huge'],
  ['Heading: Security and admin', 'h-security'],
  ['Heading: Apps, offline and API', 'h-apps'],
  ['Heading: AI in Kenning', 'h-ai'],
].map(([name, id]) => [normalize(name), id]));

function resolveRef(raw) {
  const name = normalize(raw);
  const known = REFS.get(name);
  const el = known && document.getElementById(known);
  if (el) return { id: el.id, label: labelFor(el) };
  const [, kind, rest] = /^(heading|toggle|database|section)\s*:\s*(.+)$/.exec(name) ?? [];
  if (!rest) return null;
  for (const blk of doc.blocks()) {
    const type = doc.typeOf(blk);
    const fits = kind === 'toggle' ? type === 'toggle' : kind === 'database' ? blk.dataset.kind === 'database' : /^h[123]$/.test(type);
    if (fits && normalize(labelFor(blk)) === normalize(rest)) return { id: blk.id, label: labelFor(blk) };
  }
  return null;
}

function labelFor(el) {
  if (el.dataset.kind === 'database') return el.querySelector('.db-title')?.textContent.trim() || 'Plans';
  return doc.textOf(el)?.textContent.trim() || '';
}

// ---------- From Stand's state to the page ----------

const askElements = () => [...document.querySelectorAll('#doc-body .blk[data-block="ask"]')];

function render(state = client.getSnapshot()) {
  const claims = () => askElements().map((el) => ({ id: el.id, sent: asks.get(el.id)?.sent ?? [] }));
  if (state.host.kind === 'standin' && state.host.name) knownStandin = { name: state.host.name, avatar: state.host.avatar };
  let result = assignThreads(state.messages, claims(), state.host, knownStandin);
  if (result.recovered.size) {
    for (const [id, info] of result.recovered) recoverBlock(id, info);
    result = assignThreads(state.messages, claims(), state.host, knownStandin);
  }
  effects(prevState, state, result);
  lastResult = result;
  for (const el of askElements()) if (asks.has(el.id)) renderAsk(el, viewFor(el.id, state, result), actions);
  renderChrome(state, result);
  outline.update();
  announceNew(state, result);
  renderPreview(state);
  prevState = state;
}

function renderSoon() {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

/** A question the page lost track of (say, after "Reset this page"): back under its heading. */
function recoverBlock(id, { heading, quote, body }) {
  asks.set(id, askModel({ heading, quote, sent: [body] }));
  doc.insertAfter(sectionEnd(heading), createAskElement(id), { quiet: true });
}

function sectionEnd(heading) {
  const top = [...$('#doc-body').children].filter((el) => el.matches('.blk'));
  const start = top.findIndex((el) => /^h[123]$/.test(doc.typeOf(el)) && normalize(labelFor(el)) === normalize(heading));
  if (start < 0) return top.findLast((el) => doc.typeOf(el) !== 'divider' && el.id !== 'p-end') ?? top.at(-1);
  const level = Number(doc.typeOf(top[start])[1]);
  let end = start;
  while (end + 1 < top.length && !(/^h[123]$/.test(doc.typeOf(top[end + 1])) && Number(doc.typeOf(top[end + 1])[1]) <= level) && doc.typeOf(top[end + 1]) !== 'divider') end++;
  return top[end];
}

function effects(prev, state, result) {
  let dirty = false;
  // Stand turned the start down: the question goes back into its block, ready to send again.
  if (state.phase === 'unavailable' && state.error === 'start' && prev?.error !== 'start') {
    for (const [id, ask] of asks) {
      const unsent = result.unconfirmed.get(id) ?? [];
      if (!unsent.length || (result.threads.get(id) ?? []).length) continue;
      ask.draft = [unsent.map((body) => parseQuestion(body)?.text ?? body).join('\n'), ask.draft].filter(Boolean).join('\n');
      ask.sent = ask.sent.filter((body) => !unsent.includes(body));
      dirty = true;
    }
  }
  // On load: a block whose conversation is over and gone (it ended before the
  // reload) keeps its copy and becomes read-only. Starting a new conversation
  // archives blocks the same way, in startNewConversation().
  if (!prev && state.phase !== 'uncertain') {
    for (const [id, ask] of asks) {
      if (!ask.sent.length || ask.archived || (result.threads.get(id) ?? []).length) continue;
      ask.archived = true;
      ask.reply = false;
      dirty = true;
    }
  }
  for (const [id, items] of result.threads) {
    const ask = asks.get(id);
    if (!ask || ask.archived || !items.length) continue;
    const snapshot = items.map(compact);
    if (JSON.stringify(snapshot) !== JSON.stringify(ask.snapshot)) {
      ask.snapshot = snapshot;
      dirty = true;
    }
  }
  if (dirty) doc.saveSoon();
}

// What an archived block keeps of its thread: text and names, no ids to act on.
function compact(item) {
  const who = item.who ? { name: item.who.name, kind: item.who.kind, avatar: item.who.avatar } : undefined;
  return {
    kind: item.kind,
    text: item.text,
    quote: item.quote || undefined,
    reply: item.reply || undefined,
    who,
    url: item.url,
    title: item.title,
    description: item.description,
    cardType: item.cardType,
    card: item.cardType ? { repName: item.card?.repName, standinName: item.card?.standinName } : undefined,
  };
}

/** Whether a block may send now, and if not, what to tell the visitor. */
function gateFor(state, result, id) {
  const headingOf = (other) => asks.get(other)?.heading || 'another question';
  switch (state.phase) {
    case 'loading':
      return { ok: false, text: 'Checking who can answer…' };
    case 'unavailable':
      return state.error === 'start'
        ? { ok: false, bad: true, text: ERRORS.start, action: { label: 'Try again', act: 'retry' } }
        : {
          ok: false,
          text: state.error === 'connect' ? `${ERRORS.connect} Your question stays here.` : 'Nobody from the team can answer right now. Your question stays here as a note.',
          action: { label: 'Check again', act: 'retry' },
        };
    case 'uncertain':
      return { ok: false, bad: true, text: ERRORS.uncertain, action: { label: 'Start a new conversation', act: 'newChat' } };
    case 'ended':
      return { ok: false, text: 'This conversation has ended.', action: { label: 'Start a new conversation', act: 'newChat' } };
    default:
  }
  if (state.busy) return { ok: false, text: '' };
  if (state.pending && !state.pending.creating) {
    const owner = ownerOf(state.pending.body);
    if (owner === id) return { ok: false, text: '' };
    return { ok: false, text: `Your question under “${headingOf(owner)}” wasn’t delivered yet.`, action: { label: 'Retry it', act: 'retrySend' } };
  }
  if ((result?.due || state.activity) && result?.current && result.current !== id) {
    return { ok: false, text: `Waiting for the answer under “${headingOf(result.current)}”…` };
  }
  return { ok: true };
}

function ownerOf(body) {
  for (const [id, ask] of asks) if (ask.sent.includes(body)) return id;
  return null;
}

function viewFor(id, state, result) {
  const ask = asks.get(id);
  const host = state.host;
  const name = host.name || 'The team';
  const live = result.threads.get(id) ?? [];
  const unconfirmed = ask.archived ? [] : result.unconfirmed.get(id) ?? [];
  const items = ask.archived ? ask.snapshot : live;
  const asked = ask.sent.length > 0 || items.length > 0;
  const current = result.current === id;
  const active = state.phase === 'active';
  const gate = gateFor(state, result, id);
  const answers = items.filter((item) => item.kind === 'a' || item.kind === 'link');
  const lastAnswerer = answers.at(-1)?.who;

  const pending = unconfirmed.map((body) => {
    const parsed = parseQuestion(body);
    let status = 'sending';
    if (state.pending?.body === body) status = !state.busy && state.error === 'send' ? 'failed' : 'sending';
    else if (state.phase === 'uncertain') status = 'uncertain';
    else if (state.phase === 'ended') status = 'lost';
    return { text: parsed?.text ?? body, quote: parsed?.quote ?? '', reply: Boolean(parsed?.reply), status };
  });

  const composing = !ask.archived && (!asked || ask.reply);
  const composer = composing ? {
    reply: asked,
    draft: asked ? ask.replyDraft : ask.draft,
    placeholder: asked ? `Reply to ${lastAnswerer?.name || name}…` : coarse.matches ? 'Ask the team anything' : 'Ask the team anything, then press Enter',
    label: asked ? 'Your reply' : 'Your question for the team',
    canSend: gate.ok,
  } : null;

  let note = null;
  if (composing && !gate.ok && gate.text) note = gate;
  else if (!ask.archived && unconfirmed.length && state.phase === 'uncertain') note = { text: ERRORS.uncertain, bad: true, action: { label: 'Start a new conversation', act: 'newChat' } };
  else if (!ask.archived && current && active && ['paused', 'refresh', 'connect'].includes(state.error)) note = { text: ERRORS[state.error], action: state.error === 'refresh' ? null : { label: 'Reconnect', act: 'retry' } };
  else if (!ask.archived && current && ['end', 'email', 'offer', 'gone', 'lost'].includes(state.error)) note = { text: ERRORS[state.error], bad: true, action: state.error === 'end' ? { label: 'Try again', act: 'end' } : null };

  const who = { name, avatar: host.avatar, kind: host.kind };
  const meta = composer ? {
    // Who answers, only once Stand has said: never a guess while loading or when nobody is there.
    who: host.kind && ['available', 'active'].includes(state.phase) ? { ...who, line: `${name} answers` } : null,
    hint: coarse.matches || !gate.ok ? '' : composer.reply ? 'Enter to send · Esc to cancel' : 'Enter to send',
    powered: safeUrl(state.poweredByUrl),
    notice: state.notice,
  } : null;

  const offering = !ask.archived && current && active && state.followupOffered;
  const offerCard = offering ? items.findLast((item) => item.kind === 'card' && item.cardType === 'rep-followup-offer') : null;
  const ended = !ask.archived && current && state.phase === 'ended';
  const foot = asked && !composing ? {
    reply: active && !ask.archived && answers.length > 0 && !pending.length,
    resolve: answers.length > 0 || ask.archived,
    resolveLabel: ask.resolved ? 'Reopen' : 'Resolve',
    newChat: ended,
    real: ask.archived ? 'Earlier conversation · via' : `Real conversation · ${(lastAnswerer?.kind ?? host.kind) === 'rep' ? 'a person from the team' : 'AI Stand-in'} via`,
    powered: safeUrl(state.poweredByUrl),
  } : null;

  const activity = !ask.archived && current && active && state.activity ? {
    label: `${name} is ${state.activity.kind === 'typing' ? 'typing' : 'writing'}…`,
    preview: state.activity.preview,
    who,
  } : null;

  const firstQuestion = items.find((item) => item.kind === 'q')?.text ?? pending[0]?.text ?? ask.draft;
  return {
    heading: ask.heading,
    quote: ask.quote,
    resolved: ask.resolved && asked,
    open: ask.open,
    archived: ask.archived,
    title: firstQuestion,
    foldMeta: ask.archived ? 'Earlier conversation' : answers.length ? (answers.length === 1 ? 'Answered' : `${answers.length} answers`) : 'Waiting for an answer',
    // While the email form is up, it stands in for the offer's own line.
    items: offerCard ? items.filter((item) => item !== offerCard) : items,
    pending,
    activity,
    composer,
    note,
    meta,
    ended: ended && !items.some((item) => item.cardType === 'session-end'),
    offer: offerCard ? { text: `${offerCard.card?.repName || 'The team'} couldn’t answer right away. Leave your email and they’ll follow up.`, busy: state.busy } : null,
    foot,
  };
}

// ---------- Top bar, slash menu identity, the example ----------

function askLine(state) {
  const name = state.host.name || 'The team';
  switch (state.phase) {
    case 'loading': return 'Checking who can answer…';
    case 'unavailable': return 'Nobody can answer right now';
    case 'uncertain': return 'Your last question needs a decision first';
    case 'ended': return 'Starts a new conversation';
    default: return state.host.kind === 'standin' ? `${name} (AI) answers here` : `${name} answers here`;
  }
}

function renderChrome(state, result) {
  const host = state.host;
  const name = host.name || 'The team';
  doc.setAsk({ name, avatar: host.avatar, kind: host.kind, line: askLine(state) });

  const identity = `${name}|${host.avatar}|${host.kind}`;
  if (identity !== shownIdentity) {
    shownIdentity = identity;
    renderIdentity(host, name);
  }
  renderTopbar(state, result);
}

// The illustrated slash menu and the top bar show who will really answer, as
// Stand's discovery says. (The illustrated answer speaks for Kenning, in the HTML.)
function renderIdentity(host, name) {
  const avatar = avatarHtml(name, host.avatar);
  for (const el of document.querySelectorAll('[data-host-avatar]')) {
    const holder = document.createElement('template');
    holder.innerHTML = avatar;
    const fresh = holder.content.firstElementChild;
    fresh.classList.add(...[...el.classList].filter((c) => c !== 'kn-av'));
    fresh.dataset.hostAvatar = '';
    el.replaceWith(fresh);
  }
  for (const el of document.querySelectorAll('[data-host-line]')) el.textContent = host.kind === 'standin' ? `${name} (AI) answers here` : `${name} answers here`;
  for (const el of document.querySelectorAll('[data-host-badge]')) {
    el.hidden = !host.kind;
    el.textContent = host.kind === 'rep' ? 'Team' : 'AI';
    el.dataset.kind = host.kind ?? '';
  }
}

function renderTopbar(state, result) {
  const asked = askElements().filter((el) => asks.get(el.id)?.sent.length);
  const count = $('#ask-count');
  count.hidden = !asked.length;
  count.textContent = String(asked.length);
  const button = $('#ask-btn');
  button.classList.toggle('is-waiting', Boolean(result.due));
  button.setAttribute('aria-label', `Ask the team${asked.length ? `: ${asked.length} question${asked.length === 1 ? '' : 's'} on this page` : ''}`);
  if (!$('#convo').hidden) renderConvo(state, result);
}

// References in answers (and in the example) jump to their block and light it up.
$('#doc-body').addEventListener('click', (e) => {
  const mention = e.target.closest('.mention[data-ref]');
  if (!mention) return;
  e.preventDefault();
  if (!doc.reveal(mention.dataset.ref)) announce(`${mention.textContent.trim()} isn't on this page anymore.`);
});

// ---------- The conversation panel ----------

$('#ask-btn').addEventListener('click', () => {
  if (!$('#convo').hidden) return closePop();
  openConvo();
});

function openConvo() {
  const panel = $('#convo');
  const button = $('#ask-btn');
  panel.hidden = false;
  renderConvo(client.getSnapshot(), lastResult);
  button.setAttribute('aria-expanded', 'true');
  mountPop(panel, {
    anchor: button,
    align: 'end',
    dialog: true,
    roles: 'button, a[href]',
    returnFocus: button,
    onClose() {
      panel.hidden = true;
      document.body.append(panel);
      button.setAttribute('aria-expanded', 'false');
    },
  });
}

function renderConvo(state, result) {
  const panel = $('#convo');
  const focusKey = document.activeElement?.closest?.('#convo') ? document.activeElement.dataset.key : null;
  const host = state.host;
  const name = host.name || 'The team';
  const dot = { active: state.connection === 'online' ? '' : 'is-warn', available: '', loading: 'is-warn', unavailable: 'is-off', ended: 'is-off', uncertain: 'is-warn' }[state.phase];
  const status = {
    loading: 'Checking who can answer…',
    available: host.kind === 'standin' ? 'Answers in a few seconds' : 'Here now',
    active: state.connection === 'online' ? 'In conversation' : 'Reconnecting…',
    unavailable: 'Nobody can answer right now',
    ended: 'Conversation ended',
    uncertain: 'Start not confirmed',
  }[state.phase];
  const kind = host.kind === 'standin' ? '<span class="chip chip-ai">AI</span>' : host.kind === 'rep' ? '<span class="chip chip-person">Person</span>' : '';
  const rows = askElements().filter((el) => asks.has(el.id)).map((el) => {
    const ask = asks.get(el.id);
    const view = viewFor(el.id, state, result ?? { threads: new Map(), unconfirmed: new Map() });
    const bad = view.pending.some((p) => p.status !== 'sending');
    const st = !ask.sent.length ? 'Draft' : ask.archived ? 'Earlier conversation' : bad ? 'Needs attention' : view.foldMeta;
    return `<li><button type="button" class="pop-item" data-key="go-${el.id}" data-go="${el.id}">
      <span class="where">Under ${escapeHtml(ask.heading)}</span>
      <span class="q">${escapeHtml(view.title || 'Empty question')}</span>
      <span class="st${bad ? ' is-bad' : ''}">${escapeHtml(st)}</span></button></li>`;
  });
  const error = state.error && ERRORS[state.error] && !['send'].includes(state.error) ? ERRORS[state.error] : '';
  const powered = safeUrl(state.poweredByUrl);
  const recover = state.phase === 'ended' || state.phase === 'uncertain'
    ? '<button type="button" class="btn" data-key="new" data-act="newChat">Start a new conversation</button>'
    : state.phase === 'unavailable' || ['connect', 'paused'].includes(state.error)
      ? '<button type="button" class="btn btn-quiet" data-key="retry" data-act="retry">Check again</button>'
      : '';
  panel.innerHTML = `
    <div class="convo-who">${avatarHtml(name, host.avatar)}
      <div><p class="name">${escapeHtml(name)} ${kind}</p><p class="state"><span class="convo-dot ${dot}" aria-hidden="true"></span>${escapeHtml(status)}</p></div>
    </div>
    ${rows.length
      ? `<ul class="convo-list" aria-label="Your questions on this page">${rows.join('')}</ul>`
      : `<p class="convo-empty">Type <span class="kbd">/</span> on any line and choose <b>Ask the team</b>, or select some text and pick <b>Ask about this</b>. Answers appear right where you ask.</p>`}
    ${error ? `<p class="convo-note is-bad" role="status">${escapeHtml(error)}</p>` : ''}
    ${state.notice ? `<p class="convo-note">${escapeHtml(state.notice)}</p>` : ''}
    <div class="convo-foot">
      ${state.phase === 'active' ? '<button type="button" class="btn btn-quiet" data-key="end" data-act="end">End conversation</button>' : recover}
      <span class="kn-grow"></span>
      ${powered ? `<a href="${escapeHtml(powered)}" target="_blank" rel="noopener noreferrer" data-key="powered" data-act="attribution">Powered by Stand</a>` : ''}
    </div>`;
  if (focusKey) panel.querySelector(`[data-key="${focusKey}"]`)?.focus();
}

$('#convo').addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (go) {
    closePop();
    const ask = asks.get(go.dataset.go);
    if (ask?.resolved) ask.open = true;
    render();
    doc.reveal(go.dataset.go);
  } else if (act === 'end') {
    void client.end();
  } else if (act === 'newChat') {
    closePop();
    void startNewConversation();
  } else if (act === 'retry') {
    void client.retry();
  } else if (act === 'attribution') {
    client.trackAttributionClick();
  }
});

// ---------- The page menu: styles, and resetting your edits ----------

$('#page-menu-btn').addEventListener('click', () => openPageMenu());

function openPageMenu() {
  const menu = $('#page-menu');
  const button = $('#page-menu-btn');
  const styles = [['default', 'Ag', 'Default'], ['serif', 'Ag', 'Serif'], ['mono', 'Ag', 'Mono']];
  menu.innerHTML = `
    <p class="pop-sec" role="presentation">Style</p>
    <div class="styles" role="group" aria-label="Page font">${styles.map(([value, sample, label]) =>
      `<button type="button" class="style" role="menuitemradio" tabindex="-1" aria-label="${label} font" aria-checked="${pageState.style === value}" data-style="${value}"><span aria-hidden="true" style="font-family: var(--font-${value === 'default' ? 'doc' : value})">${sample}</span><span>${label}</span></button>`).join('')}</div>
    <button type="button" class="pop-item" role="menuitemcheckbox" tabindex="-1" aria-checked="${pageState.small}" data-toggle="small"><span>Small text</span><span class="switch" aria-hidden="true"></span></button>
    <button type="button" class="pop-item" role="menuitemcheckbox" tabindex="-1" aria-checked="${pageState.wide}" data-toggle="wide"><span>Full width</span><span class="switch" aria-hidden="true"></span></button>
    <div class="pop-sep" role="separator"></div>
    <button type="button" class="pop-item is-danger" role="menuitem" tabindex="-1" data-reset><svg aria-hidden="true"><use href="#ui-turn"/></svg><span>Reset this page</span></button>`;
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  mountPop(menu, {
    anchor: button,
    align: 'end',
    roles: '[role^="menuitem"]',
    returnFocus: button,
    onClose() {
      menu.hidden = true;
      document.body.append(menu);
      button.setAttribute('aria-expanded', 'false');
    },
  });
}

$('#page-menu').addEventListener('click', (e) => {
  const style = e.target.closest('[data-style]');
  const toggle = e.target.closest('[data-toggle]');
  const reset = e.target.closest('[data-reset]');
  if (style) {
    applyPageState({ ...pageState, style: style.dataset.style });
    for (const b of $('#page-menu').querySelectorAll('[data-style]')) b.setAttribute('aria-checked', String(b === style));
  } else if (toggle) {
    const key = toggle.dataset.toggle;
    applyPageState({ ...pageState, [key]: !pageState[key] });
    toggle.setAttribute('aria-checked', String(pageState[key]));
  } else if (reset) {
    // Two steps, so a stray click doesn't throw away the visitor's edits.
    if (!reset.dataset.sure) {
      reset.dataset.sure = '1';
      reset.querySelector('span').textContent = 'Click again to reset your edits';
      return;
    }
    doc.reset();
    location.reload();
  }
  doc.save();
});

function applyPageState(next = {}) {
  pageState.style = ['serif', 'mono'].includes(next.style) ? next.style : 'default';
  pageState.small = next.small === true;
  pageState.wide = next.wide === true;
  const main = $('#doc');
  main.dataset.style = pageState.style;
  main.classList.toggle('is-small', pageState.small);
  main.classList.toggle('is-wide', pageState.wide);
  // The serif and mono faces load only when someone picks them.
  if (pageState.style !== 'default' && !document.getElementById(`font-${pageState.style}`)) {
    const link = document.createElement('link');
    link.id = `font-${pageState.style}`;
    link.rel = 'stylesheet';
    link.href = pageState.style === 'serif'
      ? 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&display=swap'
      : 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,600;0,700;1,400&display=swap';
    document.head.append(link);
  }
}

// ---------- Notes: what travels with a question ----------

function currentNotes() {
  return notesText({ ...props.values(), needs: needs() });
}

/** The ticked to-dos in the "About your team" section, as short phrases. */
function needs() {
  const top = [...$('#doc-body').children].filter((el) => el.matches('.blk'));
  const start = top.findIndex((el) => el.id === 'h-team');
  const section = [];
  for (let i = start + 1; start >= 0 && i < top.length; i++) {
    if (/^h[12]$/.test(doc.typeOf(top[i]))) break;
    section.push(top[i], ...top[i].querySelectorAll('.blk'));
  }
  const pool = start >= 0 ? section : [...document.querySelectorAll('#doc-body .blk[data-short]')];
  return pool
    .filter((el) => doc.typeOf(el) === 'todo' && el.querySelector(':scope > .blk-row > .todo-box')?.checked)
    .map((el) => el.dataset.short || doc.excerpt(el, 44))
    .filter(Boolean);
}

// The explainer shows exactly what the team will read with the next question.
function renderPreview(state) {
  const code = $('#next-context');
  if (!code) return;
  const notes = currentNotes();
  const current = doc.current;
  const where = current ? (doc.typeOf(current) === 'ask' ? asks.get(current.id)?.heading : doc.headingFor(current, { self: true })) || 'About your team' : 'About your team';
  const question = '<your question>';
  let text;
  if (state.phase !== 'active') {
    const prompt = buildPrompt(notes);
    text = `// The first question starts the conversation with this private context\n// (${prompt.length.toLocaleString('en-US')} of ${PROMPT_LIMIT.toLocaleString('en-US')} characters; the notes are the last line):\n\n${prompt}\n\n// …and reads:\n${formatQuestion({ heading: where, text: question })}`;
  } else {
    const seen = notesAtTeam(state.messages);
    const line = notes !== seen ? notes : '';
    text = `// Your next question will read:\n${formatQuestion({ heading: where, text: question, notes: line })}${line ? '' : '\n\n// No notes line: the team already has your latest notes.'}`;
  }
  if (code.textContent === text) return;
  // Comment lines get the explainer's comment color; the rest is plain text.
  code.replaceChildren(...text.split('\n').flatMap((line, i) => {
    const node = line.startsWith('//') ? Object.assign(document.createElement('span'), { className: 'sx-com', textContent: line }) : document.createTextNode(line);
    return i ? [document.createTextNode('\n'), node] : [node];
  }));
}

// The live block's Copy button copies what it shows now, not what it showed at load.
const liveCopy = $('.live-code .sx-copy');
if (liveCopy) {
  const button = liveCopy.cloneNode(true); // A clone leaves the old listener behind.
  liveCopy.replaceWith(button);
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#next-context').textContent);
      button.textContent = 'Copied';
    } catch {
      getSelection().selectAllChildren($('#next-context'));
      button.textContent = 'Selected';
    }
    setTimeout(() => (button.textContent = 'Copy'), 1600);
  });
}

// ---------- Announcements for screen readers ----------

function announce(text) {
  const region = $('#announcer');
  region.textContent = '';
  setTimeout(() => (region.textContent = text), 50);
}

function announceNew(state, result) {
  const replies = state.messages.filter((m) => (m.senderType === 'standin' || m.senderType === 'rep') && ['text', 'link-card', 'standin-idle-prompt'].includes(m.type));
  const cards = state.messages.filter((m) => m.type === 'system-card' && /"(handoff|human-transfer|session-end)"/.test(m.body));
  if (!primed) {
    for (const m of [...replies, ...cards]) announced.add(m.messageId);
    primed = true;
    return;
  }
  for (const m of [...replies, ...cards]) {
    if (announced.has(m.messageId)) continue;
    announced.add(m.messageId);
    const thread = [...result.threads].find(([, items]) => items.some((item) => item.messageId === m.messageId))?.[0];
    const where = asks.get(thread)?.heading;
    if (m.type === 'system-card') {
      announce(/session-end/.test(m.body) ? 'The conversation has ended.' : 'A person from the team joined the conversation.');
    } else {
      const who = m.senderType === 'rep' ? 'The team' : state.host.name || 'The team';
      const text = m.type === 'link-card' ? 'shared a link.' : `answered${where ? ` under ${where}` : ''}: ${replyText(m.body, resolveRef)}`;
      announce(`${who} ${text}`);
      if (thread) pointTo(thread, where);
    }
  }
}

// An answer that lands out of view gets a small pill that takes you there.
const pill = document.createElement('button');
pill.type = 'button';
pill.className = 'kn-pill';
pill.hidden = true;
let pillTimer = 0;
pill.addEventListener('click', () => {
  pill.hidden = true;
  doc.reveal(pill.dataset.go, { light: false });
});

function pointTo(id, heading) {
  const el = document.getElementById(id);
  if (!el) return;
  const box = el.getBoundingClientRect();
  if (box.bottom > 60 && box.top < innerHeight - 60) return; // Already in view.
  pill.innerHTML = `<svg aria-hidden="true"><use href="#${box.top < 0 ? 'ui-up' : 'ui-down'}"/></svg><span></span>`;
  pill.querySelector('span').textContent = heading ? `New answer under “${heading}”` : 'New answer';
  pill.dataset.go = id;
  pill.hidden = false;
  clearTimeout(pillTimer);
  pillTimer = setTimeout(() => (pill.hidden = true), 8000);
}

// ---------- Keyboard: "/" anywhere starts a line where you're reading ----------

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], .pop, .slash, .sx-explainer')) return;
  const body = $('#doc-body').getBoundingClientRect();
  if (body.bottom < innerHeight * 0.3 || body.top > innerHeight * 0.7) return;
  e.preventDefault();
  doc.insertAtReading();
});

// ---------- Phones: a bar above the keyboard with + and Ask ----------

const kbar = document.createElement('div');
kbar.className = 'kbar';
kbar.hidden = true;
kbar.setAttribute('role', 'toolbar');
kbar.setAttribute('aria-label', 'Block tools');
kbar.innerHTML = `
  <button type="button" data-k="plus"><svg aria-hidden="true"><use href="#ui-plus"/></svg>Block</button>
  <button type="button" class="kbar-ask" data-k="ask"><svg aria-hidden="true"><use href="#ui-ask"/></svg>Ask the team</button>
  <span class="kn-grow"></span>
  <button type="button" data-k="done"><svg aria-hidden="true"><use href="#ui-keyboard"/></svg>Done</button>`;
document.body.append(kbar, pill); // The pill follows the bar, so it can sit above it.
kbar.addEventListener('pointerdown', (e) => e.preventDefault()); // Keep the keyboard up.
kbar.addEventListener('click', (e) => {
  const key = e.target.closest('[data-k]')?.dataset.k;
  const blk = doc.current;
  if (!blk) return;
  const empty = doc.typeOf(blk) === 'text' && !doc.textOf(blk)?.textContent;
  const invite = empty && blk.hasAttribute('data-invite');
  if (key === 'plus') doc.openSlashAt(blk);
  else if (key === 'ask') insertAsk({ after: blk, before: invite, replace: empty && !invite });
  else if (key === 'done') document.activeElement?.blur();
});

function placeKbar() {
  const vv = window.visualViewport;
  kbar.style.bottom = vv ? `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px` : '0px';
}
window.visualViewport?.addEventListener('resize', placeKbar);
window.visualViewport?.addEventListener('scroll', placeKbar);
$('#doc-body').addEventListener('focusin', (e) => {
  if (!coarse.matches || !e.target.closest('.blk-text[contenteditable]') || e.target.closest('.ask')) return;
  kbar.hidden = false;
  placeKbar();
});
$('#doc-body').addEventListener('focusout', () => {
  setTimeout(() => {
    if (!document.activeElement?.closest?.('#doc-body .blk-text[contenteditable]')) kbar.hidden = true;
  }, 120);
});

// ---------- Go ----------

function reduced() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

client.subscribe((state) => render(state));
// Discovery, or recovery of a conversation from this tab; the first render follows at once.
// Nothing is created until a question is sent.
client.mount();
if (!prevState) render();
