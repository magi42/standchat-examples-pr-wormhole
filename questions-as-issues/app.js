// Questions become issues: the page's controller. It connects the Stand
// visitor client (stand-visitor.js) to the issue model (model.js), the
// tracker and its overlays, and the page around them. It keeps what the
// transcript can't know in sessionStorage, turns what the visitor does into
// client calls, and owns the keyboard shortcuts.

import { getClient } from './stand-visitor.js';
import { CLOSED, LABELS, archiveOf, buildModel, commentMessage, labelName, newIssueMessage, parseVisitorText } from './model.js';
import { buildPrompt } from './prompt.js';
import { Tracker } from './tracker.js';
import { CommandMenu, Composer, Confirm, Menu, Preview, Shortcuts, Toasts, labelItems, priorityItems, statusItems } from './overlays.js';
import { ICONS, priorityIcon, statusIcon } from './icons.js';
import * as page from './page.js';

// Stand Chat's shared demo site: its demo Stand-in answers on any domain.
// Your own site uses its Site ID from Sites in Stand, and your team answers.
const SITE = 'demo';
const KEY = 'questions-as-issues:v1:ui';
const VIEWS = { issues: 'Issues', triage: 'Triage', mine: 'My issues', inbox: 'Inbox' };
const VIEW_ICONS = { issues: ICONS.issues, triage: ICONS.triage, mine: ICONS.mine, inbox: ICONS.inbox };

const client = getClient({ site: SITE });
const store = loadStore();
let state = client.getSnapshot();
let model = buildModel(state, store);

const WIDE = matchMedia('(min-width: 1100px)');
const MEDIUM = matchMedia('(min-width: 900px)');
const layout = () => (WIDE.matches ? 'wide' : MEDIUM.matches ? 'medium' : 'compact');

// Local state ------------------------------------------------------------------

// Only what the transcript can't tell: issues you marked Done, what you've
// read, drafts, the open issue, and the issues of a conversation that ended.
function loadStore() {
  const defaults = { meta: {}, archive: [], view: 'issues', label: null, open: 'SW-1', back: null, sheet: false, draft: null, comments: {} };
  try {
    if (window.top !== window.self) return defaults;
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    return {
      meta: object(saved.meta),
      archive: Array.isArray(saved.archive) ? saved.archive.filter((issue) => issue && /^SW-\d+$/.test(issue.id) && Array.isArray(issue.feed)) : [],
      view: VIEWS[saved.view] ? saved.view : 'issues',
      label: LABELS.some((l) => l.id === saved.label) ? saved.label : null,
      open: typeof saved.open === 'string' && /^SW-\d+$/.test(saved.open) ? saved.open : saved.open === null ? null : 'SW-1',
      back: typeof saved.back === 'string' ? saved.back : null,
      sheet: saved.sheet === true,
      draft: saved.draft && typeof saved.draft === 'object' ? saved.draft : null,
      comments: object(saved.comments),
    };
  } catch {
    return defaults;
  }
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  try {
    if (window.top === window.self) sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage can be denied or full. Everything still works until a reload.
  }
}
const saveSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
};

function setMeta(id, patch) {
  store.meta[id] = { ...store.meta[id], ...patch };
  for (const [key, value] of Object.entries(store.meta[id])) if (value == null) delete store.meta[id][key];
  save();
  schedule();
}

// Rendering ----------------------------------------------------------------------

const trackerEl = document.getElementById('tracker');
const announcer = document.getElementById('tk-announce');
const toasts = new Toasts();
const preview = new Preview();
const command = new CommandMenu();
const shortcuts = new Shortcuts();
const confirmDialog = new Confirm();
const composer = new Composer({
  submit: (fields) => fileIssue(fields),
  change: (fields) => {
    store.draft = fields.title.trim() || fields.description.trim() || fields.priority !== 'none' || fields.labels.length ? fields : null;
    saveSoon();
  },
  retry: () => client.retry(),
  newChat: () => startNewConversation(),
  menu: (kind, anchor, fields, set) => {
    if (kind === 'priority') Menu.open({ anchor, title: 'How much does this block your switch?', items: priorityItems(fields.priority), onSelect: (item) => set(item.id) });
    else Menu.open({ anchor, title: 'Labels', items: labelItems(fields.labels), multi: true, onSelect: (_, ids) => set(ids) });
  },
  attribution: () => client.trackAttributionClick(),
});

