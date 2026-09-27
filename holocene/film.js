// The director. Plays the film: the score is the clock (score.js), the
// projector draws the pictures (projector.js and the scene files), and this
// file puts everything else on its beats: titles, the year counter, the
// narrator's lines, the questions, the viewer's answers and the credits.
//
// The narrator is a Stand conversation. Stand's greeting asks the viewer's
// name, the name is the first message and starts the conversation, and the
// private `prompt` tells the Stand-in it is narrating this film. The narrator
// asks where the viewer is watching from, and every answer the viewer gives is
// sent as a message. Every reply becomes a subtitle.
//
// Replies can end with a tag in double braces that the viewer never sees: the
// place's climate through the ages, {{place=Helsinki|ice=…|1900=…}}, or how much
// the viewer meant by an answer, {{amount=50}}. That is how "only half" clears
// half the forest.
// If a person from the team joins, their lines are subtitles too, with their
// name. After the credits the conversation is shown as a screenplay, and the
// viewer can keep talking.
//
// Without Stand (offline, or nobody available), the film plays the same with
// the narrator's lines written below.

import { StandClient } from './stand-client.js';
import { Score } from './score.js';
import { Projector } from './projector.js';
import { SECTIONS, ORDER, YEARS, CO2, TEMP, SCENARIOS, lerpSeries } from './timeline.js';
import early from './scenes-early.js';
import industry from './scenes-industry.js';
import oil from './scenes-oil.js';
import future from './scenes-future.js';

const root = document.querySelector('[data-film]');
const $ = (selector) => root.querySelector(selector);

// Private context for the Stand-in: it narrates this film. Readable in the page
// source, like any prompt, so it holds nothing secret.
const PROMPT = `You narrate HOLOCENE, an interactive film on this page: a wordless time-lapse of Earth's climate from the last ice age to 2026, then one possible 2100. Your words appear as subtitles.

Voice: plain text, one or two short sentences, at most 25 words. Calm, grave, factual, personal. No markdown, emoji or links.

Some replies end with a tag in double braces. The page reads and hides it. Never mention it.

1. First message: the viewer's name, or a refusal. Welcome them, by name if given, and ask where in the world they are watching from.
2. Second message: their place. One sentence about that place in the last ice age. Then a tag of true, specific, vivid facts about that region, each a full sentence under 18 words, none repeating your reply:
{{place=short name|ice=18,000 years ago|holocene=around 9000 BCE|1900=|2026=|better=in 2100 at +1.5 °C|worse=in 2100 at +4 °C}}
3. Film moments arrive as "year, moment: answer": "8000 BCE, the first fields" (how much forest to clear), "1900, the coal" (how much coal to burn), "1979, the sun" (how much to go back to oil instead of solar), "1988, the warning" (how long to wait before acting). One sentence, by name, on what that choice meant in real history. Then {{amount=N}}, N from 0 to 100 as the viewer meant it: forest cleared, coal burned, share back to oil, or delay, where 0 is acting at once, 25 is ten years, 100 is never. "Only half" is 50.
4. "2026, now: …": they pulled their projected 2100 warming down by holding. One closing line, by name, on what that means.
5. If they leave their email to talk about design, thank them warmly in one short sentence.
6. After the credits the page asks how the film felt. Their next message answers that: thank them, reply briefly and warmly.

The past on screen is real; answers only shape the ending. Otherwise answer briefly in the same voice. After the film, answer climate questions factually, following the IPCC.`;

const GREETING = 'Before the film begins: what is your name?';

// The opening credit, before the title. data-presents on the film's element sets it.
const PRESENTS = root.dataset.presents || '0c.design, in collaboration with Stand Chat, presents';

// The three questions. `amount` is what an answer means, 0 to 1: the share of
// the forest cleared, of the coal burned, or of forty years' delay.
const CHOICES = {
  fields: {
    moment: '8000 BCE, the first fields',
    question: '8000 BCE. The first farms. If it were your hand: how much of the forest would you clear for fields?',
    options: [
      { label: 'All of it', say: 'clear the forest', amount: 1 },
      { label: 'Farm within it', say: 'farm within the forest', amount: 0.1 },
    ],
  },
  coal: {
    moment: '1900, the coal',
    question: '1900. Coal is cheap, and the world is hungry. How much of it would you burn?',
    options: [
      { label: 'Only what we need', say: 'burn only what we need', amount: 0.3 },
      { label: 'All of it', say: 'burn it all', amount: 1 },
    ],
  },
  sun: {
    moment: '1979, the sun',
    question: '1979. Oil prices have tripled, and solar panels go up on the White House roof. Build on the sun, or go back to cheap oil?',
    options: [
      { label: 'Build on the sun', say: 'build on the sun', amount: 0.15 },
      { label: 'Back to oil', say: 'go back to cheap oil', amount: 1 },
    ],
  },
  warning: {
    moment: '1988, the warning',
    question: '1988. Scientists tell governments the planet is warming. Act now, or wait until everyone is certain?',
    options: [
      { label: 'Wait for certainty', say: 'wait for certainty', amount: 0.85 },
      { label: 'Act now', say: 'act now', amount: 0 },
    ],
  },
};

// An amount as a direction: 1 careful, -1 reckless.
const valueOf = (amount) => 1 - 2 * amount;
// For the warning, any real delay is named: only acting at once is careful.
const band = (amount, kind) => (amount < (kind === 'warning' ? 0.05 : 0.34) ? 1 : amount > 0.66 ? -1 : 0);

// The coda: after the last line, before the credits, an invitation to talk.
// Each site can set its own words with data-coda-line, data-coda-offer and
// data-coda-note on the film's element.
const CODA = {
  line: root.dataset.codaLine || 'The climate turns on small decisions, made by the right people, at the right time.',
  turn: root.dataset.codaTurn || 'In the age of AI, design can help people make those decisions better.',
  offer: root.dataset.codaOffer || 'If you’d like to talk about what that could mean for your work, leave your email. We’ll write to you once, in person.',
  note: root.dataset.codaNote || 'Your email reaches the team through this conversation. Nothing else is sent.',
};

// After the credits, above the screenplay's input.
const AFTER = 'The film is over. How did it feel to watch it?';

