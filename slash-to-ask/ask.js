// The ask block: a question inside the document, with each answer as a callout
// right under it. It draws a view model that app.js works out from Stand's state
// and reports what the visitor does through actions. It never talks to Stand.

import { avatarHtml, escapeHtml, safeUrl } from './util.js';

const NAME_FALLBACK = 'The team';

/** A new, empty ask block element. app.js fills it with renderAsk(). */
export function createAskElement(id) {
  const el = document.createElement('div');
  el.className = 'blk';
  el.dataset.block = 'ask';
  el.id = id;
  el.innerHTML = `
    <div class="ask" role="group" aria-labelledby="${id}-label">
      <div class="ask-head">
        <svg class="ask-ico" aria-hidden="true"><use href="#ui-ask"/></svg>
        <span class="ask-label" id="${id}-label">Ask the team</span>
        <span class="ask-where"></span>
        <span class="kn-grow"></span>
        <button class="ask-hbtn" type="button" data-act="more" aria-label="Question options" aria-haspopup="menu"><svg aria-hidden="true"><use href="#ui-dots"/></svg></button>
      </div>
      <button class="ask-fold" type="button" aria-expanded="false" hidden>
        <span class="tgl-ico" aria-hidden="true"><svg><use href="#ui-tri"/></svg></span>
        <svg class="ok" aria-hidden="true"><use href="#ui-resolve"/></svg>
        <span class="q"></span><span class="meta"></span>
      </button>
      <div class="ask-body">
        <p class="ask-quote" hidden></p>
        <div class="ask-thread"></div>
        <div class="ask-offer" hidden>
          <p></p>
          <form>
            <label class="sr-only" for="${id}-email">Your email</label>
            <input id="${id}-email" type="email" required autocomplete="email" placeholder="you@company.com" maxlength="320">
            <button class="btn" type="submit">Send</button>
          </form>
        </div>
        <div class="ask-activity" hidden><span class="shimmer"></span></div>
        <div class="ask-compose" hidden>
          <div class="ask-input" role="textbox" aria-multiline="true" tabindex="0"></div>
          <button class="ask-send" type="button" aria-label="Send"><svg aria-hidden="true"><use href="#ui-send"/></svg></button>
        </div>
        <p class="ask-note" hidden></p>
        <div class="ask-meta" hidden></div>
        <div class="ask-foot" hidden></div>
      </div>
    </div>`;
  const input = el.querySelector('.ask-input');
  try {
    input.contentEditable = 'plaintext-only';
  } catch {
    input.contentEditable = 'true'; // Older browsers: paste is still cleaned up below.
  }
  input.spellcheck = true;
  return el;
}

/**
 * Draws one ask block. view: see viewFor() in app.js. actions: { send, draft,
 * cancel, more, fold, act (reply, resolve, retry…), email, link, resolve (a [[reference]]) }.
 */
