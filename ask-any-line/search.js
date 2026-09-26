// The docs search in the header. It searches this page's steps and a small
// glossary. When the query reads like a question, the first option asks it:
// "Ask the Tender team: can I charge in euros?"

const GLOSSARY = [
  ['API keys', 'Secret and publishable keys, test and live', 'step-1b'],
  ['API versions', 'Pin the version your code was written for', 'step-1b'],
  ['Amounts and currencies', 'Integers in the smallest currency unit: 2000 is $20.00', 'step-2b'],
  ['Idempotency keys', 'Retry a request without charging twice', 'step-2c'],
  ['Client secret', 'What the browser needs to confirm one payment', 'step-2d'],
  ['Tender.js', 'Load it from js.tender.dev, then mount the card field', 'step-3a'],
  ['Card field', 'A secure iframe that collects card details', 'step-3b'],
  ['3-D Secure', 'confirmPayment shows the bank\'s challenge for you', 'step-3c'],
  ['Webhook signatures', 'Check the Tender-Signature header on the raw body', 'step-4a'],
  ['payment.succeeded', 'The event to fulfill orders from', 'step-4b'],
  ['Webhook retries', 'Reply 2xx within 10 seconds; retries for 3 days', 'step-4c'],
  ['Tender CLI', 'tender events forward, and tender events send', 'step-5a'],
  ['Test cards', 'Cards that succeed, ask for 3-D Secure, or decline', 'step-5b'],
];

const QUESTION = /^(how|what|why|when|where|which|who|whom|can|could|should|does|do|did|is|are|was|will|would|may|might|must|am|has|have|if)\b/i;

export function looksLikeQuestion(query) {
  const q = query.trim();
  const words = q.split(/\s+/).filter(Boolean).length;
  return (/\?$/.test(q) && words >= 2) || (QUESTION.test(q) && words >= 3);
}

export function initSearch({ box, input, list, article, onAsk, onGo }) {
  const index = [
    ...[...article.querySelectorAll('.tn-sub')].map((sub) => ({
      title: sub.querySelector('h3')?.textContent.trim() ?? '',
      text: [...sub.querySelectorAll('p:not(.tn-side)')].map((p) => p.textContent.trim()).join(' '),
      target: sub.id,
      step: sub.closest('[data-step]')?.dataset.title ?? '',
    })),
    ...GLOSSARY.map(([title, text, target]) => ({ title, text, target, step: 'Glossary' })),
  ];
  let options = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const choose = (option) => {
    if (!option) return;
    close();
    input.blur();
    box.classList.remove('is-open');
    if (option.ask) {
      input.value = ''; // The question now lives in its thread.
      onAsk(option.ask);
    } else onGo(option.target);
  };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((el, n) => el.setAttribute('aria-selected', String(n === i)));
    if (i >= 0 && list.children[i]) {
      input.setAttribute('aria-activedescendant', list.children[i].id);
      list.children[i].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const update = () => {
    const q = input.value.trim();
    if (!q) return close();
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !QUESTION.test(w) && !/^(the|a|an|to|of|in|on|for|my|i|it|and|or|with|you)$/.test(w));
    const scored = index.map((item) => {
      const title = item.title.toLowerCase();
      const all = `${title} ${item.text.toLowerCase()}`;
      const hits = words.filter((w) => all.includes(w.replace(/[?.!,]$/, '')));
      const score = hits.length * 2 + words.filter((w) => title.includes(w)).length * 3;
      return { item, score, full: hits.length === words.length };
    }).filter((r) => words.length && r.score > 0 && (r.full || r.score >= 4))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    options = [
      ...(looksLikeQuestion(q) ? [{ ask: q }] : []),
      ...scored.map(({ item }) => ({ target: item.target, title: item.title, step: item.step, text: item.text })),
    ];
    list.replaceChildren(...options.map((option, i) => {
      const el = document.createElement('div');
      el.id = `tn-result-${i}`;
      el.className = `tn-result${option.ask ? ' is-ask' : ''}`;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      el.innerHTML = option.ask
        ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9.5L6 17v-3H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"/></svg><b></b><span>The answer appears at the top of this page</span>'
        : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h7l3 3v10H5z"/><path d="M8 10h5M8 13h4"/></svg><b></b><span></span>';
      el.querySelector('b').textContent = option.ask ? `Ask the Tender team: ${option.ask}` : option.title;
      if (!option.ask) el.querySelector('span').textContent = `${option.step} · ${option.text}`;
      el.addEventListener('pointerdown', (e) => e.preventDefault());
      el.addEventListener('click', () => choose(option));
      return el;
    }));
    if (!options.length) {
      const empty = document.createElement('p');
      empty.className = 'tn-results-empty';
      empty.textContent = 'Nothing on this page matches. End with a question mark to ask the team.';
      list.replaceChildren(empty);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(options.length ? 0 : -1);
  };

  input.addEventListener('input', update);
  input.addEventListener('focus', () => input.value.trim() && update());
  input.addEventListener('blur', () => setTimeout(() => {
    close();
    if (!input.value) box.classList.remove('is-open');
  }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); highlight((active + 1) % options.length); }
    else if (e.key === 'ArrowUp' && options.length) { e.preventDefault(); highlight((active - 1 + options.length) % options.length); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); input.blur(); box.classList.remove('is-open'); }
  });
  // On phones the box is an icon until tapped.
  box.addEventListener('click', () => {
    if (!box.classList.contains('is-open') && matchMedia('(max-width: 760px)').matches) {
      box.classList.add('is-open');
      input.focus();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    if (matchMedia('(max-width: 760px)').matches) box.classList.add('is-open');
    input.focus();
  });
}
