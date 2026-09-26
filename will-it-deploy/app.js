// Will it deploy? The page: the visitor's package.json in, a simulated
// deployment out, and a conversation about any part of it.
//
//   analyze.js        the rules engine (no DOM, no network)
//   deploy.js         the simulated deployment: log lines, phases, numbers
//   chat.js           the conversation model: prompt, subjects, threads, replies
//   stand-visitor.js  Stand's Visitor API client (discovery, sessions, recovery)
//   preview.js        the site thumbnail;  sections.js  the platform art
//
// This file only draws state and wires events.

import { analyze, readPackageJson } from './analyze.js';
import { PHASES, regionFor, seconds, simulate } from './deploy.js';
import { DEFAULT_SAMPLE, SAMPLES, sampleText } from './samples.js';
import { getClient, isConversation, parseCard } from './stand-visitor.js';
import * as chat from './chat.js';
import { palette, previewMarkup } from './preview.js';
import { drawArt } from './sections.js';

const SITE = 'demo'; // Stand Chat's shared demo site. Use your own Site ID from Sites in Stand.
const STORE_KEY = 'will-it-deploy:v1:page';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const docked = matchMedia('(min-width: 1180px)');
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (id, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const LEVEL_ICON = { ok: 'i-ok', warn: 'i-warn', info: 'i-info', error: 'i-error' };
const LEVEL_WORD = { ok: 'Works', warn: 'Needs attention', info: 'Tip', error: 'Blocks the deploy' };
const lvlIcon = (level) => icon(LEVEL_ICON[level] ?? 'i-info', `lvl lvl-${level}`);
const spinner = '<span class="spinner" aria-hidden="true">' + '<i></i>'.repeat(12) + '</span>';
const region = regionFor(timeZone());

// --- Page state ------------------------------------------------------------------
// What isn't in the transcript lives here, and in sessionStorage per tab.
const page = {
  text: '',
  source: { kind: 'sample', id: DEFAULT_SAMPLE },
  startedAt: 0,
  analysis: null,
  deployment: null,
  shown: 0, // log lines revealed so far
  playing: false,
  timer: 0,
  findingFilter: 'all',
  logFilter: 'all',
  openFinding: '',
  panelOpen: false,
  view: 'all', // the thread shown in the panel, or 'all'
  subject: chat.STACK, // what the next question is about
  promptStack: '', // the stack the session's prompt describes
  seen: {}, // thread key → the last reply seq seen there
  lastSeen: 0,
  returnFocus: null,
  contextOpen: false,
  stuck: false, // the transcript has been scrolled to its end once
  animated: '', // the analysis whose findings already played their entrance
};

function save() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({
      text: page.text, source: page.source, startedAt: page.startedAt,
      panelOpen: page.panelOpen, view: page.view, subject: page.subject,
      promptStack: page.promptStack, seen: page.seen, lastSeen: page.lastSeen,
    }));
  } catch {
    // Storage can be denied: everything still works for this page view.
  }
}

function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

// --- Stand -----------------------------------------------------------------------
const client = getClient({ site: SITE });
let convo = client.getSnapshot();

// --- Elements --------------------------------------------------------------------
const el = {
  console: $('[data-console]'),
  body: $('[data-console-body]'),
  source: $('[data-dropzone]'),
  sourceError: $('[data-source-error]'),
  editor: $('[data-editor]'),
  text: $('[data-text]'),
  editToggle: $('[data-edit]'),
  samples: $('[data-samples]'),
  projectName: $('[data-project-name]'),
  projectAvatar: $('[data-project-avatar]'),
  sourceBadge: $('[data-source-badge]'),
  deployId: $('[data-deploy-id]'),
  thumb: $('[data-thumb]'),
  status: $('[data-status]'),
  statusText: $('[data-status-text]'),
  duration: $('[data-duration]'),
  url: $('[data-url]'),
  domains: $('[data-domains]'),
  framework: $('[data-framework]'),
  node: $('[data-node]'),
  runtime: $('[data-runtime]'),
  region: $('[data-region]'),
  log: $('[data-log]'),
  phases: $('[data-phases]'),
  logMeta: $('[data-log-meta]'),
  warnCount: $('[data-warn-count]'),
  findings: $('[data-findings]'),
  findingsMeta: $('[data-findings-meta]'),
  findingFilters: $('[data-finding-filters]'),
  convo: $('[data-convo]'),
  who: $('[data-who]'),
  knows: $('[data-knows]'),
  threads: $('[data-threads]'),
  convoLog: $('[data-convo-log]'),
  convoFoot: $('[data-convo-foot]'),
  convoTitle: $('#convo-title'),
  menuButton: $('[data-menu-button]'),
  menu: $('[data-menu]'),
  toggle: $('[data-convo-toggle]'),
  pill: $('[data-convo-pill]'),
  scrim: $('[data-scrim]'),
  announce: $('[data-announce]'),
  livePrompt: $('[data-live-prompt]'),
};

// --- Input ---------------------------------------------------------------------------

/** Reads, analyzes and simulates a package.json. Returns false (and says why) if it can't. */
function load(text, source, { play = true, startedAt = Date.now() } = {}) {
  const read = readPackageJson(text);
  if (read.error) {
    showSourceError(read.error);
    return false;
  }
  showSourceError('');
  const analysis = analyze(read.pkg, read);
  const changed = page.analysis && page.analysis.name !== analysis.name;
  page.text = text;
  page.source = source;
  page.startedAt = startedAt;
  page.analysis = analysis;
  page.deployment = simulate(page.analysis, { region, key: text });
  page.openFinding = '';
  page.findingFilter = 'all';
  if (changed && page.subject.kind !== 'stack') page.subject = chat.STACK;
  if (!el.editor.hidden) el.text.value = text;
  save();
  renderSource();
  renderFindings();
  buildLog();
  if (play && !reduced.matches) startPlayback();
  else finishPlayback({ quiet: !play });
  renderConvo();
  renderLivePrompt();
  return true;
}

function showSourceError(message) {
  el.sourceError.hidden = !message;
  el.sourceError.textContent = message;
}

function renderSamples() {
  el.samples.innerHTML = SAMPLES.map((s) => `<button type="button" class="sample" data-sample="${s.id}" aria-pressed="false">${icon(`i-${s.icon}`)}<span>${esc(s.label)}</span></button>`).join('');
}

function renderSource() {
  const a = page.analysis;
  const d = page.deployment;
  const sample = page.source.kind === 'sample' ? SAMPLES.find((s) => s.id === page.source.id) : null;
  for (const b of $$('[data-sample]', el.samples)) b.setAttribute('aria-pressed', String(b.dataset.sample === sample?.id));
  el.projectName.textContent = a.name;
  const p = palette(a.name);
  el.projectAvatar.style.setProperty('--a1', `hsl(${p.hue} 90% 62%)`);
  el.projectAvatar.style.setProperty('--a2', `hsl(${(p.hue + 50) % 360} 85% 60%)`);
  el.projectAvatar.style.setProperty('--a3', `hsl(${(p.hue + 110) % 360} 80% 58%)`);
  el.sourceBadge.innerHTML = sample ? `Sample<span class="wide-only">: ${esc(sample.label)}</span>` : `Your<span class="wide-only"> ${esc(page.source.label || 'package.json')}</span><span class="narrow-only"> file</span>`;
  el.sourceBadge.classList.toggle('is-yours', !sample);
  el.deployId.textContent = `Deployment ${d.id}`;
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error('empty');
    if (load(text, { kind: 'yours', label: 'package.json' })) announce('Pasted package.json. Deploying it.');
  } catch {
    // No clipboard access: the box takes a regular paste instead.
    openEditor('');
    $('[data-editor-hint]').textContent = `Paste with ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V'}, then deploy it.`;
  }
}

function openEditor(text = page.text) {
  el.editor.hidden = false;
  el.editToggle.setAttribute('aria-expanded', 'true');
  el.text.value = text;
  el.text.focus();
}

function closeEditor() {
  el.editor.hidden = true;
  el.editToggle.setAttribute('aria-expanded', 'false');
}

function looksLikePackageJson(text) {
  const t = String(text ?? '').trim();
  return t.startsWith('{') && /"(dependencies|devDependencies|scripts|name|packageManager|workspaces)"\s*:/.test(t);
}

// --- Playback ------------------------------------------------------------------------

function startPlayback() {
  clearTimeout(page.timer);
  const lines = page.deployment.lines;
  // The real build took seconds to minutes; the replay takes about three.
  const gaps = lines.map((l, i) => (i ? l.t - lines[i - 1].t : 0));
  const delays = scaleDelays(gaps, 2800, 20, 380);
  const due = [];
  delays.reduce((at, delay, i) => (due[i] = at + delay), 250);
  for (const p of PHASES) phaseOpen.set(p, true);
  page.shown = 0;
  page.playing = true;
  renderLogLines();
  renderCard();
  // Paced by the clock, not by timer counts: a throttled tab shows lines in bursts, but ends on time.
  const start = performance.now();
  const tick = () => {
    const now = performance.now() - start;
    const before = page.shown;
    while (page.shown < lines.length && due[page.shown] <= now) appendLine(lines[page.shown++], true);
    if (page.shown !== before) {
      renderPhaseHeads();
      renderCard();
    }
    if (page.shown >= lines.length) return finishPlayback();
    page.timer = setTimeout(tick, Math.max(16, due[page.shown] - now));
  };
  page.timer = setTimeout(tick, due[0]);
}

