// The rules engine: reads a package.json in the browser and works out what
// Airstrip (a made-up host) would do with it. No network, no DOM: it returns
// plain data that the page, the build log and the chat prompt all read.
//
// Every claim here is about the fictional platform, and matches the facts in
// the chat prompt (chat.js), so the answers agree with the page.

export const PLATFORM = {
  node: { versions: [24, 22], beta: 26, fallback: 24 },
  functionLimitMB: 200,
  edgeLimitMB: 2,
  bodyLimitMB: 5,
  regions: 18,
};

// Meta-frameworks first: the first match is the app's framework.
const FRAMEWORKS = [
  { pkg: 'next', name: 'Next.js', output: 'hybrid', build: 'next build', site: 'dashboard' },
  { pkg: 'nuxt', name: 'Nuxt', output: 'ssr', build: 'nuxt build', site: 'app' },
  { pkg: '@sveltejs/kit', name: 'SvelteKit', output: 'ssr', build: 'vite build', site: 'store' },
  { pkg: 'astro', name: 'Astro', output: 'static', build: 'astro build', site: 'blog' },
  { pkg: '@react-router/dev', name: 'React Router', output: 'ssr', build: 'react-router build', site: 'app' },
  { pkg: '@remix-run/react', name: 'Remix', output: 'ssr', build: 'remix vite:build', site: 'app' },
  { pkg: '@remix-run/dev', name: 'Remix', output: 'ssr', build: 'remix vite:build', site: 'app' },
  { pkg: '@tanstack/react-start', name: 'TanStack Start', output: 'ssr', build: 'vite build', site: 'app' },
  { pkg: '@solidjs/start', name: 'SolidStart', output: 'ssr', build: 'vinxi build', site: 'app' },
  { pkg: '@builder.io/qwik-city', name: 'Qwik City', output: 'ssr', build: 'qwik build', site: 'app' },
  { pkg: '@angular/core', name: 'Angular', output: 'spa', build: 'ng build', site: 'app' },
  { pkg: 'gatsby', name: 'Gatsby', output: 'static', build: 'gatsby build', site: 'blog' },
  { pkg: 'vitepress', name: 'VitePress', output: 'static', build: 'vitepress build', site: 'docs' },
  { pkg: '@docusaurus/core', name: 'Docusaurus', output: 'static', build: 'docusaurus build', site: 'docs' },
  { pkg: '@11ty/eleventy', name: 'Eleventy', output: 'static', build: 'eleventy', site: 'blog' },
  { pkg: 'react-scripts', name: 'Create React App', output: 'spa', build: 'react-scripts build', site: 'app' },
  { pkg: 'expo', name: 'Expo', output: 'spa', build: 'expo export -p web', site: 'app' },
];

// Frameworks that run as a server. Hono is at home in functions and at the edge.
const SERVERS = [
  { pkg: 'hono', name: 'Hono', fits: true },
  { pkg: '@nestjs/core', name: 'NestJS' },
  { pkg: 'fastify', name: 'Fastify' },
  { pkg: 'koa', name: 'Koa' },
  { pkg: '@hapi/hapi', name: 'hapi' },
  { pkg: 'express', name: 'Express' },
  { pkg: '@apollo/server', name: 'Apollo Server' },
];

// A plain Vite app: the view library names it.
const VIEW_LIBRARIES = [
  ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['solid-js', 'Solid'], ['preact', 'Preact'], ['lit', 'Lit'],
];

const DEV_TOOLS = new Set([
  'nodemon', 'eslint', 'prettier', 'jest', 'vitest', 'mocha', 'ts-node', 'concurrently',
  'husky', 'lint-staged', 'supertest', 'cypress', '@playwright/test',
]);
const SAFE_POSTINSTALL = /^(prisma generate|nuxt prepare|nuxi prepare|patch-package|husky( install)?|svelte-kit sync|ngcc|astro sync)\b/;

/**
 * Parses the visitor's text. npm is strict about JSON, so we are too, but a
 * near-miss (comments, trailing commas) is still analyzed, with the error as a
 * finding: that is exactly what someone pasting it wants to know.
 */
