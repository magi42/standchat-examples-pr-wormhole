// The "Start your store" wizard: six steps in one admin-style card.
//
// It knows nothing about chat. It renders the questions from steps.js, keeps
// the answers in sessionStorage for this tab, and offers two things to the
// advisor: an ask slot at the foot of every step, and reveal(), which a
// reference in a reply uses to open a step, a plan or a checklist item.
//
// Events: 'change' (answers changed) and 'step' (another step is showing).

import { icon, flag, dotMap } from './art.js';
import {
  CATALOG, CHANNELS, COUNTRIES, COUNTRY_ORDER, LOOKS, SALES_COUNT, SELLS, STEPS, TEAM, WIZARD_PLANS,
  apps, checklist, defaultAnswers, home, plan, planReasons, recommend, salesLabel, shownPlan, slug,
} from './steps.js';

const STORAGE_KEY = 'ask-at-any-step:v1:wizard';
// Addresses already in use, including two of the stores on this page.
const TAKEN = new Set(['shop', 'store', 'awning', 'admin', 'test', 'demo', 'tallow-and-wick', 'paper-moth-press']);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The store's address: the name as a slug, or a free variant when it's taken. */
export function domainFor(name) {
  const base = slug(name);
  return TAKEN.has(base) ? `${base}-shop` : base;
}

export class Wizard extends EventTarget {
  #root;
  #answers;
  #step = 1;
  #extra = { checklist: [], apps: [] }; // Items a reply pointed at that the answers didn't call for.
  #open = ''; // The expanded checklist item.
  #returnTo = 0; // The step a reference jumped away from.
  #panels = new Map();
  #domainTimer = 0;
  #saveTimer = 0;

  constructor(root) {
    super();
    this.#root = root;
    this.#answers = defaultAnswers(navigator.language);
    this.#restore();
    this.#build();
    this.#sync();
    this.#show(this.#step, { instant: true });
  }

  get answers() {
    return this.#answers;
  }

  get step() {
    return this.#step;
  }

  /** The element at the foot of step n where the advisor puts its field. */
  askSlot(n) {
    return this.#panels.get(n)?.querySelector('[data-ask-slot]');
  }

  go(n, { focus = true, from = 0 } = {}) {
    const target = Math.min(Math.max(1, Number(n) || 1), STEPS.length);
    this.#returnTo = from && from !== target ? from : 0;
    if (target === this.#step) {
      this.#updateHead();
      if (focus) this.#focusTitle();
      return;
    }
    this.#show(target, { direction: target > this.#step ? 1 : -1 });
    if (focus) this.#focusTitle();
    this.#bringIntoView();
  }