function scaleDelays(gaps, target, min, max) {
  let lo = 0;
  let hi = 1;
  const total = (k) => gaps.reduce((sum, g) => sum + Math.min(max, Math.max(min, g * k)), 0);
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > target) hi = mid;
    else lo = mid;
  }
  return gaps.map((g) => Math.min(max, Math.max(min, g * lo)));
}

function finishPlayback({ quiet = false } = {}) {
  clearTimeout(page.timer);
  const wasPlaying = page.playing;
  page.playing = false;
  page.shown = page.deployment.lines.length;
  // Phases that went fine fold away when others have something to say.
  const notable = page.deployment.phases.some((p) => p.status === 'warn' || p.status === 'error');
  for (const p of page.deployment.phases) phaseOpen.set(p.name, !notable || p.status === 'warn' || p.status === 'error');
  renderLogLines();
  renderCard();
  // Open on what needs attention: the first warning or error, with a line of context.
  const first = $('.log-line.is-error', el.phases) ?? $('.log-line.is-warn', el.phases);
  const lines = $$('.log-line', el.phases).filter((l) => l.offsetParent !== null);
  // Its phase header too, when it fits: "Installing · 1 warning" says where we are.
  const header = first?.closest('.phase')?.querySelector('.phase-row');
  const fits = header && first.getBoundingClientRect().bottom - header.getBoundingClientRect().top < el.log.clientHeight * 0.7;
  const anchor = first ? (fits ? header : lines[Math.max(0, lines.indexOf(first) - 2)]) : null;
  el.log.scrollTop = anchor
    ? Math.max(0, anchor.getBoundingClientRect().top - el.log.getBoundingClientRect().top + el.log.scrollTop - 4)
    : notable ? 0 : el.log.scrollHeight;
  if (wasPlaying && !quiet) {
    const d = page.deployment;
    const warnings = page.analysis.findings.filter((f) => f.level === 'warn').length;
    announce(d.outcome === 'ready'
      ? `Deployment ready in ${seconds(d.durationMs)}${warnings ? `, with ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''}.`
      : `Deployment failed while ${d.failedPhase.toLowerCase()}.`);
  }
}

// --- The deployment card -------------------------------------------------------------------

function renderCard() {
  const a = page.analysis;
  const d = page.deployment;
  const done = !page.playing;
  const current = page.deployment.lines[page.shown - 1];
  const state = done ? d.outcome : page.shown ? 'building' : 'queued';
  el.status.className = `status is-${state}`;
  const warnings = a.findings.filter((f) => f.level === 'warn').length;
  el.statusText.innerHTML = {
    queued: 'Queued',
    building: 'Building',
    ready: 'Ready',
    error: 'Error',
  }[state];
  const sub = el.status.parentElement.querySelector('.status-sub') ?? el.status.parentElement.appendChild(Object.assign(document.createElement('span'), { className: 'status-sub' }));
  sub.textContent = state === 'ready' && warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : state === 'error' ? `Failed while ${d.failedPhase.toLowerCase()}` : '';
  sub.classList.toggle('is-warn', state === 'ready' && warnings > 0);
  sub.hidden = !sub.textContent;
  el.duration.textContent = done ? seconds(d.durationMs) : current ? seconds(current.t) : '–';
  const live = done && d.outcome === 'ready';
  el.url.textContent = live ? d.url : '–';
  el.url.title = live ? d.url : '';
  el.domains.innerHTML = live ? `${esc(d.domains[0])}<span class="more" title="${esc(d.domains[1])}">+1</span>` : '–';
  el.framework.textContent = a.framework?.label ?? 'None detected';
  el.node.textContent = a.node.status === 'unsupported' ? `${a.node.range} (none)` : `${a.node.major}.x`;
  const r = d.routes;
  const total = r.static + r.node + r.edge;
  el.runtime.innerHTML = total && d.outcome === 'ready' && done
    ? `<div class="runtime"><div class="runtime-bar" aria-hidden="true">${r.static ? `<span class="rt-static" style="flex-grow:${r.static}"></span>` : ''}${r.node ? `<span class="rt-node" style="flex-grow:${r.node}"></span>` : ''}${r.edge ? `<span class="rt-edge" style="flex-grow:${r.edge}"></span>` : ''}</div>
      <div class="runtime-legend">${r.static ? `<span><i class="rt-static"></i>${r.static} static</span>` : ''}${r.node ? `<span><i class="rt-node"></i>${r.node} Node</span>` : ''}${r.edge ? `<span><i class="rt-edge"></i>${r.edge} edge</span>` : ''}<span class="sr-only">routes</span></div></div>`
    : `<span class="muted">${d.outcome === 'error' && done ? 'Nothing deployed' : '–'}</span>`;
  const fns = a.functions.filter((f) => f.runtime === 'node').length;
  el.region.innerHTML = fns ? `<span class="mono">${d.region.code.toUpperCase()}</span> · ${esc(d.region.city)}` : '<span class="muted">No functions</span>';
  const thumbState = done ? d.outcome : 'building';
  if (el.thumb.dataset.state !== `${thumbState}:${d.id}`) {
    el.thumb.dataset.state = `${thumbState}:${d.id}`;
    el.thumb.innerHTML = previewMarkup(a, d, thumbState);
    if (thumbState === 'ready' && page.playing === false && el.thumb.dataset.animate === 'yes') $('.pv', el.thumb).classList.add('is-arriving');
    el.thumb.dataset.animate = thumbState === 'building' ? 'yes' : 'no';
  }
}

// --- The build log ----------------------------------------------------------------------

const phaseOpen = new Map();
let activeAsk = null; // the log's one tabbable Ask button

function buildLog() {
  const d = page.deployment;
  for (const p of PHASES) phaseOpen.set(p, true);
  el.phases.innerHTML = d.phases.map((p) => {
    const id = `phase-${p.name.toLowerCase().replace(/\s+/g, '-')}`;
    return `<div class="phase" data-phase="${esc(p.name)}">
      <div class="phase-row">
        <button type="button" class="phase-head" aria-expanded="true" aria-controls="${id}">
          ${icon('i-chevron', 'i-chev')}<span class="phase-name">${esc(p.name)}</span><span class="phase-note"></span><span class="phase-time"></span><span class="phase-state"></span>
        </button>
        <button type="button" class="ask" tabindex="-1" data-ask-phase="${esc(p.name)}" aria-label="Ask about the ${esc(p.name)} phase">Ask</button>
      </div>
      <ol class="phase-lines" id="${id}"></ol>
    </div>`;
  }).join('');
  const warnLines = d.lines.filter((l) => l.level === 'warn' || l.level === 'error').length;
  const hasErrors = d.lines.some((l) => l.level === 'error');
  el.warnCount.textContent = warnLines ? String(warnLines) : '';
  el.warnCount.previousSibling.textContent = hasErrors ? 'Issues' : 'Warnings';
  el.warnCount.classList.toggle('is-error', hasErrors);
  el.logMeta.textContent = `${d.lines.length} lines · ${seconds(d.durationMs)}`;
}

function renderLogLines() {
  for (const ol of $$('.phase-lines', el.phases)) ol.innerHTML = '';
  for (const line of page.deployment.lines.slice(0, page.shown)) appendLine(line, false);
  renderPhaseHeads();
  syncAskStates();
  if (!activeAsk || !activeAsk.isConnected) setActiveAsk($('.ask', el.phases));
}

function appendLine(line, animate) {
  const ol = $(`.phase[data-phase="${CSS.escape(line.phase)}"] .phase-lines`, el.phases);
  if (!ol) return;
  const li = document.createElement('li');
  li.className = `log-line is-${line.level}${animate ? ' is-new' : ''}`;
  li.dataset.n = line.n;
  if (line.finding) li.dataset.finding = line.finding;
  const at = new Date(page.startedAt + line.t);
  const full = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${String(at.getMilliseconds()).padStart(3, '0')}`;
  li.innerHTML = `<time datetime="${at.toISOString()}"><span class="t-full">${full}</span><span class="t-rel">${(line.t / 1000).toFixed(1)}s</span></time><span class="msg">${esc(line.text)}</span><button type="button" class="ask" tabindex="-1" data-ask-line="${line.n}" aria-label="Ask about line ${line.n}: ${esc(line.text)}">Ask</button>`;
  li.hidden = page.logFilter === 'warn' && !['warn', 'error'].includes(line.level);
  ol.append(li);
  if (animate && !reduced.matches) {
    // Follow the stream, unless the visitor scrolled up to read.
    const nearBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 90;
    if (nearBottom || page.shown <= 2) el.log.scrollTop = el.log.scrollHeight;
  }
}

function renderPhaseHeads() {
  const d = page.deployment;
  const shownT = page.shown ? d.lines[page.shown - 1].t : 0;
  for (const p of d.phases) {
    const node = $(`.phase[data-phase="${CSS.escape(p.name)}"]`, el.phases);
    const lines = d.lines.filter((l) => l.phase === p.name);
    const shown = lines.filter((l) => l.n <= page.shown);
    const complete = !page.playing || (shown.length === lines.length && lines.length > 0 && page.shown > lines.at(-1).n);
    let status = p.status;
    if (page.playing && !complete) status = shown.length ? 'running' : 'pending';
    if (p.status === 'skipped') status = page.playing ? 'pending' : 'skipped';
    node.className = `phase is-${status}`;
    const open = phaseOpen.get(p.name) ?? true;
    const head = $('.phase-head', node);
    head.setAttribute('aria-expanded', String(open && status !== 'pending' && status !== 'skipped'));
    head.disabled = status === 'pending' || status === 'skipped';
    $('.phase-lines', node).hidden = !open;
    const warnings = shown.filter((l) => l.level === 'warn').length;
    const errors = shown.filter((l) => l.level === 'error').length;
    $('.phase-note', node).textContent = errors ? 'failed' : warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : status === 'skipped' ? 'skipped' : '';
    const start = lines[0]?.t ?? 0;
    const end = complete ? (lines.at(-1)?.t ?? start) : shownT;
    $('.phase-time', node).textContent = shown.length ? `${((end - start) / 1000 + (lines.length === 1 ? 0.1 : 0)).toFixed(1)}s` : '';
    $('.phase-state', node).innerHTML = status === 'running' ? spinner : status === 'ok' ? icon('i-check') : status === 'warn' ? icon('i-warn') : status === 'error' ? icon('i-error') : '';
    $('[data-ask-phase]', node).hidden = status === 'pending' || status === 'skipped';
  }
}

function setActiveAsk(button) {
  if (activeAsk && activeAsk !== button) activeAsk.tabIndex = -1;
  activeAsk = button ?? null;
  if (activeAsk) activeAsk.tabIndex = 0;
}

function visibleAsks() {
  return $$('.ask', el.phases).filter((b) => !b.hidden && b.offsetParent !== null);
}

function lineByNumber(n) {
  return page.deployment.lines.find((l) => l.n === Number(n));
}

// --- Findings -------------------------------------------------------------------------------

function renderFindings() {
  const a = page.analysis;
  const groups = {
    all: a.findings,
    attention: a.findings.filter((f) => f.level === 'error' || f.level === 'warn'),
    info: a.findings.filter((f) => f.level === 'info'),
    ok: a.findings.filter((f) => f.level === 'ok'),
  };
  el.findingFilters.innerHTML = [['all', 'All'], ['attention', 'Attention'], ['info', 'Tips'], ['ok', 'Works']]
    .map(([k, label]) => `<button type="button" data-finding-filter="${k}" aria-pressed="${page.findingFilter === k}">${label}<span class="seg-count">${groups[k].length}</span></button>`).join('');
  const attention = groups.attention.length;
  el.findingsMeta.textContent = attention ? `${attention} need${attention === 1 ? 's' : ''} attention` : 'Nothing blocking';
  const list = groups[page.findingFilter] ?? groups.all;
  const entrance = page.animated !== page.text && !reduced.matches;
  page.animated = page.text;
  el.findings.innerHTML = list.length ? list.map((f, i) => findingItem(f, i, entrance)).join('') : '<li class="empty-note">Nothing here for this stack.</li>';
  syncAskStates();
}

function findingItem(f, i, entrance) {
  const open = page.openFinding === f.id;
  const lines = page.deployment.lines.filter((l) => l.finding === f.id);
  return `<li class="finding${entrance ? ' is-new' : ''}${open ? ' is-open' : ''}" data-finding="${esc(f.id)}" style="--n:${i}">
    <div class="finding-row">
      <button type="button" class="finding-main" aria-expanded="${open}" aria-controls="fd-${esc(f.id)}">
        ${lvlIcon(f.level)}<span class="finding-title"><span class="sr-only">${LEVEL_WORD[f.level]}: </span>${esc(f.title)}</span>
        <span class="finding-summary">${esc(f.summary)}</span>
      </button>
      <button type="button" class="ask" data-ask-finding="${esc(f.id)}" aria-label="Ask about ${esc(f.id)}">${icon('i-chat')}<span>Ask</span></button>
    </div>
    <div class="finding-detail" id="fd-${esc(f.id)}" ${open ? '' : 'hidden'}>
      <p>${esc(f.detail)}</p>
      ${f.fix ? `<pre><code>${esc(f.fix)}</code><button type="button" class="icon-btn copy-btn" data-copy="${esc(f.fix)}" aria-label="Copy">${icon('i-copy')}</button></pre>` : ''}
      ${lines.length || f.packages.length ? `<p class="finding-links">${lines.map((l) => `<button type="button" class="chip-link" data-goto-line="${l.n}">${icon('i-log')}L${l.n} ${esc(l.phase)}</button>`).join('')}${f.packages.slice(0, 4).map((p) => `<span class="chip-link chip-pkg">${esc(p)}</span>`).join('')}</p>` : ''}
    </div>
  </li>`;
}

function syncAskStates() {
  const { threads } = chat.threadsOf(convo.messages, convo.pending);
  const askedFindings = new Set();
  const askedLines = new Set();
  for (const t of threads.values()) {
    if (t.anchor.kind === 'finding') askedFindings.add(t.anchor.id);
    if (t.anchor.kind === 'log') askedLines.add(chat.anchorKey(t.anchor));
  }
  for (const b of $$('[data-ask-finding]')) {
    const has = askedFindings.has(b.dataset.askFinding);
    b.classList.toggle('has-thread', has);
    b.setAttribute('aria-label', `${has ? 'Open the thread about' : 'Ask about'} ${b.dataset.askFinding}`);
  }
  for (const b of $$('[data-ask-line]', el.phases)) {
    const line = lineByNumber(b.dataset.askLine);
    b.classList.toggle('has-thread', Boolean(line && askedLines.has(chat.anchorKey(logAnchor(line)))));
  }
  for (const b of $$('[data-ask-phase]', el.phases)) {
    b.classList.toggle('has-thread', askedLines.has(chat.anchorKey({ kind: 'log', phase: b.dataset.askPhase, text: '' })));
  }
}

// --- References: the conversation points at the page -------------------------------------------

function resolveRef(name) {
  const n = chat.normalizeRef(name);
  const a = page.analysis;
  const f = a.findings.find((x) => x.id === n) ?? a.findings.find((x) => x.packages.includes(n));
  if (f) return { key: `finding:${f.id}`, kind: 'finding', label: f.id, level: f.level, icon: lvlIcon(f.level), title: f.title };
  const phase = PHASES.find((p) => p.toLowerCase() === n.replace(/ phase$/, ''));
  if (phase) return { key: `phase:${phase}`, kind: 'phase', label: phase, icon: icon('i-log'), title: `The ${phase} phase in the build log` };
  const plan = ['hobby', 'pro', 'enterprise'].find((p) => [p, `${p} plan`, `pricing: ${p}`, `plan: ${p}`].includes(n));
  if (plan) return { key: `plan:${plan}`, kind: 'plan', label: plan[0].toUpperCase() + plan.slice(1), icon: icon('i-stack'), title: `The ${plan} plan` };
  return null;
}

function goTo(key) {
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (!docked.matches && page.panelOpen) closePanel({ restoreFocus: false });
  if (kind === 'finding') showFinding(id);
  else if (kind === 'phase') showPhase(id);
  else if (kind === 'line') showLine(Number(id));
  else if (kind === 'plan') {
    const card = $(`#plan-${id}`);
    if (!card) return;
    card.scrollIntoView({ behavior: smooth(), block: 'center' });
    light(card);
  }
}

function showFinding(id) {
  const f = page.analysis.findings.find((x) => x.id === id);
  if (!f) return;
  if (page.findingFilter !== 'all') page.findingFilter = 'all';
  page.openFinding = id;
  renderFindings();
  const item = $(`.finding[data-finding="${CSS.escape(id)}"]`, el.findings);
  scrollWithin(el.findings, item);
  bringIntoView(item.closest('.findings'));
  light(item);
  const lines = $$(`.log-line[data-finding="${CSS.escape(id)}"]`, el.phases);
  for (const line of lines) {
    const phase = line.closest('.phase').dataset.phase;
    if (!phaseOpen.get(phase)) {
      phaseOpen.set(phase, true);
      renderPhaseHeads();
    }
    light(line);
  }
  if (lines[0]) scrollWithin(el.log, lines[0]);
}

function showPhase(name) {
  phaseOpen.set(name, true);
  renderPhaseHeads();
  const node = $(`.phase[data-phase="${CSS.escape(name)}"]`, el.phases);
  if (!node) return;
  scrollWithin(el.log, node);
  bringIntoView(el.log.closest('.logs'));
  light(node);
}

function showLine(n) {
  const line = lineByNumber(n);
  if (!line) return;
  if (page.logFilter === 'warn' && !['warn', 'error'].includes(line.level)) setLogFilter('all');
  phaseOpen.set(line.phase, true);
  renderPhaseHeads();
  const li = $(`.log-line[data-n="${n}"]`, el.phases);
  if (!li) return;
  scrollWithin(el.log, li);
  bringIntoView(el.log.closest('.logs'));
  light(li);
}

function light(node) {
  node.classList.remove('is-lit');
  void node.offsetWidth;
  node.classList.add('is-lit');
  clearTimeout(node.litTimer);
  node.litTimer = setTimeout(() => node.classList.remove('is-lit'), 2600);
}

function scrollWithin(container, child) {
  const c = container.getBoundingClientRect();
  const r = child.getBoundingClientRect();
  if (container.scrollHeight <= container.clientHeight) return;
  const top = container.scrollTop + (r.top - c.top) - Math.max(12, (c.height - r.height) / 3);
  container.scrollTo({ top, behavior: smooth() });
}

function bringIntoView(node) {
  const r = node.getBoundingClientRect();
  const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;
  if (r.top >= navH && r.bottom <= innerHeight) return;
  let delta = r.height > innerHeight - navH ? r.top - navH - 8 : r.top + r.height / 2 - (navH + innerHeight) / 2;
  if (delta > 0 && docked.matches && page.panelOpen) {
    // Past this point the sticky panel would ride up with the end of the deployment.
    const room = el.body.getBoundingClientRect().bottom - (navH + 12 + el.convo.getBoundingClientRect().height);
    delta = Math.min(delta, Math.max(0, room));
  }
  if (Math.abs(delta) > 2) scrollBy({ top: delta, behavior: smooth() });
}

const smooth = () => (reduced.matches ? 'auto' : 'smooth');

// --- The conversation panel ---------------------------------------------------------------------

function logAnchor(line) {
  return { kind: 'log', phase: line.phase, text: chat.clean(line.text, 96) };
}

function openPanel(subject, { from = null, question = '' } = {}) {
  if (subject) {
    page.subject = subject;
    page.view = chat.anchorKey(subject);
  }
  if (question && !convo.draft.trim()) client.setDraft(question);
  page.returnFocus = from ?? document.activeElement;
  const wasOpen = page.panelOpen;
  page.panelOpen = true;
  save();
  renderConvo();
  placePanel();
  if (docked.matches) {
    // Sticky keeps it in view while scrolling; this covers opening it near the ends.
    const r = el.convo.getBoundingClientRect();
    const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;
    const delta = r.top < navH + 8 ? r.top - navH - 12 : r.bottom > innerHeight - 8 ? Math.min(r.bottom - innerHeight + 12, r.top - navH - 12) : 0;
    if (Math.abs(delta) > 2) scrollBy({ top: delta, behavior: smooth() });
  }
  // The panel is laid out by now: focus goes straight to the question box.
  const box = $('.composer textarea', el.convo);
  (box && !box.disabled && !box.closest('[hidden]') ? box : el.convoTitle).focus({ preventScroll: true });
}

function closePanel({ restoreFocus = true } = {}) {
  page.panelOpen = false;
  save();
  closeMenu();
  placePanel();
  const back = page.returnFocus;
  page.returnFocus = null;
  if (restoreFocus) {
    const target = back?.isConnected && back.offsetParent !== null ? back : (docked.matches ? el.toggle : el.pill);
    target?.focus?.({ preventScroll: true });
  }
}

// Docked beside the deployment on wide screens; a modal drawer or sheet on smaller ones.
function placePanel() {
  const open = page.panelOpen;
  const overlay = !docked.matches;
  el.convo.hidden = !open;
  el.body.classList.toggle('has-convo', open && !overlay);
  el.scrim.hidden = !(open && overlay);
  document.documentElement.style.overflow = open && overlay ? 'hidden' : '';
  if (overlay) {
    el.convo.setAttribute('role', 'dialog');
    el.convo.setAttribute('aria-modal', 'true');
  } else {
    el.convo.removeAttribute('role');
    el.convo.removeAttribute('aria-modal');
  }
  const hasConversation = convo.messages.some(isConversation) || Boolean(convo.pending);
  el.toggle.hidden = open || !hasConversation;
  el.pill.hidden = open || !hasConversation || docked.matches;
  updateUnread();
}

function updateUnread() {
  const unread = convo.messages.filter((m) => isConversation(m) && m.senderType !== 'visitor' && m.seq > page.lastSeen).length;
  for (const badge of $$('[data-unread]')) {
    badge.hidden = !unread || page.panelOpen;
    badge.textContent = String(unread);
  }
}

// Renders the whole panel from the client's state and the page's.
let lastLogKey = '';
function renderConvo() {
  const a = page.analysis;
  if (!a) return;
  const s = convo;
  const { threads, byMessage } = chat.threadsOf(s.messages, s.pending);

  // A failed start hands the question back as a draft, subject and all.
  if (s.draft.startsWith('[')) {
    const parsed = chat.parseMessage(s.draft);
    if (parsed.text !== s.draft) {
      page.subject = parsed.anchor;
      page.view = chat.anchorKey(parsed.anchor);
      client.setDraft(parsed.text);
      return;
    }
  }

  const subjectKey = chat.anchorKey(page.subject);
  if (page.view !== 'all' && !threads.has(page.view) && page.view !== subjectKey) page.view = subjectKey;

  // Who answers: exactly as Stand says.
  const host = s.host;
  const kind = host.kind === 'rep' ? 'person' : host.kind === 'standin' ? 'ai' : '';
  const name = host.name || (s.phase === 'unavailable' ? 'Nobody available' : 'Airstrip team');
  const conn = s.phase === 'active' && s.connection !== 'online'
    ? `<span class="conn is-off"><i></i>${s.connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>` : '';
  el.who.innerHTML = s.phase === 'loading' && !host.name
    ? `<span class="avatar">${spinner}</span><span class="who-text"><span class="who-name"><span>Checking who can answer…</span></span></span>`
    : s.phase === 'unavailable' && !host.name
    ? `<span class="avatar is-off" aria-hidden="true"></span><span class="who-text"><span class="who-name"><span>Nobody available</span></span><span class="who-sub">Airstrip’s team is away right now</span></span>`
    : `${avatar(host)}<span class="who-text"><span class="who-name"><span>${esc(name)}</span>${kind === 'ai' ? '<span class="badge is-ai">AI</span>' : kind === 'person' ? '<span class="badge is-person">Team</span>' : ''}</span><span class="who-sub">${kind === 'ai' ? 'AI Stand-in' : kind === 'person' ? esc(host.title || 'Person on the team') : 'Answers via Stand'} · for Airstrip</span></span>${conn}`;

  // What the answer knows: the stack summary that rides along.
  const warnCount = a.findings.filter((f) => f.level === 'warn').length;
  const errorCount = a.findings.filter((f) => f.level === 'error').length;
  const stackIntroduced = introducedStack();
  const willIntroduce = s.phase === 'active' && stackIntroduced && stackIntroduced !== a.name;
  const restoring = s.phase === 'loading' && s.messages.length > 0;
  el.knows.innerHTML = `<span class="knows-label">${s.phase === 'active' || restoring ? 'Knows your stack' : s.phase === 'ended' ? 'Sent with the first question' : 'Sent with your first question'}</span>
    <span class="ctx">${esc(a.framework?.label ?? 'No framework')}</span>
    <span class="ctx">Node ${esc(a.node.major || a.node.range)}</span>
    <span class="ctx">${esc(a.pm.label)}</span>
    <span class="ctx">${a.count} packages</span>
    ${errorCount ? `<span class="ctx is-error">${icon('i-error')}${errorCount}</span>` : ''}${warnCount ? `<span class="ctx is-warn">${icon('i-warn')}${warnCount}</span>` : ''}
    <button type="button" class="ctx-view" data-context-toggle aria-expanded="${page.contextOpen}">${page.contextOpen ? 'Hide' : 'What’s sent'}</button>
    ${page.contextOpen ? `<pre class="ctx-detail">${esc(contextText(willIntroduce))}</pre><p class="ctx-caption">${willIntroduce ? `Your next question carries this, because the conversation started about ${esc(stackIntroduced)}.` : s.phase === 'active' ? 'Sent privately with your first question. Your team sees it in Stand.' : 'Sent privately with your first question: whoever answers sees it, you don’t.'}</p>` : ''}`;

  // Threads: a tab per subject, once there's more than one.
  const keys = [...threads.keys()];
  if (!threads.has(subjectKey) && s.phase !== 'ended') keys.push(subjectKey);
  const showTabs = keys.length > 1;
  el.threads.hidden = !showTabs;
  if (showTabs) {
    el.threads.innerHTML = [`<button type="button" class="thread-tab" data-view="all" aria-pressed="${page.view === 'all'}">${icon('i-chat')}<span>All</span></button>`,
      ...keys.map((key) => {
        const anchor = threads.get(key)?.anchor ?? page.subject;
        const info = subjectInfo(anchor);
        const unread = threads.get(key) && threads.get(key).lastSeq > (page.seen[key] ?? 0) && page.view !== key && page.view !== 'all' && hasReplyAfter(key, byMessage, page.seen[key] ?? 0);
        return `<button type="button" class="thread-tab" data-view="${esc(key)}" aria-pressed="${page.view === key}" title="${esc(info.title)}">${info.icon}<span>${esc(info.label)}</span>${unread ? '<span class="dot" aria-hidden="true"></span><span class="sr-only">, new reply</span>' : ''}</button>`;
      })].join('');
  }

  // The transcript for this view.
  const dueKey = replyDueKey(byMessage);
  const logKey = JSON.stringify([page.view, subjectKey, s.phase, s.error, s.busy, s.pending, s.activity, s.messages.length, s.messages.at(-1)?.messageId, host, a.name, dueKey, s.followupOffered]);
  if (logKey !== lastLogKey) {
    lastLogKey = logKey;
    const stick = el.convoLog.scrollHeight - el.convoLog.scrollTop - el.convoLog.clientHeight < 120;
    el.convoLog.innerHTML = transcriptHtml(threads, byMessage, dueKey);
    if (stick || !page.stuck) el.convoLog.scrollTop = el.convoLog.scrollHeight;
    page.stuck = true;
  }

  renderFoot(threads, dueKey);
  markSeen(threads, byMessage);
  syncAskStates();
  placePanel();
  renderLivePrompt();
}

function avatar(host) {
  const src = safeUrl(host.avatar);
  const initials = (host.name || 'A').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<span class="avatar">${src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : esc(initials)}</span>`;
}

function subjectInfo(anchor) {
  if (anchor.kind === 'finding') {
    const f = page.analysis.findings.find((x) => x.id === anchor.id);
    return { icon: f ? lvlIcon(f.level) : icon('i-chat'), label: anchor.id, title: f?.title ?? `${anchor.id} (from another package.json)`, finding: f };
  }
  if (anchor.kind === 'log') {
    if (!anchor.text) return { icon: icon('i-log'), label: anchor.phase, title: `The ${anchor.phase} phase` };
    const line = page.deployment.lines.find((l) => l.phase === anchor.phase && chat.sameLogText(anchor.text, l.text));
    const short = anchor.text.length > 18 ? `${anchor.text.slice(0, 17)}…` : anchor.text;
    return { icon: icon('i-log'), label: line ? `L${line.n} ${short}` : short, title: anchor.text, line };
  }
  return { icon: icon('i-stack'), label: 'Whole stack', title: 'Your whole stack' };
}

// Which thread is waiting for an answer, if any.
function replyDueKey(byMessage) {
  if (convo.pending) return chat.anchorKey(chat.parseMessage(convo.pending.body).anchor);
  if (convo.activity?.kind !== 'thinking') return '';
  const last = convo.messages.findLast((m) => m.senderType === 'visitor' && m.type === 'text');
  return last ? byMessage.get(last.messageId) ?? '' : '';
}

function hasReplyAfter(key, byMessage, seq) {
  return convo.messages.some((m) => m.seq > seq && m.senderType !== 'visitor' && isConversation(m) && byMessage.get(m.messageId) === key);
}

function markSeen(threads, byMessage) {
  if (!page.panelOpen || document.visibilityState === 'hidden') return;
  const replies = convo.messages.filter((m) => isConversation(m) && m.senderType !== 'visitor');
  const maxSeq = replies.at(-1)?.seq ?? 0;
  let changed = false;
  if (page.view === 'all') {
    for (const key of threads.keys()) {
      if ((page.seen[key] ?? 0) < maxSeq) {
        page.seen[key] = maxSeq;
        changed = true;
      }
    }
  } else if (threads.has(page.view)) {
    const own = replies.filter((m) => byMessage.get(m.messageId) === page.view).at(-1)?.seq ?? 0;
    if ((page.seen[page.view] ?? 0) < own) {
      page.seen[page.view] = own;
      changed = true;
    }
  }
  if (page.lastSeen < maxSeq) {
    page.lastSeen = maxSeq;
    changed = true;
  }
  if (changed) save();
}

// Who said each reply, from the transcript itself: a handoff doesn't rename earlier answers.
function speakersOf(messages, host) {
  const names = new Map();
  let standin = host.kind === 'standin' ? host.name : '';
  let person = '';
  for (const m of messages) {
    if (m.type === 'system-card' || m.senderType === 'system-card') {
      const c = parseCard(m.body);
      if (c.cardType === 'session-start' || c.cardType === 'standin-takeover') standin = c.standinName || standin;
      if (c.cardType === 'handoff' || c.cardType === 'human-transfer') person = c.repName || person;
    } else if (m.senderType === 'standin') {
      names.set(m.messageId, { name: standin || 'AI Stand-in', kind: 'ai', avatar: host.kind === 'standin' ? host.avatar : '' });
    } else if (m.senderType === 'rep') {
      const name = person || (host.kind === 'rep' ? host.name : '') || 'Airstrip team';
      names.set(m.messageId, { name, kind: 'person', avatar: host.kind === 'rep' && host.name === name ? host.avatar : '' });
    }
  }
  return names;
}

function transcriptHtml(threads, byMessage, dueKey) {
  const s = convo;
  const speakers = speakersOf(s.messages, s.host);
  const view = page.view;
  const parts = [];
  const visible = s.messages.filter((m) => !chat.hidden(m));
  const inView = (m) => {
    if (!isConversation(m)) return true; // System cards belong to every thread.
    return view === 'all' || byMessage.get(m.messageId) === view;
  };
  const items = visible.filter(inView);
  const viewThread = view === 'all' ? null : threads.get(view);
  const pendingKey = s.pending ? chat.anchorKey(chat.parseMessage(s.pending.body).anchor) : '';
  const pendingHere = s.pending && (view === 'all' || pendingKey === view);

  if (s.phase === 'loading' && !visible.length && !s.pending) {
    return `<div class="state-card is-loading">${spinner}<span>Checking who can answer…</span></div>`;
  }
  if (s.phase === 'unavailable' && !visible.length && !s.pending) {
    return `<div class="state-card"><h3>Nobody can answer right now</h3>
      <p>${s.error === 'start' ? esc(chat.ERRORS.start) : s.error === 'connect' ? 'We couldn’t reach Airstrip’s team.' : 'Airstrip’s team and its AI Stand-in aren’t taking new conversations at the moment.'} Your deployment and its findings still work.</p>
      <button type="button" class="btn btn-ghost btn-sm" data-retry>${icon('i-redeploy')}<span>Check again</span></button></div>`;
  }
  if (s.phase === 'uncertain') {
    return `<div class="state-card"><h3>Did that start a conversation?</h3>
      <p>${esc(chat.ERRORS.uncertain)} Starting again could open a second one, so it’s your call. Your question is kept.</p>
      <button type="button" class="btn btn-dark btn-sm" data-new-chat>Start a new conversation</button></div>`;
  }

  // An empty thread: what it's about, and a few questions to start from.
  const emptyHere = !items.some(isConversation) && !pendingHere;
  if (emptyHere && s.phase !== 'ended') parts.push(subjectCard(view === 'all' ? page.subject : viewThread?.anchor ?? page.subject));

  for (const m of items) {
    const html = messageHtml(m, view === 'all', speakers.get(m.messageId));
    if (html) parts.push(html);
  }
  if (pendingHere) {
    const parsed = chat.parseMessage(s.pending.body);
    const failed = !s.busy && (s.error === 'send' || s.error === 'lost' || s.error === 'gone');
    parts.push(`<div class="msg msg-visitor">
      ${view === 'all' ? subjectButton(parsed.anchor) : ''}
      <div class="bubble">${esc(parsed.text)}</div>
      ${failed
        ? `<span class="msg-state is-failed">${icon('i-error')}${s.phase === 'ended' ? 'Not delivered before the conversation closed' : 'Not delivered'}${s.phase === 'active' ? ' · <button type="button" data-retry-send>Retry</button>' : ''}</span>`
        : `<span class="msg-state">${spinner}${s.pending.creating ? 'Starting the conversation…' : 'Sending…'}</span>`}
    </div>`);
  }
  if (s.activity && (view === 'all' || dueKey === view || !dueKey)) {
    const preview = s.activity.preview;
    parts.push(preview
      ? `<div class="msg msg-reply">${avatar(s.host).replace('class="avatar"', 'class="avatar is-small"')}<div><div class="msg-meta">${esc(s.host.name || 'Airstrip team')}</div><div class="msg-body preview">${chat.formatReply(preview, resolveRef)}</div></div></div>`
      : `<div class="thinking">${avatar(s.host).replace('class="avatar"', 'class="avatar is-small"')}<span class="shimmer">${s.activity.kind === 'typing' ? `${esc(s.host.name || 'Someone')} is typing…` : visible.filter((m) => m.senderType === 'visitor').length <= 1 ? 'Reading your stack…' : 'Thinking…'}</span></div>`);
  }
  if (s.phase === 'ended') {
    parts.push(`<div class="state-card"><h3>This conversation has ended</h3>
      <p>${s.error === 'gone' ? esc(chat.ERRORS.gone) + ' ' : ''}Start a new one whenever you like. It will know the stack on the page.</p>
      <button type="button" class="btn btn-dark btn-sm" data-new-chat>Start a new conversation</button></div>`);
  }
  return parts.join('');
}

function subjectButton(anchor) {
  const info = subjectInfo(anchor);
  return `<button type="button" class="msg-subject" data-goto-subject="${esc(chat.anchorKey(anchor))}" title="Show ${esc(info.title)}">${info.icon}<span>${esc(info.label)}</span></button>`;
}

function subjectCard(anchor) {
  const a = page.analysis;
  const d = page.deployment;
  const info = subjectInfo(anchor);
  let head;
  let questions;
  if (anchor.kind === 'finding') {
    const f = info.finding;
    head = f
      ? `<p class="kicker">${lvlIcon(f.level)}${LEVEL_WORD[f.level]}</p><h3>${esc(f.title)}</h3><p>${esc(f.summary)}</p>`
      : `<p class="kicker">Finding</p><h3>${esc(anchor.id)}</h3><p>This finding isn’t in the current package.json.</p>`;
    questions = f?.questions?.length ? f.questions : ['What does this mean for my app?'];
  } else if (anchor.kind === 'log' && anchor.text) {
    const line = info.line;
    head = `<p class="kicker">${icon('i-log')}Build log · ${esc(anchor.phase)}${line ? ` · line ${line.n}` : ''}</p><span class="logline${line && ['warn', 'error'].includes(line.level) ? ` is-${line.level}` : ''}">${esc(line?.text ?? anchor.text)}</span>`;
    questions = line && ['warn', 'error'].includes(line.level) ? ['What does this mean?', 'How do I fix it?'] : ['What happens in this step?', 'Is this normal for my stack?'];
  } else if (anchor.kind === 'log') {
    const phase = d.phases.find((p) => p.name === anchor.phase);
    const lines = d.lines.filter((l) => l.phase === anchor.phase);
    const time = lines.length ? seconds(lines.at(-1).t - lines[0].t + 100) : '';
    head = `<p class="kicker">${icon('i-log')}Build phase</p><h3>${esc(anchor.phase)}</h3><p>${phase?.status === 'skipped' ? 'Skipped: an earlier phase failed.' : `${lines.length} lines${time ? `, ${time}` : ''}${phase?.warnings ? `, ${phase.warnings} ${phase.warnings === 1 ? 'warning' : 'warnings'}` : ''}.`}</p>`;
    questions = [`What happens while ${anchor.phase.toLowerCase()}?`, time ? `Why does ${anchor.phase.toLowerCase()} take ${time}?` : 'Can this be faster?'];
  } else {
    head = `<p class="kicker">${icon('i-stack')}Your stack</p><h3>${esc(a.name)}</h3><p>${esc([a.framework?.label, `Node ${a.node.major || a.node.range}`, a.pm.label, `${a.count} packages`].filter(Boolean).join(' · '))}</p>`;
    questions = d.outcome === 'error'
      ? ['Why did the deployment fail?', 'What should I change first?', 'Can I run this on the free plan?']
      : ['Can I run this on the free plan?', 'What would you change before deploying?', 'Where will my functions run?'];
  }
  const canAsk = ['available', 'active'].includes(convo.phase);
  const hold = sendBlocked() ? ' disabled' : '';
  return `<div class="subject-card">${head}
    ${canAsk ? `<div class="suggestions">${questions.slice(0, 3).map((q) => `<button type="button" class="suggestion" data-suggest="${esc(q)}"${hold}>${esc(q)}${icon('i-arrow')}</button>`).join('')}</div>` : ''}
    <p class="privacy-note">${icon('i-lock')}<span>Your question goes to Airstrip’s team through Stand, with a summary of this stack. The rest stays in your browser.</span></p>
  </div>`;
}

function messageHtml(m, showSubject, speaker) {
  if (m.type === 'system-card' || m.senderType === 'system-card') {
    const card = parseCard(m.body);
    const person = esc(card.repName || 'Someone from the team');
    const text = {
      handoff: `${icon('i-chat')}${person} joined the conversation`,
      'human-transfer': `${icon('i-chat')}${person} from the team took over`,
      'standin-takeover': `${icon('i-chat')}${esc(card.standinName || 'The AI Stand-in')} is answering again`,
      'session-end': 'The conversation ended',
      'rep-followup-offer': `${person} can follow up by email`,
      'rep-followup-confirmation': `${icon('i-check')}Got it. You’ll hear back by email`,
    }[card.cardType];
    return text ? `<div class="sys" role="note"><span>${text}</span></div>` : '';
  }
  if (m.senderType === 'visitor') {
    const parsed = chat.parseMessage(m.body);
    return `<div class="msg msg-visitor" data-msg="${esc(m.messageId)}">${showSubject ? subjectButton(parsed.anchor) : ''}<div class="bubble">${esc(parsed.text)}</div>${parsed.newStack ? `<span class="msg-state">${icon('i-stack')}Sent with ${esc(parsed.newStack.split(':')[0])}’s summary</span>` : ''}</div>`;
  }
  const who = speaker?.name || 'Airstrip team';
  const badge = speaker?.kind === 'ai' ? '<span class="badge is-ai">AI</span>' : speaker?.kind === 'person' ? '<span class="badge is-person">Team</span>' : '';
  const time = m.sentAt ? new Date(m.sentAt.replace(/(\.\d{3})\d+/, '$1')) : null;
  const when = time && !Number.isNaN(time.getTime()) ? `<time datetime="${time.toISOString()}">${pad(time.getHours())}:${pad(time.getMinutes())}</time>` : '';
  let body;
  if (m.type === 'link-card') {
    const card = parseCard(m.body);
    const url = safeUrl(card.url);
    if (!url) return '';
    body = `<a class="link-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-link-card="${esc(m.messageId)}"><strong>${esc(card.title || url)}</strong>${card.description ? `<span>${esc(card.description)}</span>` : ''}<span class="url">${icon('i-external')}${esc(url)}</span></a>`;
  } else {
    body = `<div class="msg-body">${chat.formatReply(m.body, resolveRef)}</div>`;
  }
  return `<div class="msg msg-reply" data-msg="${esc(m.messageId)}">${avatar({ name: who, avatar: speaker?.avatar ?? '' }).replace('class="avatar"', 'class="avatar is-small"')}<div><div class="msg-meta"><span>${esc(who)}</span>${badge}${when}</div>${body}</div></div>`;
}

