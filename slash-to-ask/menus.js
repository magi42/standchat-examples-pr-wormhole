// Floating UI for the document: the slash menu, the selection toolbar, and small
// menus and option lists. Presentation only; the document decides what they do.

import { avatarHtml, escapeHtml as escape } from './util.js';

const BLOCK_ITEMS = [
  { type: 'text', title: 'Text', hint: 'Plain words, nothing fancy.', tile: 't-text', keys: 'text plain paragraph words' },
  { type: 'h1', title: 'Heading 1', hint: 'A big section title.', tile: 't-h1', keys: 'heading h1 title big' },
  { type: 'h2', title: 'Heading 2', hint: 'A medium section title.', tile: 't-h2', keys: 'heading h2 subtitle' },
  { type: 'h3', title: 'Heading 3', hint: 'A small section title.', tile: 't-h3', keys: 'heading h3 small' },
  { type: 'todo', title: 'To-do list', hint: 'Things to tick off.', tile: 't-todo', keys: 'todo to-do task checkbox checklist' },
  { type: 'bullet', title: 'Bulleted list', hint: 'Points in no particular order.', tile: 't-bullet', keys: 'bulleted list unordered points' },
  { type: 'numbered', title: 'Numbered list', hint: 'Steps, in order.', tile: 't-number', keys: 'numbered list ordered steps' },
  { type: 'toggle', title: 'Toggle list', hint: 'Tuck details away until needed.', tile: 't-toggle', keys: 'toggle collapse details fold' },
  { type: 'quote', title: 'Quote', hint: 'Words worth setting apart.', tile: 't-quote', keys: 'quote blockquote citation' },
  { type: 'divider', title: 'Divider', hint: 'A quiet line between ideas.', tile: 't-divider', keys: 'divider line separator rule' },
  { type: 'callout', title: 'Callout', hint: 'A tinted box for what matters.', tile: 't-callout', keys: 'callout note tip box highlight' },
];
const ASK_KEYS = ['ask', 'question', 'team', 'help', 'chat', 'talk', 'support', 'contact', 'sales', '?'];

/** Viewport bounds that respect an on-screen keyboard and the phone's keyboard bar. */
function bounds() {
  const vv = window.visualViewport;
  const width = document.documentElement.clientWidth;
  const bar = document.querySelector('.kbar:not([hidden])')?.offsetHeight ?? 0;
  return vv ? { top: vv.offsetTop, bottom: vv.offsetTop + vv.height - bar, width } : { top: 0, bottom: innerHeight - bar, width };
}

/**
 * Places a fixed popover next to a rect: below by default, flipped when it
 * doesn't fit. With `fit`, a tall popover shrinks to the room on its side.
 */
