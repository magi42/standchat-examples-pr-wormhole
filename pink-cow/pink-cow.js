// The pink cow: a low-poly 3D cow with a question mark on its side that walks
// across the page when a visitor lingers, and unfolds a chat out of its flank
// when clicked. A nod to Seth Godin's "Purple Cow": nobody remarks on a brown
// one.
//
//   import { PinkCow } from './pink-cow.js';
//   const cow = new PinkCow({ siteId: 'demo', hero: '#hero', delay: 30_000 });
//   cow.start();
//
// three.js and the cow itself load only when the cow is about to walk on.
// pink-cow.css is linked automatically. See README.md for every option.

import { CowChat } from './cow-chat.js';
import { StandClient } from './stand-client.js';

export const DEFAULT_GREETING =
  'Moo. Nobody stops scrolling for a brown cow.\n\n'
  + 'This chat is a custom UI running on Stand. Yours can look like anything: '
  + 'a character, a retro terminal, a cow. Ask me how, or why the cow is pink.';

// Hidden context for the responder (AI Stand-in or human). Stand stores it
// with the conversation, so never put secrets in it. Stand keeps 2,000 characters.
export const DEFAULT_PROMPT = [
  'Context: the visitor opened this chat by clicking a pink, low-poly 3D cow with a big question mark on its side that walked across the page. The chat unfolded out of the cow. It is a custom chat UI built on the Stand visitor API, there to show that a website chat can look like anything.',
  'The cow nods to Seth Godin\'s book "Purple Cow": after a while brown cows are invisible, while a purple one is remarkable (worth making a remark about), and remarkable is what gets noticed. Ours is pink because purple was taken. Only explain the reference if the visitor asks about the cow, its colour or the reference.',
  'When it fits, explain custom chat UIs:',
  '- They are a supported beta on every Stand plan. A team designs the whole visitor experience (a character, an animation, a retro terminal, a cow) while Stand still handles routing, AI Stand-ins, human handoff, quotas and conversation history.',
  '- They are built with ordinary browser code, or by an AI coding agent, on the Stand visitor HTTP and WebSocket API. Guide: https://stand.chat/guide/custom-chat-ui',
  '- Working examples to copy, each a public-domain folder with its source: https://examples.stand.chat (this cow is one of them: https://examples.stand.chat/pink-cow/).',
  'Keep replies short, warm and witty, with at most one cow pun per reply. You are not a real cow; you are the team\'s Stand-in answering from inside one.',
].join('\n');

const DEFAULTS = {
  /** Your Site ID from Sites in Stand, or 'demo' for Stand Chat's shared demo site. */
  siteId: 'demo',
  apiBase: 'https://api.stand.chat',
  wsBase: 'wss://api.stand.chat',
  /** The wait starts once this element's bottom is in the top quarter of the viewport. null: the wait starts at start(). */
  hero: null,
  /** Visible milliseconds to wait before the cow walks on. */
  delay: 30_000,
  /** Come once per visitor: a cookie remembers the visit. false: the cow comes again after each visit. */
  once: true,
  cookie: 'pink_cow',
  cookieDays: 400,
  /** Whether the visitor has already started a chat elsewhere on the site. The cow never bothers them. */
  hasChatted: hasWidgetConversation,
  /** Whether something would cover the cow right now: a modal, an open chat. The cow waits. */
  covered: pageCovered,
  /** The chat card. */
  title: 'Inside the pink cow',
  subtitle: 'A custom chat UI, running on Stand',
  greeting: DEFAULT_GREETING,
  prompt: DEFAULT_PROMPT,
  suggestions: ['Why a pink cow?', 'Can our chat look this different?', 'Show me some examples'],
  placeholder: 'Ask the cow anything…',
  links: [
    { label: 'More custom UIs', href: 'https://examples.stand.chat/' },
    { label: 'Build one', href: 'https://stand.chat/guide/custom-chat-ui' },
  ],
  /** What the cow says when it stops to look at the visitor. '' for nothing. */
  bubble: 'Curious?',
  /** Names this entry point in Stand's analytics. */
  analyticsId: 'pink-cow',
  /** The overlay's z-index; the chat sits five above. */
  zIndex: 90,
  /** Where the chat keeps its conversation across reloads. null: the conversation ends with the cow. */
  storage: null,
};

