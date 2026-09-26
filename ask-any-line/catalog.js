// The quickstart's code, as data: every line of every sample, with the logical
// ID that says what the line does. Node's `amount: 2000,` and Python's
// `amount=2000,` share the ID "amount", so a question asked on one follows the
// visitor to the other when they switch languages.
//
// The samples live in index.html as <script type="text/plain" data-sample>
// blocks, one line per row: `logical-id │ code`. A row without an ID is a
// blank line. Several IDs, comma-separated, make a line answer to all of them
// (the curl sample squeezes a few steps into one command).

export const LANGS = [
  { key: 'node', label: 'Node', lang: 'js' },
  { key: 'python', label: 'Python', lang: 'python' },
  { key: 'ruby', label: 'Ruby', lang: 'ruby' },
  { key: 'go', label: 'Go', lang: 'go' },
  { key: 'curl', label: 'curl', lang: 'sh' },
];

// What each line is about, in words. This is the "part" a question names:
// ⌘ server.py L20 (Python) — amount: …
// Lines that only open or close something are named after what they belong to.
export const PARTS = {
  'header': 'file header', 'header-2': 'file header', 'package': 'file header',
  'import': 'import Tender', 'framework': 'imports', 'import-extra': 'imports', 'import-extra-2': 'imports',
  'import-extra-3': 'imports', 'import-open': 'imports', 'import-close': 'imports',
  'client-init': 'api key', 'api-key': 'api key', 'api-key-env': 'api key', 'api-key-end': 'api key',
  'api-version': 'api version',
  'app': 'server setup', 'static': 'server setup', 'main': 'server setup', 'main-end': 'server setup',
  'json-body': 'create-payment endpoint', 'route-create': 'create-payment endpoint', 'route-create-def': 'create-payment endpoint',
  'route-create-end': 'create-payment endpoint', 'read-order': 'order id', 'read-order-var': 'order id',
  'create-comment': 'create payment', 'create-payment': 'create payment', 'params-open': 'create payment',
  'params-close': 'create payment', 'create-end': 'create payment', 'create-error': 'create payment',
  'create-error-2': 'create payment', 'create-error-3': 'create payment', 'create-error-4': 'create payment',
  'amount': 'amount', 'currency': 'currency', 'methods': 'payment methods', 'metadata': 'metadata',
  'idempotency': 'idempotency key', 'content-type': 'client secret', 'create-response': 'client secret',
  'client-secret': 'client secret', 'client-secret-2': 'client secret', 'client-secret-3': 'client secret',
  'listen-comment': 'start server', 'listen': 'start server',
  'raw-body': 'raw body', 'payload': 'raw body',
  'route-webhook': 'webhook endpoint', 'route-webhook-def': 'webhook endpoint', 'route-webhook-end': 'webhook endpoint',
  'verify-comment': 'verify signature', 'event-var': 'verify signature', 'try': 'verify signature',
  'verify': 'verify signature', 'verify-end': 'verify signature',
  'sig-header': 'signature header', 'webhook-secret': 'webhook secret',
  'bad-signature': 'bad signature', 'reject': 'bad signature', 'reject-2': 'bad signature', 'catch-end': 'bad signature',
  'trigger-comment': 'payment.succeeded', 'event-type': 'payment.succeeded', 'event-end': 'payment.succeeded',
  'fulfill': 'fulfill order', 'respond': 'respond 2xx',
  // checkout.js
  'tenderjs': 'load Tender.js',
  'fetch-secret': 'fetch client secret', 'fetch-method': 'fetch client secret',
  'fetch-headers': 'fetch client secret', 'fetch-end': 'fetch client secret', 'send-order': 'send order id',
  'card': 'card field', 'mount': 'mount card field',
  'form': 'payment form', 'submit': 'submit handler', 'prevent-default': 'submit handler', 'submit-end': 'submit handler',
  'confirm': 'confirm payment', 'confirm-fields': 'confirm payment', 'confirm-end': 'confirm payment',
  'return-url': 'return url', 'error-comment': 'show error', 'show-error': 'show error',
};