  /** Follows a reference from a reply: opens its step and points at the thing. */
  reveal(ref) {
    const from = this.#step;
    if (ref.kind === 'step') {
      this.go(ref.target, { from });
      this.#flash(this.#panels.get(ref.target)?.querySelector('.wz-title'));
      return;
    }
    if (ref.kind === 'plan') {
      this.#answers.plan = ref.target;
      this.#changed('plan');
    }
    if (ref.kind === 'checklist' && !checklist(this.#answers).some((item) => item.id === ref.target)) {
      this.#extra.checklist = [...new Set([...this.#extra.checklist, ref.target])];
    }
    if (ref.kind === 'app' && !apps(this.#answers).some((app) => app.id === ref.target)) {
      this.#extra.apps = [...new Set([...this.#extra.apps, ref.target])];
    }
    if (ref.kind === 'checklist') this.#open = ref.target;
    this.#renderPlan();
    this.go(6, { focus: false, from });
    const target = ref.kind === 'plan'
      ? this.#root.querySelector('[data-plan-card]')
      : ref.kind === 'app'
        ? this.#root.querySelector(`[data-app="${ref.target}"]`)
        : this.#root.querySelector(`[data-item="${ref.target}"] .wz-check-toggle`);
    if (!target) return;
    target.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
    this.#flash(ref.kind === 'checklist' ? target.closest('.wz-check-item') : target);
    this.#save();
  }

  /** Small dots on the progress bar: which steps have questions and answers. */
  markSteps(counts) {
    for (const button of this.#root.querySelectorAll('[data-go]')) {
      const n = Number(button.dataset.go);
      const count = counts.get(n) ?? 0;
      button.querySelector('.wz-dot').hidden = count === 0;
      button.setAttribute('aria-label', `Step ${n}: ${STEPS[n - 1].name}${count ? `, ${count} question${count > 1 ? 's' : ''} asked` : ''}`);
    }
  }

  // Building --------------------------------------------------------------

  #build() {
    const steps = STEPS.map((s) => `
      <section class="wz-step" data-step="${s.n}" aria-labelledby="wz-t${s.n}" hidden>
        <h2 class="wz-title" id="wz-t${s.n}" tabindex="-1"><span class="aw-sr">Step ${s.n} of ${STEPS.length}: </span>${s.title}</h2>
        <p class="wz-hint">${s.hint}</p>
        <div class="wz-content">${this.#stepContent(s.n)}</div>
        <div class="wz-ask" data-ask-slot="${s.n}"></div>
      </section>`).join('');

    this.#root.innerHTML = `
      <div class="wz-card">
        <div class="wz-head">
          <ol class="wz-progress">
            ${STEPS.map((s) => `<li><button type="button" data-go="${s.n}" aria-label="Step ${s.n}: ${s.name}"><span class="wz-bar"></span><span class="wz-dot" hidden></span></button></li>`).join('')}
          </ol>
          <p class="wz-count" aria-hidden="true">Step <span data-count>1</span> of ${STEPS.length}</p>
          <button type="button" class="wz-return" data-return hidden>${icon('back', { size: 16 })}<span></span></button>
          <button type="button" class="wz-advisor" data-advisor-open aria-haspopup="dialog" aria-expanded="false" aria-label="Store advisor">${icon('sparkle', { size: 16 })}<span>Advisor</span><span class="aw-count" data-advisor-count hidden></span></button>
        </div>
        <div class="wz-steps">${steps}</div>
        <div class="wz-foot">
          <button type="button" class="ad-btn" data-back>${icon('back', { size: 16 })}Back</button>
          <button type="button" class="ad-btn ad-btn-primary" data-next>Continue${icon('arrow', { size: 16 })}</button>
        </div>
      </div>
      <p class="wz-toast" data-toast role="status" hidden></p>`;

    for (const panel of this.#root.querySelectorAll('.wz-step')) this.#panels.set(Number(panel.dataset.step), panel);
    this.#wire();
  }

  #stepContent(n) {
    const tiles = (name, options) => `<div class="wz-tiles" role="group" aria-labelledby="wz-t${n}">${options.map((o) => `
      <label class="wz-tile">
        <input type="checkbox" name="${name}" value="${o.id}">
        <span class="wz-tile-icon">${icon(o.icon)}</span>
        <span class="wz-tile-text"><span class="wz-tile-label">${o.label}</span><span class="wz-tile-detail">${o.detail}</span></span>
        <span class="wz-tick" aria-hidden="true">${icon('check', { size: 14 })}</span>
      </label>`).join('')}</div>`;
    const segmented = (name, legend, options) => `
      <fieldset class="wz-field">
        <legend class="wz-label">${legend}</legend>
        <div class="wz-segmented">${options.map((label, i) => `<label><input type="radio" name="${name}" value="${i}"><span>${label}</span></label>`).join('')}</div>
      </fieldset>`;

    switch (n) {
      case 1:
        return tiles('sells', SELLS);
      case 2:
        return tiles('channels', CHANNELS);
      case 3:
        return `
          <div class="wz-map" data-map></div>
          <div class="wz-chips" role="group" aria-labelledby="wz-t3">${COUNTRY_ORDER.map((code) => `
            <label class="wz-chip">
              <input type="checkbox" name="markets" value="${code}">
              <span class="wz-flag">${flag(code)}</span>
              <span>${COUNTRIES[code].name}</span>
            </label>`).join('')}</div>
          <div class="wz-home">
            <label class="wz-label" for="wz-home">Home market</label>
            <span class="wz-select"><select id="wz-home" data-home></select>${icon('down', { size: 16 })}</span>
            <span class="wz-home-note" data-home-note></span>
          </div>`;
      case 4:
        return `
          <div class="wz-field">
            <div class="wz-field-head"><label class="wz-label" for="wz-sales">Monthly sales</label><output for="wz-sales" data-sales-out></output></div>
            <input class="wz-range" id="wz-sales" type="range" min="0" max="${SALES_COUNT - 1}" step="1" data-sales>
            <div class="wz-range-scale" aria-hidden="true" data-sales-scale></div>
          </div>
          ${segmented('catalog', 'Products in your catalogue', CATALOG)}
          ${segmented('team', 'People working on the shop', TEAM)}`;
      case 5:
        return `
          <div class="wz-field">
            <label class="wz-label" for="wz-name">Store name</label>
            <input class="wz-input" id="wz-name" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Tallow &amp; Wick" data-name>
            <p class="wz-domain">
              ${icon('lock', { size: 16 })}
              <span class="wz-domain-name"><b data-slug></b>.awning.shop</span>
              <span class="wz-domain-state" data-domain-state role="status"></span>
            </p>
          </div>
          <fieldset class="wz-field">
            <legend class="wz-label">Pick a starting look</legend>
            <div class="wz-looks">${LOOKS.map((look) => `
              <label class="wz-look" data-look="${look.id}">
                <input type="radio" name="look" value="${look.id}">
                <span class="wz-look-swatch" aria-hidden="true"><b>Aa</b><i></i></span>
                <span class="wz-look-text"><span>${look.label}</span><small>${look.note}</small></span>
              </label>`).join('')}</div>
          </fieldset>`;
      case 6:
        return `
          <div class="wz-plan" data-plan-card tabindex="-1">
            <div class="wz-plan-top">
              <span class="ad-badge ad-badge-success" data-plan-badge>${icon('star', { size: 14 })}Recommended for you</span>
              <p class="wz-plan-price"><b data-plan-price></b><span data-plan-per></span></p>
            </div>
            <h3 class="wz-plan-name" data-plan-name></h3>
            <p class="wz-plan-for" data-plan-for></p>
            <ul class="wz-reasons" data-plan-reasons></ul>
            <div class="wz-plan-switch" role="radiogroup" aria-label="Compare plans">${WIZARD_PLANS.map((id) => `
              <label><input type="radio" name="plan" value="${id}"><span>${plan(id).name}</span></label>`).join('')}</div>
          </div>
          <div class="wz-apps" data-apps hidden>
            <h3 class="wz-subhead">Apps for your answers</h3>
            <ul data-app-list></ul>
          </div>
          <div class="wz-checklist">
            <h3 class="wz-subhead">Your setup checklist <span data-check-count></span></h3>
            <ul data-checklist></ul>
          </div>
          <div class="wz-launch">
            <button type="button" class="ad-btn ad-btn-primary ad-btn-large" data-launch>Start free trial</button>
            <p>14 days free, no card needed.</p>
          </div>
          <p class="wz-launch-note" data-launch-note role="status" hidden>Awning is made up, so there’s no trial to start. The questions you asked here were real, though: they went to an AI Stand-in through Stand, with your answers attached.</p>`;
      default:
        return '';
    }
  }

  #wire() {
    const root = this.#root;
    root.addEventListener('change', (event) => {
      const input = event.target;
      const a = this.#answers;
      if (input.name === 'sells' || input.name === 'channels') {
        const list = new Set(a[input.name]);
        if (input.checked) list.add(input.value);
        else list.delete(input.value);
        // "Nowhere yet" and the channels exclude each other.
        if (input.name === 'channels' && input.checked) {
          if (input.value === 'none') {
            list.clear();
            list.add('none');
          } else {
            list.delete('none');
          }
        }
        const order = (input.name === 'sells' ? SELLS : CHANNELS).map((o) => o.id);
        a[input.name] = order.filter((id) => list.has(id));
        this.#changed(input.name);
      } else if (input.name === 'markets') {
        if (input.checked) a.markets = [...a.markets, input.value];
        else if (a.markets.length > 1) a.markets = a.markets.filter((code) => code !== input.value);
        else input.checked = true; // Somebody has to be the customer.
        this.#changed('markets');
      } else if (input.matches('[data-home]')) {
        a.markets = [input.value, ...a.markets.filter((code) => code !== input.value)];
        this.#changed('markets');
      } else if (input.name === 'catalog' || input.name === 'team') {
        a[input.name] = Number(input.value);
        this.#changed(input.name);
      } else if (input.name === 'look') {
        a.look = input.value;
        this.#changed('look');
      } else if (input.name === 'plan') {
        a.plan = input.value === recommend(a).plan ? null : input.value;
        this.#changed('plan');
      }
    });

    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-sales]')) {
        this.#answers.sales = Number(event.target.value);
        this.#changed('sales');
      } else if (event.target.matches('[data-name]')) {
        this.#answers.name = event.target.value.slice(0, 40);
        this.#checkDomain();
        this.#changed('name');
      }
    });

    root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      if (button.matches('[data-next]')) this.go(this.#step + 1);
      else if (button.matches('[data-back]')) this.go(this.#step - 1);
      else if (button.matches('[data-go]')) this.go(Number(button.dataset.go));
      else if (button.matches('[data-return]')) this.go(this.#returnTo);
      else if (button.matches('.wz-check-toggle')) {
        const id = button.closest('[data-item]').dataset.item;
        this.#open = this.#open === id ? '' : id;
        this.#renderChecklist();
        this.#save();
      } else if (button.matches('[data-launch]')) {
        const note = root.querySelector('[data-launch-note]');
        note.hidden = false;
        this.#flash(note);
      }
    });

    // Enter in the name field moves on, like any form.
    root.querySelector('[data-name]').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        this.go(this.#step + 1);
      }
    });
  }

  // State -----------------------------------------------------------------

  #changed(key) {
    this.#sync(key);
    this.#save();
    this.dispatchEvent(new CustomEvent('change', { detail: { key } }));
  }

  #show(n, { direction = 1, instant = false } = {}) {
    const previous = this.#panels.get(this.#step);
    const next = this.#panels.get(n);
    this.#step = n;
    if (!this.#answers.seen.includes(n)) this.#answers.seen = [...this.#answers.seen, n].sort();
    for (const [k, panel] of this.#panels) {
      if (panel !== next) panel.hidden = true;
      if (k !== n) panel.classList.remove('is-entering');
    }
    next.hidden = false;
    if (!instant && previous !== next && !reducedMotion()) {
      next.style.setProperty('--from', `${direction * 18}px`);
      next.classList.remove('is-entering');
      void next.offsetWidth; // Restart the entrance.
      next.classList.add('is-entering');
    }
    this.#updateHead();
    if (n === 6) this.#renderPlan();
    this.#save();
    this.dispatchEvent(new CustomEvent('step', { detail: { step: n } }));
  }

  #updateHead() {
    const root = this.#root;
    for (const button of root.querySelectorAll('[data-go]')) {
      const n = Number(button.dataset.go);
      button.classList.toggle('is-done', n < this.#step);
      button.classList.toggle('is-current', n === this.#step);
      if (n === this.#step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    root.querySelector('[data-count]').textContent = String(this.#step);
    root.querySelector('[data-back]').hidden = this.#step === 1;
    root.querySelector('[data-next]').hidden = this.#step === STEPS.length;
    const back = root.querySelector('[data-return]');
    back.hidden = !this.#returnTo;
    if (this.#returnTo) back.querySelector('span').textContent = `Back to ${STEPS[this.#returnTo - 1].name}`;
  }

  #focusTitle() {
    this.#panels.get(this.#step)?.querySelector('.wz-title')?.focus({ preventScroll: true });
  }

  #bringIntoView() {
    const card = this.#root.querySelector('.wz-card');
    const top = card.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight * 0.6) card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  #flash(element) {
    if (!element) return;
    element.classList.remove('is-flash');
    void element.offsetWidth;
    element.classList.add('is-flash');
    element.addEventListener('animationend', () => element.classList.remove('is-flash'), { once: true });
  }

