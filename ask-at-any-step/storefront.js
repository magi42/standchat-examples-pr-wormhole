// The live preview: a store theme drawn from the wizard's answers.
//
// Every answer shows up somewhere: what you sell picks the products and blocks,
// where you sell adds pickup, market dates or a feed, your markets set the
// currency and shipping line, the name and look dress it. The store is a
// picture, not a second form: screen readers get a one-line summary instead.

import { art, icon, flag } from './art.js';
import { COUNTRIES, has, home, plan, shownPlan } from './steps.js';
import { domainFor } from './wizard.js';

// Looks: colours for the theme and for the product art.
export const LOOKS = {
  linen: { bg: '#F6F1E9', surface: '#FFFDF9', ink: '#2A2521', muted: '#6B625A', line: '#E4D9C9', accent: '#B8552F', soft: '#EFE2D0', leaf: '#D8A07A', deep: '#8A3E21', tile: '#EFE5D7', clay: '#F7F1E8', wax: '#F4E7D0', canvas: '#EADFCB', strap: '#CDBB9B', strapBack: '#B6A381', kraft: '#D9BA90', kraftDark: '#C29F6F' },
  moss: { bg: '#EEF1EA', surface: '#FAFBF7', ink: '#1E2A22', muted: '#56645A', line: '#D6DED0', accent: '#4E7247', soft: '#DCE6D4', leaf: '#9DB88F', deep: '#2F4A2B', tile: '#E3EADD', clay: '#F5F6F0', wax: '#F1EEDC', canvas: '#E4E3D2', strap: '#BFC0A6', strapBack: '#A9AB8F', kraft: '#D3BC93', kraftDark: '#BBA276' },
  ink: { bg: '#FFFFFF', surface: '#FFFFFF', ink: '#111111', muted: '#595959', line: '#E6E6E6', accent: '#1A1A1A', soft: '#EDEDED', leaf: '#B9B9B9', deep: '#4A4A4A', tile: '#F2F2F2', clay: '#F7F7F7', wax: '#F2EFE8', canvas: '#ECE9E2', strap: '#C9C6BF', strapBack: '#B0ADA6', kraft: '#D5C3A5', kraftDark: '#BDA884' },
  sunny: { bg: '#FFF6DE', surface: '#FFFBEF', ink: '#2B1D0E', muted: '#66553F', line: '#F1DFB2', accent: '#E0662A', soft: '#FFE1A6', leaf: '#F2B04E', deep: '#A8431A', tile: '#FFEBC0', clay: '#FFF8EA', wax: '#FFF0CC', canvas: '#F6E6C3', strap: '#E2C58E', strapBack: '#CFAF73', kraft: '#E6C38E', kraftDark: '#CFA766' },
};

const PRODUCTS = {
  mug: { name: 'Speckled mug', usd: 28, art: 'mug' },
  candle: { name: 'Beeswax candle', usd: 24, art: 'candle' },
  tote: { name: 'Canvas tote', usd: 32, art: 'tote' },
  print: { name: 'Printable art print', usd: 12, art: 'print', badge: 'Instant download' },
  club: { name: 'Candle club', usd: 26, art: 'box', per: '/month', badge: 'Subscribe & save 10%' },
  tapers: { name: 'Wedding tapers', usd: 48, art: 'tapers', badge: 'Made to order · 3–4 weeks' },
  class: { name: 'Candle-pouring class', usd: 65, art: 'ticket', badge: 'Book a time' },
};

// Headline, button, and two products for the banner, by the first thing sold.
const HEROES = {
  none: ['Small batch. Made by hand.', 'Shop now', 'candle', 'mug'],
  physical: ['Small batch. Made by hand.', 'Shop now', 'candle', 'mug'],
  digital: ['Download today, print tonight.', 'Browse prints', 'print', 'candle'],
  services: ['Book a class. Make something.', 'Book a time', 'ticket', 'candle'],
  subscriptions: ['Something new, every month.', 'Join the club', 'box', 'candle'],
  custom: ['Made for you, one at a time.', 'Start an order', 'tapers', 'mug'],
};

