// Everything that floats above the tracker: the New issue composer, menus,
// the command menu, the shortcuts sheet, a confirm dialog, toasts and the
// issue preview card. Presentation only; app.js decides what they do.

import { ICONS, priorityIcon, statusIcon } from './icons.js';
import { LABELS, PRIORITIES, labelColor, labelName, priorityName, safeUrl, statusName } from './model.js';
import { MOD, animate, avatar, fill, h, keepInView, who } from './dom.js';
import { TEAM } from './seed.js';

const layer = () => document.querySelector('.tk-layer') ?? document.body.appendChild(h('div', { class: 'tk-layer' }));
// A popup that hands over to another one ("Change status…") passes on where focus goes back to.
// Hand-overs happen synchronously, so the target is only kept for this tick.
let handOver = null;
const passOn = (el) => {
  handOver = el;
  queueMicrotask(() => (handOver = null));
};
const returnTarget = () => {
  const active = document.activeElement;
  return active && active !== document.body ? active : handOver;
};
const isPhone = () => matchMedia('(max-width: 640px)').matches;
const focusable = (root) => [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  .filter((el) => !el.closest('[hidden]') && el.getClientRects().length);

// A modal dialog: traps Tab, closes on Esc and outside clicks, gives focus back.
class Modal {
  constructor({ label, className, onClose, role = 'dialog' }) {
    this.onClose = onClose;
    this.dialog = h('div', { class: `tk-dialog ${className}`, role, 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' });
    this.backdrop = h('div', { class: `tk-backdrop ${className}-backdrop`, hidden: true }, this.dialog);
    this.backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === this.backdrop) this.close();
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      } else if (event.key === 'Tab') {
        const items = focusable(this.dialog);
        if (!items.length) return;
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    layer().append(this.backdrop);
  }

  get isOpen() {
    return !this.backdrop.hidden;
  }

  show(focus) {
    if (!this.isOpen) {
      this.returnTo = returnTarget();
      this.backdrop.hidden = false;
      document.documentElement.classList.add('tk-modal-open');
      animate(this.backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      animate(this.dialog, isPhone() && this.sheet
        ? [{ transform: 'translateY(100%)' }, { transform: 'none' }]
        : [{ opacity: 0, transform: 'scale(.97) translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: isPhone() && this.sheet ? 280 : 180 });
    }
    (focus ?? this.dialog).focus({ preventScroll: true });
  }

  close({ restore = true } = {}) {
    if (!this.isOpen) return;
    const done = () => {
      this.backdrop.hidden = true;
      if (!document.querySelector('.tk-backdrop:not([hidden])')) document.documentElement.classList.remove('tk-modal-open');
    };
    const out = animate(this.dialog, isPhone() && this.sheet
      ? [{ transform: 'none' }, { transform: 'translateY(100%)' }]
      : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }], { duration: 140, easing: 'ease-in' });
    animate(this.backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 140 });
    if (out) out.finished.then(done, done);
    else done();
    if (restore && this.returnTo?.isConnected) this.returnTo.focus({ preventScroll: true });
    passOn(restore ? null : this.returnTo);
    this.onClose?.();
  }
}

// New issue -------------------------------------------------------------------

export class Composer extends Modal {
  constructor(on) {
    super({ label: 'New issue', className: 'tk-composer', onClose: () => on.close?.() });
    this.on = on; // { submit(fields), change(fields), retry(), newChat(), menu(kind, anchor, fields, set) }
    this.sheet = true;
    this.fields = { title: '', description: '', priority: 'none', labels: [], from: '' };
    this.titleInput = h('input', { class: 'tk-c-title', type: 'text', placeholder: 'Issue title', 'aria-label': 'Issue title: your question', maxlength: '160', autocomplete: 'off' });
    this.descInput = h('textarea', { class: 'tk-c-desc', rows: '3', placeholder: 'Add details, like your team size or current tracker…', 'aria-label': 'Description (optional)', maxlength: '1500' });
    this.priorityChip = h('button', { type: 'button', class: 'tk-chip', 'aria-haspopup': 'menu', title: 'Priority  P' });
    this.labelsChip = h('button', { type: 'button', class: 'tk-chip', 'aria-haspopup': 'menu', title: 'Labels  L' });
    this.info = h('div', { class: 'tk-c-info', role: 'status', hidden: true });
    this.submitButton = h('button', { type: 'submit', class: 'tk-btn tk-btn-primary tk-c-submit' }, h('span', { class: 'tk-btn-label', text: 'Create issue' }), h('kbd', { class: 'tk-kbd-mod', text: MOD === '⌘' ? '⌘↵' : 'Ctrl ↵' }));
    this.whoLine = h('div', { class: 'tk-c-who' });
    this.notice = h('p', { class: 'tk-c-notice', hidden: true });
    this.powered = h('a', { class: 'tk-powered', target: '_blank', rel: 'noopener noreferrer', hidden: true, text: 'Powered by Stand', onclick: () => on.attribution?.() });
    const form = h('form', { class: 'tk-c-form', novalidate: true },
      h('div', { class: 'tk-c-top' },
        h('span', { class: 'tk-c-team' }, h('span', { html: ICONS.team }), TEAM.key),
        h('span', { class: 'tk-crumb-sep', html: ICONS.chevronRight }),
        h('span', { class: 'tk-c-heading', text: 'New issue' }),
        h('span', { class: 'tk-grow' }),
        h('button', { type: 'button', class: 'tk-icon-btn', 'aria-label': 'Close (Esc)', title: 'Close  Esc', html: ICONS.close, onclick: () => this.close() })),
      h('div', { class: 'tk-c-body' }, this.titleInput, this.descInput),
      h('div', { class: 'tk-c-chips' },
        h('span', { class: 'tk-chip tk-chip-static', title: 'New questions land in Triage' }, h('span', { html: statusIcon('triage') }), 'Triage'),
        this.priorityChip, this.labelsChip),
      this.info,
      h('div', { class: 'tk-c-foot' }, this.whoLine, this.submitButton),
      h('div', { class: 'tk-c-meta' }, h('span', { class: 'tk-real' }, h('i', { class: 'tk-live-dot' }), (this.realText = h('span', { text: 'Real conversation · AI Stand-in via Stand' }))), this.powered),
      this.notice);
    this.dialog.append(form);
    this.form = form;

    const changed = () => {
      this.fields.title = this.titleInput.value;
      this.fields.description = this.descInput.value;
      this.on.change?.({ ...this.fields });
      this.#sync();
    };
    this.titleInput.addEventListener('input', changed);
    this.descInput.addEventListener('input', () => {
      changed();
      this.#grow();
    });
    this.titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.isComposing) {
        event.preventDefault();
        this.descInput.focus();
      }
    });
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.#submit();
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#submit();
    });
    this.priorityChip.addEventListener('click', () => this.#menu('priority'));
    this.labelsChip.addEventListener('click', () => this.#menu('labels'));
    this.dialog.addEventListener('keydown', (event) => {
      const field = event.target.closest?.('input, textarea');
      if (field || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'p' || event.key === 'l') {
        event.preventDefault();
        this.#menu(event.key === 'p' ? 'priority' : 'labels');
      }
    });
  }

  #menu(kind) {
    const anchor = kind === 'priority' ? this.priorityChip : this.labelsChip;
    this.on.menu(kind, anchor, this.fields, (value) => {
      this.fields[kind] = value;
      this.on.change?.({ ...this.fields });
      this.#chips();
    });
  }

  #grow() {
    this.descInput.style.height = 'auto';
    this.descInput.style.height = `${Math.min(Math.max(this.descInput.scrollHeight, 72), 220)}px`;
  }

  open(fields = {}) {
    this.fields = { title: '', description: '', priority: 'none', labels: [], from: 'the tracker at the top', ...fields };
    this.titleInput.value = this.fields.title;
    this.descInput.value = this.fields.description;
    this.#chips();
    this.show(this.titleInput);
    const end = this.titleInput.value.length;
    this.titleInput.setSelectionRange(end, end);
    requestAnimationFrame(() => this.#grow());
    this.#sync();
  }

  #chips() {
    const p = this.fields.priority;
    fill(this.priorityChip, h('span', { class: 'tk-prop-pr', html: priorityIcon(p) }), p === 'none' ? 'Priority' : priorityName(p));
    this.priorityChip.setAttribute('aria-label', `Priority: ${priorityName(p)}. How much does this block your switch?`);
    const labels = this.fields.labels;
    fill(this.labelsChip, ...(labels.length
      ? labels.map((id) => h('span', { class: 'tk-prop-label' }, h('i', { style: `background: ${labelColor(id)}` }), labelName(id)))
      : [h('span', { html: ICONS.tag }), 'Labels']));
    this.labelsChip.setAttribute('aria-label', `Labels: ${labels.map(labelName).join(', ') || 'none'}`);
  }

  /** What the client can do right now decides what the dialog offers. */
  render(env) {
    this.env = env;
    if (!this.isOpen) return;
    const host = env.host?.name ? env.host : null;
    fill(this.whoLine, ...(host && ['available', 'active'].includes(env.phase)
      ? [avatar(host, 18), h('span', {}, who(host), h('span', { class: 'tk-dim', text: env.phase === 'active' ? ' will pick this up' : ' picks up new issues' }))]
      : []));
    const url = safeUrl(env.poweredByUrl);
    this.powered.hidden = !url;
    if (url) this.powered.href = url;
    this.realText.textContent = env.host?.kind === 'rep' ? 'Real conversation · a person via Stand' : 'Real conversation · AI Stand-in via Stand';
    this.notice.hidden = !env.notice;
    this.notice.textContent = env.notice || '';
    this.#sync();
  }

  #infoKey = '';

  #sync() {
    const env = this.env ?? {};
    const lock = env.waitingOn;
    let info = null;
    let blocked = true;
    const action = (label, run, primary) => h('button', { type: 'button', class: `tk-btn${primary ? ' tk-btn-primary' : ''}`, text: label, onclick: run });
    if (env.phase === 'loading') info = ['wait', 'Checking who’s around to pick this up…'];
    else if (env.phase === 'unavailable') info = ['off', env.error === 'start' ? 'Your issue wasn’t filed: nobody could pick it up. Your text is still here.' : 'Nobody can pick up new issues right now.', ['Try again', () => this.on.retry()]];
    else if (env.phase === 'ended') info = ['off', 'Your last conversation has ended. Start a new one to file this.', ['Start a new conversation', () => this.on.newChat(), true]];
    else if (env.phase === 'uncertain') info = ['warn', 'We couldn’t confirm that your last issue reached the team. It may have started a conversation already.', ['Start a new conversation', () => this.on.newChat(), true]];
    else if (lock) info = ['wait', `Waiting for the answer on ${lock}. You can file this once it lands.`];
    else if (env.busy) info = ['wait', 'Filing…'];
    else blocked = false;
    // Rebuilt only when it changes: typing must not take focus off its button.
    const key = info ? `${info[0]}|${info[1]}` : '';
    if (key !== this.#infoKey) {
      this.#infoKey = key;
      const hadFocus = this.info.contains(document.activeElement);
      fill(this.info, ...(info ? [h('i', { class: 'tk-presence-dot', dataset: { tone: info[0] } }), h('span', { text: info[1] }), info[2] ? action(...info[2]) : null] : []));
      this.info.hidden = !info;
      // Its button did its job (Try again, Start a new conversation): back to the words.
      if (hadFocus) (this.info.querySelector('button') ?? this.titleInput).focus({ preventScroll: true });
    }
    this.submitButton.disabled = blocked || !this.titleInput.value.trim();
  }

  #submit() {
    this.#sync();
    if (this.submitButton.disabled) {
      if (!this.titleInput.value.trim()) this.titleInput.focus();
      return;
    }
    this.on.submit({ ...this.fields, title: this.titleInput.value.trim(), description: this.descInput.value.trim() });
  }
}