  /** Puts the answers into the inputs and redraws what depends on them. */
  #sync(key = '') {
    const a = this.#answers;
    const root = this.#root;
    for (const input of root.querySelectorAll('input[name="sells"], input[name="channels"], input[name="markets"]')) {
      input.checked = a[input.name].includes(input.value);
    }
    for (const input of root.querySelectorAll('input[name="catalog"], input[name="team"]')) input.checked = Number(input.value) === a[input.name];
    for (const input of root.querySelectorAll('input[name="look"]')) input.checked = input.value === a.look;

    // Markets: the map, the home market and its currency.
    if (!key || key === 'markets') {
      root.querySelector('[data-map]').innerHTML = dotMap(a.markets);
      const select = root.querySelector('[data-home]');
      select.replaceChildren(...a.markets.map((code) => new Option(COUNTRIES[code].name, code)));
      select.value = a.markets[0];
      for (const chip of root.querySelectorAll('.wz-chip')) chip.classList.toggle('is-home', chip.querySelector('input').value === a.markets[0]);
      const h = home(a);
      root.querySelector('[data-home-note]').textContent = `Prices in ${h.currency}`;
    }

    // Size: the slider speaks the home currency.
    const currency = home(a).currency;
    const sales = root.querySelector('[data-sales]');
    sales.value = String(a.sales);
    sales.style.setProperty('--fill', `${(a.sales / (SALES_COUNT - 1)) * 100}%`);
    const label = salesLabel(a.sales, currency);
    root.querySelector('[data-sales-out]').textContent = a.sales === 0 ? label : `${label} a month`;
    sales.setAttribute('aria-valuetext', a.sales === 0 ? label : `${label} a month`);
    root.querySelector('[data-sales-scale]').innerHTML = `<span>${salesLabel(0, currency)}</span><span>${salesLabel(SALES_COUNT - 1, currency)}</span>`;

