// The conversation strip: at the bottom of the code panel, or docked to the
// bottom of the screen on phones while there's a conversation. It says who
// answers and how many questions there are, holds End conversation and the
// Powered by Stand link, and shows what concerns every thread at once: someone
// from the team joined, the email follow-up form, the end.

import { badge } from './cards.js';
import { el, poweredBy } from './dom.js';

// Errors that aren't about one question, in the page's voice. (A failed send
// shows on the question itself.)
const ALERTS = {
  paused: ['The connection dropped.', 'Reconnect', (c) => c.retry()],
  refresh: ['Couldn\'t refresh the answers. Reconnecting…'],
  end: ['Couldn\'t end the conversation.', 'Try again', (c) => c.end()],
  email: ['Couldn\'t send your email. Check it and try again.'],
  offer: ['That follow-up offer has expired.'],
  lost: ['The conversation ended before your last question was confirmed. Its text is saved for a new conversation.'],
};

export class Strip {
  constructor(client) {
    this.client = client;
    this.el = el('div', 'strip');
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Conversation');
    this.dock = el('div', 'tn-dock');
  }

  update(state, view) {
    const s = state;
    const client = this.client;
    const parts = [];
    const actions = [];
    const action = (label, run, strong) => {
      const b = el('button', `link-btn${strong ? ' is-strong' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', run);
      actions.push(b);
    };
    const host = () => [el('b', '', s.host.name || 'The Tender team'), badge(s.host.kind)].filter(Boolean);
    const questions = [...view.threads.values()].reduce((n, t) => n + t.items.filter((i) => i.kind === 'visitor').length, 0);
    let dot = 'idle';

    if (s.phase === 'loading') parts.push('Checking who can answer…');
    else if (s.phase === 'unavailable') {
      dot = 'off';
      parts.push(s.error === 'connect' ? 'Couldn\'t reach Stand.' : 'Nobody can answer questions right now.');
      action('Check again', () => void client.retry(), true);
    } else if (s.phase === 'available') {
      dot = 'live';
      parts.push('Questions go to ', ...host(), el('span', '', '· Real conversation via Stand'));
    } else if (s.phase === 'active') {
      dot = s.connection === 'online' ? 'live' : 'warn';
      parts.push(`${questions} ${questions === 1 ? 'question' : 'questions'} with `, ...host());
      if (s.connection !== 'online') parts.push(el('span', '', s.connection === 'connecting' ? '· Connecting…' : '· Reconnecting…'));
      action('End conversation', () => void client.end());
    } else if (s.phase === 'ended') {
      parts.push(s.error === 'gone' ? 'This conversation is no longer available.' : 'Conversation ended.');
      action('Start a new conversation', () => void client.newChat(), true);
    } else if (s.phase === 'uncertain') {
      dot = 'warn';
      parts.push('Your first question may have started a conversation, but it wasn\'t confirmed.');
      action('Start a new conversation', () => void client.newChat(), true);
    }
    const powered = poweredBy(s.poweredByUrl, () => client.trackAttributionClick());
    if (powered) actions.push(powered);

    const extra = [];
    const alert = ALERTS[s.error];
    if (alert) {
      const p = el('p', 'strip-alert', alert[0]);
      p.setAttribute('role', 'alert');
      if (alert[1]) {
        const b = el('button', 'link-btn is-strong', alert[1]);
        b.type = 'button';
        b.addEventListener('click', () => void alert[2](client));
        p.append(' ', b);
      }
      extra.push(p);
    }

    // Conversation-wide cards. Who answers can change mid-conversation.
    const cards = [...view.cards].reverse();
    const identity = cards.find((c) => c.kind === 'handoff' || c.kind === 'takeover');
    if (identity && s.phase === 'active') {
      extra.push(el('p', 'strip-card', identity.kind === 'handoff'
        ? `${identity.name || 'Someone from the team'}${identity.title ? `, ${identity.title},` : ''} joined the conversation.`
        : `${identity.name || 'The AI Stand-in'} (AI) is answering again.`));
    }
    if (s.followupOffered && s.phase === 'active') extra.push(this.#emailForm(cards.find((c) => c.kind === 'offer')));
    const confirmed = cards.find((c) => c.kind === 'confirmed');
    if (confirmed && s.phase === 'ended') extra.push(el('p', 'strip-card', confirmed.message || 'Thanks. The team will reply by email.'));

    const status = el('p', 'strip-state');
    status.style.margin = '0';
    status.setAttribute('role', 'status');
    const text = el('span');
    text.append(...parts);
    status.append(el('i', `strip-dot${dot === 'live' ? '' : ` is-${dot}`}`), text);
    const buttons = el('span', 'strip-actions');
    buttons.append(...actions);

    const signature = JSON.stringify([s.phase, s.connection, s.error, questions, s.host, s.poweredByUrl, s.followupOffered, identity?.seq, confirmed?.seq]);
    // Don't redraw the email form while someone is typing in it.
    if (this.el.dataset.sig !== signature && !(this.el.contains(document.activeElement) && this.el.querySelector('form'))) {
      this.el.dataset.sig = signature;
      this.el.replaceChildren(status, buttons, ...extra);
    }
  }

  #emailForm(offer) {
    const box = el('div', 'strip-card');
    box.append(el('span', '', offer?.message || 'Nobody could answer in time. Leave your email and the team will follow up.'));
    const form = el('form');
    const input = el('input');
    input.type = 'email';
    input.required = true;
    input.autocomplete = 'email';
    input.placeholder = 'you@company.com';
    input.setAttribute('aria-label', 'Your email address');
    const go = el('button', 'btn', 'Send');
    go.type = 'submit';
    form.append(input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim()) void this.client.submitEmail(input.value);
    });
    box.append(form);
    return box;
  }

  /** In the code panel on wide screens; on phones, a dock while there's a conversation. */
  place({ wide, home, phase, followupOffered }) {
    if (wide) {
      if (this.el.parentElement !== home) home.append(this.el);
      this.dock.remove();
      document.body.classList.remove('has-dock');
      return;
    }
    const needed = ['active', 'ended', 'uncertain'].includes(phase) || followupOffered;
    if (needed) {
      if (this.el.parentElement !== this.dock) this.dock.append(this.el);
      if (!this.dock.isConnected) document.body.append(this.dock);
    } else {
      this.dock.remove();
    }
    document.body.classList.toggle('has-dock', needed);
  }
}