// Menus -------------------------------------------------------------------------

/**
 * A dropdown menu for status, priority, labels and views. One keyboard model:
 * arrows, Home/End, Enter or Space, number shortcuts, first-letter typeahead.
 */
export class Menu {
  static current = null;

  static open(options) {
    Menu.current?.close({ restore: false });
    Menu.current = new Menu(options);
    return Menu.current;
  }

  constructor({ anchor, title, items, multi = false, onSelect, onClose, label }) {
    this.anchor = anchor;
    this.items = items;
    this.multi = multi;
    this.onSelect = onSelect;
    this.onClose = onClose;
    this.returnTo = returnTarget();
    this.el = h('div', { class: 'tk-menu', role: 'menu', tabindex: '-1', 'aria-label': label ?? title ?? 'Menu' },
      title ? h('p', { class: 'tk-menu-title', text: title }) : null,
      items.map((item, i) => item.separator
        ? h('div', { class: 'tk-menu-sep', role: 'separator' })
        : h('div', {
          class: `tk-menu-item${item.danger ? ' is-danger' : ''}`, id: `tk-mi-${i}`, dataset: { index: String(i) },
          role: multi ? 'menuitemcheckbox' : item.checked === undefined ? 'menuitem' : 'menuitemradio',
          'aria-checked': item.checked === undefined ? null : String(Boolean(item.checked)),
          'aria-disabled': item.disabled ? 'true' : null,
          onclick: () => this.#pick(i),
          onpointermove: () => this.#highlight(i),
        },
        item.icon ? h('span', { class: 'tk-menu-icon', html: item.icon }) : item.color ? h('span', { class: 'tk-menu-icon' }, h('i', { class: 'tk-dot', style: `background: ${item.color}` })) : null,
        h('span', { class: 'tk-menu-label', text: item.label }),
        multi || item.checked ? h('span', { class: 'tk-menu-check', html: ICONS.check }) : null,
        item.kbd ? h('kbd', { text: item.kbd }) : null)));
    this.el.addEventListener('keydown', (event) => this.#keys(event));
    this.el.addEventListener('focusout', (event) => {
      if (!this.el.contains(event.relatedTarget) && event.relatedTarget !== null) this.close({ restore: false });
    });
    this.outside = (event) => {
      if (!this.el.contains(event.target) && !anchor?.contains(event.target)) this.close({ restore: false });
    };
    document.addEventListener('pointerdown', this.outside, true);
    layer().append(this.el);
    place(this.el, anchor);
    animate(this.el, [{ opacity: 0, transform: 'translateY(-4px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 140 });
    const start = Math.max(0, items.findIndex((item) => item.checked && !item.separator));
    this.#highlight(items[start]?.separator ? 1 : start);
    this.el.focus({ preventScroll: true });
  }

  #enabled() {
    return this.items.map((item, i) => (item.separator || item.disabled ? -1 : i)).filter((i) => i >= 0);
  }

  #highlight(i) {
    this.index = i;
    for (const el of this.el.querySelectorAll('.tk-menu-item')) el.classList.toggle('is-highlighted', Number(el.dataset.index) === i);
    const el = this.el.querySelector(`#tk-mi-${i}`);
    if (el) {
      this.el.setAttribute('aria-activedescendant', el.id);
      keepInView(this.el, el);
    }
  }

  #keys(event) {
    const enabled = this.#enabled();
    const at = enabled.indexOf(this.index);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.#highlight(enabled[(at + step + enabled.length) % enabled.length]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      this.#highlight(event.key === 'Home' ? enabled[0] : enabled.at(-1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.index >= 0) this.#pick(this.index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.close();
    } else if (/^\d$/.test(event.key)) {
      const i = this.items.findIndex((item) => item.kbd === event.key);
      if (i >= 0) {
        event.preventDefault();
        this.#pick(i);
      }
    } else if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey) {
      const letter = event.key.toLowerCase();
      const next = enabled.find((i) => enabled.indexOf(i) > at && this.items[i].label.toLowerCase().startsWith(letter))
        ?? enabled.find((i) => this.items[i].label.toLowerCase().startsWith(letter));
      if (next !== undefined) {
        event.preventDefault();
        this.#highlight(next);
      }
    }
  }

  #pick(i) {
    const item = this.items[i];
    if (!item || item.separator || item.disabled) return;
    if (this.multi) {
      item.checked = !item.checked;
      const el = this.el.querySelector(`#tk-mi-${i}`);
      el.setAttribute('aria-checked', String(item.checked));
      this.#highlight(i);
      this.onSelect?.(item, this.items.filter((other) => other.checked).map((other) => other.id));
      return;
    }
    this.close({ restore: !item.keepFocus });
    this.onSelect?.(item);
  }

  close({ restore = true } = {}) {
    if (!this.el.isConnected) return;
    document.removeEventListener('pointerdown', this.outside, true);
    this.el.remove();
    if (Menu.current === this) Menu.current = null;
    if (restore && this.returnTo?.isConnected) this.returnTo.focus({ preventScroll: true });
    passOn(restore ? null : this.returnTo);
    this.onClose?.();
  }
}