// The narrator's lines when Stand is not there.
const OFFLINE = {
  welcome: (name) => `Welcome${name ? `, ${name}` : ''}. The film begins.`,
  fields: {
    1: 'Forests kept standing keep holding carbon. Your future starts with more of them.',
    [-1]: 'Clearing forests was humanity’s first great release of carbon. Your future remembers it.',
  },
  coal: {
    1: 'Coal built the modern world. Burning less of it would have spared centuries of heat.',
    [-1]: 'Coal built the modern world, and every tonne of it is still warming the air.',
  },
  sun: {
    1: 'In 1986 those panels came down. In your film, the sun keeps rising on the roofs.',
    [-1]: 'In 1986 the White House panels came down, and the oil kept flowing.',
  },
  warning: {
    1: 'The warning was clear in 1988. Acting on it is the choice that matters most.',
    [-1]: 'More carbon has been burned since 1988 than in all the years before it.',
  },
  final: {
    better: (name) => `You chose restraint${name ? `, ${name}` : ''}. Remember that it is still possible.`,
    middle: (name) => `Some of it was saved${name ? `, ${name}` : ''}. The rest is still being decided.`,
    worse: (name) => `This is one future${name ? `, ${name}` : ''}, not the only one. It is still being chosen.`,
  },
  // Answers in between, in the viewer's own words.
  between: {
    fields: (a) => `About ${Math.round(a * 100)}% of the forest falls for fields. The rest keeps holding its carbon.`,
    coal: (a) => `About ${Math.round(a * 100)}% of the coal is burned. Every tonne of it still warms the air.`,
    sun: (a) => `About ${Math.round(a * 100)}% back to oil. The rest of the roofs keep their panels.`,
    warning: (a) => `${Math.round(a * 40)} years of waiting. The air keeps filling while the world decides.`,
  },
  silence: 'No answer. Silence is also a choice.',
  place: 'Where in the world are you watching from?',
};

// How much an answer in the viewer's own words means, when the narrator can't
// say: "half" is 0.5, "30%" is 0.3, "ten years" of delay is 0.25.
const WORDS = { none: 0, nothing: 0, no: 0, little: 0.15, 'a bit': 0.15, some: 0.3, third: 0.33, quarter: 0.25, half: 0.5, most: 0.8, 'almost all': 0.9, all: 1, everything: 1 };
const NUMBERS = { a: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50 };

function estimate(kind, text) {
  const words = text.toLowerCase().replace(/[’‘]/g, "'");
  const percent = words.match(/(\d{1,3})\s*(%|percent)/);
  if (percent) return Math.min(1, Number(percent[1]) / 100);
  if (kind === 'warning') {
    if (/\b(now|immediately|at once|today|right away)\b/.test(words) && !/\bnot\b/.test(words)) return 0;
    if (/\bnever\b/.test(words)) return 1;
    const years = words.match(/\b(\d{1,3}|a|one|two|three|five|ten|twenty|thirty|forty|fifty)\s+(more\s+)?(years?|decades?)/);
    if (years) {
      const n = Number(years[1]) || NUMBERS[years[1]];
      return Math.min(1, (years[3].startsWith('decade') ? n * 10 : n) / 40);
    }
  }
  for (const [word, amount] of Object.entries(WORDS).sort((x, y) => y[0].length - x[0].length)) {
    if (new RegExp(`\\b${word}\\b`).test(words)) return amount;
  }
  const direction = lean(text);
  return direction > 0 ? 0.15 : direction < 0 ? 0.85 : 0.5;
}

