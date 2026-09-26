// "How it works" shows the real thing, live: the prompt this page would send
// right now, the prefix the next question would carry, and the visitor's own
// questions the way the team reads them in Stand.

import { copyText, el } from './dom.js';

export class Explainer {
  constructor(root = document) {
    this.prompt = root.querySelector('[data-live="prompt"] pre');
    this.next = root.querySelector('[data-live="next"] pre');
    this.asked = root.querySelector('[data-live="asked"]');
    this.sig = '';
    for (const box of root.querySelectorAll('.ex-live')) {
      const button = el('button', 'ex-copy', 'Copy');
      button.type = 'button';
      button.addEventListener('click', () => copyText(box.querySelector('pre').textContent, button));
      box.append(button);
    }
  }

  /** { prompt, sent, limit, message, first, asked: [{ where, question }] } */
  update({ prompt, sent, limit, message, first, asked }) {
    if (!this.prompt) return;
    const sig = JSON.stringify([prompt, sent, message, first, asked]);
    if (sig === this.sig) return;
    this.sig = sig;

    // The last paragraph is where the visitor is: it changes as they read.
    const cut = prompt.lastIndexOf('\n\n') + 2;
    this.prompt.replaceChildren(
      prompt.slice(0, cut),
      el('span', 'ex-hi', prompt.slice(cut)),
      el('span', 'ex-dim', `\n\n(${prompt.length.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} characters${sent ? ', as your conversation started with it' : ''})`),
    );

    this.next.replaceChildren(
      el('span', 'ex-hi', message),
      '<your question>',
      el('span', 'ex-dim', first
        ? '\n\nIt would start the conversation, with the prompt above.'
        : '\n\nIt joins the conversation already open: the prefix is all the context it needs.'),
    );

    if (!asked.length) {
      this.asked.replaceChildren(el('p', '', 'Ask something on this page, and your questions show up here the way the team reads them in Stand.'));
      return;
    }
    const table = el('table');
    const head = el('thead');
    head.innerHTML = '<tr><th scope="col">Where</th><th scope="col">Question</th></tr>';
    const body = el('tbody');
    for (const item of asked) {
      const tr = el('tr');
      const where = el('td');
      where.append(el('code', '', item.where));
      tr.append(where, el('td', '', item.question));
      body.append(tr);
    }
    table.append(head, body);
    this.asked.replaceChildren(table);
  }
}
