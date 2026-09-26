// The "Start your store" wizard as data: its six steps, the options, Awning's
// plans, and what a set of answers implies (a plan, a checklist, apps).
// No DOM. The wizard, the storefront preview and the advisor all read from here,
// so the page, the prompt and the references can't drift apart.

export const STEPS = [
  { n: 1, id: 'products', name: 'Products', title: 'What will you sell?', hint: 'Pick everything that applies. You can add more later.' },
  { n: 2, id: 'channels', name: 'Channels', title: 'Where do you sell today?', hint: 'We’ll bring your orders and stock together, wherever the sale happens.' },
  { n: 3, id: 'markets', name: 'Markets', title: 'Where are your customers?', hint: 'Pick the countries you’ll ship or sell to. Prices show in your home market’s currency.' },
  { n: 4, id: 'size', name: 'Size', title: 'How big are you?', hint: 'Rough numbers are fine. They help us suggest a plan, nothing else.' },
  { n: 5, id: 'name', name: 'Name', title: 'Name your store', hint: 'You can change the name, the address and the look whenever you like.' },
  { n: 6, id: 'plan', name: 'Plan', title: 'Your plan', hint: 'Based on your answers. Every plan starts with 14 days free, no card needed.' },
];

export const SELLS = [
  { id: 'physical', label: 'Physical products', detail: 'Packed and shipped', short: 'physical', icon: 'box' },
  { id: 'digital', label: 'Digital downloads', detail: 'Files, patterns, presets', short: 'digital', icon: 'download' },
  { id: 'services', label: 'Services & bookings', detail: 'Classes and sessions', short: 'services', icon: 'calendar' },
  { id: 'subscriptions', label: 'Subscriptions', detail: 'Refills, boxes, clubs', short: 'subscriptions', icon: 'repeat' },
  { id: 'custom', label: 'Made to order', detail: 'Commissions, one-offs', short: 'made to order', icon: 'ruler' },
];

export const CHANNELS = [
  { id: 'social', label: 'Social media', detail: 'Posts, stories, DMs', short: 'social', icon: 'heart' },
  { id: 'marketplaces', label: 'Marketplaces', detail: 'Handmade and resale', short: 'marketplaces', icon: 'grid' },
  { id: 'inperson', label: 'In person', detail: 'A shop or a studio', short: 'in person', icon: 'store' },
  { id: 'events', label: 'Markets & events', detail: 'Fairs and pop-ups', short: 'markets & events', icon: 'tent' },
  { id: 'none', label: 'Nowhere yet', detail: 'Today is day one', short: 'nowhere yet', icon: 'sparkle', exclusive: true },
];

// Illustrative exchange rates for the preview's prices, and a studio town per market.
export const COUNTRIES = {
  US: { name: 'United States', short: 'the US', currency: 'USD', locale: 'en-US', language: 'English', eu: false, rate: 1, town: 'Portland' },
  GB: { name: 'United Kingdom', short: 'the UK', currency: 'GBP', locale: 'en-GB', language: 'English', eu: false, rate: 0.79, town: 'Leeds' },
  DE: { name: 'Germany', short: 'Germany', currency: 'EUR', locale: 'de-DE', language: 'Deutsch', eu: true, rate: 0.92, town: 'Leipzig' },
  FR: { name: 'France', short: 'France', currency: 'EUR', locale: 'fr-FR', language: 'Français', eu: true, rate: 0.92, town: 'Lyon' },
  NL: { name: 'Netherlands', short: 'the Netherlands', currency: 'EUR', locale: 'nl-NL', language: 'Nederlands', eu: true, rate: 0.92, town: 'Utrecht' },
  ES: { name: 'Spain', short: 'Spain', currency: 'EUR', locale: 'es-ES', language: 'Español', eu: true, rate: 0.92, town: 'Valencia' },
  IT: { name: 'Italy', short: 'Italy', currency: 'EUR', locale: 'it-IT', language: 'Italiano', eu: true, rate: 0.92, town: 'Bologna' },
  SE: { name: 'Sweden', short: 'Sweden', currency: 'SEK', locale: 'sv-SE', language: 'Svenska', eu: true, rate: 10.8, town: 'Malmö' },
  FI: { name: 'Finland', short: 'Finland', currency: 'EUR', locale: 'fi-FI', language: 'Suomi', eu: true, rate: 0.92, town: 'Tampere' },
  JP: { name: 'Japan', short: 'Japan', currency: 'JPY', locale: 'ja-JP', language: '日本語', eu: false, rate: 150, town: 'Kyoto' },
};
export const COUNTRY_ORDER = ['US', 'GB', 'DE', 'FR', 'NL', 'ES', 'IT', 'SE', 'FI', 'JP'];

