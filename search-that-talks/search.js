// The directory search: instant, forgiving, and honest about "no match".
// No DOM here. search() ranks apps for a query; isQuestion() spots a query
// that is really a question, so the box can offer to ask it instead.

import { APPS, CATEGORY_BY_ID, POPULAR } from './catalog.js';

// Ties go to the apps people pick most.
const rank = (app) => (POPULAR.includes(app.id) ? POPULAR.indexOf(app.id) : POPULAR.length);

export const normalize = (text) => String(text).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// Words that say what someone wants, not which app they mean.
const STOP = new Set(('a an the to for with and or of on in into from my our your me i we you it its is are be '
  + 'do does can could how what which app apps tool tools integration integrations integrate connect connecting '
  + 'connection sync syncing automate automation workflow workflows hookline via by at as that this there any '
  + 'some if when please vs between both way ways').split(' '));
// Verbs that start half the triggers and actions: they count, but only a little.
const WEAK = new Set('new add get send create update find make set use using post run'.split(' '));

const WEIGHTS = { name: 10, keywords: 6, category: 5, events: 4, blurb: 2 };

const INDEX = APPS.map((app) => ({
  app,
  name: normalize(app.name),
  fields: {
    name: normalize(app.name).split(' '),
    keywords: normalize(app.keywords).split(' ').filter(Boolean),
    category: normalize(CATEGORY_BY_ID.get(app.category).label).split(' '),
    blurb: normalize(app.blurb).split(' '),
  },
  events: [
    ...app.triggers.map((t) => ({ kind: 'Trigger', label: t.name, instant: t.instant, text: normalize(t.name) })),
    ...app.actions.map((a) => ({ kind: 'Action', label: a, text: normalize(a) })),
  ].map((e) => ({ ...e, words: e.text.split(' ') })),
}));

/** Query words worth matching, without the filler. */
export function terms(query) {
  return normalize(query).split(' ').filter((t) => t && !STOP.has(t));
}

/**
 * Ranks apps for a query. Returns { results, good, closest, words }:
 * - results: [{ app, score, event? }] best first (event: the trigger or action that matched)
 * - good: every meaningful word points at an app's name, keywords, category or events
 * - closest: the best partial matches, for the "no match" state
 */
