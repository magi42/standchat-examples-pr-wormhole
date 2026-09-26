// The floating outline at the right edge of wide screens: a dash per heading,
// darker for the section you're reading and blue where there are questions.
// Hover or focus it for the headings' names; click one to go there.

export function createOutline({ root, onGo }) {
  const nav = document.createElement('nav');
  nav.className = 'kn-outline';
  nav.setAttribute('aria-label', 'On this page');
  nav.innerHTML = '<ol></ol>';
  document.body.append(nav);
  const list = nav.querySelector('ol');
  let shown = '';
  let frame = 0;

  function headings() {
    return [...root.children].filter((el) => /^h[123]$/.test(el.dataset.block ?? ''));
  }

  /** Rebuilds the list when headings or questions change. */
  function update() {
    const items = headings().map((el) => {
      const section = sectionOf(el);
      const asks = section.filter((b) => b.dataset.block === 'ask').length;
      return { id: el.id, level: el.dataset.block, text: el.textContent.trim() || 'Untitled', asks };
    });
    const signature = JSON.stringify(items);
    if (signature !== shown) {
      shown = signature;
      list.replaceChildren(...items.map((item) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `lvl-${item.level}`;
        button.dataset.go = item.id;
        if (item.asks) button.dataset.asks = String(item.asks);
        button.innerHTML = '<span></span><i aria-hidden="true"></i>';
        button.querySelector('span').textContent = item.text;
        if (item.asks) {
          button.querySelector('span').insertAdjacentHTML('afterend', `<b aria-hidden="true">${item.asks}</b>`);
          button.setAttribute('aria-label', `${item.text}, ${item.asks} question${item.asks === 1 ? '' : 's'}`);
        }
        li.append(button);
        return li;
      }));
    }
    track();
  }

  function sectionOf(heading) {
    const out = [];
    const level = Number(heading.dataset.block[1]);
    for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
      const m = /^h([123])$/.exec(el.dataset.block ?? '');
      if (m && Number(m[1]) <= level) break;
      out.push(el);
    }
    return out;
  }

  // The section being read: the last heading above a third of the screen.
  function track() {
    frame = 0;
    const body = root.getBoundingClientRect();
    // Out of the way over the cover, and once the document is behind you.
    nav.classList.toggle('is-away', body.top > innerHeight * 0.3 || body.bottom < innerHeight * 0.4);
    let current = null;
    for (const el of headings()) {
      if (el.getBoundingClientRect().top < innerHeight * 0.34) current = el.id;
    }
    for (const button of list.querySelectorAll('button')) button.classList.toggle('is-current', button.dataset.go === current);
  }

  addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(track);
  }, { passive: true });
  list.addEventListener('click', (e) => {
    const button = e.target.closest('[data-go]');
    if (button) onGo(button.dataset.go);
  });

  return { update };
}
