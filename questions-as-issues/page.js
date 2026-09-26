// Axial's page around the tracker: the tilt that settles as you scroll, the
// FAQ grid, keycaps that light up, the import diagram, pricing, and the
// explainer's live view of what Stand receives. No Stand logic in here.

import { PEOPLE, SEEDED } from './seed.js';
import { statusIcon } from './icons.js';
import { MOD, animate, avatar, fill, h, reducedMotion } from './dom.js';
import { parseVisitorText } from './model.js';

let actions = {};
let settled = false;
let appRatio = 0;
let section = '';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

/** actions: { newIssue(fields), open(id), key(action), fictional() } */
export function init(handlers) {
  actions = handlers;
  tilt();
  faqGrid();
  keycaps();
  importDiagram();
  pricing();
  sections();
  fab();
  for (const button of $$('[data-new-issue]')) {
    button.addEventListener('click', () => actions.newIssue({
      from: button.dataset.from,
      labels: button.dataset.label ? [button.dataset.label] : [],
      title: button.dataset.title ?? '',
    }));
  }
  for (const button of $$('[data-fictional]')) button.addEventListener('click', () => actions.fictional(button.textContent.trim()));
  // The explainer's lifecycle table uses the tracker's own status icons.
  for (const el of $$('[data-status-icon]')) el.innerHTML = statusIcon(el.dataset.statusIcon);
}

// The app window leans back, and settles flat as you scroll to it. Using the
// tracker settles it at once: nobody should have to click on a tilted UI.
function tilt() {
  const tiltEl = $('.ax-tilt');
  if (!tiltEl) return;
  const frame = () => {
    const flat = settled || reducedMotion() || innerWidth < 900;
    const p = flat ? 1 : Math.min(1, Math.max(0, scrollY / 340));
    const eased = 1 - (1 - p) ** 2;
    tiltEl.style.setProperty('--tilt', `${(14 * (1 - eased)).toFixed(2)}deg`);
    // Scaled so the edge that leans toward you never grows past the column.
    tiltEl.style.setProperty('--tilt-scale', (0.94 + 0.06 * eased).toFixed(4));
  };
  let queued = false;
  addEventListener('scroll', () => {
    if (settled || queued) return;
    queued = true;
    tiltEl.classList.add('is-scrolling');
    requestAnimationFrame(() => {
      queued = false;
      frame();
      clearTimeout(tilt.timer);
      tilt.timer = setTimeout(() => tiltEl.classList.remove('is-scrolling'), 120);
    });
  }, { passive: true });
  addEventListener('resize', frame);
  tiltEl.addEventListener('pointerdown', settle, { once: true });
  tiltEl.addEventListener('focusin', settle, { once: true });
  frame();
  tilt.frame = frame;
}

export function settle() {
  if (settled) return;
  settled = true;
  $('.ax-tilt')?.classList.remove('is-scrolling');
  tilt.frame?.();
}