// The foot: banners, the follow-up form, the notice, the composer and attribution.
let composer = null;
function renderFoot(threads, dueKey) {
  const s = convo;
  const canCompose = ['available', 'active', 'loading'].includes(s.phase);
  if (!composer) composer = buildComposer();
  const banners = [];
  if (s.phase === 'active' && ['connect', 'paused', 'refresh'].includes(s.error)) {
    banners.push(`<div class="banner is-warn">${icon('i-warn')}<span>${esc(chat.ERRORS[s.error])}</span><button type="button" data-retry>Reconnect</button></div>`);
  } else if (s.error === 'end') {
    banners.push(`<div class="banner is-error">${icon('i-error')}<span>${esc(chat.ERRORS.end)}</span></div>`);
  } else if (s.error === 'start' && s.phase === 'available') {
    banners.push(`<div class="banner is-error">${icon('i-error')}<span>${esc(chat.ERRORS.start)}</span></div>`);
  }
  const blocked = sendBlocked(dueKey);
  if (blocked) {
    const other = subjectInfo(threads.get(dueKey)?.anchor ?? chat.parseMessage(s.pending?.body ?? '').anchor);
    banners.push(`<div class="banner">${spinner}<span>Waiting for the answer about <strong>${esc(other.label)}</strong>. Ask here once it arrives.</span><button type="button" data-view-go="${esc(dueKey)}">Show it</button></div>`);
  }
  const followup = s.followupOffered && s.phase === 'active'
    ? `<div class="followup"><p>Nobody could answer live. Leave your email and the team will follow up about this conversation.</p>
        <form data-followup><label class="sr-only" for="followup-email">Your email</label><input id="followup-email" type="email" autocomplete="email" required placeholder="you@company.com"><button type="submit" class="btn btn-dark btn-sm"${s.busy ? ' disabled' : ''}>Send</button></form>
        ${s.error === 'email' || s.error === 'offer' ? `<p class="followup-error" role="alert">${esc(chat.ERRORS[s.error])}</p>` : ''}</div>` : '';
  const notice = s.notice ? `<p class="notice">${esc(s.notice)}</p>` : '';
  const powered = safeUrl(s.poweredByUrl);
  const meta = `<p class="convo-meta"><span>${['active', 'available', 'ended'].includes(s.phase) ? `Real conversation · ${s.host.kind === 'rep' ? 'a person' : 'AI Stand-in'} via Stand` : ''}</span>${powered ? `<a href="${esc(powered)}" target="_blank" rel="noopener noreferrer" data-powered>Powered by Stand</a>` : ''}</p>`;

  const top = el.convoFoot.querySelector('[data-foot-top]') ?? Object.assign(document.createElement('div'), { className: 'foot-top' });
  top.dataset.footTop = '';
  top.innerHTML = banners.join('') + followup + notice;
  top.hidden = !top.innerHTML;
  if (!top.isConnected) el.convoFoot.prepend(top);
  if (!composer.isConnected) el.convoFoot.append(composer);
  const metaNode = el.convoFoot.querySelector('.convo-meta');
  if (metaNode) metaNode.outerHTML = meta;
  else el.convoFoot.insertAdjacentHTML('beforeend', meta);

  composer.hidden = !canCompose;
  const info = subjectInfo(page.subject);
  $('[data-subject]', composer).innerHTML = `<span>About</span><span class="subject-chip" title="${esc(info.title)}">${info.icon}<span>${esc(info.label)}</span>${page.subject.kind !== 'stack' ? `<button type="button" data-subject-clear aria-label="Ask about the whole stack instead">${icon('i-close')}</button>` : ''}</span>`;
  const box = $('textarea', composer);
  if (box.value !== s.draft && document.activeElement !== box) box.value = s.draft;
  box.placeholder = s.phase === 'loading' ? (s.messages.length ? 'Reconnecting…' : 'Checking who can answer…') : page.subject.kind === 'stack' ? 'Ask about your stack…' : page.subject.kind === 'finding' ? `Ask about ${page.subject.id}…` : 'Ask about this line…';
  box.disabled = s.phase === 'loading';
  autosize(box);
  const waiting = Boolean(s.pending) && !(s.error === 'send' && !s.busy);
  $('.send', composer).disabled = !box.value.trim() || s.busy || waiting || blocked || !['available', 'active'].includes(s.phase);
}

