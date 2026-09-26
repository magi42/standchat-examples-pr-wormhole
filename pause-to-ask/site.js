// The rest of Marquee's homepage: the template strip, "jump to this in the
// tour" chips, reveals on scroll, and the live code in "How it works".
import { TEMPLATES, templateThumb } from './thumbs.js';
import { buildPrompt } from './prompt.js';
import { formatQuestion } from './threads.js';
import { chapterAt, formatTime } from './tour-script.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function mountSite({ player }) {
  // Template strip: the tour's thumbnails, larger. Two copies make the loop seamless.
  const strip = document.querySelector('[data-templates]');
  if (strip) {
    const cards = TEMPLATES.map((t) => `
      <li class="tcard">
        <div class="tcard-thumb">${templateThumb(t.id)}</div>
        <div class="tcard-meta"><b>${t.name}</b><span>${t.kind}</span><em>${t.price}</em></div>
      </li>`).join('');
    strip.innerHTML = `<ul class="tstrip-row">${cards}</ul><ul class="tstrip-row" aria-hidden="true">${cards}</ul>`;
  }

  // In-page links glide (unless motion is reduced). Done here rather than with
  // CSS scroll-behavior, which would also slow down every scroll made by code.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || link.matches('[data-jump]')) return;
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    history.replaceState(null, '', link.hash);
  });

  // Chips that jump the tour to a chapter, from anywhere on the page.
  document.addEventListener('click', (event) => {
    const jump = event.target.closest('[data-jump]');
    if (jump) {
      event.preventDefault();
      toTour(() => player.seek(Number(jump.dataset.jump), { play: true }));
      return;
    }
    if (event.target.closest('[data-ask-tour]')) {
      event.preventDefault();
      toTour(() => player.ask());
    }
  });

  function toTour(then) {
    const target = document.querySelector('[data-player]');
    const r = target.getBoundingClientRect();
    const visible = r.top >= 0 && r.bottom <= innerHeight;
    if (!visible) target.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    setTimeout(then, visible || reducedMotion.matches ? 0 : 450);
  }

  // Reveal sections as they arrive (what's already on screen stays put), and
  // run the small loops only while they're visible.
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      seen.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of document.querySelectorAll('[data-reveal]')) {
    if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in');
    else seen.observe(el);
  }
  document.documentElement.classList.add('js-reveal');
  const loops = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle('is-running', entry.isIntersecting);
  });
  for (const el of document.querySelectorAll('.vignette, [data-templates]')) loops.observe(el);

  // "How it works": the next question's format and the prompt, following the tour.
  const nextMessage = document.querySelector('[data-live-message]');
  const prompt = document.querySelector('[data-live-prompt]');
  let shown = -1;
  const update = (time) => {
    const second = Math.floor(time);
    if (second === shown) return;
    shown = second;
    if (nextMessage) nextMessage.textContent = formatQuestion(second, 'Your question');
    if (prompt) prompt.textContent = buildPrompt(second);
    const where = document.querySelector('[data-live-where]');
    if (where) where.textContent = `${formatTime(second)}, ${chapterAt(second).name}`;
  };
  player.events.addEventListener('time', ({ detail }) => {
    if (!detail.playing || Math.floor(detail.time) % 2 === 0) update(detail.time);
  });
  update(player.time);
}
