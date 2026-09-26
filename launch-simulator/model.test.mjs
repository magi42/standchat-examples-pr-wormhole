import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DEFAULTS, PROFILES, SCENARIOS, normalize, scenarioContext } from './model.js';
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);

test('one launch hour has independently calculated work and bill', () => {
  const r = calculate(DEFAULTS);
  near(r.incoming, 1200); near(r.cached, 720); near(r.origin, 480);
  near(r.cpuCores, 3.84); near(r.dbPerSecond, 960); near(r.gb, 259.2);
  near(r.cpuPercent, 48); near(r.dbPercent, 8);
  near(r.costs.base, 2); near(r.costs.edge, .3456); near(r.costs.cpu, 5.5296);
  near(r.costs.db, .41472); near(r.costs.transfer, 15.552); near(r.costs.ai, 0);
  near(r.total, 23.84192);
});
test('caching reduces origin work without hiding ingress or response transfer', () => {
  const on = calculate(DEFAULTS), off = calculate({ ...DEFAULTS, cache: false });
  near(off.origin, 1200); near(off.cpuCores, 9.6);
  near(off.costs.edge, on.costs.edge); near(off.costs.transfer, on.costs.transfer);
  near(on.costs.cpu / off.costs.cpu, .4); near(on.costs.db / off.costs.db, .4);
  assert.ok(off.cpuPercent > 100);
});
test('bot spike adds twice the base and triples every variable charge', () => {
  const normal = calculate(DEFAULTS), bots = calculate({ ...DEFAULTS, scenario: 'bots' });
  near(bots.incoming, 3600);
  near(bots.total - 2, (normal.total - 2) * 3);
  near(bots.costs.base, normal.costs.base);
});
test('AI-heavy changes AI share and price, not CPU work per origin request', () => {
  const regular = calculate({ ...DEFAULTS, profile: 'studio', traffic: 300 });
  const heavy = calculate({ ...regular.state, scenario: 'ai' });
  near(regular.origin, 276); near(regular.aiCalls, 248400);
  near(regular.costs.ai, 496.8); near(heavy.aiCalls, 993600);
  near(heavy.costs.ai, 5961.6); near(heavy.costs.cpu, regular.costs.cpu);
  near(heavy.costs.ai / regular.costs.ai, 12);
});
test('guardrail proportionally defers work but cannot remove fixed or ingress cost', () => {
  const raw = calculate({ ...DEFAULTS, scenario: 'bots' });
  const limited = calculate({ ...raw.state, limit: true, budget: 25 });
  near(limited.total, 25); assert.ok(limited.deferred > 0);
  near(limited.costs.edge, raw.costs.edge); near(limited.costs.base, 2);
  near(limited.costs.cpu / raw.costs.cpu, limited.fraction);
  const low = calculate({ ...raw.state, limit: true, budget: 1 });
  near(low.admitted, 0); near(low.total, 3.0368);
  assert.ok(low.total > low.state.budget);
  const high = calculate({ ...raw.state, limit: true, budget: 10000 });
  near(high.total, raw.total); near(high.deferred, 0);
});
test('conservation, finite results and complete context across the scenario space', () => {
  for (const profile of Object.keys(PROFILES)) for (const scenario of Object.keys(SCENARIOS))
  for (const cache of [true, false]) for (const limit of [true, false])
  for (const traffic of [10, 300, 1200, 5000]) for (const budget of [1, 25, 10000]) {
    const r = calculate({ profile, scenario, cache, limit, traffic, budget });
    near(r.incoming, r.admitted + r.deferred);
    near(r.admitted, r.origin + r.cached);
    near(r.total, Object.values(r.costs).reduce((sum, cost) => sum + cost, 0));
    assert.ok(r.total >= r.floor && Number.isFinite(r.total));
    assert.ok(r.fraction >= 0 && r.fraction <= 1);
    if (limit) assert.ok(r.total <= Math.max(budget, r.floor) + 1e-7);
    const context = scenarioContext(r, 'Database operations');
    assert.ok(context.length <= 2000, `context too long: ${context.length}`);
    for (const fragment of ['Selected item:', 'Spend limit', 'Assumptions:', 'Fictional rates:', 'One-hour costs:', 'Limit fraction']) assert.ok(context.includes(fragment));
  }
});
test('input boundaries reject unknown profiles and non-finite values', () => {
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.equal(normalize({ profile: '__proto__', scenario: 'constructor' }).profile, 'storefront');
  const s = normalize({ traffic: Infinity, budget: NaN, cache: 'false' });
  assert.equal(s.traffic, 1200); assert.equal(s.budget, 25); assert.equal(s.cache, true);
  assert.equal(normalize({ traffic: -2, budget: 0 }).traffic, 10);
  assert.equal(normalize({ traffic: 6000, budget: 999999 }).budget, 10000);
});
