// Raster Harbour's chat: a 90s demo sine scroller along the bottom of the page
// that is a complete Stand chat. Click it (or press a key) and its letters
// burst into pixels, the copper bars open into a full-screen demo, and the
// message lands as the first line of the chat. Close it and the scroller
// carries on, delivering new replies the way cracktros delivered messages.
//
//   stand-client.js  Stand's Visitor API: discovery, session, HTTP + WebSocket
//   transcript.js    what the chat shows: replies, your lines, notices, links
//   screen.js        the chat screen: the text writer, input line and header
//   strip.js         the scroller, and the morph from scroller to chat
//   effects.js       copper bars, starfields and glenz vectors
//   gl.js            WebGL 2 sprites and the glyph atlas
//   font.js          the pixel font
//   music.js         the party tune: on by default, from the first click
//
// This file puts it on the page: layout, the open and close choreography,
// the keyboard, and a screen-reader version of the conversation.

import { StandClient, safeUrl } from './stand-client.js';
import { PixelFont } from './font.js';
import { Gfx, PALETTE_INDEX as P } from './gl.js';
import { Starfield, Parallax, Glenz, copperBar } from './effects.js';
import { Strip, Morph } from './strip.js';
import { Screen } from './screen.js';
import { Transcript, describeCard } from './transcript.js';
import { music } from './music.js';

// -- Stand -------------------------------------------------------------------------

const STAND = {
  // Your Site ID from Sites in Stand. 'demo' is Stand Chat's shared demo site:
  // its AI Stand-in answers on any domain, including localhost.
  siteId: 'demo',
  // The scroller's message, and the chat's first line. Leave it out to use
  // your site's greeting.
  greeting: 'Hey! The Raster Harbour info desk is open. Ask me about tickets, compos or the sea sauna.',
  // Private context for your team and AI Stand-ins, sent with each new chat.
  prompt: `You are the info desk orga at Raster Harbour 2026, a made-up demoparty in an old ferry terminal by the sea, 27-29 November 2026. You're a friendly scener who has seen every Future Crew demo twice. The visitor chats through a custom chat UI built on Stand's Visitor API: a 90s demo sine scroller that turns into a full-screen demo, printing replies in copper-bar colours.

Rules:
- Answer the question in your first sentence. Useful first, scene flavour second.
- Short: one to three sentences, under 280 characters.
- Plain text only: no Markdown, no emoji. A URL goes on its own line.
- At most one bit of scene slang (greetings, prod, compo, bigscreen, sauna) per reply.

Party facts you may use:
- Doors Fri 16:00, prizegiving Sun 14:00. Tickets 40 EUR at the door or online, including a spot in the sleeping hall: bring a sleeping bag and a mat.
- Compos: PC demo, 64k, 4k, oldskool (Amiga, C64, Atari), tracked music, pixel graphics, wild, and a live shader showdown. Deadline Saturday 18:00, remote entries welcome.
- Sea sauna Saturday 20:00-02:00. Coffee around the clock from a 1994 machine called Paula, after the Amiga's sound chip. One power socket per seat, bring an extension cable.
Stay in the party's world. Only if someone wants to buy a ticket, book travel or actually go, tell them kindly that Raster Harbour is made up for this Stand Chat example.

Only these URLs exist:
https://stand.chat/
https://stand.chat/guide/custom-chat-ui
https://github.com/standchat/examples/tree/main/raster-harbour (this example's source)`,
  analyticsId: 'raster-harbour',
};

const TITLE = 'Raster Harbour info desk';

// -- Page -----------------------------------------------------------------------------

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointer = matchMedia('(pointer: coarse)');
const previewing = new URLSearchParams(location.search).has('preview');

const html = String.raw;
const root = document.createElement('div');
root.className = 'scroller-chat';
root.innerHTML = html`
  <canvas class="sc-canvas" aria-hidden="true"></canvas>
  <div class="sc-safe" aria-hidden="true"></div>
  <button class="sc-launcher" type="button" aria-haspopup="dialog" aria-expanded="false" hidden><span class="sc-sr"></span></button>
  <div class="sc-dialog" role="dialog" aria-modal="true" aria-label="Chat" hidden>
    <div class="sc-backdrop"></div>
    <div class="sc-transcript" aria-hidden="true"></div>
    <textarea class="sc-input" rows="1" spellcheck="true" autocomplete="off" autocapitalize="sentences" enterkeyhint="send" aria-label="Message" aria-describedby="sc-help"></textarea>
    <input class="sc-email" type="email" autocomplete="email" inputmode="email" enterkeyhint="send" aria-label="Your email" hidden>
    <p id="sc-help" class="sc-sr">Type a message and press Enter to send. Escape closes the chat; it stays open in the scroller.</p>
    <div class="sc-controls">
      <button type="button" data-control="close">Close chat</button>
      <button type="button" data-control="end" hidden>End chat</button>
      <button type="button" data-control="email" hidden>Email follow-up</button>
      <button type="button" data-control="retry" hidden>Retry</button>
      <button type="button" data-control="new" hidden>New chat</button>
      <button type="button" data-control="music" data-music-toggle aria-pressed="false">Music</button>
      <a data-control="powered" target="_blank" rel="noopener noreferrer" hidden>Powered by Stand</a>
    </div>
    <div class="sc-log sc-sr" role="log" aria-live="polite" aria-relevant="additions"></div>
    <p class="sc-status sc-sr" role="status"></p>
  </div>`;