const tracker = new Tracker(trackerEl, {
  open: (id, options) => openIssue(id, options),
  close: (options) => closeIssue(options),
  view: (view) => goView(view),
  label: (id) => setLabel(id),
  viewMenu: (anchor) => viewMenu(anchor),
  command: () => openCommand(),
  newIssue: (from) => openComposer({ from }),
  menu: (kind, id, anchor) => issueMenu(kind, id, anchor),
  issueMenu: (id, anchor) => actionsMenu(id, anchor),
  comment: (id, text) => client.send(commentMessage(id, text)),
  retry: () => client.send(),
  retryConnection: () => client.retry(),
  newChat: () => startNewConversation(),
  email: (email) => client.submitEmail(email),
  link: (messageId, url) => client.trackLinkClick(messageId, url),
  attribution: () => client.trackAttributionClick(),
  followUp: (id) => openComposer({ from: `the follow-up button on ${id}`, title: `Re ${id}: `, labels: model.byId.get(id)?.labels ?? [] }),
  plan: (id) => page.showPlan(id),
  markDone: (id) => {
    const issue = model.byId.get(id);
    if (issue) markDone(issue);
  },
  preview: (anchor, id, type) => showPreview(anchor, id, type),
  getDraft: (id) => store.comments[id] ?? '',
  setDraft: (id, text) => {
    if (text) store.comments[id] = text;
    else delete store.comments[id];
    saveSoon();
  },
  typing: () => client.typing(true),
  announce: (issue, item) => announce(issue, item),
});

let queued = false;
const after = [];
function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(render);
}
function afterRender(fn) {
  after.push(fn);
  schedule();
}

// Errors that need words of their own. Discovery, sends and reconnects show
// theirs in place: in the presence line, the dialog, or on the comment.
const ERRORS = {
  end: { title: 'The conversation didn’t end', text: 'Check your connection and try again.', action: { label: 'Try again', run: () => client.end() } },
  email: { title: 'Your email didn’t go through', text: 'Check the address and send it again.' },
  offer: { title: 'That offer has expired', text: 'The conversation moved on. You can keep commenting.' },
  gone: { title: 'This conversation is no longer available', text: 'Your issues stay here. Start a new conversation to keep asking.', action: { label: 'Start new', run: () => startNewConversation() } },
};
let lastError = '';

function render() {
  queued = false;
  if (state.error !== lastError) {
    lastError = state.error;
    const error = ERRORS[state.error];
    if (error) {
      toasts.show({ icon: ICONS.power, ...error, timeout: 9000 });
      announcer.textContent = `${error.title}. ${error.text}`;
    }
  }
  adoptClientDraft();
  model = buildModel(state, store);
  if (state.phase === 'ended') archiveLive();
  if (markRead()) model = buildModel(state, store);
  const env = environment();
  tracker.render(model, ui(), env);
  composer.render(env);
  page.renderWire(state);
  document.documentElement.classList.toggle('tk-sheet-open', Boolean(ui().open) && layout() === 'compact');
  for (const fn of after.splice(0)) fn();
}

function ui() {
  const open = store.open && model.byId.has(store.open) ? store.open : null;
  return { view: store.view, label: store.label, back: store.back, open: layout() === 'compact' ? (store.sheet ? open : null) : open };
}

function environment() {
  return {
    phase: state.phase, connection: state.connection, busy: state.busy, error: state.error,
    host: model.host, notice: state.notice, poweredByUrl: state.poweredByUrl,
    waitingOn: model.waitingOn, activity: state.activity, layout: layout(),
    restoring: state.phase === 'loading' && state.messages.length > 0,
  };
}

// An open issue that's actually on screen has been read.
function markRead() {
  const id = ui().open;
  const issue = id && model.byId.get(id);
  if (!issue || issue.source !== 'live' || !issue.unread || !issueVisible(id)) return false;
  store.meta[id] = { ...store.meta[id], read: issue.lastReplySeq };
  save();
  return true;
}

function issueVisible(id) {
  return ui().open === id && document.visibilityState === 'visible' && (layout() === 'compact' || page.appVisible());
}