    // Name: keep the field as typed, show the address it becomes.
    const name = root.querySelector('[data-name]');
    if (name.value !== a.name) name.value = a.name;
    root.querySelector('[data-slug]').textContent = domainFor(a.name);
    if (!key) this.#domainState(true);

    if (this.#step === 6 || key === 'plan') this.#renderPlan();
  }

  #checkDomain() {
    clearTimeout(this.#domainTimer);
    const state = this.#root.querySelector('[data-domain-state]');
    if (!this.#answers.name.trim()) return this.#domainState(true);
    state.className = 'wz-domain-state is-checking';
    state.textContent = 'Checking…';
    this.#domainTimer = setTimeout(() => this.#domainState(), 450);
  }

  #domainState(quiet = false) {
    const state = this.#root.querySelector('[data-domain-state]');
    const base = slug(this.#answers.name);
    if (!this.#answers.name.trim()) {
      state.className = 'wz-domain-state';
      state.textContent = '';
      return;
    }
    const taken = TAKEN.has(base);
    state.className = `wz-domain-state ${taken ? 'is-taken' : 'is-free'}`;
    state.innerHTML = taken ? `${icon('info', { size: 14 })}<span></span>` : `${icon('check', { size: 14 })}<span></span>`;
    state.querySelector('span').textContent = taken ? `${base}.awning.shop is taken, so we added “-shop”` : 'Available';
    if (quiet) state.removeAttribute('role');
    else state.setAttribute('role', 'status');
  }

  #renderPlan() {
    const a = this.#answers;
    const root = this.#root;
    const picked = shownPlan(a);
    const recommended = recommend(a).plan;
    const p = plan(picked);
    root.querySelector('[data-plan-name]').textContent = p.name;
    root.querySelector('[data-plan-for]').textContent = p.for;
    root.querySelector('[data-plan-price]').textContent = `${p.from ? 'from ' : ''}$${p.price.toLocaleString('en-US')}`;
    root.querySelector('[data-plan-per]').textContent = ' USD/month after the trial';
    const badge = root.querySelector('[data-plan-badge]');
    badge.hidden = picked !== recommended;
    const reasons = planReasons(a, picked);
    const list = root.querySelector('[data-plan-reasons]');
    list.innerHTML = reasons.map(() => `<li>${icon('check', { size: 16 })}<span></span></li>`).join('');
    reasons.forEach((reason, i) => (list.children[i].querySelector('span').textContent = reason));
    for (const input of root.querySelectorAll('input[name="plan"]')) {
      input.checked = input.value === picked;
      input.closest('label').classList.toggle('is-recommended', input.value === recommended);
    }

    const appList = apps(a, this.#extra.apps);
    root.querySelector('[data-apps]').hidden = appList.length === 0;
    root.querySelector('[data-app-list]').innerHTML = appList.map((app) => `
      <li class="wz-app" data-app="${app.id}" tabindex="-1">
        <span class="wz-app-icon">${icon(app.icon)}</span>
        <span class="wz-app-text"><b>${app.name}</b><span>${app.detail}</span></span>
        <span class="ad-badge ${app.price === 'Included' || app.price === 'Free' ? 'ad-badge-success' : ''}">${app.price}</span>
      </li>`).join('');
    this.#renderChecklist();
  }

  #renderChecklist() {
    const items = checklist(this.#answers, this.#extra.checklist);
    const list = this.#root.querySelector('[data-checklist]');
    const called = new Set(checklist(this.#answers).map((item) => item.id));
    this.#root.querySelector('[data-check-count]').textContent = `${items.length} steps`;
    list.innerHTML = items.map((item) => `
      <li class="wz-check-item${item.id === this.#open ? ' is-open' : ''}" data-item="${item.id}">
        <button type="button" class="wz-check-toggle" aria-expanded="${item.id === this.#open}" aria-controls="wz-ci-${item.id}" id="wz-cb-${item.id}">
          <span class="wz-check-icon">${icon(item.icon, { size: 18 })}</span>
          <span class="wz-check-title"></span>
          ${called.has(item.id) ? '' : '<span class="ad-badge ad-badge-ai">From your question</span>'}
          ${icon('down', { size: 16, className: 'icon wz-check-chevron' })}
        </button>
        <div class="wz-check-detail" id="wz-ci-${item.id}" role="region" aria-labelledby="wz-cb-${item.id}"${item.id === this.#open ? '' : ' hidden'}><p></p></div>
      </li>`).join('');
    items.forEach((item, i) => {
      const li = list.children[i];
      li.querySelector('.wz-check-title').textContent = item.title;
      li.querySelector('.wz-check-detail p').textContent = item.detail;
    });
  }

  // Storage: answers and place, per tab. Storage can be denied: then it's memory only.

  #save() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ answers: this.#answers, step: this.#step, extra: this.#extra, open: this.#open }));
      } catch {
        // Private mode or full storage: the wizard still works.
      }
    }, 120);
  }

  #restore() {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return;
    }
    if (!saved || typeof saved !== 'object') return;
    const a = saved.answers ?? {};
    const pick = (list, allowed) => (Array.isArray(list) ? list.filter((v) => allowed.includes(v)) : []);
    const index = (value, max) => (Number.isInteger(value) && value >= 0 && value < max ? value : 0);
    const markets = pick(a.markets, COUNTRY_ORDER);
    this.#answers = {
      ...this.#answers,
      sells: pick(a.sells, SELLS.map((o) => o.id)),
      channels: pick(a.channels, CHANNELS.map((o) => o.id)),
      markets: markets.length ? [...new Set(markets)] : this.#answers.markets,
      sales: index(a.sales, SALES_COUNT),
      catalog: index(a.catalog, CATALOG.length),
      team: index(a.team, TEAM.length),
      name: typeof a.name === 'string' ? a.name.slice(0, 40) : '',
      look: LOOKS.some((look) => look.id === a.look) ? a.look : 'linen',
      plan: WIZARD_PLANS.includes(a.plan) ? a.plan : null,
      seen: pick(a.seen, [1, 2, 3, 4, 5, 6]),
    };
    if (!this.#answers.seen.includes(1)) this.#answers.seen.unshift(1);
    this.#step = index(saved.step - 1, STEPS.length) + 1;
    this.#extra = {
      checklist: pick(saved.extra?.checklist, ['payments', 'taxes', 'shipping', 'pos', 'domain', 'import']),
      apps: pick(saved.extra?.apps, ['subscriptions', 'bookings', 'downloads']),
    };
    this.#open = typeof saved.open === 'string' ? saved.open : '';
  }
}
