import { calculate, normalize, PROFILES, SCENARIOS, DEFAULTS, PRESETS, money, number, scenarioContext } from './model.js';

const SITE_ID = 'demo';
const STORE_KEY = `launchmere:v1:${SITE_ID}`;
const $ = (id) => document.getElementById(id);
const put = (id, value) => { $(id).textContent = value; };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const costs = { base: 'Base platform', edge: 'Incoming requests', cpu: 'Compute', db: 'Database operations', transfer: 'Data transfer', ai: 'AI requests' };
let saved = {};
try { saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') || {}; } catch { /* Continue without storage. */ }
let state = normalize(saved.state || DEFAULTS);
let selected = null;
let chat;
let loadingChat;
let lastTrigger;
let announceTimer;
let paused = reducedMotion.matches;
const focusNames = new Set([...Object.values(costs), 'Full launch bill', 'CPU capacity', 'Database capacity', 'Origin compute', 'Scenario tradeoffs']);
if (saved.selected && focusNames.has(saved.selected.focus)) {
  selected = { state: normalize(saved.selected.state), focus: saved.selected.focus, attached: saved.selected.attached !== false, removed: saved.selected.removed === true };
}
function save() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ state, selected })); } catch { /* In-memory state remains usable. */ }
}
function syncControls() {
  for (const key of ['profile', 'traffic', 'scenario', 'budget']) $(key).value = state[key];
  for (const key of ['cache', 'limit']) $(key).checked = state[key];
}
for (const [key, name] of Object.entries(costs)) {
  const button = document.createElement('button');
  button.className = 'bill-line';
  button.dataset.focus = name;
  const label = document.createElement('span');
  label.textContent = name;
  const value = document.createElement('span');
  value.id = `cost-${key}`;
  button.append(label, value);
  $('bill-lines').append(button);
}
function render(announce = false) {
  const r = calculate(state);
  state = r.state;
  put('profile-note', r.profile.description);
  put('traffic-output', number(state.traffic));
  $('traffic').setAttribute('aria-valuetext', `${number(state.traffic)} base requests per second for one hour`);
  for (const key of ['incoming', 'origin', 'cached', 'admitted', 'deferred']) put(key, number(r[key], r[key] < 10 ? 2 : 0));
  put('cache-rate', `${number(r.hits * 100)}% cache hits`);
  for (const [key, value] of [['cpu', r.cpuPercent], ['db', r.dbPercent]]) {
    put(`${key}-value`, number(value, value < 10 ? 1 : 0));
    const meter = $(`${key}-meter`);
    meter.setAttribute('aria-valuenow', Math.min(100, value).toFixed(1));
    meter.setAttribute('aria-valuetext', `${number(value, 1)}% required${value > 100 ? ', above reference capacity' : ''}`);
    meter.firstElementChild.style.width = `${Math.min(100, value)}%`;
    meter.closest('.resource').classList.toggle('over', value > 100);
  }
  for (const key of Object.keys(costs)) put(`cost-${key}`, money(r.costs[key]));
  put('total', money(r.total));
  put('bill-sum', money(r.total));
  $('budget-field').hidden = !state.limit;
  $('budget').disabled = !state.limit;
  $('limit-note').hidden = !state.limit;
  put('limit-note', r.floor > state.budget
    ? `Budget exceeded: ${money(r.floor)} of fixed + ingress costs remain even with all work deferred.`
    : r.fraction < 1 ? `${number((1 - r.fraction) * 100, 1)}% of requests deferred. Without the guardrail: ${money(r.uncapped)} / hour.`
      : 'Within the budget. No requests need to be deferred.');
  let insight;
  if (r.fraction < 1) insight = `The guardrail defers ${number(r.deferred, 1)} req/s. Less work, lower spend — and fewer requests admitted.`;
  else if (r.cpuPercent > 100 || r.dbPercent > 100) insight = `${r.cpuPercent >= r.dbPercent ? 'CPU' : 'Database'} demand is above the reference capacity. Try caching or discuss what scaling would need.`;
  else if (r.costs.ai > r.total / 2) insight = `AI calls make up ${number(r.costs.ai / r.total * 100)}% of this bill. Request count alone does not explain the cost.`;
  else if (state.cache) insight = `Caching keeps ${number(r.cached)} requests/s away from origin. You still pay for incoming traffic and response data.`;
  else insight = 'Every admitted request now reaches origin. Compare CPU and database work with caching turned on.';
  put('insight', insight);
  $('bottleneck').dataset.focus = r.cpuPercent > 100 ? 'CPU capacity' : r.dbPercent > 100 ? 'Database capacity' : 'Scenario tradeoffs';
  for (const button of document.querySelectorAll('[data-preset]')) {
    const preset = PRESETS[button.dataset.preset];
    button.setAttribute('aria-pressed', Object.keys(DEFAULTS).every((k) => state[k] === preset[k]));
  }
  if (selected) {
    const changed = JSON.stringify(state) !== JSON.stringify(selected.state);
    put('context-note', selected.removed ? 'Attachment removed. Choose “Use current scenario” to attach a snapshot again.'
      : changed ? 'The simulator has changed. This conversation still uses the snapshot below. Choose “Use current scenario” to attach the new values.'
      : selected.attached ? 'This snapshot is attached to your next question. Changing the simulator will not change the attachment.'
        : 'This is the scenario selected for this conversation. Choose “Use current scenario” to attach it again.');
  }
  save();
  if (announce) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => put('simulation-status', `${SCENARIOS[state.scenario]}: ${number(r.incoming)} incoming requests per second. CPU ${number(r.cpuPercent)} percent, database ${number(r.dbPercent)} percent. Illustrative hour ${money(r.total)}. ${number(r.deferred, 1)} requests per second deferred.`), 250);
  }
}
$('controls').addEventListener('submit', (event) => event.preventDefault());
$('controls').addEventListener('input', (event) => {
  const key = event.target.id;
  if (!Object.hasOwn(DEFAULTS, key)) return;
  // Leave an incomplete number editable; commit the last valid value on blur.
  if (key === 'budget' && (!event.target.value || !event.target.validity.valid)) return;
  state = normalize({ ...state, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  render(true);
});
$('budget').addEventListener('blur', () => { $('budget').value = state.budget; });
function setScenario(next) { state = normalize(next); syncControls(); render(true); }
$('reset').addEventListener('click', () => setScenario(DEFAULTS));
for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => setScenario(PRESETS[button.dataset.preset]));
function renderMotion() {
  const off = paused || reducedMotion.matches;
  $('simulator').classList.toggle('paused', off);
  $('motion').textContent = reducedMotion.matches ? 'Reduced motion' : paused ? 'Resume motion ▷' : 'Pause motion Ⅱ';
  $('motion').setAttribute('aria-pressed', String(off));
  $('motion').disabled = reducedMotion.matches;
}
$('motion').addEventListener('click', () => { paused = !paused; renderMotion(); });
reducedMotion.addEventListener('change', renderMotion);
function showContext() {
  if (!selected) return;
  const r = calculate(selected.state);
  put('selected-item', selected.focus.toLowerCase() + '.');
  put('context-summary', `${r.profile.name} · ${SCENARIOS[r.state.scenario]} · ${number(r.incoming)} incoming req/s · ${money(r.total)} for one illustrative hour.`);
  put('context-preview', scenarioContext(r, selected.focus));
}
async function ensureChat() {
  if (chat) return chat;
  if (loadingChat) return loadingChat;
  loadingChat = (async () => {
    try {
      await import('./stand-inline.js');
      chat = document.createElement('stand-inline');
      chat.id = 'launch-chat';
      chat.setAttribute('site', SITE_ID);
      chat.setAttribute('scope', 'launchmere-v1');
      chat.setAttribute('look', 'card');
      chat.setAttribute('grow', 'unfold');
      chat.setAttribute('placeholder', 'What would you like to understand?');
      chat.setAttribute('reply-placeholder', 'Continue the conversation…');
      // The reusable element accepts an explicit offline slot instead of
      // disappearing when discovery finds no responder.
      const offline = document.createElement('div');
      offline.slot = 'offline';
      offline.className = 'chat-offline';
      const offlineText = document.createElement('p');
      offlineText.setAttribute('role', 'status');
      const retry = document.createElement('button');
      retry.className = 'text-button';
      retry.textContent = 'Check availability ↻';
      retry.addEventListener('click', () => void chat.client.retry());
      offline.append(offlineText, retry);
      chat.append(offline);
      chat.addEventListener('stand-inline-message', (event) => {
        if (event.detail.from === 'visitor' && selected) {
          selected.attached = false;
          render();
        }
      });
      chat.addEventListener('stand-inline-quote-remove', () => {
        chat.removeAttribute('prompt');
        if (selected) { selected.attached = false; selected.removed = true; render(); }
      });
      $('chat-mount').append(chat);
      chat.client.subscribe((s) => {
        offlineText.textContent = s.error === 'connect'
          ? 'We couldn’t reach Stand Chat. Check your connection and try again. Your local scenario is still here.'
          : 'No responder is available right now. Your local scenario is still here; check again when you’re ready.';
        // A selection cannot race a send and change its context.
        for (const button of document.querySelectorAll('[data-focus], #update-context')) button.disabled = s.busy;
      });
      return chat;
    } catch {
      $('chat-load-error').hidden = false;
      return null;
    } finally { loadingChat = null; }
  })();
  return loadingChat;
}
async function selectContext(focus, trigger, restore = false) {
  if (chat?.client.getSnapshot().busy) return;
  if (!restore) selected = { state: { ...state }, focus, attached: true };
  lastTrigger = trigger || lastTrigger;
  $('conversation').hidden = false;
  showContext();
  render();
  const current = await ensureChat();
  if (current && selected) {
    const context = scenarioContext(calculate(selected.state), selected.focus);
    if (selected.removed) current.removeAttribute('prompt');
    else current.setAttribute('prompt', context);
    // Failed sends restore their complete text as an editable draft. Do not
    // prepend the attachment a second time to that recovered message.
    if (selected.attached && !current.draft.includes(context.split('\n')[0])) current.quote = context;
    if (!restore) current.focus({ preventScroll: true });
  }
  if (!restore) $('conversation').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
}
for (const button of document.querySelectorAll('[data-focus]')) button.addEventListener('click', () => void selectContext(button.dataset.focus, button));
$('update-context').addEventListener('click', () => void selectContext(selected?.focus || 'Full launch bill'));
$('close-chat').addEventListener('click', () => {
  $('conversation').hidden = true;
  // Hiding the view keeps the conversation alive; End chat is a separate action.
  (lastTrigger || $('reset')).focus({ preventScroll: true });
  (lastTrigger || $('simulator')).scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'center' });
});
syncControls();
render();
renderMotion();
if (selected) void selectContext(selected.focus, null, true);