const CURRENCY = {
  USD: { symbol: '$', scale: 1 },
  EUR: { symbol: '€', scale: 1 },
  GBP: { symbol: '£', scale: 1 },
  SEK: { suffix: ' kr', scale: 10 },
  JPY: { symbol: '¥', scale: 100 },
};

// Monthly sales, in round numbers of the home currency.
const SALES_STEPS = [1000, 10000, 50000, 250000];
export const SALES_COUNT = 6;
export const CATALOG = ['1–10', '11–100', '101–1,000', '1,000+'];
export const TEAM = ['Just me', '2–5', '6–15', '16+'];

export const LOOKS = [
  { id: 'linen', label: 'Linen', note: 'Warm, bookish' },
  { id: 'moss', label: 'Moss', note: 'Calm, green' },
  { id: 'ink', label: 'Ink', note: 'Crisp, graphic' },
  { id: 'sunny', label: 'Sunny', note: 'Loud, happy' },
];

export const PLANS = [
  { id: 'kiosk', name: 'Kiosk', price: 9, yearly: 7, for: 'For selling in chats and on social', staff: 1, rate: null, onlineStore: false },
  { id: 'corner', name: 'Corner', price: 32, yearly: 24, for: 'For shops opening their doors', staff: 2, rate: '2.9% + 30¢' },
  { id: 'mainstreet', name: 'Main Street', price: 89, yearly: 67, for: 'For shops with regulars', staff: 5, rate: '2.6% + 30¢' },
  { id: 'flagship', name: 'Flagship', price: 319, yearly: 239, for: 'For shops selling abroad', staff: 15, rate: '2.4% + 30¢' },
  { id: 'landmark', name: 'Landmark', price: 2100, yearly: 2100, from: true, for: 'For brands with many doors', staff: Infinity, rate: '2.1% + 30¢' },
];
// The wizard builds an online store, so it chooses from Corner up.
export const WIZARD_PLANS = ['corner', 'mainstreet', 'flagship', 'landmark'];
export const plan = (id) => PLANS.find((p) => p.id === id);
const rank = (id) => PLANS.findIndex((p) => p.id === id);

export const APPS = [
  { id: 'subscriptions', name: 'Subscriptions', detail: 'Repeat orders your customers can skip or pause', icon: 'repeat' },
  { id: 'bookings', name: 'Bookings', detail: 'Time slots, deposits and reminders', icon: 'calendar' },
  { id: 'downloads', name: 'Downloads', detail: 'Files delivered right after checkout', icon: 'download' },
];

export function defaultAnswers(locale = 'en-US') {
  const region = String(locale).split('-')[1]?.toUpperCase();
  return {
    sells: [],
    channels: [],
    // The home market starts as a guess from the browser's language, and only
    // counts as an answer once the visitor has seen the step.
    markets: [COUNTRIES[region] ? region : 'US'],
    sales: 0,
    catalog: 0,
    team: 0,
    name: '',
    look: 'linen',
    plan: null, // A plan the visitor picked; otherwise the recommendation.
    seen: [1],
  };
}

export const home = (answers) => COUNTRIES[answers.markets[0]] ?? COUNTRIES.US;
export const has = (list, id) => list.includes(id);

/** A money amount in the home market's currency, for sales ranges: $1k, 10k kr, ¥100k. */
export function roundMoney(usd, currencyCode) {
  const c = CURRENCY[currencyCode] ?? CURRENCY.USD;
  const value = usd * c.scale;
  const text = value >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : `${Math.round(value / 1000)}k`;
  return c.suffix ? `${text}${c.suffix}` : `${c.symbol}${text}`;
}

/** "Just starting", "Under €1k", "€1k–10k"… per month, in the home currency. */
export function salesLabel(index, currencyCode) {
  const m = (usd) => roundMoney(usd, currencyCode);
  const bare = (usd) => m(usd).replace(/^[$€£¥]/, '');
  if (index <= 0) return 'Just starting';
  if (index === 1) return `Under ${m(SALES_STEPS[0])}`;
  if (index >= SALES_COUNT - 1) return m(SALES_STEPS.at(-1)).replace(/(k|M)( kr)?$/, '$1+$2');
  const [from, to] = [SALES_STEPS[index - 2], SALES_STEPS[index - 1]];
  // "€1k–10k" and "10k–100k kr": one currency sign per range.
  return CURRENCY[currencyCode]?.suffix ? `${m(from).replace(' kr', '')}–${m(to)}` : `${m(from)}–${bare(to)}`;
}

export function slug(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // Accents off, so the address stays plain.
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'your-store';
}

