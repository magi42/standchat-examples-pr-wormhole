import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, contextualMessage, CONTEXT_MARKER, EXAMPLES, TYPES, MAX_EVENTS } from './billing.js';

const events = (list) => list.map(([type, day], i) => ({ type, day, id: i + 1 }));
const example = (key) => EXAMPLES[key].map((event, i) => ({ ...event, id: i + 1 }));

test('starting charge and preset invoices have hand-calculated totals', () => {
  assert.equal(calculate([]).total, 12000);
  assert.deepEqual(calculate(example('growth')).lines.map((line) => line.amount), [12000, 4500, 667]);
  // 10 days at $120/mo, 10 days paused, 10 days at $140/mo.
  assert.equal(calculate(example('pause')).total, 8667);
  // 15 days at $120/mo, 9 days at $210/mo; failure does not change charges.
  assert.equal(calculate(example('failure')).total, 12300);
});

test('day 1 and day 30 prorate inclusively and cancellation can zero the month', () => {
  assert.equal(calculate(events([['upgrade', 1]])).total, 21000);
  assert.equal(calculate(events([['upgrade', 30]])).total, 12300);
  assert.equal(calculate(events([['cancel', 1]])).total, 0);
  assert.equal(calculate(events([['cancel', 30]])).total, 11600);
});

test('sort by day then insertion ID, without mutating the input', () => {
  const input = events([['resume', 21], ['pause', 11], ['seats', 15]]);
  const original = structuredClone(input);
  assert.equal(calculate(input).total, 8667);
  assert.deepEqual(calculate(input).events.map((event) => event.id), [2, 3, 1]);
  assert.deepEqual(input, original);
  assert.equal(calculate(events([['pause', 16], ['resume', 16]])).total, 12000);
  assert.equal(calculate(events([['resume', 16], ['pause', 16]])).total, 6000);
  assert.equal(calculate([...events([['pause', 16], ['resume', 16]])].reverse()).total, 12000);
});

test('paused upgrades and seats are saved without charges until resume', () => {
  const bill = calculate(events([['pause', 11], ['upgrade', 12], ['seats', 15], ['resume', 21]]));
  assert.equal(bill.total, 11667); // $40 + 10/30 × $230
  assert.equal(bill.lines[2].amount, 0);
  assert.equal(bill.lines[3].amount, 0);
  assert.equal(bill.seats, 5);
  assert.equal(bill.plan, 'Scale');
});

test('cancel is terminal, while collection failure is independent of service', () => {
  const bill = calculate(events([['cancel', 16], ['resume', 20], ['seats', 20], ['upgrade', 20], ['failure', 25]]));
  assert.equal(bill.total, 6000);
  assert.equal(bill.status, 'cancelled');
  assert.equal(bill.plan, 'Launch');
  assert.equal(bill.seats, 3);
  assert.equal(bill.collection, 'Payment failed');
  assert.ok(bill.lines.slice(2).every((line) => line.amount === 0));
  const activeFailure = calculate(events([['failure', 15]]));
  assert.equal(activeFailure.total, 12000);
  assert.equal(activeFailure.status, 'active');
});

test('repeated lifecycle transitions are explicitly no-ops', () => {
  const bill = calculate(events([['upgrade', 10], ['upgrade', 11], ['pause', 15], ['pause', 16], ['resume', 20], ['resume', 21]]));
  for (const index of [2, 4, 6]) assert.equal(bill.lines[index].amount, 0);
});

test('validate boundaries, event IDs and types before calculating', () => {
  for (const input of [null, [{ type: 'constructor', day: 1, id: 1 }], events([['pause', 0]]), events([['seats', 31]]), events([['resume', 1.5]]), [{ type: 'pause', day: 1, id: -1 }], [{ type: 'pause', day: 1, id: 1 }, { type: 'resume', day: 2, id: 1 }], Array.from({ length: 13 }, (_, i) => ({ type: 'seats', day: 1, id: i + 1 }))]) {
    assert.throws(() => calculate(input));
  }
});

// Independent oracle: sum the service used on each day, rather than adjustments.
function dailyReference(input) {
  let base = 9000, seats = 3, paused = false, cancelled = false, sum = 0;
  for (let day = 1; day <= 30; day++) {
    for (const event of input.filter((event) => event.day === day).sort((a, b) => a.id - b.id)) {
      if (cancelled) continue;
      if (event.type === 'upgrade') base = 18000;
      if (event.type === 'seats') seats += 2;
      if (event.type === 'pause') paused = true;
      if (event.type === 'resume') paused = false;
      if (event.type === 'cancel') cancelled = true;
    }
    if (!paused && !cancelled) sum += base + seats * 1000;
  }
  return Math.round(sum / 30);
}

test('2,000 seeded scenarios match an independent daily ledger with no rounding drift', () => {
  let seed = 743813;
  const rand = (max) => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % max; };
  const types = Object.keys(TYPES);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const input = Array.from({ length: rand(MAX_EVENTS + 1) }, (_, i) => ({ id: i + 1, day: rand(30) + 1, type: types[rand(types.length)] }));
    const bill = calculate(input);
    assert.equal(bill.total, dailyReference(input), JSON.stringify(input));
    assert.equal(bill.total, bill.lines.reduce((sum, line) => sum + line.amount, 0));
    assert.ok(bill.total >= 0);
    for (let i = 0; i < bill.events.length; i++) {
      assert.equal(bill.events[i].total, dailyReference(bill.events.slice(0, i + 1)));
    }
  }
});

test('context includes the selected item, assumptions, full scenario and question, replacing old context', () => {
  const payload = contextualMessage('Could we pause instead?', example('failure'), 3);
  for (const text of ['Could we pause instead?', '30 days', 'Selected: Sep 25, Cancel subscription', 'Payment failed', '$123.00', 'Payment fails']) assert.ok(payload.includes(text), text);
  const fresh = contextualMessage(payload, [], 'base');
  assert.equal(fresh.split(CONTEXT_MARKER).length, 2);
  assert.ok(fresh.includes('$120.00'));
  assert.ok(!fresh.includes('Payment failed'));
});