// When a conversation ends, its issues are kept, so they survive a reload.
function archiveLive() {
  const live = model.issues.filter((issue) => issue.source === 'live');
  if (!live.length) return;
  const byId = new Map(store.archive.map((issue) => [issue.id, issue]));
  const sig = (issue) => issue && JSON.stringify([issue.status, issue.priority, issue.labels, issue.feed.map((item) => [item.key, item.state])]);
  let changed = false;
  for (const issue of live) {
    const snapshot = archiveOf(issue);
    if (sig(byId.get(issue.id)) !== sig(snapshot)) {
      byId.set(issue.id, snapshot);
      changed = true;
    }
  }
  if (changed) {
    store.archive = [...byId.values()].slice(-50);
    save();
  }
}

// After a failed or uncertain start, the client hands the unsent text back as
// its draft. Here it goes back into the New issue dialog, fields and all.
function adoptClientDraft() {
  const text = state.draft?.trim();
  if (!text) return;
  const parsed = parseVisitorText(text);
  const draft = store.draft ?? {};
  store.draft = parsed?.kind === 'issue'
    ? { ...draft, title: parsed.title, description: parsed.description, priority: parsed.priority, labels: parsed.labels }
    : { title: draft.title ?? '', priority: 'none', labels: [], ...draft, description: [draft.description, parsed?.text ?? text].filter(Boolean).join('\n\n') };
  save();
  client.setDraft('');
}

// Filing issues and comments ---------------------------------------------------------

function openComposer(fields = {}) {
  Menu.current?.close({ restore: false });
  const draft = store.draft;
  const hasDraft = Boolean(draft?.title?.trim() || draft?.description?.trim());
  // Unsent words always win; a button's context only fills an empty dialog.
  const merged = hasDraft
    ? { ...draft, labels: [...new Set([...(draft.labels ?? []), ...(fields.labels ?? [])])], from: draft.from || fields.from }
    : { title: fields.title ?? '', description: '', priority: draft?.priority ?? 'none', labels: fields.labels ?? draft?.labels ?? [], from: fields.from || page.sectionInView() };
  composer.open(merged);
  composer.render(environment());
}

async function fileIssue(fields) {
  if (state.busy || model.waitingOn || !['available', 'active'].includes(state.phase)) return;
  const id = model.nextId;
  const first = state.phase === 'available'; // The first message creates the conversation.
  const body = newIssueMessage({ id, ...fields });
  const context = first
    ? { prompt: buildPrompt({ id, priority: fields.priority, labels: fields.labels, from: fields.from }), analyticsId: 'questions-as-issues' }
    : {};
  const previous = { open: store.open, sheet: store.sheet, view: store.view, label: store.label };
  store.draft = null;
  store.open = id;
  store.back = null;
  showSheet();
  if (store.view !== 'mine') store.view = 'issues';
  store.label = null;
  save();
  composer.close({ restore: false });
  page.settle();
  page.revealApp();
  const sent = client.send(body, context);
  afterRender(() => tracker.focusIssue());
  if (await sent) return;
  // Nothing was filed: put the words back where they came from.
  if (!previous.sheet && store.sheet && history.state?.qiSheet) history.back();
  Object.assign(store, previous);
  store.draft = { ...fields };
  save();
  client.setDraft('');
  schedule();
  afterRender(() => openComposer());
}

async function startNewConversation() {
  archiveLive();
  await client.newChat();
  adoptClientDraft();
  if (store.draft && !composer.isOpen) openComposer();
}

async function endConversation() {
  if (state.phase !== 'active') return;
  const yes = await confirmDialog.open({
    title: 'End the conversation?',
    text: 'Axial’s team won’t get new comments on your issues. The issues stay in your list, closed.',
    confirm: 'End conversation',
  });
  if (yes) await client.end();
}

// Navigation -------------------------------------------------------------------------

// On phones an open issue is a sheet, and the back gesture closes it.
function showSheet() {
  if (layout() !== 'compact') return;
  if (!store.sheet && !history.state?.qiSheet) history.pushState({ ...history.state, qiSheet: true }, '');
  store.sheet = true;
}

