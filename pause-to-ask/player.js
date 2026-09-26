// The tour's player: a clock, play and pause, a scrubber split into named
// chapters, captions, keyboard shortcuts, and autoplay like a muted video while
// the tour is in view. It knows nothing about Stand: questions.js puts the
// markers on the scrubber and decides what "Ask about this moment" does.

import { createTour } from './tour.js';
import { CHAPTERS, DURATION, POSTER, chapterAt, formatTime, momentAt } from './tour-script.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const typingInto = (el) => el?.closest?.('input, textarea, select, [contenteditable="true"]');

/**
 * `scene` builds what plays: anything that returns { render(t), resize(),
 * layout } for a host element, like createTour. Swap it for your own product.
 */
export function createPlayer(root, { start = POSTER, scene = createTour } = {}) {
  const $ = (selector) => root.querySelector(selector);
  const events = new EventTarget();
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

  const tourHost = $('[data-tour]');
  const tour = scene(tourHost, { reducedMotion: () => reducedMotion.matches });
  const scrub = $('[data-scrub]');
  const segs = $('[data-segs]');
  const names = $('[data-names]');
  const markerLayer = $('[data-markers]');
  const tip = $('[data-tip]');
  const toggle = $('[data-toggle]');
  const caption = $('[data-caption]');
  const ccButton = $('[data-cc]');

  let time = clampTime(start);
  let playing = false;
  let raf = 0;
  let last = 0;
  let touched = false; // The visitor has used the controls: no more looping or autoplay.
  let userPaused = false;
  let inView = false;
  let captions = true;
  const holds = new Set(); // Reasons to stay paused, like an open question.

  // Chapter segments and their names
  segs.innerHTML = CHAPTERS.map((c, i) => {
    const end = CHAPTERS[i + 1]?.start ?? DURATION;
    return `<span class="seg" style="flex:${end - c.start}"><i class="seg-fill"></i></span>`;
  }).join('');
  names.innerHTML = CHAPTERS.map((c, i) => {
    const end = CHAPTERS[i + 1]?.start ?? DURATION;
    return `<button type="button" class="seg-name" style="flex:${end - c.start}" data-seek="${c.start}" aria-label="Chapter: ${c.name}, ${formatTime(c.start)}"><span>${c.name}</span></button>`;
  }).join('');
  const fills = [...segs.querySelectorAll('.seg-fill')];

  function clampTime(value) {
    return Math.min(DURATION, Math.max(0, Number(value) || 0));
  }

  // Chapters are separate segments with gaps between them, so a moment's place
  // on the scrubber is its share of the segments plus the gaps before it.
  const GAP = 3;
  function placeAt(t) {
    const index = Math.max(0, CHAPTERS.findLastIndex((c) => c.start <= t));
    return `calc(${(t / DURATION).toFixed(5)} * (100% - ${GAP * (CHAPTERS.length - 1)}px) + ${index * GAP}px)`;
  }
  const knob = document.createElement('i');
  knob.className = 'knob';
  scrub.append(knob);

  // The clock ------------------------------------------------------------------

  function frame(now) {
    raf = 0;
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000); // A background tab doesn't jump ahead.
    last = now;
    let next = time + dt;
    if (next >= DURATION) {
      if (!touched) {
        next = 0; // Loops like a muted hero video until someone takes the controls.
      } else {
        next = DURATION;
        setTime(next);
        return pause();
      }
    }
    setTime(next);
    raf = requestAnimationFrame(frame);
  }

  let shownMoment = null;
  function setTime(value, { force = false } = {}) {
    const before = time;
    time = clampTime(value);
    tour.render(time);
    for (const [i, c] of CHAPTERS.entries()) {
      const end = CHAPTERS[i + 1]?.start ?? DURATION;
      const p = Math.min(1, Math.max(0, (time - c.start) / (end - c.start)));
      fills[i].style.transform = `scaleX(${p.toFixed(4)})`;
    }
    knob.style.left = placeAt(time);
    const moment = momentAt(time);
    if (moment !== shownMoment || force) {
      shownMoment = moment;
      const chapter = chapterAt(time);
      $('[data-chapter]').textContent = chapter.name;
      $('[data-moment]').textContent = moment.label;
      caption.textContent = moment.caption;
      for (const [i, el] of [...names.children].entries()) el.classList.toggle('on', CHAPTERS[i] === chapter);
    }
    if (Math.floor(before) !== Math.floor(time) || force) {
      $('[data-now]').textContent = formatTime(time);
      scrub.setAttribute('aria-valuenow', String(Math.floor(time)));
      scrub.setAttribute('aria-valuetext', `${formatTime(time)}, ${chapterAt(time).name}: ${momentAt(time).label}`);
    }
    emit('time', { time, playing });
  }

  function play() {
    if (playing) return;
    if (holds.size) holds.clear();
    if (time >= DURATION) setTime(0);
    playing = true;
    userPaused = false;
    last = performance.now();
    raf ||= requestAnimationFrame(frame);
    updateState();
  }

  function pause({ user = false } = {}) {
    if (user) userPaused = true;
    if (!playing) return updateState();
    playing = false;
    cancelAnimationFrame(raf);
    raf = 0;
    updateState();
  }

  function seek(value, { play: andPlay = false } = {}) {
    touched = true;
    setTime(value);
    if (andPlay) play();
  }

  function updateState() {
    root.classList.toggle('is-playing', playing);
    root.classList.toggle('is-paused', !playing);
    root.classList.toggle('is-ended', !playing && time >= DURATION);
    const label = playing ? 'Pause' : time >= DURATION ? 'Replay' : 'Play';
    toggle.setAttribute('aria-label', `${label} (k)`);
    toggle.dataset.icon = playing ? 'pause' : time >= DURATION ? 'replay' : 'play';
    $('[data-play-big] span').textContent = time >= DURATION ? 'Replay' : 'Play';
    emit('state', { playing, time });
  }

  function togglePlay() {
    touched = true;
    if (playing) pause({ user: true });
    else play();
  }

  // Autoplay while in view, like a muted video. Never with reduced motion.
  const observer = new IntersectionObserver(([entry]) => {
    inView = entry.intersectionRatio >= 0.5;
    if (inView && !userPaused && !holds.size && !reducedMotion.matches && !(touched && time >= DURATION)) play();
    else if (entry.intersectionRatio < 0.25 && playing) pause();
  }, { threshold: [0, 0.25, 0.5] });
  observer.observe(root.querySelector('[data-stage]'));

  // Controls ---------------------------------------------------------------------

  toggle.addEventListener('click', togglePlay);
  $('[data-play-big]').addEventListener('click', () => {
    touched = true;
    play();
  });
  $('[data-stage-hit]').addEventListener('click', togglePlay);
  for (const button of root.querySelectorAll('[data-ask]')) {
    button.addEventListener('click', () => ask());
  }
  ccButton.addEventListener('click', () => {
    captions = !captions;
    ccButton.setAttribute('aria-pressed', String(captions));
    root.classList.toggle('no-captions', !captions);
  });
  names.addEventListener('click', (event) => {
    const button = event.target.closest('[data-seek]');
    if (button) seek(Number(button.dataset.seek), { play: true });
  });

  function ask() {
    touched = true;
    pause({ user: true });
    emit('ask', { time });
  }

  // Scrubbing: drag along the chapters; hover shows the moment, rendered live.
  const timeAt = (clientX) => {
    const parts = [...segs.children];
    for (const [i, part] of parts.entries()) {
      const r = part.getBoundingClientRect();
      if (clientX < r.right + GAP / 2 || i === parts.length - 1) {
        const start = CHAPTERS[i].start;
        const end = CHAPTERS[i + 1]?.start ?? DURATION;
        return clampTime(start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (end - start));
      }
    }
    return 0;
  };
  let dragging = null;
  scrub.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('[data-marker]')) return;
    event.preventDefault();
    scrub.focus({ preventScroll: true });
    scrub.setPointerCapture(event.pointerId);
    dragging = { wasPlaying: playing };
    touched = true;
    pause();
    root.classList.add('is-scrubbing');
    seek(timeAt(event.clientX));
    showTip(event.clientX);
  });
  scrub.addEventListener('pointermove', (event) => {
    if (dragging) seek(timeAt(event.clientX));
    if (dragging || event.pointerType === 'mouse') showTip(event.clientX);
  });
  const endDrag = (event) => {
    if (!dragging) return;
    const { wasPlaying } = dragging;
    dragging = null;
    root.classList.remove('is-scrubbing');
    if (event.pointerType !== 'mouse') hideTip();
    if (wasPlaying) play();
    else userPaused = true;
  };
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);
  scrub.addEventListener('pointerleave', (event) => {
    if (!dragging && event.pointerType === 'mouse') hideTip();
  });

  let preview = null;
  let tipFrame = 0;
  function showTip(clientX, at = timeAt(clientX), label = `${chapterAt(at).name} · ${momentAt(at).label}`) {
    const r = segs.getBoundingClientRect();
    const half = tip.offsetWidth / 2 || 104;
    const x = Math.min(r.width - half + 8, Math.max(half - 8, clientX - r.left));
    tip.style.setProperty('--x', `${x}px`);
    tip.querySelector('[data-tip-time]').textContent = formatTime(at);
    tip.querySelector('[data-tip-label]').textContent = label;
    tip.classList.toggle('is-question', label !== `${chapterAt(at).name} · ${momentAt(at).label}`);
    tip.hidden = false;
    // The thumbnail is a second tour, rendered at the hovered time: nothing is recorded.
    if (!preview) preview = scene(tip.querySelector('[data-tip-thumb]'), { layout: () => tour.layout });
    cancelAnimationFrame(tipFrame);
    tipFrame = requestAnimationFrame(() => {
      preview.resize();
      preview.render(at);
    });
  }
  function hideTip() {
    tip.hidden = true;
  }

  // Keyboard ---------------------------------------------------------------------

  scrub.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[event.key];
    if (step) {
      event.preventDefault();
      event.stopPropagation();
      pause({ user: true });
      seek(Math.round(time) + step);
    }
  });

  // At least half of the tour on screen, measured now rather than remembered.
  function onScreen() {
    const r = root.querySelector('[data-stage]').getBoundingClientRect();
    const visible = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return visible >= r.height / 2;
  }

  function onKey(event, scope) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    // Within the player, every shortcut works. Elsewhere on the page, only
    // letters that don't scroll it, and only while the tour is on screen.
    if (scope === 'page' && (!onScreen() || !['k', 'j', 'l', 'q'].includes(key))) return;
    if (scope === 'page' && event.target.closest?.('button, a, [role="slider"], summary')) return;
    const actions = {
      ' ': togglePlay, k: togglePlay,
      j: () => seek(time - 5), l: () => seek(time + 5),
      ArrowLeft: () => seek(time - 5), ArrowRight: () => seek(time + 5),
      Home: () => seek(0), End: () => seek(DURATION),
      q: ask, c: () => ccButton.click(),
    };
    const action = actions[key];
    if (!action) return;
    if (key === ' ' && event.target.closest('button, a, summary')) return; // Space activates the focused control.
    event.preventDefault();
    event.stopPropagation();
    action();
  }
  root.addEventListener('keydown', (event) => onKey(event, 'player'));
  document.addEventListener('keydown', (event) => {
    if (!root.contains(event.target)) onKey(event, 'page');
  });

  // Markers ----------------------------------------------------------------------

  const markerEls = new Map();
  /** Draws question markers: [{ key, time, kind: 'you' | 'example', label, active, isNew }]. */
  function setMarkers(list) {
    const keep = new Set();
    for (const m of list) {
      keep.add(m.key);
      let el = markerEls.get(m.key);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'marker';
        el.dataset.marker = m.key;
        el.innerHTML = '<i aria-hidden="true"></i>';
        markerEls.set(m.key, el);
        markerLayer.append(el);
        if (m.isNew) {
          el.classList.add('is-dropping');
          el.addEventListener('animationend', () => el.classList.remove('is-dropping'), { once: true });
        }
      }
      el.style.left = placeAt(m.time);
      el.dataset.time = String(m.time);
      el.classList.toggle('is-example', m.kind === 'example');
      el.classList.toggle('is-active', Boolean(m.active));
      el.setAttribute('aria-label', m.label);
      el.dataset.question = m.question ?? m.label;
    }
    for (const [key, el] of markerEls) {
      if (!keep.has(key)) {
        el.remove();
        markerEls.delete(key);
      }
    }
    // Tab order follows the timeline, not the order the questions were asked.
    const ordered = [...markerEls.values()].sort((a, b) => a.dataset.time - b.dataset.time);
    if (ordered.some((el, i) => markerLayer.children[i] !== el)) markerLayer.append(...ordered);
  }
  markerLayer.addEventListener('click', (event) => {
    const el = event.target.closest('[data-marker]');
    if (el) emit('marker', { key: el.dataset.marker });
  });
  // Hovering a marker previews its moment, with the question.
  markerLayer.addEventListener('pointerover', (event) => {
    const el = event.target.closest('[data-marker]');
    if (!el || event.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    showTip(r.left + r.width / 2, Number(el.dataset.time), el.dataset.question);
  });
  markerLayer.addEventListener('pointerout', (event) => {
    if (event.target.closest('[data-marker]') && !scrub.matches(':hover')) hideTip();
  });
  /** Lights up markers that playback is passing right now. */
  events.addEventListener('time', () => {
    for (const el of markerEls.values()) {
      const at = Number(el.dataset.time);
      el.classList.toggle('is-passing', playing && time >= at && time < at + 3.5);
    }
  });

  // Size ---------------------------------------------------------------------------

  new ResizeObserver(() => {
    tour.resize();
    root.dataset.layout = tour.layout;
  }).observe(tourHost);
  document.fonts?.ready.then(() => tour.render(time));

  setTime(time, { force: true });
  updateState();

  return {
    events,
    scene, // For previews elsewhere on the page.
    play,
    pause,
    seek,
    ask,
    setMarkers,
    hold(reason, on) {
      if (on) holds.add(reason);
      else holds.delete(reason);
    },
    get time() {
      return time;
    },
    get playing() {
      return playing;
    },
    get layout() {
      return tour.layout;
    },
    get touched() {
      return touched;
    },
    markTouched() {
      touched = true;
    },
  };
}