export function statusItems(current) {
  return ['backlog', 'todo', 'triage', 'progress', 'review', 'done', 'canceled'].map((id, i) => ({ id, label: statusName(id), icon: statusIcon(id), checked: id === current, kbd: String(i + 1) }));
}

export function priorityItems(current) {
  return PRIORITIES.map((p) => ({ id: p.id, label: p.name, icon: `<span class="tk-prop-pr">${priorityIcon(p.id)}</span>`, checked: p.id === current, kbd: p.key }));
}

export function labelItems(current = []) {
  return LABELS.map((l) => ({ id: l.id, label: l.name, color: l.color, checked: current.includes(l.id) }));
}

// Places a floating element next to its anchor, inside the viewport.
export function place(el, anchor, { gap = 6 } = {}) {
  el.style.position = 'fixed';
  el.style.left = '0px';
  el.style.top = '0px';
  const a = anchor?.getBoundingClientRect?.() ?? { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 3, bottom: innerHeight / 3, width: 0 };
  const r = el.getBoundingClientRect();
  let left = Math.min(Math.max(8, a.left), innerWidth - r.width - 8);
  let top = a.bottom + gap;
  if (top + r.height > innerHeight - 8 && a.top - gap - r.height > 8) top = a.top - gap - r.height;
  top = Math.min(Math.max(8, top), Math.max(8, innerHeight - r.height - 8));
  left = Math.max(8, left);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

// Command menu ---------------------------------------------------------------------

/** ⌘K: every action and every issue, one search away. */
export class CommandMenu extends Modal {
  constructor() {
    super({ label: 'Command menu', className: 'tk-command' });
    this.input = h('input', { class: 'tk-cmd-input', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'tk-cmd-list', 'aria-autocomplete': 'list', placeholder: 'Type a command or search issues…', autocomplete: 'off', spellcheck: 'false' });
    this.context = h('div', { class: 'tk-cmd-context', hidden: true });
    this.list = h('div', { class: 'tk-cmd-list', id: 'tk-cmd-list', role: 'listbox', 'aria-label': 'Commands' });
    this.dialog.append(this.context, h('div', { class: 'tk-cmd-field' }, h('span', { html: ICONS.search }), this.input), this.list,
      h('div', { class: 'tk-cmd-foot' }, h('span', {}, h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), ' to move'), h('span', {}, h('kbd', { text: '↵' }), ' to run'), h('span', {}, h('kbd', { text: 'esc' }), ' to close')));
    this.input.addEventListener('input', () => this.#filter());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const n = this.visible.length;
        if (n) this.#highlight((this.index + (event.key === 'ArrowDown' ? 1 : -1) + n) % n);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.#run(this.visible[this.index]);
      }
    });
  }

  /** items: [{ id, label, group, icon, kbd, run, keywords }], context: { id, title } */
  open(items, context) {
    this.items = items;
    this.context.hidden = !context;
    if (context) fill(this.context, h('span', { html: statusIcon(context.status) }), h('span', { class: 'tk-mono', text: context.id }), h('span', { class: 'tk-cmd-context-title', text: context.title }));
    this.input.value = '';
    this.#filter();
    this.show(this.input);
  }

  #filter() {
    const q = this.input.value.trim().toLowerCase();
    const match = (item) => !q || `${item.label} ${item.keywords ?? ''}`.toLowerCase().includes(q);
    this.visible = this.items.filter((item) => (item.group === 'Issues' ? q && match(item) : match(item)));
    const groups = [...new Set(this.visible.map((item) => item.group))];
    fill(this.list, ...groups.flatMap((group) => [
      h('p', { class: 'tk-cmd-group', role: 'presentation', text: group }),
      ...this.visible.filter((item) => item.group === group).map((item) => h('div', {
        class: 'tk-cmd-item', role: 'option', id: `tk-cmd-${this.visible.indexOf(item)}`, 'aria-selected': 'false',
        onclick: () => this.#run(item), onpointermove: () => this.#highlight(this.visible.indexOf(item)),
      }, h('span', { class: 'tk-cmd-icon', html: item.icon ?? '' }), h('span', { class: 'tk-cmd-label', text: item.label }), item.meta ? h('span', { class: 'tk-cmd-meta', text: item.meta }) : null, item.kbd ? h('span', { class: 'tk-cmd-kbd' }, item.kbd.split(' ').map((k) => h('kbd', { text: k }))) : null)),
    ]));
    // Keep the rows in visual order for the arrow keys.
    this.visible = groups.flatMap((group) => this.visible.filter((item) => item.group === group));
    this.list.querySelectorAll('.tk-cmd-item').forEach((el, i) => (el.id = `tk-cmd-${i}`));
    if (!this.visible.length) this.list.append(h('p', { class: 'tk-cmd-empty', text: 'No matching commands or issues' }));
    this.#highlight(0);
  }

  #highlight(i) {
    this.index = i;
    this.list.querySelectorAll('.tk-cmd-item').forEach((el, n) => {
      el.classList.toggle('is-highlighted', n === i);
      el.setAttribute('aria-selected', String(n === i));
      if (n === i) {
        this.input.setAttribute('aria-activedescendant', el.id);
        keepInView(this.list, el);
      }
    });
    if (!this.visible.length) this.input.removeAttribute('aria-activedescendant');
  }

  #run(item) {
    if (!item) return;
    this.close({ restore: !item.keepFocus });
    item.run();
  }
}

