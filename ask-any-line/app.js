// Tender Docs: questions on any line of a quickstart, answered in place.
//
// stand-visitor.js holds the one Stand conversation. threads.js splits it
// into threads by the prefix on each question. This file puts each thread
// where it belongs (under a line of code, beside a sentence), keeps it there
// when the language changes, and turns [[references]] in answers into chips.

import { getClient } from './stand-visitor.js';
import { loadCatalog, PARTS, REFERENCES } from './catalog.js';
import { deriveThreads, composeMessage, parseMessage, threadKey, partLine, prettyPart, normalize } from './threads.js';
import { buildPrompt, PROMPT_LIMIT } from './prompt.js';
import { plainText } from './richtext.js';
import { CodeLines, flip } from './code-view.js';
import { StepBlocks } from './blocks.js';
import { ThreadCard, Composer, tipCard, badge } from './cards.js';
import { Notes } from './notes.js';
import { Strip } from './strip.js';
import { Explainer } from './explainer.js';
import { startMesh } from './mesh.js';
import { initSearch } from './search.js';
import { copyText, el, poweredBy, reduced } from './dom.js';

const SITE = 'demo'; // Stand Chat's shared demo site. Use your own Site ID from Sites in Stand.
const UI_KEY = 'ask-any-line:v1:ui';
const $ = (selector, root = document) => root.querySelector(selector);

const catalog = loadCatalog();
const client = getClient({ site: SITE });
const saved = loadUi();

// What the page shows. Threads aren't here: they come from the transcript.
const ui = {
  lang: catalog.langs.some((l) => l.key === saved.lang) ? saved.lang : 'node',
  file: 'server', // the file the code panel shows
  sub: null, // the sub-step being read
  compose: null, // the open question box: { anchor, key, reply }
  resolved: saved.resolved && typeof saved.resolved === 'object' ? saved.resolved : {},
  tipHidden: saved.tipHidden === true,
  tipIn: reduced(), // the tip unfolds a beat after load, showing how annotations open
  wide: false, // code in a side panel (else inside the steps)
  margin: false, // notes on sentences beside them (very wide screens)
  pointer: null, // the last line pointed at, for the explainer
};

let state = client.getSnapshot();
let view = deriveThreads(state, catalog);
const cards = new Map(); // thread key → ThreadCard
const drafts = new Map(); // thread key → unsent text, while its box is closed

const allSubs = () => catalog.steps.flatMap((s) => s.subs.map((sub) => ({ ...sub, step: s })));
const subs = allSubs();

// ------------------------------------------------------------ the parts

const panel = {
  root: $('.cp'),
  langs: $('.cp-langs'),
  files: $('.cp-files'),
  body: $('#cp-body'),
  foot: $('.cp-foot'),
};
const article = $('.tn-article');
const live = $('.tn-live');
const panelLinesEl = el('div');
panel.body.append(panelLinesEl);
const panelLines = new CodeLines(panelLinesEl, {
  onAsk: (n) => askLine(ui.file, n),
  describe: (n) => describeLine(ui.file, n),
});

const blocks = new StepBlocks({
  subs,
  focusLines: (sub) => focusLines(sub),
  onAsk: (file, n) => askLine(file, n),
  describe: (file, n) => describeLine(file, n),
  onChange: () => render({ animate: false }),
});

const composer = new Composer({
  onSend: () => void send(),
  onCancel: () => closeComposer({ keepDraft: true }),
  onInput: (text) => {
    if (!ui.compose) return;
    drafts.set(ui.compose.key, text);
    // The client keeps one draft across reloads: this one, with where it goes.
    client.setDraft(text.trim() ? composeMessage(ui.compose.anchor, text, catalog) : '');
  },
});

// An authored tip in the code: shows what an annotation looks like before anyone asks.
const tip = tipCard({
  onAsk: () => askAt({ kind: 'line', file: 'server', part: 'amount', n: lineOf('server', 'amount'), lang: ui.lang }),
  onHide: () => {
    ui.tipHidden = true;
    saveUi();
    render();
  },
});

const notes = new Notes({
  article,
  margin: $('.tn-margin'),
  button: $('.tn-selask'),
  onAsk: (anchor) => askAt(anchor),
});

const strip = new Strip(client);
const explainer = new Explainer();

// ------------------------------------------------------------ the samples

/** Line number of a logical ID in a file, in the current language. */
function lineOf(file, id, lang = ui.lang) {
  return catalog.locate(file, lang, id).line?.n ?? 1;
}

/** Where a code thread sits now: where it was asked, or the same statement in this language. */
function lineFor(anchor) {
  if (anchor.file === 'client' || anchor.lang === ui.lang) return anchor.n;
  const from = catalog.file(anchor.file, anchor.lang)?.lines[anchor.n - 1];
  return lineOf(anchor.file, partLine(anchor.part) ?? from?.id);
}

function fileName(file) {
  return catalog.fileName(file, ui.lang);
}

function describeLine(file, n) {
  const count = [...view.threads.values()].filter((t) => t.anchor.kind === 'line' && t.anchor.file === file && lineFor(t.anchor) === n).length;
  return count ? `${count} ${count === 1 ? 'thread' : 'threads'} here. Press Enter to read or reply.` : '';
}

/** The lines a sub-step is about, in the current language. */
function focusLines(sub, lang = ui.lang) {
  return catalog.file(sub.file, lang).lines.filter((l) => l.ids.some((id) => sub.focus.includes(id))).map((l) => l.n);
}

/** Adds the blank lines inside a run, so a highlighted block reads as one band. */
function withBlanks(numbers, entry) {
  const set = new Set(numbers);
  const sorted = [...set].sort((a, b) => a - b);
  sorted.forEach((n, i) => {
    const next = sorted[i + 1];
    if (!next || next - n > 3) return;
    const between = entry.lines.slice(n, next - 1);
    if (between.every((l) => !l.text.trim())) between.forEach((l) => set.add(l.n));
  });
  return [...set];
}

