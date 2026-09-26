// Boots the product on this page: the wizard, its live preview, and the
// advisor that answers at any step through Stand's Visitor API.

import { Advisor } from './ask.js';
import { getClient } from './stand-visitor.js';
import { home } from './steps.js';
import { Storefront } from './storefront.js';
import { Wizard } from './wizard.js';

export const wizard = new Wizard(document.querySelector('[data-wizard]'));
export const storefront = new Storefront(document.querySelector('[data-storefront]'));
storefront.update(wizard.answers);

// Stand Chat's shared demo site answers on any domain. Use your own Site ID here.
export const client = getClient({ site: 'demo' });
export const advisor = new Advisor({
  client,
  wizard,
  dialog: document.querySelector('[data-advisor]'),
  announcer: document.querySelector('[data-announcer]'),
});
client.subscribe((state) => advisor.render(state));
advisor.render(client.getSnapshot());
client.mount(); // Discovery, or recovery of this tab's conversation. Nothing is created yet.

// On phones the preview folds into a card between the wizard and the page.
const preview = document.querySelector('[data-preview]');
const toggle = preview.querySelector('[data-preview-toggle]');
const summary = preview.querySelector('[data-preview-summary]');
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  preview.classList.toggle('is-open', open);
});
function describe() {
  const a = wizard.answers;
  summary.textContent = `${a.name.trim() || 'Your store'} · ${home(a).currency}`;
}
describe();

wizard.addEventListener('change', (event) => {
  storefront.update(wizard.answers, event.detail.key);
  describe();
  // A folded preview nods when it changes.
  if (toggle.getAttribute('aria-expanded') !== 'true' && getComputedStyle(toggle).display !== 'none') {
    preview.classList.remove('is-pinged');
    void preview.offsetWidth;
    preview.classList.add('is-pinged');
  }
});

// The marketing page around the product, after the product is up.
import('./site.js');