export function renderAsk(el, view, actions) {
  const box = el.querySelector('.ask');
  if (!el.dataset.wired) wire(el, actions);
  el._view = view;
  // Everything below reports back with this block's id.
  const act = (name) => actions.act(name, el.id);

  box.classList.toggle('is-resolved', view.resolved);
  box.classList.toggle('is-open', view.resolved && view.open);
  box.classList.toggle('is-archived', view.archived);
  el.querySelector('.ask-head').hidden = view.resolved;
  el.querySelector('.ask-where').innerHTML = view.heading ? `under <b>${escapeHtml(view.heading)}</b>` : '';

  const fold = el.querySelector('.ask-fold');
  fold.hidden = !view.resolved;
  fold.setAttribute('aria-expanded', String(view.open));
  fold.querySelector('.q').textContent = view.title || 'Question';
  fold.querySelector('.meta').textContent = view.foldMeta;
  el.querySelector('.ask-body').hidden = view.resolved && !view.open;

  const quote = el.querySelector('.ask-quote');
  quote.hidden = !view.quote;
  quote.textContent = view.quote ? `“${view.quote}”` : '';

  // The thread: rebuilt only when what it shows changes, so focus and selection survive.
  const thread = el.querySelector('.ask-thread');
  const signature = JSON.stringify([view.items, view.pending, view.ended]);
  if (thread.dataset.sig !== signature) {
    // Answers that weren't here before rise in; on the first draw (a reload) nothing moves.
    const first = !el._seen;
    el._seen ??= new Set();
    thread.dataset.sig = signature;
    thread.replaceChildren(...view.items.map((item) => {
      const node = renderItem(item, actions);
      if (item.messageId && !el._seen.has(item.messageId)) {
        el._seen.add(item.messageId);
        if (!first && item.kind !== 'q') node.classList.add('is-new');
      }
      return node;
    }), ...view.pending.map((item) => renderPending(item, act)));
    if (view.ended) thread.append(renderItem({ kind: 'card', cardType: 'session-end' }, actions));
  }

  const offer = el.querySelector('.ask-offer');
  offer.hidden = !view.offer;
  if (view.offer) {
    offer.querySelector('p').textContent = view.offer.text;
    offer.querySelector('button').disabled = view.offer.busy;
  }

  // "… is writing" while an answer is on its way, or the answer so far when Stand streams it.
  const activity = el.querySelector('.ask-activity');
  activity.hidden = !view.activity;
  if (view.activity) {
    activity.querySelector('.shimmer').textContent = view.activity.label;
    let preview = activity.querySelector('.ask-a');
    if (view.activity.preview) {
      if (!preview) {
        preview = renderItem({ kind: 'a', text: '', who: view.activity.who }, actions);
        preview.classList.add('is-preview');
        activity.prepend(preview);
      }
      preview.querySelector('.ask-a-text').replaceChildren(formatReply(view.activity.preview, actions.resolve));
    } else preview?.remove();
  }

  // The composer keeps its element (and the visitor's caret) across renders.
  const compose = el.querySelector('.ask-compose');
  const input = el.querySelector('.ask-input');
  const send = el.querySelector('.ask-send');
  compose.hidden = !view.composer;
  if (view.composer) {
    input.dataset.ph = view.composer.placeholder;
    input.setAttribute('aria-label', view.composer.label);
    if (document.activeElement !== input && input.textContent !== view.composer.draft) input.textContent = view.composer.draft;
    input.classList.toggle('is-empty', !input.textContent);
    send.disabled = !view.composer.canSend || !input.textContent.trim();
    send.setAttribute('aria-label', view.composer.reply ? 'Send reply' : 'Send question');
  }

  const note = el.querySelector('.ask-note');
  note.hidden = !view.note;
  note.classList.toggle('is-bad', Boolean(view.note?.bad));
  if (view.note) {
    note.textContent = `${view.note.text} `;
    if (view.note.action) note.append(actionButton(view.note.action, act));
  }

  const meta = el.querySelector('.ask-meta');
  const metaParts = view.meta ? metaNodes(view.meta, act) : [];
  meta.hidden = !metaParts.length;
  meta.replaceChildren(...metaParts);

  const foot = el.querySelector('.ask-foot');
  foot.hidden = !view.foot;
  if (view.foot) foot.replaceChildren(...footNodes(view.foot, act));
}

function wire(el, actions) {
  el.dataset.wired = '1';
  const id = el.id;
  const input = el.querySelector('.ask-input');
  const send = el.querySelector('.ask-send');
  const submit = () => {
    const text = input.textContent.trim();
    if (!text || !el._view?.composer?.canSend) return;
    actions.send(id, text);
  };
  input.addEventListener('input', () => {
    input.classList.toggle('is-empty', !input.textContent);
    if (!input.textContent && input.innerHTML) input.innerHTML = '';
    send.disabled = !el._view?.composer?.canSend || !input.textContent.trim();
    actions.draft(id, input.textContent);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      actions.cancel(id, !input.textContent.trim());
    }
  });
  input.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertParagraph') {
      e.preventDefault();
      submit();
    }
  });
  input.addEventListener('paste', (e) => {
    if (input.contentEditable === 'plaintext-only') return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  });
  send.addEventListener('click', submit);
  el.querySelector('[data-act="more"]').addEventListener('click', (e) => actions.more(id, e.currentTarget));
  el.querySelector('.ask-fold').addEventListener('click', () => actions.fold(id));
  el.querySelector('.ask-offer form').addEventListener('submit', (e) => {
    e.preventDefault();
    const field = e.currentTarget.querySelector('input');
    if (field.checkValidity()) actions.email(field.value.trim());
    else field.reportValidity();
  });
}

