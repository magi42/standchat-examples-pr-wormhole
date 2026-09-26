// The document: an editable page made of blocks, in plain DOM.
//
// Each block is a .blk element with a data-block type (text, h2, todo, toggle,
// callout…) and its words in a .blk-text. The DOM is the source of truth: saving
// walks it into JSON in sessionStorage, and a reload builds it back, so the page
// comes back the way the visitor left it. Blocks the page draws itself (the
// example, the notes, the database) are "static": kept, moved, never rebuilt.
//
// It knows nothing about Stand. The ask block plugs in as a custom type, and the
// page hears about slash-menu picks and "Ask about this" through hooks.

import { createSlashMenu, createToolbar, openMenu } from './menus.js';
import { escapeHtml, newId, safeUrl } from './util.js';

const TEXTY = new Set(['text', 'h1', 'h2', 'h3', 'todo', 'bullet', 'numbered', 'toggle', 'callout', 'quote']);
const LISTY = new Set(['todo', 'bullet', 'numbered']);
const HEADINGS = new Set(['h1', 'h2', 'h3']);
const TAGS = { text: 'p', h1: 'h2', h2: 'h2', h3: 'h3', quote: 'blockquote' };
const PLACEHOLDERS = {
  text: 'Type / for blocks, or /ask to ask the team',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  todo: 'To-do',
  bullet: 'List',
  numbered: 'List',
  toggle: 'Toggle',
  quote: 'Empty quote',
  callout: 'Write something',
};
const BLOCK_TITLES = {
  text: 'Text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', todo: 'To-do list', bullet: 'Bulleted list',
  numbered: 'Numbered list', toggle: 'Toggle list', quote: 'Quote', callout: 'Callout', divider: 'Divider',
};
const SAVE_DELAY = 400;
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function createDoc({ page, root, title, crumb, storageKey, seed, types = {}, hooks = {} }) {
  const statics = new Map([...root.querySelectorAll('.blk[data-block="static"]')].map((el) => [el.id, el]));
  const coarse = matchMedia('(pointer: coarse)');
  let saveTimer = 0;
  let restoring = false;
  let lastFocused = null;
  let slash = null; // { text, node, offset }: where the "/" was typed
  let edited = false;

  // ---------- Building blocks ----------

  function createBlock(type, { id, html = '', fragment = null, checked = false, open = false, color, icon, children = [] } = {}) {
    const el = document.createElement('div');
    el.className = 'blk';
    el.dataset.block = type;
    el.id = id || newId('b');
    const row = document.createElement('div');
    row.className = 'blk-row';
    el.append(row);
    if (type === 'divider') {
      row.append(document.createElement('hr'));
      return el;
    }
    const text = document.createElement(TAGS[type] ?? 'div');
    text.className = 'blk-text';
    if (fragment) text.append(fragment);
    else text.innerHTML = sanitize(html);
    if (type === 'todo') {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'todo-box';
      box.checked = Boolean(checked);
      text.id = `${el.id}-t`;
      box.setAttribute('aria-labelledby', text.id);
      row.append(box);
      el.classList.toggle('is-done', box.checked);
    } else if (type === 'toggle') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tgl';
      button.setAttribute('aria-controls', `${el.id}-c`);
      button.innerHTML = '<svg aria-hidden="true"><use href="#ui-tri"/></svg><span class="sr-only"></span>';
      row.append(button);
    } else if (type === 'callout') {
      row.classList.add('callout');
      el.dataset.color = color || 'yellow';
      el.dataset.icon = /^e-[a-z]+$/.test(icon ?? '') ? icon : 'e-bulb';
      row.insertAdjacentHTML('beforeend', `<svg class="callout-icon" aria-hidden="true"><use href="#${el.dataset.icon}"/></svg>`);
    }
    row.append(text);
    if (type === 'toggle') {
      const kids = document.createElement('div');
      kids.className = 'blk-children';
      kids.id = `${el.id}-c`;
      kids.append(...children);
      el.append(kids);
      setOpen(el, open);
    }
    makeEditable(text, type);
    return el;
  }

  function makeEditable(text, type) {
    text.contentEditable = 'true';
    text.spellcheck = true;
    text.dataset.ph = PLACEHOLDERS[type] ?? '';
    syncEmpty(text);
  }

  function setOpen(el, open) {
    el.dataset.open = String(open);
    const button = el.querySelector(':scope > .blk-row > .tgl');
    const kids = el.querySelector(':scope > .blk-children');
    button?.setAttribute('aria-expanded', String(open));
    const label = button?.querySelector('.sr-only');
    if (label) label.textContent = open ? 'Hide details' : 'Show details';
    if (kids) kids.hidden = !open;
  }

  // ---------- Reading the document ----------

  const textOf = (el) => el?.querySelector(':scope > .blk-row > .blk-text') ?? null;
  const blockOf = (node) => (node instanceof Element ? node : node?.parentElement)?.closest('.blk') ?? null;
  const typeOf = (el) => el?.dataset.block ?? '';
  const kidsOf = (el) => el.querySelector(':scope > .blk-children');
  const blocks = () => [...root.querySelectorAll('.blk')];
  const visibleTexts = () => [title, ...[...root.querySelectorAll('.blk-text[contenteditable]')].filter((t) => t.offsetParent !== null && !t.closest('.ask, .blk[data-block="static"]'))];

  /**
   * The heading a block sits under, in reading order; the page title before the
   * first heading. With `self`, a heading counts for what comes right after it.
   */
  function headingFor(el, { self = false } = {}) {
    let found = '';
    for (const blk of blocks()) {
      if ((blk === el || blk.contains(el)) && !(self && blk === el)) break;
      if (HEADINGS.has(typeOf(blk))) found = textOf(blk)?.textContent.trim() || found;
      if (blk === el) break;
    }
    return found || title.textContent.trim();
  }

  /** A block's words, flattened, for quoting it. */
  function excerpt(el, max = 110) {
    const text = (textOf(el)?.textContent ?? el.textContent).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  // ---------- Saving and restoring ----------

  function serializeBlock(el) {
    const type = typeOf(el);
    const out = { id: el.id, t: type };
    if (type === 'static') return out;
    if (types[type]) return { ...out, d: types[type].serialize(el) };
    const text = textOf(el);
    if (text) out.h = sanitize(text.innerHTML);
    if (type === 'todo') out.x = el.querySelector(':scope > .blk-row > .todo-box').checked;
    if (type === 'toggle') {
      out.o = el.dataset.open === 'true';
      out.c = [...kidsOf(el).children].filter((c) => c.matches('.blk')).map(serializeBlock);
    }
    if (type === 'callout') Object.assign(out, { color: el.dataset.color, icon: el.dataset.icon });
    if (el.dataset.short) out.s = el.dataset.short;
    if (el.hasAttribute('data-invite')) out.inv = 1;
    return out;
  }

  function buildBlock(node) {
    if (!node || typeof node !== 'object' || !/^[A-Za-z0-9-]{1,40}$/.test(node.id ?? '')) return null;
    if (node.t === 'static') return statics.get(node.id) ?? null;
    if (types[node.t]) return types[node.t].create(node.id, node.d ?? {});
    if (!TEXTY.has(node.t) && node.t !== 'divider') return null;
    const children = node.t === 'toggle' && Array.isArray(node.c) ? node.c.map(buildBlock).filter(Boolean) : [];
    const el = createBlock(node.t, {
      id: node.id, html: typeof node.h === 'string' ? node.h : '', checked: node.x === true, open: node.o === true,
      color: ['gray', 'yellow', 'blue', 'green', 'red'].includes(node.color) ? node.color : undefined, icon: node.icon, children,
    });
    if (typeof node.s === 'string') el.dataset.short = node.s.slice(0, 60);
    if (node.inv) el.setAttribute('data-invite', '');
    return el;
  }

  function save() {
    clearTimeout(saveTimer);
    if (restoring) return;
    const data = {
      seed,
      title: sanitize(title.innerHTML),
      page: hooks.pageState?.() ?? {},
      statics: hooks.staticState?.() ?? {},
      blocks: [...root.children].filter((c) => c.matches('.blk')).map(serializeBlock),
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(data));
    } catch {
      // Storage can be denied or full. The page still works; it just forgets on reload.
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY);
  }

  function changed() {
    if (!edited) {
      edited = true;
      hooks.onEdited?.();
    }
    saveSoon();
    hooks.onChange?.();
  }

  /** Puts back what the visitor made of the page. Returns the saved page and static state. */
  function restore() {
    let data;
    try {
      data = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    } catch {
      data = null;
    }
    if (!data || data.seed !== seed || !Array.isArray(data.blocks)) return null;
    restoring = true;
    try {
      const built = data.blocks.map(buildBlock).filter(Boolean);
      // A static block the saved page doesn't mention stays where the seed had it.
      for (const el of statics.values()) if (!built.some((b) => b === el || b.contains(el))) built.push(el);
      root.replaceChildren(...built);
      if (typeof data.title === 'string' && data.title.trim()) title.innerHTML = sanitize(data.title);
      crumb.textContent = title.textContent;
      edited = true;
    } finally {
      restoring = false;
    }
    decorate();
    return data;
  }

  /** Clears the visitor's edits: back to the page as published. */
  function reset() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Nothing saved, nothing to clear.
    }
  }

  // ---------- Changing the document ----------

  function insertBefore(ref, el) {
    ref.before(el);
    decorate();
    changed();
    return el;
  }

  function insertAfter(ref, el, { quiet = false } = {}) {
    ref.after(el);
    decorate();
    if (quiet) saveSoon();
    else changed();
    return el;
  }

  function replace(old, el) {
    old.replaceWith(el);
    decorate();
    changed();
    return el;
  }

  function remove(el) {
    const kids = typeOf(el) === 'toggle' ? [...kidsOf(el).children] : [];
    el.after(...kids);
    el.remove();
    decorate();
    changed();
  }

  /** Turns a block into another type, keeping its id and words. */
  function convert(el, type) {
    if (typeOf(el) === type || !(TEXTY.has(type) || type === 'divider')) return el;
    const text = textOf(el);
    const fragment = document.createDocumentFragment();
    if (text) fragment.append(...text.childNodes);
    const kids = typeOf(el) === 'toggle' ? [...kidsOf(el).children] : [];
    const next = createBlock(type, {
      id: el.id, fragment, open: true, children: type === 'toggle' ? kids : [],
      checked: false, color: el.dataset.color, icon: el.dataset.icon,
    });
    if (el.dataset.short) next.dataset.short = el.dataset.short;
    el.replaceWith(next);
    if (type !== 'toggle') next.after(...kids);
    decorate();
    changed();
    return next;
  }

  function duplicate(el) {
    if (typeOf(el) === 'static' || types[typeOf(el)]) return null;
    const copy = buildBlock({ ...serializeBlock(el), id: newId('b') });
    if (!copy) return null;
    reId(copy);
    el.after(copy);
    decorate();
    changed();
    return copy;
  }

  function move(el, direction) {
    const sibling = direction < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sibling?.matches('.blk')) return false;
    if (direction < 0) sibling.before(el);
    else sibling.after(el);
    decorate();
    changed();
    return true;
  }

  // Invite hints, empty states and the numbering all follow the DOM.
  function decorate() {
    for (const text of root.querySelectorAll('.blk-text[contenteditable]')) syncEmpty(text);
    for (const el of root.querySelectorAll('.blk[data-invite]')) syncInvite(el);
    for (const list of [root, ...root.querySelectorAll('.blk-children')]) {
      let n = 0;
      for (const el of list.children) {
        n = typeOf(el) === 'numbered' ? n + 1 : 0;
        if (n) el.querySelector(':scope > .blk-row').dataset.num = String(n);
      }
    }
    hooks.onStructure?.();
  }

  function syncEmpty(text) {
    const empty = !text.textContent && !text.querySelector('img');
    if (empty && text.innerHTML) text.innerHTML = '';
    text.classList.toggle('is-empty', empty);
    const blk = blockOf(text);
    if (blk?.hasAttribute('data-invite')) syncInvite(blk);
  }

  function syncInvite(el) {
    const text = textOf(el);
    let hint = el.querySelector(':scope > .blk-row > .blk-invite');
    const show = text && !text.textContent;
    if (show && !hint) {
      hint = document.createElement('span');
      hint.className = 'blk-invite';
      hint.setAttribute('aria-hidden', 'true');
      hint.innerHTML = coarse.matches
        ? 'Tap here, type <kbd>/</kbd> and choose <b>Ask the team</b>'
        : 'Type <kbd>/</kbd> here and choose <b>Ask the team</b>';
      el.querySelector(':scope > .blk-row').append(hint);
      text.setAttribute('aria-label', 'Empty line. Type slash for blocks, or to ask the team.');
    } else if (!show && hint) {
      hint.remove();
      text.removeAttribute('aria-label');
    }
  }

  // ---------- Caret helpers ----------

  const selection = () => getSelection();
  const caret = () => (selection().rangeCount ? selection().getRangeAt(0) : null);

  function placeCaret(text, where = 'end') {
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(where === 'start');
    selection().removeAllRanges();
    selection().addRange(range);
  }

  function textBeforeCaret(text) {
    const range = caret();
    if (!range || !text.contains(range.startContainer)) return '';
    const before = document.createRange();
    before.selectNodeContents(text);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString();
  }

  function atEnd(text) {
    const range = caret();
    if (!range) return false;
    const after = document.createRange();
    after.selectNodeContents(text);
    after.setStart(range.endContainer, range.endOffset);
    return after.toString().length === 0;
  }

  function caretRect() {
    const range = caret();
    if (!range) return null;
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;
    const holder = blockOf(range.startContainer)?.querySelector('.blk-text') ?? range.startContainer.parentElement;
    const box = (holder ?? title).getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(holder ?? title).lineHeight) || 24;
    return new DOMRect(box.left + 2, box.top + 3, 1, lineHeight);
  }

  function focusBlock(el, where = 'end') {
    const text = el === title ? title : textOf(el);
    if (!text) {
      el.querySelector('[contenteditable], button, input, [tabindex]')?.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
      return;
    }
    text.focus({ preventScroll: true });
    placeCaret(text, where);
    text.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Slash menu ----------

  const menu = createSlashMenu({
    onPick: (item) => pickSlash(item),
    onClose: () => endSlash(),
    announce: (text) => hooks.announce?.(text),
    anchor: () => (slash?.text.isConnected ? caretRect() : null),
  });

  function startSlash(text) {
    const range = caret();
    if (!range) return;
    // The "/" sits right before the caret.
    const at = range.startContainer;
    if (at.nodeType !== Node.TEXT_NODE || range.startOffset < 1) return;
    slash = { text, node: at, offset: range.startOffset - 1 };
    text.setAttribute('aria-expanded', 'true');
    text.setAttribute('aria-controls', menu.id);
    text.setAttribute('aria-haspopup', 'listbox');
    menu.open(caretRect(), '');
  }

  function slashQuery() {
    if (!slash) return null;
    const range = caret();
    if (!range || !slash.node.isConnected || !slash.text.contains(range.startContainer)) return null;
    const span = document.createRange();
    try {
      span.setStart(slash.node, slash.offset);
      span.setEnd(range.startContainer, range.startOffset);
    } catch {
      return null;
    }
    const typed = span.toString();
    return typed.startsWith('/') ? typed.slice(1) : null;
  }

  function updateSlash() {
    const query = slashQuery();
    if (query === null || query.length > 24 || /\s\s/.test(query)) return menu.close();
    menu.update(query, caretRect());
  }

  function endSlash() {
    if (!slash) return;
    slash.text.removeAttribute('aria-expanded');
    slash.text.removeAttribute('aria-controls');
    slash.text.removeAttribute('aria-haspopup');
    slash.text.removeAttribute('aria-activedescendant');
    slash = null;
  }

  function pickSlash(item) {
    if (!slash) return;
    const { text } = slash;
    const blk = blockOf(text);
    // Remove "/query" from the line.
    const range = caret();
    try {
      const span = document.createRange();
      span.setStart(slash.node, slash.offset);
      span.setEnd(range.startContainer, range.startOffset);
      span.deleteContents();
    } catch {
      // The line changed under the menu; keep whatever is there.
    }
    menu.close();
    syncEmpty(text);
    const empty = !text.textContent;

    if (item.type === 'ask') {
      // An empty line becomes the question; otherwise it goes right below. On the
      // page's invite line, the question goes above it, and the invite stays for the next one.
      const invite = blk.hasAttribute('data-invite') && empty;
      hooks.onAsk?.({ block: blk, before: invite, replace: !invite && empty && TEXTY.has(typeOf(blk)) && !kidsOf(blk)?.children.length });
      return;
    }
    if (item.type === 'divider') {
      const divider = createBlock('divider');
      if (empty && typeOf(blk) === 'text') {
        blk.before(divider);
        focusBlock(blk, 'start');
      } else {
        const line = createBlock('text');
        blk.after(divider, line);
        focusBlock(line, 'start');
      }
      decorate();
      changed();
      return;
    }
    if (empty) focusBlock(convert(blk, item.type), 'start');
    else {
      const next = createBlock(item.type);
      insertAfter(blk, next);
      focusBlock(next, 'start');
    }
  }

  /** Opens the slash menu on a line, typing the "/" for the visitor (the + button, the phone bar). */
  function openSlashAt(el) {
    let target = el;
    if (!textOf(target) || types[typeOf(target)] || typeOf(target) === 'static') {
      target = insertAfter(el, createBlock('text'));
    } else if (textOf(target).textContent) {
      target = insertAfter(el, createBlock('text'));
    }
    const text = textOf(target);
    focusBlock(target, 'end');
    const node = document.createTextNode('/');
    text.append(node);
    const range = document.createRange();
    range.setStart(node, 1);
    range.collapse(true);
    selection().removeAllRanges();
    selection().addRange(range);
    syncEmpty(text);
    startSlash(text);
    return target;
  }

  /** The "/" key outside any text: start a line where the visitor is reading. */
  function insertAtReading() {
    const probe = innerHeight * 0.38;
    let pick = null;
    for (const blk of root.children) {
      if (!blk.matches('.blk')) continue;
      const rect = blk.getBoundingClientRect();
      if (rect.top > probe) break;
      pick = blk;
    }
    pick ??= root.querySelector(':scope > .blk');
    if (!pick) return;
    if (typeOf(pick) === 'text' && !textOf(pick)?.textContent) return openSlashAt(pick);
    openSlashAt(insertAfter(pick, createBlock('text')));
  }

  // ---------- Keyboard and input ----------

  function editableTarget(e) {
    const text = e.target.closest?.('.blk-text[contenteditable]');
    if (!text || !root.contains(text) || text.closest('.ask')) return null;
    return text;
  }

  root.addEventListener('beforeinput', (e) => {
    const text = editableTarget(e);
    if (!text) return;
    // Phones send Enter as an input, not a key: handle it the same way.
    if (e.inputType === 'insertParagraph') {
      e.preventDefault();
      if (menu.isOpen) menu.pick();
      else enter(text);
    }
  });

  root.addEventListener('input', (e) => {
    const text = editableTarget(e);
    if (!text) return;
    syncEmpty(text);
    if (slash) updateSlash();
    else if (e.inputType === 'insertText' && e.data?.endsWith('/')) {
      const before = textBeforeCaret(text);
      // A "/" at the start of a line or after a space opens the menu; "and/or" doesn't.
      if (before === '/' || /\s\/$/.test(before)) startSlash(text);
    }
    changed();
  });

  root.addEventListener('keydown', (e) => {
    const text = editableTarget(e);
    if (!text) return;
    if (menu.isOpen && slash?.text === text) {
      if (menu.handleKey(e)) return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !mod && !e.altKey) {
      e.preventDefault();
      enter(text);
    } else if (e.key === 'Backspace' && !mod && !e.altKey) {
      backspace(e, text);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && mod && e.shiftKey) {
      e.preventDefault();
      const blk = blockOf(text);
      if (move(blk, e.key === 'ArrowUp' ? -1 : 1)) {
        focusBlock(blk, 'end');
        hooks.announce?.(`Moved ${e.key === 'ArrowUp' ? 'up' : 'down'}`);
      }
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !mod && !e.altKey) {
      arrow(e, text);
    } else if (e.key === '/' && mod) {
      e.preventDefault();
      openBlockMenu(blockOf(text), caretRect());
    } else if (e.key === 'Escape') {
      text.blur();
    }
  });

  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = visibleTexts()[1];
      if (first) focusBlock(blockOf(first), 'start');
    } else if (e.key === 'ArrowDown') {
      const first = visibleTexts()[1];
      if (first && atEnd(title)) {
        e.preventDefault();
        focusBlock(blockOf(first), 'start');
      }
    }
  });
  title.addEventListener('input', () => {
    crumb.textContent = title.textContent.trim() || 'Untitled';
    changed();
  });

  function enter(text) {
    const blk = blockOf(text);
    const type = typeOf(blk);
    const range = caret();
    if (range && !range.collapsed) range.deleteContents();
    // An empty list item ends the list.
    if (LISTY.has(type) && !text.textContent) {
      focusBlock(convert(blk, 'text'), 'start');
      return;
    }
    // At the very start of a line, Enter opens an empty line above it.
    if (text.textContent && !textBeforeCaret(text).length) {
      blk.before(createBlock(LISTY.has(type) ? type : 'text'));
      decorate();
      changed();
      return;
    }
    if (type === 'toggle' && blk.dataset.open === 'true' && atEnd(text)) {
      const child = createBlock('text');
      kidsOf(blk).prepend(child);
      decorate();
      changed();
      focusBlock(child, 'start');
      return;
    }
    const tail = document.createRange();
    const at = caret();
    tail.setStart(at.endContainer, at.endOffset);
    tail.setEnd(text, text.childNodes.length);
    const fragment = tail.extractContents();
    syncEmpty(text);
    const nextType = LISTY.has(type) || type === 'toggle' ? type : 'text';
    const next = createBlock(nextType, { fragment: cleanFragment(fragment) });
    blk.after(next);
    decorate();
    changed();
    focusBlock(next, 'start');
  }

  function backspace(e, text) {
    const range = caret();
    if (!range || !range.collapsed || textBeforeCaret(text).length) return;
    const blk = blockOf(text);
    const type = typeOf(blk);
    e.preventDefault();
    if (type !== 'text') {
      // Start of a heading, list item or callout: it becomes plain text first.
      focusBlock(convert(blk, 'text'), 'start');
      return;
    }
    const texts = visibleTexts();
    const prevText = texts[texts.indexOf(text) - 1];
    const prevBlock = previousBlock(blk);
    if (prevBlock && typeOf(prevBlock) === 'divider') {
      remove(prevBlock);
      return;
    }
    if (!text.textContent) {
      if (blk.hasAttribute('data-invite') || !prevText) return;
      remove(blk);
      if (prevText === title) {
        title.focus();
        placeCaret(title, 'end');
      } else focusBlock(blockOf(prevText), 'end');
      return;
    }
    if (!prevText || prevText === title || blockOf(prevText) !== prevBlock) return;
    // Join this line to the end of the previous one.
    prevText.focus({ preventScroll: true });
    const join = document.createRange();
    join.selectNodeContents(prevText);
    join.collapse(false);
    const marker = document.createTextNode('');
    join.insertNode(marker);
    prevText.append(...text.childNodes);
    blk.remove();
    const at = document.createRange();
    at.setStartAfter(marker);
    at.collapse(true);
    selection().removeAllRanges();
    selection().addRange(at);
    marker.remove();
    prevText.normalize();
    decorate();
    changed();
  }

  function previousBlock(blk) {
    const list = blocks().filter((b) => b.offsetParent !== null);
    return list[list.indexOf(blk) - 1] ?? null;
  }

  function arrow(e, text) {
    const rect = caretRect();
    const box = text.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 24;
    const up = e.key === 'ArrowUp';
    const onEdge = up ? rect.top - box.top < lineHeight * 0.8 : box.bottom - rect.bottom < lineHeight * 0.8;
    if (!onEdge) return;
    const texts = visibleTexts();
    const next = texts[texts.indexOf(text) + (up ? -1 : 1)];
    if (!next) return;
    e.preventDefault();
    next.focus({ preventScroll: true });
    const target = next.getBoundingClientRect();
    const y = up ? target.bottom - lineHeight / 2 : target.top + lineHeight / 2 + 3;
    const point = caretAtPoint(Math.min(Math.max(rect.left, target.left + 1), target.right - 1), y);
    if (point && next.contains(point.startContainer)) {
      selection().removeAllRanges();
      selection().addRange(point);
    } else placeCaret(next, up ? 'end' : 'start');
    next.scrollIntoView({ block: 'nearest' });
  }

  root.addEventListener('paste', (e) => {
    const text = editableTarget(e);
    if (!text) return;
    e.preventDefault();
    const plain = e.clipboardData?.getData('text/plain') ?? '';
    const lines = plain.replace(/\r\n?/g, '\n').split('\n');
    insertPlain(lines.shift());
    let blk = blockOf(text);
    for (const line of lines) {
      const next = createBlock('text', { html: escapeHtml(line) });
      blk.after(next);
      blk = next;
    }
    if (lines.length) {
      decorate();
      focusBlock(blk, 'end');
    }
    syncEmpty(text);
    changed();
  });

  root.addEventListener('click', (e) => {
    const button = e.target.closest('.tgl');
    if (!button || !root.contains(button)) return;
    const blk = blockOf(button);
    setOpen(blk, blk.dataset.open !== 'true');
    changed();
  });

  root.addEventListener('change', (e) => {
    if (!e.target.matches('.todo-box')) return;
    blockOf(e.target).classList.toggle('is-done', e.target.checked);
    changed();
  });

  root.addEventListener('focusin', (e) => {
    const blk = blockOf(e.target);
    if (blk && root.contains(blk)) lastFocused = blk;
  });
  title.addEventListener('focusin', () => (lastFocused = null));

  // Links typed or pasted into the page open in a new tab, not in place of it.
  root.addEventListener('click', (e) => {
    const link = e.target.closest('.blk-text a[href]');
    if (!link || e.defaultPrevented) return;
    e.preventDefault();
    window.open(link.href, '_blank', 'noopener,noreferrer');
  });

  // ---------- The gutter: + to add below, ⋮⋮ to drag or open the block menu ----------

  const gutter = document.createElement('div');
  gutter.className = 'gutter';
  gutter.innerHTML = `
    <button class="g-plus" type="button" tabindex="-1" title="Click to add a block below" aria-label="Add a block below"><svg aria-hidden="true"><use href="#ui-plus"/></svg></button>
    <button class="g-drag" type="button" tabindex="-1" title="Drag to move, click for options" aria-label="Block options"><svg aria-hidden="true"><use href="#ui-drag"/></svg></button>`;
  page.append(gutter);
  let hovered = null;

  function showGutter(blk) {
    hovered = blk;
    if (!blk) return gutter.classList.remove('is-on');
    const pageBox = page.getBoundingClientRect();
    const row = blk.querySelector(':scope > .blk-row') ?? blk;
    const rowBox = row.getBoundingClientRect();
    const text = textOf(blk);
    let center;
    if (text) {
      const style = getComputedStyle(text);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      center = text.getBoundingClientRect().top + parseFloat(style.paddingTop) + lineHeight / 2;
    } else {
      center = rowBox.top + Math.min(rowBox.height / 2, 16);
    }
    gutter.style.left = `${rowBox.left - pageBox.left - 46}px`;
    gutter.style.top = `${center - pageBox.top - 12}px`;
    gutter.classList.add('is-on');
  }

  page.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || dragging) return;
    if (gutter.contains(e.target)) return;
    const body = root.getBoundingClientRect();
    if (e.clientY < body.top || e.clientY > body.bottom) return showGutter(null);
    const x = Math.min(Math.max(e.clientX, body.left + 6), body.right - 6);
    const under = document.elementFromPoint(x, e.clientY);
    const blk = under && root.contains(under) ? under.closest('.blk') : null;
    if (blk !== hovered) showGutter(blk);
  });
  page.addEventListener('pointerleave', () => !dragging && showGutter(null));

  gutter.querySelector('.g-plus').addEventListener('click', () => {
    if (hovered) openSlashAt(insertAfter(hovered, createBlock('text')));
  });

  // Drag to move; a click without moving opens the block menu.
  let dragging = null;
  const dragHandle = gutter.querySelector('.g-drag');
  dragHandle.addEventListener('pointerdown', (e) => {
    if (!hovered || e.button !== 0) return;
    e.preventDefault();
    const blk = hovered;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    let ghost = null;
    let line = null;
    let target = null;
    dragHandle.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      if (!moved) {
        moved = true;
        dragging = blk;
        blk.classList.add('is-dragged');
        document.querySelector('.kn')?.classList.add('is-dragging');
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = excerpt(blk, 60) || BLOCK_TITLES[typeOf(blk)] || 'Block';
        document.body.append(ghost);
        line = document.createElement('div');
        line.className = 'drop-line';
        page.append(line);
      }
      ghost.style.left = `${ev.clientX + 12}px`;
      ghost.style.top = `${ev.clientY - 12}px`;
      target = dropTarget(ev, blk);
      if (!target) return (line.hidden = true);
      const pageBox = page.getBoundingClientRect();
      const box = target.el.getBoundingClientRect();
      line.hidden = false;
      line.style.left = `${box.left - pageBox.left}px`;
      line.style.width = `${box.width}px`;
      line.style.top = `${(target.before ? box.top : box.bottom) - pageBox.top - 2}px`;
    };
    const onUp = () => {
      dragHandle.removeEventListener('pointermove', onMove);
      dragHandle.removeEventListener('pointerup', onUp);
      dragHandle.removeEventListener('pointercancel', onUp);
      if (!moved) {
        openBlockMenu(blk, dragHandle.getBoundingClientRect());
        return;
      }
      ghost?.remove();
      line?.remove();
      blk.classList.remove('is-dragged');
      document.querySelector('.kn')?.classList.remove('is-dragging');
      dragging = null;
      if (target) {
        if (target.before) target.el.before(blk);
        else target.el.after(blk);
        decorate();
        changed();
        flash(blk);
      }
      showGutter(null);
    };
    dragHandle.addEventListener('pointermove', onMove);
    dragHandle.addEventListener('pointerup', onUp);
    dragHandle.addEventListener('pointercancel', onUp);
  });

  function dropTarget(e, dragged) {
    const body = root.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, body.left + 6), body.right - 6);
    const under = document.elementFromPoint(x, e.clientY);
    const el = under && root.contains(under) ? under.closest('.blk') : null;
    if (!el || el === dragged || dragged.contains(el)) return null;
    // Above or below the block under the pointer, by which half it's in.
    const box = el.getBoundingClientRect();
    return { el, before: e.clientY < box.top + box.height / 2 };
  }

  // ---------- The block menu ----------

  function openBlockMenu(blk, anchor) {
    const type = typeOf(blk);
    const texty = TEXTY.has(type);
    const custom = types[type];
    const items = [
      { label: 'Ask the team about this', icon: 'ui-ask', run: () => hooks.onAskAbout?.({ block: blk, quote: excerpt(blk) }) },
      ...(custom?.menuItems?.(blk) ?? []),
      { separator: true },
      ...(texty ? [{ section: 'Turn into' }, ...['text', 'h2', 'h3', 'todo', 'bullet', 'numbered', 'toggle', 'quote', 'callout']
        .filter((t) => t !== type)
        .map((t) => ({ label: BLOCK_TITLES[t], icon: 'ui-turn', run: () => focusBlock(convert(blk, t), 'end') })), { separator: true }] : []),
      ...(texty || type === 'divider' ? [{ label: 'Duplicate', icon: 'ui-copy', run: () => duplicate(blk) }] : []),
      { label: 'Move up', icon: 'ui-up', hint: MAC ? '⌘⇧↑' : 'Ctrl+Shift+↑', run: () => move(blk, -1) && flash(blk) },
      { label: 'Move down', icon: 'ui-down', hint: MAC ? '⌘⇧↓' : 'Ctrl+Shift+↓', run: () => move(blk, 1) && flash(blk) },
      ...(type !== 'static' && !(custom && !custom.removable?.(blk)) ? [{ label: 'Delete', icon: 'ui-trash', danger: true, run: () => remove(blk) }] : []),
    ];
    openMenu({ items, anchor, label: `${BLOCK_TITLES[type] ?? 'Block'} options`, className: 'blockmenu', returnFocus: textOf(blk) ?? dragHandle });
  }

  // ---------- Selection toolbar ----------

  const toolbar = createToolbar({
    root,
    canFormat: (node) => Boolean(node && editableHost(node)),
    onAsk: ({ node, quote }) => {
      const blk = blockOf(node);
      if (blk) hooks.onAskAbout?.({ block: blk, quote, node });
    },
    onFormat: () => changed(),
  });

  function editableHost(node) {
    const el = node instanceof Element ? node : node.parentElement;
    const text = el?.closest('.blk-text[contenteditable]');
    return text && root.contains(text) && !text.closest('.ask') ? text : null;
  }

  // ---------- Revealing a block (from references in answers) ----------

  function reveal(id, { focus = true, light = true } = {}) {
    const el = document.getElementById(id);
    if (!el || !root.contains(el)) return false;
    for (let parent = el.parentElement?.closest('.blk[data-block="toggle"]'); parent; parent = parent.parentElement?.closest('.blk[data-block="toggle"]')) {
      if (parent.dataset.open !== 'true') setOpen(parent, true);
    }
    if (typeOf(el) === 'toggle' && el.dataset.open !== 'true') setOpen(el, true);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    if (light) flash(el);
    if (focus) {
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
      el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
    }
    save();
    return true;
  }

  function flash(el) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.classList.remove('is-flash', 'is-lit');
    void el.offsetWidth;
    if (reduce) {
      el.classList.add('is-lit');
      setTimeout(() => el.classList.remove('is-lit'), 1600);
    } else {
      el.classList.add('is-flash');
      el.addEventListener('animationend', () => el.classList.remove('is-flash'), { once: true });
    }
    return true;
  }

  // ---------- Setup ----------

  for (const text of root.querySelectorAll('.blk-text')) {
    if (text.closest('.blk[data-block="static"], .ask')) continue;
    makeEditable(text, typeOf(blockOf(text)));
  }
  title.contentEditable = 'true';
  title.spellcheck = true;
  decorate();

  return {
    createBlock,
    insertAfter,
    insertBefore,
    replace,
    remove,
    convert,
    blocks,
    textOf,
    blockOf,
    typeOf,
    headingFor,
    excerpt,
    focusBlock,
    openSlashAt,
    insertAtReading,
    reveal,
    flash,
    save,
    saveSoon,
    restore,
    reset,
    changed,
    setAsk: (info) => menu.setAsk(info),
    get current() {
      return lastFocused && root.contains(lastFocused) ? lastFocused : null;
    },
    closeMenus() {
      menu.close();
      toolbar.hide();
    },
  };
}

