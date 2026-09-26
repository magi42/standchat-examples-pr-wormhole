import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, CATALOG, SCENARIOS, calculate, normalize, contextMessage } from './order-model.js';

test('base order has exact integer-cent totals and one ready group', () => {
  const p = calculate(BASE);
  assert.equal(p.total, 7648);
  assert.equal(p.tax, 448);
  assert.equal(p.units, 2);
  assert.deepEqual(p.shipments, [{ destination: 'A', mugs: 2, saucers: 0, day: 0, units: 2 }]);
});
test('preorder stays separate and does not delay ready mugs', () => {
  const p = calculate(SCENARIOS.launch);
  assert.equal(p.total, 10374);
  assert.deepEqual(p.shipments.map(x => [x.day, x.units]), [[0, 2], [21, 1]]);
});
test('personalized split gifts have no invented units and preserve service price', () => {
  const p = calculate(SCENARIOS.gift);
  assert.equal(p.total, 9732);
  assert.equal(p.personalization, 1200);
  assert.deepEqual(p.shipments.map(x => [x.destination, x.mugs, x.day]), [['A', 1, 3], ['B', 1, 3]]);
});
test('wholesale applies to merchandise, not services or shipping', () => {
  const p = calculate({ ...BASE, quantity: 7, wholesale: true, personal: true, preorder: true, destinations: true });
  assert.equal(p.merchandise, 24200);
  assert.equal(p.discount, 4840);
  assert.equal(p.personalization, 4200);
  assert.equal(p.shipping, 2400);
  assert.equal(p.tax, 1649);
  assert.equal(p.total, 27609);
  assert.deepEqual(p.shipments.map(x => [x.destination, x.mugs, x.saucers, x.day]), [['A', 4, 0, 3], ['B', 3, 0, 3], ['B', 0, 1, 21]]);
});
test('all 192 combinations conserve quantities, money, and unique readiness groups', () => {
  const keys = Object.keys(CATALOG);
  for (let bits = 0; bits < 16; bits++) for (let quantity = 1; quantity <= 12; quantity++) {
    const flags = Object.fromEntries(keys.map((k, i) => [k, Boolean(bits & (1 << i))]));
    const p = calculate({ ...BASE, ...flags, quantity });
    assert.equal(p.shipments.reduce((n, x) => n + x.mugs, 0), p.state.quantity);
    assert.equal(p.shipments.reduce((n, x) => n + x.saucers, 0), Number(p.state.preorder));
    assert.equal(p.shipments.reduce((n, x) => n + x.units, 0), p.units);
    assert.equal(new Set(p.shipments.map(x => `${x.destination}:${x.day}`)).size, p.shipments.length);
    assert.equal(p.shipping, p.shipments.length * 800);
    assert.equal(p.total, p.merchandise - p.discount + p.personalization + p.tax + p.shipping);
    assert.ok(p.shipments.every(x => x.units > 0 && x.mugs >= 0 && x.saucers >= 0));
    assert.ok(Number.isSafeInteger(p.total));
    assert.ok(p.total > 0);
  }
});
test('invalid and boundary quantities normalize to bounded viable orders', () => {
  assert.equal(normalize({ quantity: 100 }).quantity, 12);
  assert.equal(normalize({ quantity: -5 }).quantity, 1);
  assert.equal(normalize({ quantity: 'bad' }).quantity, 2);
  assert.equal(normalize({ quantity: 1, wholesale: true }).quantity, 6);
  assert.equal(normalize({ quantity: 1, destinations: true }).quantity, 2);
  assert.equal(normalize({ quantity: 3.9 }).quantity, 3);
  assert.equal(normalize({ stage: 'shipped' }).stage, 'storefront');
});
test('context includes exact active scenario, catalog labels, allocation, assumptions, question', () => {
  const message = contextMessage({ ...SCENARIOS.stockist, destinations: true }, 'Can we approve buyers first?');
  for (const expected of ['Can we approve buyers first?', 'The new stockist', 'Stage: checkout', '6 Grove mugs', '1 preorder saucer', 'Expert review', '3 mugs + 0 saucers to A', '0 mugs + 1 saucers to B', 'shipping untaxed', 'No real inventory']) assert.ok(message.includes(expected), expected);
});
