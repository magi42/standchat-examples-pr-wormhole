// The visitor's stack: apps they added from search, app cards or answers.
// It isn't in the transcript until a message mentions it, so it's kept in
// sessionStorage under this example's prefix, per tab.

import { APP_BY_ID } from './catalog.js';

const KEY = 'search-that-talks:v1:ui';
const listeners = new Set();
let state = load();

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    return {
      stack: Array.isArray(saved.stack) ? saved.stack.filter((id) => APP_BY_ID.has(id)).slice(0, 12) : [],
      demoSeen: saved.demoSeen === true,
    };
  } catch {
    return { stack: [], demoSeen: false }; // Storage can be denied: the page still works for this visit.
  }
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Denied or full: keep going in memory.
  }
}

function set(patch) {
  state = { ...state, ...patch };
  save();
  for (const fn of [...listeners]) fn(state);
}

export const stack = {
  get ids() {
    return state.stack;
  },
  get apps() {
    return state.stack.map((id) => APP_BY_ID.get(id));
  },
  has: (id) => state.stack.includes(id),
  add(id) {
    if (!APP_BY_ID.has(id) || state.stack.includes(id)) return false;
    set({ stack: [...state.stack, id].slice(-12) });
    return true;
  },
  remove(id) {
    set({ stack: state.stack.filter((x) => x !== id) });
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // Whether this tab has already played the example search in the hero.
  get demoSeen() {
    return state.demoSeen;
  },
  markDemoSeen() {
    if (!state.demoSeen) set({ demoSeen: true });
  },
};
