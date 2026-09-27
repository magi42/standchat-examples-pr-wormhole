// The Stand part of this example: a small visitor client for Stand's Visitor API
// (beta), https://stand.chat/guide/custom-chat-ui. No stand.js, no framework.
// It is the vintage terminal example's client, unchanged apart from its
// storage key.
//
// It discovers a responder, creates one conversation on the visitor's first
// message, sends over HTTP (each send confirmed, retries reuse their ID),
// receives over a WebSocket, merges both into one canonical transcript, and
// recovers after reloads and dropped connections. Handoffs, follow-up offers,
// typing, streamed AI previews and link clicks are handled too.
//
// It knows nothing about cows. cow-chat.js renders its state.

const INITIAL = {
  phase: 'loading', // loading | available | unavailable | active | ended | uncertain
  connection: 'offline', // connecting | online | offline (only while active)
  busy: false,
  error: null,
  draft: '',
  pending: null, // { body, clientMessageId } until Stand confirms it
  messages: [], // canonical transcript, sorted by seq
  host: { name: '', title: '', avatar: '', kind: null }, // kind: 'rep' | 'standin'
  notice: '',
  poweredByUrl: '',
  greeting: '',
  followupOffered: false,
  typing: false, // a human rep is typing, or the AI Stand-in is working on a reply
  preview: null, // { turnId, seq, text }: a streamed AI reply, never persisted
};

const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const text = (value) => (typeof value === 'string' ? value : '');
const messages = (value) =>
  (Array.isArray(value) ? value : []).filter(
    (m) => m && typeof m.messageId === 'string' && typeof m.body === 'string' && typeof m.type === 'string'
      && typeof m.senderType === 'string' && Number.isFinite(m.seq),
  );

class HttpError extends Error {
  constructor(status) {
    super(`Request failed (${status}).`);
    this.status = status;
  }
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export class StandClient {
  #state = INITIAL;
  #session = null; // { sessionId, visitorToken, visitorId }
  #offer = {};
  #listeners = new Set();
  #mounted = false;
  #initialized = false;
  #epoch = 0;
  #socket = null;
  #timer;
  #read = null;
  #retries = 0;
  #uncertain = false;
  #activationId = null;
  #greetingShown = '';
  #typingSentAt = 0;
  #typingIdle;
  #responderTyping;
  #key;
  #api;

  /**
   * @param {object} config
   * @param {string} config.siteId       Your Site ID from Sites in Stand, or 'demo'.
   * @param {string} [config.apiBase]    https://api.stand.chat
   * @param {string} [config.wsBase]     wss://api.stand.chat
   * @param {string} [config.greeting]   Your own opening line. Leave out to use the site's greeting.
   * @param {string} [config.prompt]     Private per-conversation context for your team and AI Stand-ins.
   * @param {string} [config.analyticsId] Names this entry point in Stand's analytics.
   * @param {Storage} [config.storage]   Where to keep the conversation across reloads.
   */
  constructor(config) {
    this.config = { apiBase: 'https://api.stand.chat', wsBase: 'wss://api.stand.chat', page: () => location.href, ...config };
    this.#api = this.config.apiBase.replace(/\/$/, '');
    this.#key = `stand-pink-cow:v1:${this.#api}:${this.config.siteId}`;
  }

  get state() {
    return this.#state;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  #update(patch) {
    this.#state = { ...this.#state, ...patch };
    try {
      const s = this.#state;
      this.config.storage?.setItem(this.#key, JSON.stringify({
        session: this.#session, uncertain: this.#uncertain, phase: s.phase, draft: s.draft, pending: s.pending,
        host: s.host, notice: s.notice, poweredByUrl: s.poweredByUrl, greeting: s.greeting,
        messages: s.messages.slice(-500),
      }));
    } catch {
      // Storage can be denied or full. The chat still works in memory.
    }
    // A rendering bug must never be mistaken for a network failure.
    for (const listener of this.#listeners) {
      try {
        listener(this.#state);
      } catch (error) {
        console.error(error);
      }
    }
  }