document.body.append(root);

const $ = (selector) => root.querySelector(selector);
const canvas = $('.sc-canvas');
const launcher = $('.sc-launcher');
const dialog = $('.sc-dialog');
const backdrop = $('.sc-backdrop');
const hitArea = $('.sc-transcript');
const textarea = $('.sc-input');
const emailInput = $('.sc-email');
const log = $('.sc-log');
const status = $('.sc-status');
const safe = $('.sc-safe');
const buttons = Object.fromEntries([...root.querySelectorAll('[data-control]')].map((el) => [el.dataset.control, el]));

let storage;
try {
  storage = sessionStorage;
} catch {
  // In memory only.
}

const client = new StandClient({ ...STAND, storage });
const font = new PixelFont();
let gfx;
try {
  gfx = new Gfx(canvas, font);
} catch (error) {
  console.warn('The scroller chat needs WebGL 2.', error);
  root.remove();
}

const now = () => performance.now() / 1000;
const transcript = new Transcript({ client, now, onBlock: (block) => onBlock(block) });
const screen = gfx && new Screen(gfx, transcript, { reduced: () => reducedMotion.matches });
const strip = gfx && new Strip(gfx);
const stars = new Starfield(360, 5);
const sky = new Parallax(70, 9);
const glenz = new Glenz(); // in the header: the responder's presence
const bigGlenz = new Glenz(); // the same, large, beside the text on wide screens
bigGlenz.a = 2.2;
const HEADER_BARS = [P.bar, P.barViolet, P.barBlue];

// -- Layout ------------------------------------------------------------------------------

const layout = { dpr: 1, px: 2, vw: 1, vh: 1, phone: false, stripH: 76, inset: 0, stripVpx: 38 };

function measure() {
  const dpr = Math.min(3, devicePixelRatio || 1);
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = innerHeight;
  const phone = vw < 600 || vh < 480;
  // CSS pixels per font pixel: big and chunky on a desktop, still readable on a phone.
  const target = vw >= 900 ? 2 : vw >= 600 ? 1.75 : 1.6;
  const px = Math.max(1, Math.round(target * dpr));
  const stripVpx = phone ? 36 : 40;
  const inset = parseFloat(getComputedStyle(safe).paddingBottom) || 0;
  Object.assign(layout, { dpr, px, vw, vh, phone, stripVpx, inset, stripH: (stripVpx * px) / dpr });
  reserveSpace();
}

// The page keeps room for the scroller at its end (as --scroller-height).
function reserveSpace() {
  document.documentElement.style.setProperty('--scroller-height', stripShown ? `${Math.ceil(layout.stripH + layout.inset)}px` : '0px');
}

// The visible part of the page, above a phone's keyboard, in CSS pixels.
function visible() {
  const vv = visualViewport;
  return vv ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height } : { x: 0, y: 0, w: layout.vw, h: layout.vh };
}

let canvasMode = null; // 'strip' | 'full'

// The canvas covers only the strip while the chat is closed, the whole
// viewport while it opens, is open, or closes.
function setCanvas(mode) {
  const { dpr, vw, vh, stripH, inset } = layout;
  const top = mode === 'full' ? 0 : vh - stripH - inset;
  const height = mode === 'full' ? vh : stripH + inset;
  Object.assign(canvas.style, { top: `${top}px`, width: `${vw}px`, height: `${height}px` });
  gfx.resize(vw * dpr, height * dpr, layout.px);
  canvasMode = mode;
  canvas.dataset.mode = mode;
  layoutScreen();
}

// Device-pixel rectangles on the current canvas.
function stripTop() {
  return canvasMode === 'full' ? (layout.vh - layout.stripH - layout.inset) * layout.dpr : 0;
}
function bandRect() {
  const px = layout.px;
  return { x: 0, y: stripTop() + 3 * px + (1 - stripReveal) * layout.stripH * layout.dpr, w: gfx.width, h: (layout.stripVpx - 6) * px };
}

function layoutScreen() {
  if (canvasMode !== 'full') return;
  const v = visible();
  const d = layout.dpr;
  screen.layout({ x: v.x * d, y: v.y * d, w: v.w * d, h: v.h * d }, { phone: layout.phone });
}

function relayout() {
  measure();
  setCanvas(canvasMode === 'full' ? 'full' : 'strip');
}

// -- The strip's words ----------------------------------------------------------------------

let unread = null; // { id, text } a reply that arrived while the chat was closed
let stripShown = false;
let stripReveal = 0; // 0: below the edge, 1: in place

