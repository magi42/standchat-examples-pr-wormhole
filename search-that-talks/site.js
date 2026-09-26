// Hookline's page: the omnibox in the hero, the stack builder, the flow
// gallery, the animated tour and the small things around them. The
// conversation itself lives in omnibox.js.

import { getClient } from './stand-visitor.js';
import { createOmnibox } from './omnibox.js';
import { APP_BY_ID, FLOW_BY_ID, GALLERY } from './catalog.js';
import { resolveFlow, suggestFlows, flowSentence, flowIcons, FlowEditor } from './flows.js';
import { appIcon } from './icons.js';
import { html, raw, setHTML, reducedMotion } from './dom.js';
import { stack } from './stack.js';
import { PROMPT } from './prompt.js';

// Stand Chat's shared demo site: answers on any domain. Use your own Site ID from Sites in Stand.
const client = getClient({ site: 'demo' });

// Exported for tests and previews: omnibox.useClient(fake) renders any state.
export const omnibox = createOmnibox(document.querySelector('.omni'), { client, onOpenFlow: openFlow });

// The stack builder -----------------------------------------------------------

const panel = document.querySelector('[data-stack-panel]');
const editor = new FlowEditor(document.querySelector('[data-stack-editor]'), {
  onAddApps: (flow) => {
    stack.add(flow.trigger.app.id);
    stack.add(flow.action.app.id);
  },
  hasApp: (id) => stack.has(id),
  onAsk: (flow) => omnibox.askAbout({ flow }),
});
let chosen = null; // a flow the visitor opened, rather than one suggested for the stack

function renderStack() {
  const apps = stack.apps;
  const flows = suggestFlows(stack.ids);
  setHTML(panel, html`
    <p class="stack-h">In your stack <span>${apps.length}</span></p>
    ${apps.length ? html`
      <ul class="stack-apps">
        ${apps.map((a) => html`<li>${raw(appIcon(a, { size: 28 }))}<span>${a.name}</span><button type="button" class="stack-x" data-remove="${a.id}" aria-label="Remove ${a.name} from your stack">×</button></li>`)}
      </ul>` : html`<p class="stack-empty">Nothing yet. Search above, then use <b>Add to stack</b> on an app or on an answer’s app card.</p>`}
    <p class="stack-h">${flows.length ? 'Flows for your stack' : 'Flows'}</p>
    ${flows.length ? html`
      <ul class="stack-flows">
        ${flows.map((f) => html`<li><button type="button" class="stack-flow" data-flow-key="${f.key}" aria-pressed="${String(editor.flow?.key === f.key)}">${flowIcons(f, 22)}${flowSentence(f)}</button></li>`)}
      </ul>` : html`<p class="stack-empty">${apps.length === 1 ? 'Add one more app and Hookline suggests flows between them.' : 'With two apps in your stack, suggested flows show up here.'}</p>`}`);

  // The canvas shows what the visitor opened, else the first suggestion, else an example.
  if (chosen) return editor.refreshStack();
  const next = flows[0];
  if (next && editor.flow?.key !== next.key && !flows.some((f) => f.key === editor.flow?.key)) editor.set(next);
  else if (!next && (!editor.flow || !editor.example)) editor.set(resolveFlow(FLOW_BY_ID.get('form-to-crm')), { example: true });
  else editor.refreshStack();
  panel.querySelectorAll('[data-flow-key]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.flowKey === editor.flow?.key)));
}

panel.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.remove) stack.remove(button.dataset.remove);
  if (button.dataset.flowKey) {
    const flow = suggestFlows(stack.ids).find((f) => f.key === button.dataset.flowKey);
    if (!flow) return;
    chosen = null;
    editor.set(flow);
    panel.querySelectorAll('[data-flow-key]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  }
});

/** Opens a flow in the stack builder, from the gallery or an app card. */
function openFlow(flow) {
  chosen = flow;
  editor.set(flow);
  renderStack();
  const section = document.getElementById('stack');
  section.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  section.querySelector('[data-test]')?.focus({ preventScroll: true });
}

stack.subscribe(renderStack);
renderStack();

// The gallery ------------------------------------------------------------------

setHTML(document.querySelector('[data-gallery]'), html`${GALLERY.map((id) => {
  const flow = resolveFlow(FLOW_BY_ID.get(id));
  return html`
    <li class="template">
      <div class="template-top">${flowIcons(flow, 30)}<span class="template-kind">${flow.trigger.instant ? 'Instant' : 'Scheduled'}</span></div>
      <h3 class="template-title">${flow.title}</h3>
      <p class="template-steps">${flowSentence(flow)}</p>
      <div class="template-foot">
        <span>${flow.trigger.app.name} + ${flow.action.app.name}</span>
        <button type="button" class="template-try" data-template="${id}" aria-label="Try it: ${flow.title}">Try it <span aria-hidden="true">→</span></button>
      </div>
    </li>`;
})}`);

