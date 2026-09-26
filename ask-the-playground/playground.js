// The dashboard around the database: views, "Run as", the editor, results,
// tables, policies and users. Its ask buttons hand a question, with the query,
// role and outcome attached, to the assistant; the assistant's references and
// SQL land back here. Everything shown is drawn from state.

import { normalizeName, parseRef } from './context.js';
import { HERO_SNIPPET, POLICIES, SNIPPETS, TABLES, USERS, policySql, userById } from './sandbox.js';
import { SqlEditor } from './sql-editor.js';
import { changesSchema, commandOf, lineOf, splitStatements, tablesIn } from './sql.js';
import { avatar, gridTable, h, icon, ms, plural, reducedMotion, store } from './ui.js';

const KEY = 'ask-the-playground:v1:ui';
const VIEWS = ['sql', 'tables', 'policies', 'users'];
const HERO = SNIPPETS.find((s) => s.id === HERO_SNIPPET);
const READ_ONLY = new Set(['SELECT', 'SHOW', 'EXPLAIN', 'VALUES', 'TABLE']);

// The hero query's outcome, recorded from a real run, so the first paint shows
// it before Postgres has downloaded. A live run replaces it once Postgres is up.
const HERO_RESULT = {
  ok: false,
  ms: NaN,
  statements: 1,
  seeded: true,
  sql: HERO.sql,
  user: HERO.as,
  error: { code: '42501', severity: 'ERROR', message: 'new row violates row-level security policy for table "invoices"', position: 0 },
};

export class Playground extends EventTarget {
  #refreshing = 0;
  #stopTimer = 0;
  #toastTimer = 0;
  #seedSignatures = new Map();
  #popover = null;