  // Restores a saved conversation, then connects it, or runs discovery.
  // Returns a function that releases the connection (not the conversation).
  mount() {
    this.#mounted = true;
    if (!this.#initialized) {
      this.#initialized = true;
      try {
        const saved = object(JSON.parse(this.config.storage?.getItem(this.#key) || '{}'));
        const session = object(saved.session);
        if (text(session.sessionId) && text(session.visitorToken)) {
          this.#session = { sessionId: session.sessionId, visitorToken: session.visitorToken, visitorId: text(session.visitorId) };
        }
        this.#uncertain = saved.uncertain === true && !this.#session;
        const pending = object(saved.pending);
        const host = object(saved.host);
        this.#state = {
          ...INITIAL,
          phase: !this.#session && saved.phase === 'ended' ? 'ended' : 'loading',
          draft: text(saved.draft),
          messages: messages(saved.messages),
          pending: (this.#session || saved.phase === 'ended') && text(pending.body) && text(pending.clientMessageId)
            ? { body: pending.body, clientMessageId: pending.clientMessageId } : null,
          host: { name: text(host.name), title: text(host.title), avatar: text(host.avatar), kind: host.kind === 'rep' || host.kind === 'standin' ? host.kind : null },
          notice: text(saved.notice),
          poweredByUrl: text(saved.poweredByUrl),
          greeting: text(saved.greeting),
        };
      } catch {
        // Ignore corrupt or unavailable storage.
      }
      this.#update({});
    }
    const epoch = ++this.#epoch;
    if (!this.#state.busy && this.#state.phase !== 'ended') void this.retry();
    return () => {
      if (epoch !== this.#epoch) return;
      this.#mounted = false;
      ++this.#epoch;
      this.#disconnect();
      this.#read?.abort();
    };
  }

  setDraft(draft) {
    this.#update({ draft });
    this.#sendTyping(Boolean(draft.trim()));
  }

  async #request(path, body, method = body ? 'POST' : 'GET', signal) {
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    const timer = setTimeout(abort, 15000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const response = await fetch(this.#api + path, {
        method,
        credentials: 'omit',
        signal: timeout.signal,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.#session ? { Authorization: `Bearer ${this.#session.visitorToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new HttpError(response.status);
      const raw = await response.text();
      return raw ? object(JSON.parse(raw)) : {};
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  #path(suffix = '') {
    return `/v1/sessions/${encodeURIComponent(this.#session.sessionId)}${suffix}`;
  }

  // Merges canonical messages by messageId, orders them by seq, and derives the
  // current host and follow-up offer from the system cards in the transcript.
  #merge(incoming) {
    const byId = new Map(this.#state.messages.map((m) => [m.messageId, m]));
    for (const m of incoming) byId.set(m.messageId, m);
    const transcript = [...byId.values()].sort((a, b) => a.seq - b.seq);
    let host = this.#state.host;
    let followupOffered = false;
    for (const m of transcript) {
      if (m.senderType === 'rep' && m.type === 'text') followupOffered = false;
      if (m.type !== 'system-card' && m.senderType !== 'system-card') continue;
      try {
        const card = object(JSON.parse(m.body));
        if (card.cardType === 'handoff' || card.cardType === 'human-transfer') {
          host = { name: text(card.repName) || host.name, title: text(card.repTitle), avatar: text(card.repAvatar), kind: 'rep' };
          followupOffered = false;
        } else if (card.cardType === 'session-start' || card.cardType === 'standin-takeover') {
          host = { name: text(card.standinName) || host.name, title: text(card.standinTitle) || host.title, avatar: text(card.standinAvatar) || host.avatar, kind: 'standin' };
          followupOffered = false;
        } else if (card.cardType === 'rep-followup-offer') followupOffered = true;
        else if (card.cardType === 'rep-followup-confirmation' || card.cardType === 'session-end') followupOffered = false;
      } catch {
        // Unknown or malformed cards never break the transcript.
      }
    }
    const { pending, preview } = this.#state;
    const answered = preview && transcript.some((m) => m.turnId === preview.turnId && m.senderType === 'standin');
    this.#update({
      messages: transcript,
      host,
      followupOffered,
      pending: pending && transcript.some((m) => m.clientMessageId === pending.clientMessageId) ? null : pending,
      ...(answered ? { preview: null } : {}),
    });
  }

  #applySession(data) {
    if (data.sessionId !== this.#session?.sessionId) throw new Error('Unexpected session response');
    const participants = (Array.isArray(data.participants) ? data.participants : []).map(object);
    const visitor = participants.find((p) => p.isRep === false);
    if (visitor && text(visitor.userId)) this.#session.visitorId = text(visitor.userId);
    const host = participants.find((p) => p.isRep === true);
    if (host) {
      this.#update({
        host: { ...this.#state.host, name: text(host.name) || this.#state.host.name, title: text(host.title) || this.#state.host.title, avatar: text(host.avatar) || this.#state.host.avatar },
      });
    }
    this.#merge(messages(data.messages));
    if (data.status !== 'active') this.#finish();
    else this.#update({ phase: 'active', error: null });
  }

  #finish(error = null) {
    this.#disconnect();
    this.#read?.abort();
    this.#session = null;
    this.#uncertain = false;
    clearTimeout(this.#responderTyping);
    // Unresolved text keeps its ID: a late HTTP response may still confirm it.
    this.#update({ phase: 'ended', connection: 'offline', followupOffered: false, typing: false, preview: null, error });
  }

  #fail(error, fallback) {
    if (error instanceof HttpError && [401, 403, 404].includes(error.status) && this.#session) {
      this.#finish('This conversation is no longer available. Start a new chat to continue.');
    } else {
      this.#update({ error: fallback });
    }
  }

  // Reconnects a saved conversation, or asks Stand who can answer right now.
  retry = async () => {
    if (!this.#mounted || this.#state.busy || this.#state.phase === 'ended') return;
    this.#disconnect();
    this.#read?.abort();
    const read = new AbortController();
    this.#read = read;
    const epoch = this.#epoch;
    const stale = () => !this.#mounted || epoch !== this.#epoch || read.signal.aborted;
    if (this.#uncertain) {
      this.#update({ phase: 'uncertain', error: 'The previous start could not be confirmed. It may have created a chat.' });
      return;
    }
    this.#update({ error: null, ...(this.#session ? { connection: 'connecting' } : { phase: 'loading' }) });
    try {
      if (this.#session) {
        const data = await this.#request(this.#path('?messageLimit=500'), undefined, 'GET', read.signal);
        if (stale()) return;
        this.#applySession(data);
        if (this.#session) this.#connect(epoch);
      } else {
        const greetingsEnabled = this.config.greeting ? 'false' : 'true';
        const query = new URLSearchParams({ siteId: this.config.siteId, page: this.config.page(), greetingsEnabled });
        const offer = await this.#request(`/v1/reps/find?${query}`, undefined, 'GET', read.signal);
        if (stale()) return;
        this.#offer = offer;
        const available = offer.available === true && Boolean(text(offer.standinProfileId) || text(offer.repId));
        const kind = offer.responderType === 'standin' ? 'standin' : offer.responderType === 'rep' ? 'rep' : null;
        this.#update({
          phase: available ? 'available' : 'unavailable',
          host: { name: text(offer.repName), title: text(offer.repTitle), avatar: text(offer.avatar), kind },
          notice: text(offer.sensitiveNoticeText),
          poweredByUrl: text(offer.poweredByUrl),
          greeting: available ? this.config.greeting || text(offer.greeting) : '',
        });
      }
    } catch (error) {
      if (stale()) return;
      this.#fail(error, 'Could not connect. Your draft is saved.');
      if (this.#session) this.#scheduleReconnect();
      else if (this.#state.phase !== 'ended') this.#update({ phase: 'unavailable' });
    }
  };

  #disconnect() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#socket) {
      this.#socket.onclose = this.#socket.onmessage = this.#socket.onerror = null;
      this.#socket.close();
      this.#socket = null;
    }
  }

  #scheduleReconnect() {
    if (!this.#mounted || !this.#session || this.#timer) return;
    this.#update({ connection: 'offline' });
    if (this.#retries >= 5) {
      this.#update({ error: 'Connection paused. Retry to check for replies.' });
      return;
    }
    const delay = Math.min(1000 * 2 ** this.#retries++, 15000) + Math.random() * 300;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.retry();
    }, delay);
  }

  #connect(epoch) {
    if (!this.#mounted || !this.#session || epoch !== this.#epoch) return;
    // The trusted origin from config, never a URL taken from a response.
    const url = new URL(`${this.config.wsBase.replace(/\/$/, '')}/ws/sessions/${encodeURIComponent(this.#session.sessionId)}`);
    url.searchParams.set('token', this.#session.visitorToken);
    const socket = new WebSocket(url);
    this.#socket = socket;
    const current = () => this.#mounted && epoch === this.#epoch && this.#socket === socket && Boolean(this.#session);
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
      if (data.sessionId && data.sessionId !== this.#session?.sessionId) return;
      if (data.type === 'connected') {
        clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#update({ connection: 'online', error: null });
        // Subscribed first, now a snapshot covers anything sent in between.
        void this.#request(this.#path('?messageLimit=500'), undefined, 'GET', this.#read?.signal).then((snapshot) => {
          if (!current()) return;
          this.#applySession(snapshot);
          this.#retries = 0;
          if (this.#state.pending && !this.#state.busy && this.#state.phase === 'active') void this.send();
        }).catch((error) => {
          if (!current()) return;
          this.#fail(error, 'Could not refresh replies. Reconnecting.');
          this.#disconnect();
          this.#scheduleReconnect();
        });
      } else if (data.type === 'session.closed') {
        this.#finish();
      } else if (data.type === 'typing') {
        if (data.senderType === 'visitor') return; // Our own echo.
        this.#setResponderTyping(data.active === true);
      } else if (data.type === 'standin.status') {
        const phase = text(data.phase);
        this.#setResponderTyping(phase === 'typing' || phase === 'reconnecting');
        if (phase === 'fallback' && this.#state.preview?.turnId === data.turnId) this.#update({ preview: null });
      } else if (data.type === 'standin.delta') {
        // text is the full reply so far, not a token to append.
        const preview = this.#state.preview;
        if (typeof data.text !== 'string' || !Number.isFinite(data.seq)) return;
        if (preview && preview.turnId === data.turnId && preview.seq >= data.seq) return;
        this.#update({ preview: { turnId: text(data.turnId), seq: data.seq, text: data.text } });
      } else if (data.type === 'message.rejected') {
        // A send raced with a reassignment. Recover, then retry with the same ID.
        this.#update({ error: 'Your message was not accepted yet. Checking the conversation…' });
        void this.retry();
      } else {
        const incoming = messages([data]);
        if (!incoming.length) return; // Unknown or transient frames are ignored.
        if (incoming.some((m) => m.senderType === 'rep' || m.senderType === 'standin')) this.#setResponderTyping(false);
        this.#merge(incoming);
      }
    };
    socket.onclose = () => {
      if (!current()) return;
      this.#disconnect();
      this.#scheduleReconnect();
    };
    socket.onerror = () => {
      // onclose drives bounded recovery.
    };
  }

  #setResponderTyping(active) {
    clearTimeout(this.#responderTyping);
    if (active) this.#responderTyping = setTimeout(() => this.#update({ typing: false }), 20000);
    if (this.#state.typing !== active) this.#update({ typing: active });
  }

  // Tells a human rep that the visitor is typing. Best effort, throttled.
  #sendTyping(active) {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    clearTimeout(this.#typingIdle);
    const now = Date.now();
    if (active) {
      this.#typingIdle = setTimeout(() => this.#sendTyping(false), 4000);
      if (now - this.#typingSentAt < 3000) return;
      this.#typingSentAt = now;
    } else {
      if (!this.#typingSentAt) return;
      this.#typingSentAt = 0;
    }
    socket.send(JSON.stringify({ type: 'typing', active }));
  }

  // Sends the draft (or retries the pending message with its original ID).
  // The first message creates the conversation.
  send = async () => {
    if (this.#state.busy) return;
    const body = this.#state.pending?.body || this.#state.draft.trim();
    if (!body || !['available', 'active'].includes(this.#state.phase)) return;
    this.#sendTyping(false);
    this.#update({ busy: true, error: null });
    let recover = false;
    try {
      if (!this.#session) {
        this.#uncertain = true;
        this.#update({ draft: body }); // Persist an ambiguous-create marker first.
        const offer = this.#offer;
        const greeting = this.#greetingShown;
        const data = await this.#request('/v1/sessions', {
          siteId: this.config.siteId,
          page: this.config.page(),
          initialMessage: body,
          ...(text(offer.standinProfileId) ? { standinProfileId: offer.standinProfileId } : { repId: offer.repId }),
          includeOpeningGreeting: Boolean(greeting),
          ...(greeting ? { openingMessage: greeting } : {}),
          ...(greeting && greeting === text(offer.greeting) && offer.greetingVariantId ? { greetingVariantId: offer.greetingVariantId } : {}),
          ...(this.config.prompt ? { prompt: this.config.prompt.slice(0, 2000) } : {}),
          showId: offer.showId,
          ...(this.#activationId ? { activationId: this.#activationId, activationSource: 'unknown', activationAnalyticsId: this.config.analyticsId } : {}),
          visitorLanguage: navigator.language,
          visitorLanguages: navigator.languages,
          pageLanguage: document.documentElement.lang,
          visitorTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        if (!text(data.sessionId) || !text(data.visitorToken)) throw new Error('Incomplete session credentials');
        this.#session = { sessionId: data.sessionId, visitorToken: data.visitorToken, visitorId: '' };
        this.#uncertain = false;
        this.#update({ draft: '', pending: null });
        this.#applySession(data);
        if (this.#mounted && this.#session) this.#connect(this.#epoch);
      } else {
        const pending = this.#state.pending || { body, clientMessageId: crypto.randomUUID() };
        this.#update({ pending, draft: '' });
        const accepted = messages([await this.#request(this.#path('/messages'), { ...pending, type: 'text' })]);
        if (!accepted.length) throw new Error('Incomplete message response');
        this.#merge(accepted);
      }
    } catch (error) {
      if (!this.#session && this.#uncertain) {
        // A definite rejection can be retried after fresh discovery. A lost
        // response must never trigger a second create automatically.
        this.#uncertain = !(error instanceof HttpError && error.status >= 400 && error.status < 500);
        this.#update({
          phase: this.#uncertain ? 'uncertain' : 'unavailable',
          error: this.#uncertain ? 'Could not confirm whether the chat started.' : 'The chat could not start. Check availability and try again.',
        });
      } else {
        this.#fail(error, this.#state.phase === 'ended'
          ? 'Delivery was not confirmed before the chat ended.'
          : 'Message not confirmed. Send again to retry without a duplicate.');
        recover = error instanceof HttpError && error.status === 409;
      }
    } finally {
      this.#update({ busy: false });
      if (this.#mounted && this.#session && (recover || (!this.#socket && !this.#timer))) void this.retry();
    }
  };

  // Ends the conversation for everyone. Only on an explicit visitor action.
  end = async () => {
    if (!this.#session || this.#state.busy) return;
    this.#update({ busy: true, error: null });
    try {
      await this.#request(this.#path(), undefined, 'DELETE');
      this.#finish();
    } catch (error) {
      this.#fail(error, 'Could not confirm the end of this chat. Try again.');
    } finally {
      this.#update({ busy: false });
    }
  };

  // After an ended or uncertain chat: back to discovery. Unsent text returns
  // to the draft for review; it is never replayed into another conversation.
  newChat = async () => {
    if (this.#state.busy || this.#session) return;
    this.#uncertain = false;
    this.#retries = 0;
    const pendingBody = this.#state.pending?.body;
    const draft = pendingBody && pendingBody !== this.#state.draft
      ? [pendingBody, this.#state.draft].filter(Boolean).join('\n\n')
      : this.#state.draft || pendingBody || '';
    this.#update({ ...INITIAL, draft });
    await this.retry();
  };

  submitEmail = async (email) => {
    if (!this.#session || !this.#state.followupOffered || this.#state.busy) return;
    this.#update({ busy: true, error: null });
    try {
      await this.#request(this.#path('/followup-request'), { email });
      this.#finish('Your follow-up request was sent.');
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        this.#update({ followupOffered: false, error: 'That offer has changed. Reconnecting to refresh the conversation.' });
        void this.retry();
      } else {
        this.#fail(error, 'Could not submit your email. Check it and try again.');
      }
    } finally {
      this.#update({ busy: false });
    }
  };

  // The visitor saw the greeting the UI shows (sent as the opening message on create).
  showGreeting(greeting) {
    if (!greeting || this.#greetingShown === greeting) return;
    this.#greetingShown = greeting;
    const offer = this.#offer;
    // Only a human's greeting variant is reported; AI offers have none.
    if (greeting === text(offer.greeting) && offer.repId && offer.greetingVariantId) {
      this.#beacon('/v1/events/greeting-shown', { siteId: this.config.siteId, repId: offer.repId, greetingVariantId: offer.greetingVariantId, page: this.config.page() });
    }
  }

  // The visitor opened the chat UI. Correlates this activation with the chat it may start.
  activate(interaction) {
    if (this.#session || this.#state.phase !== 'available') return;
    const offer = this.#offer;
    this.#activationId = crypto.randomUUID();
    this.#beacon('/v1/events/activate', {
      siteId: this.config.siteId,
      activationId: this.#activationId,
      showId: offer.showId ?? null,
      page: this.config.page(),
      ...(text(offer.standinProfileId) ? { standinProfileId: offer.standinProfileId } : { repId: offer.repId ?? null }),
      responderType: offer.responderType ?? null,
      sourceType: 'unknown',
      analyticsId: this.config.analyticsId ?? null,
      interaction,
      initialMessagePresent: false,
    });
  }

  // The visitor clicked the "Powered by Stand" attribution.
  badgeClick() {
    const offer = this.#offer;
    const responder = text(offer.standinProfileId) ? { standinProfileId: offer.standinProfileId } : offer.repId ? { repId: offer.repId } : null;
    if (!responder) return;
    this.#beacon('/v1/events/badge-click', {
      siteId: this.config.siteId, page: this.config.page(), ...responder,
      ...(this.#session?.visitorId ? { visitorId: this.#session.visitorId } : {}),
    });
  }

  trackLinkClick = async (messageId, url) => {
    if (!this.#session) return;
    try {
      await this.#request(this.#path('/link-clicks'), { messageId, url });
    } catch {
      // Best-effort tracking never blocks navigation.
    }
  };

  // Telemetry is fire-and-forget: never awaited before opening or sending.
  #beacon(path, body) {
    const url = this.#api + path;
    const json = JSON.stringify(body);
    try {
      if (navigator.sendBeacon?.(url, new Blob([json], { type: 'text/plain' }))) return;
    } catch {
      // Fall through to fetch.
    }
    fetch(url, { method: 'POST', credentials: 'omit', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: json }).catch(() => {});
  }
}
