// Flows: two apps and what happens between them. resolveFlow() turns a
// template into concrete steps, suggestFlows() finds flows for a stack, and
// FlowEditor draws the steps as cards on a canvas, with a test run.

import { APP_BY_ID, FLOWS } from './catalog.js';
import { appIcon } from './icons.js';
import { html, raw, setHTML, reducedMotion } from './dom.js';

const firstCreate = (app) => app.actions.find((a) => /^create/i.test(a)) ?? app.actions[0];

/**
 * A template with its apps filled in. A template whose action app is open
 * ("Caught webhook → Create record") takes the first suitable app the
 * conversation mentioned, then the newest in the stack, then its fallback.
 */
export function resolveFlow(template, { mentioned = [], stack = [] } = {}) {
  const [triggerId, triggerEvent] = template.trigger;
  let [actionId, actionEvent] = template.action;
  if (!actionId) {
    const candidates = [...mentioned, ...[...stack].reverse()].map((id) => APP_BY_ID.get(id))
      .filter((app) => app && app.category !== 'builtin' && app.id !== triggerId && app.actions.some((a) => /^create/i.test(a)));
    const app = candidates[0] ?? APP_BY_ID.get(template.fallback);
    [actionId, actionEvent] = [app.id, firstCreate(app)];
  }
  const triggerApp = APP_BY_ID.get(triggerId);
  return {
    id: template.id,
    key: `${template.id}:${actionId}`,
    name: template.name,
    title: template.title,
    trigger: { app: triggerApp, event: triggerEvent, instant: triggerApp.triggers.find((t) => t.name === triggerEvent)?.instant ?? false },
    action: { app: APP_BY_ID.get(actionId), event: actionEvent },
  };
}

/** A plain flow between two apps: the first trigger of one, the first action of the other. */
export function pairFlow(from, to) {
  const trigger = from.triggers[0];
  const event = to.actions[0]; // the catalog lists each app's most-used action first
  return {
    id: `pair:${from.id}:${to.id}`,
    key: `pair:${from.id}:${to.id}`,
    name: `${trigger.name} → ${event}`,
    title: `${trigger.name} in ${from.name}, then ${event.toLowerCase()} in ${to.name}`,
    trigger: { app: from, event: trigger.name, instant: trigger.instant },
    action: { app: to, event },
  };
}

/** Flows between the apps in a stack: templates first, then simple pairs. */
export function suggestFlows(ids, limit = 5) {
  const flows = [];
  const pairs = new Set();
  for (const template of FLOWS) {
    const flow = resolveFlow(template, { stack: ids });
    if (ids.includes(flow.trigger.app.id) && ids.includes(flow.action.app.id)) {
      flows.push(flow);
      pairs.add(`${flow.trigger.app.id}>${flow.action.app.id}`);
    }
  }
  for (const a of ids) {
    for (const b of ids) {
      const from = APP_BY_ID.get(a);
      const to = APP_BY_ID.get(b);
      if (a === b || pairs.has(`${a}>${b}`) || !from.triggers.length || !to.actions.length) continue;
      flows.push(pairFlow(from, to));
      pairs.add(`${a}>${b}`);
    }
  }
  return flows.slice(0, limit);
}

const small = (app) => raw(appIcon(app, { size: 18, className: 'app-icon app-icon-xs' }));

/** "When New form entry in Formlane → Create contact in Pipewell", in the directory's step-card voice. */
export function flowSentence(flow) {
  return html`<span class="flow-sentence">When <b>${flow.trigger.event}</b> in <span class="nowrap">${small(flow.trigger.app)} ${flow.trigger.app.name}</span> <span class="flow-arrow" aria-label="then">→</span> <b>${flow.action.event}</b> in <span class="nowrap">${small(flow.action.app)} ${flow.action.app.name}</span></span>`;
}

/** Two app icons, overlapping like a template card's. */
export function flowIcons(flow, size = 32) {
  return html`<span class="flow-icons" aria-hidden="true">${raw(appIcon(flow.trigger.app, { size }))}${raw(appIcon(flow.action.app, { size }))}</span>`;
}

// Built-in steps the "+" between cards can add.
const EXTRA_STEPS = [
  { app: 'filter', event: 'Only continue if…', note: 'Checked the test record: passed' },
  { app: 'delay', event: 'Delay for 5 minutes', note: 'Skipped the wait in this test' },
  { app: 'reshape', event: 'Format text', note: 'Tidied 3 fields' },
  { app: 'branches', event: 'Split into branches', note: 'Took branch A' },
];

/**
 * The mini flow editor: trigger card, dashed connector with a "+", action card.
 * Horizontal when there's room for two cards, vertical otherwise (CSS decides).
 */