// ------------------------------------------------------------ asking

function askLine(file, n) {
  const line = catalog.file(file, ui.lang).lines[n - 1];
  if (!line || !line.text.trim()) return;
  askAt({ kind: 'line', file, part: PARTS[line.id] ?? 'code', n, lang: file === 'client' ? null : ui.lang });
}

/** Opens the question box for a place, or the thread already there. */
function askAt(anchor, { text } = {}) {
  hideHint();
  if (anchor.kind === 'line' && ui.wide && anchor.file !== ui.file) showFile(anchor.file);
  const key = threadKey(anchor);
  const thread = view.threads.get(key);
  if (thread) {
    delete ui.resolved[key];
    saveUi();
    ui.compose = { anchor: replyAnchor(thread), key, reply: true };
  } else {
    ui.compose = { anchor, key, reply: false };
  }
  ui.pointer = ui.compose.anchor;
  const draft = text ?? drafts.get(key) ?? '';
  composer.field.value = draft;
  client.setDraft(draft.trim() ? composeMessage(ui.compose.anchor, draft, catalog) : '');
  render();
  requestAnimationFrame(() => {
    composer.field.focus({ preventScroll: true });
    composer.field.setSelectionRange(composer.field.value.length, composer.field.value.length);
    reveal(composer.root);
  });
}

/** A follow-up names the thread's part, on the line it shows on now. */
function replyAnchor(thread) {
  const a = thread.anchor;
  if (a.kind !== 'line') return a;
  return { kind: 'line', file: a.file, part: a.part, n: lineFor(a), lang: a.file === 'client' ? null : ui.lang };
}

function closeComposer({ keepDraft = false } = {}) {
  if (!ui.compose) return;
  const { anchor, key } = ui.compose;
  if (keepDraft && composer.field.value.trim()) drafts.set(key, composer.field.value);
  else drafts.delete(key);
  ui.compose = null;
  client.setDraft('');
  render();
  // Focus goes back where the question started.
  const back = anchor.kind === 'line' ? rowFor(anchor.file, lineFor(anchor)) : cards.get(key)?.root ?? notes.hostFor(anchor)?.querySelector?.('button');
  back?.focus?.({ preventScroll: true });
}

async function send() {
  const text = composer.field.value.trim();
  if (!text || !ui.compose || composer.send.disabled) return;
  const { anchor, key } = ui.compose;
  const body = composeMessage(anchor, text, catalog);
  // The prompt only goes with the first message; later ones carry their place themselves.
  const prompt = buildPrompt({ step: ui.sub?.step.n ?? null, language: catalog.langLabel(ui.lang) });
  drafts.delete(key);
  composer.field.value = '';
  ui.compose = null;
  client.setDraft('');
  render();
  const back = anchor.kind === 'line' ? rowFor(anchor.file, lineFor(anchor)) : cards.get(key)?.root;
  back?.focus?.({ preventScroll: true });
  await client.send(body, { prompt, analyticsId: 'ask-any-line' });
}

/** Text the client hands back (a failed start, a reload, a new conversation) reopens its box. */
function restoreDraft() {
  if (ui.compose || !state.draft) return;
  const parsed = parseMessage(state.draft, catalog);
  if (!parsed) return;
  const anchor = parsed.anchor.kind === 'line' ? { ...parsed.anchor, part: prettyPart(parsed.anchor.part) } : parsed.anchor;
  drafts.set(threadKey(anchor), parsed.question);
  askAt(anchor, { text: parsed.question });
}

function resolve(key) {
  const thread = view.threads.get(key);
  if (!thread) return;
  ui.resolved[key] = thread.lastSeq;
  saveUi();
  if (ui.compose?.key === key) ui.compose = null;
  const where = thread.anchor.kind === 'line' ? rowFor(thread.anchor.file, lineFor(thread.anchor)) : null;
  render();
  where?.focus?.({ preventScroll: true });
}

// Resolving folds a thread away until something new arrives in it.
const isResolved = (thread) => thread.key in ui.resolved && ui.resolved[thread.key] >= thread.lastSeq && !thread.pending;

// ------------------------------------------------------------ references

/** "create payment" → { kind: 'code', file, id }; "Step 4" → { kind: 'step', n, title }. */
function resolveReference(name) {
  const n = normalize(name).replace(/^(server|client)(\s+code)?\s*:\s*/, '');
  const step = n.match(/^step\s*(\d+)\b/);
  if (step) {
    const found = catalog.steps.find((s) => s.n === Number(step[1]));
    return found ? { kind: 'step', n: found.n, title: found.title } : null;
  }
  const byTitle = catalog.steps.find((s) => normalize(s.title) === n);
  if (byTitle) return { kind: 'step', n: byTitle.n, title: byTitle.title };
  const ref = REFERENCES[n];
  return ref ? { kind: 'code', file: ref[0], id: ref[1] } : null;
}

/** A chip for a reference in an answer, or null to leave the name as plain text. */
function chip(name) {
  const target = resolveReference(name);
  if (!target) return null;
  const button = el('button', `ref${target.kind === 'step' ? ' is-step' : ''}`);
  button.type = 'button';
  const label = el('span');
  const at = el('span', 'ref-at');
  if (target.kind === 'step') {
    label.textContent = `Step ${target.n}`;
    at.textContent = target.title;
    button.setAttribute('aria-label', `Go to step ${target.n}, ${target.title}`);
  } else {
    const n = lineOf(target.file, target.id);
    label.textContent = name.replace(/^(server|client)\s*:\s*/i, '');
    at.textContent = `${fileName(target.file)}:${n}`;
    button.setAttribute('aria-label', `Show ${label.textContent}, ${fileName(target.file)} line ${n}`);
  }
  button.append(label, at);
  button.addEventListener('click', () => goTo(target));
  return button;
}