function stripSegments() {
  const state = client.state;
  const name = state.host.name || 'the info desk';
  const touch = coarsePointer.matches;
  const cta = touch ? 'Tap here to chat' : 'Click here or press any key to chat';
  // Standing still (reduced motion), the scroller says what to do first.
  const still = reducedMotion.matches;
  const order = (lead, message, cta) => (still ? [lead, cta, message] : [lead, message, cta]).filter(Boolean);
  if (unread) {
    return order(
      { text: `✦ New message from ${name}: `, role: 'decor', key: 'lead' },
      { text: unread.text, role: 'message', key: `reply:${unread.id}` },
      { text: ` ✦ ${touch ? 'Tap' : 'Click'} here to reply `, role: 'decor', key: 'cta' },
    );
  }
  // An open chat, or a saved one reconnecting after a reload.
  if (state.phase === 'active' || (state.phase === 'loading' && state.messages.length)) {
    const last = transcript.lastReply();
    return [
      { text: `✦ Your chat with ${name} is open `, role: 'decor', key: 'lead' },
      ...(last ? [{ text: '✦ ', role: 'decor', key: 'sep' }, { text: last.text, role: 'message', key: `reply:${last.id}` }, { text: ' ', role: 'decor', key: 'gap' }] : []),
      { text: `✦ ${touch ? 'Tap' : 'Click'} here to continue `, role: 'decor', key: 'cta' },
    ];
  }
  if (state.phase === 'ended') return [{ text: `✦ Thanks for dropping by the info desk ✦ ${touch ? 'Tap' : 'Click'} here to start a new chat `, role: 'decor', key: 'ended' }];
  if (state.phase === 'uncertain') return [{ text: `✦ Your chat may not have started ✦ ${touch ? 'Tap' : 'Click'} here to try again `, role: 'decor', key: 'uncertain' }];
  if (state.phase === 'unavailable') return [{ text: '✦ The info desk is closed right now ✦ Greetings to everybody at Raster Harbour ', role: 'decor', key: 'closed' }];
  return order(
    { text: '✦ ', role: 'decor', key: 'lead' },
    { text: state.greeting || STAND.greeting, role: 'message', key: 'greeting' },
    { text: ` ✦ ${cta} ✦ `, role: 'decor', key: 'cta' },
  );
}

function updateStrip(options) {
  if (strip) strip.setText(stripSegments(), options);
  const state = client.state;
  // No strip while Stand is still being asked, or when nobody can answer.
  const show = previewing || state.messages.length > 0 || !['loading', 'unavailable'].includes(state.phase);
  if (show !== stripShown) {
    stripShown = show;
    launcher.hidden = !show || open;
    reserveSpace();
  }
  const name = state.host.name;
  launcher.querySelector('.sc-sr').textContent = unread
    ? `New message from ${name || 'the info desk'}: ${unread.text}. Open the chat to reply.`
    : `Open the chat${name ? ` with ${name}` : ''} at the ${TITLE}`;
}

// A new block in the transcript: while the chat is closed, replies go to the scroller.
function onBlock(block) {
  if (block.kind === 'host' && block.reveal === 'writer') pulse = 1;
  if (open || block.kind !== 'host' || block.greeting || block.reveal === 'instant') return;
  queueMicrotask(() => {
    unread = { id: block.id, text: block.runs.map((r) => r.text).join('') };
    flash = 1;
    updateStrip({ now: true, drop: true });
  });
}

// -- Open and close ----------------------------------------------------------------------------

let open = false;
let openT = 0; // 0 closed, 1 open
let openFrom = 0;
let openStart = 0;
let morph = null;
let morphBlock = null;
let returnFocus = null;
let opening = { block: null, key: null }; // what lands in the chat as it opens
let dive = null; // the hero's glenz, on its way into the chat
const GRAVITY = 4200; // CSS pixels a second squared, for the dive
const HOP = 700; // CSS pixels a second, up, before it drops
let flash = 0; // the strip's bars light up for a new message
let pulse = 0; // the glenz swells when a reply lands
let emailMode = false;

// glenz: { x, y, r, a, b, c } in CSS pixels and radians, when the hero's glenz
// was played with: it dives into the scroller, and the impact opens the chat.
function openChat(interaction, { prefill = '', glenz = null } = {}) {
  if (open || !gfx) return;
  open = true;
  returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  client.activate(interaction);
  setCanvas('full');
  const state = client.state;
  if (state.phase === 'unavailable') void client.retry();
  // After an ended chat the scroller says "click here to start a new chat".
  if (state.phase === 'ended' || state.phase === 'uncertain') newChat();

  // Which words fly: the greeting before a chat, the latest reply after.
  let block = null;
  let key = null;
  if (unread) {
    block = transcript.blocks.find((b) => b.id === unread.id);
    key = `reply:${unread.id}`;
  } else if (state.phase === 'available') {
    block = transcript.showGreeting(state);
    key = 'greeting';
  } else if (state.phase === 'active') {
    const last = transcript.lastReply();
    block = last && transcript.blocks.find((b) => b.id === last.id);
    key = last && `reply:${last.id}`;
  }
  unread = null;
  screen.toEnd();
  morph = null;
  opening = { block, key };
  if (glenz && !reducedMotion.matches) {
    // The glenz hops, then drops onto the scroller; the chat opens on impact.
    const d = layout.dpr;
    const band = bandRect();
    const drop = band.y + band.h / 2 - glenz.y * d;
    const g = GRAVITY * d;
    const v = HOP * d;
    dive = { x: glenz.x * d, y: glenz.y * d, r: glenz.r * d, start: now(), impactY: band.y + band.h / 2 };
    dive.fall = (v + Math.sqrt(v * v + 2 * g * Math.max(0, drop))) / g;
    Object.assign(bigGlenz, { a: glenz.a, b: glenz.b, c: glenz.c });
    openFrom = openT;
    openStart = Infinity;
  } else {
    burst(null);
  }
  launcher.setAttribute('aria-expanded', 'true');
  launcher.hidden = true;
  dialog.hidden = false;
  root.classList.add('is-open');
  document.documentElement.classList.add('scroller-chat-open');
  setEmailMode(false);
  // A draft saved before a reload comes back.
  if (!textarea.value && state.draft && !state.busy) textarea.value = state.draft;
  textarea.focus({ preventScroll: true });
  if (prefill) setText(textarea.value + prefill);
  renderInput();
  syncControls();
  mirror(client.state);
}

