// The tracker: draws the issue model as a small issue tracker (a sidebar, a
// list grouped by status, and the open issue with its activity) and reports
// what the visitor does. It knows nothing about Stand; app.js turns intents
// into client calls and hands every change back through render().

import { ICONS, LOGO, priorityIcon, statusIcon } from './icons.js';
import { CLOSED, STATUSES, labelColor, labelName, priorityName, safeUrl, statusName } from './model.js';
import { MOD, animate, avatar, fill, h, keepInView, reconcile, reducedMotion, refreshTimes, richText, shortDate, timeEl, who } from './dom.js';
import { TEAM } from './seed.js';

const VIEWS = {
  issues: { name: 'Issues', icon: 'issues' },
  triage: { name: 'Triage', icon: 'triage' },
  mine: { name: 'My issues', icon: 'mine' },
  inbox: { name: 'Inbox', icon: 'inbox' },
};

// How far each status's pie is filled (stroke-dasharray out of 100).
const FILL = { triage: 0, backlog: 0, todo: 0, progress: 50, review: 75, done: 100, canceled: 100 };
// A new issue shows each step of its pickup for at least this long.
const HOLD = { triage: 750, progress: 900 };
const SAVED_VIEWS = [['migration', 'Migration plan'], ['security', 'Security review'], ['pricing', 'Pricing questions']];
// What the empty Triage row suggests asking.
const GHOST = ['Ask anything about switching…', 'Can we keep our story points?', 'Is SSO included in Standard?', 'Do attachments come along too?', 'Can we move one team at a time?'];

export class Tracker {
  #shown = new Map(); // issue id -> { status, since }: the pace of the pickup
  #held = new Set(); // reply keys waiting for their moment
  #timer = 0;
  #last = null; // the latest render arguments
  #first = true;
  #rows = new Map(); // issue id -> row element
  #openId = null;
  #announced = new Set();
  #visibleIds = [];

  constructor(root, on) {
    this.root = root;
    this.on = on;
    this.#build();
    setInterval(() => refreshTimes(this.root), 30000);
  }

  /** The issue the keyboard is on: the list's cursor, or the open issue. */
  get focused() {
    const active = this.active === 'ghost' ? null : this.active;
    return this.list.contains(document.activeElement) || !this.#openId ? active ?? this.#openId : this.#openId;
  }

  #build() {
    this.root.classList.add('tk');
    this.root.innerHTML = '';
    const nav = (view) => h('button', { type: 'button', class: 'tk-nav-item', dataset: { view }, onclick: () => this.on.view(view) },
      h('span', { class: 'tk-nav-icon', html: ICONS[VIEWS[view].icon] }),
      h('span', { class: 'tk-nav-label', text: VIEWS[view].name }),
      h('span', { class: 'tk-count', dataset: { count: view } }));

    this.side = h('div', { class: 'tk-side' },
      h('div', { class: 'tk-ws' },
        h('span', { class: 'tk-ws-name' }, h('span', { class: 'tk-ws-logo', html: LOGO }), 'Axial', h('span', { class: 'tk-ws-chev', html: ICONS.chevronDown })),
        h('button', { type: 'button', class: 'tk-icon-btn', 'aria-label': 'Search and commands', title: `Search and commands  ${MOD}K`, html: ICONS.search, onclick: (e) => this.on.command(e.currentTarget) }),
        h('button', { type: 'button', class: 'tk-icon-btn tk-compose', 'aria-label': 'New issue', title: 'New issue  C', html: ICONS.compose, onclick: () => this.on.newIssue('the tracker at the top') })),
      h('nav', { class: 'tk-nav', 'aria-label': 'Views' },
        nav('inbox'), nav('mine'),
        h('p', { class: 'tk-nav-head' }, h('span', { html: ICONS.team }), TEAM.name),
        nav('triage'), nav('issues'),
        // Saved views: the team's label filters, one click away.
        h('p', { class: 'tk-nav-head' }, 'Views'),
        SAVED_VIEWS.map(([label, name]) => h('button', { type: 'button', class: 'tk-nav-item', dataset: { label }, onclick: () => this.on.label(label) },
          h('span', { class: 'tk-nav-icon' }, h('i', { class: 'tk-dot', style: `background: ${labelColor(label)}` })),
          h('span', { class: 'tk-nav-label', text: name })))),
      (this.presence = h('div', { class: 'tk-presence', role: 'status' })));

    this.viewName = h('span', { class: 'tk-view-name' });
    this.filterChip = h('button', { type: 'button', class: 'tk-filter', hidden: true, onclick: () => this.on.label(null) });
    this.headPresence = h('div', { class: 'tk-presence tk-presence-inline', role: 'status' });
    this.list = h('div', { class: 'tk-list', role: 'listbox', tabindex: '0', 'aria-label': 'Issues' });
    this.main = h('section', { class: 'tk-main', 'aria-label': 'Issue list' },
      h('header', { class: 'tk-head' },
        h('button', { type: 'button', class: 'tk-crumb', 'aria-haspopup': 'menu', onclick: (e) => this.on.viewMenu(e.currentTarget) },
          h('span', { html: ICONS.team }), h('span', { class: 'tk-crumb-team', text: TEAM.name }),
          h('span', { class: 'tk-crumb-sep', html: ICONS.chevronRight }), this.viewName,
          h('span', { class: 'tk-crumb-chev', html: ICONS.chevronDown })),
        this.filterChip,
        h('span', { class: 'tk-grow' }),
        h('button', { type: 'button', class: 'tk-icon-btn tk-head-search', 'aria-label': 'Search and commands', html: ICONS.search, onclick: (e) => this.on.command(e.currentTarget) }),
        h('button', { type: 'button', class: 'tk-btn tk-btn-new', 'aria-label': 'New issue', title: 'New issue  C', onclick: () => this.on.newIssue('the tracker at the top') },
          h('span', { html: ICONS.plus }), h('span', { class: 'tk-btn-label', text: 'New issue' }), h('kbd', { text: 'C' }))),
      this.headPresence,
      this.list);

