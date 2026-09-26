// The assistant panel: the Stand conversation beside the editor. It renders
// the visitor client's state, sends questions with the playground's context
// attached, and turns SQL and [[references]] in replies into blocks you can
// run and chips that show the table or policy. Nothing in a reply runs by itself.

import { PROMPT, composeMessage, parseMessage } from './context.js';
import { parseReply, plainText, safeUrl } from './format.js';
import { USERS, TABLES, userById } from './sandbox.js';
import { tablesIn } from './sql.js';
import { isConversation, parseCard } from './stand-visitor.js';
import { avatar, focusables, gridTable, h, icon, ms, plural, reducedMotion, store } from './ui.js';

const RUNS = 'ask-the-playground:v1:runs';
const SQL_LANGS = new Set(['sql', 'postgres', 'postgresql', 'pgsql', 'plpgsql', 'psql']);

// Error codes from stand-visitor.js, in the playground's voice.
const ERRORS = {
  connect: 'Couldn’t reach the team just now. Check your connection and try again.',
  start: 'Your question couldn’t start a conversation. It’s back in the box: try again in a moment.',
  uncertain: 'We couldn’t confirm your first message arrived, so it may have started a conversation already. Your text is kept.',
  send: 'Your last message wasn’t confirmed. Retry sends it again without a duplicate.',
  lost: 'The conversation ended before your last message was confirmed. It’s kept below.',
  gone: 'This conversation isn’t available anymore.',
  paused: 'Lost the connection to the conversation.',
  refresh: 'Couldn’t refresh the replies. Reconnecting…',
  end: 'Couldn’t confirm that the conversation ended. Try again.',
  email: 'Couldn’t send your email. Check it and try again.',
  offer: 'That offer isn’t open anymore.',
};

export class Assistant extends EventTarget {
  #draftEcho = null;
  #nodes = new Map();
  #announced = null;
  #runs = store.get(RUNS, {}) ?? {};
  #returnFocus = null;
  #pinned = true;
  #queued = null; // a question asked while Stand was still checking who can answer