// FAQ grid -----------------------------------------------------------------------

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function faqGrid() {
  const grid = $('#faq-grid');
  if (!grid) return;
  for (const seed of SEEDED) {
    const person = { ...PEOPLE[seed.assignee], kind: 'team' };
    const excerpt = seed.answer.replace(/\*\*/g, '').split('\n')[0];
    const filed = Date.parse(`${seed.filed}:00Z`);
    grid.append(h('li', {}, h('button', { type: 'button', class: 'ax-faq-card', 'aria-label': `${seed.id}: ${seed.title}. Open in the tracker`, onclick: () => actions.open(seed.id) },
      h('span', { class: 'ax-faq-meta' }, h('span', { html: statusIcon('done') }), seed.id, h('time', { datetime: new Date(filed).toISOString(), text: DAY.format(filed) })),
      h('span', { class: 'ax-faq-title', text: seed.title }),
      h('span', { class: 'ax-faq-text', text: excerpt }),
      h('span', { class: 'ax-faq-foot' }, avatar(person, 18), person.name, h('span', { class: 'ax-faq-asked', text: `Asked by ${seed.asked} teams` })))));
  }
  grid.append(h('li', { class: 'ax-faq-own' }, h('button', { type: 'button', class: 'ax-faq-card', onclick: () => actions.newIssue({ from: 'the list of common questions' }) },
    h('span', { class: 'ax-faq-plus', html: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' }),
    h('span', { class: 'ax-faq-title', text: 'Not on the list?' }),
    h('span', { class: 'ax-faq-text' }, 'File it as an issue. It gets picked up in seconds.', h('span', { class: 'ax-keys-only' }, ' Press ', h('kbd', { text: 'C' }), ' anywhere.')))));
}

// Keycaps ------------------------------------------------------------------------------

function keycaps() {
  for (const glyph of $$('.ax-cmd-glyph')) glyph.textContent = MOD;
  for (const cap of $$('.ax-keycap')) {
    cap.addEventListener('click', () => {
      press(cap.dataset.key);
      actions.key(cap.dataset.action, cap);
    });
  }
}

/** Lights the keycap for a key the visitor pressed anywhere on the page. */
export function press(key) {
  const cap = document.querySelector(`.ax-keycap[data-key="${CSS.escape(String(key).toLowerCase())}"]`);
  if (!cap) return;
  cap.classList.add('is-pressed');
  clearTimeout(cap.timer);
  cap.timer = setTimeout(() => cap.classList.remove('is-pressed'), 220);
}

// Import diagram -------------------------------------------------------------------------

// Old status -> Axial status. "Blocked" joins In Progress, and becomes a label.
const MAPPING = [[0, 1], [1, 0], [2, 2], [3, 2, 'is-many'], [4, 3], [5, 4], [6, 5]];

function importDiagram() {
  const body = $('.ax-map-body');
  if (!body) return;
  for (const li of $$('.ax-map-to li')) li.prepend(h('span', { html: statusIcon(li.dataset.status) }));
  const svg = body.querySelector('.ax-map-lines');
  const draw = () => {
    const from = $$('.ax-map-from li');
    const to = $$('.ax-map-to li');
    const box = svg.getBoundingClientRect();
    if (!box.height) return;
    const y = (el) => ((el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 - box.top) / box.height) * 240;
    svg.innerHTML = MAPPING.map(([a, b, cls = '']) => {
      const y1 = y(from[a]).toFixed(1);
      const y2 = y(to[b]).toFixed(1);
      return `<path class="${cls}" d="M0 ${y1}C55 ${y1} 45 ${y2} 100 ${y2}"/>`;
    }).join('');
  };
  draw();
  new ResizeObserver(draw).observe(body);
  document.fonts?.ready.then(draw);

  // The import log plays once, the first time it scrolls into view.
  const run = $('.ax-run');
  const lines = $$('.ax-run-log li');
  const meter = $('.ax-run-meter i');
  if (!run || reducedMotion()) return;
  for (const line of lines) line.style.setProperty('--shown', '.25');
  meter.style.setProperty('--progress', '0%');
  const counters = $$('.ax-run-log b[data-count]');
  for (const b of counters) b.textContent = '0';
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    io.disconnect();
    const start = performance.now();
    const total = 2600;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / total);
      meter.style.setProperty('--progress', `${(t * 100).toFixed(1)}%`);
      lines.forEach((line, i) => line.style.setProperty('--shown', t >= i / (lines.length - 1) - 0.001 ? '1' : '.25'));
      for (const b of counters) {
        const index = lines.indexOf(b.closest('li'));
        const local = Math.min(1, Math.max(0, (t - index / lines.length) * lines.length / 1.4));
        b.textContent = Math.round(Number(b.dataset.count) * local).toLocaleString('en-US');
      }
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { threshold: 0.5 });
  io.observe(run);
}

// Pricing ----------------------------------------------------------------------------------

function pricing() {
  const toggle = $('#billing-yearly');
  if (!toggle) return;
  const apply = () => {
    const key = toggle.checked ? 'yearly' : 'monthly';
    for (const el of $$(`#pricing [data-${key}]`)) el.textContent = el.dataset[key];
  };
  toggle.addEventListener('change', apply);
  apply();
}

/** A plan reference in a reply: scroll to it and light it up. */
export function showPlan(id) {
  const plan = id ? $(`.ax-plan[data-plan="${CSS.escape(id)}"]`) : $('#pricing');
  if (!plan) return;
  plan.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'center' });
  if (!id) return;
  for (const other of $$('.ax-plan.is-highlighted')) other.classList.remove('is-highlighted');
  plan.classList.add('is-highlighted');
  clearTimeout(showPlan.timer);
  showPlan.timer = setTimeout(() => plan.classList.remove('is-highlighted'), 3200);
}

// Where the visitor is --------------------------------------------------------------------

