// The page's own interactive blocks: the fill-in notes about the visitor's team,
// drawn as page properties, and the Plans database with its Table and Board views.

import { openListbox } from './menus.js';
import { escapeHtml } from './util.js';

/**
 * Fill-in properties. Returns { values, set }: values() is
 * { size, tools: [], moving, mustNot } for the notes that travel with questions.
 */
export function initProps(el, saved = {}, onChange = () => {}) {
  const props = [...el.querySelectorAll('.prop')];
  const state = { size: [], tools: [], moving: [], mustNot: '' };

  for (const prop of props) {
    const key = prop.dataset.prop;
    const type = prop.dataset.type;
    if (type === 'text') {
      const field = prop.querySelector('.prop-text');
      try {
        field.contentEditable = 'plaintext-only';
      } catch {
        field.contentEditable = 'true';
      }
      field.tabIndex = 0;
      field.addEventListener('input', () => {
        state[key] = field.textContent.slice(0, 200);
        field.classList.toggle('is-empty', !field.textContent);
        if (!field.textContent && field.innerHTML) field.innerHTML = '';
        onChange();
      });
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          field.blur();
        }
      });
      continue;
    }
    const options = JSON.parse(prop.querySelector('.prop-options').textContent).map(([value, color]) => ({ value, color }));
    const button = prop.querySelector('.prop-btn');
    button.addEventListener('click', () => {
      button.setAttribute('aria-expanded', 'true');
      openListbox({
        anchor: button,
        label: prop.dataset.label,
        options,
        selected: state[key],
        multi: type === 'multi',
        returnFocus: button,
        onClose: () => button.setAttribute('aria-expanded', 'false'),
        onChange: (values) => {
          state[key] = values;
          draw(prop);
          onChange();
        },
      });
    });
  }

  function draw(prop) {
    const key = prop.dataset.prop;
    if (prop.dataset.type === 'text') {
      const field = prop.querySelector('.prop-text');
      if (field.textContent !== state[key]) field.textContent = state[key];
      field.classList.toggle('is-empty', !field.textContent);
      return;
    }
    const options = JSON.parse(prop.querySelector('.prop-options').textContent);
    const color = (value) => options.find(([v]) => v === value)?.[1] ?? 'gray';
    const button = prop.querySelector('.prop-btn');
    button.innerHTML = state[key].length
      ? state[key].map((v) => `<span class="tag" data-color="${color(v)}">${escapeHtml(v)}</span>`).join('')
      : '<span class="prop-empty">Empty</span>';
  }

  function set(values = {}) {
    const known = (key, list) => {
      const prop = props.find((p) => p.dataset.prop === key);
      const options = prop ? JSON.parse(prop.querySelector('.prop-options')?.textContent ?? '[]').map(([v]) => v) : [];
      return (Array.isArray(list) ? list : []).filter((v) => options.includes(v));
    };
    state.size = known('size', values.size).slice(0, 1);
    state.tools = known('tools', values.tools);
    state.moving = known('moving', values.moving).slice(0, 1);
    state.mustNot = typeof values.mustNot === 'string' ? values.mustNot.slice(0, 200) : '';
    props.forEach(draw);
  }

  set(saved);
  return {
    set,
    /** What's saved with the page. */
    state: () => ({ ...state }),
    /** The notes, flattened for the conversation. */
    values: () => ({ size: state.size[0] ?? '', tools: state.tools, moving: state.moving[0] ?? '', mustNot: state.mustNot.trim() }),
  };
}

/** The Plans database: Table and Board views, as tabs. */
export function initDatabase(el, saved = {}, onChange = () => {}) {
  const tabs = [...el.querySelectorAll('.db-tab')];
  const db = el.querySelector('.db');
  function show(view, focus = false) {
    for (const tab of tabs) {
      const on = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      el.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
      if (on && focus) tab.focus();
    }
    db.dataset.view = view;
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      show(tab.dataset.view);
      onChange();
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      show(next.dataset.view, true);
      onChange();
    });
  }
  show(saved.view === 'board' ? 'board' : 'table');
  return { state: () => ({ view: db.dataset.view }) };
}