  constructor(root, db) {
    super();
    this.root = root;
    this.db = db;
    const $ = (sel) => root.querySelector(sel);
    this.el = {
      status: $('.pg-status'),
      statusLabel: $('.pg-status-label'),
      meter: $('.pg-meter'),
      reset: $('.dash-reset'),
      rail: $('.dash-rail'),
      side: $('.dash-side'),
      main: $('.dash-main'),
      views: Object.fromEntries(VIEWS.map((v) => [v, root.querySelector(`#view-${v}`)])),
      tabTitle: $('.ed-tab-title'),
      snippets: $('.ed-snippets'),
      runas: $('.runas-btn'),
      runasValue: $('.runas-value'),
      runasChips: $('.runas-chips'),
      run: $('.run-btn'),
      runLabel: $('.run-label'),
      res: $('.res'),
    };

    const saved = store.get(KEY, {}) ?? {};
    this.state = {
      view: VIEWS.includes(saved.view) ? saved.view : 'sql',
      user: USERS.some((u) => u.id === saved.user) ? saved.user : HERO.as,
      snippet: typeof saved.snippet === 'string' || saved.snippet === null ? saved.snippet : HERO.id,
      sql: typeof saved.sql === 'string' ? saved.sql : HERO.sql,
      table: typeof saved.table === 'string' ? saved.table : 'invoices',
      off: Array.isArray(saved.off) ? saved.off.filter((p) => p?.name && p?.table && p?.sql) : [],
      rlsOff: Array.isArray(saved.rlsOff) ? saved.rlsOff.filter((t) => typeof t === 'string') : [],
      result: saved.result && typeof saved.result === 'object' ? saved.result : HERO_RESULT,
      // Every change since the seed, in order: Postgres lives in memory, so a
      // reload (or Stop) starts it fresh and replays these.
      journal: Array.isArray(saved.journal) ? saved.journal.filter((e) => typeof e?.sql === 'string' && typeof e?.user === 'string') : [],
    };
    this.replayNote = '';
    this.schema = staticSchema(this.state);
    this.askStatus = { ready: true, text: '' };

    // Snippet chips for phones sit above the editor.
    this.snipChips = h('div', { class: 'snip-chips', role: 'list', 'aria-label': 'Snippets' });
    this.el.views.sql.insertBefore(this.snipChips, root.querySelector('[data-editor]'));

    this.editor = new SqlEditor(root.querySelector('[data-editor]'), { value: this.state.sql });
    this.editor.addEventListener('input', () => {
      this.state.sql = this.editor.value;
      this.editor.markError(0);
      this.#saveSoon();
    });
    this.editor.addEventListener('run', () => this.run());
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === this.editor.input) this.#renderRunButton();
    });

    this.db.onStart((api) => this.#replay(api));
    this.db.addEventListener('change', () => this.#onDbChange());
    this.el.reset.addEventListener('click', () => this.reset());
    this.el.run.addEventListener('click', () => (this.running && this.#stoppable() ? this.stop() : this.run()));
    this.el.runas.addEventListener('click', () => this.#openRoleMenu());
    this.el.runas.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.#openRoleMenu();
      }
    });
    this.el.snippets.addEventListener('click', () => this.#openSnippetMenu());
    this.#wireRail();

    this.render();
  }

  get user() {
    return userById(this.state.user);
  }

  // Rendering ------------------------------------------------------------------

  render() {
    this.#renderStatus();
    this.#renderRail();
    this.#renderSide();
    this.#renderRunAs();
    this.#renderSnippetChips();
    this.#renderRunButton();
    this.#renderTab();
    for (const v of VIEWS) this.el.views[v].hidden = v !== this.state.view;
    this.root.dataset.view = this.state.view;
    this.#renderView();
  }

  #renderView() {
    const view = this.state.view;
    if (view === 'sql') this.#renderResult();
    else if (view === 'tables') this.#renderTables();
    else if (view === 'policies') this.#renderPolicies();
    else this.#renderUsers();
  }

  #renderStatus() {
    const { status, progress, version } = this.db.state;
    const el = this.el.status;
    el.dataset.status = status;
    el.querySelector('button')?.remove();
    const label = this.el.statusLabel;
    if (status === 'loading') {
      label.textContent = `Loading Postgres · ${Math.floor(progress * 100)}%`;
      this.el.meter.style.setProperty('--p', progress.toFixed(3));
    } else if (status === 'ready') {
      label.textContent = `Postgres ${version || '18'} · running in this tab`;
    } else if (status === 'failed') {
      label.textContent = 'Postgres didn’t load.';
      el.append(h('button', { type: 'button', text: 'Retry', onclick: () => this.db.start() }));
    } else {
      label.textContent = 'Postgres 18 · starts when you get here';
    }
  }

  #renderRail() {
    for (const btn of this.el.rail.querySelectorAll('[data-view]')) {
      const selected = btn.dataset.view === this.state.view;
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
    }
  }

  #wireRail() {
    const tabs = [...this.el.rail.querySelectorAll('[data-view]')];
    this.el.rail.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (btn) this.setView(btn.dataset.view);
    });
    this.el.rail.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      const edge = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (next === undefined && edge === null) return;
      e.preventDefault();
      const target = tabs[edge ?? (i + next + tabs.length) % tabs.length];
      target.focus();
      this.setView(target.dataset.view);
    });
  }

  #renderSide() {
    const side = this.el.side;
    side.textContent = '';
    const view = this.state.view;
    if (view === 'sql') {
      side.append(h('div', { class: 'side-head' }, 'SQL editor'), h('p', { class: 'side-label', text: 'Saved snippets' }));
      const list = h('ul', { class: 'side-list' });
      for (const s of SNIPPETS) {
        list.append(h('li', {}, h('button', {
          class: 'side-item', type: 'button', 'aria-current': String(s.id === this.state.snippet),
          onclick: () => this.loadSnippet(s.id),
        }, icon('doc'), h('span', { class: 'side-item-title', text: s.title }), h('span', { class: 'side-item-meta', text: userById(s.as).label }))));
      }
      side.append(list, h('p', { class: 'side-foot', text: 'Each snippet tells a small story about one user. Nothing leaves your browser; Reset puts the data back.' }));
    } else if (view === 'tables' || view === 'policies') {
      side.append(h('div', { class: 'side-head' }, view === 'tables' ? 'Tables' : 'Policies'), h('p', { class: 'side-label', text: 'public schema' }));
      const list = h('ul', { class: 'side-list' });
      for (const t of this.schema.tables) {
        const count = view === 'tables'
          ? (t.visible === undefined ? `${t.total ?? '–'}` : t.visible === null ? '!' : `${t.visible}/${t.total}`)
          : String(this.schema.policies.filter((p) => p.table === t.name).length);
        const zero = view === 'tables' && t.visible === 0 && t.total > 0;
        list.append(h('li', {}, h('button', {
          class: 'side-item', type: 'button', dataset: { table: t.name },
          'aria-current': String(view === 'tables' && t.name === this.state.table),
          title: view === 'tables' && t.visible !== undefined ? `${t.visible ?? 'No'} of ${t.total} rows visible to ${this.user.label}` : null,
          onclick: () => (view === 'tables' ? this.showTable(t.name) : this.#scrollToPolicyTable(t.name)),
        }, icon(t.rls ? 'lock' : 'unlock'), h('span', { class: 'side-item-title', text: t.name }), h('span', { class: `side-item-meta${zero ? ' is-zero' : ''}`, text: count }))));
      }
      side.append(list, h('p', {
        class: 'side-foot',
        text: view === 'tables' ? `Counts are rows ${this.user.label} can see, of all rows. Change “Run as” and watch them move.` : 'A lock means row-level security is on for that table.',
      }));
    } else {
      side.append(h('div', { class: 'side-head' }, 'Users'), h('p', { class: 'side-label', text: 'Run as' }));
      const list = h('ul', { class: 'side-list' });
      for (const u of USERS) {
        list.append(h('li', {}, h('button', {
          class: 'side-item', type: 'button', 'aria-current': String(u.id === this.state.user),
          onclick: () => this.setUser(u.id),
        }, avatar(u), h('span', { class: 'side-item-title', text: u.label }), h('span', { class: 'side-item-meta', text: u.detail.split(' · ')[0] }))));
      }
      side.append(list, h('p', { class: 'side-foot', text: 'Signed-in users share the authenticated role. Their JWT claims tell them apart.' }));
    }
  }

  #renderTab() {
    const snippet = SNIPPETS.find((s) => s.id === this.state.snippet);
    this.el.tabTitle.textContent = snippet ? snippet.title : this.state.snippet === null && this.fromAssistant ? 'From the assistant' : 'Untitled query';
  }

  #renderRunAs() {
    const u = this.user;
    this.el.runasValue.replaceChildren(avatar(u), h('span', { text: u.label }), h('span', { class: 'runas-detail', text: u.detail }));
    const chips = this.el.runasChips;
    chips.textContent = '';
    chips.append(h('span', { class: 'runas-chips-label', 'aria-hidden': 'true', text: 'Run as' }));
    for (const user of USERS) {
      const checked = user.id === u.id;
      chips.append(h('button', {
        class: `chip${checked ? ' chip-policy' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(checked), tabindex: checked ? '0' : '-1',
        onclick: () => this.setUser(user.id),
        onkeydown: (e) => this.#radioKeys(e, chips),
      }, avatar(user), h('span', { text: user.label })));
    }
  }

  #radioKeys(event, group) {
    const items = [...group.querySelectorAll('[role="radio"]')];
    const i = items.indexOf(event.currentTarget);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = items[(i + step + items.length) % items.length];
    next.click();
    group.querySelector('[aria-checked="true"]')?.focus();
  }

  #renderSnippetChips() {
    const row = this.snipChips;
    row.textContent = '';
    for (const s of SNIPPETS) {
      row.append(h('span', { role: 'listitem' }, h('button', {
        class: `chip${s.id === this.state.snippet ? ' chip-policy' : ''}`, type: 'button', 'aria-current': String(s.id === this.state.snippet),
        onclick: () => this.loadSnippet(s.id),
      }, icon('doc'), h('span', { text: s.title }))));
    }
  }

  #stoppable() {
    return Boolean(this.running) && performance.now() - this.running.started > 1200;
  }

  #renderRunButton() {
    const btn = this.el.run;
    const stop = this.#stoppable();
    btn.classList.toggle('is-stop', stop);
    btn.querySelector('use').setAttribute('href', stop ? '#i-stop' : '#i-play');
    const selected = document.activeElement === this.editor?.input && this.editor.selection;
    this.el.runLabel.textContent = stop ? 'Stop' : this.running ? 'Running…' : selected ? 'Run selected' : 'Run';
    btn.disabled = Boolean(this.running && !stop);
    btn.querySelector('.run-kbd').hidden = Boolean(this.running);
    btn.setAttribute('aria-label', stop ? 'Stop the query' : `${selected ? 'Run the selection' : 'Run the query'} as ${this.user.label}`);
  }

  // The results panel under the editor.
  #renderResult() {
    const res = this.el.res;
    res.textContent = '';
    if (this.running) {
      const { status, progress } = this.db.state;
      const waiting = status !== 'ready';
      res.append(h('div', { class: 'res-running' }, h('span', { class: 'hexdots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('span', { class: 'shimmer', text: waiting ? `Starting Postgres in your browser · ${Math.floor(progress * 100)}%` : `Running as ${this.user.label}…` })));
      return;
    }
    const r = this.state.result;
    if (!r) {
      res.append(h('div', { class: 'res-empty' }, h('p', {}, 'Run a query to see results here. ', h('kbd', { text: '⌘' }), ' ', h('kbd', { text: '↵' }))));
      return;
    }
    const scroll = h('div', { class: 'res-scroll' });
    res.append(scroll);
    if (this.replayNote) scroll.append(h('p', { class: 'res-notice', text: this.replayNote }));
    for (const n of r.notices ?? []) scroll.append(h('p', { class: 'res-notice', text: n }));
    if (r.stopped) {
      scroll.append(h('div', { class: 'res-ok is-zero' }, icon('stop'), h('span', { text: `Stopped after ${ms(r.ms)}. Postgres restarted and replayed your earlier changes.` })));
      return;
    }
    if (!r.ok) {
      scroll.append(this.errorBox(r, { onAsk: () => this.ask('Why did this fail?', this.contextFor(r), { send: true, source: 'error' }) }));
      return;
    }
    const user = userById(r.user);
    const meta = h('span', { class: 'res-meta' }, avatar(user), `as ${user.label}`, Number.isFinite(r.ms) ? ` · ${ms(r.ms)}` : '');
    if (r.fields.length) {
      scroll.append(gridTable(r, { fresh: r.fresh }));
      const zero = r.rowCount === 0;
      if (zero) scroll.append(h('p', { class: 'res-note', text: 'No rows returned.' }));
      const shown = r.rowCount > r.rows.length ? ` (showing ${r.rows.length.toLocaleString('en-US')})` : '';
      res.append(h('div', { class: 'res-foot' },
        h('span', {}, h('b', { class: zero ? 'is-zero' : '', text: plural(r.rowCount, 'row') }), shown, r.statements > 1 ? ` · last of ${r.statements} statements` : ''),
        meta,
        zero
          ? this.#askButton('Ask why it’s empty', () => this.ask(`Why doesn’t ${user.label} see any rows?`, this.contextFor(r), { send: true, source: 'empty' }))
          : this.#askButton('Ask about these rows', () => this.ask('', this.contextFor(r), { send: false, source: 'rows', placeholder: `Ask about these ${plural(r.rowCount, 'row')}…` }), 'btn-secondary'),
      ));
      return;
    }
    const noop = /^(UPDATE|DELETE)$/.test(r.command) && r.affected === 0;
    scroll.append(h('div', { class: `res-ok${noop ? ' is-zero' : ''}` }, icon(noop ? 'x' : 'check'),
      h('span', { text: `Success. ${commandText(r)}` })));
    res.append(h('div', { class: 'res-foot' }, meta,
      noop ? this.#askButton('Ask why nothing changed', () => this.ask('Why did nothing change?', this.contextFor(r), { send: true, source: 'nothing-changed' })) : null));
  }

  #askButton(label, onclick, variant = 'btn-primary') {
    const ready = this.askStatus.ready;
    return h('button', {
      class: `btn ${variant} btn-sm btn-ask`, type: 'button', onclick,
      title: ready ? 'Sends your question with the query, role and result to the Basalt team' : this.askStatus.text,
    }, icon('chat'), label);
  }

  /** The error panel, used under the editor and under SQL the assistant ran. */
  errorBox(r, { onAsk, compact = false } = {}) {
    const e = r.error ?? {};
    const user = userById(r.user);
    const box = h('div', { class: `res-error${compact ? ' is-compact' : ''}`, role: 'group', 'aria-label': 'Query error' });
    const ask = this.#askButton(compact ? 'Ask why' : 'Ask why this failed', onAsk, compact ? 'btn-secondary' : 'btn-primary');
    if (!compact) ask.classList.add('is-glow');
    box.append(h('div', { class: 'res-error-head' },
      h('span', { class: 'badge badge-red', text: `${e.severity || 'ERROR'}${e.code ? ` ${e.code}` : ''}` }),
      h('span', { class: 'res-meta' }, avatar(user), `as ${user.label}`, Number.isFinite(r.ms) ? ` · ${ms(r.ms)}` : '')));
    box.append(h('p', { class: 'res-error-msg', text: e.message || 'The query failed.' }));
    const extra = [];
    if (e.position && r.sql) {
      const { line, column } = lineOf(r.sql, e.position);
      extra.push(`LINE ${line}, column ${column}`);
    }
    if (e.detail) extra.push(`DETAIL: ${e.detail}`);
    if (e.hint) extra.push(`HINT: ${e.hint}`);
    for (const text of extra) box.append(h('p', { class: 'res-error-extra', text }));
    const table = this.#tableOfError(r);
    if (table && !compact) {
      const policies = this.schema.policies.filter((p) => p.table === table);
      const ctx = h('p', { class: 'res-error-ctx' }, h('span', { text: `Policies on ${table}:` }));
      if (policies.length) for (const p of policies) ctx.append(this.refChip('policy', p.name));
      else ctx.append(h('span', { class: 'is-none', text: 'none' }));
      box.append(ctx);
    }
    if (!compact && !this.askStatus.ready && this.askStatus.text) box.append(h('p', { class: 'ask-hint', text: this.askStatus.text }));
    // Top right on wide screens, under the message on phones (see .res-error in style.css).
    box.append(ask);
    return box;
  }

  #tableOfError(r) {
    const e = r.error ?? {};
    const named = e.table || /(?:for|on) (?:table|relation) "?([\w]+)"?/.exec(e.message ?? '')?.[1];
    if (named && this.schema.tables.some((t) => t.name === named)) return named;
    return tablesIn(r.sql ?? '', this.schema.tables.map((t) => t.name))[0] ?? '';
  }

  /** A chip that shows a table or policy on the page. */
  refChip(kind, name) {
    return h('button', {
      class: `chip chip-${kind}`, type: 'button', title: `Show ${kind} ${name}`,
      onclick: () => this.goTo({ kind, name }),
    }, icon(kind === 'table' ? 'table' : 'shield'), h('span', { text: name }));
  }

  #renderTables() {
    const view = this.el.views.tables;
    view.textContent = '';
    const t = this.schema.tables.find((x) => x.name === this.state.table) ?? this.schema.tables[0];
    if (!t) return;
    const user = this.user;
    const head = h('div', { class: 'tv-head' },
      h('h3', { class: 'tv-title' }, icon('table'), t.name),
      h('span', { class: `badge ${t.rls ? 'badge-green' : 'badge-amber'}` }, icon(t.rls ? 'lock' : 'unlock'), t.rls ? 'RLS on' : 'RLS off'));
    const known = Number.isFinite(t.visible) && Number.isFinite(t.total);
    const zero = known && t.visible === 0 && t.total > 0;
    const visible = h('span', { class: `tv-visible${zero ? ' is-zero' : ''}` }, 'Visible to', avatar(user),
      h('span', {}, h('b', { text: user.label }), ': ', known ? [h('b', { text: `${t.visible} of ${t.total}` }), ' rows'] : '…'));
    if (known) {
      const bar = h('span', { class: 'tv-bar', 'aria-hidden': 'true' }, h('i'));
      bar.style.setProperty('--p', t.total ? (t.visible / t.total).toFixed(3) : '0');
      visible.append(bar);
    }
    head.append(visible);
    view.append(head);
    const body = h('div', { class: 'tv-body' });
    view.append(body);
    const rows = this.schema.view;
    if (!this.db.ready || !rows) {
      body.append(h('div', { class: 'tv-empty' }, icon('table'), h('p', { text: this.db.ready ? 'Loading rows…' : 'Rows appear when Postgres has started.' })));
      return;
    }
    if (!rows.ok) {
      body.append(this.errorBox({ ...rows, user: this.state.user, sql: `select * from ${t.name};` }, {
        onAsk: () => this.ask('Why did this fail?', this.contextFor({ ...rows, user: this.state.user, sql: `select * from ${t.name};` }), { send: true, source: 'table' }),
      }));
      return;
    }
    if (rows.rowCount === 0) {
      const empty = h('div', { class: 'tv-empty' }, icon(t.rls ? 'lock' : 'table'),
        h('p', { text: t.total > 0 ? `${user.label} can’t see any of the ${plural(t.total, 'row')} in ${t.name}.` : `${t.name} is empty.` }));
      if (t.total > 0) {
        empty.append(this.#askButton(`Ask why ${user.label} can’t see them`, () => this.ask(`Why can’t ${user.label} see any ${t.name}?`, {
          ...this.#baseContext(this.state.user),
          outcome: { kind: 'table', table: t.name, visible: 0, total: t.total },
          sql: `select * from ${t.name};`,
        }, { send: true, source: 'table' })));
      }
      body.append(empty);
      return;
    }
    body.append(gridTable(rows));
  }

  #renderPolicies() {
    const view = this.el.views.policies;
    view.textContent = '';
    const wrap = h('div', { class: 'pol' });
    wrap.append(h('p', { class: 'pol-intro', text: 'Row-level security checks every row against these policies. Switch one off, or turn off RLS for a table, then run your query again. Changes stay in this tab until you reset.' }));
    for (const t of this.schema.tables) {
      const live = this.schema.policies.filter((p) => p.table === t.name);
      const off = this.state.off.filter((p) => p.table === t.name && !live.some((l) => l.name === p.name));
      const card = h('section', { class: 'pol-table', dataset: { table: t.name }, 'aria-label': `Policies on ${t.name}` });
      const rlsSwitch = this.#switch(t.rls, `Row-level security on ${t.name}`, (on) => this.setRls(t.name, on));
      card.append(h('div', { class: 'pol-table-head' },
        h('h3', {}, icon(t.rls ? 'lock' : 'unlock'), t.name),
        h('label', { class: 'pol-rls' }, h('span', { text: t.rls ? 'RLS on' : 'RLS off' }), rlsSwitch)));
      const list = h('ul', { class: 'pol-list' });
      for (const p of [...live.map((x) => ({ ...x, on: true })), ...off.map((x) => ({ ...x, cmd: x.command, on: false }))].sort((a, b) => a.name.localeCompare(b.name))) {
        const sql = p.on ? this.policyDefinition(p) : p.sql;
        const item = h('li', { class: `pol-item${p.on ? '' : ' is-off'}`, dataset: { policy: normalizeName(p.name) } });
        item.append(h('div', { class: 'pol-row' },
          h('span', { class: 'pol-name', text: p.name }),
          h('span', { class: 'badge pol-cmd', text: p.cmd }),
          this.#switch(p.on, `Policy “${p.name}”`, (on) => this.togglePolicy(p, on))));
        item.append(h('pre', { class: 'pol-code', sql }));
        item.append(h('div', { class: 'pol-actions' },
          h('button', {
            class: 'btn btn-ghost btn-xs', type: 'button',
            onclick: () => this.ask('', { ...this.#baseContext(this.state.user), policy: p.name, sql }, { send: false, source: 'policy', placeholder: 'What does this policy allow?' }),
          }, icon('chat'), 'Ask about this policy')));
        list.append(item);
      }
      card.append(list);
      if (!live.length && t.rls) card.append(h('p', { class: 'pol-none', text: 'No policies: with RLS on, only service_role sees any rows.' }));
      wrap.append(card);
    }
    view.append(wrap);
  }

  #switch(checked, label, onchange) {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
    input.checked = checked;
    input.disabled = !this.db.ready;
    input.addEventListener('change', () => onchange(input.checked));
    return h('span', { class: 'switch' }, input, h('i', { 'aria-hidden': 'true' }));
  }

  #renderUsers() {
    const view = this.el.views.users;
    view.textContent = '';
    const wrap = h('div', { class: 'users' });
    for (const u of USERS) {
      const current = u.id === this.state.user;
      wrap.append(h('div', { class: `user-card${current ? ' is-current' : ''}` },
        avatar(u),
        h('div', { class: 'user-meta' }, h('b', { text: u.name ?? u.label }), h('span', { text: u.claims.email ? `${u.claims.email} · ${u.detail}` : `role ${u.role} · ${u.detail}` })),
        current
          ? h('span', { class: 'badge badge-green', text: 'Running as' })
          : h('button', { class: 'btn btn-secondary btn-xs', type: 'button', onclick: () => this.setUser(u.id) }, `Run as ${u.label}`)));
    }
    wrap.append(h('p', { class: 'users-note', text: 'Dee Tanaka, Globex’s admin, is in the data too. The claims below are what auth.uid() and your policies read for this run:' }));
    wrap.append(h('pre', { class: 'pol-code', text: `set role ${this.user.role};\nrequest.jwt.claims = ${JSON.stringify(this.user.claims, null, 2)}` }));
    view.append(wrap);
  }

  // Actions -------------------------------------------------------------------

  /** Switches views; resolves once the view shows fresh data. */
  async setView(view) {
    if (!VIEWS.includes(view) || view === this.state.view) return;
    this.#closePopover();
    this.state.view = view;
    this.#save();
    this.render();
    if (view !== 'sql' && this.db.state.status === 'idle') this.db.start();
    if (view === 'tables' || view === 'policies') await this.refresh();
  }

  setUser(id, { from } = {}) {
    if (id === this.state.user || !USERS.some((u) => u.id === id)) return;
    this.state.user = id;
    this.#save();
    this.#renderRunAs();
    this.#renderRunButton();
    if (this.state.view === 'users') this.#renderUsers();
    this.#renderSide();
    if (from) {
      this.el.runas.classList.remove('is-changed');
      void this.el.runas.offsetWidth;
      this.el.runas.classList.add('is-changed');
    }
    this.dispatchEvent(new Event('user'));
    this.refresh();
  }

  loadSnippet(id) {
    const s = SNIPPETS.find((x) => x.id === id);
    if (!s) return;
    this.#closePopover();
    this.state.snippet = id;
    this.state.sql = s.sql;
    this.editor.value = s.sql;
    if (this.state.view !== 'sql') this.setView('sql');
    this.setUser(s.as, { from: 'snippet' });
    this.#save();
    this.#renderSide();
    this.#renderSnippetChips();
    this.#renderTab();
    if (matchMedia('(pointer: fine)').matches) this.editor.focus();
  }

  async showTable(name) {
    this.state.table = name;
    this.#save();
    if (this.state.view !== 'tables') return this.setView('tables');
    this.#renderSide();
    this.#renderTables();
    await this.refresh();
  }

  async run({ sql, quiet = false } = {}) {
    const text = sql ?? (this.editor.selection || this.editor.value);
    if (!text.trim() || this.running) return;
    const user = this.user;
    if (!quiet && this.state.view !== 'sql') this.setView('sql');
    this.running = { started: performance.now() };
    this.editor.markError(0);
    this.#renderRunButton();
    this.#renderResult();
    const onProgress = () => this.running && this.db.state.status !== 'ready' && this.#renderResult();
    this.db.addEventListener('change', onProgress);
    clearTimeout(this.#stopTimer);
    this.#stopTimer = setTimeout(() => this.#renderRunButton(), 1250);
    let result;
    try {
      result = { ...(await this.db.run(text, user)), sql: text, user: user.id, fresh: !quiet };
    } catch (error) {
      result = error.stopped
        ? { ok: false, stopped: true, ms: performance.now() - this.running.started, sql: text, user: user.id }
        : { ok: false, ms: NaN, sql: text, user: user.id, error: { message: error.message || 'Postgres isn’t available.', code: '' } };
    } finally {
      this.db.removeEventListener('change', onProgress);
      clearTimeout(this.#stopTimer);
      this.running = null;
    }
    this.replayNote = '';
    this.state.result = result;
    if (!result.ok && result.error?.position && sql === undefined && !this.editor.selection) {
      this.editor.markError(lineOf(text, result.error.position).line);
    }
    if (result.ok && !isReadOnly(text)) this.#record(text, user.id);
    this.#save();
    this.#renderRunButton();
    this.#renderResult();
    this.announce(summary(result));
    if (!quiet) this.dispatchEvent(new CustomEvent('result', { detail: result }));
    if (!isReadOnly(text)) await this.refresh();
    return result;
  }

  /** Runs SQL from a reply, as the current user, or as service_role for schema changes. */
  async runInline(sql) {
    const user = this.runAsFor(sql);
    const started = performance.now();
    let result;
    try {
      result = { ...(await this.db.run(sql, user)), sql, user: user.id };
    } catch (error) {
      result = error.stopped
        ? { ok: false, stopped: true, ms: performance.now() - started, sql, user: user.id }
        : { ok: false, ms: NaN, sql, user: user.id, error: { message: error.message || 'Postgres isn’t available.', code: '' } };
    }
    if (!isReadOnly(sql) && result.ok) {
      this.#record(sql, user.id);
      this.#save();
      await this.refresh();
      const done = { 'CREATE POLICY': 'Policy created.', 'DROP POLICY': 'Policy dropped.', 'ALTER POLICY': 'Policy changed.' }[commandOf(splitStatements(sql).at(-1)?.text ?? '')];
      if (done) this.toast(done, { label: 'Open policies', run: () => { this.setView('policies'); this.reveal(); } });
    }
    return result;
  }

  runAsFor(sql) {
    return changesSchema(sql) ? userById('service_role') : this.user;
  }

  openInEditor(sql) {
    this.state.snippet = null;
    this.fromAssistant = true;
    this.state.sql = sql;
    this.editor.value = sql;
    this.setView('sql');
    this.#renderSide();
    this.#renderSnippetChips();
    this.#renderTab();
    this.#save();
    this.reveal();
    this.editor.focus();
    this.toast('Loaded into the editor. Run it with ⌘↵ or the Run button.');
  }

  /** Stops whatever is running, from the editor or from an answer. */
  async stop() {
    if (!this.db.running) return;
    this.toast('Stopping: Postgres restarts and replays your changes…');
    await this.db.stop();
  }

  async reset() {
    this.#closePopover();
    this.el.reset.disabled = true;
    try {
      if (this.db.state.status === 'idle') await this.db.start();
      await this.db.reset();
      this.state.off = [];
      this.state.rlsOff = [];
      this.state.journal = [];
      this.replayNote = '';
      this.state.result = null;
      this.#save();
      this.toast('Fresh database: back to the seed.');
      await this.refresh();
      this.render();
    } catch {
      this.toast('Couldn’t reset. Try again in a moment.');
    } finally {
      this.el.reset.disabled = false;
    }
  }

  async togglePolicy(p, on) {
    try {
      if (on) {
        await this.db.admin(p.sql);
        this.#record(p.sql, 'owner');
        this.state.off = this.state.off.filter((x) => x.name !== p.name);
      } else {
        const sql = this.policyDefinition(p);
        const drop = `drop policy ${ident(p.name)} on ${ident(p.table)};`;
        await this.db.admin(drop);
        this.#record(drop, 'owner');
        this.state.off = [...this.state.off.filter((x) => x.name !== p.name), { name: p.name, table: p.table, command: p.cmd, sql }];
      }
      this.#save();
      this.toast(on ? `“${p.name}” is on again.` : `“${p.name}” is off. Run your query again to see the difference.`);
    } catch (error) {
      this.toast(`Couldn’t change the policy: ${error.message}`);
    }
    await this.refresh();
  }

  async setRls(table, on) {
    try {
      const sql = `alter table ${ident(table)} ${on ? 'enable' : 'disable'} row level security;`;
      await this.db.admin(sql);
      this.#record(sql, 'owner');
      this.state.rlsOff = on ? this.state.rlsOff.filter((t) => t !== table) : [...new Set([...this.state.rlsOff, table])];
      this.#save();
      this.toast(on ? `RLS is on for ${table}.` : `RLS is off for ${table}: every role with a grant sees every row.`);
    } catch (error) {
      this.toast(`Couldn’t change RLS: ${error.message}`);
    }
    await this.refresh();
  }

  /** The policy as SQL: the seed's tidy version when unchanged, else rebuilt from the catalog. */
  policyDefinition(p) {
    const seed = POLICIES.find((x) => x.name === p.name && x.table === p.table);
    if (seed && this.#seedSignatures.get(p.name) === signature(p)) return policySql(seed);
    return [
      `create policy ${ident(p.name)}`,
      `on ${ident(p.table)}${p.permissive && p.permissive !== 'PERMISSIVE' ? ` as ${p.permissive.toLowerCase()}` : ''} for ${String(p.cmd).toLowerCase()}`,
      `to ${[].concat(p.roles ?? ['public']).join(', ')}`,
      ...(p.qual ? [`using (${p.qual})`] : []),
      ...(p.with_check ? [`with check (${p.with_check})`] : []),
    ].join('\n') + ';';
  }

  /** Reads tables, counts and policies again, as the current user. */
  async refresh() {
    if (!this.db.ready) return;
    const token = ++this.#refreshing;
    try {
      const schema = await this.db.inspect(this.user, this.state.view === 'tables' ? this.state.table : null);
      if (token !== this.#refreshing) return;
      this.schema = schema;
      if (this.state.view === 'tables' && !schema.tables.some((t) => t.name === this.state.table)) this.state.table = schema.tables[0]?.name ?? '';
      this.#renderSide();
      if (this.state.view !== 'sql') this.#renderView();
      else this.#renderResult();
      this.dispatchEvent(new Event('schema'));
    } catch {
      // The next action tries again.
    }
  }

  // Context for the assistant ------------------------------------------------

  #baseContext(userId) {
    const user = userById(userId);
    return { user: user.id, userLabel: user.label, changes: this.changes() };
  }

  contextFor(result) {
    return { ...this.#baseContext(result.user), outcome: outcomeOf(result), sql: result.sql };
  }

  /** What differs from the seed, in a few words, so answers don't assume the default policies. */
  changes() {
    const parts = [];
    if (this.state.rlsOff.length) parts.push(`RLS off on ${this.state.rlsOff.join(', ')}`);
    for (const p of this.state.off) parts.push(`"${p.name}" off`);
    const custom = this.schema.policies.filter((p) => !POLICIES.some((x) => x.name === p.name)).length;
    if (custom) parts.push(`${plural(custom, 'new policy', 'new policies')}`);
    return parts.join('; ');
  }

  /** The latest run's context: the assistant attaches it to questions typed in the composer. */
  latestContext() {
    const r = this.state.result;
    return r && !r.stopped ? this.contextFor(r) : null;
  }

  ask(question, context, options = {}) {
    this.dispatchEvent(new CustomEvent('ask', { detail: { question, context, ...options } }));
  }

  setAskStatus(status) {
    const changed = status.ready !== this.askStatus.ready || status.text !== this.askStatus.text;
    this.askStatus = status;
    if (changed) this.#renderView();
  }

  // References from replies -------------------------------------------------------

  /** Resolves a [[reference]] against what the page has: live tables and policies. */
  resolve(raw) {
    const ref = parseRef(raw);
    const tables = this.schema.tables.map((t) => t.name);
    const policies = [...this.schema.policies.map((p) => p.name), ...this.state.off.map((p) => p.name)];
    const find = (list) => list.find((n) => normalizeName(n) === ref.name);
    if (ref.kind !== 'policy' && find(tables)) return { kind: 'table', name: find(tables) };
    if (ref.kind !== 'table' && find(policies)) return { kind: 'policy', name: find(policies) };
    return null;
  }

  /** Shows what a reference names: a table's rows, or a policy, highlighted. */
  async goTo({ kind, name }) {
    this.dispatchEvent(new Event('navigate'));
    this.reveal();
    if (kind === 'table') {
      if (!this.schema.tables.some((t) => t.name === name)) return this.toast(`There’s no table called ${name} right now.`);
      await this.showTable(name);
      this.#flash(this.el.side.querySelector(`[data-table="${cssEscape(name)}"]`));
      this.#flash(this.el.views.tables.querySelector('.tv-head'));
      return;
    }
    await this.setView('policies');
    const item = this.el.views.policies.querySelector(`[data-policy="${cssEscape(normalizeName(name))}"]`);
    if (!item) return this.toast(`“${name}” isn’t in the database right now.`);
    const view = this.el.views.policies;
    const top = item.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 12;
    view.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    this.#flash(item);
  }

  #scrollToPolicyTable(table) {
    const card = this.el.views.policies.querySelector(`[data-table="${cssEscape(table)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    this.#flash(card);
  }

  #flash(el) {
    if (!el) return;
    el.classList.remove('is-target');
    void el.offsetWidth;
    el.classList.add('is-target');
  }

  /** Brings the dashboard's main area into view, for when the page has scrolled away. */
  reveal() {
    const rect = this.el.main.getBoundingClientRect();
    if (rect.top < 0 || rect.top > innerHeight * 0.6) {
      this.el.main.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  // Popovers: Run as, and snippets on narrow screens ------------------------------

  #openRoleMenu() {
    if (this.#popover?.kind === 'role') return this.#closePopover(true);
    const options = USERS.map((u) => h('button', {
      class: 'pop-option', type: 'button', role: 'option', 'aria-selected': String(u.id === this.state.user), tabindex: '-1', dataset: { id: u.id },
    }, avatar(u), h('span', { class: 'pop-text' }, h('span', { text: u.label }), h('small', { text: u.detail })), icon('check', 'pop-check')));
    const pop = h('div', { class: 'pop', role: 'listbox', 'aria-label': 'Run as' }, options);
    this.#showPopover('role', pop, this.el.runas, (id) => this.setUser(id), options.findIndex((o) => o.dataset.id === this.state.user));
  }

  #openSnippetMenu() {
    if (this.#popover?.kind === 'snippets') return this.#closePopover(true);
    const options = SNIPPETS.map((s) => h('button', { class: 'pop-option', type: 'button', role: 'menuitem', tabindex: '-1', dataset: { id: s.id } },
      icon('doc'), h('span', { class: 'pop-text' }, h('span', { text: s.title }), h('small', { text: `as ${userById(s.as).label}` }))));
    const pop = h('div', { class: 'pop', role: 'menu', 'aria-label': 'Snippets' }, options);
    this.#showPopover('snippets', pop, this.el.snippets, (id) => this.loadSnippet(id), Math.max(0, SNIPPETS.findIndex((s) => s.id === this.state.snippet)));
  }

  #showPopover(kind, pop, anchor, choose, active) {
    this.#closePopover();
    const options = [...pop.querySelectorAll('.pop-option')];
    const main = this.el.main.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    this.el.main.append(pop);
    const below = a.bottom - main.top + 6;
    const fitsBelow = below + pop.offsetHeight < main.height;
    pop.style.top = `${fitsBelow ? below : Math.max(8, a.top - main.top - pop.offsetHeight - 6)}px`;
    pop.style.left = `${Math.max(8, Math.min(a.left - main.left, main.width - pop.offsetWidth - 8))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    let index = Math.max(0, active);
    const focus = () => {
      options.forEach((o, i) => o.classList.toggle('is-active', i === index));
      options[index]?.focus();
    };
    const close = (restore) => this.#closePopover(restore);
    pop.addEventListener('click', (e) => {
      const option = e.target.closest('.pop-option');
      if (!option) return;
      close(true);
      choose(option.dataset.id);
    });
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        index = (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        index = e.key === 'Home' ? 0 : options.length - 1;
        focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') {
        close(false);
      }
    });
    const outside = (e) => {
      if (!pop.contains(e.target) && !anchor.contains(e.target)) close(false);
    };
    setTimeout(() => document.addEventListener('pointerdown', outside), 0);
    this.#popover = { kind, pop, anchor, outside };
    focus();
  }

  #closePopover(restoreFocus = false) {
    const p = this.#popover;
    if (!p) return;
    this.#popover = null;
    document.removeEventListener('pointerdown', p.outside);
    p.anchor.setAttribute('aria-expanded', 'false');
    p.pop.remove();
    if (restoreFocus) p.anchor.focus();
  }

  // Housekeeping ------------------------------------------------------------------

  #onDbChange() {
    const was = this.lastStatus;
    const now = this.db.state.status;
    this.lastStatus = now;
    this.#renderStatus();
    if (this.running) this.#renderRunButton();
    if (now === 'ready' && was !== 'ready') this.#onReady();
  }

  async #onReady() {
    await this.refresh();
    this.render();
    if (this.readyOnce) return; // Restarted after Stop: the changes were replayed.
    this.readyOnce = true;
    this.announce(`Postgres ${this.db.state.version} is running in this tab.`);
    // The seeded example becomes a real run, if nothing has changed since.
    if (this.state.result?.seeded && this.state.sql === HERO.sql && this.state.user === HERO.as) {
      await this.run({ sql: HERO.sql, quiet: true });
    }
  }

  // A fresh Postgres: replay the changes made since the seed, in order, before
  // anything else runs. Signatures of the seeded policies are taken first.
  async #replay(api) {
    const seed = await api.run(`select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public'`, userById('service_role')).catch(() => null);
    if (seed?.ok) this.#seedSignatures = new Map(seed.rows.map(([name, cmd, qual, check]) => [name, signature({ cmd, qual, with_check: check })]));
    const entries = this.state.journal;
    if (!entries.length) return;
    let done = 0;
    for (const entry of entries) {
      const result = entry.user === 'owner'
        ? await api.admin(entry.sql).then(() => ({ ok: true }), () => ({ ok: false }))
        : await api.run(entry.sql, userById(entry.user)).catch(() => ({ ok: false }));
      if (!result.ok) break;
      done++;
    }
    if (done < entries.length) {
      this.state.journal = entries.slice(0, done);
      this.#save();
    }
    this.replayNote = done === entries.length
      ? `Postgres started fresh in this tab and replayed your ${plural(done, 'change')}.`
      : `Postgres started fresh and replayed ${done} of your ${plural(entries.length, 'change')}; the rest didn’t apply again.`;
  }

  #record(sql, user) {
    const journal = [...this.state.journal, { sql, user }];
    // Keeps sessionStorage small: very long sessions stop recording.
    if (JSON.stringify(journal).length < 60000) this.state.journal = journal;
  }

  toast(text, action) {
    clearTimeout(this.#toastTimer);
    this.el.main.querySelector('.toast')?.remove();
    const toast = h('div', { class: 'toast', role: 'status' }, icon('check'), h('span', { text }));
    if (action) toast.append(h('button', { class: 'btn btn-secondary btn-xs', type: 'button', onclick: () => { toast.remove(); action.run(); } }, action.label));
    this.el.main.append(toast);
    this.#toastTimer = setTimeout(() => toast.remove(), action ? 6000 : 3600);
  }

  announce(text) {
    this.dispatchEvent(new CustomEvent('announce', { detail: text }));
  }

  #saveTimer = 0;
  #saveSoon() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#save(), 400);
  }

  #save() {
    clearTimeout(this.#saveTimer);
    const { result, ...rest } = this.state;
    store.set(KEY, { ...rest, result: result ? trimResult(result) : null });
  }
}

// Helpers -----------------------------------------------------------------------

function staticSchema(state) {
  return {
    tables: TABLES.map((t) => ({ name: t.name, rls: !state.rlsOff.includes(t.name), columns: t.columns.map(([name, type]) => ({ name, type })) })),
    policies: POLICIES.filter((p) => !state.off.some((o) => o.name === p.name)).map((p) => ({
      table: p.table, name: p.name, cmd: p.command, roles: ['authenticated'], permissive: 'PERMISSIVE', qual: p.using ?? null, with_check: p.check ?? null,
    })),
    view: null,
  };
}

function outcomeOf(r) {
  if (!r.ok) return { kind: 'error', code: r.error?.code ?? '', message: r.error?.message ?? 'failed' };
  if (r.fields?.length) return { kind: 'rows', count: r.rowCount };
  return { kind: 'command', command: r.command || 'OK', affected: r.affected };
}

function commandText(r) {
  if (/^(INSERT|UPDATE|DELETE|MERGE)$/.test(r.command)) return `${r.command} ${r.affected}: ${plural(r.affected, 'row')} affected.`;
  return r.command ? `${r.command} done.` : 'No rows returned.';
}

function summary(r) {
  if (r.stopped) return 'Query stopped.';
  if (!r.ok) return `Query failed: ${r.error?.message ?? ''}`;
  if (r.fields?.length) return `${plural(r.rowCount, 'row')} returned as ${userById(r.user).label}.`;
  return `Success. ${commandText(r)}`;
}

function isReadOnly(sql) {
  const statements = splitStatements(sql);
  return statements.length > 0 && statements.every((s) => READ_ONLY.has(commandOf(s.text)));
}

function trimResult(r) {
  return { ...r, rows: (r.rows ?? []).slice(0, 50), fresh: false };
}

const signature = (p) => `${p.cmd}|${p.qual ?? ''}|${p.with_check ?? ''}`;
const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;
const cssEscape = (value) => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));