// Tags in the narrator's replies: {{place=Helsinki|ice=…}} or {{amount=50}}.
// They're read, then hidden, even while a reply is still streaming in.
function readTags(body) {
  const tags = {};
  for (const [, inner] of body.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    for (const part of inner.split('|')) {
      const i = part.indexOf('=');
      if (i > 0) tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
  }
  return tags;
}
const untagged = (body) => body.replace(/\{\{[\s\S]*?(\}\}|$)/g, '').replace(/\{$/, '').trim();

// Words that lean an answer one way or the other, for answers in the viewer's own words.
// A negation just before a word turns it around: "don't burn it", "never wait".
const CAREFUL = /^(keep|kept|protect|save|spare|within|tend|less|only|need|some|little|stop|act|now|slow|renew\w*|plant|sustain\w*|careful|limit|reduce|leave|nothing|forest)$/;
const RECKLESS = /^(clear|cut|burn|all|more|everything|wait|later|delay|fast|faster|grow|growth|profit|progress|money|cheap|certain\w*|full|max\w*)$/;
const NEGATION = /^(no|not|never|don't|dont|do not|won't|can't|shouldn't)$/;

function lean(text) {
  const words = text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z']+/g) || [];
  let score = 0;
  words.forEach((word, i) => {
    const sign = CAREFUL.test(word) ? 1 : RECKLESS.test(word) ? -1 : 0;
    if (!sign) return;
    const negated = words.slice(Math.max(0, i - 2), i).some((w) => NEGATION.test(w));
    score += negated ? -sign : sign;
  });
  return Math.sign(score);
}

// The name to put in the credits: "I'm Ana" → "Ana".
function nameFrom(text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  const match = clean.match(/\b(?:i['’]?m|i am|my name is|name['’]?s|call me|it['’]?s|this is)\s+([^\s,.!?]+(?:\s[A-Z][^\s,.!?]*)?)/i);
  const name = (match ? match[1] : clean).replace(/[.!?,]+$/, '');
  return name.slice(0, 40) || 'Viewer';
}

const formatYear = (year) => {
  const y = Math.round(year);
  if (y < 0) {
    const rounded = Math.round(-y / 100) * 100;
    return `${rounded.toLocaleString('en-US')} BCE`;
  }
  return String(y);
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const readingTime = (text) => 1800 + text.split(/\s+/).length * 320;

// --- The film's state -------------------------------------------------------

const film = {
  started: false,
  ended: false,
  userPaused: false,
  name: '',
  offline: false,
  choices: { fields: null, coal: null, sun: null, warning: null }, // 1 careful … -1 reckless
  amounts: { fields: null, coal: null, sun: null, warning: null }, // 0 … 1, see CHOICES
  start: null, // the projected 2100 warming the viewer's answers lead to, °C
  projected: null, // the same, as the viewer holds it down in `now`
  place: null, // { place, ice, holocene, 1900, 2026, better, worse } from the narrator
  placeStep: null, // null → 'asking' → 'answered' → 'done'
  measuring: null, // { kind, words, at } while the narrator weighs an answer
  answers: {}, // section → the viewer's words
  answeredAt: {}, // section → { beat, time } when answered
  hold: 0, // seconds held during `now`
  holdSpan: 0, // seconds of `now` that count
  holding: false,
  holdLevel: 0,
  flow: 0,
  outcome: null,
  finalLine: null,
  scenario: null,
  awaitingFinal: false,
  section: null,
  sectionInstance: 0,
  fired: new Set(),
  lastTime: 0,
  exitQueued: false,
  log: [], // the film's own transcript, for the screenplay without Stand
};

function remember(senderType, body) {
  film.log.push({ senderType, body });
}

const score = new Score();
const projector = new Projector($('.holo-canvas'), [...early, ...industry, ...oil, ...future]);
const client = new StandClient({
  siteId: root.dataset.standId || 'demo',
  greeting: GREETING,
  prompt: PROMPT,
  analyticsId: 'holocene-film',
});

// --- Stand: the narrator ------------------------------------------------------

const forcedOffline = new URLSearchParams(location.search).has('offline');
const outbox = [];
const shown = new Set(); // message IDs already put on screen

function say(text) {
  outbox.push(text);
  flush();
}

let flushing = false; // setDraft notifies subscribers, which call flush again
let retryTimer;
function flush() {
  const s = client.state;
  if (flushing || s.busy || !['available', 'active'].includes(s.phase)) return;
  if (s.pending) {
    // A send that failed: retry it, with the same ID, after a pause.
    if (s.error && !retryTimer) retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void client.send();
    }, 3000);
    return;
  }
  if (!outbox.length) return;
  flushing = true;
  try {
    client.setDraft(outbox.shift());
    void client.send();
  } finally {
    flushing = false;
  }
}

// Online means a responder is there, or the conversation is running.
const online = () => !film.offline && ['available', 'active', 'loading'].includes(client.state.phase);


// --- On screen: subtitles, titles, the counter -------------------------------

const line = $('.holo-line');
const live = $('.holo-live');
let subtitleTimer;

let subtitleEnds = 0; // when the current subtitle fades, for pausing

let questionText = ''; // the open question, shown again after a reply to something else

function fadeSubtitleIn(ms) {
  clearTimeout(subtitleTimer);
  subtitleEnds = performance.now() + ms;
  subtitleTimer = setTimeout(() => {
    subtitleEnds = 0;
    if (questionText && answering) subtitle(questionText, '', { question: true });
    else line.classList.remove('is-on');
  }, ms);
}

function subtitle(text, speaker = '', { streaming = false, hold = false, question = false } = {}) {
  clearTimeout(subtitleTimer);
  subtitleEnds = 0;
  line.querySelector('.holo-speaker').textContent = speaker ? `${speaker}` : '';
  line.querySelector('.holo-text').textContent = text;
  line.classList.toggle('is-question', question);
  if (question) questionText = text;
  line.classList.add('is-on');
  if (!streaming) live.textContent = speaker ? `${speaker}: ${text}` : text;
  if (!hold && !streaming && !question) fadeSubtitleIn(readingTime(text) + 2500);
}

function clearSubtitle() {
  clearTimeout(subtitleTimer);
  line.classList.remove('is-on');
}

function card(html, { className = '', beats = 0 } = {}) {
  const el = $('.holo-card');
  el.className = `holo-card ${className}`;
  el.innerHTML = html;
  requestAnimationFrame(() => el.classList.add('is-on'));
  if (beats) {
    const seconds = (beats * 60) / SECTIONS[film.section].bpm;
    setTimeout(() => el.classList.remove('is-on'), seconds * 1000);
  }
}

function hideCard() {
  $('.holo-card').classList.remove('is-on');
}

function chapter(text) {
  const el = $('.holo-chapter');
  el.textContent = text;
  el.classList.remove('is-on');
  void el.offsetWidth;
  el.classList.add('is-on');
}

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let lastReplyAt = 0; // when the latest reply has been on screen long enough to read
let lastPreview = '';
client.subscribe((s) => {
  // Nobody to answer, or the conversation was ended: the film narrates itself.
  film.offline = forcedOffline || ['unavailable', 'uncertain', 'ended'].includes(s.phase);
  status();

  // The greeting was on screen already, as the question.
  for (const m of s.messages) {
    if (shown.has(m.messageId)) continue;
    shown.add(m.messageId);
    if (m.type !== 'text' || !['standin', 'rep'].includes(m.senderType)) continue;
    if (m.body.trim() === GREETING) continue;
    const speaker = m.senderType === 'rep' ? s.host.name || 'The team' : '';
    const text = untagged(m.body);
    const tags = readTags(m.body);
    // The place's climate through the ages, for lines later in the film.
    if (tags.place && !film.place) {
      film.place = tags;
      film.placeStep = 'done';
      $('.holo-place').textContent = tags.place;
    }
    // How much the viewer meant: the picture shows that much.
    if (tags.amount !== undefined && film.measuring) {
      const amount = Number.parseFloat(tags.amount);
      if (Number.isFinite(amount)) applyAmount(film.measuring.kind, Math.min(1, Math.max(0, amount / 100)));
    }
    // The closing line is the first reply after the viewer's "2026" message.
    const asked = film.awaitingFinal && s.messages.find((v) => v.senderType === 'visitor' && v.body === film.finalWords);
    if (asked && m.seq > asked.seq && text) {
      film.awaitingFinal = false;
      film.finalLine = { text, speaker };
      if (film.section === 'epilogue' || film.section === 'credits') subtitle(text, speaker, { hold: true });
      continue;
    }
    if (!text) continue;
    // The welcome asks where the viewer is watching from.
    if (film.placeStep === 'waiting' && film.section === 'name') {
      askPlace(text, speaker);
      continue;
    }
    narrate(text, speaker);
  }
  // A reply as it streams in, before it is saved, without its tag.
  const streaming = s.preview?.text ? untagged(s.preview.text) : '';
  if (streaming && streaming !== lastPreview && !film.awaitingFinal) {
    lastPreview = streaming;
    subtitle(streaming, '', { streaming: true });
  }
  renderScreenplay();
  flush();
});

// A narrator line, as a subtitle.
function narrate(text, speaker = '') {
  lastPreview = '';
  subtitle(text, speaker);
  lastReplyAt = performance.now() + readingTime(text);
}

// --- The viewer's turn: the name, the choices, the hold -----------------------

const ask = $('.holo-ask');
const input = $('.holo-input');
const choices = $('.holo-choices');
const holdButton = $('.holo-hold');

let answering = null; // 'name' | 'fields' | 'coal' | 'warning' | 'free'

function openAsk(kind) {
  // Words typed to the narrator stay when a question opens.
  if (answering !== 'free') input.value = '';
  answering = kind;
  ask.dataset.kind = kind;
  ask.hidden = false;
  input.type = kind === 'email' ? 'email' : 'text';
  input.autocomplete = kind === 'email' ? 'email' : 'off';
  input.placeholder = { name: 'Your name', place: 'City, region or country', email: 'you@example.com', free: 'Say something to the narrator' }[kind] || 'Or in your own words: “only half”';
  input.setAttribute('aria-label', { name: 'Your name', place: 'Where you are watching from', email: 'Your email' }[kind] || 'Your answer');
  const note = $('.holo-note');
  note.hidden = kind !== 'email';
  note.textContent = CODA.note;
  choices.replaceChildren();
  if (CHOICES[kind]) {
    CHOICES[kind].options.forEach((option, i) => {
      if (i) choices.append(Object.assign(document.createElement('span'), { className: 'holo-or', textContent: 'or' }));
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.label;
      button.addEventListener('click', () => answer(kind, option.say, option.amount));
      choices.append(button);
    });
  }
  const skip = $('.holo-skip');
  skip.hidden = !['name', 'place', 'email'].includes(kind);
  skip.textContent = { place: 'Skip', email: 'No, thank you' }[kind] || 'Watch without a name';
  if (kind === 'name' || kind === 'place' || kind === 'email' || kind === 'free' || !matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
}

function closeAsk() {
  answering = null;
  questionText = '';
  ask.hidden = true;
  input.blur();
}

$('.holo-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  if (answering === 'name') setName(text);
  else if (answering === 'place') setPlace(text);
  else if (answering === 'email') setEmail(text);
  else if (CHOICES[answering]) answer(answering, text, null);
  else {
    // Free words during the film or after it.
    say(text);
    input.value = '';
    if (film.ended) return;
    closeAsk();
  }
});

$('.holo-skip').addEventListener('click', () => {
  if (answering === 'place') skipPlace();
  else if (answering === 'email') endCoda();
  else setName('');
});

function setName(text) {
  film.name = text ? nameFrom(text) : '';
  film.named = true;
  film.nameAt = performance.now();
  if (text) remember('visitor', text);
  closeAsk();
  clearSubtitle();
  // The conversation starts here, with the answer to the greeting. The
  // narrator's welcome asks where the viewer is watching from.
  if (online()) {
    film.placeStep = 'waiting';
    say(text || 'I’d rather not give a name.');
  } else {
    film.placeStep = 'done';
    local(OFFLINE.welcome(film.name));
  }
}

function askPlace(text, speaker = '') {
  film.placeStep = 'asking';
  film.placeAskedAt = performance.now();
  subtitle(text, speaker, { question: true });
  openAsk('place');
}

function setPlace(text) {
  film.placeStep = 'answered';
  film.placeAt = performance.now();
  closeAsk();
  clearSubtitle();
  remember('visitor', text);
  say(text);
}

function skipPlace() {
  film.placeStep = 'done';
  closeAsk();
  clearSubtitle();
  film.nameAt = performance.now();
  lastReplyAt = film.nameAt;
}

// The coda's answer: an email for the team, sent as a message they will see.
// The viewer's answer to the offer is remembered: it's asked once per browser.
const CODA_KEY = 'holocene:coda';
function codaAnswered() {
  try {
    return Boolean(localStorage.getItem(CODA_KEY));
  } catch {
    return false;
  }
}
function saveCoda(answer) {
  try {
    localStorage.setItem(CODA_KEY, answer);
  } catch {
    // Asked again next time.
  }
}

// Someone at Stand can take the email: a closed conversation is fine, the
// email starts a new one.
const reachable = () => !forcedOffline && ['available', 'active', 'loading', 'ended'].includes(client.state.phase);

function setEmail(email) {
  closeAsk();
  clearSubtitle();
  remember('visitor', email);
  if (client.state.phase === 'ended') void client.newChat();
  say(`I’d like to talk about design. My email: ${email}`);
  saveCoda('sent');
  film.codaAt = performance.now();
  film.coda = 'sent';
}

function endCoda() {
  closeAsk();
  clearSubtitle();
  saveCoda('declined');
  film.codaAt = performance.now();
  film.coda = 'declined';
}

// A line about the viewer's place, from the narrator's tag.
function placeLine(key) {
  const line = film.place?.[key];
  if (!line || film.ended) return false;
  subtitle(line, film.place.place);
  lastReplyAt = performance.now() + readingTime(line);
  return true;
}

// A line written into the page, read like a reply.
function local(text) {
  remember('standin', text);
  subtitle(text);
  lastReplyAt = performance.now() + readingTime(text);
}

// An answer: a button's amount is known; words are weighed by the narrator
// (its {{amount}} tag), or estimated here when it can't.
function answer(kind, words, amount) {
  if (film.answers[kind] !== undefined) return;
  film.answers[kind] = words;
  film.answerTime = { ...film.answerTime, [kind]: performance.now() };
  closeAsk();
  clearSubtitle();
  score.hit();
  remember('visitor', `${CHOICES[kind].moment}: ${words}.`);
  if (online()) {
    if (amount === null) film.measuring = { kind, words, at: performance.now() };
    else applyAmount(kind, amount);
    say(`${CHOICES[kind].moment}: ${words}.`);
  } else {
    applyAmount(kind, amount ?? estimate(kind, words));
    const meant = film.amounts[kind];
    local(band(meant, kind) === 0 ? OFFLINE.between[kind](meant) : OFFLINE[kind][band(meant, kind)]);
  }
}

// The consequence starts on screen once the amount is known.
function applyAmount(kind, amount) {
  if (film.amounts[kind] !== null) return;
  film.amounts[kind] = amount;
  film.choices[kind] = valueOf(amount);
  // The music of 1979–1988 follows the sun answer; it's scheduled ahead.
  if (kind === 'sun') score.setTurn(amount);
  film.answeredAt[kind] = { beat: score.position().beat, time: film.answerTime?.[kind] ?? performance.now() };
  if (film.measuring?.kind === kind) film.measuring = null;
}

// The hold, in `now`: anywhere on the picture, the button, or the space bar.
function setHolding(on) {
  if (!film.holdOpen) on = false;
  if (film.holding === on) return;
  film.holding = on;
  root.classList.toggle('is-holding', on);
  holdButton.setAttribute('aria-pressed', String(on));
}

$('.holo-frame').addEventListener('pointerdown', (event) => {
  if (!film.holdOpen) return;
  event.preventDefault();
  setHolding(true);
});
holdButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  setHolding(true);
});
for (const type of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(type, () => setHolding(false));
holdButton.addEventListener('keydown', (event) => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
    event.preventDefault();
    setHolding(true);
  }
});
holdButton.addEventListener('keyup', () => setHolding(false));

// --- Cues: what happens on which beat of each section ------------------------

const bars = (section, n) => n * SECTIONS[section].beatsPerBar;

const CUES = {
  overture: [
    [bars('overture', 2), () => card(`<p class="holo-presents">${escapeHtml(PRESENTS)}</p>`, { beats: 6 })],
    [bars('overture', 8), () => card('<h1 class="holo-title" aria-label="Holocene">HOLOCENE</h1>', { className: 'is-title' })],
    [bars('overture', 11.5), () => hideCard()],
  ],
  name: [
    [0, () => {
      subtitle(GREETING, '', { question: true });
      if (online()) client.showGreeting(GREETING);
      openAsk('name');
    }],
  ],
  ice: [
    [0, () => chapter('20,000 years ago · The ice')],
    [bars('ice', 3), () => placeLine('ice')],
  ],
  holocene: [
    [0, () => chapter('11,700 years ago · The Holocene')],
    [bars('holocene', 4), () => !line.classList.contains('is-on') && subtitle('The ice withdraws. For eleven thousand years the climate holds steady.')],
    [bars('holocene', 8), () => placeLine('holocene')],
  ],
  fields: [[0, () => question('fields')]],
  ages: [
    [0, () => chapter('8000 BCE – 1712 · Ten thousand years')],
    [bars('ages', 4), () => !line.classList.contains('is-on') && subtitle('Every city, every book, every harvest: all of it in one stable climate.')],
  ],
  steam: [
    [0, () => chapter('1712 · Coal and steam')],
    [bars('steam', 3), () => !line.classList.contains('is-on') && subtitle('For the first time, we burn what the Earth buried for millions of years.')],
    [bars('steam', 8), () => placeLine('1900')],
  ],
  coal: [[0, () => question('coal')]],
  oil: [
    [0, () => chapter('1900 · Oil')],
    [bars('oil', 2), () => !line.classList.contains('is-on') && subtitle('1901, Spindletop, Texas. Oil gushes from the ground, and the century runs on it.')],
  ],
  grid: [
    [0, () => chapter('1950 · The great acceleration')],
    [bars('grid', 6), () => !line.classList.contains('is-on') && subtitle('The 1960s. The green revolution: fertiliser made from gas feeds billions more.')],
  ],
  sun: [[0, () => question('sun')]],
  turn: [[0, () => chapter('1979 – 1988 · The turn')]],
  warning: [[0, () => question('warning')]],
  heat: [
    [0, () => chapter('1988 – 2026 · Heat')],
    [bars('heat', 6), () => placeLine('2026')],
    [bars('heat', 13.5), () => subtitle('2024: the first year 1.5 °C warmer than before coal.')],
  ],
  now: [
    [0, () => {
      chapter('2026 · Now');
      subtitle('2026. Everything before was history. This is yours: press and hold to bring 2100 down.', '', { question: true });
      showLedger();
      film.holdOpen = true;
      holdButton.hidden = false;
      root.classList.add('is-now');
    }],
    // The last bar: the answer is in. Decide the ending before it starts.
    [bars('now', 11), () => endNow()],
  ],
  future: [
    [0, () => {
      chapter(`2100 · One possible future`);
      $('.holo-scenario').textContent = `IPCC scenario ${film.scenario.scenario}`;
    }],
    [bars('future', 3), () => film.outcome !== 'middle' && placeLine(film.outcome)],
    [bars('future', 9), () => subtitle(film.scenario.label)],
  ],
  epilogue: [
    [0, () => {
      $('.holo-scenario').textContent = '';
      card(`<dl class="holo-definition">
        <dt>ho·lo·cene <span>(n.)</span></dt>
        <dd>1. the whole recent age.</dd>
        <dd>2. the 11,700 years of steady climate in which every civilisation was built.</dd>
        <dd>3. an age that could end with us.</dd>
      </dl>`, { className: 'is-definition' });
    }],
    [bars('epilogue', 3), () => {
      if (film.finalLine) subtitle(film.finalLine.text, film.finalLine.speaker, { hold: true });
      else if (!online() || !film.awaitingFinal) finalFromPage();
    }],
    // No closing line from Stand in time: the page's own.
    [bars('epilogue', 5), () => film.awaitingFinal && finalFromPage()],
    [bars('epilogue', 7.5), () => hideCard()],
  ],
  coda: [
    [0, () => subtitle(CODA.line, '', { hold: true })],
    [bars('coda', 2), () => subtitle(CODA.turn, '', { hold: true })],
    // The invitation only when someone can receive it.
    // The invitation: only when someone can receive it, and once per browser.
    [bars('coda', 4), () => {
      if (!reachable() || codaAnswered()) {
        film.coda = 'skipped';
        return;
      }
      film.coda = 'asking';
      subtitle(CODA.offer, '', { question: true });
      openAsk('email');
    }],
  ],
  credits: [
    [0, () => {
      clearSubtitle();
      rollCredits();
    }],
  ],
};

function finalFromPage() {
  film.awaitingFinal = false;
  const last = OFFLINE.final[film.outcome](film.name);
  film.finalLine = { text: last, speaker: '' };
  remember('standin', last);
  subtitle(last, '', { hold: true });
}

function question(kind) {
  subtitle(CHOICES[kind].question, '', { question: true });
  openAsk(kind);
}

// A waiting section moves on once the viewer has answered and the narrator's
// reply has been on screen long enough to read, or after a while regardless.
function tickWaiting(pos) {
  const section = film.section;
  if (!SECTIONS[section]?.loop || film.exitQueued) return;
  const now = performance.now();
  if (section === 'name') {
    if (!film.named) return;
    if (film.placeStep === 'waiting' && now - film.nameAt > 9000) askPlace(OFFLINE.place);
    if (film.placeStep === 'asking' && now - film.placeAskedAt > 40000) skipPlace();
    if (film.placeStep === 'answered') {
      if ((lastReplyAt > film.placeAt && now > lastReplyAt) || now - film.placeAt > 16000) nextSection();
      return;
    }
    if (film.placeStep !== 'done') return;
    const replied = lastReplyAt > film.nameAt && now > lastReplyAt;
    if (replied || now - film.nameAt > 14000) nextSection();
    return;
  }
  if (section === 'coda') {
    if (film.coda === 'sent') {
      if ((lastReplyAt > film.codaAt && now > lastReplyAt) || now - film.codaAt > 12000) nextSection();
    } else if (film.coda === 'declined' || film.coda === 'unanswered') {
      nextSection();
    } else if (film.coda === 'asking') {
      // No answer is not a no: it's asked again next time.
      if (pos.beat > bars('coda', 14) && !input.value.trim()) {
        closeAsk();
        clearSubtitle();
        film.coda = 'unanswered';
      }
    } else if (film.coda === 'skipped' && pos.beat >= bars('coda', 5)) {
      // Just the lines, read, then the credits.
      nextSection();
    }
    return;
  }
  const kind = section;
  const asked = film.sectionStartedAt;
  // The narrator hasn't weighed the answer in time: estimate it here.
  if (film.measuring?.kind === kind && now - film.measuring.at > 6000) applyAmount(kind, estimate(kind, film.measuring.words));
  if (film.answers[kind] === undefined) {
    // No answer for 16 bars: silence is also a choice. Not while typing one.
    if (pos.beat > bars(section, 16) && !input.value.trim()) {
      film.answers[kind] = '';
      film.answerTime = { ...film.answerTime, [kind]: now };
      applyAmount(kind, 0.5);
      closeAsk();
      local(OFFLINE.silence);
    }
    return;
  }
  if (film.amounts[kind] === null) return;
  // The picture shows the consequence for at least two bars.
  const at = film.answeredAt[kind];
  const consequence = pos.beat - at.beat >= 8;
  const replied = lastReplyAt > at.time && now > lastReplyAt;
  if (consequence && (replied || now - at.time > 16000) && now - asked > 4000) nextSection();
}

function nextSection() {
  film.exitQueued = true;
  const next = ORDER[ORDER.indexOf(film.section) + 1];
  score.queue(next);
}

function endNow() {
  if (!film.holdOpen) return;
  film.holdOpen = false;
  decideOutcome();
  holdButton.hidden = true;
  setHolding(false);
  root.classList.remove('is-now');
  clearSubtitle();
  // The number settles on the nearest IPCC scenario, which becomes the ending.
  const from = film.start;
  const reached = film.projected;
  film.reached = reached;
  film.projected = film.scenario.temp;
  projection();
  $('.holo-projection-note').textContent = `Nearest IPCC scenario: ${film.scenario.scenario}`;
  setTimeout(() => ($('.holo-ledger').hidden = true), 3000);
  const words = `2026, now: I held on and brought 2100 from ${signed(from)} down to ${signed(reached)}.`;
  remember('visitor', words);
  if (online()) {
    film.awaitingFinal = true;
    film.finalWords = words;
    say(words);
  }
}

function holdFraction() {
  return film.holdSpan ? Math.min(1, film.hold / film.holdSpan) : 0;
}

// What each answer adds to 2100's warming in this film, °C: an illustration
// that spans the IPCC's range, not a climate model.
const WEIGHTS = { fields: 0.4, coal: 0.8, sun: 0.8, warning: 1.2 };
const effect = (kind) => (film.amounts[kind] === null ? 0 : (film.amounts[kind] - 0.5) * WEIGHTS[kind]);

function startProjection() {
  const sum = Object.keys(WEIGHTS).reduce((total, kind) => total + effect(kind), 0);
  film.start = Math.min(4.4, Math.max(1.8, 2.9 + sum));
  film.projected = film.start;
}

// The ending is the IPCC scenario nearest the viewer's number.
function decideOutcome() {
  if (film.projected === null) startProjection();
  film.scenario = SCENARIOS.reduce((best, s) => (Math.abs(s.temp - film.projected) < Math.abs(best.temp - film.projected) ? s : best));
  film.outcome = film.scenario.outcome;
  score.setOutcome(film.outcome);
}

// What an answer meant, in words: for the ledger and the credits.
function describe(kind) {
  const amount = film.amounts[kind];
  const percent = `${Math.round((amount ?? 0) * 100)}%`;
  if (amount === null) return 'not asked';
  if (!film.answers[kind]) return 'silence';
  if (kind === 'fields') return `${percent} of the forest cleared`;
  if (kind === 'coal') return `${percent} of the coal burned`;
  if (kind === 'sun') return amount < 0.34 ? 'built on the sun' : amount > 0.66 ? 'back to oil' : `${percent} back to oil`;
  return amount === 0 ? 'acted at once' : amount >= 1 ? 'never acted' : `acted after ${Math.max(1, Math.round(amount * 40))} years`;
}

const LEDGER = { fields: 'The fields', coal: 'The coal', sun: 'The sun', warning: 'The warning' };
const signed = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} °C`;

// The ledger: each answer and its weight, one per beat, adding up to the viewer's 2100.
function showLedger() {
  startProjection();
  const el = $('.holo-ledger');
  el.innerHTML = `<ol>${Object.keys(LEDGER).map((kind, i) => `<li style="--i:${i}"><span>${LEDGER[kind]}</span><span>${escapeHtml(describe(kind))}</span><span>${signed(effect(kind))}</span></li>`).join('')}</ol>
    <p class="holo-projection" style="--i:4"><small>Your 2100</small><b></b><small class="holo-projection-note">Hold to bring it down. An illustration within the IPCC’s range, +1.4 to +4.4 °C.</small></p>`;
  el.style.setProperty('--beat', `${60 / SECTIONS.now.bpm}s`);
  el.hidden = false;
  projection();
}

function projection() {
  const b = $('.holo-projection b');
  if (!b) return;
  b.textContent = signed(film.projected);
  // White when it's low, the title's red when it's high.
  b.style.setProperty('--heat', ((film.projected - 1.4) / 3).toFixed(3));
}

function rollCredits() {
  const f = film.scenario || SCENARIOS[2];
  const host = client.state.host;
  const narrator = film.offline || !host.name ? 'Written into this page' : host.kind === 'rep' ? `${host.name}, live` : `Stand Chat’s AI Stand-in`;
  const roll = $('.holo-credits');
  roll.innerHTML = `<div class="holo-credits-roll">
    <p class="holo-credit-title">HOLOCENE</p>
    <dl>
      <dt>Starring</dt><dd>${escapeHtml(film.name || 'You')}<br><small>${film.place ? `watching from ${escapeHtml(film.place.place)}` : 'as the one who chose'}</small></dd>
      <dt>Narrator</dt><dd>${escapeHtml(narrator)}</dd>
      <dt>Your choices</dt><dd>The fields: ${escapeHtml(describe('fields'))}<br>The coal: ${escapeHtml(describe('coal'))}<br>The sun: ${escapeHtml(describe('sun'))}<br>The warning: ${escapeHtml(describe('warning'))}<br>Now: from ${signed(film.start ?? 2.9)} down to ${signed(film.reached ?? film.start ?? 2.9)}</dd>
      <dt>Your 2100</dt><dd>+${f.temp} °C · ${f.co2} ppm CO₂<br><small>IPCC AR6, ${f.scenario}, best estimate</small></dd>
      <dt>Music</dt><dd>An original score, synthesised live in Web Audio<br><small>after Philip Glass</small></dd>
      <dt>Pictures</dt><dd>Drawn live by your browser. No footage.</dd>
      <dt>Data</dt><dd>CO₂: EPICA and Law Dome ice cores, NOAA Mauna Loa<br>Temperature: HadCRUT5, Berkeley Earth, Copernicus<br>Futures: IPCC Sixth Assessment Report</dd>
      <dt>In homage to</dt><dd><i>Koyaanisqatsi</i> (1982)<br><small>Godfrey Reggio and Philip Glass</small></dd>
      <dt>The conversation</dt><dd>Stand Chat’s Visitor API</dd>
    </dl>
    <p class="holo-credit-end">${escapeHtml(PRESENTS.replace(/,?\s*presents$/i, ''))}<br>Public domain. Copy anything.</p>
  </div>`;
  const seconds = (SECTIONS.credits.bars * SECTIONS.credits.beatsPerBar * 60) / SECTIONS.credits.bpm;
  roll.style.setProperty('--roll', `${seconds - 6}s`);
  roll.hidden = false;
  roll.classList.remove('is-rolling');
  void roll.offsetWidth;
  roll.classList.add('is-rolling');
}

// --- The screenplay: the conversation, after the film ------------------------

function renderScreenplay() {
  const pane = $('.holo-screenplay-text');
  if (!pane) return;
  const s = client.state;
  const who = (m) => (m.senderType === 'visitor' ? (film.name || 'You') : m.senderType === 'rep' ? s.host.name || 'The team' : 'The narrator');
  // Without Stand, the film's own lines make the screenplay.
  const messages = s.messages.length ? s.messages : film.log.map((m, i) => ({ ...m, type: 'text', messageId: `local-${i}` }));
  const entries = messages
    .filter((m) => m.type === 'text' && ['visitor', 'standin', 'rep'].includes(m.senderType) && untagged(m.body))
    .map((m) => {
      // "1900, the coal: burn it all." → a scene heading, then the line.
      const moment = m.senderType === 'visitor' && m.body.match(/^(\d{3,4}(?: BCE)?), ([^:]+): (.*)$/s);
      const heading = moment ? `<p class="sp-heading">EXT. ${escapeHtml(moment[2].toUpperCase())} — ${escapeHtml(moment[1])}</p>` : '';
      const body = moment ? moment[3] : m.senderType === 'visitor' ? m.body : untagged(m.body);
      return `${heading}<p class="sp-who">${escapeHtml(who(m).toUpperCase())}</p><p class="sp-line">${escapeHtml(body)}</p>`;
    });
  // After the credits, the narrator asks how the film felt, where it asked it.
  if (film.askedHow !== undefined) {
    entries.splice(film.askedHow, 0, `<p class="sp-heading">FADE OUT.</p><p class="sp-who">THE NARRATOR</p><p class="sp-line">${escapeHtml(AFTER)}</p>`);
  }
  const html = entries.join('');
  const typing = s.typing || s.preview ? '<p class="sp-who">THE NARRATOR</p><p class="sp-line sp-typing">(thinking)</p>' : '';
  const empty = film.offline ? '<p class="sp-heading">FADE OUT.</p>' : '<p class="sp-heading">FADE IN.</p><p class="sp-line">Say something to the narrator.</p>';
  pane.innerHTML = `<p class="sp-heading">HOLOCENE</p>${html || empty}${typing}`;
  // Follow new lines, unless the viewer has scrolled back to read.
  const scroller = $('.holo-screenplay');
  if (!scroller.hidden && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120) scroller.scrollTop = scroller.scrollHeight;
}

function showScreenplay() {
  film.ended = true;
  if (online()) film.askedHow = client.state.messages.filter((m) => m.type === 'text' && ['visitor', 'standin', 'rep'].includes(m.senderType) && untagged(m.body)).length;
  root.classList.add('is-ended');
  $('.holo-credits').hidden = true;
  $('.holo-screenplay').hidden = false;
  renderScreenplay();
  openAsk('free');
  status();
  $('.holo-screenplay').scrollTop = 1e9;
}

// --- Playback ------------------------------------------------------------------

const play = $('.holo-play');

function start() {
  if (film.started) return;
  film.started = true;
  root.classList.add('is-playing');
  fadePoster();
  // ?from=grid starts at a section, for working on one scene.
  const from = new URLSearchParams(location.search).get('from');
  if (from && SECTIONS[from] && from !== 'overture') {
    film.named = true;
    if (ORDER.indexOf(from) > ORDER.indexOf('now')) decideOutcome();
  }
  // The picture starts with the music, before anything that could fail.
  score.start(SECTIONS[from] ? from : 'overture');
  requestAnimationFrame(frame);
  syncControls();
  try {
    if (online()) client.activate('click');
  } catch (error) {
    console.error('Holocene: Stand activation failed', error);
  }
}

play.addEventListener('click', start);

// The poster's words go first, then its picture fades slowly to black over the
// film's first frames, which begin in darkness.
function fadePoster() {
  const poster = $('.holo-poster');
  poster.classList.add('is-leaving');
  setTimeout(() => (poster.hidden = true), 900);
  const canvas = $('.holo-canvas');
  const still = document.createElement('canvas');
  still.className = 'holo-still';
  still.setAttribute('aria-hidden', 'true');
  still.width = canvas.width;
  still.height = canvas.height;
  still.getContext('2d').drawImage(canvas, 0, 0);
  canvas.after(still);
  requestAnimationFrame(() => requestAnimationFrame(() => still.classList.add('is-gone')));
  setTimeout(() => still.remove(), 4500);
}

$('.holo-again').addEventListener('click', async (event) => {
  // A new film, a new conversation: this one ends first.
  event.currentTarget.disabled = true;
  if (client.state.phase === 'active' && !client.state.busy) await client.end();
  location.reload();
});

// One frame. An error is logged once, and the film goes on.
let frameFailed = false;
function frame() {
  requestAnimationFrame(frame);
  try {
    step();
  } catch (error) {
    if (!frameFailed) console.error('Holocene: a frame failed', error);
    frameFailed = true;
  }
}

function step() {
  const pos = score.position();
  if (!pos.started || !pos.section) return;

  if (pos.section !== film.section) enter(pos.section);

  // Film time for the scenes and the hold, on the audio clock (it pauses with it).
  // Capped so a stalled tab can't jump, loose enough for a slow phone.
  const dt = Math.max(0, Math.min(0.5, pos.time - film.lastTime));
  film.lastTime = pos.time;
  film.holdLevel += ((film.holding ? 1 : 0) - film.holdLevel) * Math.min(1, dt * 3);
  film.flow += dt * (1 - 0.9 * film.holdLevel);
  if (film.section === 'now' && pos.bar >= 1 && pos.bar < 11) {
    film.holdSpan += dt;
    if (film.holding) film.hold += dt;
    $('.holo-hold-meter').style.setProperty('--held', holdFraction().toFixed(3));
    // Holding pulls the projection down, to a floor the past choices set;
    // letting go lets it creep back up.
    const floor = Math.max(1.4, film.start - 1.9);
    film.projected += dt * (-0.12 * film.holdLevel + 0.035 * (1 - film.holdLevel));
    film.projected = Math.min(film.start, Math.max(floor, film.projected));
    projection();
  }
  score.setHold(film.holdLevel);

  for (const [beat, fn] of CUES[film.section] || []) {
    const key = `${film.sectionInstance}:${beat}`;
    if (pos.beat >= beat && !film.fired.has(key)) {
      film.fired.add(key);
      fn();
    }
  }
  tickWaiting(pos);
  counter(pos);

  // A paused film holds its picture; it's drawn again only if the page resizes.
  const size = `${innerWidth}x${innerHeight}`;
  if (score.paused && size === film.drawnSize) return;
  film.drawnSize = size;
  projector.draw({
    section: pos.section,
    beat: pos.beat,
    time: pos.time,
    bpm: pos.bpm,
    params: params(pos),
    reduced: reducedMotion.matches,
  });
}

function enter(section) {
  // A frame can miss the end of `now` (a stalled tab): the ending is decided anyway.
  if (film.section === 'now') endNow();
  film.section = section;
  film.sectionInstance++;
  film.sectionStartedAt = performance.now();
  film.exitQueued = false;
  film.lastTime = 0;
  if (section === 'now') film.flow = 0;
  root.dataset.section = section;
  if (section !== 'name' && answering === 'name') closeAsk();
  if (!SECTIONS[section].loop && answering && answering !== 'free') closeAsk();
}

// The year, CO₂ and temperature, ticking on the beat.
function yearAt(pos) {
  const span = YEARS[film.section];
  if (!span) return null;
  const s = SECTIONS[film.section];
  const total = s.bars * s.beatsPerBar;
  const k = s.loop ? 0 : Math.min(1, Math.floor(pos.beat) / (total - 1));
  return span[0] + (span[1] - span[0]) * k;
}

let lastCounter = '';
function counter(pos) {
  const year = yearAt(pos);
  let text = '';
  let co2 = 0;
  let temp = null;
  if (year !== null) {
    if (film.section === 'future' && film.scenario) {
      co2 = lerpSeries(film.scenario.co2Path, year);
      temp = lerpSeries(film.scenario.tempPath, year);
    } else {
      co2 = lerpSeries(CO2, year);
      temp = year >= 1850 ? lerpSeries(TEMP, year) : null;
    }
    text = `${formatYear(year)}|${Math.round(co2)}|${temp === null ? '' : `${temp >= 0 ? '+' : '−'}${Math.abs(temp).toFixed(1)}`}`;
  }
  if (text === lastCounter) return;
  lastCounter = text;
  const [y, c, t] = text.split('|');
  const el = $('.holo-counter');
  el.hidden = !text;
  el.querySelector('.holo-year').textContent = y || '';
  el.querySelector('.holo-co2').textContent = c ? `${c} ppm CO₂` : '';
  el.querySelector('.holo-temp').textContent = t ? `${t} °C` : '';
}

function params(pos) {
  const year = yearAt(pos) ?? (film.section === 'epilogue' || film.section === 'credits' ? 2100 : -20000);
  const answered = film.answeredAt[film.section];
  return {
    year,
    co2: lerpSeries(CO2, Math.min(year, 2026)),
    temp: year >= 1850 ? lerpSeries(TEMP, Math.min(year, 2026)) : null,
    choices: film.choices,
    amounts: film.amounts,
    projected: film.projected ?? undefined,
    start: film.start ?? undefined,
    severity: film.scenario?.severity,
    answered: Boolean(answered),
    answeredBeat: answered?.beat ?? 0,
    hold: holdFraction(),
    holding: film.holding,
    holdLevel: film.holdLevel,
    flow: film.flow,
    outcome: film.outcome,
    accent: score.accent(),
    level: score.level(),
  };
}

score.addEventListener('end', () => {
  // The credits have faded to silence. The last picture stays.
  showScreenplay();
  score.stop();
});

// --- Controls: sound, pause, fullscreen, keys -----------------------------------

const MUTE_KEY = 'holocene:muted';
function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function syncControls() {
  $('.holo-sound').setAttribute('aria-pressed', String(!score.muted));
  $('.holo-sound').textContent = score.muted ? 'Sound off' : 'Sound on';
  $('.holo-pause').setAttribute('aria-pressed', String(score.paused));
  $('.holo-pause').textContent = score.paused ? 'Play' : 'Pause';
  root.classList.toggle('is-paused', score.paused);
}

$('.holo-sound').addEventListener('click', () => {
  score.setMuted(!score.muted);
  try {
    localStorage.setItem(MUTE_KEY, score.muted ? '1' : '0');
  } catch {
    // The choice lasts for this visit.
  }
  syncControls();
});

function togglePause() {
  if (!film.started || film.ended) return;
  film.userPaused = !score.paused;
  if (score.paused) resumeFilm();
  else pauseFilm();
}

// Wall-clock timers (subtitles, reading time) stop with the film.
let pausedAt = 0;
function pauseFilm() {
  if (score.paused) return;
  score.pause();
  pausedAt = performance.now();
  clearTimeout(subtitleTimer);
  syncControls();
}

function resumeFilm() {
  if (!score.paused) return;
  score.resume();
  const gap = performance.now() - pausedAt;
  lastReplyAt += gap;
  film.nameAt += gap;
  film.sectionStartedAt += gap;
  for (const at of Object.values(film.answeredAt)) at.time += gap;
  if (subtitleEnds) fadeSubtitleIn(subtitleEnds + gap - performance.now());
  syncControls();
}
$('.holo-pause').addEventListener('click', togglePause);

$('.holo-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else root.requestFullscreen?.().catch(() => {});
});

document.addEventListener('visibilitychange', () => {
  if (!film.started || film.ended) return;
  if (document.hidden) pauseFilm();
  else if (!film.userPaused) resumeFilm();
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const typing = event.target === input;
  if (!film.started) return;
  if (film.holdOpen && event.key === ' ' && !typing) {
    event.preventDefault();
    if (!event.repeat) setHolding(true);
    return;
  }
  if (typing) return;
  if (event.key === ' ' && event.repeat) {
    event.preventDefault();
    return;
  }
  if (event.key === ' ' && root.contains(document.activeElement) === false && rootVisible()) {
    event.preventDefault();
    togglePause();
    return;
  }
  // Start typing anywhere to talk to the narrator.
  if (event.key.length === 1 && event.key !== ' ' && rootVisible() && !film.ended) {
    if (!answering && !online()) return; // Nobody to talk to.
    if (!answering) openAsk('free');
    input.focus({ preventScroll: true });
  }
});
document.addEventListener('keyup', (event) => {
  if (event.key === ' ') setHolding(false);
});

function rootVisible() {
  const box = root.getBoundingClientRect();
  return box.bottom > innerHeight * 0.4 && box.top < innerHeight * 0.6;
}

// --- Status -------------------------------------------------------------------

function status() {
  const s = client.state;
  const el = $('.holo-status');
  const labels = { active: s.typing ? 'Narrator writing' : 'Narrator here', available: 'Narrator ready', loading: 'Finding the narrator' };
  const text = (!film.offline && labels[s.phase]) || 'Narrator away';
  el.textContent = text;
  el.dataset.phase = film.offline ? 'unavailable' : s.phase;
  if (film.ended) {
    input.placeholder = film.offline ? 'The narrator is away' : 'Keep talking to the narrator';
    input.disabled = film.offline;
  }
}

// Escape closes a free-typing line during the film.
input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && answering === 'free' && !film.ended) closeAsk();
});

// ?offline plays the film without Stand, with the narrator's lines from this file.
if (new URLSearchParams(location.search).has('offline')) {
  film.offline = true;
  status();
} else {
  client.mount();
}
// The poster: a still from the film behind the title, until Play.
function poster() {
  if (film.started) return;
  const beat = 3;
  projector.draw({
    section: 'holocene', beat, time: (beat * 60) / SECTIONS.holocene.bpm, bpm: SECTIONS.holocene.bpm, reduced: true,
    params: { year: -9000, co2: 255, temp: null, choices: film.choices, answered: false, answeredBeat: 0, hold: 0, holding: false, holdLevel: 0, flow: 0, outcome: null, accent: 0, level: 0.3 },
  });
}
poster();
addEventListener('resize', poster);

score.setMuted(readMuted());
syncControls();
if (!root.requestFullscreen) $('.holo-full').hidden = true;
root.classList.add('is-ready');