function renderItem(item, actions) {
  if (item.kind === 'q') {
    const q = document.createElement('div');
    q.className = `ask-q${item.reply ? ' is-reply' : ''}`;
    if (item.reply && item.quote) q.append(Object.assign(document.createElement('p'), { className: 'ask-quote', textContent: `“${item.quote}”` }));
    q.append(Object.assign(document.createElement('p'), { className: 'ask-q-text', textContent: item.text }));
    return q;
  }
  if (item.kind === 'a') {
    const a = document.createElement('div');
    a.className = 'ask-a';
    a.innerHTML = `${avatarHtml(item.who.name || NAME_FALLBACK, item.who.avatar)}
      <div class="ask-a-body"><p class="ask-a-who"><b></b>${chip(item.who.kind)}</p><div class="ask-a-text"></div></div>`;
    a.querySelector('b').textContent = item.who.name || NAME_FALLBACK;
    a.querySelector('.ask-a-text').append(formatReply(item.text, actions.resolve));
    return a;
  }
  if (item.kind === 'link') {
    const url = safeUrl(item.url);
    const link = document.createElement(url ? 'a' : 'div');
    link.className = 'bookmark';
    if (url) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', () => actions.link(item.messageId, url));
    }
    link.innerHTML = '<div class="bm-body"><div class="bm-title"></div><div class="bm-desc"></div><div class="bm-url"><svg aria-hidden="true"><use href="#ui-link"/></svg><span></span></div></div>';
    link.querySelector('.bm-title').textContent = item.title || (url ? new URL(url).hostname : 'Link');
    link.querySelector('.bm-desc').textContent = item.description;
    link.querySelector('.bm-desc').hidden = !item.description;
    link.querySelector('.bm-url span').textContent = url || 'This link isn’t a web address, so it stays closed.';
    return link;
  }
  // System cards: who joined, the end, follow-up by email.
  const p = document.createElement('p');
  p.className = 'ask-sys';
  const card = item.card ?? {};
  const name = (value) => `<b>${escapeHtml(value || NAME_FALLBACK)}</b>`;
  if (item.cardType === 'handoff' || item.cardType === 'human-transfer') {
    p.innerHTML = `${avatarHtml(card.repName || NAME_FALLBACK, card.repAvatar, 'kn-av-sm')}<span>${name(card.repName)} from the team joined. You're talking to a person now.</span>`;
  } else if (item.cardType === 'standin-takeover') {
    p.innerHTML = `${avatarHtml(card.standinName || NAME_FALLBACK, card.standinAvatar, 'kn-av-sm')}<span>${name(card.standinName)}, the AI Stand-in, is answering again.</span>`;
  } else if (item.cardType === 'session-end') {
    p.classList.add('is-end');
    p.textContent = 'Conversation ended';
  } else if (item.cardType === 'rep-followup-offer') {
    p.innerHTML = `<span>${name(card.repName)} offered to follow up by email.</span>`;
  } else if (item.cardType === 'rep-followup-confirmation') {
    p.innerHTML = '<svg class="ok" aria-hidden="true" width="16" height="16"><use href="#ui-resolve"/></svg><span>Thanks. The team will follow up by email.</span>';
  }
  return p;
}

function renderPending(item, act) {
  const q = document.createElement('div');
  q.className = `ask-q${item.reply ? ' is-reply' : ''}`;
  if (item.reply && item.quote) q.append(Object.assign(document.createElement('p'), { className: 'ask-quote', textContent: `“${item.quote}”` }));
  q.append(Object.assign(document.createElement('p'), { className: 'ask-q-text', textContent: item.text }));
  const status = document.createElement('p');
  status.className = 'ask-status';
  const labels = {
    sending: 'Sending…',
    failed: 'Not delivered.',
    uncertain: 'Not confirmed.',
    lost: 'Not confirmed before the conversation ended. Copy it if you need it.',
  };
  status.textContent = `${labels[item.status] ?? ''} `;
  status.classList.toggle('is-bad', item.status !== 'sending');
  if (item.status === 'failed') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => act('retrySend'));
    status.append(retry);
  }
  q.append(status);
  return q;
}

function chip(kind) {
  if (kind === 'rep') return '<span class="chip chip-person">Person</span>';
  if (kind === 'standin') return '<span class="chip chip-ai">AI</span>';
  return '';
}

function actionButton({ label, act: name }, act) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => act(name));
  return button;
}