/** Shows a part of the page: switches file, scrolls, and lights it up. Never more. */
function goTo(target) {
  if (target.kind === 'step') {
    const head = catalog.steps.find((s) => s.n === target.n)?.el.querySelector('.tn-step-head');
    head?.scrollIntoView({ block: 'start', behavior: reduced() ? 'instant' : 'smooth' });
    head?.querySelector('h2')?.animate?.([{ color: '#635BFF' }, { color: '' }], { duration: 1600 });
    return;
  }
  const lines = catalog.group(target.file, ui.lang, target.id);
  if (ui.wide) {
    if (ui.file !== target.file) showFile(target.file);
    panelLines.scrollToLine(lines[0], { block: 'center' });
    panelLines.flash(lines);
    return;
  }
  const block = blocks.blockFor(target.file, lines[0], { unfold: true });
  if (!block) return;
  block.lines.rows.get(lines[0])?.scrollIntoView({ block: 'center', behavior: reduced() ? 'instant' : 'smooth' });
  block.lines.flash(lines);
}

// ------------------------------------------------------------ the code panel

const FILE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.3h3.5"/></svg>';
const langbar = { root: $('.tn-langbar'), list: el('div', 'tn-langbar-in') };

function drawLangs() {
  for (const host of [panel.langs, langbar.list]) {
    host.replaceChildren(...catalog.langs.map((lang) => {
      const button = el('button', 'cp-lang', lang.label);
      button.type = 'button';
      button.dataset.lang = lang.key;
      button.setAttribute('aria-pressed', String(lang.key === ui.lang));
      button.addEventListener('click', () => setLang(lang.key));
      return button;
    }));
  }
  langbar.list.prepend(el('span', 'tn-langbar-label', 'Code in'));
  langbar.root.append(langbar.list);
}

function drawFiles() {
  const tabs = ['server', 'client'].map((file) => {
    const tab = el('button', 'cp-file');
    tab.type = 'button';
    tab.id = `cp-tab-${file}`;
    tab.dataset.file = file;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'cp-body');
    tab.innerHTML = `${FILE_ICON}<span class="cp-file-name"></span><span class="cp-file-count" hidden></span>`;
    tab.addEventListener('click', () => showFile(file));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const other = file === 'server' ? 'client' : 'server';
      showFile(other);
      panel.files.querySelector(`[data-file="${other}"]`).focus();
    });
    return tab;
  });
  const hint = el('span', 'cp-hint');
  hint.innerHTML = 'Hover a line, then <b aria-hidden="true">+</b> to ask';
  panel.files.replaceChildren(...tabs, hint);
}

function updateFileTabs() {
  for (const tab of panel.files.querySelectorAll('.cp-file')) {
    const file = tab.dataset.file;
    tab.setAttribute('aria-selected', String(file === ui.file));
    tab.tabIndex = file === ui.file ? 0 : -1;
    tab.querySelector('.cp-file-name').textContent = fileName(file);
    const open = [...view.threads.values()].filter((t) => t.anchor.kind === 'line' && t.anchor.file === file && !isResolved(t)).length;
    const count = tab.querySelector('.cp-file-count');
    count.hidden = !open;
    count.textContent = open;
    count.setAttribute('aria-label', `${open} ${open === 1 ? 'thread' : 'threads'}`);
  }
  panel.body.setAttribute('aria-labelledby', `cp-tab-${ui.file}`);
}

function drawPanelLines() {
  const entry = catalog.file(ui.file, ui.lang);
  const where = ui.file === 'client' ? 'the browser' : catalog.langLabel(ui.lang);
  panelLines.render(entry, { label: `${entry.name}, ${where}. Up and down arrows move between lines; Enter asks about one.` });
}

function showFile(file) {
  if (file === ui.file && panelLines.entry) return;
  ui.file = file;
  hideHint();
  drawPanelLines();
  panel.body.scrollTop = 0;
  render({ animate: false });
  applyFocus({ scroll: true });
}

/** Highlights what the current sub-step is about, when its file is showing. */
function applyFocus({ scroll = false } = {}) {
  if (!ui.wide) return;
  const sub = ui.sub;
  const lines = sub && sub.file === ui.file ? withBlanks(focusLines(sub), catalog.file(ui.file, ui.lang)) : [];
  panelLines.setFocus(lines);
  if (scroll && lines.length && !panelBusy()) panelLines.scrollToLine(Math.min(...lines), { block: 'center' });
}

// Leave the panel alone while someone is using it.
let pointerInPanel = false;
panel.root.addEventListener('pointerenter', () => {
  pointerInPanel = true;
  hideHint();
});
panel.root.addEventListener('pointerleave', () => (pointerInPanel = false));
const panelBusy = () => pointerInPanel || panel.root.contains(document.activeElement);