// The transformation starts: the scroller's letters burst (away from impact,
// if something hit them) and the message's letters land in the chat.
function burst(impact) {
  const { block, key } = opening;
  if (stripShown && stripReveal > 0.5 && !reducedMotion.matches) {
    const source = strip.snapshot(bandRect(), key);
    const targets = block ? screen.targets(block) : [];
    if (block && targets.length) {
      block.hidden = true;
      morphBlock = block;
    }
    morph = new Morph(gfx, source, targets, key, now(), impact);
  }
  openFrom = openT;
  openStart = now();
}

function closeChat() {
  if (!open) return;
  open = false;
  dive = null;
  openFrom = openT;
  openStart = now();
  if (morphBlock) morphBlock.hidden = false;
  morph = null;
  morphBlock = null;
  launcher.setAttribute('aria-expanded', 'false');
  dialog.hidden = true;
  root.classList.remove('is-open');
  document.documentElement.classList.remove('scroller-chat-open');
  textarea.blur();
  emailInput.blur();
  updateStrip({ reset: true });
  launcher.hidden = !stripShown;
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  dispatchEvent(new CustomEvent('scroller-chat:closed'));
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function stepOpen(t) {
  const reduced = reducedMotion.matches;
  const duration = reduced ? 0.001 : open ? 0.85 : 0.5;
  const u = Math.min(1, Math.max(0, (t - openStart) / duration));
  openT = open ? openFrom + (1 - openFrom) * easeOutCubic(u) : openFrom * (1 - easeInOut(u));
  if (!open && u >= 1 && canvasMode === 'full') {
    setCanvas('strip');
    launcher.hidden = !stripShown;
  }
}

// -- Input -------------------------------------------------------------------------------------

function setEmailMode(on) {
  emailMode = on && client.state.followupOffered;
  emailInput.hidden = !emailMode;
  textarea.hidden = emailMode;
  (emailMode ? emailInput : textarea).focus({ preventScroll: true });
  renderInput();
  syncControls();
}

function activeInput() {
  return emailMode ? emailInput : textarea;
}

// Draws what is in the real input; nothing else.
function renderInput() {
  if (!screen) return;
  const el = activeInput();
  const state = client.state;
  const placeholder = emailMode
    ? 'you@example.com'
    : state.phase === 'ended' || state.phase === 'uncertain'
      ? 'Choose New chat to start again'
      : state.phase === 'unavailable'
        ? 'Nobody is at the info desk right now'
        : state.phase === 'loading'
          ? 'Connecting…'
          : 'Ask the info desk anything…';
  screen.setInput(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, emailMode ? 'email' : 'message', placeholder);
}

// The visitor typed: draw it, and keep it as the draft so a reload keeps it too.
function onInput() {
  renderInput();
  const state = client.state;
  // Mid-request the client keeps the text it is sending as its draft.
  if (!emailMode && ['available', 'active'].includes(state.phase) && !state.busy && state.draft !== textarea.value) client.setDraft(textarea.value);
}

function submit() {
  const state = client.state;
  if (emailMode) {
    const email = emailInput.value.trim();
    if (/^\S+@\S+\.\S+$/.test(email)) {
      void client.submitEmail(email).then(() => {
        if (client.state.phase === 'ended') setEmailMode(false);
      });
    } else transcript.notice('That email address doesn’t look right.', 'alert');
    return;
  }
  const text = textarea.value;
  // Still asking Stand who can answer: the message goes as soon as someone can.
  if (state.phase === 'loading' && !state.messages.length && text.trim() && !text.trim().startsWith('/')) {
    if (!queued) transcript.notice('Connecting to the info desk. Your message goes out as soon as it answers.');
    queued = true;
    return;
  }
  if (!text.trim()) {
    // Enter on an empty line: finish the text writer, or try again.
    if (state.pending && !state.busy && state.phase === 'active') void client.send();
    else if (state.phase === 'active' && state.connection === 'offline') void client.retry();
    else if (state.phase === 'ended' || state.phase === 'uncertain') newChat();
    else if (state.phase === 'unavailable') void client.retry();
    else skipWriting();
    return;
  }
  if (text.trim().startsWith('/')) {
    command(text.trim());
    setText('');
    return;
  }
  const from = screen.captureInput();
  if (transcript.send(text, from)) {
    setText('');
    screen.toEnd();
  }
}

let queued = false; // Enter pressed before Stand answered

function setText(value) {
  textarea.value = value;
  textarea.setSelectionRange(value.length, value.length);
  onInput();
}

function skipWriting() {
  const past = now() - 60;
  for (const block of transcript.blocks) if (block.reveal === 'writer') block.born = Math.min(block.born, past);
}

function newChat() {
  transcript.reset();
  void client.newChat();
  screen.toEnd();
}

function command(line) {
  const [name] = line.slice(1).split(/\s+/);
  const state = client.state;
  switch (name.toLowerCase()) {
    case 'help':
    case '?':
      transcript.notice('/end ends the chat · /new starts a new one · /music turns the party tune on or off · /about tells you how this works. Esc closes the chat; it stays open in the scroller.');
      break;
    case 'end':
    case 'bye':
    case 'quit':
      if (state.phase === 'active') void client.end();
      else transcript.notice('There is no open chat to end.');
      break;
    case 'new':
      if (state.phase === 'ended' || state.phase === 'uncertain') newChat();
      else transcript.notice('Your chat is still open. /end ends it first.');
      break;
    case 'music':
      music.toggle();
      break;
    case 'about':
      transcript.notice('A custom chat UI on Stand’s Visitor API: a sine scroller in WebGL, with its own pixel font, copper bars and glenz vectors. Source: https://github.com/standchat/examples/tree/main/raster-harbour');
      break;
    default:
      transcript.notice('Unknown command. Try /help.', 'alert');
  }
}

textarea.addEventListener('input', onInput);
emailInput.addEventListener('input', onInput);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === textarea || document.activeElement === emailInput) renderInput();
});
for (const el of [textarea, emailInput]) {
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      screen.page(event.key === 'PageUp' ? -1 : 1);
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault();
      screen.toEnd();
    }
  });
}