function metaNodes(meta, act) {
  const nodes = [];
  if (meta.who) {
    const who = document.createElement('span');
    who.className = 'ask-who';
    who.innerHTML = `${avatarHtml(meta.who.name || NAME_FALLBACK, meta.who.avatar, 'kn-av-sm')}<span></span>${chip(meta.who.kind)}`;
    who.querySelector('span:not(.kn-av):not(.chip)').textContent = meta.who.line;
    nodes.push(who);
  }
  if (meta.hint) nodes.push(Object.assign(document.createElement('span'), { textContent: meta.hint }));
  if (meta.powered) nodes.push(poweredLink(meta.powered, act, 'Powered by Stand'));
  if (meta.notice) nodes.push(Object.assign(document.createElement('span'), { className: 'ask-notice', textContent: meta.notice }));
  return nodes;
}

function footNodes(foot, act) {
  const nodes = [];
  const button = (name, icon, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ask-fbtn';
    b.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"/></svg><span></span>`;
    b.querySelector('span').textContent = label;
    b.addEventListener('click', () => act(name));
    return b;
  };
  if (foot.reply) nodes.push(button('reply', 'ui-reply', 'Reply'));
  if (foot.resolve) nodes.push(button('resolve', 'ui-resolve', foot.resolveLabel || 'Resolve'));
  if (foot.newChat) nodes.push(button('newChat', 'ui-plus', 'Start a new conversation'));
  const real = document.createElement('span');
  real.className = 'ask-real';
  real.textContent = `${foot.real} `;
  if (foot.powered) real.append(poweredLink(foot.powered, act, 'Stand'));
  else real.append('Stand');
  nodes.push(real);
  return nodes;
}

function poweredLink(url, act, text) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  a.addEventListener('click', () => act('attribution'));
  return a;
}

// ---------- Reply text ----------

const TOKEN = /\[\[([^\]\n]{1,80})\]\]|\*\*([^*\n]+)\*\*|`([^`\n]+)`|(https?:\/\/[^\s<>"'`]+)/g;

/**
 * Turns reply text into DOM without ever parsing it as HTML: paragraphs, "- "
 * lists, **bold**, `code`, web links, and [[Kind: Name]] page references, which
 * `resolve` maps to a block (or null, and the name stays plain text).
 */
export function formatReply(text, resolve = () => null) {
  const out = document.createDocumentFragment();
  for (const para of String(text).trim().split(/\n\s*\n/)) {
    const lines = para.split('\n');
    if (lines.every((line) => /^\s*[-•*]\s+/.test(line))) {
      const ul = document.createElement('ul');
      for (const line of lines) {
        const li = document.createElement('li');
        inline(li, line.replace(/^\s*[-•*]\s+/, ''), resolve);
        ul.append(li);
      }
      out.append(ul);
    } else {
      const p = document.createElement('p');
      lines.forEach((line, i) => {
        if (i) p.append(document.createElement('br'));
        inline(p, line, resolve);
      });
      out.append(p);
    }
  }
  return out;
}

function inline(parent, line, resolve) {
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    parent.append(line.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      const target = resolve(m[1]);
      if (target) {
        const a = document.createElement('a');
        a.className = 'mention';
        a.href = `#${target.id}`;
        a.dataset.ref = target.id;
        a.innerHTML = '<svg aria-hidden="true"><use href="#ui-arrow"/></svg><span></span>';
        a.querySelector('span').textContent = target.label;
        a.setAttribute('aria-label', `Go to ${target.label}`);
        parent.append(a);
      } else {
        parent.append(m[1].replace(/^(heading|toggle|database|section|page)\s*:\s*/i, ''));
      }
    } else if (m[2]) {
      parent.append(Object.assign(document.createElement('b'), { textContent: m[2] }));
    } else if (m[3]) {
      parent.append(Object.assign(document.createElement('code'), { textContent: m[3] }));
    } else if (m[4]) {
      const trimmed = m[4].replace(/[.,;:!?)\]]+$/, '');
      const url = safeUrl(trimmed);
      if (url) {
        const a = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener noreferrer', textContent: trimmed });
        parent.append(a);
      } else parent.append(trimmed);
      parent.append(m[4].slice(trimmed.length));
    }
  }
  parent.append(line.slice(last));
}

/** Plain text of a reply, for screen reader announcements. */
export function replyText(text, resolve = () => null) {
  return formatReply(text, resolve).textContent.replace(/\s+/g, ' ').trim();
}
