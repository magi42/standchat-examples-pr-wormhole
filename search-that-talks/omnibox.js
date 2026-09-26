// The omnibox: one box that searches the app directory and, when search has
// nothing to offer, turns into the conversation. It renders the Stand
// client's state (stand-visitor.js) and the conversation model
// (conversation.js); it never talks to the network itself.
//
// Views, all inside the same box:
//   idle     popular apps, categories, things to try
//   results  apps as you type; "Ask: …" on top when the query is a question
//   starter  "No Acme ERP yet": what the question will carry, and an Ask button
//   app      an app's triggers, actions and flows, with "Missing something? Ask"
//   chat     the conversation, newest exchange first, right under the box

import { APP_BY_ID, CATEGORIES, CATEGORY_BY_ID, FLOWS, POPULAR } from './catalog.js';
import { search, isQuestion, mentionedApps, normalize, inCategory, byLetter } from './search.js';
import { buildPrefix, parsePrefix, toExchanges, references, formatReply, plainText, lastSentStack, linkCard, safeUrl, clean } from './conversation.js';
import { resolveFlow, pairFlow, flowSentence, flowIcons, FlowEditor } from './flows.js';
import { appIcon, glyph } from './icons.js';
import { html, raw, setHTML, reducedMotion } from './dom.js';
import { stack } from './stack.js';
import { PROMPT } from './prompt.js';
import { parseCard } from './stand-visitor.js';

const EXAMPLE = 'Acme ERP';
const VISIBLE_EXCHANGES = 2; // older ones fold under "Earlier in this conversation"
const APPS_BY_NAME = new Map([...APP_BY_ID.values()].map((a) => [a.name, a]));

// Error codes from the client, in the directory's voice, with the button that helps.
const ERRORS = {
  connect: ['We can’t reach the team right now.', 'retry'],
  start: ['That didn’t go through, so no conversation started. Your text is back in the box.', null],
  uncertain: ['We couldn’t confirm whether your first message started a conversation. To be safe, start a new one. Your text is kept.', 'new'],
  send: ['Not delivered.', 'resend'],
  lost: ['The conversation ended before your last message arrived. Its text is kept, so you can copy it.', 'new'],
  gone: ['This conversation isn’t available anymore.', 'new'],
  paused: ['Connection paused. Replies show up once you reconnect.', 'retry'],
  refresh: ['Couldn’t refresh replies. Reconnecting…', null],
  end: ['Couldn’t end the conversation. Try again.', 'end'],
  email: ['Couldn’t send your email. Check it and try again.', null],
  offer: ['That offer changed. Reconnect to see the latest.', 'retry'],
};

