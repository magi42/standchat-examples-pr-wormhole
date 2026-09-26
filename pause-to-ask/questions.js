// Questions about the tour: the composer over the paused frame, the markers on
// the scrubber, and the Questions rail beside the player. Presentation only:
// stand-visitor.js talks to Stand, threads.js turns its transcript into
// threads, and render() draws whatever state the client reports.

import { buildThreads, describeMoment, formatQuestion, parseQuestion, renderText, safeUrl } from './threads.js';
import { buildPrompt } from './prompt.js';
import { chapterAt, formatTime, momentAt } from './tour-script.js';

const UI_KEY = 'pause-to-ask:v1:ui';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Shown until the first real question, and clearly marked as examples.
const EXAMPLES = [
  {
    key: 'example-1',
    time: 41,
    question: 'If I shrink the headline here, does desktop change too?',
    answer: 'No. An edit on a breakpoint stays on that breakpoint, so desktop keeps its 72 px headline. The phone layout was added at [[0:36]].',
  },
  {
    key: 'example-2',
    time: 57,
    question: 'Does every journal post get its own page?',
    answer: 'Yes. Each item in a collection gets a page from one template, like the one at [[0:59]].',
  },
];

const ERRORS = {
  connect: 'Couldn’t reach the chat. Check your connection and try again.',
  start: 'That didn’t go through, so no conversation started. Your question is back in the box.',
  uncertain: 'We couldn’t confirm your first question arrived. It may have started a conversation already.',
  lost: 'The conversation closed before your last message was confirmed. It’s still here if you want to copy it.',
  gone: 'This conversation isn’t available anymore.',
  paused: 'The connection dropped.',
  refresh: 'Reconnecting…',
  end: 'Couldn’t end the conversation. Try again.',
  email: 'Couldn’t send your email. Try again.',
  offer: 'That follow-up offer has expired.',
};

/**
 * Draws the conversation around the player. `client` is a Stand visitor client
 * (stand-visitor.js), or anything with the same methods and state, like a
 * scripted one in a test.
 */
