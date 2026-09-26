// "Doesn't fit? Ask us": the conversation, rendered inside the wizard.
//
// Every step gets a field at its foot. A question goes to Stand with its step
// and the answers so far (advisor.js), and the reply appears in that step as a
// helper note. The Store advisor panel shows the whole conversation, with a
// step badge on every question. One Stand conversation carries it all.
//
// render(state) draws everything from the client's state, so a test can drive
// it with a made-up state as well as a live one.

import { icon } from './art.js';
import { REFERENCE_PATTERN, buildConversation, buildPrompt, composeQuestion, findReference, parseQuestion, stripPrefix } from './advisor.js';
import { parseCard } from './stand-visitor.js';
import { STEPS } from './steps.js';

const DRAFTS_KEY = 'ask-at-any-step:v1:drafts';
const UI_KEY = 'ask-at-any-step:v1:ui';
const WIDE = '(min-width: 900px)';

// Short enough for a phone: an example of what people ask on each step.
const PLACEHOLDERS = [
  'Patterns and fabric in one shop?',
  'Two fairs a year: need a reader?',
  'Do I need VAT in Germany?',
  'We’re four people. Which plan?',
  'Can I keep my own domain?',
  'Can I switch plans later?',
];

// Short, human versions of the client's error codes.
const ERRORS = {
  connect: 'We couldn’t reach the advisor. Check your connection and try again.',
  start: 'Your question didn’t go through, so nothing started. It’s back in the field.',
  send: 'Your last question wasn’t delivered.',
  lost: 'Your last question wasn’t confirmed before the conversation ended.',
  gone: 'This conversation isn’t available anymore.',
  paused: 'The connection paused. Retry to check for answers.',
  refresh: 'Reconnecting to check for new answers…',
  end: 'We couldn’t end the conversation. Try again.',
  email: 'We couldn’t send your email. Check it and try again.',
  offer: 'That follow-up offer has expired.',
};

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const safeUrl = (value) => {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
};

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value; // Only ever our own icon markup.
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export class Advisor {
  #client;
  #wizard;
  #dialog;
  #announcer;
  #state;
  #model;
  #slots = new Map(); // step -> { root, thread, notice, form, input, send, meta }
  #drafts = {};
  #ui = { exampleHidden: false };
  #seenReplies = null; // reply ids already on screen, to announce only new ones
  #unseen = 0;
  #toastTimer = 0;
  #rendered = false; // After the first render, new exchanges animate in.
  #email = ''; // The follow-up form's text, kept across re-renders.

  constructor({ client, wizard, dialog, announcer }) {
    this.#client = client;
    this.#wizard = wizard;
    this.#dialog = dialog;
    this.#announcer = announcer;
    this.#restore();
    for (const step of STEPS) this.#buildSlot(step.n);
    this.#buildDialog();
    this.#wireOpeners();
    wizard.addEventListener('step', () => this.#onStep());
    wizard.addEventListener('change', () => this.#updateComposerLabel());
  }

  // Rendering ----------------------------------------------------------------

  render(state) {
    this.#state = state;
    const model = (this.#model = buildConversation(state));
    this.#takeDraftBack(state);

    const byStep = new Map(STEPS.map((s) => [s.n, []]));
    for (const exchange of model.exchanges) byStep.get(exchange.step || 1)?.push(exchange);

    for (const [n, slot] of this.#slots) {
      this.#renderThread(slot.thread, byStep.get(n), { inStep: true });
      if (n === 1) this.#renderExample(slot);
      this.#renderNotice(slot.notice, n, `step-${n}`);
      this.#renderForm(slot, n);
    }
    this.#renderDialog();
    this.#rendered = true;

    const counts = new Map([...byStep].map(([n, list]) => [n, list.filter((e) => e.text).length]));
    this.#wizard.markSteps(counts);
    const asked = model.exchanges.filter((e) => e.text).length;
    for (const badge of document.querySelectorAll('[data-advisor-count]')) {
      badge.hidden = asked === 0;
      badge.textContent = String(asked);
      badge.classList.toggle('is-new', this.#unseen > 0);
    }
    this.#announceNew(model);
  }

  #renderThread(container, exchanges, { inStep }) {
    const model = this.#model;
    const state = this.#state;
    const items = exchanges.map((exchange) => ({ key: exchange.id, kind: 'qa', exchange }));
    if (!inStep) items.unshift(...model.events.map((event) => ({ key: event.id, kind: 'event', event })));
    keyed(container, items, (item) => {
      if (item.kind === 'event') return [item.key, JSON.stringify(item.event.card)];
      const e = item.exchange;
      const latest = e === model.latest;
      const activity = latest && state.phase === 'active' ? state.activity : null;
      const failed = e.pending && !state.busy && ['send', 'lost'].includes(state.error);
      return [item.key, [e.items.map((i) => i.id).join(), e.pending, failed, state.busy, state.phase, activity?.kind, activity?.preview, state.host.name, state.host.avatar].join('|')];
    }, (item) => (item.kind === 'event' ? this.#eventElement(item.event) : this.#exchangeElement(item.exchange, { inStep })), this.#rendered);
  }

  #exchangeElement(e, { inStep }) {
    const state = this.#state;
    const latest = e === this.#model.latest;
    const failed = e.pending && !state.busy && ['send', 'lost'].includes(state.error);
    const sending = e.pending && !failed;

    // The answers the prefix carried, as chips: folded in the step, open in the advisor.
    const context = e.fields.length
      ? h('details', { class: 'qa-context', open: !inStep },
        h('summary', {}, `sent with ${e.fields.length} answer${e.fields.length > 1 ? 's' : ''}`),
        h('ul', {}, e.fields.map((field) => h('li', { text: field }))))
      : null;
    const status = sending
      ? h('span', { class: 'qa-status' }, h('span', { class: 'qa-spinner', 'aria-hidden': 'true' }), e.creating ? 'Starting the conversation…' : 'Sending…')
      : failed
        ? h('span', { class: 'qa-status is-failed' }, 'Not delivered',
          state.phase === 'active' ? h('button', { type: 'button', class: 'qa-retry', onclick: () => this.#client.send() }, 'Retry') : null)
        : null;
    const question = e.text
      ? h('div', { class: 'qa-q' },
        h('p', { class: 'qa-q-text', text: e.text }),
        h('div', { class: 'qa-q-meta' },
          inStep ? null : h('button', { type: 'button', class: 'qa-step', onclick: () => this.#goToStep(e.step) }, `Step ${e.step} · ${e.name || STEPS[e.step - 1]?.name || ''}`),
          context, status))
      : null;

    // Replies and cards in order. A run of replies from one responder shares a header.
    let previous = null;
    const replies = e.items.map((item) => {
      const header = item.kind === 'reply' && !(previous?.kind === 'reply' && previous.author === item.author);
      previous = item;
      return item.kind === 'event' ? this.#eventElement(item) : this.#replyElement(item, header);
    });
    const activity = latest && state.phase === 'active' ? state.activity : null;
    let pendingReply = null;
    if (activity && !e.pending) {
      const who = state.host.name || 'The advisor';
      pendingReply = activity.preview
        ? h('div', { class: 'qa-a is-preview' }, this.#who({ author: who, from: state.host.kind === 'rep' ? 'person' : 'ai' }), h('div', { class: 'qa-body' }, renderText(activity.preview, null)))
        : h('div', { class: 'qa-thinking' },
          h('span', { class: 'qa-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          activity.kind === 'typing' ? `${who} is typing…` : `${who} is reading your answers…`);
    }
    return h('article', { class: `qa${e.pending ? ' is-pending' : ''}${failed ? ' is-failed' : ''}` }, question, replies, pendingReply);
  }

  #replyElement(reply, header = true) {
    const who = header ? this.#who(reply) : null;
    const cls = `qa-a is-${reply.from}${header ? '' : ' is-continued'}`;
    if (reply.type === 'link-card') {
      const card = parseCard(reply.body);
      const url = safeUrl(card.url);
      if (!url) return null;
      return h('div', { class: cls }, who,
        h('a', {
          class: 'qa-link', href: url, target: '_blank', rel: 'noopener noreferrer',
          onclick: () => this.#client.trackLinkClick(reply.id, url),
        },
        h('b', { text: typeof card.title === 'string' && card.title ? card.title : new URL(url).hostname }),
        typeof card.description === 'string' && card.description ? h('span', { text: card.description }) : null,
        h('small', {}, h('span', { text: new URL(url).hostname }), h('span', { html: icon('external', { size: 12 }) }))));
    }
    return h('div', { class: cls }, who,
      h('div', { class: 'qa-body' }, renderText(stripPrefix(reply.body), (ref) => this.#follow(ref))));
  }

  #who({ author, from }) {
    const avatar = safeUrl(this.#state.host.avatar);
    const face = avatar && from === (this.#state.host.kind === 'rep' ? 'person' : 'ai')
      ? h('img', { class: 'qa-avatar', src: avatar, alt: '', width: 20, height: 20 })
      : h('span', { class: 'qa-avatar', 'aria-hidden': 'true', text: initials(author) });
    return h('p', { class: 'qa-who' }, face, h('b', { text: author }),
      from === 'ai' ? h('span', { class: 'chip-ai', title: 'An AI Stand-in answered' }, 'AI') : h('span', { class: 'chip-person' }, 'Team'));
  }

  #eventElement({ card }) {
    const name = typeof card.repName === 'string' && card.repName ? card.repName : 'Someone from the team';
    const ai = typeof card.standinName === 'string' && card.standinName ? card.standinName : 'An AI Stand-in';
    const extra = typeof card.message === 'string' && card.message.trim() ? ` ${card.message.trim()}` : '';
    const text = {
      handoff: `${name} from the team joined the conversation.${extra}`,
      'human-transfer': `The conversation moved to ${name} from the team.${extra}`,
      'standin-takeover': `${ai} (AI) is answering again.${extra}`,
      'session-end': 'The conversation ended.',
      'rep-followup-offer': `${name} can follow up by email.${extra}`,
      'rep-followup-confirmation': `Thanks. The team will be in touch by email.${extra}`,
    }[card.cardType];
    return h('p', { class: `qa-event is-${card.cardType}` }, h('span', { html: icon(card.cardType.startsWith('rep') || card.cardType === 'handoff' || card.cardType === 'human-transfer' ? 'user' : 'info', { size: 14 }) }), h('span', { text }));
  }

  #renderExample(slot) {
    // Only while someone could actually answer, and until the first real question.
    const show = !this.#model.started && !this.#ui.exampleHidden && ['loading', 'available'].includes(this.#state.phase);
    let example = slot.root.querySelector('.ask-example');
    if (!show) return example?.remove();
    if (example) return;
    // Clearly an illustration: labelled, no responder name, and gone once a real question exists.
    example = h('div', { class: 'qa ask-example', role: 'note', 'aria-label': 'Example of a question and an answer' },
      h('button', { type: 'button', class: 'ask-example-close', 'aria-label': 'Hide the example', html: icon('close', { size: 14 }), onclick: () => this.#hideExample() }),
      h('p', { class: 'qa-q-text' }, h('span', { class: 'ask-example-tag', text: 'Example' }), 'I pour candles and teach workshops. Do I pick both?'),
      h('div', { class: 'qa-a is-ai' },
        h('div', { class: 'qa-body' }, h('p', {},
          h('span', { class: 'ask-example-mark', 'aria-hidden': 'true', html: icon('sparkle', { size: 12 }) }),
          'Pick both: ', h('b', { text: 'Physical products' }), ' and ', h('b', { text: 'Services & bookings' }), '. One checkout sells both, and ',
          h('span', { class: 'ref-chip is-static', html: `${icon('apps', { size: 13 })}<span>Bookings</span>` }), ' keeps class dates.'))));
    slot.thread.before(example);
  }

  #hideExample() {
    this.#ui.exampleHidden = true;
    this.#saveUi();
    this.#slots.get(1).input.focus();
    this.render(this.#state);
  }

  /** Conversation-wide news and states, shown where the visitor is asking. */
  #renderNotice(container, n, id) {
    const state = this.#state;
    const model = this.#model;
    const parts = [];
    const button = (label, onclick, primary = false) => h('button', { type: 'button', class: `ad-btn ad-btn-small${primary ? ' ad-btn-primary' : ''}`, onclick }, label);

    if (state.phase === 'unavailable') {
      parts.push(h('p', { class: 'ask-notice-text' }, h('span', { html: icon('info', { size: 16 }) }),
        h('span', { text: state.error === 'connect' ? ERRORS.connect : state.error === 'start' ? ERRORS.start : 'Nobody can answer right now. The wizard works fine without us, and you can try again in a moment.' })),
      button('Try again', () => this.#client.retry()));
    } else if (state.phase === 'uncertain') {
      parts.push(h('p', { class: 'ask-notice-text is-attention' }, h('span', { html: icon('alert', { size: 16 }) }),
        h('span', { text: 'We couldn’t confirm that your first question reached us, and it may have started a conversation, so we won’t resend it on our own. Start a new one to ask again: your question will be waiting in the field.' })),
      button('Start a new conversation', () => this.#newChat(), true));
    } else if (state.phase === 'ended') {
      parts.push(h('p', { class: 'ask-notice-text' }, h('span', { html: icon('info', { size: 16 }) }),
        h('span', { text: state.error === 'gone' ? ERRORS.gone : state.error === 'lost' ? ERRORS.lost : 'This conversation has ended. Your answers in the wizard are still here.' })),
      button('Start a new conversation', () => this.#newChat(), true));
    } else if (state.phase === 'active') {
      if (state.followupOffered) parts.push(this.#followupForm(id));
      if (['paused', 'connect'].includes(state.error) && !state.pending) parts.push(h('p', { class: 'ask-notice-text' }, h('span', { html: icon('refresh', { size: 16 }) }), h('span', { text: state.error === 'paused' ? ERRORS.paused : ERRORS.connect })), button('Retry', () => this.#client.retry()));
      else if (['end', 'offer', 'refresh'].includes(state.error)) parts.push(h('p', { class: 'ask-notice-text' }, h('span', { html: icon('info', { size: 16 }) }), h('span', { text: ERRORS[state.error] })));
      if (state.pending && !state.busy && state.error === 'send' && model.latest?.step !== n) {
        parts.push(h('p', { class: 'ask-notice-text' }, h('span', { html: icon('alert', { size: 16 }) }), h('span', { text: `${ERRORS.send} It’s on Step ${model.latest.step}.` })), button('Retry it', () => this.#client.send()));
      } else if (model.waitingStep && model.waitingStep !== n) {
        const other = STEPS[model.waitingStep - 1];
        parts.push(h('p', { class: 'ask-notice-text is-waiting' }, h('span', { class: 'qa-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          h('span', { text: `Waiting for the answer on Step ${other.n} · ${other.name}. You can ask here once it’s in.` })),
        button(`Go to ${other.name}`, () => this.#goToStep(other.n)));
      }
    }
    const signature = parts.map((p) => p.textContent).join('|') + (state.busy ? '|busy' : '') + (state.error === 'email' ? '|email' : '');
    if (container.dataset.sig === signature) return;
    container.dataset.sig = signature;
    container.replaceChildren(...parts);
    container.hidden = parts.length === 0;
  }

  #followupForm(id) {
    const state = this.#state;
    const input = h('input', { id: `followup-${id}`, type: 'email', autocomplete: 'email', required: true, placeholder: 'you@yourshop.com', disabled: state.busy });
    input.value = this.#email;
    input.addEventListener('input', () => (this.#email = input.value));
    const form = h('form', { class: 'ask-followup' },
      h('label', { for: `followup-${id}`, text: 'Your email, for the reply' }),
      h('div', { class: 'ask-followup-row' }, input, h('button', { type: 'submit', class: 'ad-btn ad-btn-primary ad-btn-small', disabled: state.busy }, 'Send')),
      state.error === 'email' ? h('p', { class: 'ask-error', role: 'alert', text: ERRORS.email }) : null);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const email = input.value.trim();
      if (email) void this.#client.submitEmail(email);
    });
    return form;
  }

  /** Whether a question on step n can go out right now (typing is always fine). */
  #blocked(n) {
    const state = this.#state;
    if (!state) return true;
    const waiting = this.#model.waitingStep;
    return !['available', 'active'].includes(state.phase) || state.busy || Boolean(state.pending) || Boolean(waiting && waiting !== n);
  }

  #renderForm(slot, n) {
    const state = this.#state;
    const blocked = this.#blocked(n);
    // No field while nobody can answer, unless it holds text a failed start gave back.
    slot.form.hidden = ['uncertain', 'ended'].includes(state.phase) || (state.phase === 'unavailable' && !slot.input.value.trim());
    slot.form.classList.toggle('is-blocked', blocked);
    slot.send.disabled = blocked || !slot.input.value.trim();
    slot.input.placeholder = this.#placeholder(n);
    slot.input.setAttribute('aria-describedby', `ask-meta-${n}`);
    this.#renderMeta(slot.meta);
  }

  #renderMeta(meta) {
    const state = this.#state;
    const powered = safeUrl(state.poweredByUrl);
    const person = state.host.kind === 'rep';
    const parts = [
      h('span', { class: 'ask-meta-who' },
        h('span', { class: 'ask-meta-live', 'aria-hidden': 'true' }),
        state.phase === 'loading' ? 'Checking who can answer…' : person ? `Real conversation · ${state.host.name || 'the team'}` : 'Real conversation · AI Stand-in via Stand'),
      powered ? h('a', { href: powered, target: '_blank', rel: 'noopener noreferrer', class: 'ask-powered', onclick: () => this.#client.trackAttributionClick() }, 'Powered by Stand') : null,
      state.notice ? h('span', { class: 'ask-notice-line', text: state.notice }) : null,
    ];
    const signature = `${state.phase}|${person}|${state.host.name}|${powered}|${state.notice}`;
    if (meta.dataset.sig === signature) return;
    meta.dataset.sig = signature;
    meta.replaceChildren(...parts.filter(Boolean));
  }

  // The advisor panel ---------------------------------------------------------

  #buildDialog() {
    const dialog = this.#dialog;
    dialog.innerHTML = '';
    const close = h('button', { type: 'button', class: 'adv-close', 'aria-label': 'Close the advisor', html: icon('close', { size: 18 }), onclick: () => this.close() });
    this.#ui.body = h('div', { class: 'adv-body', 'data-adv-body': '' });
    this.#ui.empty = h('div', { class: 'adv-empty' },
      h('span', { class: 'adv-empty-icon', html: icon('chat', { size: 22 }) }),
      h('p', {}, h('b', { text: 'Ask at any step.' }), ' Questions and answers collect here, each with the step it was asked on and the answers you’d given.'));
    this.#ui.notice = h('div', { class: 'ask-notice adv-notice', hidden: true });
    this.#ui.who = h('p', { class: 'adv-who' });
    const input = h('textarea', { id: 'advisor-input', rows: 1, maxlength: 600, class: 'ask-input' });
    const send = h('button', { type: 'submit', class: 'ask-send', 'aria-label': 'Send your question', html: icon('send', { size: 18 }) });
    const label = h('label', { class: 'adv-form-label', for: 'advisor-input' });
    const form = h('form', { class: 'ask-form adv-form' }, label, h('div', { class: 'ask-field' }, input, send));
    this.#ui.end = h('button', { type: 'button', class: 'adv-end', onclick: () => this.#end() }, 'End conversation');
    this.#ui.powered = h('span', { class: 'adv-powered' });
    this.#ui.form = form;
    this.#ui.input = input;
    this.#ui.send = send;
    this.#ui.label = label;

    dialog.append(
      h('div', { class: 'adv-panel' },
        h('header', { class: 'adv-head' },
          h('div', { class: 'adv-title' }, h('h2', { id: 'advisor-title', tabindex: '-1', text: 'Store advisor' }), this.#ui.who),
          close),
        this.#ui.body,
        this.#ui.notice,
        form,
        h('footer', { class: 'adv-foot' }, this.#ui.powered, this.#ui.end)));
    this.#wireForm(form, input, send, () => this.#wizard.step);
    this.#updateComposerLabel();

    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dialog.matches(':modal')) {
        event.preventDefault();
        this.close();
      }
    });
    dialog.addEventListener('close', () => this.#afterClose());
    // A click on the backdrop of the phone sheet closes it.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && dialog.matches(':modal')) this.close();
    });
    matchMedia(WIDE).addEventListener('change', () => {
      if (dialog.open) this.close();
    });
  }

  #renderDialog() {
    const state = this.#state;
    const model = this.#model;
    this.#ui.empty.remove();
    this.#renderThread(this.#ui.body, model.exchanges, { inStep: false });
    if (model.exchanges.length === 0 && model.events.length === 0) this.#ui.body.replaceChildren(this.#ui.empty);
    this.#renderNotice(this.#ui.notice, this.#wizard.step, 'advisor');

    const person = state.host.kind === 'rep';
    const signature = `${state.phase}|${state.host.name}|${state.host.kind}|${state.host.avatar}`;
    if (this.#ui.who.dataset.sig !== signature) {
      this.#ui.who.dataset.sig = signature;
      const status = state.phase === 'loading' ? 'Checking who can answer…' : state.phase === 'unavailable' ? 'Nobody can answer right now' : '';
      this.#ui.who.replaceChildren(...(state.host.name && state.phase !== 'unavailable'
        ? this.#who({ author: state.host.name, from: person ? 'person' : 'ai' }).childNodes
        : [document.createTextNode(status)]));
    }
    const powered = safeUrl(state.poweredByUrl);
    this.#ui.powered.replaceChildren(powered
      ? h('a', { href: powered, target: '_blank', rel: 'noopener noreferrer', onclick: () => this.#client.trackAttributionClick() }, 'Powered by Stand')
      : document.createTextNode(''));
    this.#ui.end.hidden = state.phase !== 'active';
    this.#ui.end.disabled = state.busy;

    this.#ui.form.hidden = ['unavailable', 'uncertain', 'ended'].includes(state.phase);
    this.#ui.send.disabled = this.#blocked(this.#wizard.step) || !this.#ui.input.value.trim();
    this.#ui.input.placeholder = this.#placeholder(this.#wizard.step);
  }

  #updateComposerLabel() {
    const step = STEPS[this.#wizard.step - 1];
    if (!this.#ui.label) return;
    this.#ui.label.replaceChildren(h('span', { text: 'Ask about ' }), h('b', { text: `Step ${step.n} · ${step.name}` }));
    this.#ui.input.placeholder = this.#placeholder(step.n);
  }

  #placeholder(n) {
    if (this.#state?.phase === 'loading') return 'Checking who can answer…';
    const asked = this.#model?.exchanges.some((e) => (e.step || 1) === n && e.text);
    return asked ? `Ask a follow-up about ${STEPS[n - 1].name.toLowerCase()}…` : PLACEHOLDERS[n - 1];
  }

  open() {
    const dialog = this.#dialog;
    if (dialog.open) return;
    this.#opener = document.activeElement;
    if (matchMedia(WIDE).matches) {
      dialog.show();
      // The panel lives on the preview's stage: make sure all of it is on screen.
      const box = dialog.getBoundingClientRect();
      const overflow = box.bottom - innerHeight + 12;
      if (overflow > 0) scrollBy({ top: Math.min(overflow, box.top - 12), behavior: reducedMotion() ? 'auto' : 'smooth' });
    } else {
      dialog.showModal();
    }
    this.#unseen = 0;
    const toast = document.querySelector('[data-toast]');
    if (toast) toast.hidden = true; // The panel shows the new answer itself.
    for (const button of document.querySelectorAll('[data-advisor-open]')) button.setAttribute('aria-expanded', 'true');
    this.render(this.#state);
    this.#ui.body.scrollTop = this.#ui.body.scrollHeight; // The latest answer first.
    dialog.querySelector('#advisor-title').focus({ preventScroll: true });
  }

  close() {
    if (this.#dialog.open) this.#dialog.close();
  }

  #opener = null;
  #afterClose() {
    for (const button of document.querySelectorAll('[data-advisor-open]')) button.setAttribute('aria-expanded', 'false');
    const opener = this.#opener;
    this.#opener = null;
    if (opener?.isConnected && opener.offsetParent !== null) opener.focus({ preventScroll: true });
  }

  #wireOpeners() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-advisor-open]');
      if (!button) return;
      if (this.#dialog.open) this.close();
      else this.open();
    });
    // The desktop panel isn't modal: Esc closes it from anywhere on the page.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.#dialog.open && !this.#dialog.matches(':modal') && !event.defaultPrevented) this.close();
    });
  }

  // Asking -------------------------------------------------------------------

  #buildSlot(n) {
    const root = this.#wizard.askSlot(n);
    const input = h('textarea', { id: `ask-${n}`, rows: 1, maxlength: 600, class: 'ask-input', autocomplete: 'off' });
    input.value = this.#drafts[n] ?? '';
    const send = h('button', { type: 'submit', class: 'ask-send', 'aria-label': 'Send your question', html: icon('send', { size: 18 }) });
    const meta = h('p', { class: 'ask-meta', id: `ask-meta-${n}` });
    const form = h('form', { class: 'ask-form' },
      h('label', { class: 'ask-label', for: `ask-${n}` }, h('span', { html: icon('sparkle', { size: 16 }) }), h('span', { text: 'Doesn’t fit? Ask us' })),
      h('div', { class: 'ask-field' }, input, send),
      meta);
    const thread = h('div', { class: 'ask-thread' });
    const notice = h('div', { class: 'ask-notice', hidden: true });
    root.append(thread, notice, form);
    this.#slots.set(n, { root, thread, notice, form, input, send, meta });
    this.#wireForm(form, input, send, () => n);
    autosize(input);
  }

  #wireForm(form, input, send, stepOf) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#ask(stepOf(), input);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!send.disabled) form.requestSubmit();
      }
    });
    input.addEventListener('input', () => {
      autosize(input);
      if (input.id.startsWith('ask-')) {
        this.#drafts[stepOf()] = input.value;
        this.#saveDrafts();
      }
      if (this.#state?.phase === 'active') this.#client.typing(Boolean(input.value.trim()));
      send.disabled = this.#blocked(stepOf()) || !input.value.trim();
    });
  }

  async #ask(step, input) {
    const text = input.value.trim();
    const state = this.#client.getSnapshot();
    const model = buildConversation(state);
    if (!text || state.busy || state.pending || !['available', 'active'].includes(state.phase)) return;
    if (model.waitingStep && model.waitingStep !== step) return;
    const answers = this.#wizard.answers;
    const body = composeQuestion(step, answers, text);
    const first = state.phase === 'available';
    input.value = '';
    autosize(input);
    if (input.id === `ask-${step}`) {
      this.#drafts[step] = '';
      this.#saveDrafts();
    }
    // The first question creates the conversation, with the prompt; later ones just send.
    await this.#client.send(body, first ? { prompt: buildPrompt(answers, step), analyticsId: 'setup-wizard' } : {});
  }

  /** After a failed start or a new conversation, the client hands unsent text back. */
  #takeDraftBack(state) {
    if (!state.draft) return;
    const pieces = state.draft.split(/\n{2,}(?=\[Step \d)/);
    for (const piece of pieces) {
      const q = parseQuestion(piece);
      const n = q.step || this.#wizard.step;
      const slot = this.#slots.get(n);
      if (slot && !slot.input.value.includes(q.text)) {
        slot.input.value = [slot.input.value, q.text].filter(Boolean).join('\n');
        autosize(slot.input);
        this.#drafts[n] = slot.input.value;
      }
    }
    this.#saveDrafts();
    this.#client.setDraft('');
  }

  async #newChat() {
    await this.#client.newChat();
    this.#slots.get(this.#wizard.step)?.input.focus();
  }

  async #end() {
    await this.#client.end();
    if (this.#dialog.open) this.#dialog.querySelector('#advisor-title').focus({ preventScroll: true });
  }

  #follow(ref) {
    if (this.#dialog.open && this.#dialog.matches(':modal')) this.close();
    this.#wizard.reveal(ref);
  }

  #goToStep(n) {
    if (this.#dialog.open && this.#dialog.matches(':modal')) this.close();
    this.#wizard.go(n, { from: this.#wizard.step });
  }

  #onStep() {
    this.#updateComposerLabel();
    const slot = this.#slots.get(this.#wizard.step);
    if (slot) autosize(slot.input);
    const toast = document.querySelector('[data-toast]');
    if (toast && Number(toast.dataset.step) === this.#wizard.step) toast.hidden = true;
    if (this.#state) this.render(this.#state);
  }

  // New replies: announce them whole, and point at them if they're elsewhere.
  #announceNew(model) {
    const replies = model.exchanges.flatMap((e) => e.replies.map((r) => ({ ...r, step: e.step || 1 })));
    const ids = new Set(replies.map((r) => r.id));
    if (!this.#seenReplies) {
      this.#seenReplies = ids; // Restored after a reload: nothing is new.
      return;
    }
    const fresh = replies.filter((r) => !this.#seenReplies.has(r.id));
    this.#seenReplies = ids;
    if (!fresh.length) return;
    const last = fresh.at(-1);
    const step = STEPS[last.step - 1];
    const text = last.type === 'link-card' ? 'shared a link' : stripPrefix(last.body).replace(REFERENCE_PATTERN, (_, name) => findReference(name)?.label ?? name);
    this.#announce(`${last.author}, on Step ${step.n}, ${step.name}: ${text}`);
    const elsewhere = step.n !== this.#wizard.step && !this.#dialog.open;
    if (elsewhere) {
      this.#unseen += fresh.length;
      this.#toast(step);
    }
  }

  #announce(text) {
    this.#announcer.textContent = '';
    setTimeout(() => (this.#announcer.textContent = text), 60);
  }

  #toast(step) {
    const toast = document.querySelector('[data-toast]');
    if (!toast) return;
    clearTimeout(this.#toastTimer);
    toast.dataset.step = String(step.n);
    toast.replaceChildren(
      h('span', { class: 'wz-toast-icon', html: icon('sparkle', { size: 14 }) }),
      h('span', {}, 'New answer on ', h('b', { text: `Step ${step.n} · ${step.name}` })),
      h('button', { type: 'button', onclick: () => { toast.hidden = true; this.#goToStep(step.n); } }, 'View'));
    toast.hidden = false;
    this.#toastTimer = setTimeout(() => (toast.hidden = true), 9000);
  }

  // Storage --------------------------------------------------------------------

  #restore() {
    try {
      this.#drafts = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || '{}') ?? {};
      const ui = JSON.parse(sessionStorage.getItem(UI_KEY) || '{}') ?? {};
      this.#ui.exampleHidden = ui.exampleHidden === true;
    } catch {
      this.#drafts = {};
    }
    for (const key of Object.keys(this.#drafts)) if (typeof this.#drafts[key] !== 'string') delete this.#drafts[key];
  }

  #saveDrafts() {
    try {
      sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(this.#drafts));
    } catch {
      // Storage denied: drafts live as long as the page.
    }
  }

  #saveUi() {
    try {
      sessionStorage.setItem(UI_KEY, JSON.stringify({ exampleHidden: this.#ui.exampleHidden }));
    } catch {
      // Same as above.
    }
  }
}

/**
 * Replies are text. This escapes nothing because it never parses HTML: it
 * builds nodes. Supported: paragraphs, line breaks, "- " lists, **bold**,
 * *italics*, `code`, http(s) links, and [[references]] to the wizard.
 */
export function renderText(text, onReference) {
  const fragment = document.createDocumentFragment();
  for (const block of String(text).trim().split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
      fragment.append(h('ul', {}, lines.map((line) => h('li', {}, inline(line.replace(/^\s*[-*•]\s+/, ''), onReference)))));
    } else {
      const p = h('p');
      lines.forEach((line, i) => {
        if (i) p.append(h('br'));
        p.append(...inline(line, onReference));
      });
      fragment.append(p);
    }
  }
  return fragment;
}

const INLINE = /\*\*([^*\n]+)\*\*|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|`([^`\n]+)`|\[\[([^[\]\n]{1,60})\]\]|(https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"])/g;

function inline(text, onReference) {
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    if (m[1]) nodes.push(h('b', { text: m[1] }));
    else if (m[2]) nodes.push(h('em', { text: m[2] }));
    else if (m[3]) nodes.push(h('code', { text: m[3] }));
    else if (m[4]) nodes.push(referenceNode(m[4], onReference));
    else if (m[5]) nodes.push(h('a', { href: m[5], target: '_blank', rel: 'noopener noreferrer', text: m[5] }));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

const REF_ICONS = { step: 'arrow', plan: 'star', checklist: 'check', app: 'apps' };

function referenceNode(raw, onReference) {
  const ref = findReference(raw);
  // Unknown names stay plain text, without brackets.
  if (!ref) return document.createTextNode(raw.trim());
  const describe = { step: `Go to ${ref.label}`, plan: `Show the ${ref.label} plan`, checklist: `Open “${ref.label}” in your checklist`, app: `Show the ${ref.label} app` }[ref.kind];
  if (!onReference) return h('span', { class: 'ref-chip is-static', html: icon(REF_ICONS[ref.kind], { size: 13 }) }, h('span', { text: ref.label }));
  const chip = h('button', { type: 'button', class: `ref-chip is-${ref.kind}`, 'aria-label': describe, title: describe, onclick: () => onReference(ref) });
  chip.innerHTML = icon(REF_ICONS[ref.kind], { size: 13 });
  chip.append(h('span', { text: ref.label }));
  return chip;
}

function initials(name) {
  const words = String(name).split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0]?.slice(0, 2) ?? '?').toUpperCase();
}

function autosize(textarea) {
  if (!textarea.offsetParent) return; // Hidden in another step: sized when it shows.
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 32), 132)}px`;
}

/**
 * Keeps a container's children in step with a list, reusing elements whose
 * signature didn't change, so focus, open details and animations survive.
 */
function keyed(container, items, sign, create, animate = true) {
  const existing = new Map([...container.children].filter((el) => el.dataset.key).map((el) => [el.dataset.key, el]));
  let previous = null;
  for (const item of items) {
    const [key, signature] = sign(item);
    let el = existing.get(key);
    if (el && el.dataset.sig !== signature) {
      const fresh = create(item);
      if (el.querySelector('details[open]')) fresh.querySelector('details')?.setAttribute('open', '');
      el.replaceWith(fresh);
      el = fresh;
    } else if (!el) {
      el = create(item);
      if (animate) el.classList.add('is-new');
    }
    existing.delete(key);
    el.dataset.key = key;
    el.dataset.sig = signature;
    const next = previous ? previous.nextElementSibling : container.firstElementChild;
    if (el !== next) container.insertBefore(el, next);
    previous = el;
  }
  for (const el of existing.values()) el.remove();
}