document.querySelector('[data-gallery]').addEventListener('click', (event) => {
  const button = event.target.closest('[data-template]');
  if (button) openFlow(resolveFlow(FLOW_BY_ID.get(button.dataset.template), { stack: stack.ids }));
});

// The hero's floating app icons -----------------------------------------------------

// [app, x in % of the width, y in px from the hero's top, tilt, size]: in the gutters, clear of the text.
const FLOATS = [
  ['pipewell', 7, 170, -8, 56], ['formlane', 14, 320, 9, 42], ['chatterbox', 5, 460, 6, 50], ['ledgerly', 12, 610, -5, 44],
  ['textbeam', 6, 750, 10, 40], ['gridwell', 93, 160, 8, 54], ['deskpilot', 86, 310, -9, 42], ['slotbook', 95, 450, -6, 48],
  ['shopwright', 88, 600, 5, 50], ['webhooks', 94, 745, -8, 42],
];
setHTML(document.querySelector('.hero-floats'), html`${FLOATS.map(([id, x, y, r, s], i) => html`
  <span class="float" style="--x:${x}%;--y:${y}px;--r:${r}deg;--s:${s}px;--d:${((i * 0.37) % 2.6).toFixed(2)}s">${raw(appIcon(APP_BY_ID.get(id), { size: s }))}</span>`)}`);

// The tour: app chips, and the animation only while it's on screen.
for (const chip of document.querySelectorAll('[data-app-chip]')) {
  const app = APP_BY_ID.get(chip.dataset.appChip);
  setHTML(chip, html`${raw(appIcon(app, { size: 18, className: 'app-icon app-icon-xs' }))}${app.name}`);
}
const tour = document.querySelector('[data-tour]');
new IntersectionObserver(([entry]) => tour.classList.toggle('is-playing', entry.isIntersecting && !reducedMotion()), { threshold: 0.35 }).observe(tour);

// Pricing: yearly or monthly -------------------------------------------------------------

document.querySelector('.billing').addEventListener('change', (event) => {
  const monthly = event.target.value === 'monthly';
  for (const amount of document.querySelectorAll('[data-yearly]')) amount.textContent = monthly ? amount.dataset.monthly : amount.dataset.yearly;
});

// Buttons around the page that use the search box --------------------------------------

document.addEventListener('click', (event) => {
  const prefill = event.target.closest('[data-prefill]');
  if (prefill) {
    event.preventDefault();
    closeMenu();
    return omnibox.prefill(prefill.dataset.prefill);
  }
  const focus = event.target.closest('[data-focus-search]');
  if (focus) {
    event.preventDefault();
    closeMenu();
    return omnibox.focus();
  }
  const appLink = event.target.closest('[data-app-link]');
  if (appLink) return omnibox.openApp(appLink.dataset.appLink);
  const letter = event.target.closest('[data-letter]');
  if (letter) return omnibox.browseLetter(letter.dataset.letter);
  const flowLink = event.target.closest('[data-flow-link]');
  if (flowLink) openFlow(resolveFlow(FLOW_BY_ID.get(flowLink.dataset.flowLink), { stack: stack.ids }));
});

// The footer: A–Z and app links, all into the search box.
const letters = new Set([...APP_BY_ID.values()].map((a) => a.name[0].toUpperCase()));
setHTML(document.querySelector('[data-az]'), html`${[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => (letters.has(l)
  ? html`<button type="button" data-letter="${l}" aria-label="Apps starting with ${l}">${l}</button>`
  : html`<span aria-hidden="true">${l}</span>`))}`);
for (const list of document.querySelectorAll('[data-footer-apps]')) {
  setHTML(list, html`${list.dataset.footerApps.split(' ').map((id) => html`<li><button type="button" data-app-link="${id}">${APP_BY_ID.get(id).name}</button></li>`)}`);
}
setHTML(document.querySelector('[data-footer-flows]'), html`${['form-to-crm', 'booking-to-sms', 'invoice-to-sheet', 'webhook-to-record'].map((id) => html`<li><button type="button" data-flow-link="${id}">${FLOW_BY_ID.get(id).title}</button></li>`)}`);

// The header on phones: a menu for the nav links.
const menu = document.querySelector('.hl-menu');
const nav = document.getElementById('hl-nav');
function closeMenu() {
  if (menu.getAttribute('aria-expanded') !== 'true') return;
  menu.setAttribute('aria-expanded', 'false');
  nav.classList.remove('is-open');
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
  if (open) nav.querySelector('a')?.focus();
});
nav.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && nav.classList.contains('is-open')) {
    closeMenu();
    menu.focus();
  }
});

// "How it works": the prompt's length, and what the next message would carry.
const promptLength = document.querySelector('[data-prompt-length]');
if (promptLength) promptLength.textContent = PROMPT.length.toLocaleString('en-US');
const liveContext = document.querySelector('[data-live-context] code');
if (liveContext) {
  const update = () => (liveContext.textContent = omnibox.preview());
  document.querySelector('.omni').addEventListener('omni:render', update);
  update();
}