function buildComposer() {
  const form = document.createElement('form');
  form.className = 'composer';
  form.dataset.composer = '';
  form.innerHTML = `<div class="composer-subject" data-subject></div>
    <div class="composer-row">
      <label class="sr-only" for="question">Your question</label>
      <textarea id="question" rows="1" enterkeyhint="send" autocomplete="off"></textarea>
      <button type="submit" class="send" aria-label="Send">${icon('i-send')}</button>
    </div>`;
  const box = $('textarea', form);
  box.addEventListener('input', () => {
    client.setDraft(box.value); // Re-renders through the subscription.
    client.typing(Boolean(box.value.trim()));
    autosize(box);
  });
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('.send', form).disabled) void ask(box.value);
  });
  return form;
}

function autosize(box) {
  box.style.height = 'auto';
  box.style.height = `${Math.min(140, box.scrollHeight)}px`;
}

/** Sends a question about the current subject. The first one starts the conversation. */
async function ask(text) {
  const question = String(text).trim();
  if (!question || convo.busy || sendBlocked() || !['available', 'active'].includes(convo.phase)) return;
  if (convo.pending && !(convo.error === 'send' && !convo.busy)) return;
  const a = page.analysis;
  const d = page.deployment;
  const first = convo.phase === 'available';
  const introduced = introducedStack();
  const newStack = !first && introduced && introduced !== a.name ? chat.stackLine(a, d) : '';
  const body = chat.composeMessage(page.subject, question, newStack);
  if (first) {
    page.promptStack = a.name;
    save();
  }
  page.view = chat.anchorKey(page.subject);
  const box = $('textarea', composer);
  box.value = '';
  client.setDraft('');
  autosize(box);
  const ok = await client.send(body, first ? { prompt: chat.buildPrompt(a, d), analyticsId: 'will-it-deploy' } : {});
  if (!ok && first && convo.phase !== 'active') {
    page.promptStack = '';
    save();
  }
  // Refused before anything was sent (a failed send stays as "Not delivered"): the question comes back.
  if (!ok && !convo.pending && !convo.draft.includes(question)) client.setDraft(question);
}