// ---------- Helpers ----------

function reId(el) {
  for (const node of [el, ...el.querySelectorAll('.blk')]) {
    const old = node.id;
    node.id = newId('b');
    for (const ref of node.querySelectorAll(`[id^="${old}-"]`)) ref.id = ref.id.replace(old, node.id);
    for (const ref of node.querySelectorAll('[aria-controls], [aria-labelledby]')) {
      for (const attr of ['aria-controls', 'aria-labelledby']) {
        if (ref.getAttribute(attr)?.startsWith(old)) ref.setAttribute(attr, ref.getAttribute(attr).replace(old, node.id));
      }
    }
  }
}

function caretAtPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return document.caretRangeFromPoint?.(x, y) ?? null;
}

function insertPlain(text) {
  if (!text) return;
  // insertText keeps the browser's undo history; the fallback keeps it working without.
  if (document.queryCommandSupported?.('insertText') && document.execCommand('insertText', false, text)) return;
  const range = getSelection().getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
}

// Browsers wrap split lines in divs; a block holds one run of inline text.
function cleanFragment(fragment) {
  const holder = document.createElement('div');
  holder.append(fragment);
  holder.innerHTML = sanitize(holder.innerHTML);
  const out = document.createDocumentFragment();
  out.append(...holder.childNodes);
  return out;
}

const INLINE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', A: 'a', BR: 'br' };

/** Keeps only inline formatting: bold, italic, underline, strike, code, links and line breaks. */
export function sanitize(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  const out = document.createElement('div');
  (function walk(from, to) {
    for (const node of from.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        to.append(node.data);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = INLINE[node.tagName];
        if (tag === 'br') {
          to.append(document.createElement('br'));
        } else if (tag === 'a') {
          const href = safeUrl(node.getAttribute('href'));
          if (!href) {
            walk(node, to);
            continue;
          }
          const a = document.createElement('a');
          a.href = href;
          a.rel = 'noopener noreferrer';
          a.target = '_blank';
          walk(node, a);
          to.append(a);
        } else if (tag) {
          const el = document.createElement(tag);
          walk(node, el);
          to.append(el);
        } else if (/^(DIV|P)$/.test(node.tagName) && to.childNodes.length) {
          to.append(document.createElement('br'));
          walk(node, to);
        } else {
          walk(node, to); // Unknown wrappers go; their words stay.
        }
      }
    }
  })(template.content, out);
  // A trailing <br> is the browser's placeholder for an empty line.
  while (out.lastChild?.nodeName === 'BR') out.lastChild.remove();
  return out.innerHTML;
}
