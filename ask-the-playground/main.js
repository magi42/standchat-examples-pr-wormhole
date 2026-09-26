// Wires the page together: Stand's visitor client (the conversation), the
// database (Postgres in a worker), the dashboard, and the assistant beside it.

import { Assistant } from './assistant.js';
import { Database } from './db.js';
import { Playground } from './playground.js';
import { getClient } from './stand-visitor.js';
import { reducedMotion } from './ui.js';

// Stand Chat's shared demo site: it answers on any domain, including localhost.
// Use your own Site ID from Sites in Stand to have your own Stand-ins and team answer.
const client = getClient({ site: 'demo' });
const db = new Database();

const dash = document.querySelector('.dash');
const announcer = document.querySelector('[data-announce]');
const playground = new Playground(dash, db);
const assistant = new Assistant(dash.querySelector('.ask'), client, playground, { announcer });
playground.addEventListener('announce', (e) => {
  announcer.textContent = '';
  setTimeout(() => (announcer.textContent = e.detail), 60);
});

// "How it works" shows the exact message your next question would send.
const live = document.querySelector('[data-live-context]');
const showNext = () => {
  if (live) live.textContent = assistant.preview();
};
assistant.addEventListener('change', showNext);
showNext();

// Discovery or recovery starts now; a conversation only starts with a question.
client.mount();

// Postgres (about 5 MB) downloads when the playground comes into view, or as
// soon as someone touches it.
const section = document.getElementById('playground');
const start = () => db.start().catch(() => {});
const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 300));
const seen = new IntersectionObserver((entries) => {
  if (!entries.some((e) => e.isIntersecting)) return;
  seen.disconnect();
  if (document.readyState === 'complete') whenIdle(start);
  else addEventListener('load', () => whenIdle(start), { once: true });
}, { rootMargin: '300px 0px' });
seen.observe(section);
for (const type of ['pointerdown', 'focusin', 'keydown']) section.addEventListener(type, start, { once: true });

// Only matters for this repo's social-image tool (og.mjs), never for visitors:
// on a cold cache og.mjs can measure the page before the stylesheet has
// applied, and scroll to the wrong place. It hides the [data-og-hide] elements
// while it works; when it has, center the playground again once its scrolling
// settles. Copying this example? You can delete this block.
let ogTimer = 0;
addEventListener('scroll', () => {
  if (document.querySelector('[data-og-hide]')?.style.visibility !== 'hidden') return;
  clearTimeout(ogTimer);
  ogTimer = setTimeout(() => {
    const rect = document.querySelector('[data-og-focus]').getBoundingClientRect();
    scrollTo(0, scrollY + rect.top + rect.height / 2 - innerHeight / 2);
  }, 300);
});

// "Try the playground" scrolls to it and puts the cursor in the editor.
for (const link of document.querySelectorAll('[data-focus-editor]')) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    start();
    section.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => playground.editor.focus(), reducedMotion() ? 0 : 450);
  });
}