/** The wow: every annotation slides to the same statement in the new language. */
function setLang(lang) {
  if (lang === ui.lang) return;
  const play = flip(ui.wide ? [...panel.body.querySelectorAll('.an, .cmp, .tip')] : []);
  const scroll = panel.body.scrollTop;
  ui.lang = lang;
  if (ui.compose?.anchor.kind === 'line' && ui.compose.anchor.file === 'server') {
    ui.compose.anchor = { ...ui.compose.anchor, n: lineFor(ui.compose.anchor), lang };
  }
  saveUi();
  for (const host of [panel.langs, langbar.list]) {
    for (const b of host.querySelectorAll('.cp-lang')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  }
  drawCommands();
  if (ui.wide && ui.file === 'server') drawPanelLines();
  render({ animate: false });
  if (!ui.wide) return;
  panel.body.scrollTop = scroll;
  applyFocus();
  play();
  if (ui.file === 'server') {
    // Light up where each thread landed, and fade the new code in.
    const landed = [...view.threads.values()].filter((t) => t.anchor.kind === 'line' && t.anchor.file === 'server' && !isResolved(t)).map((t) => lineFor(t.anchor));
    panelLines.flash(landed);
    if (!reduced()) panelLinesEl.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
  }
}

function rowFor(file, n) {
  if (ui.wide) return file === ui.file ? panelLines.rows.get(n) : null;
  return blocks.rowFor(file, n);
}

/** Scrolls an element into view inside the code panel, or the page. */
function reveal(element) {
  if (!element?.isConnected) return;
  const behavior = reduced() ? 'instant' : 'smooth';
  const box = element.closest('.cp-body');
  const r = element.getBoundingClientRect();
  if (box) {
    const b = box.getBoundingClientRect();
    if (r.bottom > b.bottom - 12) box.scrollBy({ top: r.bottom - b.bottom + 24, behavior });
    else if (r.top < b.top) box.scrollBy({ top: r.top - b.top - 40, behavior });
  } else if (r.top < 60 || r.bottom > innerHeight - 90) {
    element.scrollIntoView({ block: 'center', behavior });
  }
}

// ------------------------------------------------------------ rendering

/** Puts every thread, the tip and the question box where they belong. Runs on every change. */
function render({ animate = true } = {}) {
  view = deriveThreads(state, catalog);
  for (const t of view.threads.values()) {
    if (t.key in ui.resolved && ui.resolved[t.key] < t.lastSeq) delete ui.resolved[t.key]; // new message: open again
  }
  for (const key of cards.keys()) if (!view.threads.has(key)) cards.delete(key);

  const codeItems = []; // { file, n, el, rank }: after line n of a file
  const proseItems = []; // { host, el }: after (or beside) a paragraph
  const tipLine = lineOf('server', 'amount');
  if (!ui.tipHidden && (ui.tipIn || view.threads.size)) codeItems.push({ file: 'server', n: tipLine, el: tip, rank: 0 });
  for (const key of view.order) {
    const thread = view.threads.get(key);
    if (isResolved(thread)) continue;
    const card = cardFor(thread);
    if (thread.anchor.kind === 'line') codeItems.push({ file: thread.anchor.file, n: lineFor(thread.anchor), el: card.root, rank: 1 });
    else proseItems.push({ host: notes.hostFor(thread.anchor), el: card.root });
  }
  placeComposer(codeItems, proseItems);

  const byLine = (items) => {
    const map = new Map();
    for (const item of items.sort((a, b) => a.rank - b.rank)) {
      if (!map.has(item.n)) map.set(item.n, []);
      map.get(item.n).push(item.el);
    }
    return map;
  };
  const marksFor = (file) => {
    const marks = new Map();
    for (const t of view.threads.values()) {
      if (t.anchor.kind !== 'line' || t.anchor.file !== file) continue;
      const n = lineFor(t.anchor);
      marks.set(n, isResolved(t) && marks.get(n) !== 'thread' ? 'resolved' : 'thread');
    }
    if (file === 'server' && ui.tipHidden && !marks.has(tipLine)) marks.set(tipLine, 'tip');
    return marks;
  };
  if (ui.wide) {
    panelLines.place(byLine(codeItems.filter((i) => i.file === ui.file)), { animate });
    for (const item of codeItems) if (item.file !== ui.file) item.el.remove();
    panelLines.setMarks(marksFor(ui.file));
    panelLines.relabel();
    const asking = ui.compose?.anchor.kind === 'line' && !ui.compose.reply && ui.compose.anchor.file === ui.file ? lineFor(ui.compose.anchor) : 0;
    for (const [n, row] of panelLines.rows) row.classList.toggle('is-asking', n === asking);
  } else {
    blocks.draw(codeItems, { catalog, lang: ui.lang });
    for (const block of blocks.list) {
      block.lines.place(byLine(codeItems.filter((i) => i.block === block)), { animate });
      const marks = marksFor(block.sub.file);
      for (const [n, kind] of marks) if (kind !== 'resolved') marks.delete(n); // open threads show themselves
      block.lines.setMarks(marks);
      block.lines.relabel();
    }
  }

  const byHost = new Map();
  for (const item of proseItems) {
    if (!item.host) continue;
    if (!byHost.has(item.host)) byHost.set(item.host, []);
    byHost.get(item.host).push(item.el);
  }
  notes.place(byHost, { margin: ui.margin });
  updateLineRefs();
  notes.highlight([
    ...[...view.threads.values()].filter((t) => t.anchor.kind === 'quote' && !isResolved(t)).map((t) => t.anchor),
    ...(ui.compose?.anchor.kind === 'quote' && !ui.compose.reply ? [ui.compose.anchor] : []),
  ]);

  updateFileTabs();
  strip.update(state, view);
  strip.place({ wide: ui.wide, home: panel.foot, phase: state.phase, followupOffered: state.followupOffered });
  announce();
  updateExplainer();
}

/** The question box goes under its line, beside its sentence, or inside its thread as a reply. */
function placeComposer(codeItems, proseItems) {
  for (const card of cards.values()) {
    if (!(ui.compose?.reply && ui.compose.key === card.key)) card.replyHost.replaceChildren();
  }
  if (!ui.compose) {
    composer.root.remove();
    return;
  }
  const { anchor, reply, key } = ui.compose;
  updateComposer();
  composer.setTheme(anchor.kind === 'line' ? 'dark' : 'light');
  if (reply && cards.has(key)) {
    const host = cards.get(key).replyHost;
    if (composer.root.parentElement !== host) host.replaceChildren(composer.root);
  } else if (anchor.kind === 'line') {
    codeItems.push({ file: anchor.file, n: lineFor(anchor), el: composer.root, rank: 2 });
  } else {
    proseItems.push({ host: notes.hostFor(anchor), el: composer.root });
  }
}

function cardFor(thread) {
  const theme = thread.anchor.kind === 'line' ? 'dark' : 'light';
  let card = cards.get(thread.key);
  if (!card || card.theme !== theme) {
    card = new ThreadCard(thread.key, theme, {
      reply: (key) => {
        const t = view.threads.get(key);
        if (t) askAt(t.anchor.kind === 'line' ? replyAnchor(t) : t.anchor);
      },
      resolve,
      retry: () => void client.send(), // no text: resends the pending message under its original ID
      linkClick: (id, url) => client.trackLinkClick(id, url),
    });
    card.theme = theme;
    cards.set(thread.key, card);
  }
  const a = thread.anchor;
  const who = state.host.name || 'The team';
  const typing = view.typing === thread.key && state.activity
    ? (state.activity.kind === 'thinking' ? `${who} is writing an answer…` : `${who} is typing…`)
    : view.awaiting === thread.key && !thread.pending ? `${who} is writing an answer…` : '';
  card.update(thread, {
    label: `Thread about ${placeLabel(a)}`,
    quote: a.kind === 'quote' ? a.quote : null,
    heading: a.kind === 'step' ? `Step ${a.step} · ${a.title}` : a.kind === 'page' ? 'About this page' : null,
    lang: ui.lang,
    host: state.host,
    phase: state.phase,
    pendingState: thread.pending ? (state.busy ? 'sending' : 'failed') : '',
    canReply: state.phase === 'active' && !(ui.compose?.reply && ui.compose.key === thread.key),
    status: typing ? { typing, preview: state.activity?.preview ?? '' } : null,
    where: (anchor) => (anchor?.kind === 'line' ? `${catalog.fileName(anchor.file, anchor.lang)}:${anchor.n}` : ''),
    reference: chip,
    linkClick: (id, url) => client.trackLinkClick(id, url),
  });
  return card;
}

/** "server.py line 20 (amount)", "Step 4, Handle webhooks", "this page". */
function placeLabel(anchor) {
  if (anchor.kind === 'line') return `${fileName(anchor.file)} line ${lineFor(anchor)} (${prettyPart(anchor.part)})`;
  if (anchor.kind === 'quote') return `a sentence in Step ${anchor.step}`;
  if (anchor.kind === 'step') return `Step ${anchor.step}, ${anchor.title}`;
  return 'this page';
}

function updateComposer() {
  const c = ui.compose;
  const a = c.anchor;
  const head = [];
  let placeholder = 'What would you like to know?';
  let label = 'Your question';
  if (c.reply) {
    head.push(el('span', '', 'Reply'));
    placeholder = 'Ask a follow-up';
    label = `Your follow-up about ${placeLabel(a)}`;
  } else if (a.kind === 'line') {
    const n = lineFor(a);
    head.push(el('span', '', 'Ask about'), el('code', '', `${fileName(a.file)} L${n}`), el('span', '', `· ${prettyPart(a.part)}`));
    placeholder = normalize(a.part) === 'amount' ? 'e.g. Why 2000 and not 20?' : 'What\'s unclear about this line?';
    label = `Your question about line ${n} of ${fileName(a.file)}`;
  } else if (a.kind === 'quote') {
    head.push(el('span', '', `Ask about this, from Step ${a.step}`));
    label = `Your question about the sentence you selected in Step ${a.step}`;
  } else if (a.kind === 'step') {
    head.push(el('span', '', `Ask about Step ${a.step} · ${a.title}`));
    placeholder = 'Where are you stuck?';
    label = `Your question about Step ${a.step}, ${a.title}`;
  } else {
    head.push(el('span', '', 'Ask about this page'));
    placeholder = 'What was missing or unclear?';
    label = 'Your question about this page';
  }

  // Who answers, exactly as Stand names them, and whether that's an AI.
  const who = state.host.name ? ['Answered by ', el('b', '', state.host.name), badge(state.host.kind)].filter(Boolean) : ['Answered by the Tender team'];
  const fine = [el('span', '', 'Real conversation via Stand')];
  const powered = poweredBy(state.poweredByUrl, () => client.trackAttributionClick());
  if (powered) fine.push(el('span', '', '·'), powered);

  const note = composerNote(c);
  composer.show({
    head,
    quote: !c.reply && a.kind === 'quote' ? a.quote : '',
    placeholder,
    label,
    who,
    fine,
    note,
    canSend: !note?.block,
    notice: state.notice,
  });
}

/** What stops a question right now, in the page's voice, with what to do about it. */
function composerNote(c) {
  const s = state;
  const action = (label, run) => ({ label, run });
  if (s.phase === 'loading') return { text: 'Checking who can answer…', block: true };
  if (s.phase === 'unavailable') {
    if (s.error === 'start') return { text: 'Your question didn\'t go through, and nobody can answer right now.', warn: true, block: true, action: action('Check again', () => void client.retry()) };
    if (s.error === 'connect') return { text: 'Couldn\'t reach Stand to see who can answer.', warn: true, block: true, action: action('Try again', () => void client.retry()) };
    return { text: 'Nobody from the Tender team can answer right now.', warn: true, block: true, action: action('Check again', () => void client.retry()) };
  }
  if (s.phase === 'uncertain') return { text: 'Your first question may have started a conversation, but it wasn\'t confirmed. Your text is still here.', warn: true, block: true, action: action('Start a new conversation', () => void client.newChat()) };
  if (s.phase === 'ended') return { text: 'This conversation has ended.', block: true, action: action('Start a new conversation', () => void client.newChat()) };
  if (s.pending && !s.pending.creating && !s.busy) return { text: 'Your last question wasn\'t delivered yet.', warn: true, block: true, action: action('Retry it', () => void client.send()) };
  // One answer at a time, so each lands in the right thread.
  if (view.awaiting && view.awaiting !== c.key) {
    const t = view.threads.get(view.awaiting);
    return { text: `Waiting for the answer on ${t ? placeLabel(t.anchor) : 'your last question'}. You can ask here as soon as it arrives.`, block: true };
  }
  if (s.busy) return { text: 'Sending…', block: true };
  return null;
}

// ------------------------------------------------ which lines a step is about

const lineRefs = new Map(); // sub-step id → { inline, margin } buttons

/** "server.py L20–26": after each sub-step's Server/Browser label, or in the margin. */
function updateLineRefs() {
  for (const sub of subs) {
    let refs = lineRefs.get(sub.id);
    if (!refs) {
      const make = () => {
        const button = el('button', 'tn-lines');
        button.type = 'button';
        button.addEventListener('click', () => showLines(sub));
        return button;
      };
      refs = { inline: make(), margin: make() };
      refs.margin.host = sub.el.querySelector('h3');
      sub.el.querySelector('.tn-side')?.append(refs.inline);
      lineRefs.set(sub.id, refs);
    }
    const lines = focusLines(sub).sort((a, b) => a - b);
    const label = lines.length ? `${fileName(sub.file)} ${rangeLabel(lines)}` : '';
    for (const button of [refs.inline, refs.margin]) {
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute('aria-label', `Show ${label.replace(' L', ', lines ')} in the code panel`);
    }
    refs.inline.hidden = !label || !ui.wide;
    refs.margin.hidden = !label;
    refs.margin.classList.toggle('is-active', ui.sub?.id === sub.id);
  }
  notes.setLabels(ui.margin ? [...lineRefs.values()].map((r) => r.margin).filter((b) => !b.hidden) : []);
}

function rangeLabel(lines) {
  const runs = [];
  for (const n of lines) {
    const run = runs.at(-1);
    if (run && n - run[1] <= 3) run[1] = n;
    else runs.push([n, n]);
  }
  return `L${runs.slice(0, 3).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')}`;
}

function showLines(sub) {
  const lines = focusLines(sub);
  if (!lines.length || !ui.wide) return;
  if (ui.file !== sub.file) showFile(sub.file);
  panelLines.scrollToLine(Math.min(...lines), { block: 'center' });
  panelLines.flash(lines);
}

// ------------------------------------------------------ announcements, toasts

const announced = new Set();
let primed = false;

/** Whole answers go to screen readers as they arrive (never keystrokes). */
function announce() {
  const fresh = [];
  for (const thread of view.threads.values()) {
    for (const item of thread.items) {
      if (announced.has(item.m.messageId)) continue;
      announced.add(item.m.messageId);
      if (primed && item.kind !== 'visitor') fresh.push({ thread, item });
    }
  }
  primed = true; // what was already there on load isn't news
  for (const { thread, item } of fresh) {
    const who = `${item.author.name}${item.author.kind === 'standin' ? ', AI,' : ''}`;
    const text = item.kind === 'link' ? 'shared a link.' : plainText(item.m.body);
    live.append(el('p', '', `${who} answered about ${placeLabel(thread.anchor)}: ${text}`));
    while (live.children.length > 3) live.firstElementChild.remove();
    toastIfHidden(thread);
  }
}

let toast = null;
let toastTimer = 0;

/** An answer that lands out of sight (another file, off screen) says so. */
function toastIfHidden(thread) {
  const card = cards.get(thread.key)?.root;
  if (card?.isConnected && inView(card)) return;
  if (ui.wide && thread.anchor.kind === 'line' && thread.anchor.file !== ui.file) {
    // The other file's tab pulses its thread count.
    const count = panel.files.querySelector(`[data-file="${thread.anchor.file}"] .cp-file-count`);
    count?.classList.remove('is-new');
    void count?.offsetWidth;
    count?.classList.add('is-new');
  }
  toast?.remove();
  clearTimeout(toastTimer);
  toast = el('div', 'cp-toast');
  toast.setAttribute('role', 'status');
  toast.append(el('span', '', `New answer on ${placeLabel(thread.anchor)}`));
  const go = el('button', 'btn', 'Show');
  go.type = 'button';
  go.addEventListener('click', () => {
    toast?.remove();
    showThread(thread.key);
  });
  toast.append(go);
  if (ui.wide && thread.anchor.kind === 'line') panel.root.append(toast);
  else {
    toast.style.position = 'fixed';
    toast.style.bottom = ui.wide ? '20px' : '76px';
    document.body.append(toast);
  }
  toastTimer = setTimeout(() => toast?.remove(), 9000);
}

function inView(element) {
  const r = element.getBoundingClientRect();
  const box = element.closest('.cp-body')?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
  return r.bottom > box.top + 20 && r.top < box.bottom - 20 && r.bottom > 0 && r.top < innerHeight;
}

function showThread(key) {
  const thread = view.threads.get(key);
  if (!thread) return;
  delete ui.resolved[key];
  if (thread.anchor.kind === 'line' && ui.wide && thread.anchor.file !== ui.file) showFile(thread.anchor.file);
  else render();
  const card = cards.get(key)?.root;
  if (!card) return;
  if (card.closest('.cp-body')) panelLines.scrollToLine(lineFor(thread.anchor), { block: 'center' });
  else card.scrollIntoView({ block: 'center', behavior: reduced() ? 'instant' : 'smooth' });
  card.focus({ preventScroll: true });
}

// ------------------------------------------------------------ the hint

let hintTimer = 0;
let hinted = false;

/** Once, on wide screens: ghost text at the end of a line, the way an editor hints. */
function showHint() {
  if (hinted || !ui.wide || ui.file !== 'server' || view.threads.size || ui.compose || matchMedia('(hover: none)').matches) return;
  const row = panelLines.rows.get(lineOf('server', 'read-order'));
  if (!row) return;
  hinted = true;
  row.classList.add('is-hint');
  const ghost = el('span', 'ln-hint');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.innerHTML = '<b>+</b> Ask about any line';
  row.querySelector('.ln-code').append(ghost);
  hintTimer = setTimeout(hideHint, 12000);
}

function hideHint() {
  clearTimeout(hintTimer);
  hinted = true;
  for (const row of panelLinesEl.querySelectorAll('.is-hint')) {
    row.classList.remove('is-hint');
    row.querySelector('.ln-hint')?.remove();
  }
}

// ------------------------------------------------------ reading and layout

function setActiveSub(sub) {
  if ((ui.sub?.id ?? null) === (sub?.id ?? null)) return;
  ui.sub = sub;
  for (const s of subs) s.el.classList.toggle('is-active', s.id === sub?.id);
  for (const step of catalog.steps) step.el.classList.toggle('is-active', step === sub?.step);
  for (const a of document.querySelectorAll('[data-nav-step]')) a.classList.toggle('is-active', Number(a.dataset.navStep) === sub?.step.n);
  for (const [id, refs] of lineRefs) refs.margin.classList.toggle('is-active', id === sub?.id);
  if (sub && ui.wide) {
    // Follow the reading, unless a question is open or awaited in this file.
    const holding = (ui.compose?.anchor.kind === 'line' && ui.compose.anchor.file === ui.file)
      || [...view.threads.values()].some((t) => t.key === view.awaiting && t.anchor.kind === 'line' && t.anchor.file === ui.file);
    if (sub.file !== ui.file && !holding && !panelBusy()) {
      ui.file = sub.file;
      drawPanelLines();
      render({ animate: false });
    }
  }
  applyFocus({ scroll: Boolean(sub) });
  updateExplainer();
}

// The sub-step being read: the last one whose top is above 40% of the screen.
// Above the first step (the title, the intro), none. At the end of the guide,
// the last ones can't scroll that high, so the last one in the upper part leads.
function watchReading() {
  const pick = () => {
    let current = null;
    for (const s of subs) if (s.el.getBoundingClientRect().top <= innerHeight * 0.4) current = s;
    if (subs.at(-1).el.getBoundingClientRect().bottom <= innerHeight * 0.85) {
      for (const s of subs) if (s.el.getBoundingClientRect().top <= innerHeight * 0.6) current = s;
    }
    setActiveSub(current);
  };
  let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      pick();
    });
  }, { passive: true });
  pick();
}