// The transcript: wheel and drag scroll it, a click opens a link or focuses the input.
hitArea.addEventListener('wheel', (event) => {
  event.preventDefault();
  screen.scrollBy(event.deltaY * (event.deltaMode === 1 ? 40 : 1) * layout.dpr);
}, { passive: false });
let drag = null;
hitArea.addEventListener('pointerdown', (event) => {
  drag = { y: event.clientY, moved: 0, id: event.pointerId };
});
hitArea.addEventListener('pointermove', (event) => {
  const x = event.clientX * layout.dpr;
  const y = event.clientY * layout.dpr - (canvasMode === 'full' ? 0 : stripTop());
  const link = screen.linkAt(x, y);
  screen.hovered = link;
  hitArea.style.cursor = link ? 'pointer' : 'text';
  if (drag && event.pointerId === drag.id && event.pointerType !== 'mouse') {
    const dy = drag.y - event.clientY;
    drag.moved += Math.abs(dy);
    drag.y = event.clientY;
    screen.scrollBy(dy * layout.dpr);
  }
});
hitArea.addEventListener('pointerleave', () => (screen.hovered = null));
hitArea.addEventListener('pointerup', (event) => {
  const moved = drag?.moved ?? 0;
  drag = null;
  if (moved > 8) return;
  const link = screen.linkAt(event.clientX * layout.dpr, event.clientY * layout.dpr);
  if (link) {
    openLink(link);
    return;
  }
  activeInput().focus({ preventScroll: true });
});
hitArea.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
for (const type of ['wheel', 'touchmove']) backdrop.addEventListener(type, (event) => event.preventDefault(), { passive: false });
backdrop.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  activeInput().focus({ preventScroll: true });
});

function openLink(link) {
  const url = safeUrl(link.url);
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
  if (link.card && link.messageId) void client.trackLinkClick(link.messageId, url);
}

// Controls: real buttons over the labels the screen draws.
buttons.close.addEventListener('click', closeChat);
buttons.end.addEventListener('click', () => void client.end());
buttons.new.addEventListener('click', newChat);
buttons.retry.addEventListener('click', () => {
  const state = client.state;
  if (state.pending && !state.busy) void client.send();
  else void client.retry();
});
buttons.email.addEventListener('click', () => setEmailMode(!emailMode));
buttons.powered.addEventListener('click', () => client.badgeClick());
for (const [id, el] of Object.entries(buttons)) {
  el.addEventListener('pointerenter', () => (screen.hovered = id));
  el.addEventListener('pointerleave', () => screen.hovered === id && (screen.hovered = null));
  el.addEventListener('focus', () => (focused = id));
  el.addEventListener('blur', () => focused === id && (focused = null));
  if (id !== 'powered') el.addEventListener('click', () => requestAnimationFrame(() => (document.activeElement === el || document.activeElement === document.body) && activeInput().focus({ preventScroll: true })));
}
let focused = null;

// Esc goes back a step, from anywhere in the chat: out of the email form, or
// out of the chat. Tab stays inside the chat while it is open.
dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.isComposing) {
    event.preventDefault();
    if (emailMode) setEmailMode(false);
    else closeChat();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = [activeInput(), ...Object.values(buttons).filter((b) => !b.hidden)];
  const index = items.indexOf(document.activeElement);
  const next = items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length];
  event.preventDefault();
  next.focus({ preventScroll: true });
});
document.addEventListener('keydown', (event) => {
  if (open && event.key === 'Escape' && !dialog.contains(event.target)) closeChat();
});

function controlList(state) {
  const list = [{ id: 'close', label: 'Close' }];
  if (state.phase === 'active') list.push({ id: 'end', label: 'End chat' });
  if (state.followupOffered && state.phase === 'active') list.push({ id: 'email', label: emailMode ? 'Back to chat' : 'Email', palette: P.copper });
  if (state.pending && !state.busy && state.phase === 'active') list.push({ id: 'retry', label: 'Send again', palette: P.alert });
  else if (!state.busy && (state.phase === 'unavailable' || (state.phase === 'active' && state.connection === 'offline'))) list.push({ id: 'retry', label: 'Retry', palette: P.alert });
  if (state.phase === 'ended' || state.phase === 'uncertain') list.push({ id: 'new', label: 'New chat', palette: P.copper });
  list.push({ id: 'music', label: music.playing ? '♪ Music on' : music.wanted ? '♪ Music' : '♪ Music off' });
  if (safeUrl(state.poweredByUrl)) list.push({ id: 'powered', label: 'Powered by Stand', align: 'right' });
  return list;
}