export function search(query, { category = null, limit = 8 } = {}) {
  const pool = category ? INDEX.filter((e) => e.app.category === category) : INDEX;
  const whole = normalize(query);
  const words = terms(query);

  // One or two letters: names that start with them, or a short word like "AI" or "HR".
  if (whole.length <= 2) {
    const results = whole ? pool
      .filter((e) => e.fields.name.some((w) => w.startsWith(whole)) || e.fields.category.includes(whole) || e.fields.keywords.includes(whole))
      .sort((a, b) => rank(a.app) - rank(b.app) || a.app.name.localeCompare(b.app.name))
      .map((e) => ({ app: e.app, score: 1, event: null })).slice(0, limit) : [];
    return { results, good: results.length > 0, closest: [], words };
  }
  if (!words.length) return { results: [], good: false, closest: [], words };

  const needed = words.some((w) => !WEAK.has(w)) ? words.filter((w) => !WEAK.has(w)) : words;
  const covered = new Set();
  const scored = [];
  for (const entry of pool) {
    let score = 0;
    let strongWords = 0;
    let event = null; // the trigger or action behind the best event match
    let eventScore = 0;
    let nameHit = false;
    for (const word of words) {
      let best = 0;
      let strong = false;
      for (const field of ['name', 'keywords', 'category', 'blurb']) {
        const s = strength(word, entry.fields[field], field);
        if (s.value * WEIGHTS[field] > best) [best, strong] = [s.value * WEIGHTS[field], s.strong && field !== 'blurb'];
        if (field === 'name' && s.strong) nameHit = true;
      }
      for (const e of entry.events) {
        const s = strength(word, e.words, 'events');
        const value = s.value * WEIGHTS.events;
        if (value > best) [best, strong] = [value, s.strong];
        if (s.strong && value > eventScore) [eventScore, event] = [value, e];
      }
      score += WEAK.has(word) ? best / 2 : best;
      if (strong && best) {
        strongWords += WEAK.has(word) ? 0 : 1;
        covered.add(word);
      }
    }
    if (!score) continue;
    // A trigger or action named by the whole query, like "new order".
    const phrase = words.length > 1 && entry.events.find((e) => e.text.includes(words.join(' ')));
    if (phrase) [score, event] = [score + 6, phrase];
    if (entry.name === whole) score += 20;
    else if (entry.name.startsWith(whole)) score += 8;
    scored.push({ app: entry.app, score, event: nameHit ? null : event, strongWords: strongWords || (phrase ? 1 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || rank(a.app) - rank(b.app) || a.app.name.localeCompare(b.app.name));

  const good = needed.every((w) => covered.has(w)) && scored.some((s) => s.strongWords > 0);
  const results = scored.filter((s) => s.strongWords > 0).slice(0, limit);
  const closest = scored.filter((s) => s.app.category !== 'builtin').slice(0, 2).map((s) => s.app);
  return { results, good, closest, words };
}

/** Apps whose names start with a letter, for the footer's A–Z. */
export function byLetter(letter) {
  return APPS.filter((a) => a.name.toLowerCase().startsWith(letter.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Apps in a category. */
export function inCategory(category) {
  return APPS.filter((a) => a.category === category);
}

/** Catalog apps named in free text, in order of appearance. */
export function mentionedApps(text) {
  const n = ` ${normalize(text)} `;
  return INDEX.map((e) => ({ app: e.app, at: n.indexOf(` ${e.name} `) }))
    .filter((e) => e.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((e) => e.app);
}

const QUESTION_START = /^(can|could|how|what|whats|why|when|where|which|who|is|are|does|do|did|will|would|should|may|any|anyone|need|want|looking|help|i|im|we|were|my|our|trying|tell|explain|compare|difference|hi|hello|hey|thanks)\b/;

/** Reads like a question or a request, rather than an app name. */
export function isQuestion(query) {
  const text = String(query).trim();
  if (!text) return false;
  if (/\?\s*$/.test(text)) return true;
  const words = normalize(text).split(' ').filter(Boolean);
  if (words.length >= 3 && QUESTION_START.test(words.join(' '))) return true;
  return words.length >= 6;
}

// How well one query word matches a list of words. Exact, prefix and
// inside-a-word matches work everywhere; typos only in names and keywords,
// so "pipwell" finds Pipewell but "acme" never finds "accepted".
function strength(word, list, field) {
  const typos = field === 'name' || field === 'keywords';
  let best = { value: 0, strong: false };
  const take = (value, strong) => {
    if (value > best.value) best = { value, strong };
  };
  for (const w of list) {
    if (!w) continue;
    if (w === word) return { value: 1, strong: true };
    if (w.startsWith(word)) take(word.length >= 3 ? 0.85 : 0.6, word.length >= 3 || w.length <= 3);
    else if (field !== 'blurb' && word.length >= 3 && w.includes(word)) take(0.6, word.length >= 4);
    else if (typos && word.length >= 5 && Math.abs(word.length - w.length) <= 1 && distance(word, w) <= 1) take(0.55, true);
    else if (field === 'name' && word.length >= 4 && w.length > word.length && distance(word, w.slice(0, word.length)) <= 1) take(0.5, true);
    else if (typos && word.length >= 8 && Math.abs(word.length - w.length) <= 1 && distance(word, w) <= 2) take(0.45, true);
    else if ((field === 'keywords' || field === 'category') && w.length >= 4 && word.startsWith(w)) take(0.3, false);
  }
  return best;
}

// Optimal string alignment distance: insertions, deletions, substitutions, swaps.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
