// Awning's marketing page around the product: the pieces that aren't the
// wizard or the chat. Pictures, the pricing toggle, and the two live code
// blocks in "How it works" that show what the next question would carry.

import { buildPrompt, composeQuestion } from './advisor.js';
import { art, dotMap } from './art.js';
import { recommend, shownPlan, STEPS } from './steps.js';
import { LOOKS, Storefront } from './storefront.js';
import { wizard } from './main.js';

// Product pictures in the marketing sections.
for (const el of document.querySelectorAll('[data-art]')) el.innerHTML = art(el.dataset.art, LOOKS[el.closest('[data-look]')?.dataset.look ?? 'linen']);
document.querySelector('[data-globe]').innerHTML = dotMap(['FI', 'DE', 'US', 'JP', 'GB']);

// A second storefront, fixed, as the "looks like you" picture.
const showcase = new Storefront(document.querySelector('[data-showcase]'), { decorative: true });
showcase.update({
  sells: ['physical', 'services'], channels: ['inperson'], markets: ['GB'], sales: 2, catalog: 1, team: 1,
  name: 'Kiln Street', look: 'moss', plan: null, seen: [1, 2, 3, 4, 5],
});

// Pricing: monthly or yearly, and a nod to the plan the wizard recommends.
const yearly = document.querySelector('[data-yearly]');
yearly.addEventListener('change', () => {
  for (const price of document.querySelectorAll('[data-monthly]')) {
    price.textContent = `$${yearly.checked ? price.dataset.yearly : price.dataset.monthly}`;
  }
});
function markPlan() {
  const pick = shownPlan(wizard.answers);
  const recommended = recommend(wizard.answers).plan;
  for (const card of document.querySelectorAll('[data-plan]')) {
    const mine = card.dataset.plan === pick;
    card.classList.toggle('is-yours', mine);
    let badge = card.querySelector('.aw-plan-badge');
    if (mine && !badge) {
      badge = Object.assign(document.createElement('span'), { className: 'aw-plan-badge' });
      card.querySelector('header').after(badge);
    }
    if (badge) {
      badge.hidden = !mine;
      badge.textContent = pick === recommended ? 'Your wizard’s pick' : 'Picked in your wizard';
    }
  }
}

// Buttons that start the store go back up to the wizard.
for (const link of document.querySelectorAll('[data-start]')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const card = document.querySelector('.wz-card');
    card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    document.querySelector(`#wz-t${wizard.step}`)?.focus({ preventScroll: true });
  });
}

// "How it works": the prefix and the prompt your next question would send.
const livePrefix = document.querySelector('[data-live-prefix]');
const livePrompt = document.querySelector('[data-live-prompt]');
function updateLive() {
  const step = STEPS[wizard.step - 1];
  livePrefix.textContent = composeQuestion(step.n, wizard.answers, '(your question)');
  livePrompt.textContent = buildPrompt(wizard.answers, step.n);
  livePrompt.dataset.length = `${livePrompt.textContent.length.toLocaleString('en-US')} / 2,000 characters`;
}

markPlan();
updateLive();
wizard.addEventListener('change', () => {
  markPlan();
  updateLive();
});
wizard.addEventListener('step', () => {
  markPlan(); // Seeing the Markets step can change the recommendation.
  updateLive();
});