    this.issue = h('section', { class: 'tk-issue', 'aria-labelledby': 'tk-issue-title', hidden: true });
    this.root.append(this.side, h('div', { class: 'tk-body' }, this.main, this.issue));
    this.#buildIssue();
    this.#listKeys();
  }

  // The list ------------------------------------------------------------------

  #listKeys() {
    this.list.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.move(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        this.#setActive(event.key === 'Home' ? this.#visibleIds[0] : this.#visibleIds.at(-1), { reveal: true });
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (this.active === 'ghost') this.on.newIssue('the tracker at the top');
        else if (this.active) this.on.open(this.active, { focus: true });
      }
    });
    // A click focuses the list too; only keyboard focus may scroll it.
    let pointer = false;
    this.list.addEventListener('pointerdown', () => {
      pointer = true;
      setTimeout(() => (pointer = false), 400);
    });
    this.list.addEventListener('focus', () => {
      if (!this.active || !this.#visibleIds.includes(this.active)) this.#setActive(this.#openId && this.#visibleIds.includes(this.#openId) ? this.#openId : this.#visibleIds[0], { reveal: !pointer });
    });
  }

  /** J/K and the arrows: move the cursor, and follow it with the open issue. */
  move(step) {
    const ids = this.#visibleIds;
    if (!ids.length) return;
    const from = ids.indexOf(this.active ?? this.#openId);
    const next = ids[Math.min(ids.length - 1, Math.max(0, from < 0 ? 0 : from + step))];
    this.#setActive(next, { reveal: true });
    if (next !== 'ghost' && this.#openId && this.#openId !== next && this.#last?.env.layout !== 'compact') this.on.open(next, { focus: false });
  }

  #setActive(id, { reveal = false } = {}) {
    this.active = id ?? null;
    for (const row of this.list.querySelectorAll('[role="option"]')) {
      const on = row.dataset.key === id;
      row.classList.toggle('is-active', on);
      row.setAttribute('aria-selected', String(on));
      if (on) {
        this.list.setAttribute('aria-activedescendant', row.id);
        if (reveal) keepInView(this.list, row, { top: 36 });
      }
    }
    if (!id) this.list.removeAttribute('aria-activedescendant');
  }

  focusList() {
    this.list.focus({ preventScroll: true });
  }

  /** Where a menu for this issue should appear: its property chip, or its row. */
  anchorFor(id, kind) {
    if (this.#openId === id && !this.issue.hidden) {
      const chip = this.props.querySelector(`[data-prop="${kind}"]`);
      if (chip?.getClientRects().length) return chip;
    }
    const row = this.#rows.get(id);
    return row?.getClientRects().length ? row : this.list;
  }

  #renderList(model, ui, env, display) {
    const filtered = display.filter((issue) => {
      if (ui.label && !issue.labels.includes(ui.label)) return false;
      if (ui.view === 'mine') return issue.source !== 'seed';
      if (ui.view === 'triage') return issue.status === 'triage';
      if (ui.view === 'inbox') return issue.source !== 'seed' && issue.unread > 0;
      return true;
    });
    const order = (a, b) => (a.source === 'seed') - (b.source === 'seed') || (a.source === 'seed' ? a.number - b.number : b.updated - a.updated);
    const items = [];
    for (const { id: status, name } of STATUSES) {
      const issues = filtered.filter((issue) => issue.status === status).sort(order);
      const ghost = status === 'triage' && ui.view === 'issues' && !ui.label && !issues.length;
      if (!issues.length && !ghost) continue;
      items.push({ type: 'group', key: `group-${status}`, status, name, count: issues.length });
      for (const issue of issues) items.push({ type: 'row', key: issue.id, issue });
      if (ghost) items.push({ type: 'ghost', key: 'ghost' });
    }
    if (!items.length) items.push({ type: 'empty', key: `empty-${ui.view}-${ui.label ?? ''}` });
    this.#visibleIds = items.filter((item) => item.type === 'row' || item.type === 'ghost').map((item) => item.key);

    // Rows and group headers glide to their new places (FLIP); new ones fade in.
    const before = new Map();
    if (!this.#first && !reducedMotion()) for (const el of this.list.children) if (el.dataset.key) before.set(el.dataset.key, el.getBoundingClientRect().top);

    const added = reconcile(this.list, items, (item) => item.key, (item) => {
      if (item.type === 'group') return this.#groupEl(item);
      if (item.type === 'ghost') return this.#ghostEl();
      if (item.type === 'empty') return this.#emptyEl(ui);
      return this.#rows.get(item.key) ?? this.#rowEl(item.issue);
    }, (el, item) => {
      if (item.type === 'group') {
        el.querySelector('.tk-group-count').textContent = item.count ? String(item.count) : '';
      } else if (item.type === 'row') {
        this.#updateRow(el, item.issue, env);
      }
    });
    for (const el of added) {
      if (this.#first || before.has(el.dataset.key)) continue;
      if (el.classList.contains('tk-row') && !el.classList.contains('tk-ghost')) {
        // A new issue lands at the top of Triage.
        animate(el, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
        el.classList.add('is-landing');
        setTimeout(() => el.classList.remove('is-landing'), 1400);
      } else {
        animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 280 });
      }
    }
    for (const el of this.list.children) {
      const top = before.get(el.dataset.key);
      if (top === undefined) continue;
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) animate(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320 });
    }
    for (const [id, row] of this.#rows) if (!row.isConnected) this.#rows.delete(id);
    if (this.active && !this.#visibleIds.includes(this.active)) this.active = null;
    this.#setActive(this.active);
  }

  #groupEl(item) {
    return h('div', { class: 'tk-group', role: 'presentation', dataset: { status: item.status } },
      h('span', { class: 'tk-group-st', html: statusIcon(item.status) }),
      h('span', { class: 'tk-group-name', text: item.name }),
      h('span', { class: 'tk-group-count' }),
      h('span', { class: 'tk-grow' }),
      item.status === 'triage' ? h('button', { type: 'button', class: 'tk-icon-btn tk-group-add', tabindex: '-1', title: 'New issue  C', 'aria-hidden': 'true', html: ICONS.plus, onclick: () => this.on.newIssue('the tracker at the top') }) : null);
  }

  // The empty Triage row invites a question, and now and then suggests one.
  #ghostEl() {
    const text = h('span', { class: 'tk-ghost-text', text: GHOST[0] });
    const row = h('div', { class: 'tk-row tk-ghost', role: 'option', id: 'tk-row-ghost', 'aria-selected': 'false', 'aria-label': 'New issue: ask anything about switching',
      onclick: () => this.on.newIssue('the tracker at the top') },
    h('span', { class: 'tk-ghost-plus', html: ICONS.plus }),
    text,
    h('span', { class: 'tk-ghost-hint' }, 'New issue ', h('kbd', { text: 'C' })));
    if (reducedMotion()) return row;
    let i = 0;
    const timer = setInterval(() => {
      if (!row.isConnected) return clearInterval(timer);
      if (document.hidden || row.matches(':hover') || row.classList.contains('is-active')) return;
      i = (i + 1) % GHOST.length;
      const out = animate(text, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
      const swap = () => {
        text.textContent = GHOST[i];
        animate(text, [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 280 });
        out?.cancel();
      };
      if (out) out.finished.then(swap, swap);
      else swap();
    }, 5000);
    return row;
  }

  #emptyEl(ui) {
    const copy = ui.label
      ? ['No issues with this label', 'Clear the filter to see everything.']
      : {
        mine: ['Nothing filed yet', 'Everything you ask lands here, with its answers.'],
        triage: ['Triage is clear', 'New questions land here first, until someone picks them up.'],
        inbox: ['You’re all caught up', 'Replies to your issues show up here.'],
      }[ui.view] ?? ['No issues', ''];
    return h('div', { class: 'tk-empty', role: 'presentation' },
      h('span', { class: 'tk-empty-icon', html: ICONS[ui.label ? 'tag' : VIEWS[ui.view]?.icon ?? 'issues'] }),
      h('p', { class: 'tk-empty-title', text: copy[0] }),
      h('p', { class: 'tk-empty-text', text: copy[1] }),
      ui.label
        ? h('button', { type: 'button', class: 'tk-btn', text: 'Clear filter', onclick: () => this.on.label(null) })
        : h('button', { type: 'button', class: 'tk-btn', onclick: () => this.on.newIssue('the tracker at the top') }, 'New issue ', h('kbd', { text: 'C' })));
  }

  #rowEl(issue) {
    const row = h('div', { class: 'tk-row', role: 'option', id: `tk-row-${issue.id}`, 'aria-selected': 'false', dataset: { key: issue.id },
      onclick: () => {
        this.#setActive(issue.id);
        this.on.open(issue.id, { focus: true });
      } },
    h('span', { class: 'tk-row-pr' }),
    h('span', { class: 'tk-row-id tk-mono', text: issue.id }),
    h('span', { class: 'tk-row-st', html: statusIcon(issue.status) }),
    h('span', { class: 'tk-row-title' }),
    h('span', { class: 'tk-row-dot', title: 'New reply' }),
    h('span', { class: 'tk-row-labels' }),
    h('span', { class: 'tk-row-av' }),
    h('span', { class: 'tk-row-date' }));
    this.#rows.set(issue.id, row);
    return row;
  }

  #updateRow(row, issue, env) {
    row.classList.toggle('is-open', issue.id === this.#openId);
    row.classList.toggle('is-unread', issue.unread > 0);
    row.classList.toggle('is-pending', Boolean(issue.pending));
    row.setAttribute('aria-label', `${issue.id}, ${issue.title}. ${statusName(issue.status)}, ${priorityName(issue.priority)}${issue.labels.length ? `, ${issue.labels.map(labelName).join(', ')}` : ''}${issue.unread ? ', new reply' : ''}`);
    setPriority(row.querySelector('.tk-row-pr'), issue.priority);
    setStatus(row.querySelector('.tk-st'), issue.status, issue.thinking, !this.#first);
    setText(row.querySelector('.tk-row-title'), issue.title);
    const labels = row.querySelector('.tk-row-labels');
    const labelKey = issue.labels.join();
    if (labels.dataset.labels !== labelKey) {
      labels.dataset.labels = labelKey;
      fill(labels, ...issue.labels.map(labelPill));
    }
    const av = row.querySelector('.tk-row-av');
    const avKey = issue.assignee ? `${issue.assignee.kind}:${issue.assignee.name}:${issue.assignee.avatar ?? ''}` : '';
    if (av.dataset.who !== avKey) {
      const fresh = av.dataset.who !== undefined && !av.dataset.who && avKey;
      av.dataset.who = avKey;
      fill(av, avatar(issue.assignee, 18));
      av.title = issue.assignee ? `Assigned to ${issue.assignee.name}` : 'Unassigned';
      if (fresh) animate(av.firstChild, [{ opacity: 0, transform: 'translateX(10px) scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
    }
    const date = row.querySelector('.tk-row-date');
    if (Number(date.dataset.at) !== issue.created) {
      date.dataset.at = issue.created;
      fill(date, timeEl(issue.created, shortDate));
    }
  }

  // The open issue --------------------------------------------------------------

  #buildIssue() {
    this.backChip = h('button', { type: 'button', class: 'tk-back-chip', hidden: true, onclick: () => this.#backTo && this.on.open(this.#backTo, { focus: true }) });
    const bar = h('header', { class: 'tk-issue-bar' },
      h('button', { type: 'button', class: 'tk-icon-btn tk-back', 'aria-label': 'Back to issues', html: ICONS.back, onclick: () => this.on.close() }),
      this.backChip,
      (this.crumb = h('span', { class: 'tk-issue-crumb' },
        h('span', { class: 'tk-crumb-st', html: statusIcon('todo') }),
        h('span', { class: 'tk-mono tk-crumb-id' }),
        h('span', { class: 'tk-crumb-title' }))),
      h('span', { class: 'tk-grow' }),
      (this.position = h('span', { class: 'tk-pos tk-mono' })),
      h('button', { type: 'button', class: 'tk-icon-btn tk-nav-prev', 'aria-label': 'Previous issue (K)', title: 'Previous issue  K', html: ICONS.chevronUp, onclick: () => this.#step(-1) }),
      h('button', { type: 'button', class: 'tk-icon-btn tk-nav-next', 'aria-label': 'Next issue (J)', title: 'Next issue  J', html: ICONS.chevronDown, onclick: () => this.#step(1) }),
      h('button', { type: 'button', class: 'tk-icon-btn', 'aria-label': 'Issue actions', title: 'Issue actions', 'aria-haspopup': 'menu', html: ICONS.more, onclick: (e) => this.on.issueMenu(this.#openId, e.currentTarget) }),
      h('button', { type: 'button', class: 'tk-icon-btn tk-close', 'aria-label': 'Close issue (Esc)', title: 'Close  Esc', html: ICONS.close, onclick: () => this.on.close() }));

    this.title = h('h2', { class: 'tk-issue-title', id: 'tk-issue-title', tabindex: '-1' });
    this.props = h('div', { class: 'tk-props' });
    this.desc = h('div', { class: 'tk-desc' });
    this.feed = h('ol', { class: 'tk-feed', 'aria-label': 'Activity' });
    this.scroller = h('div', { class: 'tk-issue-scroll' },
      h('div', { class: 'tk-issue-body' }, this.title, this.props, this.desc,
        h('h3', { class: 'tk-activity-head' }, 'Activity', (this.subscribers = h('span', { class: 'tk-activity-meta' }))),
        this.feed));
    this.footer = h('footer', { class: 'tk-issue-foot' });
    this.issue.append(bar, this.scroller, this.footer);

    // Mentions and plan chips inside replies.
    this.feed.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-ref-issue], [data-ref-plan]');
      if (chip) {
        event.preventDefault();
        if (chip.dataset.refIssue) this.on.open(chip.dataset.refIssue, { focus: true, from: this.#openId });
        else this.on.plan(chip.dataset.refPlan);
        return;
      }
      const link = event.target.closest('a[data-link-card]');
      if (link) this.on.link(link.dataset.messageId, link.href);
    });
    const preview = (event) => {
      const chip = event.target.closest?.('[data-ref-issue]');
      this.on.preview(chip ?? null, chip?.dataset.refIssue ?? null, event.type);
    };
    this.feed.addEventListener('pointerover', preview);
    this.feed.addEventListener('pointerout', (event) => {
      if (event.target.closest?.('[data-ref-issue]') && !event.relatedTarget?.closest?.('[data-ref-issue]')) this.on.preview(null, null, 'out');
    });
    this.feed.addEventListener('focusin', preview);
    this.feed.addEventListener('focusout', () => this.on.preview(null, null, 'out'));
    this.issue.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        this.on.close({ focusList: true });
      }
    });
  }

  #step(delta) {
    const ids = this.#visibleIds.filter((id) => id !== 'ghost');
    const at = ids.indexOf(this.#openId);
    const next = ids[at < 0 ? 0 : at + delta];
    if (next) {
      this.#setActive(next, { reveal: true });
      this.on.open(next, { focus: false });
    }
  }

  focusIssue() {
    this.title.focus({ preventScroll: true });
  }

  #renderIssue(issue, model, ui, env, display) {
    const changed = issue?.id !== this.#openId;
    this.#openId = issue?.id ?? null;
    this.root.dataset.open = issue ? 'true' : 'false';
    this.issue.hidden = !issue;
    if (!issue) return;
    if (changed) {
      fill(this.feed);
      fill(this.footer);
      this.scroller.scrollTop = 0;
      this.#footerKey = '';
      animate(this.issue.querySelector('.tk-issue-body'), [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200 });
    }
    this.issue.dataset.source = issue.source;
    this.issue.setAttribute('aria-label', `${issue.id}: ${issue.title}`);
    // Opened from a mention: a way back to the issue that mentioned it.
    this.#backTo = ui.back && ui.back !== issue.id && display.some((other) => other.id === ui.back) ? ui.back : null;
    this.backChip.hidden = !this.#backTo;
    if (this.#backTo) {
      fill(this.backChip, h('span', { html: ICONS.chevronLeft }), h('span', { class: 'tk-mono', text: this.#backTo }));
      this.backChip.setAttribute('aria-label', `Back to ${this.#backTo}`);
    }
    setStatus(this.crumb.querySelector('.tk-st'), issue.status, issue.thinking, !changed);
    setText(this.crumb.querySelector('.tk-crumb-id'), issue.id);
    setText(this.crumb.querySelector('.tk-crumb-title'), issue.title);
    const ids = this.#visibleIds.filter((id) => id !== 'ghost');
    const at = ids.indexOf(issue.id);
    setText(this.position, at >= 0 ? `${at + 1} / ${ids.length}` : '');
    this.issue.querySelector('.tk-nav-prev').disabled = at <= 0;
    this.issue.querySelector('.tk-nav-next').disabled = at < 0 || at >= ids.length - 1;
    setText(this.title, issue.title);
    this.#renderProps(issue, changed);
    const descKey = issue.description;
    if (this.desc.dataset.text !== descKey || changed) {
      this.desc.dataset.text = descKey;
      fill(this.desc, issue.description ? richText(issue.description, (token) => this.#ref(token, display)) : h('p', { class: 'tk-desc-empty', text: 'No description.' }));
    }
    setText(this.subscribers, issue.source === 'seed' ? `Asked by ${issue.asked} teams` : '');
    this.#renderFeed(issue, display, changed);
    this.#renderFooter(issue, model, env);
  }

  #renderProps(issue, changed) {
    const key = [issue.status, issue.thinking, issue.priority, issue.labels.join(), issue.assignee?.name, issue.assignee?.kind, issue.assignee?.avatar, issue.waiting, issue.source].join('|');
    if (!changed && this.props.dataset.key === key) return;
    const hadAssignee = !changed && this.props.dataset.assignee === 'none' && issue.assignee;
    const previousStatus = this.props.querySelector('.tk-st')?.dataset.status;
    // The chips are rebuilt: keep focus on the one that had it (a menu hands it back there).
    const focusedProp = this.props.contains(document.activeElement) ? document.activeElement.dataset.prop : null;
    this.props.dataset.key = key;
    this.props.dataset.assignee = issue.assignee ? 'some' : 'none';
    const status = h('button', { type: 'button', class: 'tk-prop', dataset: { prop: 'status' }, title: 'Change status  S', 'aria-label': `Status: ${statusName(issue.status)}. Change status`, onclick: (e) => this.on.menu('status', issue.id, e.currentTarget) },
      h('span', { html: statusIcon(previousStatus && !changed ? previousStatus : issue.status) }), h('span', { text: statusName(issue.status) }));
    const priority = h('button', { type: 'button', class: 'tk-prop', dataset: { prop: 'priority' }, title: 'Change priority  P', 'aria-label': `Priority: ${priorityName(issue.priority)}. Change priority`, onclick: (e) => this.on.menu('priority', issue.id, e.currentTarget) },
      h('span', { class: 'tk-prop-pr', html: priorityIcon(issue.priority) }), h('span', { text: priorityName(issue.priority) }));
    const assignee = h('span', { class: 'tk-prop tk-prop-static', title: issue.assignee ? `Assigned to ${issue.assignee.name}` : 'Nobody has picked this up yet' },
      avatar(issue.assignee, 16), issue.assignee ? h('span', { class: 'tk-prop-who' }, who(issue.assignee, { strong: false })) : h('span', { class: 'tk-muted', text: 'Unassigned' }));
    const labels = h('button', { type: 'button', class: 'tk-prop', dataset: { prop: 'labels' }, title: 'Change labels  L', 'aria-label': `Labels: ${issue.labels.map(labelName).join(', ') || 'none'}. Change labels`, onclick: (e) => this.on.menu('labels', issue.id, e.currentTarget) },
      issue.labels.length
        ? issue.labels.map((id) => h('span', { class: 'tk-prop-label' }, h('i', { style: `background: ${labelColor(id)}` }), labelName(id)))
        : [h('span', { html: ICONS.tag }), h('span', { class: 'tk-muted', text: 'Labels' })]);
    const answered = issue.waiting === 'you' && issue.source === 'live';
    const note = answered
      ? h('span', { class: 'tk-waiting', text: 'Waiting on you' })
      : issue.thinking ? h('span', { class: 'tk-waiting is-team', text: 'Being answered' }) : null;
    // Answered well enough? Done is this page's business: Stand's conversation carries on.
    const done = answered
      ? h('button', { type: 'button', class: 'tk-prop tk-prop-done', dataset: { prop: 'done' }, onclick: () => this.on.markDone(issue.id) }, h('span', { html: statusIcon('done') }), 'Mark as done')
      : null;
    fill(this.props, status, priority, assignee, labels, note, done);
    if (focusedProp) (this.props.querySelector(`[data-prop="${focusedProp}"]`) ?? this.props.querySelector('[data-prop="status"]'))?.focus({ preventScroll: true });
    setStatus(status.querySelector('.tk-st'), issue.status, issue.thinking, true);
    if (hadAssignee) {
      animate(assignee.querySelector('.tk-av'), [{ opacity: 0, transform: 'translateX(14px) scale(.5)' }, { opacity: 1, transform: 'none' }], { duration: 280 });
      animate(assignee.querySelector('.tk-prop-who'), [{ opacity: 0, transform: 'translateX(6px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 60, fill: 'backwards' });
    }
  }

  #renderFeed(issue, display, changed) {
    const items = issue.feed.filter((item) => !this.#held.has(`${issue.id}:${item.key}`));
    if (issue.thinking) items.push({ kind: 'typing', key: 'typing', who: issue.assignee, preview: this.#last?.env.activity?.preview ?? '', person: this.#last?.env.activity?.kind === 'typing' });
    const nearBottom = this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight < 80;
    const added = reconcile(this.feed, items, (item) => item.key, (item) => this.#feedEl(item, issue, display), (el, item) => this.#updateFeedEl(el, item, issue));
    if (!changed) {
      for (const el of added) animate(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
    }
    if (changed) {
      if (issue.source !== 'seed' && this.#last?.env.layout !== 'compact') this.scroller.scrollTop = this.scroller.scrollHeight;
    } else if (added.length && nearBottom) {
      this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior: reducedMotion() ? 'instant' : 'smooth' });
    } else if (issue.thinking && nearBottom) {
      // A streamed preview grows in place: keep it in view.
      this.scroller.scrollTop = this.scroller.scrollHeight;
    }
  }

  #feedEl(item, issue, display) {
    const ref = (token) => this.#ref(token, display);
    switch (item.kind) {
      case 'created':
        return h('li', { class: 'tk-ev' }, avatar(item.who, 16), h('span', { class: 'tk-ev-text' },
          who(item.who), issue.source === 'seed' ? ' filed this from the switching page' : ' created the issue', ' · ', timeEl(item.at),
          h('span', { class: 'tk-ev-state' })));
      case 'pickup':
        return h('li', { class: 'tk-ev tk-ev-pickup' }, avatar(item.who, 16), h('span', { class: 'tk-ev-text' }, who(item.who), ' picked this up · ', timeEl(item.at)));
      case 'comment':
        return h('li', { class: `tk-comment${item.mine ? ' is-mine' : ''}` },
          h('div', { class: 'tk-comment-head' }, avatar(item.mine ? { name: 'You', kind: 'visitor' } : item.who, 18), who(item.mine ? { name: 'You' } : item.who), h('span', { class: 'tk-dim' }, ' · ', timeEl(item.at)), h('span', { class: 'tk-comment-state' })),
          h('div', { class: 'tk-comment-body tk-prose' }, richText(item.text, ref)));
      case 'link': {
        let host = '';
        try { host = new URL(item.url).host.replace(/^www\./, ''); } catch { /* validated earlier */ }
        return h('li', { class: 'tk-comment tk-linkcard' },
          h('div', { class: 'tk-comment-head' }, avatar(item.who, 18), who(item.who), h('span', { class: 'tk-dim' }, ' shared a link · ', timeEl(item.at))),
          h('a', { class: 'tk-link', href: item.url, target: '_blank', rel: 'noopener noreferrer', dataset: { linkCard: '', messageId: item.messageId } },
            h('span', { class: 'tk-link-icon', html: ICONS.link }),
            h('span', { class: 'tk-link-text' }, h('b', { text: item.title || host || item.url }), item.description ? h('span', { text: item.description }) : null, h('small', { text: host })),
            h('span', { class: 'tk-link-go', html: ICONS.external })));
      }
      case 'joined':
        return h('li', { class: 'tk-ev tk-ev-joined' }, avatar(item.who, 16), h('span', { class: 'tk-ev-text' }, who(item.who), item.who.title ? h('span', { class: 'tk-dim', text: ` (${item.who.title})` }) : null, ' joined · assigned · ', timeEl(item.at)));
      case 'takeover':
        return h('li', { class: 'tk-ev' }, avatar(item.who, 16), h('span', { class: 'tk-ev-text' }, who(item.who), ' picked this up again · ', timeEl(item.at)));
      case 'offer':
        return this.#offerEl(item);
      case 'followup':
        return h('li', { class: 'tk-ev' }, h('span', { class: 'tk-ev-icon', html: ICONS.mail }), h('span', { class: 'tk-ev-text' }, item.message || 'Got it. The team will follow up by email.', ' · ', timeEl(item.at)));
      case 'status':
        return h('li', { class: 'tk-ev' }, h('span', { class: 'tk-ev-icon', html: statusIcon(item.to) }), h('span', { class: 'tk-ev-text' }, who(item.who), ` moved this to ${statusName(item.to)} · `, timeEl(item.at)));
      case 'asked':
        return h('li', { class: 'tk-ev' }, h('span', { class: 'tk-ev-icon tk-ev-count', text: '+' }), h('span', { class: 'tk-ev-text' }, h('b', { text: `${item.count - 1} more teams` }), ' asked the same question since'));
      case 'ended':
        return h('li', { class: 'tk-ev tk-ev-ended' }, h('span', { class: 'tk-ev-icon', html: ICONS.power }), h('span', { class: 'tk-ev-text' }, h('b', { text: 'Conversation ended' }), item.closedAs ? ` · closed as ${statusName(item.closedAs)}` : '', ' · ', timeEl(item.at)));
      case 'typing':
        return h('li', { class: 'tk-ev tk-typing', 'aria-hidden': 'true' }, avatar(item.who, 16), h('span', { class: 'tk-ev-text' }, who(item.who), h('span', { class: 'tk-typing-text' }), h('span', { class: 'tk-dots' }, h('i'), h('i'), h('i'))), h('p', { class: 'tk-typing-preview' }));
      default:
        return h('li', { hidden: true });
    }
  }

  #updateFeedEl(el, item, issue) {
    if (item.kind === 'created') {
      const state = el.querySelector('.tk-ev-state');
      const key = issue.pending ?? 'sent';
      if (state.dataset.state === key) return;
      state.dataset.state = key;
      fill(state, 
        key === 'sending' ? h('span', { class: 'tk-sending', text: ' · Sending…' }) : null,
        key === 'failed' ? this.#retryNote() : null);
    } else if (item.kind === 'comment' && item.mine) {
      const state = el.querySelector('.tk-comment-state');
      if (state.dataset.state === item.state) return;
      state.dataset.state = item.state;
      el.classList.toggle('is-failed', item.state === 'failed');
      fill(state, 
        item.state === 'sending' ? h('span', { class: 'tk-sending', text: ' · Sending…' }) : null,
        item.state === 'failed' ? this.#retryNote() : null);
    } else if (item.kind === 'typing') {
      setText(el.querySelector('.tk-typing-text'), item.person ? ' is typing' : ' is writing a reply');
      setText(el.querySelector('.tk-typing-preview'), item.preview || '');
    } else if (item.kind === 'offer') {
      el.classList.toggle('is-active', Boolean(item.active));
      el.querySelector('form')?.toggleAttribute('hidden', !item.active);
    }
  }

  #retryNote() {
    const env = this.#last?.env;
    const canRetry = env?.phase === 'active' && !env.busy;
    return h('span', { class: 'tk-failed' }, ' · Not delivered',
      canRetry ? [' — ', h('button', { type: 'button', class: 'tk-link-btn', text: 'Retry', onclick: () => this.on.retry() })] : null);
  }

  #offerEl(item) {
    const input = h('input', { type: 'email', required: true, autocomplete: 'email', placeholder: 'you@company.com', 'aria-label': 'Your email' });
    const form = h('form', { class: 'tk-offer-form', hidden: !item.active, onsubmit: (event) => {
      event.preventDefault();
      if (input.value.trim()) this.on.email(input.value.trim());
    } }, input, h('button', { type: 'submit', class: 'tk-btn tk-btn-primary', text: 'Follow up by email' }));
    return h('li', { class: `tk-comment tk-offer${item.active ? ' is-active' : ''}` },
      h('div', { class: 'tk-comment-head' }, h('span', { class: 'tk-ev-icon', html: ICONS.mail }), h('b', { text: item.who.name }), h('span', { class: 'tk-dim' }, ' · ', timeEl(item.at))),
      h('p', { class: 'tk-offer-text', text: item.message || `${item.who.name} can’t reply right now. Leave your email and they’ll follow up.` }),
      form);
  }

  #footerKey = '';
  #wasOnline = false;
  #backTo = null;

  #renderFooter(issue, model, env) {
    const lockedBy = env.waitingOn && env.waitingOn !== issue.id ? env.waitingOn : null;
    const mode = issue.source === 'seed' ? 'seed'
      : issue.source === 'archived' || env.phase === 'ended' ? 'ended'
        : env.phase === 'uncertain' ? 'uncertain'
          : env.phase !== 'active' ? 'waiting' : 'comment';
    const meta = () => h('div', { class: 'tk-foot-meta' },
      h('span', { class: 'tk-real' }, h('i', { class: 'tk-live-dot' }), env.host?.kind === 'rep' ? 'Real conversation · a person via Stand' : 'Real conversation · AI Stand-in via Stand'),
      this.#powered(env));
    if (mode === 'comment') return this.#renderCommentBox(issue, env, lockedBy, meta);
    const key = [mode, issue.id, env.busy, env.phase, env.poweredByUrl, env.host?.kind].join('|');
    if (key === this.#footerKey) return;
    this.#footerKey = key;
    this.#box = null;

    if (mode === 'seed') {
      fill(this.footer, h('div', { class: 'tk-foot-seed' },
        h('p', {}, 'One of Axial’s answered questions.'),
        h('button', { type: 'button', class: 'tk-btn', onclick: () => this.on.followUp(issue.id) }, h('span', { html: ICONS.plus }), 'Ask a follow-up')), meta());
      return;
    }
    if (mode === 'ended' || mode === 'uncertain') {
      const text = mode === 'uncertain'
        ? 'We couldn’t confirm your last issue reached the team. It may have started a conversation.'
        : 'This conversation has ended. Your issues stay here.';
      fill(this.footer, h('div', { class: 'tk-foot-seed' },
        h('p', {}, text),
        h('button', { type: 'button', class: 'tk-btn tk-btn-primary', disabled: env.busy, text: 'Start a new conversation', onclick: () => this.on.newChat() })), meta());
      return;
    }
    fill(this.footer, h('div', { class: 'tk-foot-seed' }, h('p', {}, env.phase === 'loading' ? 'Reconnecting to your conversation…' : 'Nobody can answer right now.'),
      env.phase === 'unavailable' ? h('button', { type: 'button', class: 'tk-btn', text: 'Try again', onclick: () => this.on.retryConnection() }) : null), meta());
  }

  // The comment box: built once per open issue and updated in place, so a
  // change in the connection never interrupts someone typing.
  #box = null;
  #wantFocus = null;

  #renderCommentBox(issue, env, lockedBy, meta) {
    let box = this.#box;
    if (!box || box.id !== issue.id || !this.footer.contains(box.form)) {
      box = this.#box = this.#buildCommentBox(issue);
      this.#footerKey = '';
      fill(this.footer, box.lock, box.form, box.notice, box.meta);
    }
    const pendingHere = Boolean(issue.pending) || issue.feed.some((item) => item.state === 'failed' || item.state === 'sending');
    box.disabled = Boolean(lockedBy) || env.busy || pendingHere;
    box.textarea.disabled = box.disabled;
    box.textarea.placeholder = lockedBy ? `Waiting for the answer on ${lockedBy}…` : 'Leave a comment…';
    box.lock.hidden = !lockedBy;
    if (lockedBy) setText(box.lock.lastChild, `Waiting for the answer on ${lockedBy}. You can comment here once it lands.`);
    box.notice.hidden = !env.notice;
    setText(box.notice, env.notice || '');
    const metaKey = [env.host?.kind, env.poweredByUrl].join('|');
    if (box.meta.dataset.key !== metaKey) {
      box.meta.dataset.key = metaKey;
      fill(box.meta, ...meta().childNodes);
    }
    box.grow();
    if (this.#wantFocus === issue.id && !box.disabled) {
      this.#wantFocus = null;
      box.textarea.focus({ preventScroll: true });
    }
  }

  #buildCommentBox(issue) {
    const textarea = h('textarea', { rows: '1', class: 'tk-comment-input', 'aria-label': `Comment on ${issue.id}`, enterkeyhint: 'send' });
    textarea.value = this.on.getDraft(issue.id);
    const send = h('button', { type: 'submit', class: 'tk-send', 'aria-label': 'Send comment', title: 'Send  ↵', html: ICONS.send, disabled: true });
    const box = {
      id: issue.id, textarea, send, disabled: false,
      form: h('form', { class: 'tk-comment-box' }, textarea, send),
      lock: h('p', { class: 'tk-lock', hidden: true }, h('span', { class: 'tk-lock-st', html: statusIcon('progress', { thinking: true }) }), h('span')),
      notice: h('p', { class: 'tk-notice', hidden: true }),
      meta: h('div', { class: 'tk-foot-meta' }),
      grow() {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
        send.disabled = box.disabled || !textarea.value.trim();
      },
    };
    const submit = () => {
      const text = textarea.value.trim();
      if (box.disabled || !text) return;
      this.#wantFocus = issue.id; // Back to the box once the comment is delivered.
      this.on.comment(issue.id, text);
      textarea.value = '';
      this.on.setDraft(issue.id, '');
      box.grow();
    };
    box.form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    textarea.addEventListener('input', () => {
      this.on.setDraft(issue.id, textarea.value);
      if (textarea.value.trim()) this.on.typing();
      box.grow();
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        textarea.blur();
        this.on.close({ focusList: true });
      }
    });
    requestAnimationFrame(() => box.grow());
    return box;
  }

  #powered(env) {
    const url = safeUrl(env.poweredByUrl);
    if (!url) return null;
    return h('a', { class: 'tk-powered', href: url, target: '_blank', rel: 'noopener noreferrer', onclick: () => this.on.attribution() }, 'Powered by Stand');
  }

  // References: issue mentions and plan chips, in the tracker's own idiom.
  #ref(token, display) {
    if (token.target.kind === 'plan') {
      const name = token.target.id[0].toUpperCase() + token.target.id.slice(1);
      return h('a', { class: 'tk-mention tk-mention-plan', href: '#pricing', dataset: { refPlan: token.target.id } },
        h('span', { html: ICONS.pricing }), h('span', { class: 'tk-mention-title', text: name }));
    }
    const target = display.find((issue) => issue.id === token.target.id);
    if (!target) return null;
    return h('a', { class: 'tk-mention', href: `#${target.id}`, dataset: { refIssue: target.id }, 'aria-label': `${target.id}: ${target.title} (${statusName(target.status)})` },
      h('span', { html: statusIcon(target.status) }),
      h('span', { class: 'tk-mono', text: target.id }),
      h('span', { class: 'tk-mention-title', text: target.title }));
  }

  // Presence: who answers, and whether they can right now.
  #renderPresence(env) {
    // The first socket after a new conversation is "connecting"; only a lost one is "reconnecting".
    if (env.connection === 'online') this.#wasOnline = true;
    const lost = env.phase === 'active' && env.connection !== 'online' && this.#wasOnline;
    const key = [env.phase, env.connection, lost, env.restoring, env.host?.name, env.host?.kind, env.host?.avatar, env.error, env.busy].join('|');
    if (this.presence.dataset.key === key) return;
    this.presence.dataset.key = key;
    this.headPresence.dataset.key = key;
    const make = () => {
      const host = env.host?.name ? env.host : null;
      const retry = (label, action) => h('button', { type: 'button', class: 'tk-link-btn', text: label, onclick: action });
      let body;
      let tone = 'ok';
      switch (env.phase) {
        case 'loading':
          tone = 'wait';
          body = [h('span', { class: 'tk-presence-text' }, h('b', { text: env.restoring ? 'Reconnecting to your conversation…' : 'Checking who’s around…' }))];
          break;
        case 'unavailable':
          tone = 'off';
          body = [h('span', { class: 'tk-presence-text' },
            h('b', { text: env.error === 'connect' ? 'Couldn’t reach the team' : 'Nobody’s answering right now' }),
            h('small', {}, env.error === 'start' ? 'Your issue wasn’t filed. ' : env.error === 'connect' ? 'Check your connection. ' : '', retry('Try again', () => this.on.retryConnection())))];
          break;
        case 'ended':
          tone = 'off';
          body = [h('span', { class: 'tk-presence-text' }, h('b', { text: env.error === 'gone' ? 'Conversation unavailable' : 'Conversation ended' }), h('small', {}, retry('Start a new one', () => this.on.newChat())))];
          break;
        case 'uncertain':
          tone = 'warn';
          body = [h('span', { class: 'tk-presence-text' }, h('b', { text: 'Your last issue may not have arrived' }), h('small', {}, retry('Start a new conversation', () => this.on.newChat())))];
          break;
        default: {
          const connecting = env.phase === 'active' && env.connection !== 'online';
          tone = env.error === 'paused' || lost ? 'warn' : 'ok';
          const sub = env.error === 'paused'
            ? ['Connection paused. ', retry('Reconnect', () => this.on.retryConnection())]
            : lost ? 'Reconnecting…' : connecting ? 'Connecting…' : env.phase === 'active' ? 'Answering your issues' : 'Picks up new issues';
          body = [avatar(host, 22), h('span', { class: 'tk-presence-text' }, h('span', { class: 'tk-presence-name' }, who(host)), h('small', {}, sub))];
        }
      }
      return [h('i', { class: 'tk-presence-dot', dataset: { tone } }), ...body];
    };
    fill(this.presence, ...make());
    fill(this.headPresence, ...make());
  }

  // Render ----------------------------------------------------------------------

  /**
   * Draws the model. `ui` is the page's view state ({ view, label, open }),
   * `env` what the client knows ({ phase, host, error, notice, … }).
   */
  render(model, ui, env) {
    this.#last = { model, ui, env };
    clearTimeout(this.#timer);
    const display = this.#pace(model.issues);
    this.root.dataset.layout = env.layout;
    this.root.dataset.phase = env.phase;
    for (const button of this.side.querySelectorAll('[data-view]')) button.setAttribute('aria-current', String(button.dataset.view === ui.view && !ui.label));
    for (const button of this.side.querySelectorAll('[data-label]')) button.setAttribute('aria-current', String(button.dataset.label === ui.label));
    for (const count of this.root.querySelectorAll('[data-count]')) {
      const n = model.counts[count.dataset.count] ?? 0;
      setText(count, n ? String(n) : '');
    }
    setText(this.viewName, VIEWS[ui.view]?.name ?? 'Issues');
    this.filterChip.hidden = !ui.label;
    if (ui.label) {
      fill(this.filterChip, h('i', { style: `background: ${labelColor(ui.label)}` }), `Label: ${labelName(ui.label)}`, h('span', { class: 'tk-filter-x', html: ICONS.close }));
      this.filterChip.setAttribute('aria-label', `Filtered by label ${labelName(ui.label)}. Clear filter`);
    }
    this.#renderPresence(env);
    this.#renderList(model, ui, env, display);
    const open = ui.open ? display.find((issue) => issue.id === ui.open) : null;
    this.#renderIssue(open, model, ui, env, display);
    this.#announce(display);
    this.#first = false;
  }

  // The pickup, paced: a new issue sits in Triage for a moment before it's
  // picked up, and the typing shows for a moment before the answer lands.
  // Only pacing: every state is real, just never skipped past too fast to see.
  #pace(issues) {
    const now = Date.now();
    let wake = Infinity;
    this.#held.clear();
    const display = issues.map((issue) => {
      if (issue.source !== 'live') return issue;
      let shown = this.#shown.get(issue.id);
      if (!shown || this.#first) {
        this.#shown.set(issue.id, { status: issue.status, since: this.#first ? 0 : now });
        return issue;
      }
      const target = issue.status;
      if (shown.status === target) return issue;
      const forward = target === 'progress' || target === 'review';
      if (shown.status === 'triage' && forward) {
        if (now - shown.since < HOLD.triage) {
          wake = Math.min(wake, shown.since + HOLD.triage);
          return { ...issue, status: 'triage', assignee: null, thinking: false, waiting: null, feed: issue.feed.filter((item) => item.kind === 'created') };
        }
        shown = { status: 'progress', since: now };
        this.#shown.set(issue.id, shown);
      }
      if (shown.status === 'progress' && target === 'review') {
        if (now - shown.since < HOLD.progress) {
          wake = Math.min(wake, shown.since + HOLD.progress);
          // The answer waits a beat behind the typing indicator.
          for (const item of issue.feed) if (!item.mine && item.seq > issue.lastVisitorSeq && Number.isFinite(item.seq)) this.#held.add(`${issue.id}:${item.key}`);
          return { ...issue, status: 'progress', thinking: true, waiting: 'team' };
        }
      }
      this.#shown.set(issue.id, { status: target, since: now });
      return issue;
    });
    if (wake < Infinity) this.#timer = setTimeout(() => this.#last && this.render(this.#last.model, this.#last.ui, this.#last.env), wake - now + 16);
    return display;
  }

  // Whole replies go to screen readers (and to toasts when the issue isn't in view).
  #announce(display) {
    for (const issue of display) {
      if (issue.source !== 'live') continue;
      for (const item of issue.feed) {
        if (!['comment', 'link', 'joined', 'offer'].includes(item.kind) || item.mine) continue;
        const key = `${issue.id}:${item.key}`;
        if (this.#announced.has(key)) continue;
        this.#announced.add(key);
        if (!this.#first) this.on.announce(issue, item);
      }
    }
  }
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function labelPill(id) {
  return h('span', { class: 'tk-pill' }, h('i', { style: `background: ${labelColor(id)}` }), labelName(id));
}

function setPriority(slot, priority) {
  if (slot.dataset.priority === priority) return;
  slot.dataset.priority = priority;
  slot.innerHTML = priorityIcon(priority);
  slot.title = `Priority: ${priorityName(priority)}`;
}

/** Moves a status icon to a new status, animating its fill when it changes. */
export function setStatus(svg, status, thinking = false, animated = true) {
  if (!svg) return;
  const before = svg.dataset.status;
  svg.toggleAttribute('data-thinking', Boolean(thinking) && status === 'progress');
  if (before === status) return;
  svg.dataset.status = status;
  if (!animated || !before) return;
  const pie = svg.querySelector('.tk-st-fill');
  animate(pie, [{ strokeDasharray: `${FILL[before] ?? 0} 100` }, { strokeDasharray: `${FILL[status] ?? 0} 100` }], { duration: 520, easing: 'cubic-bezier(.3, .7, .2, 1)' });
  animate(svg, [{ transform: 'scale(1)' }, { transform: 'scale(1.28)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 420 });
  if (CLOSED.has(status) || status === 'triage') animate(svg.querySelector('.tk-st-disc'), [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300 });
}