function sections() {
  const app = $('#tracker');
  if (app) {
    new IntersectionObserver(([entry]) => (appRatio = entry.intersectionRatio), { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }).observe(app);
  }
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) seen.set(entry.target, entry.intersectionRatio);
    let best = null;
    for (const [el, ratio] of seen) if (ratio > 0.2 && (!best || ratio > seen.get(best))) best = el;
    section = best?.dataset.section ?? '';
  }, { threshold: [0, 0.2, 0.4, 0.6, 0.8] });
  for (const el of $$('[data-section]')) io.observe(el);
}

export function appVisible() {
  return appRatio > 0.2;
}

/** Where a C press came from, for the prompt: the tracker, or the section in view. */
export function sectionInView() {
  return appRatio > 0.3 ? 'the tracker at the top' : section || 'the tracker at the top';
}

export function revealApp() {
  const app = $('#tracker');
  if (!app || appRatio > 0.6) return;
  settle();
  const top = app.getBoundingClientRect().top + scrollY - Math.max(72, (innerHeight - app.offsetHeight) / 2);
  scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'instant' : 'smooth' });
}

// The floating New issue button, on phones only, and out of the way of the explainer.
function fab() {
  const button = $('.ax-fab');
  if (!button) return;
  const phone = matchMedia('(max-width: 640px)');
  let explainer = false;
  let heroButton = true; // The hero's own "File a question" is on screen: no need for two.
  const sync = () => {
    button.hidden = !phone.matches;
    const html = document.documentElement.classList;
    button.classList.toggle('is-away', explainer || heroButton || html.contains('tk-modal-open') || html.contains('tk-sheet-open'));
  };
  phone.addEventListener('change', sync);
  const watch = (el, set) => el && new IntersectionObserver(([entry]) => {
    set(entry.isIntersecting);
    sync();
  }).observe(el);
  watch($('#how-it-works'), (on) => (explainer = on));
  watch($('.ax-hero-actions'), (on) => (heroButton = on));
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  sync();
}

// The explainer: what Stand receives, live ------------------------------------------------

/** Renders the conversation as Stand stores it: the prefixes, the priorities, the references. */
export function renderWire(state) {
  const el = $('#qi-wire');
  if (!el) return;
  const lines = [];
  for (const m of state.messages) {
    if (m.type !== 'text' || m.senderType === 'system-prompt') continue;
    lines.push({ who: m.senderType === 'visitor' ? 'Visitor' : m.senderType === 'rep' ? 'Team' : 'Stand-in', body: m.body });
  }
  if (state.pending?.body) lines.push({ who: 'Visitor', body: state.pending.body, note: state.busy ? ' (sending)' : ' (not delivered)' });
  const key = JSON.stringify(lines);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (!lines.length) {
    fill(el, h('span', { class: 'qi-who', text: '// Nothing yet. File an issue in the tracker, and this shows\n// the conversation exactly as Axial’s team reads it in Stand.\n\n' }),
      h('span', { class: 'qi-who', text: 'Visitor   ' }), h('span', { class: 'qi-id', text: 'SW-9 [High · Migration]:' }), ' Can we keep our old issue keys?\n',
      h('span', { class: 'qi-who', text: 'Stand-in  ' }), 'Yes. Imported issues keep them as aliases ', h('span', { class: 'qi-ref', text: '[[SW-8]]' }), '.');
    return;
  }
  const nodes = [];
  lines.slice(-12).forEach((line, i) => {
    if (i) nodes.push('\n');
    nodes.push(h('span', { class: 'qi-who', text: `${line.who.padEnd(9)} ` }));
    const parsed = line.who === 'Visitor' ? /^\S+(?: \[[^\]]*\])?:/.exec(line.body) : null;
    const body = parsed && parseVisitorText(line.body) ? [h('span', { class: 'qi-id', text: parsed[0] }), line.body.slice(parsed[0].length)] : [line.body];
    for (const part of body) {
      if (typeof part !== 'string') {
        nodes.push(part);
        continue;
      }
      let last = 0;
      for (const m of part.matchAll(/\[\[[^\]\n]{1,80}\]\]/g)) {
        nodes.push(part.slice(last, m.index), h('span', { class: 'qi-ref', text: m[0] }));
        last = m.index + m[0].length;
      }
      nodes.push(part.slice(last).replace(/\n/g, '\n          '));
    }
    if (line.note) nodes.push(h('span', { class: 'qi-who', text: line.note }));
  });
  fill(el, ...nodes);
  if (!reducedMotion()) animate(el.lastElementChild, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
}