export class FlowEditor {
  #el;
  #flow = null;
  #extra = [];
  #options;
  #timers = [];

  constructor(el, options = {}) {
    this.#el = el;
    this.#options = options;
    el.classList.add('fe');
    el.addEventListener('click', (event) => this.#click(event));
    el.addEventListener('keydown', (event) => this.#key(event));
  }

  get flow() {
    return this.#flow;
  }

  /** Shows a flow. `enter: false` skips the entrance, for a re-render of the same flow. */
  set(flow, { example = false, enter = true } = {}) {
    this.#stop();
    this.#flow = flow;
    this.#extra = [];
    this.example = example;
    this.#render(enter);
  }

  #steps() {
    const f = this.#flow;
    return [
      { kind: 'Trigger', app: f.trigger.app, event: f.trigger.event, meta: f.trigger.instant ? 'Trigger · instant' : 'Trigger · checks on a schedule' },
      ...this.#extra.map((s) => ({ kind: 'Step', app: APP_BY_ID.get(s.app), event: s.event, meta: 'Built-in step', extra: s })),
      { kind: 'Action', app: f.action.app, event: f.action.event, meta: 'Action · 1 task per run' },
    ];
  }

  #render(entering = false) {
    const f = this.#flow;
    if (!f) return;
    const steps = this.#steps();
    const { compact } = this.#options;
    this.#el.dataset.steps = steps.length;
    setHTML(this.#el, html`
      <div class="fe-canvas${entering ? ' fe-enter' : ''}">
        ${this.example ? html`<p class="fe-example">Example flow</p>` : ''}
        <ol class="fe-steps" aria-label="Steps in this flow">
          ${steps.map((step, i) => html`
            <li class="fe-step" data-kind="${step.kind.toLowerCase()}" style="--i:${i}">
              ${i ? html`<div class="fe-link"><span class="fe-line"></span><button type="button" class="fe-plus" data-insert="${i}" aria-label="Add a step between step ${i} and step ${i + 1}" aria-haspopup="menu" aria-expanded="false">+</button><span class="fe-line"></span></div>` : ''}
              <div class="fe-card">
                <span class="fe-app">${raw(appIcon(step.app, { size: 18, className: 'app-icon app-icon-xs' }))}${step.app.name}</span>
                <span class="fe-title"><span class="fe-num">${i + 1}.</span> ${step.event}</span>
                <span class="fe-meta">${step.meta}</span>
                <span class="fe-result" role="status"></span>
                ${step.extra ? html`<button type="button" class="fe-remove" data-remove="${this.#extra.indexOf(step.extra)}" aria-label="Remove ${step.app.name} step">×</button>` : ''}
              </div>
            </li>`)}
        </ol>
        ${steps.length > 2 ? html`<p class="fe-note">Multi-step flows need Professional or above.</p>` : ''}
      </div>
      <div class="fe-actions">
        <button type="button" class="btn btn-dark btn-sm" data-test>Test flow</button>
        ${this.#options.onAddApps ? html`<button type="button" class="btn btn-outline btn-sm" data-add-apps>Add both apps to my stack</button>` : ''}
        ${this.#options.onAsk ? html`<button type="button" class="btn-link" data-ask-flow>Ask about this flow</button>` : ''}
      </div>`);
    this.#el.classList.toggle('fe-compact', Boolean(compact));
    if (this.#options.onAddApps) this.refreshStack?.();
  }

  /** Called when the stack changes, to keep "Add both apps" honest. */
  refreshStack(has = this.#options.hasApp) {
    const button = this.#el.querySelector('[data-add-apps]');
    if (!button || !has || !this.#flow) return;
    const both = has(this.#flow.trigger.app.id) && has(this.#flow.action.app.id);
    button.disabled = both;
    button.textContent = both ? 'Both apps are in your stack' : 'Add both apps to my stack';
  }

  #click(event) {
    const target = event.target.closest('button');
    if (!target || !this.#el.contains(target)) return;
    if (target.matches('[data-test]')) this.#test(target);
    else if (target.matches('[data-add-apps]')) {
      this.#options.onAddApps?.(this.#flow);
      this.refreshStack();
    } else if (target.matches('[data-ask-flow]')) this.#options.onAsk?.(this.#flow);
    else if (target.matches('.fe-plus')) this.#toggleMenu(target);
    else if (target.matches('[data-step]')) this.#insert(Number(target.closest('.fe-menu').dataset.at), EXTRA_STEPS[Number(target.dataset.step)]);
    else if (target.matches('[data-remove]')) {
      this.#extra.splice(Number(target.dataset.remove), 1);
      this.#stop();
      this.#render();
      this.#el.querySelector('[data-test]')?.focus();
    }
  }

  #key(event) {
    const menu = this.#el.querySelector('.fe-menu');
    if (!menu) return;
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.#closeMenu(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      this.#closeMenu(false);
    }
  }

  #toggleMenu(button) {
    const openFor = this.#el.querySelector('.fe-menu')?.previousElementSibling;
    this.#closeMenu(false);
    if (openFor === button) return;
    const at = Number(button.dataset.insert);
    button.setAttribute('aria-expanded', 'true');
    button.insertAdjacentHTML('afterend', String(html`
      <div class="fe-menu" role="menu" aria-label="Add a step" data-at="${at}">
        ${EXTRA_STEPS.map((s, i) => html`<button type="button" role="menuitem" data-step="${i}">${raw(appIcon(APP_BY_ID.get(s.app), { size: 18, className: 'app-icon app-icon-xs' }))}<span><b>${APP_BY_ID.get(s.app).name}</b> ${s.event}</span></button>`)}
      </div>`));
    this.#el.querySelector('.fe-menu [role="menuitem"]').focus();
    document.addEventListener('pointerdown', this.#outside);
  }

  #outside = (event) => {
    if (!event.target.closest?.('.fe-menu, .fe-plus')) this.#closeMenu(false);
  };

  #closeMenu(focusButton) {
    document.removeEventListener('pointerdown', this.#outside);
    const menu = this.#el.querySelector('.fe-menu');
    if (!menu) return;
    const button = menu.previousElementSibling;
    menu.remove();
    button?.setAttribute('aria-expanded', 'false');
    if (focusButton) button?.focus();
  }

  #insert(at, step) {
    this.#extra.splice(at - 1, 0, step);
    this.#stop();
    this.#render();
    this.#el.querySelectorAll('.fe-step')[at]?.classList.add('fe-new');
    this.#el.querySelector(`.fe-step:nth-of-type(${at + 1}) .fe-remove`)?.focus();
  }

  #stop() {
    this.#timers.forEach(clearTimeout);
    this.#timers = [];
  }

  // A pretend run with a sample record: each card lights up in turn.
  #test(button) {
    this.#stop();
    const steps = this.#steps();
    const cards = [...this.#el.querySelectorAll('.fe-step')];
    const links = [...this.#el.querySelectorAll('.fe-link')];
    cards.forEach((c) => c.classList.remove('fe-done', 'fe-running'));
    links.forEach((l) => l.classList.remove('fe-flowing'));
    cards.forEach((c) => (c.querySelector('.fe-result').textContent = ''));
    button.disabled = true;
    button.textContent = 'Testing…';
    const sample = sampleFor(this.#flow.trigger.event);
    const pace = reducedMotion() ? 0 : 650;
    const results = steps.map((step, i) => (i === 0
      ? `Found a test record: ${sample}`
      : step.kind === 'Action' ? `Sent to ${step.app.name}: ${step.event.toLowerCase()} ✓` : step.extra.note));
    steps.forEach((step, i) => {
      this.#timers.push(setTimeout(() => {
        cards[i - 1]?.classList.replace('fe-running', 'fe-done');
        links[i - 1]?.classList.add('fe-flowing');
        cards[i].classList.add('fe-running');
        cards[i].querySelector('.fe-result').textContent = results[i];
      }, i * pace));
    });
    this.#timers.push(setTimeout(() => {
      cards.at(-1).classList.replace('fe-running', 'fe-done');
      button.disabled = false;
      button.textContent = 'Test again';
    }, steps.length * pace));
  }
}

// A believable test record for a trigger, from the words in its name.
function sampleFor(event) {
  const e = event.toLowerCase();
  if (/hook/.test(e)) return 'invoice.created, id 7731, $1,280.00';
  if (/deal/.test(e)) return 'Kettle & Pine, Team plan, $9,600';
  if (/invoice|payment|expense|bill/.test(e)) return 'INV-2041, $1,280.00, Kettle & Pine';
  if (/ticket|email|conversation|mention/.test(e)) return '“Can’t export to CSV” from dana@kettlepine.example';
  if (/booking|event|meeting|reservation|registr/.test(e)) return 'Dana Ruiz, Tue 10:30, +1 555 0142';
  if (/order|cart/.test(e)) return 'Order #10482, 3 items, $84.00';
  if (/error|alert|monitor|incident/.test(e)) return 'TypeError in checkout.js, 14 users';
  if (/every|hour|day|week|month/.test(e)) return 'Run at 08:00, Tuesday';
  if (/notes|transcript|recording/.test(e)) return 'Weekly sync, 6 action items';
  if (/signed|document|file/.test(e)) return 'Kettle & Pine MSA.pdf';
  return 'Dana Ruiz, dana@kettlepine.example';
}