// Keyboard shortcuts ------------------------------------------------------------------

export class Shortcuts extends Modal {
  constructor() {
    super({ label: 'Keyboard shortcuts', className: 'tk-shortcuts' });
    const row = (keys, label) => h('li', {}, h('span', { text: label }), h('span', { class: 'tk-keys' }, keys.map((k) => h('kbd', { text: k }))));
    this.dialog.append(
      h('div', { class: 'tk-sheet-head' }, h('h2', { text: 'Keyboard shortcuts' }), h('button', { type: 'button', class: 'tk-icon-btn', 'aria-label': 'Close (Esc)', html: ICONS.close, onclick: () => this.close() })),
      h('div', { class: 'tk-sheet-body' },
        h('h3', { text: 'Anywhere on this page' }),
        h('ul', {}, row(['C'], 'New issue'), row([MOD, 'K'], 'Command menu'), row(['?'], 'Keyboard shortcuts')),
        h('h3', { text: 'In the tracker' }),
        h('ul', {}, row(['J'], 'Next issue'), row(['K'], 'Previous issue'), row(['↑', '↓'], 'Move in the list'), row(['↵'], 'Open issue'), row(['Esc'], 'Close issue or dialog')),
        h('h3', { text: 'On an issue' }),
        h('ul', {}, row(['S'], 'Change status'), row(['P'], 'Change priority'), row(['L'], 'Change labels'), row(['↵'], 'Send comment'), row(['⇧', '↵'], 'New line')),
        h('h3', { text: 'New issue' }),
        h('ul', {}, row([MOD, '↵'], 'Create issue'), row(['Esc'], 'Close, keeping your draft')),
        h('p', { class: 'tk-sheet-note', text: 'Status, priority and label changes stay on this page. Axial’s team sees the priority and labels you file an issue with.' })));
  }