// Where a line's thread goes in a language that has no such line: Python has
// no closing `});`, curl has no web server. Followed until a line exists.
export const FALLBACK = {
  'header-2': 'header', 'package': 'header', 'framework': 'import', 'import-extra': 'import',
  'import-extra-2': 'import-extra', 'import-extra-3': 'import-extra', 'import-open': 'import',
  'import-close': 'import', 'import': 'api-key',
  'client-init': 'api-key', 'api-key-env': 'api-key', 'api-key-end': 'api-key', 'api-version': 'api-key',
  'app': 'static', 'static': 'main', 'main': 'listen', 'main-end': 'listen', 'listen-comment': 'listen',
  'listen': 'route-webhook',
  'json-body': 'route-create', 'route-create-def': 'route-create', 'route-create': 'create-payment', 'route-create-end': 'client-secret',
  'read-order-var': 'read-order', 'read-order': 'metadata',
  'create-comment': 'create-payment', 'params-open': 'create-payment', 'params-close': 'create-payment',
  'create-end': 'create-payment', 'create-error': 'create-payment', 'create-error-2': 'create-error',
  'create-error-3': 'create-error', 'create-error-4': 'create-error',
  'content-type': 'client-secret', 'create-response': 'client-secret', 'client-secret-2': 'client-secret',
  'client-secret-3': 'client-secret', 'client-secret': 'create-payment',
  'raw-body': 'payload', 'payload': 'verify', 'route-webhook-def': 'route-webhook', 'route-webhook-end': 'respond',
  'route-webhook': 'verify', 'verify-comment': 'verify', 'event-var': 'verify', 'try': 'verify', 'verify-end': 'verify',
  'sig-header': 'verify', 'webhook-secret': 'verify', 'bad-signature': 'verify', 'reject': 'bad-signature',
  'reject-2': 'reject', 'catch-end': 'bad-signature', 'trigger-comment': 'event-type', 'event-end': 'event-type',
  'fulfill': 'event-type', 'respond': 'event-type',
};

// A reference to one of these lights up the whole statement, not one line.
export const GROUPS = {
  'api-key': ['client-init', 'api-key', 'api-version', 'api-key-end'],
  'create-payment': ['create-payment', 'params-open', 'amount', 'currency', 'methods', 'metadata', 'params-close', 'idempotency', 'create-end'],
  'client-secret': ['client-secret', 'client-secret-2', 'client-secret-3'],
  'route-create': ['route-create', 'route-create-def'],
  'route-webhook': ['route-webhook', 'route-webhook-def'],
  'verify': ['verify', 'payload', 'sig-header', 'webhook-secret', 'verify-end'],
  'bad-signature': ['bad-signature', 'reject', 'reject-2', 'catch-end'],
  'event-type': ['event-type', 'fulfill', 'event-end'],
  'fetch-secret': ['fetch-secret', 'fetch-method', 'fetch-headers', 'send-order', 'fetch-end'],
  'mount': ['card', 'mount'],
  'submit': ['form', 'submit', 'prevent-default'],
  'confirm': ['confirm', 'confirm-fields', 'return-url', 'confirm-end'],
};

// The names a reply may put in [[double brackets]]. The prompt lists the main
// ones; the rest resolve too, in case the Stand-in picks another part.
export const REFERENCES = {
  'file header': ['server', 'header'], 'imports': ['server', 'framework'],
  'api key': ['server', 'api-key'], 'api version': ['server', 'api-version'],
  'import tender': ['server', 'import'], 'server setup': ['server', 'app'],
  'create-payment endpoint': ['server', 'route-create'], 'order id': ['server', 'read-order'],
  'create payment': ['server', 'create-payment'], 'amount': ['server', 'amount'], 'currency': ['server', 'currency'],
  'payment methods': ['server', 'methods'], 'metadata': ['server', 'metadata'],
  'idempotency key': ['server', 'idempotency'], 'client secret': ['server', 'client-secret'],
  'webhook endpoint': ['server', 'route-webhook'], 'raw body': ['server', 'raw-body'],
  'verify signature': ['server', 'verify'], 'signature header': ['server', 'sig-header'],
  'webhook secret': ['server', 'webhook-secret'], 'bad signature': ['server', 'bad-signature'],
  'payment.succeeded': ['server', 'event-type'], 'fulfill order': ['server', 'fulfill'],
  'respond 2xx': ['server', 'respond'], 'start server': ['server', 'listen'],
  'load tender.js': ['client', 'tenderjs'], 'fetch client secret': ['client', 'fetch-secret'],
  'send order id': ['client', 'send-order'], 'card field': ['client', 'card'],
  'mount card field': ['client', 'mount'], 'payment form': ['client', 'form'], 'submit handler': ['client', 'submit'],
  'confirm payment': ['client', 'confirm'], 'return url': ['client', 'return-url'], 'show error': ['client', 'show-error'],
};