export function place(el, rect, { gap = 6, align = 'start', prefer = 'below', inset = 8, fit = false } = {}) {
  el.style.left = '0px';
  el.style.top = '0px';
  if (fit) el.style.maxHeight = '';
  const view = bounds();
  const roomBelow = view.bottom - inset - (rect.bottom + gap);
  const roomAbove = rect.top - gap - (view.top + inset);
  let h = el.offsetHeight;
  const w = el.offsetWidth;
  let side = prefer;
  if (prefer === 'below' && h > roomBelow && roomAbove > roomBelow) side = 'above';
  if (prefer === 'above' && h > roomAbove && roomBelow > roomAbove) side = 'below';
  if (fit && h > (side === 'below' ? roomBelow : roomAbove)) {
    el.style.maxHeight = `${Math.max(140, side === 'below' ? roomBelow : roomAbove)}px`;
    h = el.offsetHeight;
  }
  let left = align === 'end' ? rect.right - w : align === 'center' ? rect.left + rect.width / 2 - w / 2 : rect.left;
  left = Math.min(Math.max(left, inset), view.width - w - inset);
  const top = side === 'below' ? rect.bottom + gap : rect.top - h - gap;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(Math.max(view.top + inset, top))}px`;
}

// ---------- Slash menu ----------

export function createSlashMenu({ onPick, onClose, announce, anchor }) {
  const el = document.createElement('div');
  el.className = 'slash';
  el.id = 'slash-menu';
  el.setAttribute('role', 'listbox');
  el.setAttribute('aria-label', 'Insert a block');
  el.hidden = true;
  el.innerHTML = `<div class="slash-scroll"></div><div class="slash-foot">${matchMedia('(pointer: coarse)').matches
    ? '<span>Tap a block, or keep typing to filter</span>'
    : '<span>Type to filter</span><span>↑↓ Enter · Esc</span>'}</div>`;
  document.body.append(el);
  const list = el.querySelector('.slash-scroll');
  let shown = [];
  let active = 0;
  let open = false;
  let query = '';
  let rect = null;
  let ask = { name: '', kind: null, avatar: '', line: 'Checking who can answer…' }; // Who answers, from the page.

  function matches(item) {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    if (item.type === 'ask') return 'ask the team'.includes(q) || ASK_KEYS.some((k) => k.startsWith(q));
    return item.title.toLowerCase().includes(q) || item.keys.split(' ').some((k) => k.startsWith(q));
  }

  function render() {
    const askItem = { type: 'ask', title: 'Ask the team' };
    const blocks = BLOCK_ITEMS.filter(matches);
    shown = [...(matches(askItem) ? [askItem] : []), ...blocks];
    active = Math.min(active, Math.max(0, shown.length - 1));
    let html = '';
    if (shown[0]?.type === 'ask') {
      const badge = ask.kind === 'rep' ? 'Team' : ask.kind === 'standin' ? 'AI' : '';
      html += `<p class="slash-sec" role="presentation">Ask</p>
        <div class="slash-item is-ask" role="option" id="slash-opt-ask" data-i="0">
          <span class="slash-tile tile-ask">${avatarHtml(ask.name, ask.avatar)}${badge ? `<span class="tile-ai" data-kind="${ask.kind}">${badge}</span>` : ''}</span>
          <span class="slash-txt"><b>Ask the team</b><small>${escape(ask.line)}</small></span>
        </div>`;
    }
    if (blocks.length) html += '<p class="slash-sec" role="presentation">Basic blocks</p>';
    blocks.forEach((item) => {
      const i = shown.indexOf(item);
      html += `<div class="slash-item" role="option" id="slash-opt-${item.type}" data-i="${i}">
          <span class="slash-tile"><svg aria-hidden="true"><use href="#${item.tile}"/></svg></span>
          <span class="slash-txt"><b>${item.title}</b><small>${item.hint}</small></span>
        </div>`;
    });
    if (!shown.length) html = '<p class="slash-empty">No blocks match. Keep typing, or press Esc.</p>';
    list.innerHTML = html;
    highlight(false);
  }

  function highlight(scroll = true) {
    const items = list.querySelectorAll('.slash-item');
    items.forEach((item, i) => {
      item.classList.toggle('is-active', i === active);
      item.setAttribute('aria-selected', String(i === active));
    });
    const current = items[active];
    if (current && scroll) current.scrollIntoView({ block: 'nearest' });
    const host = document.querySelector('[aria-controls="slash-menu"]');
    if (current) host?.setAttribute('aria-activedescendant', current.id);
    if (current && scroll) announce?.(`${shown[active].title}, ${active + 1} of ${shown.length}`);
  }

  list.addEventListener('mousedown', (e) => e.preventDefault()); // Keep the caret where it is.
  list.addEventListener('mousemove', (e) => {
    const item = e.target.closest('.slash-item');
    if (!item || Number(item.dataset.i) === active) return;
    active = Number(item.dataset.i);
    highlight(false);
  });
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.slash-item');
    if (!item) return;
    active = Number(item.dataset.i);
    pick();
  });

  function pick() {
    const item = shown[active];
    if (item) onPick(item);
  }

  function show(anchor, q) {
    rect = anchor;
    query = q;
    active = 0;
    open = true;
    el.hidden = false;
    render();
    reposition();
    announce?.(`Block menu. ${shown[0]?.title ?? ''} selected. Use arrow keys, then Enter.`);
  }

  function reposition() {
    if (!open || !rect) return;
    place(el, new DOMRect(rect.left - 10, rect.top, rect.width, rect.height), { gap: 8, fit: true });
  }

  function update(q, anchor) {
    if (!open) return;
    if (anchor) rect = anchor;
    if (q !== query) {
      query = q;
      active = 0;
      render();
      if (!shown.length && q.length > 3) return close();
    }
    reposition();
  }

  function close() {
    if (!open) return;
    open = false;
    el.hidden = true;
    onClose?.();
  }

  function handleKey(e) {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) {
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
        highlight();
      }
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
      if (!shown.length) return false;
      e.preventDefault();
      pick();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  }

  // The menu follows its line while the page scrolls, and closes when the line leaves the screen.
  addEventListener('scroll', () => {
    if (!open) return;
    const next = anchor?.();
    if (!next || next.bottom < bounds().top || next.top > bounds().bottom) return close();
    rect = next;
    reposition();
  }, { passive: true });
  addEventListener('resize', () => reposition());
  document.addEventListener('pointerdown', (e) => {
    if (open && !el.contains(e.target)) close();
  });

  return {
    id: el.id,
    open: show,
    update,
    close,
    handleKey,
    pick,
    setAsk(info) {
      const next = { ...ask, ...info };
      if (JSON.stringify(next) === JSON.stringify(ask)) return;
      ask = next;
      if (open) render();
    },
    get isOpen() {
      return open;
    },
  };
}

// ---------- Selection toolbar ----------

const FORMATS = [
  { cmd: 'bold', label: 'Bold', key: 'B', cls: 'tb-b', text: 'B' },
  { cmd: 'italic', label: 'Italic', key: 'I', cls: 'tb-i', text: 'i' },
  { cmd: 'underline', label: 'Underline', key: 'U', cls: 'tb-u', text: 'U' },
  { cmd: 'strikeThrough', label: 'Strikethrough', cls: 'tb-s', text: 'S' },
  { cmd: 'code', label: 'Inline code', cls: 'tb-code', text: '&lt;/&gt;' },
];

export function createToolbar({ root, canFormat, onAsk, onFormat }) {
  const bar = document.createElement('div');
  bar.className = 'tb';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selected text');
  bar.hidden = true;
  bar.innerHTML = `
    <button class="tb-ask" type="button" data-act="ask" title="Ask the team about this (Alt+F10, Enter)"><svg aria-hidden="true"><use href="#ui-ask"/></svg>Ask about this</button>
    <span class="tb-fmt"><span class="tb-sep" role="separator"></span>${FORMATS.map((f) =>
      `<button class="${f.cls}" type="button" data-cmd="${f.cmd}" aria-label="${f.label}" aria-pressed="false" title="${f.label}${f.key ? ` (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}${f.key})` : ''}">${f.text}</button>`).join('')}
    <button type="button" data-act="link" aria-label="Link" title="Link"><svg aria-hidden="true"><use href="#ui-link"/></svg></button></span>
    <form class="tb-link" hidden><label class="sr-only" for="tb-link-url">Link address</label><input id="tb-link-url" type="url" placeholder="Paste a link, then Enter" autocomplete="off"></form>`;
  document.body.append(bar);
  const fmt = bar.querySelector('.tb-fmt');
  const linkForm = bar.querySelector('.tb-link');
  const linkInput = linkForm.querySelector('input');
  let range = null; // the selection the toolbar is about
  let host = null;
  let raf = 0;
  const coarse = matchMedia('(pointer: coarse)');

  function askable(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    return el?.closest('.blk-text, .ask-a-text, .db-table th, .db-table td, .db-card') ?? null;
  }

  function update() {
    raf = 0;
    if (bar.contains(document.activeElement)) return;
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return hide();
    const r = sel.getRangeAt(0);
    const start = askable(r.startContainer);
    if (!start || !root.contains(start) || start !== askable(r.endContainer) || start.closest('.ask.is-example, .slash')) return hide();
    const text = r.toString().replace(/\s+/g, ' ').trim();
    if (!text) return hide();
    range = r.cloneRange();
    host = start;
    const formatting = canFormat(r.commonAncestorContainer);
    fmt.hidden = !formatting;
    linkForm.hidden = true;
    for (const button of fmt.querySelectorAll('[data-cmd]')) {
      const cmd = button.dataset.cmd;
      button.setAttribute('aria-pressed', String(cmd !== 'code' && document.queryCommandState?.(cmd) === true));
    }
    bar.hidden = false;
    const rects = r.getClientRects();
    const box = rects.length ? (coarse.matches ? rects[rects.length - 1] : rects[0]) : r.getBoundingClientRect();
    // Phones draw their own copy/paste menu above a selection: go below it.
    place(bar, box, { gap: coarse.matches ? 14 : 8, prefer: coarse.matches ? 'below' : 'above', align: coarse.matches ? 'center' : 'start' });
  }

  function hide() {
    bar.hidden = true;
    linkForm.hidden = true;
    range = null;
    host = null;
  }

  function restoreSelection() {
    if (!range) return;
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  document.addEventListener('selectionchange', () => {
    if (!raf) raf = requestAnimationFrame(update);
  });
  addEventListener('scroll', () => !bar.hidden && !bar.contains(document.activeElement) && update(), { passive: true });
  bar.addEventListener('mousedown', (e) => {
    if (!e.target.closest('input')) e.preventDefault();
  });

  bar.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || !range) return;
    if (button.dataset.act === 'ask') {
      const quote = range.toString().replace(/\s+/g, ' ').trim();
      const node = range.startContainer;
      getSelection().removeAllRanges();
      hide();
      onAsk({ node, quote });
    } else if (button.dataset.act === 'link') {
      linkForm.hidden = false;
      fmt.hidden = true;
      linkInput.value = '';
      linkInput.focus();
    } else if (button.dataset.cmd) {
      restoreSelection();
      if (button.dataset.cmd === 'code') wrapCode();
      else document.execCommand(button.dataset.cmd, false);
      onFormat?.();
      range = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
      update();
    }
  });

  linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let url = linkInput.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('Not a web link');
      host?.focus({ preventScroll: true });
      restoreSelection();
      document.execCommand('createLink', false, parsed.href);
      onFormat?.();
    } catch {
      linkInput.setCustomValidity('Enter a web address, like example.com');
      linkInput.reportValidity();
      return;
    }
    hide();
  });
  linkInput.addEventListener('input', () => linkInput.setCustomValidity(''));

  function wrapCode() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const existing = r.commonAncestorContainer.parentElement?.closest('code');
    if (existing) {
      existing.replaceWith(...existing.childNodes);
      return;
    }
    const code = document.createElement('code');
    code.append(r.extractContents());
    r.insertNode(code);
    sel.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(code);
    sel.addRange(after);
  }

  // Keyboard: Alt+F10 moves into the toolbar; arrows move; Esc goes back to the text.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F10' && e.altKey && !bar.hidden) {
      e.preventDefault();
      bar.querySelector('button:not([hidden])')?.focus();
    }
  });
  bar.addEventListener('keydown', (e) => {
    const buttons = [...bar.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const back = host;
      const keep = range;
      hide();
      back?.focus?.({ preventScroll: true });
      if (keep) {
        getSelection().removeAllRanges();
        getSelection().addRange(keep);
      }
    }
  });
  bar.addEventListener('focusout', (e) => {
    if (!bar.contains(e.relatedTarget)) requestAnimationFrame(() => !bar.contains(document.activeElement) && update());
  });

  return { hide, update };
}

// ---------- Menus and option lists ----------

let openPop = null;

/** Closes whichever small menu is open. */
export function closePop() {
  openPop?.close();
}

/**
 * A small menu near an anchor (a DOMRect or an element). Items:
 * { label, icon, hint, run, danger } | { separator: true } | { section: 'Title' }.
 */
export function openMenu({ items, anchor, label, className = '', returnFocus, align = 'start', onClose }) {
  let pop = null;
  const el = document.createElement('div');
  el.className = `pop ${className}`;
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', label);
  for (const item of items) {
    if (item.separator) {
      if (el.lastElementChild && !el.lastElementChild.matches('.pop-sep')) el.insertAdjacentHTML('beforeend', '<div class="pop-sep" role="separator"></div>');
    } else if (item.section) {
      el.insertAdjacentHTML('beforeend', `<p class="pop-sec" role="presentation">${escape(item.section)}</p>`);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `pop-item${item.danger ? ' is-danger' : ''}`;
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.innerHTML = `${item.icon ? `<svg aria-hidden="true"><use href="#${item.icon}"/></svg>` : ''}<span>${escape(item.label)}</span>${item.hint ? `<span class="kbd-hint" aria-hidden="true">${escape(item.hint)}</span>` : ''}`;
      button.addEventListener('click', () => {
        pop.close();
        item.run?.();
      });
      el.append(button);
    }
  }
  if (el.lastElementChild?.matches('.pop-sep')) el.lastElementChild.remove();
  pop = mountPop(el, { anchor, returnFocus, align, onClose, roles: '[role="menuitem"]' });
  return pop;
}

/**
 * An option list for a select or multi-select property.
 * options: [{ value, color }]; selected: [value]; onChange(values).
 */
export function openListbox({ anchor, label, options, selected, multi, onChange, returnFocus, onClose }) {
  const el = document.createElement('div');
  el.className = 'pop opts';
  el.innerHTML = `<p class="opts-head" id="opts-head">${multi ? 'Pick all that apply' : 'Pick one'}</p>
    <div role="listbox" aria-labelledby="opts-head" aria-label="${escape(label)}" ${multi ? 'aria-multiselectable="true"' : ''}></div>`;
  const list = el.querySelector('[role="listbox"]');
  let values = [...selected];
  const render = () => {
    list.innerHTML = options.map((o) => {
      const on = values.includes(o.value);
      return `<button type="button" class="pop-item opt" role="option" tabindex="-1" aria-selected="${on}" data-value="${escape(o.value)}"><span class="tag" data-color="${o.color}">${escape(o.value)}</span>${on ? '<svg aria-hidden="true"><use href="#ui-check"/></svg>' : ''}</button>`;
    }).join('');
  };
  render();
  list.addEventListener('click', (e) => {
    const button = e.target.closest('.opt');
    if (!button) return;
    const value = button.dataset.value;
    if (multi) {
      values = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
      onChange(values);
      const index = [...list.children].indexOf(button);
      render();
      list.children[index]?.focus();
    } else {
      values = values[0] === value ? [] : [value];
      onChange(values);
      close();
    }
  });
  const { close } = mountPop(el, { anchor, returnFocus, onClose, roles: '[role="option"]' });
  return { close, el };
}

/**
 * Shows a popover next to its anchor and manages it: focus moves in, arrow keys
 * move between `roles` (menus), Esc or a click outside closes it, and focus goes
 * back where it came from. A dialog keeps Tab for moving around inside it.
 */
export function mountPop(el, { anchor, returnFocus, align = 'start', roles, dialog = false, onClose, prefer = 'below' }) {
  closePop();
  document.body.append(el);
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  place(el, rect, { align, prefer });
  const focusables = () => [...el.querySelectorAll(roles)].filter((node) => !node.disabled && node.offsetParent !== null);
  // A dialog takes focus itself, so a screen reader starts at its top; a menu focuses its first item.
  if (dialog) {
    el.tabIndex = -1;
    el.focus();
  } else focusables()[0]?.focus();

  const onKey = (e) => {
    const all = focusables();
    const i = all.indexOf(document.activeElement);
    if (!dialog && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    } else if (!dialog && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab' && !dialog) {
      close();
    }
  };
  const onFocusOut = (e) => {
    if (dialog && e.relatedTarget && !el.contains(e.relatedTarget)) close(false);
  };
  // A click on the anchor itself is its own toggle; don't close under it.
  const onDown = (e) => {
    if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) close(false);
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('focusout', onFocusOut);
  setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
  addEventListener('scroll', onScroll, { passive: true });
  function onScroll() {
    if (!(anchor instanceof Element) || (!dialog && !el.contains(document.activeElement))) return close(false);
    place(el, anchor.getBoundingClientRect(), { align, prefer });
  }

  function close(restore = true) {
    if (!el.isConnected) return;
    el.remove();
    document.removeEventListener('pointerdown', onDown);
    removeEventListener('scroll', onScroll);
    if (openPop?.el === el) openPop = null;
    onClose?.();
    if (restore) returnFocus?.focus?.({ preventScroll: true });
  }
  openPop = { el, close };
  return { close, el };
}