// The panel's bottom stays on screen while the header is still in view.
function fitPanel() {
  if (!ui.wide) return;
  const grid = $('.tn-docs');
  const top = Math.max(16, grid.getBoundingClientRect().top + parseFloat(getComputedStyle(grid).paddingTop));
  panel.root.style.height = `${Math.max(420, innerHeight - top - 16)}px`;
  $('.tn-nav').style.maxHeight = `${innerHeight - top - 16}px`;
}

const wideQuery = matchMedia('(min-width: 1024px)');
const marginQuery = matchMedia('(min-width: 1800px)');
let modeReady = false;

/** Side panel (wide screens) or code inside the steps (phones, tablets). */
function setMode() {
  const wide = wideQuery.matches;
  ui.margin = marginQuery.matches;
  if (!modeReady || wide !== ui.wide) {
    modeReady = true;
    ui.wide = wide;
    if (wide) {
      blocks.drop();
      drawPanelLines();
    } else {
      panelLinesEl.replaceChildren();
      panelLines.entry = null;
      blocks.build();
    }
  }
  render({ animate: false });
  applyFocus();
  fitPanel();
}

// ------------------------------------------------------------ prose commands

const COMMANDS = {
  install: { node: 'npm install @tender/node express', python: 'pip install tender-payments flask', ruby: 'gem install tender-payments sinatra', go: 'go get tender.dev/go/tender', curl: 'brew install tender-cli' },
  run: { node: 'node server.js', python: 'python server.py', ruby: 'ruby server.rb', go: 'go run server.go', curl: 'sh requests.sh' },
};