let controls = [];
function syncControls() {
  const state = client.state;
  controls = controlList(state);
  for (const [id, el] of Object.entries(buttons)) el.hidden = !controls.some((c) => c.id === id);
  const url = safeUrl(state.poweredByUrl);
  if (url) buttons.powered.href = url;
  const name = state.host.name;
  dialog.setAttribute('aria-label', name ? `Chat with ${name}, ${state.host.kind === 'rep' ? 'from the team' : 'an AI Stand-in'}` : 'Chat');
}

// Positions the real elements over what the canvas drew.
const placed = new Map();
function positionOverlay() {
  if (canvasMode !== 'full') return;
  const d = layout.dpr;
  const place = (el, r) => {
    const css = `left:${r.x / d}px;top:${r.y / d}px;width:${r.w / d}px;height:${r.h / d}px`;
    if (placed.get(el) === css) return;
    placed.set(el, css);
    Object.assign(el.style, { left: `${r.x / d}px`, top: `${r.y / d}px`, width: `${r.w / d}px`, height: `${r.h / d}px` });
  };
  const input = { x: screen.col.x - 4 * layout.px, y: screen.inputTop - 3 * layout.px, w: screen.col.w + 8 * layout.px, h: screen.inputBottom - screen.inputTop + 6 * layout.px };
  place(textarea, input);
  place(emailInput, input);
  place(hitArea, screen.view);
  for (const c of screen.controls) if (buttons[c.id]) place(buttons[c.id], c);
}

// -- Accessibility -----------------------------------------------------------------------------------

const announced = new Set();
function mirror(state) {
  for (const m of state.messages) {
    if (announced.has(m.messageId)) continue;
    announced.add(m.messageId);
    if (m.type === 'system-prompt' || m.senderType === 'system-prompt') continue;
    let text = '';
    if (m.type === 'text' || m.type === 'standin-idle-prompt') {
      if (m.senderType === 'visitor') continue;
      text = `${state.host.name || 'Info desk'}${state.host.kind === 'standin' ? ' (AI)' : ''}: ${m.body}`;
    } else if (m.type === 'link-card') {
      try {
        const card = JSON.parse(m.body);
        const url = safeUrl(card.url);
        if (!url) continue;
        const p = document.createElement('p');
        const a = Object.assign(document.createElement('a'), { href: url, textContent: card.title || url, target: '_blank', rel: 'noopener noreferrer' });
        a.addEventListener('click', () => void client.trackLinkClick(m.messageId, url));
        p.append('Link: ', a);
        log.append(p);
      } catch {
        // Skipped.
      }
      continue;
    } else if (m.type === 'system-card' || m.senderType === 'system-card') {
      text = describeCard(m.body);
      if (!text) continue;
    } else continue;
    log.append(Object.assign(document.createElement('p'), { textContent: text }));
  }
  const said = state.error || {
    loading: 'Connecting to the info desk…',
    available: state.host.name ? `${state.host.name}${state.host.kind === 'rep' ? '' : ', an AI Stand-in,'} is at the info desk. ${state.greeting || STAND.greeting}` : '',
    unavailable: 'Nobody is at the info desk right now.',
    active: state.connection === 'offline' ? 'Connection lost. Reconnecting…' : '',
    ended: 'The chat has ended. Choose New chat to start again.',
    uncertain: 'The chat may not have started. Choose New chat to try again.',
  }[state.phase];
  if (said !== undefined && said !== status.textContent) status.textContent = said;
}

// -- Header -----------------------------------------------------------------------------------------

function header(state) {
  const host = state.host;
  const kind = host.kind === 'rep' ? 'from the team' : 'AI Stand-in';
  const who = host.name ? `${host.name} · ${kind}` : 'Info desk';
  const short = host.name ? `${host.name} · ${host.kind === 'rep' ? 'team' : 'AI'}` : 'Info desk';
  let word;
  let dot = 'green';
  if (state.phase === 'loading') [word, dot] = ['connecting…', 'dust'];
  else if (state.phase === 'unavailable') [word, dot] = ['closed', 'alert'];
  else if (state.phase === 'ended') [word, dot] = ['chat ended', 'dust'];
  else if (state.phase === 'uncertain') [word, dot] = ['not confirmed', 'alert'];
  else if (state.phase === 'active' && state.connection !== 'online') [word, dot] = ['reconnecting…', 'alert'];
  else if (transcript.typing) [word, dot] = ['typing…', 'ice'];
  else word = 'online';
  return {
    title: layout.phone ? 'Info desk' : TITLE,
    status: [`${who} · ${word}`, `${short} · ${word}`, word],
    dot,
    live: state.phase === 'active' || state.phase === 'available',
    icon: true,
  };
}

// -- The frame loop --------------------------------------------------------------------------------------

let last = now();

