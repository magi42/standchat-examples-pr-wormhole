// Builds examples.json (the list on the front page) from each example's <head>.
// No dependencies. Runs locally with `npm run build` and on Vercel for every deploy.
//
// An example is a top-level folder with an index.html. Folders starting with
// "_" or "." are not examples. See CONTRIBUTING.md for the required tags.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://examples.stand.chat';
// The front page lists these first, most interesting first. Examples not listed
// here follow alphabetically, until someone gives them a place.
const ORDER = [
  'chat-mascot',
  'adventure-game-chat',
  'demoscene-chat',
  'raster-harbour',
  'vintage-terminal',
  'stand-inline',
  'stand-card',
  'stand-button',
  'in-app-support',
  'one-line-install',
];
const REQUIRED = {
  'title': '<title>',
  'description': '<meta name="description">',
  'author': '<meta name="author">',
  'og:title': '<meta property="og:title">',
  'og:description': '<meta property="og:description">',
  'og:image': '<meta property="og:image">',
  'twitter:card': '<meta name="twitter:card">',
};

const examples = [];
const problems = [];

for (const entry of readdirSync('.', { withFileTypes: true })) {
  const slug = entry.name;
  if (!entry.isDirectory() || /^[._]/.test(slug) || slug === 'node_modules') continue;

  const fail = (message) => problems.push(`${slug}/: ${message}`);
  if (!existsSync(`${slug}/index.html`)) {
    fail('no index.html. Shared folders must start with "_".');
    continue;
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail('folder name must be lowercase-kebab-case (it is the URL).');

  const meta = readHead(readFileSync(`${slug}/index.html`, 'utf8'));
  for (const [key, tag] of Object.entries(REQUIRED)) {
    if (!meta[key]) fail(`missing ${tag}`);
  }

  const image = meta['og:image'] ?? '';
  if (image && !image.startsWith('https://')) fail('og:image must be an absolute https:// URL.');
  const local = image.startsWith(`${SITE}/`) ? `.${new URL(image).pathname}` : null;
  if (local && !existsSync(local)) {
    fail(`og:image points to ${local.slice(1)}, which does not exist.`);
  } else if (local?.endsWith('.png')) {
    const bytes = readFileSync(local); // PNG header: width and height at bytes 16 and 20.
    const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    if (width !== 1200 || height !== 630) {
      fail(`${local.slice(2)} is ${width}×${height}. Social images are 1200×630: run npm run og -- ${slug}`);
    }
  }

  examples.push({
    slug,
    url: `/${slug}/`,
    title: meta.title,
    description: meta.description,
    author: meta.author,
    authorUrl: meta.authorUrl ?? null,
    keywords: (meta.keywords ?? '').split(',').map((k) => k.trim()).filter(Boolean),
    image: image.startsWith(`${SITE}/`) ? image.slice(SITE.length) : image,
  });
}

for (const slug of ORDER) {
  if (!examples.some((example) => example.slug === slug)) problems.push(`build.mjs: ORDER lists ${slug}/, which isn't an example.`);
}

if (problems.length) {
  console.error(`\nCan't build the example list:\n${problems.map((p) => `  ✗ ${p}`).join('\n')}\n`);
  process.exit(1);
}

const place = (slug) => (ORDER.includes(slug) ? ORDER.indexOf(slug) : ORDER.length);
examples.sort((a, b) => place(a.slug) - place(b.slug) || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
writeFileSync('examples.json', `${JSON.stringify(examples, null, 2)}\n`);
console.log(`examples.json: ${examples.length} examples (${examples.map((e) => e.slug).join(', ')})`);

// Reads <title>, <meta name|property content> and <link rel="author" href> from <head>.
function readHead(html) {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? '';
  const meta = {};
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) meta.title = decode(title[1].trim());
  for (const [tag, name] of head.matchAll(/<(meta|link)\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    if (name.toLowerCase() === 'meta') {
      const key = (attrs.name ?? attrs.property ?? '').toLowerCase();
      if (key && attrs.content?.trim()) meta[key] ??= decode(attrs.content.trim());
    } else if (/(^|\s)author(\s|$)/i.test(attrs.rel ?? '') && attrs.href) {
      meta.authorUrl ??= decode(attrs.href);
    }
  }
  return meta;
}

function attributes(tag) {
  const attrs = {};
  const body = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function decode(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const hex = entity[1].toLowerCase() === 'x';
    return String.fromCodePoint(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
  });
}
