// A deterministic teaching model: invented units, prices and capacities.
export const PROFILES = Object.freeze({
  storefront: { name: 'Storefront', description: 'Product pages, baskets, and a very good launch day.', cpuMs: 8, dbOps: 2, kb: 60, cacheable: 0.75, aiShare: 0 },
  workspace: { name: 'Team workspace', description: 'Signed-in activity, shared projects, and frequent writes.', cpuMs: 18, dbOps: 4, kb: 24, cacheable: 0.35, aiShare: 0 },
  studio: { name: 'AI studio', description: 'Small responses. Much more work behind each one.', cpuMs: 35, dbOps: 2, kb: 12, cacheable: 0.10, aiShare: 0.25 },
});
export const SCENARIOS = Object.freeze({ steady: 'Launch day', bots: 'Bot spike', ai: 'AI-heavy requests' });
export const RATES = Object.freeze({ base: 2, edge: 0.08, cpu: 0.024, db: 0.12, transfer: 0.06, ai: 0.002 });
export const DEFAULTS = Object.freeze({ profile: 'storefront', traffic: 1200, scenario: 'steady', cache: true, limit: false, budget: 25 });
export const PRESETS = Object.freeze({
  launch: DEFAULTS,
  spike: { profile: 'storefront', traffic: 2400, scenario: 'bots', cache: true, limit: false, budget: 25 },
  ai: { profile: 'studio', traffic: 300, scenario: 'ai', cache: true, limit: true, budget: 25 },
});
const clamp = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
export function normalize(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  return {
    profile: Object.hasOwn(PROFILES, input.profile) ? input.profile : DEFAULTS.profile,
    traffic: Math.round(clamp(input.traffic, 10, 5000, DEFAULTS.traffic) / 10) * 10,
    scenario: Object.hasOwn(SCENARIOS, input.scenario) ? input.scenario : DEFAULTS.scenario,
    cache: typeof input.cache === 'boolean' ? input.cache : DEFAULTS.cache,
    limit: typeof input.limit === 'boolean' ? input.limit : DEFAULTS.limit,
    budget: clamp(input.budget, 1, 10000, DEFAULTS.budget),
  };
}
export function calculate(input) {
  const state = normalize(input);
  const profile = PROFILES[state.profile];
  const incoming = state.traffic * (state.scenario === 'bots' ? 3 : 1);
  const hits = state.cache ? profile.cacheable * 0.8 : 0;
  const aiShare = state.scenario === 'ai' ? 1 : profile.aiShare;
  const aiPrice = RATES.ai * (state.scenario === 'ai' ? 3 : 1);
  const work = (admitted) => {
    const origin = admitted * (1 - hits);
    const cpuCores = origin * profile.cpuMs / 1000;
    const dbPerSecond = origin * profile.dbOps;
    const gb = admitted * 3600 * profile.kb / 1e6;
    const aiCalls = origin * 3600 * aiShare;
    const costs = { base: RATES.base, edge: incoming * 3600 / 1e6 * RATES.edge,
      cpu: cpuCores * 60 * RATES.cpu, db: dbPerSecond * 3600 / 1e6 * RATES.db,
      transfer: gb * RATES.transfer, ai: aiCalls * aiPrice };
    return { admitted, origin, cached: admitted * hits, cpuCores, dbPerSecond, gb, aiCalls, costs,
      total: Object.values(costs).reduce((a, b) => a + b, 0) };
  };
  const uncapped = work(incoming);
  const floor = uncapped.costs.base + uncapped.costs.edge;
  const fraction = state.limit ? Math.max(0, Math.min(1, (state.budget - floor) / (uncapped.total - floor))) : 1;
  const result = work(incoming * fraction);
  return { state, profile, incoming, hits, aiShare, aiPrice, fraction, floor, uncapped: uncapped.total,
    deferred: incoming - result.admitted, cpuPercent: result.cpuCores / 8 * 100,
    dbPercent: result.dbPerSecond / 12000 * 100, ...result };
}
export const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const number = (n, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
export function scenarioContext(result, focus) {
  const r = result, s = r.state, p = r.profile;
  return [
    `Launchmere model v1 — illustrative fictional infrastructure; not a benchmark or quote. Selected item: ${focus}.`,
    `Scenario: ${p.name}, ${SCENARIOS[s.scenario]}. One sustained hour. Base ${s.traffic} req/s; incoming ${r.incoming} req/s (bots add 2x base). Cache ${s.cache ? 'on' : 'off'}; ${number(r.hits * 100, 1)}% hits. Spend limit ${s.limit ? money(s.budget) + '/hour' : 'off'}.`,
    `After limit: admitted ${number(r.admitted, 2)} req/s; deferred ${number(r.deferred, 2)}; cache ${number(r.cached, 2)}; origin ${number(r.origin, 2)}. CPU ${number(r.cpuPercent, 1)}% of 8 cores; database ${number(r.dbPercent, 1)}% of 12,000 ops/s.`,
    `Assumptions: each origin request needs ${p.cpuMs} CPU-ms and ${p.dbOps} DB ops; each admitted response ${p.kb} decimal KB; ${p.cacheable * 100}% cacheable with 80% hits when enabled; ${r.aiShare * 100}% of origin requests use AI at $${r.aiPrice}/call.`,
    'Fictional rates: base $2/h; ingress $0.08/million; CPU $0.024/core-minute; database $0.12/million ops; transfer $0.06/decimal GB. AI base $0.002/call; AI-heavy uses 3x price and every origin request.',
    `One-hour costs: ${Object.entries(r.costs).map(([k, v]) => `${k} ${money(v)}`).join(', ')}; total ${money(r.total)}; without limit ${money(r.uncapped)}.`,
    'Limit fraction = clamp((budget - base - ingress) / uncapped variable cost, 0, 1). Base and ingress still accrue. Capacity does not auto-scale or drop traffic. No latency, burst, retry, token-length, tax or real performance predictions. Replies cannot change the simulator.',
  ].join('\n');
}