function openIssue(id, { focus = false, from = null, reveal = false } = {}) {
  if (!model.byId.has(id)) return;
  preview.hide();
  store.back = from && from !== id ? from : null;
  store.open = id;
  showSheet();
  const issue = model.byId.get(id);
  if (store.label && !issue.labels.includes(store.label)) store.label = null;
  if ((store.view === 'mine' || store.view === 'inbox') && issue.source === 'seed') store.view = 'issues';
  if (store.view === 'triage' && issue.status !== 'triage') store.view = 'issues';
  save();
  if (reveal) page.revealApp();
  if (focus) afterRender(() => tracker.focusIssue());
  else schedule();
}

function closeIssue({ focusList = false } = {}) {
  preview.hide();
  if (layout() === 'compact') {
    store.sheet = false;
    if (history.state?.qiSheet) history.back();
  } else {
    store.open = null;
  }
  store.back = null;
  save();
  if (focusList) afterRender(() => tracker.focusList());
  else schedule();
}

addEventListener('popstate', () => {
  if (store.sheet && layout() === 'compact') {
    store.sheet = false;
    save();
    afterRender(() => tracker.focusList());
  }
});

function goView(view) {
  store.view = view;
  store.label = null;
  save();
  schedule();
}

function setLabel(id) {
  store.label = id;
  if (id) store.view = 'issues';
  save();
  schedule();
}

// Menus ------------------------------------------------------------------------------

function issueMenu(kind, id, anchor) {
  const issue = model.byId.get(id);
  if (!issue) return;
  page.settle();
  const after = Number.isFinite(issue.lastVisitorSeq) ? issue.lastVisitorSeq : -1;
  if (kind === 'status') {
    Menu.open({ anchor, title: 'Change status', items: statusItems(issue.status), onSelect: (item) => setMeta(id, { status: item.id, after, at: Date.now() }) });
  } else if (kind === 'priority') {
    Menu.open({ anchor, title: 'How much does this block your switch?', items: priorityItems(issue.priority), onSelect: (item) => setMeta(id, { priority: item.id }) });
  } else {
    Menu.open({ anchor, title: 'Labels', items: labelItems(issue.labels), multi: true, onSelect: (_, ids) => setMeta(id, { labels: ids }) });
  }
}

function markDone(issue) {
  setMeta(issue.id, { status: 'done', after: Number.isFinite(issue.lastVisitorSeq) ? issue.lastVisitorSeq : -1, at: Date.now() });
}

function reopen(issue) {
  if (issue.source === 'seed' && !store.meta[issue.id]?.status) setMeta(issue.id, { status: 'todo', at: Date.now() });
  else setMeta(issue.id, { status: issue.source === 'seed' ? 'todo' : null, after: null, at: null });
}

function actionsMenu(id, anchor) {
  const issue = model.byId.get(id);
  if (!issue) return;
  const items = [
    { id: 'status', label: 'Change status…', icon: statusIcon(issue.status), kbd: 'S', keepFocus: true },
    { id: 'priority', label: 'Change priority…', icon: `<span class="tk-prop-pr">${priorityIcon(issue.priority)}</span>`, kbd: 'P', keepFocus: true },
    { id: 'labels', label: 'Change labels…', icon: ICONS.tag, kbd: 'L', keepFocus: true },
    { separator: true },
    CLOSED.has(issue.status) ? { id: 'reopen', label: 'Reopen', icon: statusIcon('todo') } : { id: 'done', label: 'Mark as done', icon: statusIcon('done') },
  ];
  if (issue.source === 'seed') items.push({ id: 'follow', label: 'Ask a follow-up', icon: ICONS.plus });
  if (issue.source !== 'seed' && state.phase === 'active') items.push({ separator: true }, { id: 'end', label: 'End conversation…', icon: ICONS.power, danger: true });
  if (['ended', 'uncertain'].includes(state.phase)) items.push({ separator: true }, { id: 'new', label: 'Start a new conversation', icon: ICONS.refresh });
  Menu.open({
    anchor, items, label: `Actions for ${id}`,
    onSelect: (item) => {
      if (['status', 'priority', 'labels'].includes(item.id)) issueMenu(item.id, id, anchor);
      else if (item.id === 'done') markDone(issue);
      else if (item.id === 'reopen') reopen(issue);
      else if (item.id === 'follow') openComposer({ from: `the follow-up button on ${id}`, title: `Re ${id}: `, labels: issue.labels });
      else if (item.id === 'end') endConversation();
      else if (item.id === 'new') startNewConversation();
    },
  });
}