function frame() {
  requestAnimationFrame(frame);
  if (gfx.lost) return;
  const t = now();
  const dt = Math.min(0.05, Math.max(0.001, t - last));
  last = t;
  const reduced = reducedMotion.matches;
  const px = layout.px;
  stepOpen(t);
  stripReveal = stripShown ? Math.min(1, stripReveal + dt * (reduced ? 100 : 1.8)) : Math.max(0, stripReveal - dt * 3);
  // Nothing on screen (nobody can answer): clear once, then rest.
  if (!stripReveal && !openT && !morph && !dive) {
    if (!frame.resting) gfx.begin(t);
    frame.resting = true;
    return;
  }
  frame.resting = false;
  flash = Math.max(0, flash - dt * 1.4);
  pulse = Math.max(0, pulse - dt * 2.5);
  const beat = reduced ? 0 : music.level(); // the drums, 0–1

  gfx.begin(t);
  const W = gfx.width;
  const H = gfx.height;
  const e = openT;
  const sTop = stripTop() + (1 - stripReveal) * layout.stripH * layout.dpr;
  // The frame: from the strip to the whole screen.
  const frameTop = Math.round(sTop * (1 - e));
  const frameRect = { x: 0, y: frameTop, w: W, h: H - frameTop };
  const solid = open || e > 0 ? 1 : heroSolid();
  if (stripReveal > 0 || e > 0) {
    gfx.rect(0, frameTop, W, H - frameTop, P.night, e > 0 ? 1 : solid);
    const band = bandRect();
    sky.update(dt, reduced ? 0 : 26);
    sky.draw(gfx, band, (1 - e) * stripReveal);
    stars.update(dt, reduced ? 0 : 0.16 + (morph && !morph.finished ? 0.9 * (1 - e) : 0));
    if (e > 0.01) stars.draw(gfx, frameRect, Math.min(1, e * 1.4), morph && !morph.finished && !reduced ? Math.max(0, 0.9 - e * 0.6) : 0);
    // Copper bars, top and bottom: thin on the strip, thick when open.
    const barTop = Math.round((3 + e * 3) * px);
    copperBar(gfx, 0, frameTop, W, barTop, P.bar, 1);
    if (flash > 0 || beat > 0) gfx.rect(0, frameTop, W, barTop, P.white, Math.max(flash * 0.8, beat * 0.45));
    // The bottom bar sits on the strip, above a phone's home indicator, and
    // moves down to the edge as the chat opens.
    const barBottom = Math.round((3 + e * 3) * px);
    const stripBottom = sTop + layout.stripH * layout.dpr;
    copperBar(gfx, 0, Math.round(stripBottom + (H - stripBottom) * e) - barBottom, W, barBottom, P.bar, 1);
    if (beat > 0) gfx.rect(0, Math.round(stripBottom + (H - stripBottom) * e) - barBottom, W, barBottom, P.white, beat * 0.45);
    gfx.flush();
  }

  if (e > 0.01 && canvasMode === 'full') {
    const fp = px;
    const spin = reduced ? 0 : transcript.typing ? 3.4 : music.playing ? 1.8 : 1;
    // Copper bars rolling behind the header, the far ones behind.
    const band = { y: frameTop + 6 * fp, h: screen.header.sep - frameTop - 6 * fp };
    if (band.h > 0) {
      const bars = HEADER_BARS.map((palette, i) => {
        const a = (reduced ? 1 : t) * 1.3 + i * 2.1;
        return { palette, y: band.y + band.h * (0.5 + 0.38 * Math.sin(a)), z: Math.cos(a) };
      }).sort((p, q) => p.z - q.z);
      gfx.clip(frameRect);
      for (const bar of bars) copperBar(gfx, 0, Math.round((bar.y - 3 * fp) / fp) * fp, W, 6 * fp, bar.palette, Math.min(1, (0.22 + 0.16 * bar.z + beat * 0.5) * Math.min(1, e * 1.4)));
      gfx.clip(null);
    }
    gfx.flush();
    // The header's glenz: the responder's presence, spinning faster while typing.
    // A wide screen has a big one beside the text too. The glenz that dived in
    // from the hero becomes one of them.
    const spot = glenzSpot();
    glenz.update(dt, spin);
    if (!dive || spot.big) {
      const icon = screen.icon;
      glenz.draw(gfx, icon.x, icon.y, icon.r, Math.min(1, e * 1.5));
      gfx.clip(frameRect);
      gfx.flushPolygons({ x: icon.x - icon.r * 1.6, y: icon.y - icon.r * 1.6, w: icon.r * 3.2, h: icon.r * 3.2 });
      gfx.clip(null);
    }
    if (spot.big && !dive) {
      bigGlenz.update(dt, spin * 0.8);
      const bob = reduced ? 0 : Math.sin(t * 0.9) * spot.r * 0.25;
      bigGlenz.draw(gfx, spot.x, spot.y + bob, spot.r * (1 + pulse * 0.12 + beat * 0.08), Math.min(1, e * 1.2));
      gfx.clip(frameRect);
      gfx.flushPolygons({ x: spot.x - spot.r * 2, y: spot.y + bob - spot.r * 2, w: spot.r * 4, h: spot.r * 4 });
      gfx.clip(null);
    }
    const state = client.state;
    screen.draw(t, dt, {
      frame: frameRect,
      open: e,
      header: header(state),
      controls,
      focus: focused,
      cursorOn: open && (document.activeElement === textarea || document.activeElement === emailInput),
      typing: transcript.typing && !morph,
    });
    positionOverlay();
  }

  if (e < 1 && !morph && stripShown) {
    strip.calm = reduced;
    strip.update(dt, W / px);
    const band = bandRect();
    gfx.clip({ x: 0, y: band.y - 2 * px, w: W, h: band.h + 4 * px });
    strip.draw(band, 1 - e);
    gfx.clip(null);
  } else if (strip) {
    strip.update(dt, W / px);
  }

  if (morph) {
    morph.draw(t);
    if (morph.finished) {
      if (morphBlock) morphBlock.hidden = false;
      morph = null;
      morphBlock = null;
    }
  }
  if (dive) drawDive(t, dt);
  gfx.flush();
}