/**
 * Which plan fits, and why. Every reason is a fact the prompt also knows, and
 * `why(planId)` words it for whichever plan the card shows.
 */
export function recommend(a) {
  let pick = 'corner';
  const reasons = [];
  // `topic` keeps a plan card from saying the same thing twice.
  const need = (id, topic, why) => {
    if (rank(id) > rank(pick)) pick = id;
    reasons.push({ plan: id, topic, why: typeof why === 'function' ? why : () => why });
  };
  const currencies = new Set(a.markets.map((code) => COUNTRIES[code]?.currency));
  const abroad = a.seen.includes(3) && currencies.size >= 2 && (a.markets.length >= 4 || a.sales >= 3);
  const rate = (planId) => `A lower card rate at your volume: ${plan(planId).rate}`;

  if (a.team >= 3) need('landmark', 'staff', 'Unlimited staff accounts for a team of 16+');
  if (a.sales >= 5) need('landmark', 'rate', 'The lowest card rate, 2.1% + 30¢, and B2B selling');
  if (a.team === 2) need('flagship', 'staff', 'Staff accounts for your team of 6–15');
  if (a.sales === 4) need('flagship', 'rate', rate);
  if (abroad) need('flagship', 'markets', `Local currency, language and domain in ${a.markets.length} countries`);
  if (has(a.sells, 'subscriptions')) need('mainstreet', 'apps', 'The Subscriptions app is included, not $10 a month');
  if (has(a.sells, 'services')) need('mainstreet', 'apps', 'The Bookings app is included for your services');
  if (a.team === 1) need('mainstreet', 'staff', 'Staff accounts for your team of 2–5');
  if (a.sales === 3) need('mainstreet', 'rate', rate);
  return { plan: pick, reasons };
}

const HIGHLIGHTS = {
  corner: [['store', 'An online store with unlimited products'], ['domain', 'A free .awning.shop address, live when you publish'], ['pos', 'The POS app, free, for selling in person']],
  mainstreet: [['apps', 'Subscriptions and Bookings apps included'], ['staff', '5 staff accounts'], ['rate', 'Card rate 2.6% + 30¢']],
  flagship: [['markets', 'Local currency, language and domain per country'], ['duties', 'Duties calculated at checkout'], ['staff', '15 staff accounts']],
  landmark: [['staff', 'Unlimited staff accounts'], ['rate', 'Card rate 2.1% + 30¢, and B2B selling'], ['scale', 'Priced for many locations and brands']],
};

/** Up to three reasons for a plan card: yours first, then what the plan is known for. */
export function planReasons(a, planId) {
  const seen = new Set();
  const out = [];
  const mine = recommend(a).reasons.filter((r) => rank(r.plan) <= rank(planId)).map((r) => [r.topic, r.why(planId)]);
  for (const [topic, why] of [...mine, ...(HIGHLIGHTS[planId] ?? [])]) {
    if (seen.has(topic) || out.length === 3) continue;
    seen.add(topic);
    out.push(why);
  }
  return out;
}

export const shownPlan = (a) => a.plan ?? recommend(a).plan;

