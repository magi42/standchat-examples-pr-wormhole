export const BASE = Object.freeze({ quantity: 2, preorder: false, personal: false, wholesale: false, destinations: false, stage: 'storefront', scenario: 'Your own order' });
export const STAGES = ['storefront', 'checkout', 'fulfillment'];
export const CATALOG = Object.freeze({
  preorder: { title: 'Mix now + later', tier: 'Built in', stage: 'storefront', note: 'Add one $18 saucer, ready on day 21. Ready items ship separately.', question: 'How would you communicate a mixed in-stock and preorder basket to a customer?' },
  personal: { title: 'Make it personal', tier: 'Add-on', stage: 'storefront', note: 'Personalize every mug for $6 each. Mugs become ready on day 3.', question: 'What would a personalization add-on need for proofs, edits, and production holds?' },
  wholesale: { title: 'A wholesale buyer', tier: 'Built in', stage: 'checkout', note: 'At least 6 mugs. Take 20% off merchandise; services stay full price.', question: 'What buyer approval and pricing rules would my wholesale workflow need?' },
  destinations: { title: 'More than one doorstep', tier: 'Expert review', stage: 'fulfillment', note: 'At least 2 mugs. Split mugs across two destinations; send the saucer to B.', question: 'What needs review before supporting two destinations in one checkout?' },
});
export const SCENARIOS = Object.freeze({
  gift: { ...BASE, personal: true, destinations: true, stage: 'fulfillment', scenario: 'The thoughtful gift' },
  launch: { ...BASE, preorder: true, stage: 'storefront', scenario: 'The staggered launch' },
  stockist: { ...BASE, quantity: 6, preorder: true, wholesale: true, stage: 'checkout', scenario: 'The new stockist' },
});
export const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function normalize(input) {
  const s = { ...BASE, ...input };
  for (const key of Object.keys(CATALOG)) s[key] = Boolean(s[key]);
  const minimum = s.wholesale ? 6 : s.destinations ? 2 : 1;
  s.quantity = Math.max(minimum, Math.min(12, Math.trunc(Number(s.quantity) || 2)));
  s.stage = STAGES.includes(s.stage) ? s.stage : 'storefront';
  return s;
}
export function calculate(input) {
  const s = normalize(input);
  const merchandise = s.quantity * 3200 + (s.preorder ? 1800 : 0);
  const discount = s.wholesale ? Math.round(merchandise * 0.2) : 0;
  const personalization = s.personal ? s.quantity * 600 : 0;
  const shipments = [];
  const mugDay = s.personal ? 3 : 0;
  const add = (destination, mugs, saucers, day) => shipments.push({ destination, mugs, saucers, day, units: mugs + saucers });
  if (s.destinations) {
    add('A', Math.ceil(s.quantity / 2), 0, mugDay);
    add('B', Math.floor(s.quantity / 2), 0, mugDay);
  } else add('A', s.quantity, 0, mugDay);
  if (s.preorder) add(s.destinations ? 'B' : 'A', 0, 1, 21);
  const shipping = shipments.length * 800;
  const taxable = merchandise - discount + personalization;
  const tax = Math.round(taxable * 0.07);
  return { state: s, merchandise, discount, personalization, shipping, tax, total: taxable + tax + shipping, units: s.quantity + Number(s.preorder), shipments };
}
export function contextMessage(input, question) {
  const p = calculate(input), s = p.state;
  const exceptions = Object.entries(CATALOG).filter(([key]) => s[key]).map(([, c]) => `${c.title} (${c.tier})`).join('; ') || 'None';
  return `Question: ${question.trim()}\n\nShopgrove fictional order snapshot\nScenario: ${s.scenario}. Stage: ${s.stage}.\nItems: ${s.quantity} Grove mugs at $32 each${s.preorder ? '; 1 preorder saucer at $18' : ''}. ${p.units} units total.\nExceptions: ${exceptions}.\nMerchandise ${money(p.merchandise)}; discount ${money(p.discount)}; personalization ${money(p.personalization)}; shipping ${money(p.shipping)}; illustrative tax ${money(p.tax)}; total ${money(p.total)} USD.\nShipment preview: ${p.shipments.map(x => `${x.mugs} mugs + ${x.saucers} saucers to ${x.destination}, day ${x.day}`).join('; ')}.\nAssumptions: fictional prices; wholesale minimum 6 mugs and 20% off merchandise only; personalization $6/mug and ready day 3; saucer ready day 21; $8 per shipment; 7% tax on discounted merchandise plus personalization, rounded once to cents, shipping untaxed. Two destinations split mugs evenly, extra mug to A, saucer to B. Day 0 means ready in this simulation, not shipped. No real inventory, payment, shipping, or tax quote. Discuss requirements; do not claim Shopgrove is a real platform or perform order operations.`;
}