const BLOCKS = ['bar', 'header', 'hero', 'aisles', 'grid', 'booking', 'visit', 'events', 'social', 'footer'];
const CATALOG_COUNT = [0, 24, 300, 2400];
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export class Storefront {
  #root;
  #viewport;
  #store;
  #blocks = new Map();
  #summary;
  #first = true;

  constructor(root, { decorative = false } = {}) {
    this.#root = root;
    root.innerHTML = `
      <div class="sf-chrome" aria-hidden="true">
        <span class="sf-dots"><i></i><i></i><i></i></span>
        <span class="sf-url">${icon('lock', { size: 13 })}<span data-url></span></span>
        <span class="sf-badge">Preview</span>
      </div>
      <div class="sf-viewport"${decorative ? '' : ' tabindex="0" aria-label="Store preview (scrollable)"'}>
        ${decorative ? '' : '<p class="aw-sr" data-summary></p>'}
        <div class="sf-store" aria-hidden="true">${BLOCKS.map((b) => `<div class="sf-block" data-block="${b}"></div>`).join('')}</div>
      </div>`;
    this.#viewport = root.querySelector('.sf-viewport');
    this.#store = root.querySelector('.sf-store');
    this.#summary = root.querySelector('[data-summary]');
    for (const el of root.querySelectorAll('[data-block]')) this.#blocks.set(el.dataset.block, { el, html: null });
  }

  /** Redraws what changed. `key` says which answer did, to show the visitor where. */
  update(a, key = '') {
    const look = LOOKS[a.look] ?? LOOKS.linen;
    this.#store.dataset.look = a.look;
    for (const [name, value] of Object.entries(look)) this.#root.style.setProperty(`--sf-${name}`, value);
    this.#root.querySelector('[data-url]').textContent = `${domainFor(a.name)}.awning.shop`;

    const changed = BLOCKS.filter((name) => this.#set(name, this.#render(name, a, look)));
    if (this.#summary) this.#summary.textContent = summary(a);

    if (this.#first) {
      this.#first = false;
      return;
    }
    // Show where the answer landed: flash it, and scroll the preview to it.
    const focus = {
      sells: ['booking', 'grid', 'hero'],
      channels: ['visit', 'events', 'social', 'grid'],
      markets: ['bar', 'grid'],
      catalog: ['aisles', 'header'],
      name: ['header'],
      look: ['hero'],
      plan: ['header', 'bar'],
    }[key] ?? [];
    const target = focus.find((name) => changed.includes(name) && this.#blocks.get(name).html);
    if (!target) return;
    const { el } = this.#blocks.get(target);
    el.classList.remove('is-updated');
    void el.offsetWidth;
    el.classList.add('is-updated');
    // Scroll only when the change starts out of sight.
    const top = el.offsetTop - 10;
    const view = this.#viewport;
    const inView = top >= view.scrollTop && top <= view.scrollTop + view.clientHeight - 120;
    if (!inView) view.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  #set(name, html) {
    const block = this.#blocks.get(name);
    if (block.html === html) return false;
    const before = new Set([...block.el.querySelectorAll('[data-product]')].map((el) => el.dataset.product));
    block.el.innerHTML = html;
    block.el.hidden = !html;
    block.html = html;
    // New products fade in; the ones that stay don't move.
    if (before.size || name === 'grid') {
      for (const card of block.el.querySelectorAll('[data-product]')) {
        if (!before.has(card.dataset.product) && !this.#first) card.classList.add('is-new');
      }
    }
    return true;
  }

  #render(name, a, look) {
    const h = home(a);
    const money = (usd) => formatPrice(usd, h);
    const ships = has(a.sells, 'physical') || has(a.sells, 'custom') || a.sells.length === 0;
    const storeName = a.name.trim();
    const shown = esc(storeName || 'Your store');
    const multi = a.markets.length > 1;
    const localized = multi && ['flagship', 'landmark'].includes(shownPlan(a));

    switch (name) {
      case 'bar': {
        const names = a.markets.map((code) => COUNTRIES[code].short);
        let text;
        if (ships && multi) text = a.markets.length <= 3 ? `Shipping to ${list(names)}` : `Shipping to ${a.markets.length} countries`;
        else if (ships) text = `Free shipping in ${h.short} over ${formatPrice(60, h, { whole: true })}`;
        else if (has(a.sells, 'services')) text = 'New class dates every week';
        else if (has(a.sells, 'digital')) text = 'Instant downloads, printable at home';
        else text = 'Join the club. Skip or pause any month';
        if (ships && localized && a.markets.some((code) => !COUNTRIES[code].eu)) text += ' · duties included';
        return `<p class="sf-bar">${esc(text)}</p>`;
      }
      case 'header': {
        const links = ['Shop', has(a.sells, 'services') && 'Classes', has(a.sells, 'subscriptions') && 'Club', has(a.sells, 'custom') && 'Custom', has(a.channels, 'inperson') && 'Visit', 'About'].filter(Boolean).slice(0, 4);
        const count = CATALOG_COUNT[a.catalog];
        const locale = localized
          ? `<span class="sf-langs">${a.markets.slice(0, 3).map((code, i) => `<b${i ? '' : ' class="is-on"'}>${code}</b>`).join('')}</span>`
          : `<span class="sf-locale">${flag(a.markets[0])}${h.currency}</span>`;
        return `
          <header class="sf-header">
            <span class="sf-brand"><span class="sf-monogram">${esc(monogram(storeName))}</span><span class="sf-name${storeName ? '' : ' is-placeholder'}">${shown}</span></span>
            <nav class="sf-nav">${links.map((link) => `<span>${link}</span>`).join('')}</nav>
            <span class="sf-tools">
              ${a.catalog >= 2 ? `<span class="sf-search">${icon('search', { size: 13 })}Search ${count.toLocaleString('en-US')} products</span>` : icon('search', { size: 16 })}
              ${locale}
              <span class="sf-cart">${icon('cart', { size: 16 })}<i>0</i></span>
            </span>
          </header>`;
      }
      case 'hero': {
        const first = a.sells[0] ?? 'none';
        const [headline, cta, main, side] = HEROES[first];
        return `
          <section class="sf-hero">
            <div class="sf-hero-copy">
              <p class="sf-eyebrow">${storeName ? 'New season' : 'Your hero banner'}</p>
              <h3 class="sf-display">${headline}</h3>
              <span class="sf-button">${cta}</span>
            </div>
            <div class="sf-hero-art"><span class="sf-hero-side">${art(side, look)}</span><span class="sf-hero-main">${art(main, look)}</span></div>
          </section>`;
      }
      case 'aisles': {
        if (a.catalog < 2) return '';
        const aisles = ['Candles', 'Mugs', 'Bags', 'Prints', 'Gifts', 'Under ' + money(30)];
        return `<nav class="sf-aisles">${aisles.map((aisle, i) => `<span${i ? '' : ' class="is-on"'}>${esc(aisle)}</span>`).join('')}${a.catalog >= 3 ? `<span class="sf-filter">${icon('grid', { size: 12 })}Filter</span>` : ''}</nav>`;
      }
      case 'grid': {
        const ids = products(a);
        const pickup = has(a.channels, 'inperson');
        const sample = a.sells.length === 0;
        return `
          <section class="sf-section">
            <div class="sf-section-head"><h4 class="sf-display">${sample ? 'Sample products' : 'Featured'}</h4><span>${sample ? 'They change with your answers' : `View all${CATALOG_COUNT[a.catalog] ? ` ${CATALOG_COUNT[a.catalog].toLocaleString('en-US')}` : ''}`}</span></div>
            <div class="sf-grid">${ids.map((id) => {
              const p = PRODUCTS[id];
              const physical = ['mug', 'candle', 'tote'].includes(id);
              const badge = p.badge ?? (pickup && physical ? 'Pickup available' : '');
              return `
                <article class="sf-card" data-product="${id}">
                  <div class="sf-card-art">${art(p.art, look)}${badge ? `<span class="sf-tag">${badge}</span>` : ''}</div>
                  <h5>${p.name}</h5>
                  <p class="sf-price">${id === 'club' ? `from ${money(p.usd * 0.9)}` : money(p.usd)}${p.per ?? ''}</p>
                </article>`;
            }).join('')}</div>
          </section>`;
      }
      case 'booking': {
        if (!has(a.sells, 'services')) return '';
        const days = nextDays(4, h);
        return `
          <section class="sf-section sf-book">
            <div class="sf-book-art">${art('ticket', look)}</div>
            <div class="sf-book-body">
              <p class="sf-eyebrow">Classes</p>
              <h4 class="sf-display">Candle-pouring class</h4>
              <p class="sf-muted">2 hours · materials included · ${money(PRODUCTS.class.usd)}</p>
              <div class="sf-days">${days.map((d, i) => `<span${i === 1 ? ' class="is-on"' : ''}>${d}</span>`).join('')}</div>
              <div class="sf-slots">${['10:00', '13:30', '17:00'].map((t, i) => `<span${i === 2 ? ' class="is-few"' : ''}>${formatTime(t, h)}${i === 2 ? ' · 2 left' : ''}</span>`).join('')}</div>
              <span class="sf-button">Book a time</span>
            </div>
          </section>`;
      }
      case 'visit': {
        if (!has(a.channels, 'inperson')) return '';
        return `
          <section class="sf-section sf-visit">
            <span class="sf-visit-pin">${icon('pin', { size: 18 })}</span>
            <div><h4 class="sf-display">Visit the studio</h4><p class="sf-muted">${esc(h.town)} · Open Thursday to Sunday</p></div>
            <span class="sf-chip-ok">${icon('check', { size: 12 })}Pickup, usually ready in 2 hours</span>
          </section>`;
      }
      case 'events': {
        if (!has(a.channels, 'events')) return '';
        const [first, second] = upcomingSaturdays(h);
        return `
          <section class="sf-section">
            <div class="sf-section-head"><h4 class="sf-display">Find us at the markets</h4></div>
            <ul class="sf-events">
              <li><b>${first}</b><span>Makers’ Market, ${esc(h.town)}</span></li>
              <li><b>${second}</b><span>Late Night Craft Fair, ${esc(h.town)}</span></li>
            </ul>
          </section>`;
      }
      case 'social': {
        if (!has(a.channels, 'social')) return '';
        const handle = (storeName || 'yourstore').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'yourstore';
        const tiles = products(a).slice(0, 4);
        return `
          <section class="sf-section">
            <div class="sf-section-head"><h4 class="sf-display">Shop the feed</h4><span>@${esc(handle)}</span></div>
            <div class="sf-feed">${tiles.map((id) => `<span>${art(PRODUCTS[id].art, look)}</span>`).join('')}</div>
          </section>`;
      }
      case 'footer': {
        const languages = localized ? a.markets.map((code) => COUNTRIES[code].language) : [h.language === 'English' ? 'English' : `English, ${h.language}`];
        return `
          <footer class="sf-footer">
            <span>© 2026 ${shown}</span>
            <span>${esc([...new Set(languages)].slice(0, 4).join(' · '))}</span>
            <span class="sf-pay"><i></i><i></i><i></i></span>
          </footer>`;
      }
      default:
        return '';
    }
  }
}

/** Up to four products, one of each kind first. */
function products(a) {
  if (a.sells.length === 0) return ['candle', 'mug', 'tote', 'print'];
  const ids = [];
  if (has(a.sells, 'physical')) ids.push('candle', 'mug');
  if (has(a.sells, 'digital')) ids.push('print');
  if (has(a.sells, 'subscriptions')) ids.push('club');
  if (has(a.sells, 'custom')) ids.push('tapers');
  if (has(a.sells, 'services') && ids.length < 2) ids.push('class');
  if (has(a.sells, 'physical')) ids.push('tote');
  return [...new Set(ids)].slice(0, 4);
}

function monogram(name) {
  const words = name.split(/[\s&+]+/).filter((w) => /\p{L}|\d/u.test(w));
  return (words.length ? words.slice(0, 2).map((w) => [...w][0]).join('') : 'Y').toUpperCase();
}

/** A price in the home market's currency: illustrative rates, rounded like a shop would. */
export function formatPrice(usd, market, { whole = false } = {}) {
  const raw = usd * market.rate;
  const value = market.currency === 'JPY' ? Math.round(raw / 100) * 100 : market.currency === 'SEK' ? Math.round(raw / 10) * 10 : Math.round(raw);
  const digits = whole || ['JPY', 'SEK'].includes(market.currency) ? 0 : 2;
  return new Intl.NumberFormat(market.locale, { style: 'currency', currency: market.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function nextDays(count, market) {
  const format = new Intl.DateTimeFormat(market.locale === 'en-US' ? 'en-US' : 'en-GB', { weekday: 'short', day: 'numeric' });
  const days = [];
  const day = new Date();
  while (days.length < count) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() !== 1) days.push(format.format(day)); // Closed on Mondays.
  }
  return days;
}

function formatTime(hhmm, market) {
  const [h, m] = hhmm.split(':').map(Number);
  const date = new Date(2026, 0, 1, h, m);
  return new Intl.DateTimeFormat(market.locale === 'en-US' ? 'en-US' : 'en-GB', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function upcomingSaturdays(market) {
  const format = new Intl.DateTimeFormat(market.locale === 'en-US' ? 'en-US' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const day = new Date();
  day.setDate(day.getDate() + ((6 - day.getDay() + 7) % 7) + 14);
  const later = new Date(day);
  later.setDate(later.getDate() + 42);
  return [format.format(day), format.format(later)];
}

function summary(a) {
  const h = home(a);
  const parts = [`${a.name.trim() || 'Your store'}, prices in ${h.currency}`];
  const shown = products(a).map((id) => PRODUCTS[id].name.toLowerCase());
  parts.push(`${a.sells.length ? 'featuring' : 'sample products:'} ${list(shown)}`);
  if (has(a.sells, 'services')) parts.push('a booking block for classes');
  if (has(a.channels, 'inperson')) parts.push('pickup at the studio');
  if (has(a.channels, 'events')) parts.push('upcoming market dates');
  if (has(a.channels, 'social')) parts.push('a shoppable feed');
  return `Preview: ${parts.join('; ')}. Plan: ${plan(shownPlan(a)).name}.`;
}