// Where the responder's glenz lives in the open chat: big beside the text on
// a wide screen, otherwise in the header.
function glenzSpot() {
  const W = gfx.width;
  const margin = W - (screen.col.x + screen.col.w);
  if (margin / layout.dpr >= 230) {
    const r = Math.min(margin * 0.3, gfx.height * 0.18);
    return { x: screen.col.x + screen.col.w + margin / 2, y: gfx.height * 0.46, r, big: true };
  }
  return { ...screen.icon, big: false };
}

// The glenz from the hero: a hop, a drop onto the scroller (the impact bursts
// its letters and opens the chat), then up to its place beside the chat.
function drawDive(t, dt) {
  const d = layout.dpr;
  const s = t - dive.start;
  let x = dive.x;
  let y;
  let r = dive.r;
  if (!dive.hit) {
    if (s < dive.fall) {
      y = dive.y - HOP * d * s + 0.5 * GRAVITY * d * s * s;
      bigGlenz.update(dt, 4.5);
    } else {
      dive.hit = t;
      flash = 1;
      burst({ x: dive.x, y: dive.impactY });
    }
  }
  if (dive.hit) {
    const u = Math.min(1, (t - dive.hit) / 0.95);
    const spot = glenzSpot();
    const e = easeInOut(u);
    const bend = (p0, p1, p2) => (1 - e) * (1 - e) * p0 + 2 * e * (1 - e) * p1 + e * e * p2;
    x = bend(dive.x, dive.x + (spot.x - dive.x) * 0.35, spot.x);
    y = bend(dive.impactY, Math.min(dive.impactY, spot.y) - gfx.height * 0.22, spot.y);
    r = dive.r + (spot.r - dive.r) * e;
    bigGlenz.update(dt, 1 + 5 * (1 - u));
    if (u >= 1) {
      if (!spot.big) Object.assign(glenz, { a: bigGlenz.a, b: bigGlenz.b, c: bigGlenz.c });
      dive = null;
    }
  }
  bigGlenz.draw(gfx, x, y, r);
  gfx.flushPolygons({ x: x - r * 2, y: y - r * 2, w: r * 4, h: r * 4 });
}

// Over the hero the strip is part of the demo; below it, a solid band.
function heroSolid() {
  const hero = document.querySelector('[data-scroller-hero]');
  if (!hero) return 1;
  const bottom = hero.getBoundingClientRect().bottom;
  const top = layout.vh - layout.stripH - layout.inset;
  return 0.35 + 0.65 * Math.min(1, Math.max(0, (top - bottom + layout.stripH) / layout.stripH));
}

// -- The strip as a button ------------------------------------------------------------------------------------

launcher.addEventListener('click', (event) => openChat(event.detail === 0 ? 'keyboard' : event.pointerType === 'mouse' ? 'click' : 'tap'));
launcher.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;
  strip.hover.x = (event.clientX * layout.dpr) / layout.px;
});
launcher.addEventListener('pointerleave', () => (strip.hover.x = -1));

// The hero's glenz, played with, asks for the chat: it dives in.
addEventListener('scroller-chat:open', (event) => openChat('click', { glenz: event.detail?.glenz ?? null }));

// Page buttons with data-chat-open open the chat too.
document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-chat-open]')) {
    event.preventDefault();
    openChat('click');
  }
});

// Press any key: typing anywhere on the page starts the chat, like the old intros.
addEventListener('keydown', (event) => {
  if (open || !stripShown || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key.length !== 1 || !/[\p{L}\p{N}?!]/u.test(event.key)) return;
  const target = event.composedPath()[0];
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], [role="textbox"], dialog, summary')) return;
  const state = client.state;
  if (!['available', 'active'].includes(state.phase)) return;
  event.preventDefault();
  openChat('keyboard', { prefill: event.key });
});

// -- Start --------------------------------------------------------------------------------------------------------

function start() {
  measure();
  setCanvas('strip');
  addEventListener('resize', relayout);
  visualViewport?.addEventListener('resize', () => {
    relayout();
    if (open) screen.toEnd();
  });
  visualViewport?.addEventListener('scroll', layoutScreen);
  reducedMotion.addEventListener('change', () => updateStrip({ reset: true }));
  let phase = null;
  client.subscribe((state) => {
    transcript.update(state);
    // A new phase says something new at once; other changes wait for the loop.
    updateStrip({ now: phase !== null && phase !== state.phase });
    syncControls();
    // A failed start or a new chat puts unsent text back for review; it is never resent by itself.
    if (phase !== state.phase && ['available', 'unavailable', 'uncertain'].includes(state.phase) && state.draft && !textarea.value && !state.busy) textarea.value = state.draft;
    phase = state.phase;
    if (open) {
      // Stand answered while the chat was open, or a new chat began: the greeting,
      // then anything the visitor sent while waiting.
      if (state.phase === 'available' && !state.messages.length) transcript.showGreeting(state, 'writer');
      if (queued && state.phase !== 'loading') {
        queued = false;
        if (state.phase === 'available') submit();
      }
      mirror(state);
      renderInput();
    }
  });
  client.mount();
  music.subscribe(syncControls);
  requestAnimationFrame(frame);
}

if (gfx) start();

// For poking around in the console: the client, the transcript and the scroller.
window.scrollerChat = { client, transcript, strip, screen, open: openChat, close: closeChat };