function drawCommands() {
  for (const box of document.querySelectorAll('[data-cmd]')) box.querySelector('code').textContent = COMMANDS[box.dataset.cmd][ui.lang];
  // Sentences that only make sense for one language (curl has no server library).
  for (const node of document.querySelectorAll('[data-only-lang]')) node.hidden = node.dataset.onlyLang !== ui.lang;
  for (const node of document.querySelectorAll('[data-hide-lang]')) node.hidden = node.dataset.hideLang === ui.lang;
}

// ------------------------------------------------------------ the explainer

function updateExplainer() {
  const pointer = ui.pointer ?? { kind: 'line', file: 'server', part: 'amount', n: lineOf('server', 'amount'), lang: ui.lang };
  const next = pointer.kind === 'line' ? { ...pointer, n: lineFor(pointer), lang: pointer.file === 'client' ? null : ui.lang } : pointer;
  // Once the conversation has started, Stand echoes the prompt back: show what was really sent.
  const sent = state.messages.find((m) => m.senderType === 'system-prompt' || m.type === 'system-prompt')?.body;
  explainer.update({
    prompt: sent ?? buildPrompt({ step: ui.sub?.step.n ?? null, language: catalog.langLabel(ui.lang) }),
    sent: Boolean(sent),
    limit: PROMPT_LIMIT,
    message: composeMessage(next, '…', catalog).replace(/…$/, ''),
    first: !state.messages.length,
    asked: [...view.threads.values()].flatMap((t) => t.items.filter((i) => i.kind === 'visitor').map((i) => ({ where: whereLabel(i.anchor), question: i.question }))),
  });
}