  open() {
    this.show();
  }
}

// Confirm -----------------------------------------------------------------------

export class Confirm extends Modal {
  constructor() {
    super({ label: 'Confirm', className: 'tk-confirm', role: 'alertdialog' });
  }

  open({ title, text, confirm, cancel = 'Cancel', danger = true }) {
    return new Promise((resolve) => {
      const decide = (yes) => {
        this.onClose = null;
        this.close();
        resolve(yes);
      };
      this.onClose = () => resolve(false);
      const yes = h('button', { type: 'button', class: `tk-btn ${danger ? 'tk-btn-danger' : 'tk-btn-primary'}`, text: confirm, onclick: () => decide(true) });
      this.dialog.setAttribute('aria-labelledby', 'tk-confirm-title');
      this.dialog.setAttribute('aria-describedby', 'tk-confirm-text');
      fill(this.dialog, 
        h('h2', { id: 'tk-confirm-title', text: title }),
        h('p', { id: 'tk-confirm-text', text }),
        h('div', { class: 'tk-confirm-actions' }, h('button', { type: 'button', class: 'tk-btn', text: cancel, onclick: () => decide(false) }), yes));
      this.show(yes);
    });
  }
}

// Toasts --------------------------------------------------------------------------

export class Toasts {
  constructor() {
    this.el = h('div', { class: 'tk-toasts', role: 'region', 'aria-label': 'Notifications' });
    layer().append(this.el);
  }