/** While an answer is due in one thread, another thread waits. People on the team may still answer out of order. */
function sendBlocked(dueKey = replyDueKey(chat.threadsOf(convo.messages, convo.pending).byMessage)) {
  return Boolean(dueKey) && dueKey !== chat.anchorKey(page.subject) && convo.phase === 'active';
}

function introducedStack() {
  const base = page.promptStack || promptStackFromTranscript();
  return chat.lastIntroducedStack(convo.messages, base);
}

// Without our saved state, the echoed prompt still says which stack it described.
function promptStackFromTranscript() {
  const prompt = convo.messages.find((m) => m.type === 'system-prompt' || m.senderType === 'system-prompt');
  return prompt?.body.match(/\nStack, ([^:]+):/)?.[1] ?? '';
}

function contextText(newStack) {
  const a = page.analysis;
  const d = page.deployment;
  if (newStack) return `[New stack: ${chat.stackLine(a, d)}]`;
  const sent = convo.messages.find((m) => m.type === 'system-prompt' || m.senderType === 'system-prompt');
  return sent?.body ?? chat.buildPrompt(a, d);
}

function renderLivePrompt() {
  if (!el.livePrompt || !page.analysis) return;
  const text = chat.buildPrompt(page.analysis, page.deployment);
  const next = chat.composeMessage(page.subject, '…');
  el.livePrompt.textContent = `${text}\n\n— ${text.length} of ${chat.PROMPT_LIMIT} characters. The next question would start with: ${next.replace(/ …$/, '')}`;
}