function viewMenu(anchor) {
  const items = [
    ...Object.entries(VIEWS).map(([id, label]) => ({ id, label, icon: VIEW_ICONS[id], checked: store.view === id && !store.label })),
    { separator: true },
    ...LABELS.map((l) => ({ id: `label:${l.id}`, label: l.name, color: l.color, checked: store.label === l.id })),
  ];
  Menu.open({ anchor, items, title: 'Views and labels', onSelect: (item) => (item.id.startsWith('label:') ? setLabel(item.id.slice(6)) : goView(item.id)) });
}

function openCommand() {
  Menu.current?.close({ restore: false });
  const target = model.byId.get(tracker.focused ?? '') ?? null;
  const anchor = (kind) => (target ? tracker.anchorFor(target.id, kind) : null);
  const items = [];
  if (target) {
    items.push(
      { group: 'Issue', label: 'Change status…', icon: statusIcon(target.status), kbd: 'S', keepFocus: true, run: () => issueMenu('status', target.id, anchor('status')) },
      { group: 'Issue', label: 'Change priority…', icon: `<span class="tk-prop-pr">${priorityIcon(target.priority)}</span>`, kbd: 'P', keepFocus: true, run: () => issueMenu('priority', target.id, anchor('priority')) },
      { group: 'Issue', label: 'Change labels…', icon: ICONS.tag, kbd: 'L', keepFocus: true, run: () => issueMenu('labels', target.id, anchor('labels')) },
      CLOSED.has(target.status)
        ? { group: 'Issue', label: 'Reopen', icon: statusIcon('todo'), run: () => reopen(target) }
        : { group: 'Issue', label: 'Mark as done', icon: statusIcon('done'), run: () => markDone(target) },
    );
    if (target.source === 'seed') items.push({ group: 'Issue', label: `Ask a follow-up on ${target.id}`, icon: ICONS.plus, run: () => openComposer({ from: `the follow-up button on ${target.id}`, title: `Re ${target.id}: `, labels: target.labels }) });
  }
  items.push({ group: 'Create', label: 'Create new issue', icon: ICONS.compose, kbd: 'C', run: () => openComposer({ from: 'the command menu' }) });
  for (const [view, name] of Object.entries(VIEWS)) {
    items.push({ group: 'Navigate', label: `Go to ${name}`, icon: VIEW_ICONS[view], run: () => {
      goView(view);
      page.revealApp();
    } });
  }
  items.push({ group: 'Navigate', label: 'Filter by label…', icon: ICONS.tag, keywords: LABELS.map((l) => l.name).join(' '), keepFocus: true, run: () => {
    page.revealApp();
    viewMenu(trackerEl.querySelector('.tk-crumb'));
  } });
  if (store.label) items.push({ group: 'Navigate', label: `Clear the ${labelName(store.label)} filter`, icon: ICONS.close, run: () => setLabel(null) });
  items.push({ group: 'Navigate', label: 'Open pricing', icon: ICONS.pricing, run: () => page.showPlan(null) });
  if (state.phase === 'active') items.push({ group: 'Conversation', label: 'End conversation…', icon: ICONS.power, run: () => endConversation() });
  if (['ended', 'uncertain'].includes(state.phase)) items.push({ group: 'Conversation', label: 'Start a new conversation', icon: ICONS.refresh, run: () => startNewConversation() });
  if (state.phase === 'unavailable') items.push({ group: 'Conversation', label: 'Check again for someone to answer', icon: ICONS.refresh, run: () => client.retry() });
  items.push({ group: 'Help', label: 'Keyboard shortcuts', icon: ICONS.keyboard, kbd: '?', run: () => shortcuts.open() });
  for (const issue of model.issues) {
    items.push({ group: 'Issues', label: issue.title, meta: issue.id, keywords: `${issue.id} ${issue.labels.map(labelName).join(' ')}`, icon: statusIcon(issue.status), run: () => openIssue(issue.id, { focus: true, reveal: true }) });
  }
  command.open(items, target ? { id: target.id, title: target.title, status: target.status } : null);
}