export function readPackageJson(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (!source.trim()) return { error: 'Paste or drop a package.json to start.' };
  if (source.length > 200_000) return { error: 'That file is over 200 KB. A package.json is usually a few KB.' };
  let pkg;
  let invalid = null;
  try {
    pkg = JSON.parse(source);
  } catch (strictError) {
    invalid = describeJsonError(strictError, source);
    try {
      pkg = JSON.parse(loosen(source));
    } catch {
      return { error: `That isn't valid JSON: ${invalid.message}${invalid.line ? ` (line ${invalid.line}, column ${invalid.column})` : ''}.` };
    }
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { error: 'A package.json is a JSON object: { "name": …, "dependencies": … }.' };
  if ('lockfileVersion' in pkg) return { error: 'That looks like package-lock.json. Paste package.json, the smaller file next to it.' };
  if ('compilerOptions' in pkg) return { error: 'That looks like tsconfig.json. Paste package.json instead.' };
  const known = ['name', 'dependencies', 'devDependencies', 'scripts', 'workspaces', 'packageManager', 'engines'];
  if (!known.some((key) => key in pkg)) return { error: 'That JSON has no name, scripts or dependencies. Is it a package.json?' };
  return { pkg, invalid };
}

function describeJsonError(error, source) {
  const message = String(error?.message ?? 'Unexpected input').replace(/^JSON\.parse: /, '');
  const at = message.match(/position (\d+)/);
  const lineCol = message.match(/line (\d+) column (\d+)/);
  let line = 0;
  let column = 0;
  if (lineCol) {
    line = Number(lineCol[1]);
    column = Number(lineCol[2]);
  } else if (at) {
    const before = source.slice(0, Number(at[1]));
    line = before.split('\n').length;
    column = before.length - before.lastIndexOf('\n');
  }
  const short = message.split(/ in JSON| at position|,? "\S/)[0].replace(/\.$/, '');
  return { message: short || 'Unexpected input', line, column };
}

// Strips comments and trailing commas outside strings. Only for reading a near-miss.
function loosen(source) {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      const start = i;
      for (i++; i < source.length && source[i] !== '"'; i++) if (source[i] === '\\') i++;
      out += source.slice(start, i + 1);
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Everything the page needs to know about one package.json. */
export function analyze(pkg, { invalid = null } = {}) {
  const deps = record(pkg.dependencies);
  const devDeps = record(pkg.devDependencies);
  const all = { ...devDeps, ...deps };
  const has = (name) => Object.hasOwn(all, name);
  const hasProd = (name) => Object.hasOwn(deps, name);
  const scripts = record(pkg.scripts);
  const scriptText = Object.values(scripts).join(' \n ');
  const name = safeName(pkg.name);
  const findings = [];
  const add = (finding) => findings.push({ packages: [], questions: [], ...finding });

  // --- Framework and output ------------------------------------------------
  let framework = null;
  const meta = FRAMEWORKS.find((f) => has(f.pkg));
  if (meta) framework = { ...meta, version: version(all[meta.pkg]) };
  if (framework?.name === 'Angular' && has('@angular/ssr')) framework = { ...framework, output: 'ssr' };
  const server = SERVERS.find((s) => has(s.pkg)) ?? null;
  if (!framework && has('vite')) {
    const lib = VIEW_LIBRARIES.find(([p]) => has(p));
    framework = { pkg: 'vite', name: 'Vite', lib: lib?.[1] ?? '', output: 'spa', build: 'vite build', site: 'app', version: version(all.vite) };
  }
  if (!framework && server) {
    framework = { pkg: server.pkg, name: server.name, output: 'api', build: '', site: 'api', version: version(all[server.pkg]) };
  }
  // "SvelteKit 2.15", "Vite 6.0 + React"
  if (framework) framework.label = `${framework.name}${framework.version ? ` ${framework.version}` : ''}${framework.lib ? ` + ${framework.lib}` : ''}`;
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : Array.isArray(pkg.workspaces?.packages) ? pkg.workspaces.packages : [];
  const isRoot = workspaces.length > 0 && !framework;
  let output = framework?.output ?? (isRoot ? 'none' : 'static');
  if (framework?.name === 'SvelteKit') {
    if (has('@sveltejs/adapter-static')) output = 'static';
  }
  if (framework?.name === 'Astro' && has('@astrojs/node')) output = 'ssr';
  if (framework?.name === 'Nuxt' && /nuxt generate/.test(scripts.build ?? '')) output = 'static';
  if (framework && framework.output !== 'api' && server && !server.fits) output = 'hybrid';

  // --- Package manager -----------------------------------------------------
  const pm = packageManager(pkg.packageManager);

  // --- Node version --------------------------------------------------------
  const node = nodeVersion(pkg.engines?.node);

  // --- Findings: the platform basics ----------------------------------------
  if (invalid) {
    add({
      id: 'invalid-json', level: 'error', title: 'package.json isn’t valid JSON',
      brief: 'not valid JSON, so the install fails',
      summary: `npm stops here: ${invalid.message}${invalid.line ? ` on line ${invalid.line}` : ''}.`,
      detail: 'Comments and trailing commas are fine in many config files, but npm reads package.json with a strict JSON parser, so the install fails before anything builds. Remove them and paste it again: everything below is what happens once it parses.',
      fatal: 'Installing',
      log: { phase: 'Installing', level: 'error', text: `npm can’t read package.json: ${invalid.message}${invalid.line ? ` (line ${invalid.line}:${invalid.column})` : ''}` },
      questions: ['Why is this an error if my editor accepts it?', 'What else would fail after this?'],
    });
  }

  if (framework && framework.output !== 'api') {
    const outputs = {
      static: `Static output: every page is prebuilt and served from all ${PLATFORM.regions} regions.`,
      ssr: 'Server-rendered routes run as Node functions; prerendered pages and assets go to the edge.',
      hybrid: framework.output === 'spa'
        ? `The ${framework.name} build is served from the edge; ${server?.name ?? 'the server'} runs as a Node function.`
        : 'Static pages go to the edge; server routes run as Node functions, middleware at the edge.',
      spa: 'A single-page app: static files at the edge, with routing in the browser.',
    };
    add({
      id: 'framework', level: 'ok', title: `${framework.label} detected`,
      summary: outputs[output] ?? outputs[framework.output],
      detail: `Detected from “${framework.pkg}” in your dependencies. Airstrip picks the build command, output folder and routing for ${framework.name} on its own, so there is nothing to configure.`,
      packages: [framework.pkg],
      log: { phase: 'Building', level: 'info', text: `Detected ${framework.label} · ${{ static: 'static output', ssr: 'server-rendered', hybrid: 'static + functions', spa: 'single-page app' }[output] ?? output}` },
      questions: [`What does Airstrip do differently for ${framework.name}?`, output === 'static' || output === 'spa' ? 'Does anything here run on a server?' : 'Which parts of my app become functions?'],
    });
  }

  if (pm.source === 'packageManager') {
    add({
      id: 'package-manager', level: pm.name === 'yarn' && pm.major === 1 ? 'info' : 'ok',
      title: `${pm.label} from packageManager`,
      summary: pm.name === 'bun' ? 'Installs with bun. Your functions still run on Node.' : pm.name === 'yarn' && pm.major === 1 ? 'Yarn 1 works, but it only gets fixes now. Yarn 4 or pnpm install faster.' : `Installs with ${pm.label}, the exact version you pinned.`,
      detail: `The packageManager field pins the tool and its version, so every build installs the same way your laptop does. Airstrip installs with a frozen lockfile: if the lockfile and package.json disagree, the build stops instead of guessing.`,
      log: { phase: 'Installing', level: 'muted', text: `Using ${pm.label} (from “packageManager”)` },
      questions: ['Do I need a lockfile?', 'Can I switch package managers later?'],
    });
  } else {
    add({
      id: 'package-manager', level: 'info', title: 'No packageManager field',
      summary: 'Airstrip uses the lockfile it finds, and npm when there is none.',
      detail: 'Without packageManager, the build falls back to whichever lockfile is committed. Pinning it, for example "packageManager": "pnpm@9.15.4", makes local and cloud installs match exactly.',
      fix: '"packageManager": "npm@10.9.2"',
      log: { phase: 'Installing', level: 'muted', text: 'No “packageManager”: using npm 10 (no lockfile found in this preview)' },
      questions: ['Which package manager is fastest on Airstrip?', 'What happens if I have two lockfiles?'],
    });
  }

  if (node.status === 'missing') {
    add({
      id: 'node-version', level: 'info', title: 'No engines.node',
      summary: `Builds and functions use Node ${PLATFORM.node.fallback}, the default.`,
      detail: `Without an engines.node range, Airstrip uses its default Node version, which moves to the next LTS release when that ships. Pin a major, like "node": "24.x", to decide when you upgrade.`,
      fix: '"engines": { "node": "24.x" }',
      log: { phase: 'Installing', level: 'muted', text: `Node.js ${PLATFORM.node.fallback} (default, no engines.node)` },
      questions: ['Which Node versions does Airstrip support?', 'Will my functions change Node version on their own?'],
    });
  } else if (node.status === 'unsupported') {
    add({
      id: 'node-version', level: 'error', title: `engines.node “${node.range}” can’t build`,
      brief: `allows only end-of-life Node ${node.allowed.join('/') || ''}, so the build fails`,
      summary: `It only allows Node ${node.allowed.join(', ') || 'versions'} that reached end of life. Allow 22.x or 24.x.`,
      detail: `Airstrip builds on Node 22 and 24 (24 is the default). Node 20 and older are past end of life and can't be used for new builds. Widen the range, for example to "24.x", and test locally on that version first.`,
      fix: '"engines": { "node": "24.x" }',
      fatal: 'Installing',
      log: { phase: 'Installing', level: 'error', text: `engines.node “${node.range}” allows no supported Node.js version (22.x, 24.x)` },
      questions: ['What breaks when I move to Node 24?', 'Can I still deploy on Node 20?'],
    });
  } else if (node.status === 'unknown') {
    add({
      id: 'node-version', level: 'info', title: `engines.node “${node.range}” isn’t a version range`,
      summary: `Airstrip ignores it and builds on Node ${PLATFORM.node.fallback}.`,
      detail: 'engines.node takes a semver range like "24.x" or ">=22". Aliases like "lts/*" work in version managers, but not here.',
      fix: '"engines": { "node": "24.x" }',
      log: { phase: 'Installing', level: 'warn', text: `Couldn’t read engines.node “${node.range}”: using Node.js ${PLATFORM.node.fallback}` },
      questions: ['Which format should engines.node use?'],
    });
  } else {
    const beta = node.major === PLATFORM.node.beta;
    add({
      id: 'node-version', level: beta ? 'warn' : node.openEnded ? 'info' : 'ok',
      brief: beta ? 'Node 26 beta' : '',
      title: beta ? `Node ${node.major} is in beta` : `Builds on Node ${node.major}`,
      summary: beta
        ? 'It works, but beta runtimes can change. Allow 24.x as well for production.'
        : node.openEnded
          ? `“${node.range}” is open-ended: Airstrip picks ${node.major} today, and a newer major later.`
          : node.minorPinned
            ? `Only the major counts: builds get the latest ${node.major}.x.`
            : `“${node.range}” matches Node ${node.major}.x.`,
      detail: beta
        ? `Node ${node.major} builds are available to try. Production workloads should stay on 24 until ${node.major} becomes an LTS release.`
        : node.openEnded
          ? `A range with no upper bound, like "${node.range}", means a new Node major can reach your builds without a change on your side. Pin the major you test with, like "${node.major}.x".`
          : `Builds and Node functions run on the latest Node ${node.major}.x release. Airstrip supports Node 22 and 24; 20 and older can't build.`,
      fix: node.openEnded ? `"engines": { "node": "${node.major}.x" }` : '',
      log: { phase: 'Installing', level: beta ? 'warn' : 'muted', text: `Node.js ${node.major}.x (from engines.node “${node.range}”)` },
      questions: node.openEnded ? ['Should I pin the Node version?', 'What changes when Node 26 ships?'] : ['Which Node versions does Airstrip support?', 'Do functions use the same Node version?'],
    });
  }

  // --- Build and start scripts ---------------------------------------------
  if (scripts.build) {
    add({
      id: 'build-script', level: isRoot ? 'info' : 'ok', title: 'Build command found',
      summary: `Airstrip runs “${pm.run} build”: ${truncate(scripts.build, 60)}`,
      detail: 'Your build script is the build command. Anything it needs at build time, like database URLs for prerendering, must be set as environment variables for that environment.',
      questions: ['Can I use a different build command on Airstrip?', 'How long can a build take?'],
    });
  } else if (framework && framework.output !== 'api') {
    add({
      id: 'build-script', level: 'info', title: 'No build script',
      summary: `Airstrip runs ${framework.name}’s own build: “${framework.build}”.`,
      detail: `There's no "build" in scripts, so Airstrip falls back to ${framework.name}'s default command. Add "build": "${framework.build}" to make it explicit.`,
      fix: `"build": "${framework.build}"`,
      questions: ['Should I add a build script?'],
    });
  }

  if (server && !server.fits && (scripts.start || pkg.main)) {
    add({
      id: 'server', level: 'warn', title: `${server.name} runs as a function, not a server`,
      brief: `${server.name} runs per request as a function, not as a server`,
      summary: `Airstrip doesn't keep “${scripts.start ? truncate(scripts.start, 32) : `node ${pkg.main}`}” running. Each request runs your app.`,
      detail: `Export the ${server.name} app from a function file (functions/api.js: export default app) instead of calling listen(). Every request then runs it in a Node function. Anything kept in memory, like sessions or caches, is gone between requests, so keep it in a database or cache service.`,
      fix: `// functions/api.js\nimport app from '../${pkg.main ? String(pkg.main).replace(/^\.\//, '') : 'src/app.js'}';\nexport default app;`,
      packages: [server.pkg],
      log: { phase: 'Building', level: 'warn', text: `“${pm.run} start” isn't used: wrapping ${server.name} as a Node function (functions/api)` },
      questions: [`Do I need to change my ${server.name} code?`, 'What happens to in-memory sessions?'],
    });
  } else if (server?.fits) {
    add({
      id: 'server', level: 'ok', title: 'Hono fits functions',
      summary: 'Hono apps run in Node functions or at the edge without changes.',
      detail: 'Hono is built on web-standard Request and Response, so the same app runs as a Node function or an edge function. Export it as the default export of a function file.',
      packages: ['hono'],
      questions: ['Should my Hono app run at the edge?'],
    });
  }

  if (framework?.name === 'Create React App') {
    add({
      id: 'react-scripts', level: 'info', title: 'Create React App is deprecated',
      summary: 'It still builds and deploys, but gets no updates. Vite is the usual next step.',
      detail: 'react-scripts builds a static single-page app, which Airstrip serves from the edge. The React team has deprecated Create React App, so new projects and upgrades usually move to Vite or a framework.',
      packages: ['react-scripts'],
      questions: ['Will my CRA app keep working?', 'How hard is moving to Vite?'],
    });
  }

  if (framework?.output === 'spa') {
    add({
      id: 'spa-fallback', level: 'info', title: 'Client-side routes need a fallback',
      summary: 'Send unknown paths to index.html, so /settings works on reload.',
      detail: 'A single-page app handles routing in the browser. Without a fallback, reloading /settings asks the server for a file that does not exist. One rewrite in airstrip.json fixes it.',
      fix: '{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }',
      log: { phase: 'Deploying', level: 'muted', text: 'No rewrites: client-side routes 404 on reload (add a fallback to index.html)' },
      questions: ['Where do I put the rewrite?', 'Does this affect SEO?'],
    });
  }

  // --- Adapters --------------------------------------------------------------
  const kitAdapter = Object.keys(all).find((d) => /^@sveltejs\/adapter-(?!auto$|static$)/.test(d));
  if (framework?.name === 'SvelteKit' && has('@sveltejs/adapter-auto') && !kitAdapter) {
    add({
      id: 'adapter', level: 'ok', title: 'adapter-auto finds Airstrip',
      summary: 'Server routes become Node functions without extra config.',
      detail: 'SvelteKit\'s adapter-auto detects the platform at build time. On Airstrip it emits Node functions for server routes and static files for prerendered pages.',
      packages: ['@sveltejs/adapter-auto'],
      log: { phase: 'Building', level: 'muted', text: 'adapter-auto: using Airstrip’s Node functions' },
      questions: ['Can some routes run at the edge?'],
    });
  } else if (kitAdapter) {
    const nodeAdapter = kitAdapter === '@sveltejs/adapter-node';
    add({
      id: 'adapter', level: 'warn', title: nodeAdapter ? 'adapter-node builds a server' : `${kitAdapter.split('/')[1]} targets another platform`,
      brief: nodeAdapter ? 'adapter-node builds a server, needs adapter-auto' : 'adapter for another platform',
      summary: nodeAdapter ? 'Airstrip needs functions, not a long-running server. Use adapter-auto.' : 'Its output won’t run on Airstrip. Switch to adapter-auto.',
      detail: `${kitAdapter} shapes the build for ${nodeAdapter ? 'a Node server you start yourself' : 'a different host'}. With @sveltejs/adapter-auto, the same app builds into Airstrip functions and static files.`,
      fix: `npm remove ${kitAdapter} && npm add -D @sveltejs/adapter-auto`,
      packages: [kitAdapter],
      log: { phase: 'Building', level: 'warn', text: `${kitAdapter}: output isn't Airstrip functions, serving static files only` },
      questions: ['What changes if I switch adapters?'],
    });
  }

  // --- Native modules and runtimes ------------------------------------------
  if (has('node-sass')) {
    add({
      id: 'node-sass', level: 'error', title: 'node-sass doesn’t build on Node 22+',
      brief: 'fails to build on Node 22+, so the install fails',
      summary: 'It is deprecated and has no binaries for current Node. Switch to sass.',
      detail: 'node-sass wraps LibSass, which is no longer maintained, and fails to compile on Node 22 and 24. The sass package (Dart Sass) is a drop-in replacement for almost every project.',
      fix: 'npm remove node-sass && npm add -D sass',
      fatal: 'Installing', packages: ['node-sass'],
      log: { phase: 'Installing', level: 'error', text: `node-sass@${version(all['node-sass'], 3) || 'latest'}: node-gyp build failed (no binary for this Node version)` },
      questions: ['Is sass really a drop-in replacement?'],
    });
  }

  const nativeHash = ['bcrypt', 'argon2'].filter(has);
  for (const p of nativeHash) {
    add({
      id: p, level: 'warn', title: `${p} is a native addon`,
      brief: 'native addon: Node functions only, not the edge',
      summary: 'Works in Node functions. Edge functions can’t load it.',
      detail: `${p} compiles C++ during install with node-gyp. Routes that hash passwords in Node functions work as is. If a route moves to the edge, switch to ${p === 'bcrypt' ? 'bcryptjs (pure JavaScript, slower)' : 'a WebCrypto-based hash'} or @node-rs/argon2 (prebuilt binaries).`,
      fix: p === 'bcrypt' ? `${pm.remove} bcrypt && ${pm.add} bcryptjs` : `${pm.remove} argon2 && ${pm.add} @node-rs/argon2`,
      packages: [p],
      log: { phase: 'Installing', level: 'warn', text: `${p}@${version(all[p], 3)}: compiling native addon with node-gyp` },
      questions: ['Will this work at the edge?', 'What should I use instead?'],
    });
  }
  if (has('bcryptjs')) {
    add({
      id: 'bcryptjs', level: 'ok', title: 'bcryptjs runs anywhere',
      summary: 'Pure JavaScript: fine in Node functions and at the edge.',
      detail: 'bcryptjs has no native parts, so it installs fast and runs in every Airstrip runtime. It hashes a little slower than native bcrypt, which is rarely noticeable per login.',
      packages: ['bcryptjs'],
      questions: ['Is bcryptjs fast enough for logins?'],
    });
  }

  if (has('canvas')) {
    add({
      id: 'canvas', level: 'warn', title: 'canvas needs system libraries',
      brief: 'heavy native addon, adds ~60 MB to its function',
      summary: 'Airstrip builds it, but it adds ~60 MB to a function. @napi-rs/canvas is lighter.',
      detail: 'node-canvas links Cairo and Pango, which the build image includes. The traced function carries those libraries, so it gets large and starts slower. @napi-rs/canvas ships prebuilt binaries with no system dependencies. Neither runs at the edge.',
      fix: `${pm.remove} canvas && ${pm.add} @napi-rs/canvas`,
      packages: ['canvas'],
      log: { phase: 'Installing', level: 'warn', text: `canvas@${version(all.canvas, 3)}: building against Cairo and Pango (node-gyp)` },
      questions: ['Why is canvas so big?', 'Is @napi-rs/canvas compatible?'],
    });
  }

  if (has('sharp')) {
    add({
      id: 'sharp', level: 'info', title: 'sharp uses a prebuilt binary',
      summary: 'Works in Node functions and builds. Airstrip also resizes images for you.',
      detail: 'sharp downloads a prebuilt linux-x64 binary during install, so there is nothing to compile. It works at build time and in Node functions, not at the edge. For images on your pages, Airstrip’s image optimization resizes and caches them at the edge, so you may not need sharp at runtime.',
      packages: ['sharp'],
      log: { phase: 'Installing', level: 'muted', text: `sharp@${version(all.sharp, 3)}: prebuilt binary for linux-x64` },
      questions: ['Do I need sharp on Airstrip?', 'Does image optimization cost extra?'],
    });
  }

  if (has('fsevents')) {
    add({
      id: 'fsevents', level: 'ok', title: 'fsevents is skipped',
      summary: 'It is macOS-only, and builds run on Linux. Nothing to do.',
      detail: 'fsevents is an optional dependency for file watching on macOS. npm, pnpm and yarn skip it on Linux build machines.',
      packages: ['fsevents'],
      questions: [],
    });
  }

  // --- Headless browsers ------------------------------------------------------
  if (has('puppeteer')) {
    add({
      id: 'puppeteer', level: 'error', title: 'puppeteer is too big for a function',
      brief: `bundled Chromium exceeds the ${PLATFORM.functionLimitMB} MB function limit`,
      summary: `Its Chromium pushes the function past the ${PLATFORM.functionLimitMB} MB limit.`,
      detail: `Full puppeteer downloads its own Chromium (about 170 MB) at install, so the function that imports it ends up well past the ${PLATFORM.functionLimitMB} MB limit. Use puppeteer-core with a slim Chromium build made for functions (about 60 MB), and give that function 3 GB of memory, which needs Pro.`,
      fix: `${pm.remove} puppeteer && ${pm.add} puppeteer-core @sparticuz/chromium`,
      fatal: 'Deploying', packages: ['puppeteer'],
      log: { phase: 'Installing', level: 'warn', text: `puppeteer@${version(all.puppeteer, 3)}: downloading Chromium (171 MB)` },
      questions: ['How do I run a headless browser on Airstrip?', 'Which plan do I need for 3 GB?'],
    });
  } else if (has('puppeteer-core') && has('@sparticuz/chromium')) {
    add({
      id: 'puppeteer', level: 'ok', title: 'Slim Chromium fits',
      summary: 'puppeteer-core with a slim Chromium stays under the function limit.',
      detail: 'The slim build is about 60 MB, so the function fits. Give it 3 GB of memory (Pro) and a longer max duration: browsers start slowly.',
      packages: ['puppeteer-core', '@sparticuz/chromium'],
      questions: ['How much memory does a headless browser need?'],
    });
  } else if (has('playwright') || has('playwright-core')) {
    add({
      id: 'playwright', level: 'warn', title: 'Playwright’s browsers don’t fit functions',
      brief: 'browser builds too big for functions',
      summary: 'Its browser downloads exceed the function limit. Use a slim Chromium build.',
      detail: `Playwright is great in CI, but its browser builds are too large for a ${PLATFORM.functionLimitMB} MB function. For screenshots or PDFs in production, use playwright-core with a slim Chromium made for functions, or a hosted browser service.`,
      packages: ['playwright'],
      questions: ['Can I run tests with Playwright during the build?'],
    });
  }

  // --- Long-lived processes ----------------------------------------------------
  const socketPkgs = ['socket.io', 'ws', 'express-ws', '@fastify/websocket', 'uWebSockets.js', 'graphql-ws'].filter(has);
  if (socketPkgs.length) {
    const lead = socketPkgs[0];
    add({
      id: 'websockets', level: 'warn', title: 'WebSocket servers don’t stay up',
      brief: `${lead} server can't hold connections in functions`,
      summary: `Functions end with the response, so ${lead} can’t keep clients connected.`,
      detail: `Airstrip functions stop when the response ends, so a WebSocket server can't hold connections open. Connecting out to another socket service during a request works; hosting one doesn't. Move the live part to a hosted realtime service, or run the socket server on a long-running host, and keep the rest on Airstrip.`,
      packages: socketPkgs,
      log: { phase: 'Building', level: 'warn', text: `${lead} found: long-lived WebSocket connections aren't supported in functions` },
      questions: ['What should I use for realtime?', 'Can I keep my socket server somewhere else?'],
    });
  } else if (has('socket.io-client')) {
    add({
      id: 'websockets', level: 'ok', title: 'socket.io-client connects out',
      summary: 'A browser client to someone else’s socket server works fine.',
      detail: 'Clients run in the browser, so Airstrip only serves the files. The socket server itself has to run somewhere that keeps connections open.',
      packages: ['socket.io-client'],
      questions: [],
    });
  }

  const jobPkgs = ['node-cron', 'cron', 'node-schedule', 'agenda', 'bull', 'bullmq', 'bee-queue'].filter(has);
  if (jobPkgs.length) {
    add({
      id: 'background-jobs', level: 'warn', title: 'Background jobs need a process',
      brief: `${jobPkgs.join(', ')} need${jobPkgs.length > 1 ? '' : 's'} a long-running process`,
      summary: `${jobPkgs.join(' and ')} expect${jobPkgs.length > 1 ? '' : 's'} a process that keeps running. Functions don’t.`,
      detail: 'In-process schedulers and queue workers stop when the request ends. Use Airstrip cron jobs to call a route on a schedule (2 jobs on Hobby, 40 on Pro), and run queue workers on a separate long-running host.',
      fix: '{ "crons": [{ "path": "/api/cleanup", "schedule": "0 3 * * *" }] }',
      packages: jobPkgs,
      log: { phase: 'Building', level: 'warn', text: `${jobPkgs[0]}: scheduled work won't run between requests (use Airstrip cron)` },
      questions: ['How do Airstrip cron jobs work?', 'Where should my queue worker run?'],
    });
  }

  // --- Data -------------------------------------------------------------------------
  if (has('prisma') || has('@prisma/client')) {
    const generates = /prisma generate/.test(scriptText);
    add({
      id: 'prisma', level: generates ? 'ok' : 'warn',
      brief: generates ? '' : 'no prisma generate in the build, client can be stale',
      title: generates ? 'Prisma client is generated in the build' : 'Add prisma generate to the build',
      summary: generates ? 'Good: a cached install can’t ship a stale client.' : 'Cached installs can skip it, and ship an outdated client.',
      detail: `${generates ? 'Your scripts run prisma generate, so the client always matches your schema.' : 'Airstrip restores node_modules from the build cache, so the postinstall that generates the Prisma client may not run. Run prisma generate in your build.'} Functions scale out, and each opens its own connections: use your database's pooled connection string.`,
      fix: generates ? '' : `"build": "prisma generate && ${scripts.build || framework?.build || 'next build'}"`,
      packages: ['prisma', '@prisma/client'].filter(has),
      log: generates
        ? { phase: 'Building', level: 'muted', text: 'prisma generate: client matches schema.prisma' }
        : { phase: 'Building', level: 'warn', text: '@prisma/client found, but no “prisma generate” in your scripts' },
      questions: ['Why would the client be stale?', 'How many database connections will I need?'],
    });
  }
  if (has('drizzle-orm')) {
    add({
      id: 'drizzle', level: 'info', title: 'Run Drizzle migrations outside requests',
      summary: 'No generate step needed. Migrate from CI or before promoting a deploy.',
      detail: 'Drizzle needs no code generation, so builds stay simple. Run drizzle-kit migrate from CI or a deploy step, never at request time, since many functions start at once.',
      packages: ['drizzle-orm', 'drizzle-kit'].filter(has),
      questions: ['When should migrations run?'],
    });
  }
  const sqlDrivers = ['pg', 'postgres', 'mysql2', 'mysql', 'mongodb', 'mongoose'].filter(has);
  if (sqlDrivers.length) {
    const mongo = sqlDrivers.some((d) => d.startsWith('mongo'));
    add({
      id: 'database', level: 'info', title: mongo ? 'Reuse the Mongo connection' : 'Pool your database connections',
      summary: mongo ? 'Cache it on globalThis so warm functions reuse it.' : 'Every function instance opens connections. Use a pooled URL.',
      detail: mongo
        ? 'Connect once per function instance and keep the connection on globalThis, so warm invocations reuse it instead of reconnecting. MongoDB drivers work in Node functions, not at the edge.'
        : `TCP drivers like ${sqlDrivers.join(', ')} work in Node functions. When traffic spikes, many instances each open connections, so use your provider's pooled connection string. At the edge, use an HTTP-based driver instead.`,
      packages: sqlDrivers,
      questions: mongo ? ['Where do I keep the connection?'] : ['What pool size should I use?', 'Can I query my database from the edge?'],
    });
  }
  if (has('redis') || has('ioredis')) {
    const p = has('ioredis') ? 'ioredis' : 'redis';
    add({
      id: 'redis', level: 'info', title: `${p} works in Node functions`,
      summary: 'Keep one client per instance. The edge needs an HTTP-based Redis client.',
      detail: `${p} connects over TCP, which Node functions support. Create the client once at module scope so warm invocations reuse it.`,
      packages: [p],
      questions: ['Does Airstrip host Redis?'],
    });
  }
  const sqlite = ['better-sqlite3', 'sqlite3'].filter(has);
  if (sqlite.length) {
    add({
      id: 'sqlite', level: 'warn', title: 'SQLite can’t write here',
      brief: 'local SQLite writes don\'t persist (read-only disk)',
      summary: 'Function disks are read-only except /tmp, which resets. Writes won’t stick.',
      detail: 'A local SQLite file is part of the deployment, so it is read-only, and /tmp is wiped between instances. Reading a bundled .db file works. For writes, use a hosted database, or a hosted SQLite service over HTTP.',
      packages: sqlite,
      log: { phase: 'Installing', level: 'warn', text: `${sqlite[0]}@${version(all[sqlite[0]], 3)}: compiling native addon with node-gyp` },
      questions: ['Can I keep SQLite for reads?', 'What should I use instead?'],
    });
  }
  if (has('@libsql/client')) {
    add({
      id: 'libsql', level: 'ok', title: 'libSQL over HTTP runs anywhere',
      summary: 'The HTTP client works in Node functions and at the edge.',
      detail: 'libSQL talks to a hosted database over HTTP, so there is nothing native to build and no local file to write.',
      packages: ['@libsql/client'],
      questions: [],
    });
  }

  // --- Requests, email, auth, env --------------------------------------------------
  const uploads = ['multer', 'formidable', 'busboy', 'express-fileupload'].filter(has);
  if (uploads.length) {
    add({
      id: 'uploads', level: 'info', title: `Uploads over ${PLATFORM.bodyLimitMB} MB need another route`,
      summary: `Function request bodies stop at ${PLATFORM.bodyLimitMB} MB. Upload big files straight to storage.`,
      detail: `${uploads[0]} works for small files. Larger uploads hit the ${PLATFORM.bodyLimitMB} MB request limit, so give the browser a signed URL and let it upload directly to object storage.`,
      packages: uploads,
      questions: ['How do signed uploads work?'],
    });
  }
  if (has('nodemailer')) {
    add({
      id: 'nodemailer', level: 'info', title: 'SMTP on port 25 is blocked',
      summary: 'nodemailer works over 465 or 587, or with an email API.',
      detail: 'Outbound port 25 is blocked from functions to protect deliverability. Use your provider\'s submission port (465 or 587) with authentication, and keep the credentials in environment variables.',
      packages: ['nodemailer'],
      questions: ['Which port should I use?'],
    });
  }
  const auth = ['next-auth', '@auth/core', '@auth/sveltekit', 'better-auth', 'lucia', 'passport', '@auth/express'].filter(has);
  if (auth.length) {
    add({
      id: 'auth', level: 'info', title: 'Previews need your OAuth callbacks',
      summary: 'Set the auth secret per environment and allow preview URLs.',
      detail: `${auth[0]} needs a secret (AUTH_SECRET) in each environment. Every preview deployment has its own URL, so OAuth providers reject sign-ins there unless the callback allows *.airstrip.sh or you use one stable preview domain.`,
      packages: auth,
      log: { phase: 'Assigning domains', level: 'muted', text: 'Preview URL changes per push: allow it in your OAuth callback settings' },
      questions: ['How do I make sign-in work on previews?', 'Where do I set AUTH_SECRET?'],
    });
  }
  if (has('firebase-admin')) {
    add({
      id: 'firebase-admin', level: 'info', title: 'Keep the service account in an env var',
      summary: 'Store the JSON key as a base64 environment variable, not a file.',
      detail: 'Commit no key files. Put the service account JSON in an environment variable (base64-encoded), and decode it when you initialize the admin SDK.',
      packages: ['firebase-admin'],
      questions: [],
    });
  }
  const envPkgs = ['dotenv', 'dotenv-cli', 'env-cmd', '@t3-oss/env-core', '@t3-oss/env-nextjs'].filter(has);
  if (envPkgs.length) {
    add({
      id: 'env-vars', level: 'info', title: '.env files aren’t deployed',
      summary: 'Add each variable in Project → Environment Variables.',
      detail: `${envPkgs[0]} reads .env files locally, and that's fine to keep. On Airstrip, set the same variables per environment (Production, Preview, Development); builds and functions get them as process.env.`,
      packages: envPkgs,
      log: { phase: 'Building', level: 'muted', text: 'No environment variables set for Production (.env files are not deployed)' },
      questions: ['Can previews use different variables?', 'Are my variables encrypted?'],
    });
  }

  // --- Install scripts ------------------------------------------------------------
  if (scripts.postinstall) {
    const safe = SAFE_POSTINSTALL.test(scripts.postinstall.trim());
    add({
      id: 'postinstall', level: safe ? 'ok' : 'warn',
      brief: safe ? '' : 'postinstall downloads on every build',
      title: safe ? 'postinstall is a known step' : 'postinstall runs on every install',
      summary: safe ? `“${truncate(scripts.postinstall, 36)}” is quick and safe in builds.` : `“${truncate(scripts.postinstall, 36)}” runs on each build. Downloads here make builds flaky.`,
      detail: safe
        ? 'This postinstall prepares generated files. It runs during install on Airstrip exactly as it does locally.'
        : 'A postinstall that downloads files or compiles assets runs on every build and counts toward build minutes. If its source is slow or down, the deploy fails. Commit the files, or move the step into your build script so it runs once.',
      log: { phase: 'Installing', level: safe ? 'muted' : 'warn', text: `postinstall: ${truncate(scripts.postinstall, 64)}` },
      questions: safe ? [] : ['Why would a postinstall make builds flaky?', 'Where should this step go instead?'],
    });
  }
  if (/\bhusky\b/.test(scripts.prepare ?? '') || has('husky')) {
    add({
      id: 'husky', level: 'ok', title: 'husky skips itself',
      summary: 'Builds have no .git folder, so git hooks aren’t installed. Nothing to do.',
      detail: 'husky installs git hooks from the prepare script. On Airstrip it finds no .git directory, prints a note and moves on.',
      packages: ['husky'],
      questions: [],
    });
  }

  // --- Dependencies ------------------------------------------------------------------
  const devInProd = Object.keys(deps).filter((d) => DEV_TOOLS.has(d) || d.startsWith('@types/'));
  if (devInProd.length) {
    add({
      id: 'dev-dependencies', level: 'info', title: 'Dev tools in dependencies',
      summary: `${list(devInProd, 3)} belong${devInProd.length > 1 ? '' : 's'} in devDependencies.`,
      detail: 'Functions only bundle what your code imports, so this rarely changes their size. It does slow down installs that skip devDependencies, and makes it harder to see what the app needs at runtime.',
      packages: devInProd,
      questions: ['Does this make my functions bigger?'],
    });
  }
  const gitDeps = Object.entries(all).filter(([, v]) => /^(git\+ssh:|git@|ssh:)/.test(String(v)));
  if (gitDeps.length) {
    add({
      id: 'git-dependency', level: 'warn', title: 'Git dependencies over SSH',
      brief: 'git dependency over SSH, build has no key',
      summary: `${gitDeps[0][0]} installs over SSH, and the build has no SSH key.`,
      detail: 'Build machines can’t use your SSH keys. Point the dependency at an https URL with a token in an environment variable, or publish it to a registry.',
      packages: gitDeps.map(([d]) => d),
      log: { phase: 'Installing', level: 'warn', text: `${gitDeps[0][0]}: fetching over SSH (needs a deploy key)` },
      questions: ['How do I install a private package?'],
    });
  }
  const fileDeps = Object.entries(all).filter(([, v]) => /^(file:|link:)/.test(String(v)));
  if (fileDeps.length) {
    add({
      id: 'file-dependency', level: 'info', title: 'Local path dependencies',
      summary: `${fileDeps[0][0]} points at a folder. It must be inside the project Airstrip clones.`,
      detail: 'Paths like file:../shared work when the folder is in the same repository and inside the root directory you deploy. For shared code across apps, a workspace is easier.',
      packages: fileDeps.map(([d]) => d),
      questions: [],
    });
  }
  const workspaceDeps = Object.values(all).some((v) => String(v).startsWith('workspace:'));

  // --- Monorepos -----------------------------------------------------------------
  if (workspaces.length) {
    add({
      id: 'monorepo', level: isRoot ? 'error' : 'ok',
      brief: isRoot ? 'workspace root with no app, nothing to deploy' : '',
      title: isRoot ? 'This is a monorepo root' : 'Workspaces detected',
      summary: isRoot
        ? `Nothing deploys from the root. Create a project per app in ${workspaces[0]}.`
        : `Workspaces in ${list(workspaces, 2)} install together; this package deploys.`,
      detail: `Airstrip supports npm, yarn, pnpm and bun workspaces. Create one project per app and set its root directory, like apps/web; workspace packages it depends on build first, and apps a commit doesn't touch skip the build.${isRoot ? ' Paste the package.json of one app to see how it deploys.' : ''}`,
      fatal: isRoot ? 'Building' : undefined,
      log: isRoot
        ? { phase: 'Building', level: 'error', text: 'No framework and no output at the repository root: nothing to deploy' }
        : { phase: 'Installing', level: 'muted', text: `Workspaces: ${list(workspaces, 3)}` },
      questions: isRoot ? ['How do I deploy one app from this monorepo?', 'Will every push rebuild every app?'] : ['Do other apps rebuild when this one changes?'],
    });
  } else if (workspaceDeps) {
    add({
      id: 'monorepo', level: 'info', title: 'Part of a monorepo',
      summary: 'workspace: dependencies mean this app lives in a workspace. Deploy it with its root directory.',
      detail: 'Create the Airstrip project for this app and set its root directory. The workspace packages it depends on are installed and built first.',
      questions: ['How do I set the root directory?'],
    });
  }

  // --- Other platforms ----------------------------------------------------------------
  if (has('electron')) {
    add({
      id: 'electron', level: 'warn', title: 'Electron apps aren’t websites',
      brief: 'desktop app, only a web build can deploy',
      summary: 'Only a web build of the renderer can deploy. The desktop app can’t.',
      detail: 'Airstrip hosts web apps. If your renderer also builds for the browser, deploy that build; the Electron shell stays a download.',
      packages: ['electron'],
      questions: [],
    });
  }
  if (framework?.name === 'Expo') {
    add({
      id: 'expo', level: 'info', title: 'Only the web build deploys',
      summary: 'expo export -p web makes a static site. The native apps ship through the app stores.',
      detail: 'Airstrip serves the static web export. Native builds are unaffected.',
      packages: ['expo'],
      questions: [],
    });
  }

  // --- Size of the install ----------------------------------------------------------
  const count = Object.keys(all).length;
  if (count >= 120) {
    add({
      id: 'dependencies', level: count >= 250 ? 'warn' : 'info', title: `${count} dependencies`,
      brief: 'very large install',
      summary: 'A large install. The build cache helps: repeat installs take seconds.',
      detail: 'The first build installs everything; later builds restore node_modules from the cache. Functions only bundle files your code imports, so a big install doesn\'t mean big functions.',
      questions: ['Does the build cache survive between branches?'],
    });
  }

  // --- The outcome ----------------------------------------------------------------------
  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  const fatal = findings.find((f) => f.fatal) ?? null;
  const functions = functionModel({ output, framework, server, has, name });

  return {
    name,
    version: typeof pkg.version === 'string' ? pkg.version : '',
    description: typeof pkg.description === 'string' ? pkg.description.slice(0, 140) : '',
    framework,
    output,
    server: server?.name ?? '',
    pm,
    node,
    scripts,
    deps: Object.keys(deps),
    devDeps: Object.keys(devDeps).filter((d) => !Object.hasOwn(deps, d)),
    count,
    workspaces,
    findings,
    fatal: fatal ? { id: fatal.id, phase: fatal.fatal } : null,
    functions,
    site: framework?.site ?? (isRoot ? 'none' : 'app'),
  };
}

// What the deployment would produce: its functions, roughly, and their sizes.
function functionModel({ output, framework, server, has }) {
  const fns = [];
  const mb = { puppeteer: 212, canvas: 38, sharp: 7, '@prisma/client': 14, 'better-sqlite3': 9, sqlite3: 9, bcrypt: 1, argon2: 1 };
  const extraMB = Object.entries(mb).reduce((sum, [p, size]) => sum + (has(p) ? size : 0), 0);
  const rendersOnServer = (output === 'ssr' || output === 'hybrid') && ['ssr', 'hybrid'].includes(framework?.output);
  if (rendersOnServer) {
    const names = framework.name === 'Next.js' ? ['app', 'api'] : ['render', 'api'];
    for (const n of names) fns.push({ name: n, runtime: 'node' });
    if (framework.name === 'Next.js') fns.push({ name: 'middleware', runtime: 'edge' });
  }
  if (server && !fns.some((f) => f.name === 'api')) fns.push({ name: 'api', runtime: server.fits ? 'edge' : 'node' });
  // Heavy dependencies land in the function that imports them: assume the first Node one.
  const first = fns.find((f) => f.runtime === 'node');
  for (const f of fns) f.sizeMB = f.runtime === 'edge' ? 0.4 : Math.round((5.6 + (f === first ? extraMB : 0)) * 10) / 10;
  return fns;
}

// --- Small readers -----------------------------------------------------------------------

function packageManager(value) {
  const m = typeof value === 'string' ? value.match(/^(npm|pnpm|yarn|bun)@(\d+)(?:\.(\d+))?/) : null;
  const name = m ? m[1] : 'npm';
  const major = m ? Number(m[2]) : 10;
  const label = m ? `${name} ${m[2]}${m[3] !== undefined ? `.${m[3]}` : ''}` : 'npm 10';
  const verbs = {
    npm: { run: 'npm run', install: 'npm ci', add: 'npm install', remove: 'npm uninstall' },
    pnpm: { run: 'pnpm run', install: 'pnpm install --frozen-lockfile', add: 'pnpm add', remove: 'pnpm remove' },
    yarn: { run: 'yarn run', install: major > 1 ? 'yarn install --immutable' : 'yarn install --frozen-lockfile', add: 'yarn add', remove: 'yarn remove' },
    bun: { run: 'bun run', install: 'bun install --frozen-lockfile', add: 'bun add', remove: 'bun remove' },
  }[name];
  return { name, major, label, source: m ? 'packageManager' : 'default', ...verbs };
}

/**
 * Reads engines.node well enough for this: which supported majors it allows.
 * Handles x-ranges, ^, ~, comparators, hyphen ranges and ||.
 */
export function nodeVersion(value) {
  if (typeof value !== 'string' || !value.trim()) return { status: 'missing', major: PLATFORM.node.fallback, range: '' };
  const range = value.trim();
  const sets = parseRange(range);
  if (!sets) return { status: 'unknown', major: PLATFORM.node.fallback, range };
  const satisfies = (v) => sets.some((set) => set.every((c) => compare(v, c)));
  const allows = (major) => {
    for (let minor = 0; minor <= 40; minor++) {
      if (satisfies([major, minor, 0]) || satisfies([major, minor, 99])) return true;
    }
    return false;
  };
  const supported = [...PLATFORM.node.versions, PLATFORM.node.beta].find(allows);
  const allowed = [10, 12, 14, 16, 18, 20].filter(allows);
  if (!supported) return { status: 'unsupported', major: 0, range, allowed };
  const openEnded = satisfies([40, 0, 0]);
  // "~24.1" or "24.1.0": builds still get the latest 24.x.
  const minorPinned = !satisfies([supported, 40, 0]) && !satisfies([supported, 40, 99]);
  return { status: 'ok', major: supported, range, allowed, openEnded, minorPinned };
}

function parseRange(range) {
  const sets = [];
  for (const part of range.split('||')) {
    const text = part.trim().replace(/([<>=~^]+)\s+/g, '$1');
    if (!text || text === '*' || /^x$/i.test(text)) {
      sets.push([]);
      continue;
    }
    const hyphen = text.match(/^(\S+)\s+-\s+(\S+)$/);
    if (hyphen) {
      const lo = partial(hyphen[1]);
      const hi = partial(hyphen[2]);
      if (!lo || !hi) return null;
      sets.push([{ op: '>=', v: fill(lo) }, upperOf(hi)]);
      continue;
    }
    const comps = [];
    for (const token of text.split(/\s+/)) {
      const m = token.match(/^(>=|<=|>|<|=|\^|~)?v?(.+)$/);
      const v = m && partial(m[2]);
      if (!v) return null;
      const op = m[1] ?? '';
      if (op === '^') {
        comps.push({ op: '>=', v: fill(v) }, { op: '<', v: [v[0] + 1, 0, 0] });
      } else if (op === '~') {
        comps.push({ op: '>=', v: fill(v) }, { op: '<', v: v[1] === undefined ? [v[0] + 1, 0, 0] : [v[0], v[1] + 1, 0] });
      } else if (op === '' || op === '=') {
        if (v.length === 3) comps.push({ op: '=', v });
        else comps.push({ op: '>=', v: fill(v) }, upperOf(v));
      } else if (op === '>') {
        // ">18" means 19 and up; ">18.2" means 18.3 and up.
        comps.push(v.length === 3 ? { op, v } : { op: '>=', v: v.length === 1 ? [v[0] + 1, 0, 0] : [v[0], v[1] + 1, 0] });
      } else if (op === '<=') {
        // "<=20" includes every 20.x.
        comps.push(v.length === 3 ? { op, v } : upperOf(v));
      } else {
        comps.push({ op, v: fill(v) });
      }
    }
    sets.push(comps);
  }
  return sets;
}

// "18" → [18], "18.2" → [18, 2], "18.x" → [18], "18.2.1" → [18, 2, 1]
function partial(text) {
  const parts = text.replace(/^v/, '').split('.');
  const out = [];
  for (const p of parts.slice(0, 3)) {
    if (/^(x|X|\*)$/.test(p)) break;
    if (!/^\d+/.test(p)) return null;
    out.push(parseInt(p, 10));
  }
  return out.length ? out : null;
}
const fill = (v) => [v[0], v[1] ?? 0, v[2] ?? 0];
const upperOf = (v) => (v.length >= 3 ? { op: '<=', v } : v.length === 2 ? { op: '<', v: [v[0], v[1] + 1, 0] } : { op: '<', v: [v[0] + 1, 0, 0] });

function compare(version, { op, v }) {
  const d = version[0] - v[0] || version[1] - v[1] || version[2] - v[2];
  return op === '>=' ? d >= 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : op === '<' ? d < 0 : d === 0;
}

/** "^2.15.1" → "2.15" (or "2.15.1" with parts = 3). Empty for tags and URLs. */
export function version(range, parts = 2) {
  const m = String(range ?? '').match(/(\d+)\.(\d+)(?:\.(\d+))?(-[\w.]+)?/) ?? String(range ?? '').match(/(\d+)()()()/);
  if (!m) return '';
  const nums = [m[1], m[2], m[3]].filter((x) => x !== undefined && x !== '').slice(0, parts);
  const pre = m[4] ? ` ${m[4].slice(1).split('.')[0]}` : '';
  return nums.join('.') + pre;
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => k && typeof v === 'string'));
}

function safeName(value) {
  const n = typeof value === 'string' ? value.trim() : '';
  return (n.replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'my-app').slice(0, 40);
}

function truncate(text, n) {
  const t = String(text).trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function list(items, n) {
  const shown = items.slice(0, n).join(', ');
  return items.length > n ? `${shown} +${items.length - n}` : shown;
}
