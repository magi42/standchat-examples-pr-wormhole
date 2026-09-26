import { calculate, contextualMessage, scenarioText, TYPES, EXAMPLES, MAX_EVENTS, money } from './billing.js';
import './stand-inline.js';

const $ = (selector) => document.querySelector(selector);
let events = EXAMPLES.growth.map((event, i) => ({ ...event, id: i + 1 }));
let nextId = 3;
let selected = 'base';
let day = 16;
let preset = 'growth';
const history = [];
const storageKey = 'meterwick:scenario:v1';
try {
  const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (stored) {
    calculate(stored.events);
    events = stored.events;
    nextId = Math.max(0, ...events.map((event) => event.id)) + 1;
    selected = stored.selected;
    preset = '';
  }
} catch { /* A fresh scenario still works when storage is blocked or invalid. */ }

function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function snapshot() {
  history.push({ events: events.map((event) => ({ ...event })), selected, preset });
  if (history.length > 40) history.shift();
}
function announce(message) { $('#local-announcement').textContent = message; }
function addEvent(type, date = day) {
  if (!Object.hasOwn(TYPES, type)) return;
  if (events.length >= MAX_EVENTS) return announce('Limit reached: remove an event or undo before adding another.');
  snapshot();
  const event = { type, day: date, id: nextId++ };
  events.push(event);
  selected = event.id;
  preset = '';
  setDay(date);
  render();
  announce(`${TYPES[type].label} added on September ${date}. Total ${money(calculate(events).total)}.`);
}
function inspect(id) {
  selected = id;
  // Preserve focus on the clicked button instead of rebuilding its list.
  renderSelection(calculate(events));
  save();
}
function setDay(value) {
  day = Number(value);
  $('#event-day').value = String(day);
  $('#selected-day-label').textContent = `Adding on Sep ${day}`;
  for (const button of document.querySelectorAll('.day')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.day) === day));
    button.tabIndex = Number(button.dataset.day) === day ? 0 : -1;
  }
}
function save() {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ events, selected })); } catch { /* In-memory mode. */ }
}
function renderSelection(bill) {
  const line = bill.lines.find((item) => String(item.id) === String(selected)) || bill.lines[0];
  selected = line.id;
  $('#selection-title').textContent = line.title;
  $('#selection-detail').textContent = line.explanation;
  $('#chat-anchor').textContent = `Selected: Sep ${line.day} · ${line.title}`;
  $('#context-text').textContent = scenarioText(events, selected);
  for (const button of document.querySelectorAll('[data-inspect]')) button.setAttribute('aria-pressed', String(button.dataset.inspect === String(selected)));
}
function render() {
  const bill = calculate(events);
  $('#event-list').replaceChildren();
  $('#invoice-lines').replaceChildren();
  for (const event of bill.events) {
    const row = node('li', 'event-row');
    const inspectButton = node('button', 'event-inspect');
    inspectButton.type = 'button';
    inspectButton.dataset.inspect = event.id;
    inspectButton.setAttribute('aria-label', `Inspect September ${event.day}: ${event.title}, ${money(event.amount)}`);
    const dot = node('span', 'event-dot');
    dot.setAttribute('aria-hidden', 'true');
    inspectButton.append(node('span', 'event-date', `Sep ${String(event.day).padStart(2, '0')}`), dot, node('span', '', event.title), node('span', 'event-amount', event.amount > 0 ? `+${money(event.amount)}` : money(event.amount)));
    inspectButton.addEventListener('click', () => inspect(event.id));
    const remove = node('button', 'event-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${event.title} on September ${event.day}`);
    remove.addEventListener('click', () => {
      snapshot();
      events = events.filter((item) => item.id !== event.id);
      preset = '';
      render();
      $('#undo').focus();
      announce(`${event.title} removed. Total ${money(calculate(events).total)}.`);
    });
    row.append(inspectButton, remove);
    $('#event-list').append(row);
  }
  if (!events.length) $('#event-list').append(node('li', 'empty-events', 'A quiet month so far. Add a change above.'));
  for (const line of bill.lines) {
    const button = node('button', 'invoice-line');
    button.type = 'button';
    button.dataset.inspect = line.id;
    const description = node('span', '');
    description.append(node('strong', '', line.title), node('small', '', line.id === 'base' ? 'Sep 01–30 · starting subscription' : `Sep ${String(line.day).padStart(2, '0')} · ${line.amount < 0 ? 'prorated credit' : line.amount > 0 ? 'prorated charge' : 'no charge change'}`));
    button.append(description, node('span', `line-amount${line.amount < 0 ? ' line-credit' : ''}`, `${line.id !== 'base' && line.amount > 0 ? '+' : ''}${money(line.amount)}`));
    button.addEventListener('click', () => inspect(line.id));
    $('#invoice-lines').append(button);
  }
  for (const button of document.querySelectorAll('.day')) {
    const date = Number(button.dataset.day);
    const last = bill.events.filter((event) => event.day <= date).at(-1);
    const status = last?.status || 'active';
    const plan = last?.plan || 'Launch';
    const onDate = bill.events.filter((event) => event.day === date);
    button.className = `day ${status !== 'active' ? status : plan.toLowerCase()}${onDate.length ? ' has-event' : ''}`;
    button.setAttribute('aria-label', `September ${date}, ${status}, ${plan}${onDate.length ? `: ${onDate.map((event) => event.title).join(', ')}` : ''}. Set event day.`);
  }
  $('#invoice-total').textContent = money(bill.total);
  $('#service-status').textContent = bill.status;
  const failed = bill.collection === 'Payment failed';
  $('#collection-status').classList.toggle('failed', failed);
  $('#collection-status').lastElementChild.textContent = failed ? 'Payment failed · charges are unchanged' : 'Collection not attempted';
  $('#event-count').textContent = `${events.length} / ${MAX_EVENTS}`;
  $('#undo').disabled = !history.length;
  for (const button of document.querySelectorAll('[data-preset]')) {
    const chosen = button.dataset.preset === preset;
    button.classList.toggle('chosen', chosen);
    button.setAttribute('aria-pressed', String(chosen));
  }
  for (const button of document.querySelectorAll('.event-tool')) {
    button.setAttribute('aria-disabled', String(events.length >= MAX_EVENTS));
  }
  renderSelection(bill);
  save();
}

for (let date = 1; date <= 30; date++) {
  const option = node('option', '', String(date).padStart(2, '0'));
  option.value = date;
  $('#event-day').append(option);
  const button = node('button', 'day');
  button.type = 'button';
  button.dataset.day = date;
  button.title = `September ${date}`;
  button.addEventListener('click', () => setDay(date));
  button.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('application/x-meterwick-event')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    button.classList.add('drop-over');
  });
  button.addEventListener('dragleave', () => button.classList.remove('drop-over'));
  button.addEventListener('drop', (event) => {
    event.preventDefault();
    button.classList.remove('drop-over');
    addEvent(event.dataTransfer.getData('application/x-meterwick-event'), date);
  });
  button.addEventListener('keydown', (event) => {
    const offset = { ArrowLeft: -1, ArrowRight: 1, Home: 1 - date, End: 30 - date }[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    setDay(Math.max(1, Math.min(30, date + offset)));
    $(`.day[data-day="${day}"]`).focus();
  });
  $('#day-grid').append(button);
}
for (const [type, info] of Object.entries(TYPES)) {
  const button = node('button', 'event-tool');
  button.type = 'button';
  button.dataset.type = type;
  button.draggable = true;
  button.title = info.detail;
  button.setAttribute('aria-label', `Add event: ${info.label}`);
  const icon = node('span', 'tool-icon', info.icon);
  const plus = node('span', 'tool-add', '+');
  icon.setAttribute('aria-hidden', 'true');
  plus.setAttribute('aria-hidden', 'true');
  button.append(icon, node('strong', '', info.label), plus);
  button.addEventListener('click', () => addEvent(type));
  button.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('application/x-meterwick-event', type);
    event.dataTransfer.effectAllowed = 'copy';
  });
  $('#event-tools').append(button);
}
$('#event-day').addEventListener('change', (event) => setDay(event.target.value));
for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => {
  snapshot();
  preset = button.dataset.preset;
  events = EXAMPLES[preset].map((event) => ({ ...event, id: nextId++ }));
  selected = events[0].id;
  render();
  announce(`${button.textContent} loaded. Total ${money(calculate(events).total)}.`);
});
$('#undo').addEventListener('click', () => {
  const previous = history.pop();
  if (!previous) return;
  ({ events, selected, preset } = previous);
  render();
  if (!history.length) $('#reset').focus();
  announce(`Change undone. Total ${money(calculate(events).total)}.`);
});
$('#reset').addEventListener('click', () => {
  snapshot();
  events = [];
  selected = 'base';
  preset = '';
  render();
  announce('Reset to Launch with 3 seats. September total $120.00. Your conversation is kept.');
});
const chat = $('#billing-chat');
chat.prepareMessage = (question) => contextualMessage(question, events, selected);
$('#ask-selection').addEventListener('click', () => {
  $('#conversation').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  if (!chat.draft) chat.draft = `Can you explain the selected ${selected === 'base' ? 'starting charge' : 'adjustment'} and its edge cases?`;
  chat.focus({ preventScroll: true });
});
setDay(day);
render();