const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** The setup checklist for these answers. `extra` holds items a reply pointed at. */
export function checklist(a, extra = []) {
  const hm = home(a);
  const planId = shownPlan(a);
  const markets = a.markets.map((code) => COUNTRIES[code]);
  const ships = has(a.sells, 'physical') || has(a.sells, 'custom') || a.sells.length === 0;
  const inPerson = has(a.channels, 'inperson') || has(a.channels, 'events');
  const items = [];

  items.push({
    id: 'products',
    icon: 'tag',
    title: 'Add your first products',
    detail: a.catalog >= 2
      ? 'Upload a spreadsheet of your catalogue and add photos as you go. Variants, stock and SKUs come along.'
      : 'A photo, a price and how many you have. Your storefront fills in as you add them.',
  });
  if (has(a.channels, 'marketplaces') || a.catalog >= 2 || extra.includes('import')) {
    items.push({
      id: 'import',
      icon: 'import',
      title: has(a.channels, 'marketplaces') ? 'Import your marketplace listings' : 'Import your catalogue',
      detail: 'Bring products, customers and orders over from a spreadsheet or another platform. The importer is free.',
    });
  }
  items.push({
    id: 'payments',
    icon: 'card',
    title: 'Turn on payments',
    detail: `Cards, wallets and bank transfer in ${list([...new Set(markets.map((m) => m.currency))])}, paid out every 2 business days. ${plan(planId).rate} per card payment on ${plan(planId).name}.`,
  });
  const eu = markets.filter((m) => m.eu);
  const taxes = [`Checkout adds the right VAT or sales tax. You register and file; Awning gives you the reports.`];
  if (hm.eu && eu.length > 1) {
    taxes.push(`Selling to other EU countries: under €10,000 a year you charge ${hm.name === 'Finland' ? 'Finnish' : 'your home'} VAT; above it, the buyer’s rate, filed through the One-Stop Shop.`);
  }
  if (a.markets.includes('US')) taxes.push('US sales tax is state by state: you register where you pass a state’s threshold.');
  items.push({
    id: 'taxes',
    icon: 'percent',
    title: `Set up taxes for ${list(a.markets.map((code) => COUNTRIES[code].short))}`,
    detail: taxes.join(' '),
  });
  if (ships || extra.includes('shipping')) {
    const zones = [`Domestic (${hm.name})`];
    if (hm.eu && eu.length > 1) zones.push('EU');
    for (const m of markets.slice(1)) if (!(hm.eu && m.eu)) zones.push(m.name);
    items.push({
      id: 'shipping',
      icon: 'truck',
      title: `Shipping zones: ${zones.join(', ')}`,
      detail: `Flat or weight-based rates per zone, with cheaper labels in the US, UK, Germany and France.${inPerson ? ' Local pickup is one switch.' : ''}`,
    });
  }
  if (has(a.sells, 'custom')) {
    items.push({ id: 'leadtimes', icon: 'clock', title: 'Set lead times for made-to-order', detail: 'Shown on the product page and at checkout, so nobody expects it tomorrow.' });
  }
  if (inPerson || extra.includes('pos')) {
    items.push({
      id: 'pos',
      icon: 'reader',
      title: 'Pair a card reader',
      detail: `The POS app is free on every plan. The Tap reader, $59, takes cards and wallets${has(a.channels, 'events') ? ' at your market stall' : ''}, and stock stays in sync with your store.`,
    });
  }
  items.push({
    id: 'domain',
    icon: 'globe',
    title: `Claim ${slug(a.name)}.awning.shop`,
    detail: 'Free, and live the moment you publish. Connect a domain you own any time; a new one is $14 a year.',
  });
  return items;
}

/** Apps these answers call for, plus any a reply pointed at, with the price on a plan. */
export function apps(a, extra = []) {
  const wanted = new Set(extra);
  if (has(a.sells, 'subscriptions')) wanted.add('subscriptions');
  if (has(a.sells, 'services')) wanted.add('bookings');
  if (has(a.sells, 'digital')) wanted.add('downloads');
  const planId = shownPlan(a);
  return APPS.filter((app) => wanted.has(app.id)).map((app) => ({
    ...app,
    price: app.id === 'downloads' ? 'Free' : rank(planId) >= rank('mainstreet') ? 'Included' : '$10/month',
  }));
}

/**
 * What a reply can point at: [[Step: Markets]], [[Plan: Main Street]]… The
 * prompt lists `name`; aliases catch the near misses a model sometimes writes.
 */
export const REFERENCES = [
  ...STEPS.map((s) => ({ name: `Step: ${s.name}`, kind: 'step', target: s.n, label: `Step ${s.n} · ${s.name}`, aliases: [`step ${s.n}`, `step ${s.n} ${s.name}`, s.name, `${s.name} step`] })),
  ...PLANS.filter((p) => p.id !== 'kiosk').map((p) => ({ name: `Plan: ${p.name}`, kind: 'plan', target: p.id, label: p.name, aliases: [p.name, `${p.name} plan`] })),
  { name: 'Checklist: Payments', kind: 'checklist', target: 'payments', label: 'Payments', aliases: ['payments', 'awning payments'] },
  { name: 'Checklist: Taxes', kind: 'checklist', target: 'taxes', label: 'Taxes', aliases: ['taxes', 'tax', 'vat'] },
  { name: 'Checklist: Shipping', kind: 'checklist', target: 'shipping', label: 'Shipping', aliases: ['shipping', 'shipping zones'] },
  { name: 'Checklist: Point of sale', kind: 'checklist', target: 'pos', label: 'Point of sale', aliases: ['point of sale', 'pos', 'tap reader', 'card reader', 'pos app'] },
  { name: 'Checklist: Domain', kind: 'checklist', target: 'domain', label: 'Domain', aliases: ['domain', 'domains', 'custom domain'] },
  { name: 'Checklist: Import', kind: 'checklist', target: 'import', label: 'Import', aliases: ['import', 'importer'] },
  // Replies write "the [[App: Subscriptions]] app", so the chip says just the name.
  ...APPS.map((app) => ({ name: `App: ${app.name}`, kind: 'app', target: app.id, label: app.name, aliases: [app.name, `${app.name} app`] })),
];