function announce(text) {
  el.announce.textContent = '';
  setTimeout(() => (el.announce.textContent = text), 60);
}

// New replies, read out whole: never on restore, only as they arrive.
const heard = new Set();
let heardReady = false;
function announceReplies() {
  const replies = convo.messages.filter((m) => isConversation(m) && m.senderType !== 'visitor');
  if (!heardReady) {
    for (const m of replies) heard.add(m.messageId);
    if (convo.phase !== 'loading') heardReady = true;
    return;
  }
  for (const m of replies) {
    if (heard.has(m.messageId)) continue;
    heard.add(m.messageId);
    const name = convo.host.name || 'Airstrip team';
    const text = m.type === 'link-card' ? `shared a link: ${parseCard(m.body).title || parseCard(m.body).url || ''}` : `replied: ${chat.plainReply(m.body)}`;
    announce(`${name} ${text}`);
  }
}

function closeMenu() {
  el.menu.hidden = true;
  el.menuButton.setAttribute('aria-expanded', 'false');
}

// --- Events -----------------------------------------------------------------------------

function wire() {
  el.samples.addEventListener('click', (event) => {
    const b = event.target.closest('[data-sample]');
    if (b) load(sampleText(b.dataset.sample), { kind: 'sample', id: b.dataset.sample });
  });
  $('[data-paste]').addEventListener('click', () => void pasteFromClipboard());
  $('[data-file]').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) readFile(file);
  });
  el.editToggle.addEventListener('click', () => (el.editor.hidden ? openEditor() : closeEditor()));
  $('[data-deploy-text]').addEventListener('click', () => {
    if (load(el.text.value, { kind: 'yours', label: 'package.json' })) closeEditor();
  });
  el.text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('[data-deploy-text]').click();
  });
  $('[data-redeploy]').addEventListener('click', () => {
    page.startedAt = Date.now();
    save();
    buildLog();
    if (reduced.matches) finishPlayback();
    else startPlayback();
  });
  $('[data-ask-stack]').addEventListener('click', (event) => openPanel(chat.STACK, { from: event.currentTarget }));
  for (const b of $$('[data-ask-plan]')) b.addEventListener('click', (event) => openPanel(chat.STACK, { from: event.currentTarget, question: `Would ${b.dataset.askPlan} make sense for this stack?` }));
  for (const a of $$('[data-start]')) a.addEventListener('click', () => setTimeout(() => $('[data-paste]').focus({ preventScroll: true }), reduced.matches ? 0 : 500));

  // Paste anywhere, drop anywhere.
  document.addEventListener('paste', (event) => {
    if (event.target.closest?.('textarea, input, [contenteditable="true"]')) return;
    const text = event.clipboardData?.getData('text/plain');
    if (!looksLikePackageJson(text)) return;
    event.preventDefault();
    if (load(text, { kind: 'yours', label: 'package.json' })) {
      el.console.scrollIntoView({ behavior: smooth(), block: 'start' });
      announce('Pasted package.json. Deploying it.');
    }
  });
  let dragDepth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    dragDepth++;
    el.console.classList.add('is-dragging');
  });
  document.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.console.classList.remove('is-dragging');
  });
  document.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    el.console.classList.remove('is-dragging');
    const file = event.dataTransfer.files?.[0];
    if (file) readFile(file);
  });

  // The log: phases fold, lines and phases can be asked about.
  el.phases.addEventListener('click', (event) => {
    const head = event.target.closest('.phase-head');
    if (head) {
      const name = head.closest('.phase').dataset.phase;
      phaseOpen.set(name, !(phaseOpen.get(name) ?? true));
      renderPhaseHeads();
      return;
    }
    const lineAsk = event.target.closest('[data-ask-line]');
    if (lineAsk) {
      const line = lineByNumber(lineAsk.dataset.askLine);
      setActiveAsk(lineAsk);
      if (line) openPanel(logAnchor(line), { from: lineAsk });
      return;
    }
    const phaseAsk = event.target.closest('[data-ask-phase]');
    if (phaseAsk) {
      setActiveAsk(phaseAsk);
      openPanel({ kind: 'log', phase: phaseAsk.dataset.askPhase, text: '' }, { from: phaseAsk });
      return;
    }
    // Touch: a tap selects a line and shows its Ask.
    const li = event.target.closest('.log-line');
    if (li) {
      for (const other of $$('.log-line.is-selected', el.phases)) if (other !== li) other.classList.remove('is-selected');
      li.classList.toggle('is-selected');
      const b = $('.ask', li);
      if (b) setActiveAsk(b);
    }
  });
  el.phases.addEventListener('focusin', (event) => {
    if (event.target.matches('.ask')) setActiveAsk(event.target);
  });
  el.phases.addEventListener('keydown', (event) => {
    if (!event.target.matches('.ask')) return;
    const asks = visibleAsks();
    const i = asks.indexOf(event.target);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: asks.length - 1 }[event.key];
    if (to === undefined || !asks[to]) return;
    event.preventDefault();
    setActiveAsk(asks[to]);
    asks[to].focus();
  });
  for (const b of $$('[data-log-filter]')) b.addEventListener('click', () => setLogFilter(b.dataset.logFilter));

  // Findings: filter, expand, ask, copy, jump to log lines.
  el.findingFilters.addEventListener('click', (event) => {
    const b = event.target.closest('[data-finding-filter]');
    if (!b) return;
    page.findingFilter = b.dataset.findingFilter;
    renderFindings();
  });
  el.findings.addEventListener('click', async (event) => {
    const ask = event.target.closest('[data-ask-finding]');
    if (ask) return openPanel({ kind: 'finding', id: ask.dataset.askFinding }, { from: ask });
    const main = event.target.closest('.finding-main');
    if (main) {
      const id = main.closest('.finding').dataset.finding;
      page.openFinding = page.openFinding === id ? '' : id;
      const item = main.closest('.finding');
      item.classList.toggle('is-open', page.openFinding === id);
      main.setAttribute('aria-expanded', String(page.openFinding === id));
      $('.finding-detail', item).hidden = page.openFinding !== id;
      for (const other of $$('.finding.is-open', el.findings)) {
        if (other !== item) {
          other.classList.remove('is-open');
          $('.finding-main', other).setAttribute('aria-expanded', 'false');
          $('.finding-detail', other).hidden = true;
        }
      }
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        copy.innerHTML = icon('i-check');
      } catch {
        getSelection().selectAllChildren(copy.previousElementSibling);
      }
      setTimeout(() => (copy.innerHTML = icon('i-copy')), 1400);
      return;
    }
    const goto = event.target.closest('[data-goto-line]');
    if (goto) showLine(Number(goto.dataset.gotoLine));
  });

  // The panel.
  el.convo.addEventListener('click', (event) => {
    const t = event.target;
    if (t.closest('[data-close]')) return closePanel();
    if (t.closest('[data-menu-button]')) {
      const open = el.menu.hidden;
      el.menu.hidden = !open;
      el.menuButton.setAttribute('aria-expanded', String(open));
      $('[data-end]', el.menu).disabled = convo.phase !== 'active';
      if (open) $('[data-end]', el.menu).focus();
      return;
    }
    if (t.closest('[data-end]')) {
      closeMenu();
      void client.end();
      el.convoTitle.focus();
      return;
    }
    const tab = t.closest('[data-view]');
    if (tab) {
      page.view = tab.dataset.view;
      if (page.view !== 'all') {
        const { threads } = chat.threadsOf(convo.messages, convo.pending);
        page.subject = threads.get(page.view)?.anchor ?? page.subject;
      }
      save();
      page.stuck = false;
      renderConvo();
      return;
    }
    const go = t.closest('[data-view-go]');
    if (go) {
      page.view = go.dataset.viewGo;
      const { threads } = chat.threadsOf(convo.messages, convo.pending);
      page.subject = threads.get(page.view)?.anchor ?? chat.parseMessage(convo.pending?.body ?? '').anchor;
      save();
      renderConvo();
      return;
    }
    const suggestion = t.closest('[data-suggest]');
    if (suggestion) return void ask(suggestion.dataset.suggest);
    const ref = t.closest('[data-ref]');
    if (ref) return goTo(ref.dataset.ref);
    const subject = t.closest('[data-goto-subject]');
    if (subject) {
      const key = subject.dataset.gotoSubject;
      if (key.startsWith('finding:')) return goTo(key);
      if (key.startsWith('log:')) {
        const [, phase, ...text] = key.split(':');
        const line = page.deployment.lines.find((l) => l.phase === phase && chat.sameLogText(text.join(':'), l.text));
        return goTo(line ? `line:${line.n}` : `phase:${phase}`);
      }
      return;
    }
    if (t.closest('[data-subject-clear]')) {
      page.subject = chat.STACK;
      page.view = 'stack';
      save();
      renderConvo();
      $('textarea', composer)?.focus();
      return;
    }
    if (t.closest('[data-context-toggle]')) {
      page.contextOpen = !page.contextOpen;
      renderConvo();
      $('[data-context-toggle]', el.convo)?.focus();
      return;
    }
    if (t.closest('[data-retry]')) return void client.retry();
    if (t.closest('[data-retry-send]')) return void client.send();
    if (t.closest('[data-new-chat]')) {
      page.promptStack = '';
      page.seen = {};
      page.lastSeen = 0;
      save();
      return void client.newChat();
    }
    const link = t.closest('[data-link-card]');
    if (link) client.trackLinkClick(link.dataset.linkCard, link.href);
    if (t.closest('[data-powered]')) client.trackAttributionClick();
  });
  el.convo.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-followup]');
    if (!form) return;
    event.preventDefault();
    void client.submitEmail($('input', form).value);
  });
  el.convo.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!el.menu.hidden) {
        closeMenu();
        el.menuButton.focus();
      } else {
        closePanel();
      }
      event.stopPropagation();
    }
    // Keyboard focus stays in the drawer or sheet while it's modal.
    if (event.key === 'Tab' && !docked.matches) {
      const focusable = $$('button, a[href], textarea, input, [tabindex="0"]', el.convo).filter((n) => !n.disabled && n.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener('click', (event) => {
    if (!el.menu.hidden && !event.target.closest('.menu-wrap')) closeMenu();
  });
  el.scrim.addEventListener('click', () => closePanel());
  el.toggle.addEventListener('click', () => openPanel(null, { from: el.toggle }));
  el.pill.addEventListener('click', () => openPanel(null, { from: el.pill }));
  docked.addEventListener('change', () => placePanel());
  swipeToClose();
  document.addEventListener('visibilitychange', () => renderConvo());
}

// Phones: drag the sheet down by its top to put it away.
function swipeToClose() {
  const grip = el.convo;
  let start = null;
  grip.addEventListener('pointerdown', (event) => {
    if (docked.matches || matchMedia('(min-width: 700px)').matches) return;
    if (!event.target.closest('.convo-grip, .convo-title-row') || event.target.closest('button, a')) return;
    start = { y: event.clientY, id: event.pointerId };
    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener('pointermove', (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dy = Math.max(0, event.clientY - start.y);
    grip.style.transform = `translateY(${dy}px)`;
  });
  const end = (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dy = event.clientY - start.y;
    start = null;
    grip.style.transform = '';
    if (dy > 90) closePanel();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function setLogFilter(filter) {
  page.logFilter = filter;
  for (const b of $$('[data-log-filter]')) b.setAttribute('aria-pressed', String(b.dataset.logFilter === filter));
  for (const li of $$('.log-line', el.phases)) li.hidden = filter === 'warn' && !li.matches('.is-warn, .is-error');
  if (filter === 'warn') for (const p of page.deployment.phases) if (p.warnings || p.status === 'error') phaseOpen.set(p.name, true);
  renderPhaseHeads();
}

async function readFile(file) {
  if (file.size > 200_000) return showSourceError('That file is over 200 KB. A package.json is usually a few KB.');
  try {
    const text = await file.text();
    if (load(text, { kind: 'yours', label: file.name === 'package.json' ? 'package.json' : file.name })) announce(`Deploying ${file.name}.`);
  } catch {
    showSourceError('Couldn’t read that file.');
  }
}

// --- Start -------------------------------------------------------------------------------

// The docked panel is as tall as the deployment beside it, or the viewport.
function watchSizes() {
  const main = $('.console-main');
  const clip = () => el.samples.classList.toggle('is-clipped', el.samples.scrollWidth > el.samples.clientWidth + 2 && el.samples.scrollLeft + el.samples.clientWidth < el.samples.scrollWidth - 2);
  new ResizeObserver(() => {
    el.body.style.setProperty('--main-h', `${Math.round(main.getBoundingClientRect().height)}px`);
    clip();
  }).observe(main);
  el.samples.addEventListener('scroll', clip, { passive: true });
}

function start() {
  renderSamples();
  watchSizes();
  wire();
  drawArt(region);

  client.subscribe((state) => {
    convo = state;
    announceReplies();
    renderConvo();
  });
  client.mount(); // Discovery or recovery. Nothing is created until the visitor sends.

  const saved = restore();
  if (saved) {
    page.panelOpen = Boolean(saved.panelOpen);
    page.view = typeof saved.view === 'string' ? saved.view : 'all';
    page.subject = saved.subject && typeof saved.subject === 'object' && ['finding', 'log', 'stack'].includes(saved.subject.kind) ? saved.subject : chat.STACK;
    page.promptStack = typeof saved.promptStack === 'string' ? saved.promptStack : '';
    page.seen = saved.seen && typeof saved.seen === 'object' ? saved.seen : {};
    page.lastSeen = Number(saved.lastSeen) || 0;
  }
  const restored = saved?.text && load(saved.text, saved.source ?? { kind: 'yours' }, { play: false, startedAt: Number(saved.startedAt) || Date.now() });
  if (!restored) {
    // First visit: the sample deploys when the console comes into view.
    load(sampleText(DEFAULT_SAMPLE), { kind: 'sample', id: DEFAULT_SAMPLE }, { play: false });
    page.playing = true;
    page.shown = 0;
    renderLogLines();
    renderCard();
    const go = () => (reduced.matches ? finishPlayback() : startPlayback());
    if (matchMedia('(min-width: 1000px)').matches) {
      go(); // On wide screens the console is always in the first view.
    } else {
      // On phones it starts when the card scrolls into view, so it's seen streaming.
      const io = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        go();
      }, { threshold: 0.25 });
      io.observe(el.console.querySelector('.card'));
    }
  }
  renderConvo();
  placePanel();
  // The page starts with scroll anchoring off, so a scroll made while it loads stays put
  // (the social image is captured that way). Once it has settled, anchoring helps visitors.
  addEventListener('load', () => setTimeout(() => document.documentElement.style.removeProperty('overflow-anchor'), 1500), { once: true });
}

// --- Helpers ------------------------------------------------------------------------------

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

start();