/** Reads the samples, steps and sub-steps from the page. */
export function loadCatalog(root = document) {
  const files = { server: {}, client: {} };
  for (const block of root.querySelectorAll('script[type="text/plain"][data-sample]')) {
    const kind = block.dataset.sample; // server | client
    const lines = parseSample(block.textContent);
    const entry = { name: block.dataset.file, lang: block.dataset.syntax, lines };
    if (kind === 'client') files.client.all = entry;
    else files.server[block.dataset.lang] = entry;
  }

  const steps = [...root.querySelectorAll('[data-step]')].map((el) => ({
    n: Number(el.dataset.step),
    title: el.dataset.title,
    el,
    subs: [...el.querySelectorAll('[data-sub]')].map((sub) => ({
      id: sub.dataset.sub,
      el: sub,
      file: sub.dataset.file,
      focus: (sub.dataset.focus ?? '').split(/\s+/).filter(Boolean),
    })),
  }));

  return {
    langs: LANGS,
    steps,
    /** The sample a visitor sees for this file and language. */
    file(kind, lang) {
      return kind === 'client' ? files.client.all : files.server[lang];
    },
    fileName(kind, lang) {
      return this.file(kind, lang)?.name ?? '';
    },
    langLabel(lang) {
      return LANGS.find((l) => l.key === lang)?.label ?? lang;
    },
    langByLabel(label) {
      return LANGS.find((l) => l.label.toLowerCase() === String(label).toLowerCase())?.key ?? null;
    },
    /** Which file and language a file name belongs to: server.py → server, python. */
    whichFile(name) {
      if (files.client.all?.name === name) return { kind: 'client', lang: null };
      for (const [lang, entry] of Object.entries(files.server)) if (entry.name === name) return { kind: 'server', lang };
      return null;
    },
    /** The line that shows logical ID `id` in this file, following fallbacks. */
    locate(kind, lang, id) {
      const lines = this.file(kind, lang)?.lines ?? [];
      const seen = new Set();
      for (let at = id; at && !seen.has(at); at = FALLBACK[at]) {
        seen.add(at);
        const line = lines.find((l) => l.ids.includes(at));
        if (line) return { line, exact: at === id };
      }
      return { line: lines.find((l) => l.text.trim()) ?? null, exact: false };
    },
    /** All line numbers of a logical ID's group, in this file and language. */
    group(kind, lang, id) {
      const ids = GROUPS[id] ?? [id];
      const lines = this.file(kind, lang)?.lines ?? [];
      const found = lines.filter((l) => l.ids.some((x) => ids.includes(x))).map((l) => l.n);
      return found.length ? found : [this.locate(kind, lang, id).line?.n].filter(Boolean);
    },
    part(id) {
      return PARTS[id] ?? id.replace(/-/g, ' ');
    },
  };
}

/** `amount │   amount: 2000,` → { ids: ['amount'], id: 'amount', text: '  amount: 2000,' } */
export function parseSample(source) {
  const rows = source.replace(/^\n+|\s+$/g, '').split('\n');
  return rows.map((row, i) => {
    const bar = row.indexOf('│');
    const head = bar < 0 ? '' : row.slice(0, bar).trim();
    const text = bar < 0 ? row : row.slice(bar + 1).replace(/^ /, '');
    const ids = head ? head.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return { n: i + 1, ids, id: ids[0] ?? '', text: text.replace(/\s+$/, '') };
  });
}