export function mountQuestions({ player, root, client }) {
  const $ = (selector) => root.querySelector(selector);
  const rail = $('[data-rail]');
  const threadList = $('[data-threads]');
  const composer = $('[data-composer]');
  const input = $('[data-input]');
  const live = $('[data-live]');

  const saved = readUi();
  let state = client.getSnapshot();
  let model = buildThreads(state);
  let open = saved.open ?? null; // The thread that's expanded, by key.
  let composerAt = null; // The moment the composer asks about, while it's open.
  let lastFocus = null;
  let firstRender = true;
  const seen = new Set(); // Message IDs already shown: only newer ones are announced.
  const knownMarkers = new Set();

  // The composer --------------------------------------------------------------

  function openComposer(time = player.time) {
    if (composer.hidden) lastFocus = document.activeElement;
    composerAt = Math.floor(time);
    const draft = parseQuestion(state.draft);
    if (draft && !input.value) input.value = draft.text;
    player.hold('composer', true);
    composer.hidden = false;
    root.classList.add('is-asking');
    input.focus({ preventScroll: true }); // At once, so no keystroke is lost.
    render();
    requestAnimationFrame(() => {
      autosize();
      if (player.layout === 'compact') composer.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });
  }

  function closeComposer({ restoreFocus = true } = {}) {
    if (composer.hidden) return;
    composer.hidden = true;
    composerAt = null;
    player.hold('composer', false);
    root.classList.remove('is-asking');
    if (restoreFocus && lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    render();
  }

  player.events.addEventListener('ask', () => (composer.hidden ? openComposer() : input.focus()));
  // Scrubbing while the composer is open picks a different frame to ask about.
  player.events.addEventListener('time', ({ detail }) => {
    if (composerAt !== null && Math.floor(detail.time) !== composerAt) {
      composerAt = Math.floor(detail.time);
      renderComposer();
      saveDraft();
    }
    syncToTime(detail.time, detail.playing);
    saveUiSoon();
  });
  player.events.addEventListener('state', ({ detail }) => {
    if (detail.playing) closeComposer({ restoreFocus: false });
  });

  $('[data-close]').addEventListener('click', () => closeComposer());
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeComposer();
    }
  });
  input.addEventListener('input', () => {
    autosize();
    saveDraft();
    client.typing(Boolean(input.value.trim()));
    renderComposer();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !canAsk(String(composerAt)).ok) return;
    const time = composerAt;
    const first = !['active', 'ended'].includes(state.phase);
    const body = formatQuestion(time, text);
    input.value = '';
    client.setDraft('');
    open = String(time);
    closeComposer();
    player.markTouched();
    const sent = client.send(body, first ? { prompt: buildPrompt(time), analyticsId: 'pause-to-ask' } : {});
    revealThread(String(time));
    await sent;
  });

  function saveDraft() {
    const text = input.value.trim();
    client.setDraft(text && composerAt !== null ? formatQuestion(composerAt, text) : '');
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  // Can the visitor post into this thread right now?
  function canAsk(key) {
    if (state.busy) return { ok: false, why: '' };
    if (state.phase === 'loading') return { ok: false, why: 'Checking who can answer…' };
    if (!['available', 'active'].includes(state.phase)) return { ok: false, why: '' };
    if (model.awaiting && model.awaiting !== key) {
      const t = model.threads.find((thread) => thread.key === model.awaiting);
      return { ok: false, why: t?.time != null ? `Waiting for the answer at ${t.stamp} · ${t.chapter}…` : 'Waiting for the answer to your last question…' };
    }
    return { ok: true, why: '' };
  }

  // Replies and references ------------------------------------------------------

  const makeRef = (target) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ref ref-${target.kind}`;
    button.dataset.seek = String(target.time);
    button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.6v8.8a.5.5 0 0 0 .76.43l7-4.4a.5.5 0 0 0 0-.86l-7-4.4A.5.5 0 0 0 5 3.6z" fill="currentColor"/></svg>';
    button.append(target.kind === 'chapter' ? `${target.label} · ${formatTime(target.time)}` : target.label);
    button.setAttribute('aria-label', target.kind === 'chapter' ? `Play the ${target.label} chapter, from ${formatTime(target.time)}` : `Play the tour from ${target.label}`);
    return button;
  };

  // Hovering a time in an answer shows that moment, drawn by a small copy of the scene.
  const peek = document.createElement('div');
  peek.className = 'ref-peek';
  peek.hidden = true;
  peek.setAttribute('aria-hidden', 'true'); // A visual aid: the chip's label says where it goes.
  peek.innerHTML = '<div class="ref-peek-frame" data-peek-frame></div><p><b data-peek-time></b><span data-peek-label></span></p>';
  document.body.append(peek);
  let peekTour = null;
  root.addEventListener('pointerover', (event) => {
    const ref = event.target.closest('.ref[data-seek]');
    if (!ref || event.pointerType !== 'mouse') return;
    const time = Number(ref.dataset.seek);
    peek.querySelector('[data-peek-time]').textContent = formatTime(time);
    peek.querySelector('[data-peek-label]').textContent = `${chapterAt(time).name} · ${momentAt(time).label}`;
    peek.classList.toggle('is-compact', player.layout === 'compact');
    peek.hidden = false;
    peekTour ??= player.scene(peek.querySelector('[data-peek-frame]'), { layout: () => player.layout });
    peekTour.resize();
    peekTour.render(time);
    const r = ref.getBoundingClientRect();
    const w = peek.offsetWidth;
    const h = peek.offsetHeight;
    const x = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 10 > 8 ? r.top - h - 10 : r.bottom + 10;
    peek.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
  root.addEventListener('pointerout', (event) => {
    if (event.target.closest('.ref[data-seek]')) peek.hidden = true;
  });
  addEventListener('scroll', () => (peek.hidden = true), { passive: true, capture: true });

  root.addEventListener('click', (event) => {
    const ref = event.target.closest('.ref[data-seek]');
    if (ref) {
      peek.hidden = true;
      showPlayer();
      player.seek(Number(ref.dataset.seek), { play: true });
      return;
    }
    const head = event.target.closest('[data-thread-head]');
    if (head) {
      const key = head.dataset.threadHead;
      open = key;
      const time = Number(head.dataset.time);
      if (Number.isFinite(time)) {
        player.pause({ user: true });
        player.seek(time);
      }
      render();
      saveUi();
      return;
    }
    const link = event.target.closest('a[data-link-card]');
    if (link) client.trackLinkClick(link.dataset.linkCard, link.href);
    if (event.target.closest('[data-powered]')) client.trackAttributionClick();
  });

  player.events.addEventListener('marker', ({ detail }) => {
    open = detail.key;
    const time = markerTime(detail.key);
    player.pause({ user: true });
    if (time !== null) player.seek(time);
    render();
    revealThread(detail.key);
    saveUi();
  });

  // Reply boxes inside threads
  threadList.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-reply]');
    if (!form) return;
    event.preventDefault();
    const box = form.querySelector('textarea');
    const text = box.value.trim();
    const thread = model.threads.find((t) => t.key === form.dataset.reply);
    if (!text || !thread || !canAsk(thread.key).ok) return;
    box.value = '';
    box.style.height = '';
    const body = thread.time === null ? text : formatQuestion(thread.time, text);
    await client.send(body);
  });
  threadList.addEventListener('keydown', (event) => {
    if (event.target.matches('[data-reply] textarea')) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        event.target.form.requestSubmit();
      }
    }
  });
  threadList.addEventListener('input', (event) => {
    if (event.target.matches('[data-reply] textarea')) {
      const box = event.target;
      box.style.height = 'auto';
      box.style.height = `${Math.min(box.scrollHeight, 110)}px`;
      client.typing(Boolean(box.value.trim()));
    }
  });

  // Conversation-wide actions
  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'retry-send') client.send();
    else if (action === 'retry') client.retry();
    else if (action === 'end') client.end();
    else if (action === 'new') {
      open = null;
      client.newChat().then(() => {
        const draft = parseQuestion(client.getSnapshot().draft);
        if (draft) {
          player.pause({ user: true });
          player.seek(draft.time);
          openComposer(draft.time);
        }
      });
    } else if (action === 'ask') {
      showPlayer();
      player.ask();
    }
  });
  root.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-email]');
    if (!form) return;
    event.preventDefault();
    client.submitEmail(form.querySelector('input').value);
  });

  // Rendering ---------------------------------------------------------------------

  let followed = '';
  function render() {
    model = buildThreads(state);
    renderWho();
    renderNotices();
    renderThreads();
    // Keep the newest message of the open thread in view, like any chat.
    const current = model.threads.find((t) => t.key === open);
    const latest = current ? `${current.key}:${current.items.length}:${model.awaiting === current.key}` : '';
    if (latest !== followed) {
      if (followed && current) followThread(current.key);
      followed = latest;
    }
    renderBanner();
    renderFooter();
    renderComposer();
    renderMarkers();
    announce();
    root.dataset.phase = state.phase;
    firstRender = false;
  }

  function avatar(host) {
    const url = safeUrl(host.avatar);
    const initials = (host.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return url
      ? `<img class="av" src="${escapeAttr(url)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="av av-${host.kind === 'rep' ? 'person' : 'ai'}" aria-hidden="true">${escapeHtml(initials)}</span>`;
  }

  let whoKey = '';
  function renderWho() {
    const { host, phase, connection } = state;
    const status = phase === 'loading' ? 'checking'
      : phase === 'unavailable' ? 'away'
      : phase === 'active' && connection !== 'online' ? 'connecting'
      : phase === 'ended' ? 'ended' : 'online';
    const key = [host.name, host.kind, host.avatar, status].join('|');
    if (key === whoKey) return;
    whoKey = key;
    const badge = host.kind === 'rep' ? '<em class="badge badge-person">Person</em>' : host.kind === 'standin' ? '<em class="badge">AI</em>' : '';
    const statusText = {
      checking: 'Checking who can answer…',
      away: 'Nobody can answer right now',
      connecting: 'Reconnecting…',
      ended: 'Conversation ended',
      online: host.kind === 'rep' ? 'Answering now' : 'Answers in seconds',
    }[status];
    for (const who of root.querySelectorAll('[data-who]')) {
      who.dataset.status = status;
      who.hidden = who.classList.contains('who-mini') && (!host.name || status === 'away');
      who.innerHTML = host.name && status !== 'away'
        ? `${avatar(host)}<span class="who-text"><span class="who-name"><b>${escapeHtml(host.name)}</b>${badge}</span><small><i class="dot"></i>${statusText}</small></span>`
        : `${status === 'checking' ? '<span class="av av-empty" aria-hidden="true"></span>' : ''}<span class="who-text"><small><i class="dot"></i>${statusText}</small></span>`;
    }
  }

  // Conversation-wide cards, in the rail's footer where they stay in view. Only
  // the latest change of who answers is shown, and the end once, in the banner.
  function renderNotices() {
    const box = $('[data-notices]');
    const identity = model.notices.findLast(({ card }) => ['handoff', 'human-transfer', 'standin-takeover'].includes(card.cardType));
    const shown = model.notices.filter((n) => (n === identity || !['handoff', 'human-transfer', 'standin-takeover', 'session-end'].includes(n.card.cardType)));
    const html = shown.map(({ id, card }) => {
      const message = typeof card.message === 'string' && card.message.trim() ? `<span>${escapeHtml(card.message)}</span>` : '';
      switch (card.cardType) {
        case 'handoff':
        case 'human-transfer':
          return `<div class="note note-person" data-note="${id}"><b>${escapeHtml(card.repName || 'Someone from the team')} joined the conversation.</b>${message}</div>`;
        case 'standin-takeover':
          return `<div class="note" data-note="${id}"><b>${escapeHtml(card.standinName || 'The AI Stand-in')} (AI) is answering again.</b>${message}</div>`;
        case 'session-end':
          return `<div class="note" data-note="${id}"><b>Conversation ended.</b>${message}</div>`;
        case 'rep-followup-confirmation':
          return `<div class="note note-ok" data-note="${id}"><b>Thanks. The team will follow up by email.</b>${message}</div>`;
        case 'rep-followup-offer':
          return state.followupOffered
            ? `<form class="note note-offer" data-email data-note="${id}">
                <b>${escapeHtml(card.repName || 'The team')} can follow up by email.</b>
                <span>${escapeHtml(card.message || 'Nobody could answer in time. Leave your email and the team will get back to you.')}</span>
                <span class="offer-row"><input type="email" required autocomplete="email" placeholder="you@company.com" aria-label="Your email"><button type="submit" class="btn-mini">Send</button></span>
                ${state.error === 'email' || state.error === 'offer' ? `<span class="note-err" role="alert">${ERRORS[state.error]}</span>` : ''}
              </form>`
            : '';
        default:
          return '';
      }
    }).join('');
    if (box.dataset.html !== html) {
      // Keep what the visitor typed, and where, when the form redraws.
      const typed = box.querySelector('[data-email] input');
      const value = typed?.value ?? '';
      const focused = typed && document.activeElement === typed;
      box.dataset.html = html;
      box.innerHTML = html;
      const input = box.querySelector('[data-email] input');
      if (input && value) input.value = value;
      if (input && focused) input.focus();
    }
  }

  function renderThreads() {
    const real = model.threads.length > 0;
    const list = real ? model.threads : EXAMPLES.map(exampleThread);
    $('[data-intro]').hidden = real;
    rail.classList.toggle('has-threads', real);
    $('[data-count]').textContent = String(real ? model.threads.filter((t) => t.time !== null).length : 0);

    const keys = new Set(list.map((t) => t.key));
    for (const li of [...threadList.children]) if (!keys.has(li.dataset.thread)) li.remove();
    let previous = null;
    for (const thread of list) {
      let li = threadList.querySelector(`[data-thread="${CSS.escape(thread.key)}"]`);
      if (!li) li = createThread(thread);
      if (previous ? previous.nextElementSibling !== li : threadList.firstElementChild !== li) {
        if (previous) previous.after(li);
        else threadList.prepend(li);
      }
      previous = li;
      updateThread(li, thread);
    }
  }

  function exampleThread(example) {
    return {
      key: example.key,
      example: true,
      ...describeMoment(example.time),
      items: [
        { id: `${example.key}:q`, from: 'visitor', text: example.question },
        { id: `${example.key}:a`, from: 'example', text: example.answer },
      ],
    };
  }

  function createThread(thread) {
    const li = document.createElement('li');
    li.className = 'thread';
    li.dataset.thread = thread.key;
    const where = thread.time === null
      ? '<span class="stamp stamp-plain">Tour</span><span class="where"><b>About the tour</b></span>'
      : `<span class="stamp">${escapeHtml(thread.stamp)}</span><span class="where"><b>${escapeHtml(thread.chapter)}</b> · ${escapeHtml(thread.label)}</span>`;
    li.innerHTML = `
      <button type="button" class="thread-head" data-thread-head="${escapeAttr(thread.key)}" data-time="${thread.time ?? ''}" aria-label="${thread.time === null ? 'Questions about the tour' : `Show ${escapeAttr(thread.stamp)} in the tour, ${escapeAttr(thread.chapter)}`}">
        ${where}${thread.example ? '<em class="tag">Example</em>' : ''}
      </button>
      <div class="msgs"></div>
      ${thread.example ? '' : `<form class="reply" data-reply="${escapeAttr(thread.key)}">
        <textarea rows="1" placeholder="${thread.time === null ? 'Reply…' : `Reply about ${escapeAttr(thread.stamp)}…`}" aria-label="Reply about ${thread.time === null ? 'the tour' : escapeAttr(thread.stamp)}"></textarea>
        <button type="submit" class="send send-mini" aria-label="Send reply"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.8 7.4 8 3.2l4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <span class="reply-why" data-reply-why></span>
      </form>`}`;
    return li;
  }

  function updateThread(li, thread) {
    li.classList.toggle('is-open', open === thread.key);
    li.classList.toggle('is-example', Boolean(thread.example));
    const awaiting = model.awaiting === thread.key;
    const thinking = awaiting && state.activity?.kind === 'thinking';
    const typing = awaiting && state.activity?.kind === 'typing';
    const signature = JSON.stringify([thread.items, thinking, typing, state.activity?.preview ?? '', state.error, state.busy, state.phase]);
    const msgs = li.querySelector('.msgs');
    if (msgs.dataset.sig !== signature) {
      msgs.dataset.sig = signature;
      msgs.replaceChildren(...thread.items.map((item, i) => message(item, thread.items[i - 1])));
      if (thinking || typing) {
        const row = document.createElement('div');
        row.className = 'msg msg-host msg-thinking';
        row.innerHTML = `<span class="who-line"><b>${escapeHtml(state.host.name || 'Answering')}</b>${state.host.kind === 'standin' ? '<em class="badge">AI</em>' : ''}</span>`;
        const preview = state.activity?.preview;
        const text = document.createElement('p');
        text.className = preview ? 'preview' : 'shimmer';
        text.textContent = preview || (typing ? 'Typing…' : 'Thinking…');
        row.append(text);
        msgs.append(row);
      }
    }
    const form = li.querySelector('[data-reply]');
    if (form) {
      const check = canAsk(thread.key);
      const ended = !['available', 'active'].includes(state.phase);
      form.hidden = open !== thread.key || ended;
      form.querySelector('button').disabled = !check.ok;
      form.querySelector('[data-reply-why]').textContent = check.ok ? '' : check.why;
    }
  }

  function message(item, previous) {
    const row = document.createElement('div');
    const host = item.from === 'ai' || item.from === 'person' || item.from === 'example';
    // Consecutive messages from the same sender share one name line.
    const same = previous && previous.from === item.from && previous.name === item.name;
    row.className = `msg ${host ? 'msg-host' : 'msg-you'}${item.pending ? ' is-pending' : ''}${same ? ' msg-more' : ''}`;
    const who = document.createElement('span');
    who.className = same ? 'who-line sr-only' : 'who-line';
    if (item.from === 'visitor') who.innerHTML = '<b>You</b>';
    else if (item.from === 'example') who.innerHTML = '<b>Example answer</b>';
    else who.innerHTML = `<b>${escapeHtml(item.name || 'Marquee team')}</b>${item.from === 'ai' ? '<em class="badge">AI</em>' : '<em class="badge badge-person">Person</em>'}`;
    row.append(who);
    if (item.type === 'link-card') {
      const card = parseLink(item.text);
      if (card) {
        const a = document.createElement('a');
        a.className = 'link-card';
        a.href = card.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.dataset.linkCard = item.id;
        a.innerHTML = `<b>${escapeHtml(card.title || new URL(card.url).host)}</b>${card.description ? `<span>${escapeHtml(card.description)}</span>` : ''}<small>${escapeHtml(new URL(card.url).host)} ↗</small>`;
        row.append(a);
      }
      return row;
    }
    const body = document.createElement('div');
    body.className = 'text';
    body.append(renderText(item.text, { makeRef }));
    row.append(body);
    if (item.pending) {
      const status = document.createElement('span');
      status.className = 'sending';
      const failed = state.error === 'send' && !state.busy;
      if (failed) {
        status.classList.add('failed');
        status.innerHTML = 'Not delivered. <button type="button" class="link-btn" data-action="retry-send">Retry</button>';
      } else if (state.phase === 'ended' && !state.busy) {
        status.textContent = 'Not confirmed before the conversation ended.';
      } else {
        status.textContent = 'Sending…';
      }
      row.append(status);
    }
    return row;
  }

  function parseLink(body) {
    try {
      const card = JSON.parse(body);
      const url = safeUrl(card?.url);
      return url ? { url, title: typeof card.title === 'string' ? card.title : '', description: typeof card.description === 'string' ? card.description : '' } : null;
    } catch {
      return null;
    }
  }

  function renderBanner() {
    const box = $('[data-banner]');
    const { phase, error, connection } = state;
    let html = '';
    if (phase === 'unavailable') {
      html = `<p><b>Nobody can answer right now.</b> ${error === 'start' ? ERRORS.start : error === 'connect' ? ERRORS.connect : 'Questions work when someone from the team, or their AI Stand-in, is available.'}</p><button type="button" class="btn-mini" data-action="retry">Try again</button>`;
    } else if (phase === 'uncertain') {
      html = `<p><b>Did your question arrive?</b> ${ERRORS.uncertain}</p><button type="button" class="btn-mini" data-action="new">Start a new conversation</button>`;
    } else if (phase === 'ended') {
      html = `<p><b>This conversation has ended.</b> ${error === 'gone' ? ERRORS.gone : error === 'lost' ? ERRORS.lost : 'Your questions stay here until you start again.'}</p><button type="button" class="btn-mini" data-action="new">Start a new conversation</button>`;
    } else if (phase === 'active' && error === 'paused') {
      html = `<p><b>${ERRORS.paused}</b> Your questions are safe.</p><button type="button" class="btn-mini" data-action="retry">Reconnect</button>`;
    } else if (phase === 'active' && (error === 'end' || error === 'refresh' || (connection !== 'online' && error === 'connect'))) {
      html = `<p>${ERRORS[error]}</p>`;
    }
    if (box.dataset.html !== html) {
      box.dataset.html = html;
      box.innerHTML = html;
      box.hidden = !html;
    }
  }

  function renderFooter() {
    const notice = $('[data-notice]');
    notice.textContent = state.notice;
    notice.hidden = !state.notice;
    const kind = state.host.kind === 'rep' ? 'a person on the team' : state.host.kind === 'standin' ? 'AI Stand-in' : 'Stand';
    $('[data-honest]').textContent = state.host.kind ? `Real conversation · ${kind} via Stand` : 'Real conversation via Stand';
    const url = safeUrl(state.poweredByUrl);
    for (const link of root.querySelectorAll('[data-powered]')) {
      link.hidden = !url;
      if (url) link.href = url;
    }
    $('[data-end]').hidden = state.phase !== 'active';
    $('[data-end]').disabled = state.busy;
  }

  function renderComposer() {
    if (composer.hidden || composerAt === null) return;
    const moment = describeMoment(composerAt);
    const existing = model.threads.find((t) => t.key === String(composerAt));
    $('[data-chip]').innerHTML = `<b>${escapeHtml(moment.stamp)}</b><span>${escapeHtml(moment.chapter)} · ${escapeHtml(moment.label)}</span>`;
    const check = canAsk(String(composerAt));
    let status = check.why;
    if (!status && state.phase === 'unavailable') status = 'Nobody can answer right now.';
    if (!status && state.phase === 'uncertain') status = 'Your last question may have started a conversation.';
    if (!status && state.phase === 'ended') status = 'This conversation has ended.';
    if (!status && state.error === 'start') status = ERRORS.start;
    if (!status && existing) status = `Adds to your question at ${moment.stamp}.`;
    const statusEl = $('[data-status]');
    statusEl.textContent = status;
    statusEl.classList.toggle('is-info', Boolean(existing) && check.ok);
    const actions = $('[data-composer-actions]');
    const action = state.phase === 'unavailable' ? ['retry', 'Try again']
      : state.phase === 'uncertain' || state.phase === 'ended' ? ['new', 'Start a new conversation'] : null;
    actions.innerHTML = action ? `<button type="button" class="btn-mini" data-action="${action[0]}">${action[1]}</button>` : '';
    $('[data-send]').disabled = !check.ok || !input.value.trim();
    $('[data-notice-mini]').textContent = state.notice;
    $('[data-notice-mini]').hidden = !state.notice;
  }

  function markerTime(key) {
    const example = EXAMPLES.find((e) => e.key === key);
    if (example) return example.time;
    const time = Number(key);
    return Number.isFinite(time) ? time : null;
  }

  function renderMarkers() {
    const real = model.threads.filter((t) => t.time !== null);
    const list = real.length
      ? real.map((t) => ({
        key: t.key,
        time: t.time,
        kind: 'you',
        active: open === t.key,
        label: `Your question at ${t.stamp}: ${t.items.find((i) => i.from === 'visitor')?.text ?? ''}`.slice(0, 140),
        question: `“${clip(t.items.find((i) => i.from === 'visitor')?.text ?? '', 90)}”`,
        isNew: !firstRender && !knownMarkers.has(t.key),
      }))
      : EXAMPLES.map((e) => ({ key: e.key, time: e.time, kind: 'example', active: open === e.key, label: `Example question at ${formatTime(e.time)}: ${e.question}`, question: `Example: “${clip(e.question, 80)}”` }));
    for (const m of list) knownMarkers.add(m.key);
    player.setMarkers(list);
  }

  // Screen readers hear whole replies as they arrive, never keystrokes.
  function announce() {
    const fresh = [];
    for (const m of state.messages) {
      if (seen.has(m.messageId)) continue;
      seen.add(m.messageId);
      if (firstRender) continue;
      if ((m.senderType === 'standin' || m.senderType === 'rep') && (m.type === 'text' || m.type === 'standin-idle-prompt')) {
        const thread = model.threads.find((t) => t.items.some((i) => i.id === m.messageId));
        const where = thread?.time != null ? `Answer at ${thread.stamp}: ` : 'Answer: ';
        fresh.push(where + m.body.replace(/\[\[([^\]]+)\]\]/g, '$1'));
      }
    }
    if (fresh.length) live.textContent = fresh.join(' ');
  }

  // Keeping the rail in step with the tour ---------------------------------------

  let nowKey = null;
  function syncToTime(time, playing) {
    const threads = model.threads.length ? model.threads : EXAMPLES.map(exampleThread);
    const current = playing ? threads.find((t) => t.time !== null && time >= t.time && time < t.time + 3.5) : null;
    const key = current?.key ?? null;
    if (key === nowKey) return;
    nowKey = key;
    for (const li of threadList.children) li.classList.toggle('is-now', li.dataset.thread === key);
    if (key) scrollRail(threadList.querySelector(`[data-thread="${CSS.escape(key)}"]`));
  }

  // Scrolls only the rail's own list, never the page.
  function scrollRail(el) {
    const body = $('[data-rail-body]');
    if (!el || body.scrollHeight <= body.clientHeight + 1 || rail.matches(':hover, :focus-within')) return;
    const top = el.offsetTop - body.offsetTop - 12;
    if (top < body.scrollTop || top + el.offsetHeight > body.scrollTop + body.clientHeight) {
      body.scrollTo({ top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  function followThread(key) {
    const body = $('[data-rail-body]');
    const el = threadList.querySelector(`[data-thread="${CSS.escape(key)}"]`);
    if (!el || body.scrollHeight <= body.clientHeight + 1) return;
    const top = el.offsetTop - body.offsetTop;
    const bottom = top + el.offsetHeight;
    // Scroll to the thread's end, but never past its header.
    const target = Math.min(top - 12, bottom - body.clientHeight + 12);
    if (bottom > body.scrollTop + body.clientHeight || top < body.scrollTop) {
      body.scrollTo({ top: Math.max(0, target), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  function revealThread(key) {
    requestAnimationFrame(() => {
      const el = threadList.querySelector(`[data-thread="${CSS.escape(key)}"]`);
      if (!el) return;
      const body = $('[data-rail-body]');
      if (body.scrollHeight > body.clientHeight + 1) {
        body.scrollTo({ top: el.offsetTop - body.offsetTop - 12, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      } else {
        // On phones the rail sits below the player: bring the thread into view.
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      }
    });
  }

  function showPlayer() {
    const r = root.querySelector('[data-player]').getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) {
      root.querySelector('[data-player]').scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  // UI state that isn't in the transcript: where the tour was, and the open thread.
  let saveTimer = 0;
  function saveUiSoon() {
    if (!saveTimer) saveTimer = setTimeout(saveUi, 1000);
  }
  function saveUi() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      sessionStorage.setItem(UI_KEY, JSON.stringify({ time: player.time, open, touched: player.touched }));
    } catch {
      // Storage can be denied. The tour just starts over after a reload.
    }
  }
  addEventListener('pagehide', saveUi);

  // Start -----------------------------------------------------------------------------

  client.subscribe((next) => {
    const before = state;
    state = next;
    // A start that failed hands the question back: put it back in the box.
    if (next.error === 'start' && before.error !== 'start') {
      const draft = parseQuestion(next.draft);
      if (draft) {
        input.value = draft.text;
        openComposer(draft.time);
      }
    }
    render();
  });
  client.mount();
  render();

  // A question typed before a reload comes back where it was asked.
  const draft = parseQuestion(state.draft);
  if (draft && saved.touched) {
    input.value = draft.text;
    player.seek(draft.time);
    openComposer(draft.time);
  }

  return { client, openComposer };
}

export function readUi() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(UI_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const escapeAttr = escapeHtml;
