// Stand visitor client: the conversation, without any UI.
//
// A small, dependency-free client for Stand's visitor API (beta). It asks Stand
// who can answer, starts a conversation on the visitor's first message, sends
// over HTTP, receives over a WebSocket, and recovers after reloads and dropped
// connections without losing or duplicating messages.
//
// <stand-inline> renders it. To build your own interface on it, subscribe() and
// read getSnapshot(): every change produces a new, frozen-by-convention state.
//
// Contract: https://stand.chat/guide/custom-chat-ui (Beta). This client follows
// its recovery rules closely; keep them when you change it.

const API = 'https://api.stand.chat';
const MESSAGE_LIMIT = 500; // The most a session read returns.
const CACHED_MESSAGES = 200; // Kept in sessionStorage, for an instant restore.
const AI_REPLY_WAIT = 60000; // How long "thinking" shows while an AI reply is due.
// Changes that don't need saving: they're rebuilt after a reload.
const TRANSIENT = new Set(['activity', 'connection', 'busy', 'error']);

export const INITIAL_STATE = Object.freeze({
  phase: 'loading', // loading | available | unavailable | active | ended | uncertain
  connection: 'offline', // connecting | online | offline, while active
  busy: false, // a start, send, end or follow-up request is in flight
  error: '', // a code: connect | start | uncertain | send | lost | gone | paused | refresh | end | email | offer
  draft: '', // the owner's unsent text: kept across reloads, and given back after a failed start
  pending: null, // { body, clientMessageId, creating? }: sent, but not confirmed yet
  messages: [], // the canonical transcript, sorted by seq
  host: { name: '', title: '', avatar: '', kind: null }, // kind: 'rep' (a person) | 'standin' (AI)
  notice: '', // the site's sensitive-data notice, when configured
  poweredByUrl: '', // Stand attribution link, when the plan shows it
  followupOffered: false, // an unanswered person offered to follow up by email
  activity: null, // transient: { kind: 'thinking' | 'typing', preview }
  owner: '', // which element on the page shows the conversation
});

const clients = new Map();

/**
 * One client per API, site and scope: elements that share them share one
 * conversation, on this page and the next. A scope keeps separate
 * conversations on one site, for example per product line.
 */
export function getClient({ site, api = API, scope = '' } = {}) {
  const key = `${api}|${site}|${scope}`;
  if (!clients.has(key)) clients.set(key, new StandVisitorClient({ site, api, scope }));
  return clients.get(key);
}

export class StandVisitorClient {
  #state = INITIAL_STATE;
  #listeners = new Set();
  #session = null; // { sessionId, visitorToken, visitorId }
  #offer = {}; // the last discovery response: who would answer a new conversation
  #mounts = 0;
  #epoch = 0; // bumps on unmount, so late responses for an old mount are ignored
  #socket = null;
  #timer; // reconnect backoff, discovery retry, or the wait for "connected"
  #read = null; // AbortController for the current discovery or session read
  #retries = 0;
  #lookups = 0; // failed discovery attempts in a row
  #uncertain = false; // a start may have created a chat: never repeat it automatically
  #awaitingSince = 0; // when an AI reply became due
  #activityTimer;
  #turn = ''; // AI turn in progress, from standin.status
  #previews = new Map(); // turnId -> { seq, text }: streamed AI text, never persisted
  #typingUntil = 0; // a person is typing until then
  #visitorTyping = { active: false, at: 0, timer: 0 };

  constructor({ site, api = API, ws, page, storage, scope = '' } = {}) {
    if (!site) throw new Error('StandVisitorClient needs a site ID.');
    this.site = site;
    this.api = String(api).replace(/\/$/, '');
    this.ws = String(ws ?? this.api.replace(/^http/, 'ws')).replace(/\/$/, '');
    this.page = page ?? (() => location.href);
    this.storage = storage === undefined ? sessionStore() : storage;
    this.key = `stand-inline:v1:${this.api}:${site}${scope ? `:${scope}` : ''}`;
    this.#restore();
  }