  show({ icon, title, text, action, timeout = 6000 }) {
    const toast = h('div', { class: 'tk-toast' },
      icon ? h('span', { class: 'tk-toast-icon', html: icon }) : null,
      h('div', { class: 'tk-toast-text' }, h('b', { text: title }), text ? h('span', { text }) : null),
      action ? h('button', { type: 'button', class: 'tk-btn tk-toast-action', text: action.label, onclick: () => {
        dismiss();
        action.run();
      } }) : null,
      h('button', { type: 'button', class: 'tk-icon-btn tk-toast-close', 'aria-label': 'Dismiss', html: ICONS.close, onclick: () => dismiss() }));
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      const out = animate(toast, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px)' }], { duration: 160, easing: 'ease-in' });
      if (out) out.finished.then(() => toast.remove(), () => toast.remove());
      else toast.remove();
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(dismiss, timeout);
    };
    toast.addEventListener('pointerenter', () => clearTimeout(timer));
    toast.addEventListener('pointerleave', arm);
    toast.addEventListener('focusin', () => clearTimeout(timer));
    toast.addEventListener('focusout', arm);
    this.el.append(toast);
    while (this.el.children.length > 3) this.el.firstElementChild.remove();
    animate(toast, [{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
    arm();
    return dismiss;
  }
}

// Issue preview ------------------------------------------------------------------------

/** The card that shows an issue when you hover or focus a mention of it. */
export class Preview {
  constructor() {
    this.el = h('div', { class: 'tk-preview', 'aria-hidden': 'true', hidden: true });
    layer().append(this.el);
  }

  show(anchor, issue) {
    clearTimeout(this.timer);
    if (!anchor || !issue) {
      this.timer = setTimeout(() => (this.el.hidden = true), 120);
      return;
    }
    const answer = issue.feed.find((item) => item.kind === 'comment' && !item.mine);
    fill(this.el, 
      h('div', { class: 'tk-preview-head' }, h('span', { html: statusIcon(issue.status) }), h('span', { class: 'tk-mono', text: issue.id }), h('span', { class: 'tk-dim', text: statusName(issue.status) }),
        h('span', { class: 'tk-grow' }), h('span', { class: 'tk-prop-pr', html: priorityIcon(issue.priority) })),
      h('p', { class: 'tk-preview-title', text: issue.title }),
      answer ? h('p', { class: 'tk-preview-text', text: answer.text.replace(/\*\*|`/g, '').split('\n')[0] }) : issue.description ? h('p', { class: 'tk-preview-text', text: issue.description }) : null,
      h('div', { class: 'tk-preview-foot' }, issue.assignee ? [avatar(issue.assignee, 16), who(issue.assignee, { strong: false })] : null,
        h('span', { class: 'tk-grow' }), issue.labels.map((id) => h('span', { class: 'tk-pill' }, h('i', { style: `background: ${labelColor(id)}` }), labelName(id)))));
    const wasHidden = this.el.hidden;
    this.el.hidden = false;
    place(this.el, anchor, { gap: 8 });
    if (wasHidden) animate(this.el, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 140 });
  }

  hide() {
    clearTimeout(this.timer);
    this.el.hidden = true;
  }
}