/** As the team reads it in Stand: "server.py L20 (Python)", "Step 4", "Whole page". */
function whereLabel(anchor) {
  if (anchor.kind === 'line') return `${catalog.fileName(anchor.file, anchor.lang)} L${anchor.n} (${anchor.file === 'client' ? 'browser' : catalog.langLabel(anchor.lang)})`;
  if (anchor.kind === 'quote' || anchor.kind === 'step') return `Step ${anchor.step}`;
  return 'Whole page';
}

// Pointing at a line updates "the next question" in the explainer.
let pointerTimer = 0;
panel.body.addEventListener('pointerover', (e) => {
  const row = e.target.closest?.('.ln');
  if (!row || row.classList.contains('is-blank')) return;
  const n = Number(row.dataset.n);
  const line = catalog.file(ui.file, ui.lang).lines[n - 1];
  ui.pointer = { kind: 'line', file: ui.file, part: PARTS[line.id] ?? 'code', n, lang: ui.file === 'client' ? null : ui.lang };
  clearTimeout(pointerTimer);
  pointerTimer = setTimeout(updateExplainer, 150);
});

// ------------------------------------------------------------ storage

// The language, resolved threads and the hidden tip: all the page keeps itself.
function loadUi() {
  try {
    const value = JSON.parse(sessionStorage.getItem(UI_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function saveUi() {
  try {
    sessionStorage.setItem(UI_KEY, JSON.stringify({ lang: ui.lang, resolved: ui.resolved, tipHidden: ui.tipHidden }));
  } catch {
    // Storage can be denied. Everything still works until the tab closes.
  }
}

// ------------------------------------------------------------ start

function start() {
  drawLangs();
  drawFiles();
  drawCommands();
  startMesh($('.tn-mesh'));

  initSearch({
    box: $('.tn-search'),
    input: $('#tn-q'),
    list: $('#tn-results'),
    article,
    onAsk: (query) => askAt({ kind: 'page' }, { text: query }),
    onGo: (id) => {
      const target = document.getElementById(id);
      target?.scrollIntoView({ block: 'start', behavior: reduced() ? 'instant' : 'smooth' });
      target?.animate?.([{ backgroundColor: 'rgba(99, 91, 255, .12)' }, { backgroundColor: 'transparent' }], { duration: 1800 });
    },
  });

  // Keyboard users jump from the top straight to the current line of code.
  $('.tn-skip').addEventListener('click', (e) => {
    e.preventDefault();
    if (ui.wide) panelLines.focusLine(panelLines.current);
    else {
      const first = blocks.list.find((b) => !b.root.hidden);
      first?.lines.focusLine(first.lines.current);
    }
  });
  panel.root.querySelector('.cp-copy').addEventListener('click', (e) => {
    copyText(catalog.file(ui.file, ui.lang).lines.map((l) => l.text).join('\n'), e.currentTarget);
  });
  for (const button of document.querySelectorAll('.tn-copy')) {
    button.addEventListener('click', () => copyText(button.parentElement.querySelector('code').textContent, button));
  }
  for (const button of document.querySelectorAll('[data-ask-step]')) {
    const step = catalog.steps.find((s) => s.n === Number(button.dataset.askStep));
    button.addEventListener('click', () => askAt({ kind: 'step', step: step.n, title: step.title }));
  }
  const thanks = $('.tn-feedback-thanks');
  $('[data-feedback="yes"]').addEventListener('click', () => (thanks.textContent = 'Thanks for telling us.'));
  $('[data-feedback="no"]').addEventListener('click', () => {
    thanks.textContent = '';
    askAt({ kind: 'page' });
  });
  menu();

  wideQuery.addEventListener('change', setMode);
  marginQuery.addEventListener('change', setMode);
  addEventListener('resize', () => requestAnimationFrame(() => {
    fitPanel();
    notes.layoutMargin();
  }));
  addEventListener('scroll', () => requestAnimationFrame(fitPanel), { passive: true });

  setMode();
  watchReading();
  // On short screens, bring the tip into view: the first screen shows an annotation.
  const revealTip = () => {
    if (!ui.wide || view.threads.size || ui.tipHidden || ui.file !== 'server' || panel.body.scrollTop > 40) return;
    const box = panel.body.getBoundingClientRect();
    const bottom = tip.getBoundingClientRect().bottom;
    if (bottom <= box.bottom - 16) return;
    const line = panelLines.rows.get(1)?.offsetHeight || 21; // whole lines: none cut in half at the top
    const top = Math.ceil((panel.body.scrollTop + bottom - box.bottom + 20) / line) * line + 6;
    panel.body.scrollTo({ top, behavior: reduced() ? 'instant' : 'smooth' });
  };
  const tipIn = () => {
    if (ui.tipIn) return revealTip();
    ui.tipIn = true;
    render();
    setTimeout(revealTip, 380); // once it has pushed the code down
  };
  setTimeout(tipIn, 650);
  document.fonts?.ready.then(() => {
    notes.layoutMargin();
    if (ui.tipIn) revealTip();
  });

  let previous = state;
  client.subscribe((next) => {
    state = next;
    // The client hands text back after a start that failed, and on "Start a new
    // conversation". Our own box only sets the draft while it's open.
    const handedBack = next.draft && next.draft !== previous.draft && !ui.compose;
    previous = next;
    render();
    if (handedBack) restoreDraft();
  });
  client.mount();
  render();
  if (state.draft) restoreDraft(); // an unsent question survives a reload
  setTimeout(showHint, 1200);
}

/** The docs menu, on screens without the side navigation. */
function menu() {
  const button = $('.tn-menu');
  const nav = $('.tn-nav');
  let scrim = null;
  const close = () => {
    nav.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    scrim?.remove();
    scrim = null;
  };
  button.addEventListener('click', () => {
    if (nav.classList.contains('is-open')) return close();
    nav.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    scrim = el('div', 'tn-scrim');
    scrim.addEventListener('click', close);
    document.body.append(scrim);
    nav.querySelector('a')?.focus();
  });
  nav.addEventListener('click', (e) => e.target.closest('a') && close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      close();
      button.focus();
    }
  });
}

start();