  getSnapshot() {
    return this.#state;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Starts discovery or session recovery. Returns a function that releases it. */
  mount() {
    if (this.#mounts++ === 0) {
      this.#epoch++;
      addEventListener('online', this.#wake);
      document.addEventListener('visibilitychange', this.#wake);
      if (!this.#state.busy && this.#state.phase !== 'ended') void this.retry();
    }
    let mounted = true;
    return () => {
      if (!mounted) return;
      mounted = false;
      if (--this.#mounts > 0) return;
      this.#epoch++;
      removeEventListener('online', this.#wake);
      document.removeEventListener('visibilitychange', this.#wake);
      this.#disconnect();
      this.#read?.abort();
      // A start or send in flight still finishes: its response must be saved.
    };
  }

  setDraft(draft) {
    if (draft !== this.#state.draft) this.#update({ draft });
  }

  setOwner(owner) {
    if (owner !== this.#state.owner) this.#update({ owner });
  }

  /** Discovers who can answer, or recovers the current conversation. */
  async retry() {
    if (!this.#mounts || this.#state.busy || this.#state.phase === 'ended') return;
    this.#disconnect();
    this.#read?.abort();
    const read = (this.#read = new AbortController());
    const epoch = this.#epoch;
    const stale = () => !this.#mounts || epoch !== this.#epoch || read.signal.aborted;
    if (this.#uncertain) return this.#update({ phase: 'uncertain', error: 'uncertain' });

    this.#update({ error: '', ...(this.#session ? { connection: 'connecting' } : { phase: 'loading' }) });
    try {
      if (this.#session) {
        const data = await this.#request(this.#path(`?messageLimit=${MESSAGE_LIMIT}`), { signal: read.signal });
        if (stale()) return;
        this.#applySession(data);
        if (this.#session) this.#connect(epoch);
      } else {
        const query = new URLSearchParams({ siteId: this.site, page: this.page(), greetingsEnabled: 'false' });
        const offer = await this.#request(`/v1/reps/find?${query}`, { signal: read.signal, anonymous: true });
        if (stale()) return;
        this.#offer = offer;
        this.#lookups = 0;
        const available = offer.available === true && Boolean(text(offer.standinProfileId) || text(offer.repId));
        this.#update({
          phase: available ? 'available' : 'unavailable',
          error: '',
          host: {
            name: text(offer.repName),
            title: text(offer.repTitle),
            avatar: text(offer.avatar),
            kind: offer.responderType === 'standin' ? 'standin' : offer.responderType === 'rep' ? 'rep' : null,
          },
          notice: text(offer.sensitiveNoticeText),
          poweredByUrl: text(offer.poweredByUrl),
        });
      }
    } catch (error) {
      if (stale()) return;
      if (this.#session) {
        this.#fail(error, 'connect');
        if (this.#session) this.#scheduleReconnect();
      } else if (this.#state.phase !== 'ended') {
        // A failed lookup isn't "nobody is there". Look again a few times, sparingly.
        const transient = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
        if (transient && this.#lookups++ < 3) {
          this.#timer = setTimeout(() => {
            this.#timer = undefined;
            void this.retry();
          }, 2000 * 3 ** (this.#lookups - 1));
        } else {
          this.#update({ phase: 'unavailable', error: 'connect' });
        }
      }
    }
  }

  /**
   * Sends visitor text. The first message starts the conversation, with the
   * owner's context: { owner, greeting, prompt, analyticsId, identity }.
   * With no text, retries the unconfirmed message under its original ID.
   */
  async send(message = '', context = {}) {
    if (this.#state.busy) return false;
    const retrying = Boolean(this.#state.pending && !this.#state.pending.creating);
    const body = retrying ? this.#state.pending.body : String(message).trim();
    if (!body || !['available', 'active'].includes(this.#state.phase)) return false;
    this.#visitorTyped(false);
    this.#update({ busy: true, error: '', ...(context.owner ? { owner: context.owner } : {}) });
    let recover = false;
    try {
      if (!this.#session) {
        // Mark the start as uncertain before sending: if this page dies mid-request,
        // the next one must ask the visitor instead of starting a second chat.
        this.#uncertain = true;
        this.#update({ pending: { body, clientMessageId: '', creating: true } });
        const activationId = uuid();
        this.#activate(activationId, context);
        const identity = context.identity ?? {};
        const data = await this.#request('/v1/sessions', {
          anonymous: true,
          body: {
            siteId: this.site,
            page: this.page(),
            initialMessage: body,
            ...(text(this.#offer.standinProfileId)
              ? { standinProfileId: this.#offer.standinProfileId }
              : { repId: this.#offer.repId }),
            showId: this.#offer.showId,
            ...(context.greeting
              ? { includeOpeningGreeting: true, openingMessage: context.greeting }
              : { includeOpeningGreeting: false }),
            ...(context.prompt ? { prompt: String(context.prompt).slice(0, 2000) } : {}),
            ...(identity.externalId
              ? { visitorExternalId: String(identity.externalId), ...(identity.name ? { visitorIdentityName: String(identity.name) } : {}) }
              : {}),
            activationId,
            activationSource: 'unknown',
            ...(context.analyticsId ? { activationAnalyticsId: context.analyticsId } : {}),
            visitorLanguage: navigator.language,
            visitorLanguages: navigator.languages,
            ...(document.documentElement.lang ? { pageLanguage: document.documentElement.lang } : {}),
            ...(timezone() ? { visitorTimezone: timezone() } : {}),
          },
        });
        if (!text(data.sessionId) || !text(data.visitorToken)) throw new Error('Incomplete session credentials');
        this.#session = { sessionId: text(data.sessionId), visitorToken: text(data.visitorToken), visitorId: '' };
        this.#uncertain = false;
        this.#update({ pending: null });
        this.#applySession(data);
        this.#expectReply();
        if (this.#mounts && this.#session) this.#connect(this.#epoch);
      } else {
        const pending = this.#state.pending ?? { body, clientMessageId: uuid() };
        this.#update({ pending, draft: '' });
        const data = await this.#request(this.#path('/messages'), { body: { ...pending, type: 'text' } });
        const accepted = messages([data]);
        if (!accepted.length) throw new Error('Incomplete message response');
        this.#merge(accepted);
        this.#expectReply();
      }
      return true;
    } catch (error) {
      if (!this.#session && this.#uncertain) {
        // A clear rejection can be retried after a fresh lookup. A lost response
        // must never trigger a second start: it may have created a chat already.
        this.#uncertain = !(error instanceof HttpError && error.status >= 400 && error.status < 500);
        this.#update({
          pending: null,
          draft: [body, this.#state.draft].filter(Boolean).join('\n\n'),
          phase: this.#uncertain ? 'uncertain' : 'unavailable',
          error: this.#uncertain ? 'uncertain' : 'start',
        });
      } else {
        this.#fail(error, this.#state.phase === 'ended' ? 'lost' : 'send');
        recover = error instanceof HttpError && [404, 409].includes(error.status);
      }
      return false;
    } finally {
      this.#update({ busy: false });
      // A send that returned while the socket was down skipped recovery: do it now.
      if (this.#mounts && this.#session && (recover || (!this.#socket && !this.#timer))) void this.retry();
    }
  }

  /** Ends the conversation for good. Closing a panel is not ending a chat. */
  async end() {
    if (!this.#session || this.#state.busy) return;
    this.#update({ busy: true, error: '' });
    try {
      await this.#request(this.#path(), { method: 'DELETE' });
      this.#finish();
    } catch (error) {
      this.#fail(error, 'end');
    } finally {
      this.#update({ busy: false });
    }
  }

  /** After an ended or uncertain start: look again, and give unsent text back as a draft. */
  async newChat() {
    if (this.#state.busy || this.#session) return;
    this.#uncertain = false;
    this.#retries = 0;
    this.#lookups = 0;
    // Never replays anything into the new conversation: the visitor reviews and sends.
    const { pending, draft, owner } = this.#state;
    const unsent = pending?.body && pending.body !== draft ? [pending.body, draft].filter(Boolean).join('\n\n') : draft || pending?.body || '';
    this.#update({ ...INITIAL_STATE, draft: unsent, owner });
    await this.retry();
  }

  async submitEmail(email) {
    if (!this.#session || !this.#state.followupOffered || this.#state.busy) return false;
    this.#update({ busy: true, error: '' });
    try {
      await this.#request(this.#path('/followup-request'), { body: { email: String(email).trim() } });
      this.#finish();
      return true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) this.#update({ followupOffered: false, error: 'offer' });
      else this.#fail(error, 'email');
      return false;
    } finally {
      this.#update({ busy: false });
    }
  }

  /** Best effort: records a real click on a link card. Never blocks the navigation. */
  trackLinkClick(messageId, url) {
    if (!this.#session) return;
    this.#request(this.#path('/link-clicks'), { body: { messageId, url }, keepalive: true }).catch(() => {});
  }

  /** Best effort: records a click on the Powered by Stand link. */
  trackAttributionClick() {
    const responder = text(this.#offer.standinProfileId) ? { standinProfileId: this.#offer.standinProfileId } : { repId: this.#offer.repId };
    if (!responder.standinProfileId && !responder.repId) return;
    beacon(`${this.api}/v1/events/badge-click`, {
      siteId: this.site,
      page: this.page(),
      ...responder,
      ...(this.#session?.visitorId ? { visitorId: this.#session.visitorId } : {}),
    });
  }

  /** Lets a person on the team see that the visitor is typing. Throttled. */
  typing(active) {
    this.#visitorTyped(active);
  }

  // Internals ---------------------------------------------------------------

  #update(patch) {
    this.#state = { ...this.#state, ...patch };
    const keys = Object.keys(patch);
    if (keys.some((key) => !TRANSIENT.has(key))) {
      // Typing saves at most a few times a second; everything else saves at once,
      // before any request it protects (like the uncertain-start marker).
      if (keys.every((key) => key === 'draft')) this.#saveSoon();
      else this.#save();
    }
    for (const listener of [...this.#listeners]) listener(this.#state);
  }

  #saveTimer;
  #saveSoon() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#save(), 300);
  }

  #save() {
    clearTimeout(this.#saveTimer);
    if (!this.storage) return;
    const s = this.#state;
    try {
      this.storage.setItem(this.key, JSON.stringify({
        session: this.#session,
        uncertain: this.#uncertain,
        phase: s.phase,
        draft: s.draft,
        pending: s.pending,
        host: s.host,
        notice: s.notice,
        poweredByUrl: s.poweredByUrl,
        owner: s.owner,
        messages: s.messages.slice(-CACHED_MESSAGES),
      }));
    } catch {
      // Storage can be denied or full. The conversation still works in memory.
    }
  }

  #restore() {
    let saved;
    try {
      saved = object(JSON.parse(this.storage?.getItem(this.key) || '{}'));
    } catch {
      return;
    }
    const session = object(saved.session);
    if (text(session.sessionId) && text(session.visitorToken)) {
      this.#session = { sessionId: text(session.sessionId), visitorToken: text(session.visitorToken), visitorId: text(session.visitorId) };
    }
    const pending = object(saved.pending);
    const host = object(saved.host);
    let draft = text(saved.draft);
    // The page closed mid-start: ask the visitor before starting again.
    this.#uncertain = !this.#session && (saved.uncertain === true || pending.creating === true);
    if (this.#uncertain && text(pending.body) && !draft.includes(text(pending.body))) {
      draft = [text(pending.body), draft].filter(Boolean).join('\n\n');
    }
    const unresolved = !this.#session && !this.#uncertain && saved.phase === 'ended' && text(pending.body);
    this.#state = {
      ...INITIAL_STATE,
      // A chat that ended with nothing left unsaved doesn't follow the visitor to the next page.
      phase: unresolved ? 'ended' : 'loading',
      draft,
      messages: this.#session || unresolved ? messages(saved.messages) : [],
      pending: (this.#session || unresolved) && text(pending.body) && text(pending.clientMessageId)
        ? { body: text(pending.body), clientMessageId: text(pending.clientMessageId) }
        : null,
      host: {
        name: text(host.name),
        title: text(host.title),
        avatar: text(host.avatar),
        kind: host.kind === 'rep' || host.kind === 'standin' ? host.kind : null,
      },
      notice: this.#session ? text(saved.notice) : '',
      poweredByUrl: this.#session ? text(saved.poweredByUrl) : '',
      owner: this.#session || unresolved ? text(saved.owner) : '',
    };
    // Mid-thought on reload: keep showing that the AI reply is on its way.
    const last = this.#state.messages.findLast(isConversation);
    if (this.#session && last?.senderType === 'visitor' && Date.now() - time(last.sentAt) < AI_REPLY_WAIT) {
      this.#awaitingSince = time(last.sentAt);
    }
  }

  async #request(path, { body, method = body ? 'POST' : 'GET', signal, anonymous = false, keepalive = false } = {}) {
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    const timer = setTimeout(abort, 15000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const response = await fetch(this.api + path, {
        method,
        credentials: 'omit',
        signal: timeout.signal,
        keepalive,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(!anonymous && this.#session ? { Authorization: `Bearer ${this.#session.visitorToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new HttpError(response.status);
      return object(await response.json().catch(() => ({})));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  #path(suffix = '') {
    return `/v1/sessions/${encodeURIComponent(this.#session.sessionId)}${suffix}`;
  }

  #applySession(data) {
    if (text(data.sessionId) !== this.#session?.sessionId) throw new Error('Unexpected session response');
    const participants = (Array.isArray(data.participants) ? data.participants : []).map(object);
    const visitor = participants.find((p) => p.isRep === false);
    if (text(visitor?.userId)) this.#session.visitorId = text(visitor.userId);
    const host = participants.find((p) => p.isRep === true);
    if (host) {
      const h = this.#state.host;
      this.#update({ host: { ...h, name: text(host.name) || h.name, title: text(host.title) || h.title, avatar: text(host.avatar) || h.avatar } });
    }
    this.#merge(messages(data.messages));
    if (data.status !== 'active') return this.#finish();
    this.#update({ phase: 'active', error: '' });
    this.#updateActivity();
  }

  // Merges canonical messages by messageId, orders them by seq, and replays the
  // identity cards: who answers can change mid-conversation.
  #merge(incoming) {
    const byId = new Map(this.#state.messages.map((m) => [m.messageId, m]));
    for (const m of incoming) byId.set(m.messageId, m);
    const transcript = [...byId.values()].sort((a, b) => a.seq - b.seq);

    let host = this.#state.host;
    let followupOffered = false;
    for (const m of transcript) {
      if (m.senderType === 'rep') followupOffered = false;
      if (m.type !== 'system-card' && m.senderType !== 'system-card') continue;
      const card = parseCard(m.body);
      if (card.cardType === 'handoff' || card.cardType === 'human-transfer') {
        host = { name: text(card.repName) || host.name, title: text(card.repTitle), avatar: text(card.repAvatar), kind: 'rep' };
        followupOffered = false;
      } else if (card.cardType === 'session-start') {
        host = { ...host, name: text(card.standinName) || host.name, kind: 'standin' };
      } else if (card.cardType === 'standin-takeover') {
        host = { name: text(card.standinName) || host.name, title: text(card.standinTitle), avatar: text(card.standinAvatar) || host.avatar, kind: 'standin' };
        followupOffered = false;
      } else if (card.cardType === 'rep-followup-offer') {
        followupOffered = true;
      } else if (card.cardType === 'rep-followup-confirmation' || card.cardType === 'session-end') {
        followupOffered = false;
      }
    }

    for (const m of incoming) {
      if (m.turnId) this.#previews.delete(m.turnId);
      if (isConversation(m) && m.senderType !== 'visitor') this.#typingUntil = 0;
    }
    const pending = this.#state.pending;
    const confirmed = pending?.clientMessageId && transcript.some((m) => m.clientMessageId === pending.clientMessageId);
    this.#update({ messages: transcript, host, followupOffered, pending: confirmed ? null : pending });
    this.#updateActivity();
  }

  #finish(error = '') {
    this.#disconnect();
    this.#read?.abort();
    this.#session = null;
    this.#uncertain = false;
    this.#turn = '';
    this.#previews.clear();
    this.#awaitingSince = 0;
    this.#typingUntil = 0;
    // Unconfirmed text stays visible: a late response may still confirm it, and
    // otherwise the visitor can copy it. Nothing is resent into a new chat.
    this.#update({ phase: 'ended', connection: 'offline', followupOffered: false, activity: null, error });
  }

  async #closed() {
    // Last chance to learn whether an unconfirmed message made it in.
    if (this.#state.pending && !this.#state.pending.creating) {
      try {
        const data = await this.#request(this.#path(`?messageLimit=${MESSAGE_LIMIT}`));
        if (text(data.sessionId) === this.#session?.sessionId) this.#merge(messages(data.messages));
      } catch {
        // Closure alone doesn't prove anything about delivery. The text stays.
      }
    }
    this.#finish();
  }

  #fail(error, code) {
    if (error instanceof HttpError && [401, 403, 404].includes(error.status) && this.#session) this.#finish('gone');
    else this.#update({ error: code });
  }

  #disconnect() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#socket) {
      this.#socket.onclose = this.#socket.onmessage = this.#socket.onerror = null;
      this.#socket.close();
      this.#socket = null;
    }
    this.#turn = '';
    this.#previews.clear();
    this.#typingUntil = 0;
  }

  #scheduleReconnect() {
    if (!this.#mounts || !this.#session || this.#timer) return;
    this.#update({ connection: 'offline' });
    if (this.#retries >= 5) return this.#update({ error: 'paused' });
    const delay = Math.min(1000 * 2 ** this.#retries++, 15000) + Math.random() * 300;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.retry();
    }, delay);
  }

  #wake = () => {
    if (document.visibilityState === 'hidden' || this.#state.busy) return;
    // Sockets die quietly in background tabs and on flaky networks.
    if (this.#session && (!this.#socket || this.#socket.readyState > WebSocket.OPEN) && !this.#timer) {
      this.#retries = 0;
      void this.retry();
    } else if (!this.#session && this.#state.phase === 'unavailable' && this.#state.error === 'connect') {
      this.#lookups = 0;
      void this.retry();
    }
  };

  #connect(epoch) {
    if (!this.#mounts || !this.#session || epoch !== this.#epoch) return;
    // The configured API host, never a URL taken from a response or an event.
    const url = new URL(`${this.ws}/ws/sessions/${encodeURIComponent(this.#session.sessionId)}`);
    url.searchParams.set('token', this.#session.visitorToken);
    const socket = new WebSocket(url);
    this.#socket = socket;
    const current = () => this.#mounts && epoch === this.#epoch && this.#socket === socket && this.#session;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (current()) {
        this.#disconnect();
        this.#scheduleReconnect();
      }
    }, 10000);

    socket.onmessage = (event) => {
      if (!current()) return;
      let data;
      try {
        data = object(JSON.parse(event.data));
      } catch {
        return;
      }
      if (data.sessionId && data.sessionId !== this.#session.sessionId) return;
      // Canonical messages carry event: "message"; their type is the content type.
      if (data.event === 'message') {
        const incoming = messages([data]);
        if (incoming.length) this.#merge(incoming);
        return;
      }
      switch (data.type) {
        case 'connected':
          clearTimeout(this.#timer);
          this.#timer = undefined;
          this.#update({ connection: 'online', error: '' });
          // Subscribed first, then read: covers anything sent before the socket listened.
          this.#request(this.#path(`?messageLimit=${MESSAGE_LIMIT}`), { signal: this.#read?.signal })
            .then((snapshot) => {
              if (!current()) return;
              this.#applySession(snapshot);
              this.#retries = 0;
            })
            .catch((error) => {
              if (!current()) return;
              this.#fail(error, 'refresh');
              this.#disconnect();
              this.#scheduleReconnect();
            });
          break;
        case 'session.closed':
          void this.#closed();
          break;
        case 'typing':
          if (data.senderType === 'visitor') break; // Our own echo.
          this.#typingUntil = data.active === false ? 0 : Date.now() + 8000;
          this.#updateActivity();
          break;
        case 'standin.status':
          if (data.phase === 'typing' || data.phase === 'reconnecting') {
            this.#turn = text(data.turnId);
          } else {
            if (text(data.turnId) === this.#turn) this.#turn = '';
            if (data.phase === 'fallback') {
              this.#previews.delete(text(data.turnId));
              this.#awaitingSince = 0;
            }
          }
          this.#updateActivity();
          break;
        case 'standin.delta': {
          // text is the whole preview so far, not a token to append.
          const turn = text(data.turnId);
          const seen = this.#previews.get(turn);
          if (turn && typeof data.text === 'string' && (!seen || data.seq > seen.seq)) {
            this.#previews.set(turn, { seq: Number(data.seq) || 0, text: data.text });
            this.#updateActivity();
          }
          break;
        }
        case 'message.rejected':
          // A send raced with a reassignment. Keep it pending and recover.
          this.#update({ error: 'send' });
          this.#disconnect();
          this.#scheduleReconnect();
          break;
        default:
        // Unknown events are part of a beta contract's evolution: ignore them.
      }
    };
    socket.onclose = () => {
      if (!current()) return;
      this.#disconnect();
      this.#scheduleReconnect();
    };
    socket.onerror = () => {}; // onclose drives recovery.
  }

  #expectReply() {
    const last = this.#state.messages.findLast(isConversation);
    if (this.#state.host.kind === 'standin' && last?.senderType === 'visitor') this.#awaitingSince = Date.now();
    this.#updateActivity();
  }

  // What's happening that isn't in the transcript yet: an AI reply on its way,
  // with its streamed text when Stand sends it, or a person typing.
  #updateActivity() {
    clearTimeout(this.#activityTimer);
    const s = this.#state;
    let activity = null;
    if (s.phase === 'active') {
      const last = s.messages.findLast(isConversation);
      const due = this.#awaitingSince && last?.senderType === 'visitor' && Date.now() - this.#awaitingSince < AI_REPLY_WAIT;
      const preview = [...this.#previews.values()].at(-1)?.text ?? '';
      if (this.#turn || preview || due) activity = { kind: 'thinking', preview };
      else if (this.#typingUntil > Date.now()) activity = { kind: 'typing', preview: '' };
      if (due) this.#activityTimer = setTimeout(() => this.#updateActivity(), this.#awaitingSince + AI_REPLY_WAIT - Date.now() + 50);
      else if (activity?.kind === 'typing') this.#activityTimer = setTimeout(() => this.#updateActivity(), this.#typingUntil - Date.now() + 50);
      if (!due) this.#awaitingSince = 0;
    }
    const before = s.activity;
    if (before?.kind !== activity?.kind || before?.preview !== activity?.preview) this.#update({ activity });
  }

  #visitorTyped(active) {
    const t = this.#visitorTyping;
    clearTimeout(t.timer);
    const socket = this.#socket;
    const send = (value) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'typing', active: value }));
      t.active = value;
      t.at = Date.now();
    };
    if (!active) {
      if (t.active) send(false);
      return;
    }
    if (!t.active || Date.now() - t.at > 3000) send(true);
    t.timer = setTimeout(() => send(false), 4000);
  }

  #activate(activationId, context) {
    const responder = text(this.#offer.standinProfileId)
      ? { standinProfileId: this.#offer.standinProfileId }
      : { repId: this.#offer.repId };
    beacon(`${this.api}/v1/events/activate`, {
      siteId: this.site,
      activationId,
      showId: this.#offer.showId ?? null,
      page: this.page(),
      ...responder,
      responderType: this.#offer.responderType ?? null,
      sourceType: 'unknown',
      analyticsId: context.analyticsId || null,
      interaction: 'send',
      initialMessagePresent: true,
    });
  }
}

class HttpError extends Error {
  constructor(status) {
    super(`Request failed (${status}).`);
    this.status = status;
  }
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function messages(value) {
  return (Array.isArray(value) ? value : [])
    .filter((m) => m && typeof m.messageId === 'string' && typeof m.body === 'string'
      && typeof m.type === 'string' && typeof m.senderType === 'string' && Number.isFinite(m.seq))
    .map((m) => ({
      messageId: m.messageId,
      seq: m.seq,
      type: m.type,
      senderType: m.senderType,
      body: m.body,
      sentAt: text(m.sentAt),
      ...(text(m.clientMessageId) ? { clientMessageId: m.clientMessageId } : {}),
      ...(text(m.turnId) ? { turnId: m.turnId } : {}),
    }));
}

/** Text or link a person reads, as opposed to cards and private prompts. */
export function isConversation(m) {
  if (m.senderType === 'system-prompt' || m.type === 'system-prompt') return false;
  return m.type === 'text' || m.type === 'link-card' || m.type === 'standin-idle-prompt';
}

export function parseCard(body) {
  try {
    return object(JSON.parse(body));
  } catch {
    return {};
  }
}

// Stand's timestamps carry nanoseconds; Date.parse only promises milliseconds.
function time(value) {
  const ms = Date.parse(text(value).replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : 0;
}

function sessionStore() {
  try {
    // A framed page (a preview, an embed) keeps its conversation to itself:
    // same-origin frames share sessionStorage with the page around them.
    if (window.top !== window.self) return null;
    const storage = window.sessionStorage;
    storage.getItem('stand-inline');
    return storage;
  } catch {
    return null;
  }
}

function timezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

// Telemetry never delays the chat. text/plain keeps sendBeacon free of a preflight.
function beacon(url, data) {
  const body = JSON.stringify(data);
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
  } catch {
    // Fall through to fetch.
  }
  fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {});
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // randomUUID needs a secure context; this is the same v4 format.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