// Mentions: a preview card on hover or focus.
let previewTimer;
function showPreview(anchor, id, type) {
  clearTimeout(previewTimer);
  if (!anchor || matchMedia('(hover: none)').matches) return preview.show(null);
  const issue = model.byId.get(id);
  if (type === 'focusin') preview.show(anchor, issue);
  else previewTimer = setTimeout(() => preview.show(anchor, issue), 300);
}

// Replies ------------------------------------------------------------------------------------

// Whole replies for screen readers, and a toast when the issue isn't on screen.
function announce(issue, item) {
  const name = item.who?.name || 'Someone';
  const plain = (text) => String(text).replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*|`/g, '');
  let title = `${name} replied on ${issue.id}`;
  let text = '';
  if (item.kind === 'joined') {
    title = `${name} joined the conversation`;
    text = `Now assigned to ${issue.id} and your other open issues.`;
  } else if (item.kind === 'offer') {
    title = `${name} can follow up by email`;
    text = `Leave your email on ${issue.id}.`;
  } else if (item.kind === 'link') {
    text = item.title || item.url;
  } else {
    text = plain(item.text);
  }
  announcer.textContent = '';
  requestAnimationFrame(() => (announcer.textContent = `${title}${item.who?.kind === 'standin' ? ' (AI)' : ''}: ${text}`));
  if (!issueVisible(issue.id)) {
    toasts.show({ icon: statusIcon(issue.status), title, text, action: { label: 'Open', run: () => openIssue(issue.id, { focus: true, reveal: true }) } });
  }
}

// Keyboard ---------------------------------------------------------------------------------

const editable = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
const inApp = (event) => trackerEl.contains(event.target) || page.appVisible();

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key;
  if (mod && !event.altKey && !event.shiftKey && key.toLowerCase() === 'k') {
    event.preventDefault();
    page.press('⌘k');
    if (!command.isOpen) openCommand();
    return;
  }
  if (document.querySelector('.tk-backdrop:not([hidden])') || Menu.current) return;
  if (mod || event.altKey || editable(event.target)) return;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (lower === 'c' && !event.shiftKey) {
    event.preventDefault();
    page.press('c');
    openComposer({ from: trackerEl.contains(event.target) ? 'the tracker at the top' : page.sectionInView() });
  } else if (key === '?') {
    event.preventDefault();
    page.press('?');
    shortcuts.open();
  } else if ((lower === 'j' || lower === 'k') && !event.shiftKey && inApp(event)) {
    event.preventDefault();
    page.press(lower);
    page.settle();
    tracker.move(lower === 'j' ? 1 : -1);
  } else if (['s', 'p', 'l'].includes(lower) && !event.shiftKey && inApp(event) && tracker.focused) {
    event.preventDefault();
    page.press(lower);
    const kind = { s: 'status', p: 'priority', l: 'labels' }[lower];
    issueMenu(kind, tracker.focused, tracker.anchorFor(tracker.focused, kind));
  } else if (key === 'Escape' && layout() === 'compact' && store.sheet) {
    event.preventDefault();
    closeIssue({ focusList: true });
  }
});

// The page ---------------------------------------------------------------------------------

page.init({
  newIssue: (fields) => openComposer(fields),
  open: (id) => openIssue(id, { focus: true, reveal: true }),
  key: (action, cap) => {
    if (action === 'new') openComposer({ from: 'the keyboard section' });
    else if (action === 'next' || action === 'previous') {
      page.revealApp();
      page.settle();
      tracker.move(action === 'next' ? 1 : -1);
    } else if (action === 'command') openCommand();
    else if (action === 'shortcuts') shortcuts.open();
    else issueMenu(action, tracker.focused ?? store.open ?? 'SW-1', cap);
  },
  fictional: (label) => toasts.show({
    icon: ICONS.sparkle,
    title: 'Axial is made up',
    text: 'The tracker is real, though. File a question and watch it get picked up.',
    action: { label: 'New issue', run: () => openComposer({ from: `the “${label}” button` }) },
  }),
});

new IntersectionObserver(() => schedule(), { threshold: [0, 0.25, 0.5] }).observe(trackerEl);
document.addEventListener('visibilitychange', schedule);
WIDE.addEventListener('change', schedule);
MEDIUM.addEventListener('change', schedule);
setInterval(schedule, 15000); // Lets an overdue reply release the other issues.

client.subscribe((next) => {
  state = next;
  schedule();
});
render();
client.mount();