/** The hero counts as scrolled away once its bottom is above this share of the viewport. */
const HERO_AWAY_RATIO = 0.25;
/** Scrolling must have settled this long before the cow walks on. */
const SCROLL_SETTLE_MS = 900;
const CHECK_MS = 500;
/** With reduced motion, a still cow stays this long. */
const STILL_COW_MS = 14_000;

/** The standard Stand widget keeps an active conversation here. */
function hasWidgetConversation() {
  try {
    const saved = JSON.parse(localStorage.getItem('stand_chat_session') || 'null');
    return Boolean(saved && typeof saved === 'object' && typeof saved.sessionId === 'string' && saved.sessionId.trim()
      && typeof saved.visitorToken === 'string' && saved.visitorToken.trim());
  } catch {
    return false;
  }
}

/** A modal the cow would sit behind, or the standard chat panel. */
function pageCovered() {
  if (document.querySelector('dialog[open], [role="dialog"]:not(.pc-chat)')) return true;
  if (document.querySelector('stand-chat')?.classList.contains('widget-open')) return true;
  // stand-card spotlights and stand-button dialogs live in shadow roots.
  return [...document.querySelectorAll('stand-card, stand-button')].some((element) => element.shadowRoot?.querySelector('dialog[open]'));
}

function readCookie(name) {
  for (const part of document.cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function writeCookie(name, value, days) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  try {
    document.cookie = `${name}=${value}; Path=/; Max-Age=${days * 24 * 60 * 60}; SameSite=Lax${secure}`;
  } catch {
    // Cookies can be blocked; the cow may then return on a later visit.
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function ensureStyles() {
  const href = new URL('./pink-cow.css', import.meta.url).href;
  if ([...document.styleSheets].some((sheet) => sheet.href === href) || document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
}

const el = (tag, className) => Object.assign(document.createElement(tag), { className });

/**
 * Events (CustomEvent, detail in parentheses): armed, shown ({ summoned,
 * reducedMotion }), opened, chat-started ({ suggestion }), link-clicked
 * ({ url }), closed ({ chatStarted }), left, skipped ({ reason }).
 */
export class PinkCow extends EventTarget {
  options;

  #status = 'idle'; // idle | armed | loading | walking | opening | chatting | closing | leaving | done
  #interval = null;
  #clockStart = null; // performance.now() when the hero scrolled away
  #clockLast = null;
  #visibleMs = 0;
  #lastScroll = -Infinity;
  #onScroll = () => this.#scrolled();
  #onResize = () => this.#layout();
  #onPointerMove = (event) => this.#stage?.setPointer({ x: event.clientX, y: event.clientY });
  #stage = null;
  #stageModule = null;
  #canvas = null;
  #scrim = null;
  #hit = null;
  #say = null;
  #chat = null;
  #client = null;
  #rect = null;
  #chatStarted = false;
  #closeRequested = false;
  #reducedMotion = false;
  #timers = new Set();
  #destroyed = false;

  constructor(options = {}) {
    super();
    this.options = { ...DEFAULTS, ...options };
  }

  get status() {
    return this.#status;
  }

  /** Milliseconds before the cow is due, or null while the wait has not started. */
  get dueIn() {
    if (this.#status !== 'armed' || this.#clockStart === null) return null;
    this.#tickClock();
    return Math.max(0, this.options.delay - this.#visibleMs);
  }

  /** Change the wait. Takes effect on the running countdown too. */
  setDelay(ms) {
    this.options.delay = Math.max(0, Number(ms) || 0);
  }

  /** Arm the trigger. Skips visitors who already saw the cow or started a chat. */
  start() {
    if (this.#destroyed || this.#status !== 'idle') return;
    if (this.options.once && readCookie(this.options.cookie)) return this.#skip('seen');
    if (this.options.hasChatted()) return this.#skip('chatted');
    if (!supportsWebGL()) return this.#skip('no-webgl');
    this.#arm();
  }

  /** Bring the cow out now, wait or no wait. */
  summon() {
    if (this.#destroyed || !['idle', 'armed'].includes(this.#status)) return;
    if (!supportsWebGL()) return this.#skip('no-webgl');
    this.#disarm();
    void this.#show(true);
  }

  /** Close the chat, or send a walking cow on its way. */
  dismiss() {
    if (this.#status === 'chatting' || this.#status === 'opening') void this.#close();
    else if (this.#status === 'walking') this.#stage?.hurry();
  }

  destroy() {
    this.#destroyed = true;
    this.#disarm();
    this.#teardown();
    this.#status = 'done';
  }

  // The wait -------------------------------------------------------------------

  #arm() {
    this.#status = 'armed';
    this.#clockStart = null;
    this.#clockLast = null;
    this.#visibleMs = 0;
    this.#lastScroll = -Infinity;
    window.addEventListener('scroll', this.#onScroll, { passive: true });
    this.#interval = setInterval(() => this.#check(), CHECK_MS);
    if (this.#heroAway()) this.#startClock();
    this.dispatchEvent(new CustomEvent('armed'));
  }

  #disarm() {
    window.removeEventListener('scroll', this.#onScroll);
    clearInterval(this.#interval);
    this.#interval = null;
  }

  #skip(reason) {
    this.#status = 'done';
    this.dispatchEvent(new CustomEvent('skipped', { detail: { reason } }));
  }

  #hero() {
    const { hero } = this.options;
    return typeof hero === 'string' ? document.querySelector(hero) : hero;
  }

  #heroAway() {
    const hero = this.#hero();
    if (!hero) return true;
    return hero.getBoundingClientRect().bottom <= window.innerHeight * HERO_AWAY_RATIO;
  }

  #startClock() {
    if (this.#clockStart !== null) return;
    this.#clockStart = performance.now();
    this.#clockLast = this.#clockStart;
  }

  /** Only visible time counts: a hidden tab does not make the cow arrive. */
  #tickClock() {
    if (this.#clockLast === null) return;
    const now = performance.now();
    if (document.visibilityState === 'visible') this.#visibleMs += Math.max(0, now - this.#clockLast);
    this.#clockLast = now;
  }

  #scrolled() {
    this.#lastScroll = performance.now();
    if (this.#clockStart === null && this.#heroAway()) this.#startClock();
  }

  #check() {
    if (this.#status !== 'armed') return;
    if (this.options.hasChatted()) {
      this.#disarm();
      if (this.options.once) writeCookie(this.options.cookie, 'engaged', this.options.cookieDays);
      return this.#skip('chatted');
    }
    this.#tickClock();
    if (this.#clockStart === null || this.#visibleMs < this.options.delay) return;
    // Outside the hero, the cow waits only while it could not be seen or clicked.
    if (!this.#heroAway() || this.options.covered() || document.visibilityState !== 'visible') return;
    if (performance.now() - this.#lastScroll < SCROLL_SETTLE_MS) return;
    this.#disarm();
    void this.#show(false);
  }

  // The visit ------------------------------------------------------------------

  async #show(summoned) {
    this.#status = 'loading';
    this.#reducedMotion = prefersReducedMotion();
    this.#chatStarted = false;
    this.#closeRequested = false;
    ensureStyles();
    try {
      this.#stageModule ??= await import('./cow-stage.js');
    } catch (error) {
      console.error('Pink cow: could not load its stage', error);
      return this.#finish(false);
    }
    if (this.#destroyed || this.#status !== 'loading') return;

    const canvas = el('canvas', 'pc-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.setProperty('--pc-z', this.options.zIndex);
    if (this.#reducedMotion) canvas.style.opacity = '0';
    document.body.append(canvas);
    this.#canvas = canvas;

    const scrim = el('div', 'pc-scrim');
    scrim.setAttribute('aria-hidden', 'true');
    scrim.style.setProperty('--pc-z', this.options.zIndex);
    scrim.addEventListener('click', () => void this.#close());
    document.body.append(scrim);
    this.#scrim = scrim;

    const hit = el('button', 'pc-hit');
    hit.type = 'button';
    hit.setAttribute('aria-label', 'A pink cow with a question mark on its side. Open its chat.');
    hit.style.setProperty('--pc-z', this.options.zIndex);
    hit.addEventListener('click', () => void this.#open());
    hit.addEventListener('pointerenter', () => this.#stage?.hold('hover', true));
    hit.addEventListener('pointermove', this.#onPointerMove);
    hit.addEventListener('pointerleave', () => {
      this.#stage?.hold('hover', false);
      this.#stage?.setPointer(null);
    });
    hit.addEventListener('focus', () => this.#stage?.hold('focus', true));
    hit.addEventListener('blur', () => this.#stage?.hold('focus', false));
    document.body.append(hit);
    this.#hit = hit;

    if (this.options.bubble) {
      const say = el('div', 'pc-say');
      say.setAttribute('aria-hidden', 'true');
      say.style.setProperty('--pc-z', this.options.zIndex);
      say.style.transform = 'translate(-999px, -999px)';
      say.append(Object.assign(document.createElement('p'), { textContent: this.options.bubble }));
      document.body.append(say);
      this.#say = say;
    }

    const stage = new this.#stageModule.CowStage({ canvas });
    this.#stage = stage;
    if (this.options.once) writeCookie(this.options.cookie, 'seen', this.options.cookieDays);
    stage.onAttention = (attentive) => this.#say?.classList.toggle('pc-say--shown', attentive);
    stage.onFrame(() => {
      const bounds = stage.cowRect();
      if (this.#hit) {
        this.#hit.style.transform = `translate(${Math.round(bounds.left)}px, ${Math.round(bounds.top)}px)`;
        this.#hit.style.width = `${Math.max(0, Math.round(bounds.width))}px`;
        this.#hit.style.height = `${Math.max(0, Math.round(bounds.height))}px`;
      }
      if (this.#say) {
        const anchor = stage.headAnchor();
        this.#say.style.transform = `translate(${Math.round(anchor.x)}px, ${Math.round(anchor.y)}px) translateY(-100%)`;
      }
    });
    window.addEventListener('resize', this.#onResize);
    window.visualViewport?.addEventListener('resize', this.#onResize);
    stage.start();
    this.#status = 'walking';
    this.dispatchEvent(new CustomEvent('shown', { detail: { summoned, reducedMotion: this.#reducedMotion } }));

    // Someone who starts a chat elsewhere mid-walk has found what they need.
    const watch = setInterval(() => {
      if (this.#status !== 'walking') return clearInterval(watch);
      if (!this.options.hasChatted()) return;
      clearInterval(watch);
      this.#hit?.remove();
      this.#hit = null;
      this.#say?.remove();
      this.#say = null;
      if (!this.#reducedMotion) stage.hurry();
      else this.#fadeOut();
    }, CHECK_MS);
    this.#timers.add(watch);

    if (this.#reducedMotion) {
      stage.placeStanding(0.72);
      requestAnimationFrame(() => {
        canvas.style.opacity = '1';
      });
      const timer = setTimeout(() => {
        if (this.#status === 'walking') this.#fadeOut();
      }, STILL_COW_MS);
      this.#timers.add(timer);
      return;
    }
    const exited = await stage.walkThrough();
    if (exited && this.#status === 'walking') {
      this.dispatchEvent(new CustomEvent('left'));
      this.#finish(true);
    }
  }

  #fadeOut() {
    if (this.#canvas) this.#canvas.style.opacity = '0';
    this.#status = 'leaving';
    this.dispatchEvent(new CustomEvent('left'));
    const timer = setTimeout(() => this.#finish(true), 650);
    this.#timers.add(timer);
  }

  #layout() {
    const stage = this.#stage;
    if (!stage) return;
    stage.resize();
    const next = this.#stageModule.chatComposition(window.innerWidth, window.innerHeight).rect;
    // The on-screen keyboard on phones shrinks the visual viewport.
    const viewport = window.visualViewport;
    if (viewport && viewport.height < window.innerHeight - 80) {
      next.top = viewport.offsetTop + 12;
      next.height = Math.max(200, viewport.height - 24);
    }
    this.#rect = next;
    this.#chat?.setRect(next);
    if (this.#status === 'chatting') stage.refreshChatFraming();
  }

  #face() {
    const o = this.options;
    return {
      title: o.title,
      subtitle: o.subtitle,
      greeting: o.greeting,
      suggestions: o.suggestions,
      placeholder: o.placeholder,
      footer: ['Built on the Stand visitor API.', o.links.map((link) => link.label).join(' · ')].filter(Boolean).join(' '),
      host: 'Stand team',
    };
  }

  async #open() {
    const stage = this.#stage;
    if (!stage || this.#status !== 'walking') return;
    this.#status = 'opening';
    this.dispatchEvent(new CustomEvent('opened'));
    this.#hit?.remove();
    this.#hit = null;
    this.#say?.remove();
    this.#say = null;
    this.#scrim.classList.add('pc-scrim--shown');
    document.head.append(Object.assign(document.createElement('style'), {
      className: 'pc-hide-widget',
      textContent: 'stand-chat { display: none !important; }',
    }));

    const o = this.options;
    const client = new StandClient({
      siteId: o.siteId,
      apiBase: o.apiBase,
      wsBase: o.wsBase,
      greeting: o.greeting,
      prompt: o.prompt,
      analyticsId: o.analyticsId,
      storage: o.storage ?? undefined,
    });
    this.#client = client;
    // The visitor opened this chat UI: report it once Stand knows who answers.
    const unsubscribe = client.subscribe((state) => {
      if (state.phase !== 'available') return;
      unsubscribe();
      client.activate('click');
    });
    const chat = new CowChat({
      client,
      copy: { title: o.title, subtitle: o.subtitle, greeting: o.greeting, suggestions: o.suggestions, placeholder: o.placeholder, links: o.links },
      onClose: () => void this.#close(),
      onThinking: (thinking) => {
        if (this.#stage) this.#stage.motion.chew = thinking ? 1 : 0;
      },
      onEvent: (name, detail) => {
        if (name === 'chat-started') this.#chatStarted = true;
        this.dispatchEvent(new CustomEvent(name, { detail }));
      },
    });
    this.#chat = chat;
    this.#layout();
    chat.mount();
    chat.setRect(this.#rect);
    window.addEventListener('pointermove', this.#onPointerMove, { passive: true });

    // The HTML card fades in over the paper card as it lands, then takes over.
    if (!this.#reducedMotion) await stage.openChat(this.#rect, this.#face(), () => chat.show());
    if (this.#status !== 'opening') return;
    chat.show();
    this.#status = 'chatting';
    this.#scrim.classList.add('pc-scrim--active');
    const timer = setTimeout(() => stage.hideCard(), 260);
    this.#timers.add(timer);
    if (this.#closeRequested) void this.#close();
  }

  async #close() {
    const stage = this.#stage;
    if (this.#status === 'opening') {
      // A close that arrives while the card is still landing runs once it lands.
      this.#closeRequested = true;
      return;
    }
    if (!stage || this.#status !== 'chatting') return;
    this.#closeRequested = false;
    this.#status = 'closing';
    this.dispatchEvent(new CustomEvent('closed', { detail: { chatStarted: this.#chatStarted } }));
    this.#chat?.hide();
    this.#scrim.classList.remove('pc-scrim--shown', 'pc-scrim--active');
    window.removeEventListener('pointermove', this.#onPointerMove);
    stage.motion.chew = 0;
    stage.setPointer(null);
    if (this.#reducedMotion) return this.#fadeOut();
    await stage.closeChat(this.#rect, this.#face());
    this.#chat?.destroy();
    this.#chat = null;
    this.#status = 'leaving';
    await stage.runAway();
    this.dispatchEvent(new CustomEvent('left'));
    this.#finish(true);
  }

  #finish(again) {
    this.#teardown();
    if (this.#destroyed) return;
    this.#status = 'idle';
    // Without the cookie, the cow comes back: the wait starts over.
    if (again && !this.options.once) this.#arm();
    else this.#status = 'done';
  }

  #teardown() {
    for (const timer of this.#timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.#timers.clear();
    window.removeEventListener('resize', this.#onResize);
    window.visualViewport?.removeEventListener('resize', this.#onResize);
    window.removeEventListener('pointermove', this.#onPointerMove);
    this.#chat?.destroy();
    this.#chat = null;
    this.#client = null;
    this.#stage?.dispose();
    this.#stage = null;
    for (const node of [this.#canvas, this.#scrim, this.#hit, this.#say]) node?.remove();
    this.#canvas = this.#scrim = this.#hit = this.#say = null;
    document.querySelector('style.pc-hide-widget')?.remove();
  }
}