  constructor(root, client, playground, { announcer } = {}) {
    super();
    this.root = root;
    this.client = client;
    this.playground = playground;
    this.announcer = announcer;
    this.attached = null;
    this.mq = matchMedia('(max-width: 900px)');
    this.#build();

    playground.addEventListener('result', (e) => {
      this.attach(playground.contextFor(e.detail));
    });
    playground.addEventListener('user', () => this.#updateRunAs());
    playground.addEventListener('schema', () => this.#refreshRefs());
    playground.addEventListener('navigate', () => this.close({ restore: false }));
    playground.addEventListener('ask', (e) => this.ask(e.detail));
    this.attached = playground.latestContext();

    this.mq.addEventListener('change', () => this.#layout());
    this.#layout();
    client.subscribe((state) => this.render(state));
    this.render(client.getSnapshot());
  }

  // Structure -------------------------------------------------------------------

  #build() {
    const root = this.root;
    root.textContent = '';
    this.title = h('h2', { class: 'ask-title', id: 'ask-title' }, icon('chat'), 'Ask Basalt');
    this.closeBtn = h('button', { class: 'ask-close', type: 'button', 'aria-label': 'Close', onclick: () => this.close() }, icon('x'));
    // Closing the panel isn't ending the chat: this is the only way to end it.
    this.endBtn = h('button', { class: 'btn btn-ghost btn-xs ask-end', type: 'button', onclick: () => this.#end() }, 'End conversation');
    this.who = h('div', { class: 'ask-who' });
    root.append(h('div', { class: 'ask-head' }, h('div', { class: 'ask-head-row' }, this.title, h('span', { class: 'dash-grow' }), this.endBtn, this.closeBtn), this.who));

    this.body = h('div', { class: 'ask-body', role: 'log', 'aria-label': 'Conversation', 'aria-live': 'off', tabindex: '-1' });
    this.empty = h('div', { class: 'ask-empty' });
    this.list = h('ol', { class: 'ask-list' });
    this.body.append(this.empty, this.list);
    this.body.addEventListener('scroll', () => {
      this.#pinned = this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 60;
    });
    root.append(this.body);

    this.banner = h('div', { class: 'ask-banner', role: 'status' });
    this.notice = h('p', { class: 'ask-notice' });
    this.attachBox = h('div', { class: 'ask-attach' });
    this.input = h('textarea', { class: 'ask-input', rows: '1', 'aria-label': 'Your question', placeholder: 'Ask the Basalt team…' });
    this.sendBtn = h('button', { class: 'btn btn-primary ask-send', type: 'submit', 'aria-label': 'Send' }, icon('send'));
    this.form = h('form', { class: 'ask-form' }, this.input, this.sendBtn);
    this.meta = h('div', { class: 'ask-meta' });
    root.append(h('div', { class: 'ask-foot' }, this.banner, this.notice, this.attachBox, this.form, this.meta));

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#submit(this.input.value, 'composer');
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.#submit(this.input.value, 'composer');
      }
    });
    this.input.addEventListener('input', () => {
      this.#setDraft(this.input.value);
      this.client.typing(Boolean(this.input.value.trim()));
      this.#grow();
      this.#renderComposer(this.client.getSnapshot());
      this.dispatchEvent(new Event('change'));
    });

    // Phones: the panel is a bottom sheet, opened from a launcher bar.
    this.launcher = document.querySelector('.ask-launcher');
    this.launcherWho = this.launcher?.querySelector('.ask-launcher-who');
    this.launcherDot = this.launcher?.querySelector('.ask-launcher-dot');
    this.launcher?.addEventListener('click', () => this.open());
    this.backdrop = h('div', { class: 'ask-backdrop', 'aria-hidden': 'true', onclick: () => this.close() });
    document.body.append(this.backdrop);
    root.addEventListener('keydown', (e) => this.#sheetKeys(e));
  }

  // Rendering -------------------------------------------------------------------

  render(state) {
    this.#syncDraft(state);
    this.#renderWho(state);
    const pinned = this.#pinned;
    this.#renderTranscript(state);
    this.#renderEmpty(state);
    this.#renderFoot(state);
    this.#renderLauncher(state);
    if (!this.empty.hidden) this.body.scrollTop = 0;
    else if (pinned) this.#scrollToEnd();
    const ready = ['available', 'active', 'loading'].includes(state.phase);
    const text = state.phase === 'unavailable' ? 'Nobody can answer right now. Try again in a minute.'
      : state.phase === 'ended' ? 'The last conversation ended: start a new one to ask again.'
      : state.phase === 'uncertain' ? 'Start a new conversation first.' : '';
    this.playground.setAskStatus({ ready, text });
    // A question asked during the availability check goes out once someone can answer.
    if (this.#queued && state.phase !== 'loading') {
      const q = this.#queued;
      this.#queued = null;
      if (['available', 'active'].includes(state.phase)) queueMicrotask(() => this.#submit(q.question, q.source, { withContext: q.withContext }));
    }
  }

  #identity(state) {
    const { host } = state;
    return { name: host.name || 'Basalt team', avatar: safeUrl(host.avatar), kind: host.kind };
  }

  #renderWho(state) {
    const who = this.who;
    who.textContent = '';
    if (state.phase === 'loading' && !state.messages.length) {
      who.append(h('span', { class: 'who-dot' }), h('span', { class: 'shimmer', text: 'Checking who can answer…' }));
      return;
    }
    if (state.phase === 'unavailable' && !state.messages.length) {
      who.append(h('span', { class: 'who-dot' }), h('span', { text: 'Nobody can answer right now' }));
      return;
    }
    const id = this.#identity(state);
    who.append(this.#whoAvatar(id), h('span', { class: 'ask-who-name', text: id.name }), this.#badge(id.kind));
    if (state.phase === 'ended') who.append(h('span', { text: '· ended' }));
  }

  // Stand's avatar when it gives one; otherwise the responder's initials.
  #whoAvatar(id) {
    const el = h('span', { class: `who-avatar${id.kind === 'rep' ? ' is-rep' : ''}`, 'aria-hidden': 'true' });
    const fallback = () => h('span', { text: initials(id.name) });
    if (id.avatar) {
      const img = h('img', { src: id.avatar, alt: '', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.replaceWith(fallback()));
      el.append(img);
    } else {
      el.append(fallback());
    }
    return el;
  }

  #badge(kind) {
    if (kind === 'standin') return h('span', { class: 'who-badge', text: 'AI Stand-in' });
    if (kind === 'rep') return h('span', { class: 'who-badge is-rep', text: 'Team member' });
    return null;
  }

  #renderEmpty(state) {
    const show = !state.messages.some(isVisible) && !state.pending;
    this.empty.hidden = !show;
    if (!show) return;
    this.empty.textContent = '';
    this.empty.append(
      h('h3', { text: state.phase === 'unavailable' ? 'Nobody’s around right now' : 'Stuck on a query?' }),
      h('p', {
        text: state.phase === 'unavailable'
          ? 'Nobody from the team, and no AI Stand-in, can answer at the moment. Keep playing: your question and query stay here, and you can try again in a minute.'
          : 'Ask here: the team gets your question with the query, role and result attached.',
      }),
    );
    if (state.phase === 'unavailable') {
      this.empty.append(h('div', {}, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => this.client.retry() }, icon('reset'), 'Try again')));
      return;
    }
    const list = h('ul', { class: 'ask-suggest' });
    for (const s of this.#suggestions()) {
      list.append(h('li', {}, h('button', {
        class: 'suggestion', type: 'button', disabled: !['available', 'active'].includes(state.phase) || state.busy,
        onclick: () => this.#submit(s.text, 'suggestion', { withContext: s.withContext }),
      }, h('span', { text: s.text }), icon('arrow'))));
    }
    list.setAttribute('aria-label', 'Suggested questions');
    this.empty.append(list);
  }

  #suggestions() {
    const c = this.attached;
    const who = c?.userLabel ?? this.playground.user.label;
    const o = c?.outcome;
    const own = [];
    if (o?.kind === 'error') own.push('Why did this fail?', 'Which policy decides this?', `How would I let ${who} do this?`);
    else if ((o?.kind === 'rows' && o.count === 0) || (o?.kind === 'table' && o.visible === 0)) own.push('Why is this empty?', 'Which policy hides these rows?', `How do I let ${who} see them?`);
    else if (o?.kind === 'command' && o.affected === 0) own.push('Why did nothing change?', `How would I let ${who} do this?`);
    else if (o?.kind === 'rows') own.push(`Why can ${who} see these rows?`, 'Explain what this query does');
    return [
      ...own.slice(0, 3).map((text) => ({ text, withContext: true })),
      { text: own.length ? 'How much is Pro?' : 'What is row-level security?', withContext: false },
      ...(own.length ? [] : [{ text: 'How much is Pro?', withContext: false }, { text: 'Can I self-host Basalt?', withContext: false }]),
    ];
  }

  #renderTranscript(state) {
    const keys = [];
    const build = new Map();
    // Who said what: replayed from the identity cards, since the host can change mid-conversation.
    const host = this.#identity(state);
    let who = {
      standin: host.kind === 'standin' ? host : { name: 'AI Stand-in', avatar: null, kind: 'standin' },
      rep: host.kind === 'rep' ? host : { name: 'Someone from the team', avatar: null, kind: 'rep' },
    };
    if (!this.#announced) this.#announced = new Set(state.messages.map((m) => m.messageId));
    const offers = state.messages.filter((m) => cardOf(m)?.cardType === 'rep-followup-offer');
    const lastOffer = offers.at(-1)?.messageId;

    for (const m of state.messages) {
      const card = cardOf(m);
      if (card) {
        const t = card.cardType;
        if (t === 'session-start') {
          who = { ...who, standin: { ...who.standin, name: card.standinName || who.standin.name, kind: 'standin' } };
          continue;
        }
        if (t === 'handoff' || t === 'human-transfer') {
          who = { ...who, rep: { name: card.repName || 'Someone from the team', avatar: safeUrl(card.repAvatar), kind: 'rep' } };
          const text = `${card.repName || 'Someone from the team'} joined the conversation`;
          keys.push(m.messageId);
          build.set(m.messageId, () => note(card.message ? `${text}: ${card.message}` : text));
        } else if (t === 'standin-takeover') {
          who = { ...who, standin: { name: card.standinName || who.standin.name, avatar: safeUrl(card.standinAvatar) || who.standin.avatar, kind: 'standin' } };
          keys.push(m.messageId);
          build.set(m.messageId, () => note(`${card.standinName || 'An AI Stand-in'} (AI) is answering now`));
        } else if (t === 'session-end') {
          keys.push(m.messageId);
          build.set(m.messageId, () => note('The conversation ended'));
        } else if (t === 'rep-followup-offer') {
          const live = m.messageId === lastOffer && state.followupOffered && state.phase === 'active';
          const key = `${m.messageId}:${live ? 'live' : 'past'}`;
          keys.push(key);
          build.set(key, () => this.#offerCard(card, live));
        } else if (t === 'rep-followup-confirmation') {
          keys.push(m.messageId);
          build.set(m.messageId, () => note(card.message || 'Thanks. The team will follow up by email.'));
        }
        continue; // session-start, link-clicked, followup-requested and unknown cards stay hidden.
      }
      if (!isConversation(m)) continue;
      if (m.senderType === 'visitor') {
        keys.push(m.messageId);
        build.set(m.messageId, () => this.#visitorMessage(m.body));
      } else {
        const id = m.senderType === 'rep' ? who.rep : who.standin;
        keys.push(m.messageId);
        build.set(m.messageId, () => this.#reply(m, id));
        if (!this.#announced.has(m.messageId)) {
          this.#announced.add(m.messageId);
          if (m.type === 'link-card') this.#announce(`${id.name} shared a link: ${parseCard(m.body).title || ''}`);
          else this.#announce(`${id.name} replied: ${plainText(m.body).slice(0, 600)}`);
          this.#unread();
        }
      }
    }

    if (state.pending) {
      const p = state.pending;
      const status = p.creating ? 'creating' : state.busy ? 'sending' : 'failed';
      const key = `pending:${p.clientMessageId || 'new'}:${status}`;
      keys.push(key);
      build.set(key, () => this.#visitorMessage(p.body, status));
    }

    if (state.activity && state.phase === 'active') {
      const a = state.activity;
      const id = this.#identity(state);
      const key = `activity:${a.kind}:${a.preview ? 'preview' : 'none'}`;
      keys.push(key);
      build.set(key, () => this.#activityRow(a, id));
      if (a.preview) queueMicrotask(() => {
        const el = this.#nodes.get(key)?.querySelector('.msg-preview');
        if (el) el.textContent = a.preview;
      });
    }

    // Keep existing nodes (and anything run inside them), add new ones in order.
    const wanted = new Set(keys);
    for (const [key, node] of this.#nodes) {
      if (!wanted.has(key)) {
        node.remove();
        this.#nodes.delete(key);
      }
    }
    let cursor = null;
    for (const key of keys) {
      let node = this.#nodes.get(key);
      if (!node) {
        node = build.get(key)();
        this.#nodes.set(key, node);
      }
      const next = cursor ? cursor.nextSibling : this.list.firstChild;
      if (node !== next) this.list.insertBefore(node, next);
      cursor = node;
    }
  }

  #visitorMessage(body, status = '') {
    const { question, context } = parseMessage(body);
    const li = h('li', { class: 'msg msg-me' });
    if (context) {
      const user = USERS.find((u) => u.label === context.userLabel) ?? null;
      const chips = h('div', { class: 'msg-ctx' });
      chips.append(h('span', { class: 'ctx', title: `Ran as ${context.userLabel}` }, user ? avatar(user) : null, h('span', { text: `as ${context.userLabel}` })));
      const o = context.outcome;
      if (o?.kind === 'error') chips.append(h('span', { class: 'ctx ctx-error', title: o.message }, h('span', { text: `ERROR${o.code ? ` ${o.code}` : ''}` })));
      else if (o?.kind === 'rows') chips.append(h('span', { class: `ctx ${o.count ? '' : 'ctx-zero'}` }, h('span', { text: plural(o.count, 'row') })));
      else if (o?.kind === 'command') chips.append(h('span', { class: `ctx ${o.affected === 0 ? 'ctx-zero' : 'ctx-ok'}` }, h('span', { text: Number.isFinite(o.affected) ? `${o.command} ${o.affected}` : o.command })));
      else if (o?.kind === 'table') chips.append(h('span', { class: `ctx ${o.visible ? '' : 'ctx-zero'}` }, h('span', { text: `${o.visible} of ${o.total} visible` })));
      if (context.policy) chips.append(this.#refChip('policy', context.policy, 'ctx ctx-policy'));
      for (const t of tablesIn(context.sql ?? '', this.#knownTables()).slice(0, 2)) chips.append(this.#refChip('table', t, 'ctx'));
      if (context.changes) chips.append(h('span', { class: 'ctx ctx-zero', title: context.changes }, h('span', { text: 'sandbox changed' })));
      li.append(chips);
    }
    if (question) li.append(h('div', { class: 'msg-bubble', text: question }));
    if (context?.sql) {
      const first = context.sql.split('\n').find((l) => l.trim() && !l.trim().startsWith('--')) ?? context.sql.split('\n')[0];
      li.append(h('details', { class: 'msg-sql' },
        h('summary', {}, h('span', { text: first.trim() }), icon('chevron')),
        h('pre', {}, h('code', { sql: context.sql }))));
    }
    if (status === 'creating') li.append(h('p', { class: 'msg-status', text: 'Starting the conversation…' }));
    else if (status === 'sending') li.append(h('p', { class: 'msg-status', text: 'Sending…' }));
    else if (status === 'failed') {
      li.append(h('p', { class: 'msg-status is-failed' }, icon('x'), 'Not delivered.',
        h('button', { type: 'button', onclick: () => this.client.send() }, 'Retry')));
    }
    return li;
  }

  #fromLine(id) {
    return h('div', { class: 'msg-from' }, this.#whoAvatar(id), h('span', { text: id.name }), this.#badge(id.kind));
  }

  #reply(m, id) {
    const li = h('li', { class: 'msg msg-them' }, this.#fromLine(id));
    if (m.type === 'link-card') {
      const card = parseCard(m.body);
      const url = safeUrl(card.url);
      if (!url) return li;
      li.append(h('a', {
        class: 'link-card', href: url, target: '_blank', rel: 'noopener noreferrer',
        onclick: () => this.client.trackLinkClick(m.messageId, url),
      }, h('b', { text: typeof card.title === 'string' && card.title ? card.title : url }),
      typeof card.description === 'string' && card.description ? h('span', { text: card.description }) : null,
      h('small', { text: new URL(url).host })));
      return li;
    }
    li.append(this.#blocks(m.body.replace(/^\[as [^\]\n]*\]\s*/, ''), m.messageId));
    return li;
  }

  #blocks(text, messageId) {
    const box = h('div', { class: 'msg-text' });
    let n = 0;
    for (const b of parseReply(text)) {
      if (b.type === 'p') box.append(h('p', {}, this.#inline(b.inline)));
      else if (b.type === 'list') box.append(h(b.ordered ? 'ol' : 'ul', { start: b.ordered && b.start !== 1 ? String(b.start) : null }, b.items.map((item) => h('li', {}, this.#inline(item)))));
      else if (SQL_LANGS.has(b.lang) || (!b.lang && /^\s*(select|insert|update|delete|create|alter|drop|with|grant|revoke)\b/i.test(b.text))) {
        box.append(this.#sqlBlock(b.text, `${messageId}:${n++}`));
      } else box.append(h('pre', { class: 'plain-code', text: b.text }));
    }
    return box;
  }

  #inline(nodes) {
    return nodes.map((n) => {
      if (n.type === 'text') return n.text;
      if (n.type === 'bold') return h('strong', {}, this.#inline(n.children));
      if (n.type === 'code') return h('code', { text: n.text });
      if (n.type === 'link') {
        const url = safeUrl(n.href);
        return url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: n.text }) : n.text;
      }
      if (n.type === 'ref') {
        const ref = this.playground.resolve(n.raw);
        if (ref) return this.#refChip(ref.kind, ref.name, 'chip', n.raw);
        return h('span', { dataset: { ref: n.raw }, text: n.raw.replace(/^\s*(tables?|polic(y|ies))\s*:\s*/i, '') });
      }
      return '';
    });
  }

  #refChip(kind, name, cls = 'chip', raw = '') {
    return h('button', {
      class: `${cls} chip-${kind}`, type: 'button', dataset: raw ? { ref: raw } : {},
      title: kind === 'table' ? `Show the ${name} table` : `Show the policy “${name}”`,
      onclick: () => this.playground.goTo({ kind, name }),
    }, icon(kind === 'table' ? 'table' : 'shield'), h('span', { text: name }));
  }

  // References in replies that arrived before the schema was known resolve later.
  #refreshRefs() {
    for (const el of this.list.querySelectorAll('span[data-ref]')) {
      const ref = this.playground.resolve(el.dataset.ref);
      if (ref) el.replaceWith(this.#refChip(ref.kind, ref.name, 'chip', el.dataset.ref));
    }
  }

  #knownTables() {
    const live = this.playground.schema?.tables?.map((t) => t.name);
    return live?.length ? live : TABLES.map((t) => t.name);
  }

  // A SQL block from a reply: run it here, locally, only when the visitor clicks.
  #sqlBlock(sql, key) {
    const as = h('span', { class: 'sqlblock-as' });
    const result = h('div', { class: 'sqlblock-result' }); // Announced as one summary line instead.
    const runLabel = h('span', { text: 'Run in playground' });
    const run = h('button', { class: 'btn btn-primary btn-xs', type: 'button' }, icon('play', 'ic-fill'), runLabel);
    const copy = h('button', { class: 'icon-btn', type: 'button', title: 'Copy SQL', 'aria-label': 'Copy SQL' }, icon('copy'));
    const block = h('div', { class: 'sqlblock', dataset: { key } },
      h('div', { class: 'sqlblock-head' }, h('span', { text: 'SQL' }), as, copy),
      h('pre', {}, h('code', { sql })),
      h('div', { class: 'sqlblock-actions' },
        run,
        h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => { this.close({ restore: false }); this.playground.openInEditor(sql); } }, icon('edit'), 'Open in editor')),
      result);
    block.sql = sql;
    this.#labelRunAs(block);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(sql);
        copy.replaceChildren(icon('check'));
      } catch {
        getSelection().selectAllChildren(block.querySelector('pre'));
      }
      setTimeout(() => copy.replaceChildren(icon('copy')), 1500);
    });
    run.addEventListener('click', async () => {
      if (run.dataset.busy) {
        this.playground.stop();
        return;
      }
      run.dataset.busy = '1';
      runLabel.textContent = this.playground.db.ready ? 'Running…' : 'Starting Postgres…';
      result.replaceChildren(h('div', { class: 'res-running' }, h('span', { class: 'hexdots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { class: 'shimmer', text: this.playground.db.ready ? 'Running in your browser…' : 'Starting Postgres in your browser…' })));
      const stopTimer = setTimeout(() => {
        runLabel.textContent = 'Stop';
        run.querySelector('use').setAttribute('href', '#i-stop');
      }, 1500);
      const r = await this.playground.runInline(sql);
      clearTimeout(stopTimer);
      delete run.dataset.busy;
      run.querySelector('use').setAttribute('href', '#i-play');
      runLabel.textContent = 'Run again';
      this.#runs[key] = { ...r, rows: (r.rows ?? []).slice(0, 20) };
      store.set(RUNS, this.#runs);
      this.#showRun(result, r);
      this.#announce(runSummary(r));
    });
    if (this.#runs[key]) {
      runLabel.textContent = 'Run again';
      this.#showRun(result, this.#runs[key]);
    }
    return block;
  }

  #labelRunAs(block) {
    const user = this.playground.runAsFor(block.sql);
    const as = block.querySelector('.sqlblock-as');
    as.replaceChildren('runs as', avatar(user), h('span', { text: user.label }));
    as.title = user.id === 'service_role' && user.id !== this.playground.user.id
      ? 'Schema changes run as service_role, which may change the schema.'
      : `Runs as ${user.label}, the user picked in “Run as”.`;
  }

  #updateRunAs() {
    for (const block of this.list.querySelectorAll('.sqlblock')) this.#labelRunAs(block);
  }

  #showRun(host, r) {
    host.textContent = '';
    const user = userById(r.user);
    if (r.stopped) {
      host.append(h('div', { class: 'res-ok is-zero' }, icon('stop'), h('span', { text: `Stopped after ${ms(r.ms)}. Postgres restarted and replayed your earlier changes.` })));
      return;
    }
    if (!r.ok) {
      host.append(this.playground.errorBox(r, {
        compact: true,
        onAsk: () => this.ask({ question: 'Why did this fail?', context: this.playground.contextFor(r), send: true, source: 'answer-error' }),
      }));
      return;
    }
    const meta = [`as ${user.label}`, Number.isFinite(r.ms) ? ms(r.ms) : ''].filter(Boolean).join(' · ');
    if (r.fields?.length) {
      host.append(h('div', { class: 'mini-grid' }, gridTable(r, { limit: 20 })));
      host.append(h('div', { class: 'mini-foot' }, h('span', { text: `${plural(r.rowCount, 'row')} · ${meta}` }),
        r.rowCount > 6 ? h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => { this.close({ restore: false }); this.playground.openInEditor(r.sql); } }, 'Open in editor') : null));
      return;
    }
    const noop = /^(UPDATE|DELETE)$/.test(r.command) && r.affected === 0;
    const what = /^(INSERT|UPDATE|DELETE|MERGE)$/.test(r.command) ? `${r.command} ${r.affected}` : r.command || 'Done';
    host.append(h('div', { class: `res-ok${noop ? ' is-zero' : ''}` }, icon(noop ? 'x' : 'check'), h('span', { text: `${what} · ${meta}` })));
  }

  #offerCard(card, live) {
    const li = h('li', { class: 'msg' });
    const box = h('div', { class: 'followup' }, h('p', { text: card.message || `${card.repName || 'The team'} can follow up by email.` }));
    if (live) {
      const email = h('input', { class: 'field', type: 'email', required: true, autocomplete: 'email', placeholder: 'you@company.com', 'aria-label': 'Your email' });
      const send = h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Send');
      const form = h('form', { class: 'followup-row' }, email, send);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!email.value.trim()) return;
        send.disabled = true;
        await this.client.submitEmail(email.value);
        send.disabled = false;
      });
      box.append(form);
    }
    li.append(box);
    return li;
  }

  #activityRow(a, id) {
    const li = h('li', { class: 'msg msg-them', 'aria-hidden': 'true' }, this.#fromLine(id));
    if (a.kind === 'thinking' && a.preview) li.append(h('div', { class: 'msg-text' }, h('p', { class: 'msg-preview' })));
    else {
      li.append(h('div', { class: 'thinking' }, h('span', { class: 'hexdots' }, h('i'), h('i'), h('i')),
        h('span', { class: 'shimmer', text: a.kind === 'typing' ? `${id.name} is typing…` : 'Thinking…' })));
    }
    return li;
  }

  #renderFoot(state) {
    // Banner: what's wrong, or what's next.
    const banner = this.banner;
    banner.textContent = '';
    banner.className = 'ask-banner';
    let text = '';
    const actions = [];
    const emptyExplains = !state.messages.some(isVisible) && !state.pending;
    if (state.phase === 'loading' && this.#queued) {
      text = 'Connecting… your question goes out as soon as someone can answer.';
    } else if (state.phase === 'unavailable') {
      // The empty panel already says nobody's around; the banner is for what went wrong.
      if (state.error === 'start' || state.error === 'connect' || !emptyExplains) {
        text = state.error === 'start' ? ERRORS.start : state.error === 'connect' ? ERRORS.connect : 'Nobody can answer right now.';
        banner.classList.add('is-warn');
        actions.push(['Try again', () => this.client.retry()]);
      }
    } else if (state.phase === 'uncertain') {
      text = ERRORS.uncertain;
      banner.classList.add('is-warn');
      actions.push(['Start a new conversation', () => this.#newChat()]);
    } else if (state.phase === 'ended') {
      text = state.error && ERRORS[state.error] ? ERRORS[state.error] : 'This conversation has ended.';
      actions.push(['Start a new conversation', () => this.#newChat()]);
    } else if (state.error && state.error !== 'send' && ERRORS[state.error]) {
      text = ERRORS[state.error];
      banner.classList.add(state.error === 'refresh' ? 'is-warn' : 'is-error');
      if (state.error === 'paused' || state.error === 'connect') actions.push(['Reconnect', () => this.client.retry()]);
      if (state.error === 'end') actions.push(['Try again', () => this.client.end()]);
    } else if (state.phase === 'active' && state.connection !== 'online') {
      text = 'Reconnecting to the conversation…';
    }
    banner.hidden = !text;
    if (text) {
      banner.append(h('span', { text }));
      if (actions.length) {
        banner.append(h('div', { class: 'ask-banner-actions' }, actions.map(([label, run], i) => h('button', {
          class: `btn ${i ? 'btn-secondary' : 'btn-primary'} btn-xs`, type: 'button', disabled: state.busy, onclick: run,
        }, label))));
      }
    }

    this.notice.hidden = !state.notice;
    this.notice.textContent = state.notice;
    this.#renderAttach();
    this.#renderComposer(state);
    this.#renderMeta(state);
  }

  #renderAttach() {
    const c = this.attached;
    const box = this.attachBox;
    const phase = this.client.getSnapshot().phase;
    box.textContent = '';
    box.hidden = !c || phase === 'ended' || phase === 'uncertain';
    if (box.hidden) return;
    const user = USERS.find((u) => u.id === c.user);
    const chips = h('span', { class: 'ask-attach-chips' }, h('span', { class: 'ctx' }, user ? avatar(user) : null, h('span', { text: `as ${c.userLabel}` })));
    const o = c.outcome;
    if (o?.kind === 'error') chips.append(h('span', { class: 'ctx ctx-error', title: o.message }, h('span', { text: `ERROR${o.code ? ` ${o.code}` : ''}` })));
    else if (o?.kind === 'rows') chips.append(h('span', { class: `ctx ${o.count ? '' : 'ctx-zero'}` }, h('span', { text: plural(o.count, 'row') })));
    else if (o?.kind === 'command') chips.append(h('span', { class: `ctx ${o.affected === 0 ? 'ctx-zero' : 'ctx-ok'}` }, h('span', { text: Number.isFinite(o.affected) ? `${o.command} ${o.affected}` : o.command })));
    else if (o?.kind === 'table') chips.append(h('span', { class: 'ctx ctx-zero' }, h('span', { text: `${o.visible} of ${o.total} visible` })));
    if (c.policy) chips.append(h('span', { class: 'ctx ctx-policy' }, icon('shield'), h('span', { text: c.policy })));
    const tables = tablesIn(c.sql ?? '', this.#knownTables());
    for (const t of tables.slice(0, 2)) chips.append(h('span', { class: 'ctx' }, icon('table'), h('span', { text: t })));
    if (tables.length && !c.policy) {
      const count = (this.playground.schema?.policies ?? []).filter((p) => tables.includes(p.table)).length;
      chips.append(h('span', { class: 'ctx', title: `Policies on ${tables.join(', ')}` }, icon('shield'), h('span', { text: plural(count, 'policy', 'policies') })));
    }
    if (c.sql) {
      const lines = c.sql.trim().split('\n').length;
      chips.append(h('span', { class: 'ctx', title: c.sql }, icon('terminal'), h('span', { text: `SQL · ${plural(lines, 'line')}` })));
    }
    box.append(h('div', { class: 'ask-attach-row' },
      h('span', { class: 'ask-attach-label', text: c.policy ? 'Attached from Policies' : 'Attached from the editor' }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Don’t attach this', 'aria-label': 'Remove the attached context', onclick: () => this.attach(null) }, icon('x'))));
    box.append(chips);
  }

  #renderComposer(state) {
    const open = state.phase === 'available' || state.phase === 'active';
    const blocked = state.busy || Boolean(state.pending);
    this.input.disabled = !open && state.phase !== 'loading' && state.phase !== 'unavailable';
    this.input.placeholder = state.phase === 'loading' ? 'Connecting…'
      : state.phase === 'unavailable' ? 'Write your question; send it when someone’s around'
      : this.placeholder || (this.attached ? 'Ask about this query…' : 'Ask the Basalt team…');
    this.sendBtn.disabled = !open || blocked || !this.input.value.trim();
    this.form.hidden = state.phase === 'ended' || state.phase === 'uncertain';
  }

  #renderMeta(state) {
    const meta = this.meta;
    meta.textContent = '';
    const kind = state.host.kind;
    meta.append(h('span', { text: kind === 'rep' ? 'Real conversation · a person from the team, via Stand' : kind === 'standin' ? 'Real conversation · AI Stand-in via Stand' : 'Real conversation via Stand' }));
    meta.append(h('span', { class: 'ask-meta-grow' }));
    const powered = safeUrl(state.poweredByUrl);
    if (powered) meta.append(h('a', { href: powered, target: '_blank', rel: 'noopener noreferrer', onclick: () => this.client.trackAttributionClick() }, 'Powered by Stand'));
    this.endBtn.hidden = state.phase !== 'active';
    this.endBtn.disabled = state.busy;
  }

  #renderLauncher(state) {
    if (!this.launcher) return;
    const id = this.#identity(state);
    this.launcherWho.textContent = this.unread ? `New reply from ${id.name}`
      : state.phase === 'unavailable' ? 'Nobody can answer right now'
      : state.phase === 'loading' ? 'Checking who can answer…'
      : `${id.name}${id.kind === 'standin' ? ' · AI Stand-in' : id.kind === 'rep' ? ' · Team member' : ''}`;
    this.launcherDot.hidden = !this.unread;
  }

  // Actions -------------------------------------------------------------------------

  /** From the playground's buttons: attach the context, then send or let the visitor write. */
  ask({ question = '', context = null, send = false, source = 'playground', placeholder = '' } = {}) {
    if (context) this.attach(context);
    this.open();
    if (send && question) {
      this.#submit(question, source, { withContext: true });
      return;
    }
    this.placeholder = placeholder;
    if (question) {
      this.input.value = question;
      this.#setDraft(question);
    }
    this.#renderComposer(this.client.getSnapshot());
    this.#grow();
    this.input.focus({ preventScroll: this.mq.matches });
    if (question) this.input.select();
    this.root.scrollIntoView?.({ block: 'nearest' });
  }

  attach(context) {
    this.attached = context;
    this.placeholder = '';
    const state = this.client.getSnapshot();
    this.#renderAttach();
    this.#renderEmpty(state);
    this.#renderComposer(state);
    this.dispatchEvent(new Event('change'));
  }

  /** The message the composer would send now: for the explainer's live preview. */
  preview() {
    return composeMessage(this.input.value.trim() || 'Your question goes here.', this.attached);
  }

  async #submit(text, source, { withContext = true } = {}) {
    const question = String(text ?? '').trim();
    if (!question) return;
    const state = this.client.getSnapshot();
    const context = withContext ? this.attached : null;
    if (!['available', 'active'].includes(state.phase)) {
      // Nothing is lost: the question waits in the box, with its context attached,
      // and goes out on its own only if Stand is still checking who can answer.
      if (state.phase === 'loading') this.#queued = { question, source, withContext };
      this.input.value = question;
      this.#setDraft(question); // Also re-renders, with the queued note.
      this.#grow();
      if (state.phase === 'unavailable') this.client.retry();
      this.#renderComposer(state);
      this.banner.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: reducedMotion() ? 0 : 240 });
      return;
    }
    if (state.busy) return;
    if (state.pending) {
      // An undelivered message goes first: keep this question in the box for after its retry.
      this.input.value = question;
      this.#setDraft(question);
      this.#grow();
      this.#renderComposer(state);
      this.list.querySelector('.msg-status.is-failed')?.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: reducedMotion() ? 0 : 240 });
      return;
    }
    const body = composeMessage(question, context);
    this.input.value = '';
    this.#setDraft('');
    this.#grow();
    this.placeholder = '';
    if (context) this.attached = null;
    this.#pinned = true;
    this.#renderAttach();
    this.dispatchEvent(new Event('change'));
    const ok = await this.client.send(body, { prompt: PROMPT, analyticsId: `playground-${source}` });
    if (ok && this.client.getSnapshot().draft) this.#setDraft('');
  }

  async #end() {
    await this.client.end();
  }

  async #newChat() {
    this.#runs = {};
    store.remove(RUNS);
    await this.client.newChat();
    this.input.focus({ preventScroll: true });
  }

  #setDraft(text) {
    this.#draftEcho = text;
    this.client.setDraft(text);
  }

  // The client gives unsent text back as a draft after a failed start or a new chat.
  // A composed message carries its context: split it back into the box and the attachment.
  #syncDraft(state) {
    if (state.draft === this.#draftEcho) return;
    this.#draftEcho = state.draft;
    const { question, context } = parseMessage(state.draft);
    if (context) {
      const user = USERS.find((u) => u.label === context.userLabel);
      this.attached = { ...context, user: user?.id ?? 'anon' };
      this.#draftEcho = question;
      queueMicrotask(() => this.client.setDraft(question));
    }
    if (document.activeElement !== this.input || !this.input.value) this.input.value = context ? question : state.draft;
    this.#grow();
    this.dispatchEvent(new Event('change'));
  }

  #grow() {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 140)}px`;
  }

  #scrollToEnd() {
    this.body.scrollTop = this.body.scrollHeight;
  }

  #announce(text) {
    if (!this.announcer || !text) return;
    this.announcer.textContent = '';
    setTimeout(() => (this.announcer.textContent = text), 60);
  }

  #unread() {
    if (this.mq.matches && !this.root.classList.contains('is-open')) {
      this.unread = true;
      this.#renderLauncher(this.client.getSnapshot());
    }
  }

  // The bottom sheet on phones ---------------------------------------------------

  #layout() {
    const phone = this.mq.matches;
    if (this.launcher) this.launcher.hidden = !phone;
    if (!phone) this.close({ restore: false, force: true });
    else if (!this.root.classList.contains('is-open')) this.root.setAttribute('aria-hidden', 'true');
    if (!phone) this.root.removeAttribute('aria-hidden');
  }

  open() {
    if (!this.mq.matches || this.root.classList.contains('is-open')) return;
    this.#returnFocus = document.activeElement;
    this.root.classList.add('is-open');
    this.backdrop.classList.add('is-open');
    this.root.removeAttribute('aria-hidden');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'ask-title');
    this.launcher?.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';
    this.unread = false;
    this.#renderLauncher(this.client.getSnapshot());
    this.#scrollToEnd();
    setTimeout(() => (this.input.disabled ? this.closeBtn : this.input).focus({ preventScroll: true }), reducedMotion() ? 0 : 320);
  }

  close({ restore = true, force = false } = {}) {
    if (!force && !this.root.classList.contains('is-open')) return;
    const wasOpen = this.root.classList.contains('is-open');
    this.root.classList.remove('is-open');
    this.backdrop.classList.remove('is-open');
    this.root.removeAttribute('role');
    this.root.removeAttribute('aria-modal');
    this.root.removeAttribute('aria-labelledby');
    if (this.mq.matches) this.root.setAttribute('aria-hidden', 'true');
    this.launcher?.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
    if (wasOpen && restore) (this.#returnFocus?.isConnected ? this.#returnFocus : this.launcher)?.focus({ preventScroll: true });
  }

  #sheetKeys(e) {
    if (!this.root.classList.contains('is-open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Tab') {
      const items = focusables(this.root);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}

// Helpers -----------------------------------------------------------------------

function cardOf(m) {
  if (m.type !== 'system-card' && m.senderType !== 'system-card') return null;
  return parseCard(m.body);
}

function isVisible(m) {
  if (isConversation(m)) return true;
  const card = cardOf(m);
  return Boolean(card && ['handoff', 'human-transfer', 'standin-takeover', 'session-end', 'rep-followup-offer', 'rep-followup-confirmation'].includes(card.cardType));
}

function note(text) {
  return h('li', { class: 'card-note' }, h('span', { text }));
}

function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

function runSummary(r) {
  if (r.stopped) return 'Stopped.';
  if (!r.ok) return `The answer’s SQL failed: ${r.error?.message ?? ''}`;
  if (r.fields?.length) return `The answer’s SQL returned ${plural(r.rowCount, 'row')}.`;
  return `The answer’s SQL ran: ${r.command}.`;
}