export function createOmnibox(root, { client, onOpenFlow = () => {} }) {
  const input = root.querySelector('.omni-input');
  const field = root.querySelector('.omni-field');
  const body = root.querySelector('.omni-body');
  const inner = root.querySelector('.omni-inner');
  const tray = root.querySelector('.omni-stack');
  const token = root.querySelector('.omni-token');
  const example = root.querySelector('.omni-example');
  const clearButton = root.querySelector('.omni-clear');
  const askButton = root.querySelector('.omni-ask');
  const kbd = root.querySelector('.omni-kbd');
  const noticeBar = root.querySelector('.omni-noticebar');
  const live = document.getElementById('omni-live');
  const status = document.getElementById('omni-status');

  // The client calls back synchronously from mount(), so it's subscribed and
  // mounted at the end, once all of this state exists.
  let snapshot = client.getSnapshot();
  let unsubscribe = () => {};
  let release = () => {};

  let query = '';
  let category = null; // a category chip
  let letter = null; // the footer's A–Z
  let appId = null; // the app card on show
  let ask = null; // what an ask is about: { kind: 'nomatch', term, closest } | { kind: 'app', app } | { kind: 'flow', flow }
  let recentMiss = null; // the last search with no match, for a question that names it later
  let settled = false; // a query with no match sat still long enough to become a question
  let settleTimer;
  let statusTimer;
  let options = []; // the listbox, as rendered
  let active = 0;
  let view = '';
  let demo = null; // the example search, while it shows
  let confirmEnd = false;
  let earlierOpen = false;
  let appliedDraft = '';
  let primed = false; // replies present at load are not read out
  let wasOnline = false; // "Reconnecting…" only makes sense after a first connection
  let offlineSince = 0; // connection blips shorter than a moment aren't worth a word
  let offlineTimer;
  const expanded = new Map(loadOpenFlows().map((key) => [key, null])); // flow cards opened with "Try this flow": key -> FlowEditor
  const exchangeCache = new Map(); // exchange key -> { sig, el }
  const seen = new Set(); // exchanges and replies already shown: only new ones animate in
  let seenPrimed = false;
  const announced = new Set();
  let firstRender = true;

  // Input ------------------------------------------------------------------

  input.addEventListener('input', () => {
    endDemo();
    setQuery(input.value, { fromInput: true });
    if (inChat()) {
      client.setDraft(input.value);
      if (input.value.trim()) client.typing(true);
    } else {
      client.setDraft(input.value.trim() ? draftPrefix() + input.value : '');
    }
  });

  input.addEventListener('focus', () => {
    if (demo) input.select();
    root.classList.add('is-focused');
  });
  input.addEventListener('blur', () => root.classList.remove('is-focused'));

  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      enter();
    } else if (event.key === 'Escape') {
      if (appId) {
        event.preventDefault();
        closeApp();
      } else if (!inChat() && (query || ask || category || letter)) {
        event.preventDefault();
        reset();
      } else if (inChat() && query) {
        event.preventDefault();
        setQuery('');
        client.setDraft('');
      }
    } else if (event.key === 'Backspace' && !input.value && ask && ask.kind !== 'nomatch') {
      ask = null; // Backspace in an empty box removes the "about" token, like a search chip.
      client.setDraft('');
      render();
    }
  });

  clearButton.addEventListener('click', () => {
    reset();
    input.focus();
  });
  askButton.addEventListener('click', () => submit());

  function setQuery(value, { fromInput = false } = {}) {
    query = value;
    if (!fromInput) input.value = value;
    letter = null;
    if (ask?.kind === 'nomatch' && !normalize(value).includes(normalize(ask.term))) ask = null;
    settled = false;
    clearTimeout(settleTimer);
    // Results change as you type; "no match" waits for a pause, so a half-typed
    // name doesn't flash a question at you.
    if (!inChat() && normalize(value).length > 2 && !search(value).good && !isQuestion(value)) {
      settleTimer = setTimeout(() => {
        settled = true;
        render();
      }, reducedMotion() ? 0 : 450);
    }
    active = 0;
    render();
  }

  function reset() {
    endDemo();
    ask = null;
    category = null;
    letter = null;
    appId = null;
    client.setDraft('');
    setQuery('');
  }

  function enter() {
    const option = options[active];
    if (option) return activate(option);
    if (view === 'starter' || view === 'chat') submit();
  }

  // What the draft keeps about an ask, so a reload can put the token back.
  function draftPrefix() {
    if (ask?.kind === 'nomatch') return buildPrefix({ search: ask.term, noMatch: true });
    if (ask?.kind === 'app') return buildPrefix({ app: ask.app.name });
    if (ask?.kind === 'flow') return buildPrefix({ flow: ask.flow.name });
    return '';
  }

  // Asking -----------------------------------------------------------------

  // The context a message carries: where it was asked from, and the stack when
  // it changed since the team last heard about it.
  function messageContext(text, searchTerm) {
    const context = {};
    if (ask?.kind === 'nomatch') {
      Object.assign(context, { search: ask.term, noMatch: true, closest: ask.closest.map((a) => a.name) });
    } else if (ask?.kind === 'app') {
      Object.assign(context, { app: ask.app.name, triggers: ask.app.triggers.map((t) => t.name), actions: ask.app.actions, missing: true });
    } else if (ask?.kind === 'flow') {
      const f = ask.flow;
      Object.assign(context, { flow: f.name, steps: `${f.trigger.event} in ${f.trigger.app.name} → ${f.action.event} in ${f.action.app.name}` });
    } else if (recentMiss && normalize(text).includes(normalize(recentMiss.term))) {
      // Searched "Acme ERP", found nothing, then asked about it in a sentence.
      Object.assign(context, { search: recentMiss.term, noMatch: true, closest: recentMiss.closest.map((a) => a.name) });
    } else if (searchTerm && normalize(searchTerm) !== normalize(text)) {
      context.search = searchTerm;
    }
    const current = stack.apps.map((a) => a.name);
    const sent = lastSentStack(snapshot.messages, snapshot.pending);
    if (current.join('|') !== sent.join('|')) context.stack = current;
    return context;
  }

  async function submit({ searchTerm = '' } = {}) {
    const text = input.value.trim();
    if (!text || snapshot.busy) return;
    if (snapshot.pending && !snapshot.pending.creating) return; // the undelivered one goes first
    endDemo();
    if (snapshot.phase === 'ended' && !snapshot.pending) {
      // "Ask in a new conversation": look again, then send. Old text is never replayed.
      await client.newChat();
      snapshot = client.getSnapshot();
    }
    if (!['available', 'active'].includes(snapshot.phase)) return render();
    const first = snapshot.phase === 'available';
    const bodyText = buildPrefix(messageContext(text, searchTerm)) + text;
    ask = null;
    recentMiss = null;
    appId = null;
    category = null;
    letter = null;
    query = '';
    input.value = '';
    appliedDraft = '';
    client.setDraft('');
    render();
    if (first) root.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    const sent = await client.send(bodyText, first ? { prompt: PROMPT, analyticsId: 'search-that-talks' } : {});
    if (sent && first) client.setDraft('');
    input.focus({ preventScroll: true });
  }

  function askAbout(target) {
    endDemo();
    appId = null;
    category = null;
    letter = null;
    if (target.app) ask = { kind: 'app', app: target.app };
    else if (target.flow) ask = { kind: 'flow', flow: target.flow };
    setQuery('');
    client.setDraft('');
    focusBox();
  }

  // Options ------------------------------------------------------------------

  function activate(option) {
    if (option.disabled) return;
    if (option.type === 'app') openApp(option.app.id);
    else if (option.type === 'ask' || option.type === 'send') submit();
  }

  function setActive(index) {
    if (!options.length) return;
    active = (index + options.length) % options.length;
    const list = inner.querySelector('[role="listbox"]');
    list?.querySelectorAll('[role="option"]').forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    const current = list?.querySelector(`#omni-opt-${active}`);
    input.setAttribute('aria-activedescendant', current ? current.id : '');
    current?.scrollIntoView({ block: 'nearest' });
    if (view === 'results') renderField(); // the Ask pill follows the "Ask:" row
  }

  function openApp(id) {
    endDemo();
    appId = id;
    render();
    inner.querySelector('.app-card')?.focus({ preventScroll: true });
  }

  function closeApp() {
    appId = null;
    render();
    input.focus({ preventScroll: true });
  }

  function focusBox() {
    root.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    input.focus({ preventScroll: true });
  }

  // State ----------------------------------------------------------------------

  function onState(state) {
    const before = snapshot;
    snapshot = state;
    if (state.connection === 'online') {
      wasOnline = true;
      offlineSince = 0;
    } else if (state.phase === 'active' && !offlineSince) {
      offlineSince = Date.now();
      clearTimeout(offlineTimer);
      offlineTimer = setTimeout(render, 1600);
    }
    if (state.phase !== 'active' && state.phase !== 'loading') wasOnline = false;
    // Text the client handed back (a failed start, "Start a new conversation")
    // goes back in the box, with its "about" token.
    if (state.draft && state.draft !== before.draft && state.draft !== appliedDraft && !input.value.trim()) applyDraft(state.draft);
    if (before.phase === 'ended' && state.phase !== 'ended' && !state.messages.length) {
      expanded.clear();
      saveOpenFlows([]);
      exchangeCache.clear();
      earlierOpen = false;
    }
    // Typing only changes the draft: nothing to redraw.
    if (Object.keys(state).every((k) => k === 'draft' || state[k] === before[k])) return;
    render();
  }

  function applyDraft(draft) {
    const { context, text } = parsePrefix(draft);
    appliedDraft = draft;
    if (context?.app && APPS_BY_NAME.has(context.app)) ask = { kind: 'app', app: APPS_BY_NAME.get(context.app) };
    else if (context?.flow) {
      const template = FLOWS.find((f) => f.name === context.flow);
      if (template) ask = { kind: 'flow', flow: resolveFlow(template, { stack: stack.ids }) };
    } else if (context?.search && context.noMatch) {
      ask = { kind: 'nomatch', term: context.search, closest: (context.closest ?? []).map((n) => APPS_BY_NAME.get(n)).filter(Boolean) };
      settled = true;
    }
    query = text;
    input.value = text;
  }

  const hasTranscript = () => Boolean(snapshot.pending) || snapshot.messages.some((m) => m.senderType === 'visitor');
  const inChat = () => hasTranscript() && ['active', 'uncertain', 'loading'].includes(snapshot.phase);
  const canAsk = () => snapshot.phase === 'available' || snapshot.phase === 'active' || (snapshot.phase === 'ended' && !snapshot.pending);

  function currentView() {
    if (appId) return 'app';
    if (inChat() || (hasTranscript() && snapshot.phase === 'ended' && !query.trim() && !ask && !category && !letter)) return 'chat';
    if (ask) return 'starter';
    const q = query.trim();
    if (demo?.running || (!q && !category && !letter)) return 'idle'; // the example is still typing
    if (!q) return 'results';
    if (isQuestion(q)) return mentionedApps(q).length ? 'results' : 'starter'; // a question, with apps it names
    const result = search(q); // "no match" means nowhere in the directory, whatever the filter
    if (!result.good && normalize(q).length > 2 && settled) return 'starter';
    return 'results';
  }

  // Rendering ------------------------------------------------------------------

  function render() {
    let next = currentView();
    // A search with nothing to show becomes a question about that search.
    if (next === 'starter' && !ask && !isQuestion(query)) {
      const q = query.trim();
      ask = { kind: 'nomatch', term: clean(q, 60), closest: search(q).closest };
      if (!demo) recentMiss = ask;
    }
    next = currentView();
    const changed = next !== view;
    const from = body.offsetHeight;
    view = next;
    root.dataset.view = view;
    options = [];

    if (view === 'chat') renderChat(changed);
    else {
      exchangeCache.clear();
      const markup = view === 'idle' ? idleView() : view === 'results' ? resultsView() : view === 'starter' ? starterView() : appView(APP_BY_ID.get(appId));
      setHTML(inner, markup);
    }
    renderField();
    renderTray();
    input.setAttribute('aria-expanded', String(options.length > 0));
    if (options.length) setActive(Math.min(active, options.length - 1));
    else input.removeAttribute('aria-activedescendant');
    if (changed && !firstRender) animate(from);
    firstRender = false;
    root.dispatchEvent(new Event('omni:render'));
  }

  function animate(from) {
    const to = inner.offsetHeight;
    if (reducedMotion() || Math.abs(to - from) < 2) return;
    body.style.overflow = 'hidden';
    body.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' })
      .finished.finally(() => (body.style.overflow = ''));
    inner.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
  }

  function renderField() {
    const chat = view === 'chat';
    const tokenApp = ask?.kind === 'app' ? ask.app : null;
    const tokenFlow = ask?.kind === 'flow' ? ask.flow : null;
    token.hidden = !tokenApp && !tokenFlow;
    if (tokenApp) setHTML(token, html`${raw(appIcon(tokenApp, { size: 18, className: 'app-icon app-icon-xs' }))}<span>${tokenApp.name}</span><button type="button" class="omni-token-x" aria-label="Stop asking about ${tokenApp.name}">×</button>`);
    if (tokenFlow) setHTML(token, html`${flowIcons(tokenFlow, 18)}<span>This flow</span><button type="button" class="omni-token-x" aria-label="Stop asking about this flow">×</button>`);
    example.hidden = !demo;
    clearButton.hidden = chat || !(query || ask || category || letter);
    kbd.hidden = Boolean(query) || chat || Boolean(ask);
    // "Asking": Enter goes to the team, not to an app. The icon and the button say so.
    const asking = view === 'starter' || (chat && snapshot.phase !== 'ended') || (view === 'results' && options[active]?.type === 'ask');
    askButton.hidden = !asking;
    askButton.disabled = !input.value.trim() || snapshot.busy || !canAsk() || Boolean(snapshot.pending && !snapshot.pending.creating);
    askButton.querySelector('.omni-ask-label').textContent = chat ? 'Send' : 'Ask';
    input.placeholder = placeholder();
    input.setAttribute('aria-label', chat ? 'Reply, or search apps' : 'Search apps, or ask a question');
    input.enterKeyHint = asking ? 'send' : 'search';
    field.classList.toggle('is-asking', asking);
    // The site's sensitive-data notice sits right under the box while you write to the team.
    noticeBar.hidden = !(snapshot.notice && (view === 'chat' || view === 'starter'));
    noticeBar.textContent = snapshot.notice;
  }

  function placeholder() {
    if (view === 'chat') {
      if (snapshot.phase === 'ended') return 'Search apps, or ask in a new conversation';
      return snapshot.pending && !snapshot.pending.creating ? 'Retry the message below first' : 'Reply, or search apps…';
    }
    if (ask?.kind === 'app') return `What should ${ask.app.name} do?`;
    if (ask?.kind === 'flow') return 'What would you change, or check?';
    return 'Search 7,000+ apps, or ask anything';
  }

  // Idle: the directory's front page.
  function idleView() {
    return html`
      ${filters()}
      <p class="omni-label">Popular apps</p>
      <ul class="tile-grid">
        ${POPULAR.map((id) => APP_BY_ID.get(id)).map((app) => html`
          <li><button type="button" class="tile" data-open="${app.id}">${raw(appIcon(app, { size: 36 }))}<span>${app.name}</span></button></li>`)}
      </ul>
      <p class="omni-try"><span>Try</span>
        ${[EXAMPLE, 'How do I add a filter?', 'Formlane'].map((s) => html`<button type="button" class="try-chip" data-suggest="${s}">${s}</button>`)}</p>`;
  }

  function filters() {
    return html`
      <div class="omni-filters" role="group" aria-label="Filter by category">
        <button type="button" class="filter" data-category="" aria-pressed="${String(!category)}">All</button>
        ${CATEGORIES.map((c) => html`<button type="button" class="filter" data-category="${c.id}" aria-pressed="${String(category === c.id)}">${c.chip}</button>`)}
      </div>`;
  }

  function resultsView() {
    const q = query.trim();
    let apps;
    let label;
    let outside = '';
    const question = Boolean(q) && isQuestion(q);
    if (letter) {
      apps = byLetter(letter).map((app) => ({ app }));
      label = `Apps starting with ${letter}`;
    } else if (!q) {
      apps = inCategory(category).map((app) => ({ app }));
      label = CATEGORY_BY_ID.get(category).label;
    } else if (question) {
      apps = mentionedApps(q).slice(0, 3).map((app) => ({ app })); // the apps the question names
      label = 'Apps in your question';
    } else {
      apps = search(q, { category }).results;
      if (!apps.length && category) {
        // Nothing in this category: show the whole directory rather than a dead end.
        apps = search(q).results;
        outside = CATEGORY_BY_ID.get(category).label;
      }
      label = `Apps · ${apps.length}`;
    }
    const gate = askGate();
    if (question) options.push({ type: 'ask', disabled: Boolean(gate) });
    for (const a of apps) options.push({ type: 'app', app: a.app });
    announceSoon(q ? `${apps.length} ${apps.length === 1 ? 'app' : 'apps'}${question ? '. Press Enter to ask.' : '.'}` : '');
    const words = normalize(q).split(' ').filter(Boolean);
    let i = 0;
    return html`
      ${filters()}
      <ul class="omni-list" role="listbox" id="omni-list" aria-label="${question ? 'Ask, or pick an app' : label}">
        ${question ? html`<li class="omni-group" role="presentation">Ask</li>${askOption(i++, q, gate)}` : ''}
        ${apps.length ? html`<li class="omni-group" role="presentation">${outside ? `Not in ${outside}. From all apps` : label}</li>` : ''}
        ${apps.map(({ app, event }) => html`
          <li class="opt opt-app" role="option" id="omni-opt-${i}" data-option="${i++}" data-app="${app.id}" aria-selected="false">
            ${raw(appIcon(app, { size: 36 }))}
            <span class="opt-main">
              <span class="opt-name">${highlight(app.name, words)}${stack.has(app.id) ? html` <span class="opt-in">In your stack</span>` : ''}</span>
              <span class="opt-sub">${event ? html`${event.kind} · <b>${event.label}</b>${event.instant ? ' · instant' : ''}` : app.blurb}</span>
            </span>
            <span class="opt-cat">${CATEGORY_BY_ID.get(app.category).chip}</span>
          </li>`)}
      </ul>
      ${question && gate ? html`<div class="omni-gate">${gate}</div>` : ''}
      ${!apps.length && letter ? html`<p class="omni-empty">No apps start with ${letter} yet.</p>` : ''}
      ${!question && q && apps.length ? html`<p class="omni-more">Not what you’re after? <button type="button" class="btn-link" data-ask-query>Ask about “${q}”</button></p>` : ''}
      <p class="omni-hint" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> move <span>·</span> <kbd>↵</kbd> ${question ? 'ask' : 'open'} <span>·</span> <kbd>esc</kbd> clear</p>`;
  }

  function askOption(i, q, gate) {
    return html`
      <li class="opt opt-ask" role="option" id="omni-opt-${i}" data-option="${i}" aria-selected="false" aria-disabled="${String(Boolean(gate))}">
        ${hostAvatar(30)}
        <span class="opt-main">
          <span class="opt-name">Ask: “${q}”</span>
          <span class="opt-sub">${answererLine()}</span>
        </span>
        <kbd aria-hidden="true">↵</kbd>
      </li>`;
  }

  // Why an ask can't go out right now, with the button that helps; null when it can.
  function askGate() {
    const s = snapshot;
    if (s.phase === 'uncertain') return html`<p>${ERRORS.uncertain[0]}</p><button type="button" class="btn btn-dark btn-sm" data-new>Start a new conversation</button>`;
    if (s.phase === 'loading') return html`<p class="gate-wait">Checking who can answer…</p>`;
    if (!canAsk()) {
      return html`<p>${s.error === 'start' ? ERRORS.start[0] : 'Nobody can answer right now. Your text stays in the box.'}</p><button type="button" class="btn btn-outline btn-sm" data-retry>Check again</button>`;
    }
    return null;
  }

  function highlight(name, words) {
    const lower = name.toLowerCase();
    const word = words.find((w) => lower.startsWith(w) || lower.includes(` ${w}`));
    if (!word) return name;
    const at = lower.startsWith(word) ? 0 : lower.indexOf(` ${word}`) + 1;
    return html`${name.slice(0, at)}<mark>${name.slice(at, at + word.length)}</mark>${name.slice(at + word.length)}`;
  }

  // The starter: where a search with nothing to show becomes a question.
  function starterView() {
    const stackNames = stack.apps.map((a) => a.name);
    const chips = [];
    let kicker = 'Ask here';
    let head;
    let sub;
    let ideas = '';
    let works = '';
    if (ask?.kind === 'nomatch') {
      kicker = 'No match in 7,000+ apps';
      chips.push(html`<li class="ctx-chip">${raw(icon('search'))} “${ask.term}” · no match</li>`);
      if (ask.closest.length) chips.push(html`<li class="ctx-chip">Closest: ${ask.closest.map((a) => a.name).join(', ')}</li>`);
      head = html`No <span class="starter-term">${ask.term}</span> yet.`;
      sub = 'Tell us what you’d connect it to, and we’ll say what’s possible today.';
      const to = stack.apps.find((a) => a.category !== 'builtin')?.name ?? 'my CRM';
      // Short labels; a click puts the whole question in the box, ready to edit.
      const starts = [
        [`Connect it to ${to}?`, `Can I connect ${ask.term} to ${to}?`],
        ['On your roadmap?', `Is ${ask.term} on your roadmap?`],
        ['It has an API', `${ask.term} has an API. Can Hookline use it?`],
      ];
      ideas = html`
        <div class="starter-ideas" role="group" aria-label="Start your question">
          ${starts.map(([label, text]) => html`<button type="button" class="try-chip" data-suggest="${text}" aria-label="${text} (puts it in the box)">${label}</button>`)}
        </div>`;
      works = html`
        <p class="omni-label">Works today with any app’s API</p>
        <div class="mini-grid mini-grid-compact">${['webhooks', 'http'].map((id) => miniApp(APP_BY_ID.get(id), 'starter', true))}</div>`;
    } else if (ask?.kind === 'app') {
      chips.push(html`<li class="ctx-chip">${raw(appIcon(ask.app, { size: 16, className: 'app-icon app-icon-xs' }))} ${ask.app.name}: ${ask.app.triggers.length} triggers, ${ask.app.actions.length} actions</li>`);
      head = html`Missing something in ${ask.app.name}?`;
      sub = 'Name the trigger or action you need. We’ll say what works today, or pass it to the team.';
    } else if (ask?.kind === 'flow') {
      chips.push(html`<li class="ctx-chip">${flowIcons(ask.flow, 16)} ${ask.flow.name}</li>`);
      head = 'Ask about this flow';
      sub = flowSentence(ask.flow);
    } else {
      head = 'Ask the Hookline team';
      sub = 'No app matches that, and it reads like a question. Press Enter and it’s answered right here.';
    }
    if (stackNames.length) chips.push(html`<li class="ctx-chip">Stack: ${stackNames.join(', ')}</li>`);
    const gate = askGate();
    const ready = input.value.trim();
    const label = ask?.kind === 'nomatch' && normalize(input.value) === normalize(ask.term) ? html`Ask about ${ask.term}` : 'Ask';
    return html`
      <div class="starter" data-kind="${ask?.kind ?? 'question'}">
        <p class="starter-kicker">${kicker}</p>
        <h2 class="starter-head">${head}</h2>
        <p class="starter-sub">${sub}</p>
        ${ideas}
        <div class="starter-foot">
          <div class="starter-who">
            ${hostAvatar(32)}
            <p>${answererLine(true)}</p>
          </div>
          ${chips.length ? html`<div class="starter-carries"><p>Your question carries</p><ul class="ctx-chips" aria-label="Sent with your question">${chips}</ul></div>` : ''}
          ${gate ? html`<div class="omni-gate starter-gate">${gate}</div>` : html`<button type="button" class="btn btn-orange starter-ask" data-ask ${ready ? '' : 'disabled'}>${label} <span aria-hidden="true">↵</span></button>`}
        </div>
        ${works}
        ${attribution()}
      </div>`;
  }

  function answererLine(long = false) {
    const h = snapshot.host;
    if (snapshot.phase === 'loading') return 'Checking who can answer…';
    if (snapshot.phase === 'uncertain') return 'Your last question may already be with the team';
    if (snapshot.phase === 'ended') return 'Asking starts a new conversation';
    if (!canAsk()) return 'Nobody can answer right now';
    const who = h.name || 'the Hookline team';
    const what = h.kind === 'standin' ? 'AI' : h.kind === 'rep' ? 'Person' : '';
    return html`Answered here by <b>${who}</b>${what ? html` <span class="badge badge-${h.kind}">${what}</span>` : ''}${long ? html`<span class="starter-real"><span class="starter-dot"> · </span>real conversation via Stand</span>` : ''}`;
  }

  function attribution() {
    const url = safeUrl(snapshot.poweredByUrl);
    return url ? html`<p class="omni-powered"><a href="${url}" target="_blank" rel="noopener noreferrer" data-powered>Powered by Stand</a></p>` : '';
  }

  function hostAvatar(size, who = snapshot.host) {
    const url = safeUrl(who.avatar);
    if (url) return html`<img class="avatar" src="${url}" alt="" width="${size}" height="${size}" style="--s:${size}px">`;
    // No avatar: a spark for an AI, initials for a person.
    if (who.kind === 'rep') {
      const initials = (who.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      return html`<span class="avatar avatar-initials" style="--s:${size}px" aria-hidden="true">${initials}</span>`;
    }
    return html`<span class="avatar avatar-ai" style="--s:${size}px" aria-hidden="true"><svg viewBox="0 0 24 24">${raw(glyph('spark'))}</svg></span>`;
  }

  // An app's card: what it can do, flows with it, and a way to ask for more.
  function appView(app) {
    const flows = FLOWS.filter((f) => f.trigger[0] === app.id || f.action[0] === app.id).map((f) => resolveFlow(f, { stack: stack.ids }));
    for (const other of ['chatterbox', 'gridwell', 'pipewell', 'taskyard'].map((id) => APP_BY_ID.get(id))) {
      if (flows.length >= 2 || other.id === app.id) continue;
      if (app.triggers.length && other.actions.length) flows.push(pairFlow(app, other));
      else if (app.actions.length && other.triggers.length) flows.push(pairFlow(other, app));
    }
    const inStack = stack.has(app.id);
    const back = hasTranscript() && snapshot.phase !== 'ended' ? 'Back to the conversation' : query.trim() || category || letter ? 'Back to results' : 'Back';
    return html`
      <div class="app-card" tabindex="-1" aria-labelledby="app-card-name">
        <div class="app-card-top">
          <button type="button" class="btn-back" data-back><span aria-hidden="true">←</span> ${back}</button>
          ${stackButton(app, 'card', 'btn-sm')}
        </div>
        <div class="app-card-head">
          ${raw(appIcon(app, { size: 56 }))}
          <div>
            <h2 id="app-card-name">${app.name}${app.category === 'builtin' ? html` <span class="badge badge-builtin">Built-in</span>` : ''}</h2>
            <p class="app-card-cat">${CATEGORY_BY_ID.get(app.category).label} · ${app.blurb}</p>
          </div>
        </div>
        <div class="app-card-cols">
          <section aria-labelledby="app-triggers">
            <h3 id="app-triggers">Triggers <span>${app.triggers.length}</span></h3>
            ${app.triggers.length ? html`<ul class="event-list">${app.triggers.map((t) => html`<li>${t.name}${t.instant ? html` <span class="badge badge-instant">Instant</span>` : ''}</li>`)}</ul>`
              : html`<p class="app-card-none">${app.name} works as a step inside a flow, not as its start.</p>`}
          </section>
          <section aria-labelledby="app-actions">
            <h3 id="app-actions">Actions <span>${app.actions.length}</span></h3>
            ${app.actions.length ? html`<ul class="event-list">${app.actions.map((a) => html`<li>${a}</li>`)}</ul>`
              : html`<p class="app-card-none">${app.name} starts flows. Pair it with any app’s action.</p>`}
          </section>
        </div>
        ${flows.length ? html`
          <h3 class="app-card-flows">Popular flows with ${app.name}</h3>
          <ul class="flow-rows">${flows.slice(0, 3).map((f) => html`
            <li class="flow-row">${flowIcons(f, 24)}${flowSentence(f)}<button type="button" class="btn btn-outline btn-xs" data-open-flow="${f.key}">Try it</button></li>`)}</ul>` : ''}
        <p class="app-card-ask"><span>Missing a trigger or action?</span> <button type="button" class="btn-link" data-ask-app="${app.id}">Ask about ${app.name} <span aria-hidden="true">→</span></button></p>
      </div>`;
  }

  function stackButton(app, where, size = 'btn-xs') {
    const inStack = stack.has(app.id);
    return html`<button type="button" class="btn ${inStack ? 'btn-outline' : 'btn-orange'} ${size}" data-add="${app.id}" data-where="${where}" aria-pressed="${String(inStack)}" aria-label="${inStack ? `${app.name} is in your stack. Remove it` : `Add ${app.name} to your stack`}"><span>${inStack ? html`✓ In<span class="lbl-long"> your</span> stack` : html`+ Add<span class="lbl-long"> to stack</span>`}</span></button>`;
  }

  function miniApp(app, where, compact = false) {
    const badge = app.category === 'builtin' ? html` <span class="badge badge-builtin">Built-in</span>` : '';
    if (compact) {
      // One line: the name opens the app's card, the button adds it.
      return html`
        <div class="mini-app is-compact">
          ${raw(appIcon(app, { size: 28 }))}
          <div class="mini-app-main">
            <p class="mini-app-name"><button type="button" class="mini-app-open" data-open="${app.id}">${app.name}</button>${badge}</p>
            <p class="mini-app-blurb">${app.blurb}</p>
          </div>
          ${stackButton(app, where)}
        </div>`;
    }
    return html`
      <div class="mini-app">
        ${raw(appIcon(app, { size: 32 }))}
        <div class="mini-app-main">
          <p class="mini-app-name">${app.name}${badge}</p>
          <p class="mini-app-blurb">${app.blurb}</p>
          <p class="mini-app-actions">${stackButton(app, where)}<button type="button" class="btn-link" data-open="${app.id}" aria-label="Details: ${app.name}">Details</button></p>
        </div>
      </div>`;
  }

  // Chat -----------------------------------------------------------------------

  function renderChat(changed) {
    let shell = inner.querySelector('.chat');
    if (!shell || changed) {
      setHTML(inner, html`
        <div class="chat">
          <div class="chat-suggest"></div>
          <div class="chat-bar"></div>
          <div class="chat-alert" role="alert"></div>
          <ol class="exchanges" aria-label="Conversation, newest first"></ol>
          <div class="chat-earlier"></div>
          <div class="chat-foot"></div>
        </div>`);
      shell = inner.querySelector('.chat');
      exchangeCache.clear();
    }
    const s = snapshot;
    setHTML(shell.querySelector('.chat-suggest'), chatSuggestions());
    setHTML(shell.querySelector('.chat-bar'), chatBar());
    const error = ERRORS[s.error];
    setHTML(shell.querySelector('.chat-alert'), error && s.error !== 'send' && s.error !== 'email' ? html`<p>${error[0]}</p>${errorAction(error[1])}` : '');

    const exchanges = toExchanges(s.messages, s.pending).reverse();
    const names = speakerNames(s);
    const newest = exchanges[0]?.key;
    const shown = earlierOpen ? exchanges : exchanges.slice(0, VISIBLE_EXCHANGES);
    const list = shell.querySelector('.exchanges');
    const keep = new Set();
    const nodes = shown.map((ex) => {
      const isNewest = ex.key === newest;
      const sig = JSON.stringify([ex.items.map((m) => m.messageId), ex.pending, isNewest && s.activity, isNewest && s.busy, isNewest && s.error,
        s.followupOffered, s.phase, s.error === 'email', names.sig, s.host]);
      keep.add(ex.key);
      let entry = exchangeCache.get(ex.key);
      if (!entry || entry.sig !== sig) {
        const el = document.createElement('li');
        // A sent message shows as pending, then gets its ID: it animates in only the first time.
        el.className = seenPrimed && !seen.has(ex.key) && !seen.has(`sent:${ex.text}`) ? 'ex is-new' : 'ex';
        el.dataset.key = ex.key;
        setHTML(el, exchange(ex, isNewest, names));
        if (entry?.el.contains(document.activeElement)) restoreFocus(el);
        entry = { sig, el };
        exchangeCache.set(ex.key, entry);
        mountEditors(el);
      }
      return entry.el;
    });
    for (const key of [...exchangeCache.keys()]) if (!keep.has(key)) exchangeCache.delete(key);
    for (const ex of exchanges) {
      if (ex.key !== 'pending') seen.add(ex.key);
      seen.add(`sent:${ex.text}`);
      ex.items.forEach((m) => seen.add(m.messageId));
    }
    // A transcript restored after a reload appears at once; later arrivals animate.
    if (s.phase !== 'loading') seenPrimed = true;
    // Reorder without recreating what didn't change.
    nodes.forEach((node, i) => {
      if (list.children[i] !== node) list.insertBefore(node, list.children[i] ?? null);
    });
    while (list.children.length > nodes.length) list.lastElementChild.remove();

    const hidden = exchanges.length - shown.length;
    setHTML(shell.querySelector('.chat-earlier'), exchanges.length > VISIBLE_EXCHANGES
      ? html`<button type="button" class="btn-link" data-earlier aria-expanded="${String(earlierOpen)}">${earlierOpen ? 'Hide earlier messages' : `Earlier in this conversation (${hidden})`}</button>` : '');
    setHTML(shell.querySelector('.chat-foot'), html`
      <p class="chat-real">${s.host.kind === 'rep' ? 'Real conversation · a person from the team, via Stand' : 'Real conversation · AI Stand-in via Stand'}</p>
      ${attribution()}`);
    announceReplies(s, names);
  }

  // While replying, a name that matches an app offers to open it. Enter still sends.
  function chatSuggestions() {
    const q = query.trim();
    if (!q || snapshot.phase === 'ended') return '';
    const hits = search(q, { limit: 3 }).results.filter((r) => r.score >= 8);
    if (!hits.length) return '';
    options = [{ type: 'send' }, ...hits.map((h) => ({ type: 'app', app: h.app }))];
    return html`
      <ul class="omni-list chat-suggest-list" role="listbox" id="omni-list" aria-label="Send, or open an app">
        <li class="opt opt-send" role="option" id="omni-opt-0" data-option="0" aria-selected="true"><span class="opt-main"><span class="opt-name">Send as a reply</span></span><kbd aria-hidden="true">↵</kbd></li>
        ${hits.map((h, i) => html`<li class="opt opt-app opt-compact" role="option" id="omni-opt-${i + 1}" data-option="${i + 1}" aria-selected="false">${raw(appIcon(h.app, { size: 24 }))}<span class="opt-main"><span class="opt-name">Open ${h.app.name}</span></span><span class="opt-cat">${CATEGORY_BY_ID.get(h.app.category).chip}</span></li>`)}
      </ul>`;
  }

  function chatBar() {
    const s = snapshot;
    const h = s.host;
    let state = '';
    if (s.phase === 'ended') state = 'Conversation ended';
    else if (s.phase === 'uncertain') state = 'Start not confirmed';
    else if (s.phase === 'loading') state = 'Restoring…';
    else if (s.phase === 'active' && s.connection !== 'online' && offlineSince && Date.now() - offlineSince > 1500) state = wasOnline ? 'Reconnecting…' : 'Connecting…';
    let end = '';
    if (s.phase === 'active') {
      end = confirmEnd
        ? html`<span class="chat-confirm" role="group" aria-label="End this conversation?"><span>End this conversation?</span><button type="button" class="btn btn-dark btn-xs" data-end-confirm ${s.busy ? 'disabled' : ''}>End</button><button type="button" class="btn-link" data-end-cancel>Keep talking</button></span>`
        : html`<button type="button" class="btn-link chat-end" data-end ${s.busy ? 'disabled' : ''}>End conversation</button>`;
    } else if (s.phase === 'ended' || s.phase === 'uncertain') {
      end = html`<button type="button" class="btn btn-dark btn-xs" data-new ${s.busy ? 'disabled' : ''}>Start a new conversation</button>`;
    }
    return html`
      <div class="chat-host">
        ${hostAvatar(28)}
        <p><b>${h.name || 'Hookline team'}</b>${h.kind ? html` <span class="badge badge-${h.kind}">${h.kind === 'standin' ? 'AI' : 'Person'}</span>` : ''}${state ? html` <span class="chat-state">${state}</span>` : ''}</p>
      </div>
      ${end}`;
  }

  function errorAction(action) {
    if (action === 'retry') return html`<button type="button" class="btn btn-outline btn-xs" data-retry>Reconnect</button>`;
    if (action === 'new' && snapshot.phase !== 'active') return html`<button type="button" class="btn btn-dark btn-xs" data-new>Start a new conversation</button>`;
    if (action === 'end') return html`<button type="button" class="btn btn-outline btn-xs" data-end-confirm>Try again</button>`;
    return '';
  }

  // Who said each reply: cards in the transcript change who answers.
  function speakerNames(s) {
    let standin = s.host.kind === 'standin' ? s.host.name : '';
    let rep = s.host.kind === 'rep' ? s.host.name : '';
    const byId = new Map();
    for (const m of s.messages) {
      if (m.type === 'system-card' || m.senderType === 'system-card') {
        const card = parseCard(m.body);
        if (card.cardType === 'session-start' || card.cardType === 'standin-takeover') standin = card.standinName || standin;
        if (card.cardType === 'handoff' || card.cardType === 'human-transfer') rep = card.repName || rep;
      } else if (m.senderType === 'standin') byId.set(m.messageId, { name: standin || 'AI Stand-in', kind: 'standin' });
      else if (m.senderType === 'rep') byId.set(m.messageId, { name: rep || 'Hookline team', kind: 'rep' });
    }
    return { byId, sig: `${standin}|${rep}` };
  }

  function exchange(ex, isNewest, names) {
    const s = snapshot;
    const pending = ex.pending;
    let note = '';
    if (pending) {
      if (s.busy) note = pending.creating ? 'Starting the conversation…' : 'Sending…';
      else if (s.phase === 'active') note = html`<span class="ex-failed">Not delivered</span> <button type="button" class="btn-link" data-resend>Retry</button>`;
      else note = html`<span class="ex-failed">Not delivered</span>`;
    }
    const when = ex.question ? time(ex.question.sentAt) : pending ? 'now' : '';
    const replies = [];
    let lastSpeaker = '';
    for (const m of ex.items) {
      const who = names.byId.get(m.messageId);
      const showWho = Boolean(who) && `${who.name}|${who.kind}` !== lastSpeaker;
      if (who) lastSpeaker = `${who.name}|${who.kind}`;
      replies.push(item(m, who, showWho, ex));
    }
    if (isNewest && s.activity && s.phase === 'active') {
      const typing = s.activity.kind === 'typing';
      replies.push(html`
        <div class="thinking">
          ${hostAvatar(24)}
          <span class="thinking-run" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>${typing ? `${s.host.name || 'Someone'} is typing…` : `${s.host.name || 'The team'} is thinking…`}</span>
        </div>
        ${s.activity.preview ? html`<div class="reply reply-preview">${raw(formatReply(s.activity.preview))}</div>` : ''}`);
    }
    return html`
      ${ex.question || pending ? html`
        <div class="ex-q">
          <p class="ex-meta">You${when ? html` · <time>${when}</time>` : ''}${note ? html` · <span class="ex-state">${note}</span>` : ''}</p>
          <p class="ex-text">${ex.text}</p>
          ${contextChips(ex.context)}
        </div>` : ''}
      ${replies.length ? html`<div class="ex-a">${replies}</div>` : ''}`;
  }

  function contextChips(context) {
    if (!context) return '';
    const chips = [];
    if (context.search) chips.push(html`<li class="ctx-chip">${raw(icon('search'))} “${context.search}”${context.noMatch ? ' · no match' : ''}</li>`);
    if (context.app) {
      const app = APPS_BY_NAME.get(context.app);
      chips.push(html`<li class="ctx-chip">${app ? raw(appIcon(app, { size: 16, className: 'app-icon app-icon-xs' })) : ''} ${context.missing ? `Missing in ${context.app}` : context.app}</li>`);
    }
    if (context.flow) chips.push(html`<li class="ctx-chip">${raw(icon('flow'))} ${context.flow}</li>`);
    if (context.stack) chips.push(html`<li class="ctx-chip">Stack: ${context.stack.length ? context.stack.join(', ') : 'empty'}</li>`);
    return chips.length ? html`<ul class="ctx-chips" aria-label="Sent with this message">${chips}</ul>` : '';
  }

  function item(m, who, showWho, ex) {
    if (m.type === 'text' || m.type === 'standin-idle-prompt') {
      const refs = references(m.body);
      const mentioned = [...refs.filter((r) => r.app).map((r) => r.app.id), ...mentionedApps(ex.text ?? '').map((a) => a.id)];
      const flows = refs.filter((r) => r.flow).map((r) => resolveFlow(r.flow, { mentioned, stack: stack.ids }));
      const apps = refs.filter((r) => r.app).slice(0, 4).map((r) => r.app);
      const avatarWho = { ...snapshot.host, name: who?.name ?? '', kind: who?.kind ?? null, avatar: who?.kind === snapshot.host.kind ? snapshot.host.avatar : '' };
      return html`
        <div class="reply${seenPrimed && !seen.has(m.messageId) ? ' is-new' : ''}" data-id="${m.messageId}">
          ${showWho ? html`<p class="reply-who">${hostAvatar(24, avatarWho)}<b>${who.name}</b> <span class="badge badge-${who.kind}">${who.kind === 'standin' ? 'AI' : 'Person'}</span></p>` : ''}
          <div class="reply-body">${raw(formatReply(m.body, chip))}</div>
          ${flows.length || apps.length ? html`
            <div class="reply-cards">
              ${flows.map((f) => flowCard(f, m.messageId))}
              ${apps.length ? html`<div class="mini-grid">${apps.map((a) => miniApp(a, `reply-${m.messageId}`))}</div>` : ''}
            </div>` : ''}
        </div>`;
    }
    if (m.type === 'link-card') {
      const card = linkCard(m);
      let host = '';
      try {
        host = new URL(card.url).hostname.replace(/^www\./, '');
      } catch { /* linkCard only returns valid URLs */ }
      return html`<a class="link-card" href="${card.url}" target="_blank" rel="noopener noreferrer" data-link="${m.messageId}">
        <b>${card.title}</b>${card.description ? html`<span>${card.description}</span>` : ''}<span class="link-card-host">${host} ↗</span></a>`;
    }
    const card = parseCard(m.body);
    const note = typeof card.message === 'string' && card.message.trim() ? card.message.trim() : '';
    switch (card.cardType) {
      case 'handoff':
      case 'human-transfer':
        return html`<p class="sys sys-person"><b>${card.repName || 'Someone from the team'}</b>${card.repTitle ? `, ${card.repTitle},` : ''} joined the conversation. You’re talking to a person now.${note ? html`<br>${note}` : ''}</p>`;
      case 'standin-takeover':
        return html`<p class="sys"><b>${card.standinName || 'The AI Stand-in'}</b> (AI) is answering again.${note ? html`<br>${note}` : ''}</p>`;
      case 'session-end':
        return html`<p class="sys">Conversation ended.</p>`;
      case 'rep-followup-offer':
        return followupForm(card, m);
      case 'rep-followup-confirmation':
        return html`<p class="sys sys-done">Thanks. We’ll follow up by email.${note ? html`<br>${note}` : ''}</p>`;
      default:
        return '';
    }
  }

  function followupForm(card, m) {
    const latest = snapshot.messages.filter((x) => x.type === 'system-card' && parseCard(x.body).cardType === 'rep-followup-offer').at(-1);
    const open = snapshot.followupOffered && snapshot.phase === 'active' && latest?.messageId === m.messageId;
    const who = card.repName || 'The team';
    if (!open) return html`<p class="sys">${who} offered to follow up by email.</p>`;
    return html`
      <form class="followup" data-followup>
        <label for="followup-email"><b>${who}</b> can’t reply right now. Leave your email and they’ll follow up.</label>
        ${card.message ? html`<p class="followup-note">${card.message}</p>` : ''}
        <div class="followup-row">
          <input id="followup-email" type="email" name="email" autocomplete="email" required placeholder="you@company.com" ${snapshot.busy ? 'disabled' : ''}>
          <button type="submit" class="btn btn-dark btn-sm" ${snapshot.busy ? 'disabled' : ''}>Send</button>
        </div>
        ${snapshot.error === 'email' ? html`<p class="followup-error" role="alert">${ERRORS.email[0]}</p>` : ''}
      </form>`;
  }

  // An inline chip for a reference in a reply's text.
  function chip(ref) {
    if (ref.app) return String(html`<button type="button" class="ref" data-open="${ref.app.id}">${raw(appIcon(ref.app, { size: 16, className: 'app-icon app-icon-xs' }))}${ref.app.name}</button>`);
    return String(html`<button type="button" class="ref ref-flow" data-jump-flow="${ref.flow.id}">${raw(icon('flow'))}${ref.flow.name}</button>`);
  }

  function flowCard(flow, messageId) {
    const key = `${messageId}|${flow.key}`;
    const open = expanded.has(key);
    const id = `editor-${key.replace(/[^a-z0-9_-]/gi, '-')}`;
    return html`
      <div class="flow-card${open ? ' is-open' : ''}" data-flow-card="${key}" data-flow-id="${flow.id}">
        <div class="flow-card-head">
          ${flowIcons(flow, 30)}
          <div class="flow-card-text">
            <p class="flow-card-name">${flow.name}</p>
            <p class="flow-card-sentence">${flowSentence(flow)}</p>
          </div>
          <button type="button" class="btn ${open ? 'btn-outline' : 'btn-dark'} btn-xs" data-try="${key}" aria-expanded="${String(open)}" aria-controls="${id}">${open ? 'Close' : 'Try this flow'}</button>
        </div>
        <div class="flow-card-editor" id="${id}" ${open ? '' : 'hidden'}></div>
      </div>`;
  }

  // Flow editors inside replies are components: mount them after rendering.
  function mountEditors(el) {
    for (const card of el.querySelectorAll('[data-flow-card]')) {
      const key = card.dataset.flowCard;
      if (!expanded.has(key)) continue;
      const again = expanded.get(key) instanceof FlowEditor; // a re-render: no entrance
      const editor = new FlowEditor(card.querySelector('.flow-card-editor'), {
        compact: true,
        onAddApps: (f) => {
          stack.add(f.trigger.app.id);
          stack.add(f.action.app.id);
        },
        hasApp: (id) => stack.has(id),
        onAsk: (f) => askAbout({ flow: f }),
      });
      editor.set(flowFromCard(card), { enter: !again });
      expanded.set(key, editor);
    }
  }

  function flowFromCard(card) {
    const messageId = card.dataset.flowCard.split('|')[0];
    const message = snapshot.messages.find((m) => m.messageId === messageId);
    const template = FLOWS.find((f) => f.id === card.dataset.flowId);
    const refs = message ? references(message.body) : [];
    const question = toExchanges(snapshot.messages).find((ex) => ex.items.some((m) => m.messageId === messageId));
    const mentioned = [...refs.filter((r) => r.app).map((r) => r.app.id), ...mentionedApps(question?.text ?? '').map((a) => a.id)];
    return resolveFlow(template, { mentioned, stack: stack.ids });
  }

  function restoreFocus(to) {
    const focused = document.activeElement;
    const attr = ['data-try', 'data-add', 'data-open', 'data-resend'].find((a) => focused?.hasAttribute(a));
    if (!attr) return;
    const selector = `[${attr}="${CSS.escape(focused.getAttribute(attr))}"]`;
    requestAnimationFrame(() => to.querySelector(selector)?.focus({ preventScroll: true }));
  }

  // Reads each new reply out once, whole. Replies restored after a reload stay quiet.
  function announceReplies(s, names) {
    const replies = s.messages.filter((m) => (m.type === 'text' || m.type === 'standin-idle-prompt') && (m.senderType === 'standin' || m.senderType === 'rep'));
    const fresh = replies.filter((m) => !announced.has(m.messageId));
    fresh.forEach((m) => announced.add(m.messageId));
    if (!primed) {
      primed = s.phase !== 'loading';
      return;
    }
    if (!fresh.length || !live) return;
    const last = fresh.at(-1);
    const who = names.byId.get(last.messageId);
    live.textContent = `${who?.name ?? 'Reply'}${who?.kind === 'standin' ? ' (AI)' : ''}: ${plainText(last.body)}`;
  }

  function announceSoon(text) {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (status && status.textContent !== text) status.textContent = text;
    }, 600);
  }

  function renderTray() {
    const apps = stack.apps;
    tray.hidden = !apps.length;
    if (!apps.length) return setHTML(tray, '');
    setHTML(tray, html`
      <span class="omni-stack-label">Your stack</span>
      <ul class="stack-chips">
        ${apps.map((a) => html`<li class="stack-chip">${raw(appIcon(a, { size: 18, className: 'app-icon app-icon-xs' }))}<span>${a.name}</span><button type="button" data-remove="${a.id}" aria-label="Remove ${a.name} from your stack">×</button></li>`)}
      </ul>
      <a class="omni-stack-link" href="#stack">${apps.length > 1 ? 'Flows for your stack' : 'Add one more for flow ideas'} <span aria-hidden="true">↓</span></a>`);
  }

  // Clicks ---------------------------------------------------------------------

  root.addEventListener('mousedown', (event) => {
    // Picking a result keeps the typing focus.
    if (event.target.closest('[role="option"]')) event.preventDefault();
  });

  root.addEventListener('click', (event) => {
    if (event.target.closest('.fe')) return; // flow editors handle their own clicks
    const option = event.target.closest('[role="option"]');
    if (option) {
      active = Number(option.dataset.option);
      if (options[active]) activate(options[active]);
      return;
    }
    const link = event.target.closest('[data-link]');
    if (link) return client.trackLinkClick(link.dataset.link, link.href);
    if (event.target.closest('[data-powered]')) return client.trackAttributionClick();
    const button = event.target.closest('button');
    if (!button || button.disabled || !root.contains(button)) return;
    const d = button.dataset;
    if ('category' in d) {
      category = d.category || null;
      letter = null;
      active = 0;
      render();
      inner.querySelector(`[data-category="${category ?? ''}"]`)?.focus({ preventScroll: true });
    } else if ('suggest' in d) {
      endDemo();
      setQuery(d.suggest);
      client.setDraft(draftPrefix() + d.suggest);
      input.focus({ preventScroll: true });
    } else if ('open' in d) openApp(d.open);
    else if ('back' in d) closeApp();
    else if ('add' in d) {
      if (stack.has(d.add)) stack.remove(d.add);
      else stack.add(d.add);
    } else if ('remove' in d) stack.remove(d.remove);
    else if ('askApp' in d) askAbout({ app: APP_BY_ID.get(d.askApp) });
    else if ('askQuery' in d) submit({ searchTerm: clean(query.trim(), 60) });
    else if ('ask' in d) submit();
    else if ('openFlow' in d) {
      const template = FLOWS.find((f) => d.openFlow.startsWith(`${f.id}:`));
      const flow = template ? resolveFlow(template, { stack: stack.ids }) : pairFromKey(d.openFlow);
      if (flow) onOpenFlow(flow);
    } else if ('try' in d) {
      if (expanded.has(d.try)) expanded.delete(d.try);
      else expanded.set(d.try, null);
      saveOpenFlows([...expanded.keys()]);
      exchangeCache.clear();
      render();
      const card = inner.querySelector(`[data-flow-card="${CSS.escape(d.try)}"]`);
      card?.querySelector('[data-try]')?.focus({ preventScroll: true });
      if (expanded.has(d.try)) card?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    } else if ('jumpFlow' in d) {
      const card = button.closest('.reply')?.querySelector(`[data-flow-id="${CSS.escape(d.jumpFlow)}"]`);
      card?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      card?.querySelector('[data-try]')?.focus({ preventScroll: true });
    } else if ('retry' in d) client.retry();
    else if ('resend' in d) client.send();
    else if ('new' in d) {
      confirmEnd = false;
      earlierOpen = false;
      client.newChat().then(() => input.focus({ preventScroll: true }));
    } else if ('end' in d) {
      confirmEnd = true;
      render();
      inner.querySelector('[data-end-confirm]')?.focus({ preventScroll: true });
    } else if ('endCancel' in d) {
      confirmEnd = false;
      render();
      inner.querySelector('[data-end]')?.focus({ preventScroll: true });
    } else if ('endConfirm' in d) {
      confirmEnd = false;
      client.end().then(() => input.focus({ preventScroll: true }));
    } else if ('earlier' in d) {
      earlierOpen = !earlierOpen;
      render();
      inner.querySelector('[data-earlier]')?.focus({ preventScroll: true });
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (confirmEnd) {
      confirmEnd = false;
      render();
      inner.querySelector('[data-end]')?.focus({ preventScroll: true });
    } else if (appId && !event.defaultPrevented && inner.contains(event.target)) {
      closeApp();
    }
  });

  token.addEventListener('click', (event) => {
    if (!event.target.closest('.omni-token-x')) return;
    ask = null;
    client.setDraft(input.value.trim() ? input.value : '');
    render();
    input.focus();
  });

  root.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-followup]');
    if (!form) return;
    event.preventDefault();
    const email = form.elements.email.value.trim();
    if (email) client.submitEmail(email);
  });

  stack.subscribe(() => {
    const focused = document.activeElement;
    const add = focused?.dataset?.add;
    const where = focused?.dataset?.where;
    exchangeCache.clear();
    render();
    if (add) inner.querySelector(`[data-add="${CSS.escape(add)}"][data-where="${CSS.escape(where ?? '')}"]`)?.focus({ preventScroll: true });
  });

  // The example search ------------------------------------------------------------

  // On a first visit the box types a search it can't answer, so the "no match"
  // state shows itself. It's marked as an example, and any keystroke replaces it.
  function playDemo() {
    if (stack.demoSeen || hasTranscript() || input.value || snapshot.draft) return;
    demo = { running: true };
    stack.markDemoSeen();
    if (reducedMotion()) {
      demo.running = false;
      query = EXAMPLE;
      input.value = EXAMPLE;
      settled = true;
      return render();
    }
    let i = 0;
    const tick = () => {
      if (!demo) return;
      query = EXAMPLE.slice(0, ++i);
      input.value = query;
      if (i < EXAMPLE.length) {
        renderField();
        setTimeout(tick, 70 + Math.random() * 40);
      } else {
        settled = true;
        demo.running = false;
        setTimeout(() => demo && render(), 260);
      }
    };
    setTimeout(tick, 450);
  }

  function endDemo() {
    if (!demo) return;
    demo = null;
    example.hidden = true;
  }

  // Page API --------------------------------------------------------------------

  document.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if ((event.key === '/' && !typing) || (event.key.toLowerCase?.() === 'k' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      focusBox();
    }
  });

  // A reload mid-question puts the draft back; a first visit plays the example.
  if (snapshot.draft && !hasTranscript()) applyDraft(snapshot.draft);
  unsubscribe = client.subscribe(onState);
  release = client.mount();
  snapshot = client.getSnapshot();
  render();
  playDemo();

  return {
    focus: focusBox,
    /** Puts text in the box without sending it, as if typed. */
    prefill(text) {
      endDemo();
      ask = null;
      appId = null;
      category = null;
      setQuery(text);
      client.setDraft(text);
      focusBox();
    },
    openApp(id) {
      openApp(id);
      root.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    },
    askAbout,
    /** The message the box would send now, prefix included: for the explainer. */
    preview() {
      const text = input.value.trim() || (view === 'chat' ? 'Your reply' : 'Your question');
      return buildPrefix(messageContext(text)) + text;
    },
    browseLetter(l) {
      endDemo();
      ask = null;
      appId = null;
      category = null;
      query = '';
      input.value = '';
      letter = l;
      render();
      focusBox();
    },
    /** Swaps the conversation client: for tests and previews. */
    useClient(next) {
      unsubscribe();
      release();
      client = next;
      snapshot = client.getSnapshot();
      unsubscribe = client.subscribe(onState);
      release = client.mount();
      exchangeCache.clear();
      primed = false;
      render();
    },
  };
}

// Which reply flows are open survives a reload: it isn't in the transcript.
const OPEN_FLOWS = 'search-that-talks:v1:open-flows';

function loadOpenFlows() {
  try {
    const keys = JSON.parse(sessionStorage.getItem(OPEN_FLOWS) || '[]');
    return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string').slice(-20) : [];
  } catch {
    return [];
  }
}

function saveOpenFlows(keys) {
  try {
    sessionStorage.setItem(OPEN_FLOWS, JSON.stringify(keys.slice(-20)));
  } catch {
    // Denied storage: they just start closed after a reload.
  }
}

function pairFromKey(key) {
  const [, from, to] = key.split(':');
  return APP_BY_ID.has(from) && APP_BY_ID.has(to) ? pairFlow(APP_BY_ID.get(from), APP_BY_ID.get(to)) : null;
}

const time = (value) => {
  const ms = Date.parse(String(value).replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ms) : '';
};

function icon(name) {
  if (name === 'search') return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
  if (name === 'flow') return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="14" width="8" height="6" rx="1.5"/><path d="M7 10v2.5a2 2 0 0 0 2 2h4"/></svg>';
  return '';
}
