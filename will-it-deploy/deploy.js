// The simulated deployment: turns an analysis into a build log with timing,
// phases and the numbers on the deployment card. Nothing here runs a build.
// It's deterministic: the same package.json and region always give the same
// log, so after a reload the chat's log-line threads find their lines again.

import { PLATFORM } from './analyze.js';

export const PHASES = ['Cloning', 'Installing', 'Building', 'Deploying', 'Assigning domains'];

// Edge regions, by airport code. lon/lat place them on the network map.
export const REGIONS = [
  { code: 'sfo', city: 'San Francisco', lon: -122.4, lat: 37.8 },
  { code: 'ord', city: 'Chicago', lon: -87.6, lat: 41.9 },
  { code: 'yul', city: 'Montréal', lon: -73.6, lat: 45.5 },
  { code: 'iad', city: 'Washington, D.C.', lon: -77.4, lat: 38.9 },
  { code: 'gru', city: 'São Paulo', lon: -46.6, lat: -23.5 },
  { code: 'dub', city: 'Dublin', lon: -6.3, lat: 53.3 },
  { code: 'lhr', city: 'London', lon: -0.5, lat: 51.5 },
  { code: 'cdg', city: 'Paris', lon: 2.4, lat: 48.9 },
  { code: 'fra', city: 'Frankfurt', lon: 8.7, lat: 50.1 },
  { code: 'arn', city: 'Stockholm', lon: 18.1, lat: 59.3 },
  { code: 'cpt', city: 'Cape Town', lon: 18.4, lat: -33.9 },
  { code: 'dxb', city: 'Dubai', lon: 55.3, lat: 25.2 },
  { code: 'bom', city: 'Mumbai', lon: 72.9, lat: 19.1 },
  { code: 'sin', city: 'Singapore', lon: 103.8, lat: 1.4 },
  { code: 'hkg', city: 'Hong Kong', lon: 114.2, lat: 22.3 },
  { code: 'icn', city: 'Seoul', lon: 127.0, lat: 37.6 },
  { code: 'hnd', city: 'Tokyo', lon: 139.7, lat: 35.7 },
  { code: 'syd', city: 'Sydney', lon: 151.2, lat: -33.9 },
];

/** The region closest to the visitor, from their time zone. Functions run there. */
export function regionFor(timeZone = '') {
  const tz = String(timeZone);
  const rules = [
    [/^Europe\/(Helsinki|Stockholm|Oslo|Copenhagen|Tallinn|Riga|Vilnius)/, 'arn'],
    [/^Europe\/(London|Dublin|Lisbon)|^Atlantic\//, tz.includes('Dublin') ? 'dub' : 'lhr'],
    [/^Europe\/(Paris|Madrid|Brussels|Luxembourg|Monaco)/, 'cdg'],
    [/^(Europe|Africa\/(Cairo|Tunis|Algiers|Casablanca))\//, 'fra'],
    [/^Africa\//, 'cpt'],
    [/^Asia\/(Dubai|Riyadh|Qatar|Bahrain|Kuwait|Muscat|Tehran|Baghdad)/, 'dxb'],
    [/^Asia\/(Kolkata|Calcutta|Colombo|Karachi|Dhaka|Kathmandu)/, 'bom'],
    [/^Asia\/(Tokyo)/, 'hnd'],
    [/^Asia\/(Seoul|Pyongyang)/, 'icn'],
    [/^Asia\/(Hong_Kong|Shanghai|Taipei|Macau|Manila)/, 'hkg'],
    [/^(Asia|Indian)\//, 'sin'],
    [/^(Australia|Pacific\/(Auckland|Fiji))/, 'syd'],
    [/^America\/(Los_Angeles|Vancouver|Tijuana|Denver|Phoenix|Boise|Edmonton|Anchorage)|^Pacific\/Honolulu/, 'sfo'],
    [/^America\/(Chicago|Winnipeg|Mexico_City|Monterrey|Regina|Indiana\/Knox)/, 'ord'],
    [/^America\/(Toronto|Montreal|Halifax|St_Johns)/, 'yul'],
    [/^America\/(Sao_Paulo|Argentina|Santiago|Montevideo|Bogota|Lima|Caracas|Asuncion|La_Paz)/, 'gru'],
  ];
  const code = rules.find(([re]) => re.test(tz))?.[1] ?? 'iad';
  return REGIONS.find((r) => r.code === code);
}

/**
 * Plays the deployment through, as data. Returns the log lines (each with its
 * phase, simulated time in ms and level), the phases, and the card's numbers.
 */
export function simulate(a, { region = regionFor(), key = a.name } = {}) {
  const random = mulberry32(hash(key));
  const between = (lo, hi) => lo + (hi - lo) * random();
  const int = (lo, hi) => Math.round(between(lo, hi));
  const id = hash(`${key}#id`).toString(36).slice(-4).padStart(4, '7');
  const commit = hash(`${key}#commit`).toString(16).padStart(8, '0').slice(0, 7);

  const lines = [];
  let t = 0;
  const log = (phase, dt, text, level = 'info', finding = '') => {
    t += Math.round(dt);
    lines.push({ n: lines.length + 1, phase, t, text, level, finding });
  };
  const byId = new Map(a.findings.map((f) => [f.id, f]));
  const fromFinding = (phase, fid, dt = 30) => {
    const f = byId.get(fid);
    if (f?.log?.phase === phase) log(phase, dt, f.log.text, f.log.level, f.id);
    return f;
  };
  const phases = PHASES.map((name) => ({ name, start: 0, end: 0, status: 'pending' }));
  const phase = (name) => phases.find((p) => p.name === name);
  let failed = null;
  const fail = (name, text) => {
    log(name, 60, text, 'error');
    failed = name;
  };

  // Numbers that make the log feel like this project's.
  const packages = a.count ? Math.round(a.count * between(10, 15)) + int(30, 80) : 0;
  const staticModel = routesFor(a, int);
  const modules = a.framework && a.output !== 'api' ? Math.round(400 + a.count * between(36, 52)) : 0;
  const staticFiles = staticModel.files;
  const staticMB = Math.round(staticFiles * between(0.018, 0.034) * 10) / 10;
  const buildBase = { 'Next.js': 21000, Nuxt: 17000, SvelteKit: 9000, Astro: 6500, 'React Router': 8000, Remix: 8000, Angular: 24000, Gatsby: 28000, Vite: 4200 }[a.framework?.name] ?? (a.framework ? 6000 : 400);

  // --- Cloning ----------------------------------------------------------------
  phase('Cloning').start = t;
  log('Cloning', 0, `Build machine: 4 vCPU, 8 GB · ${region.code.toUpperCase()} (${region.city})`, 'muted');
  log('Cloning', 40, `Cloning ${a.name} · branch main · ${commit}`);
  log('Cloning', between(260, 560), `Cloned in ${int(240, 520)} ms`, 'muted');
  phase('Cloning').end = t;

  // --- Installing ---------------------------------------------------------------
  const installing = phase('Installing');
  installing.start = t;
  log('Installing', between(80, 140), 'Restoring build cache: none yet (first deployment)', 'muted');
  if (fromFinding('Installing', 'invalid-json', 20)) fail('Installing', 'Build failed: npm couldn’t read package.json');
  if (!failed) {
    const nodeFinding = fromFinding('Installing', 'node-version', 14);
    if (nodeFinding?.fatal) fail('Installing', 'Build failed: no supported Node.js version');
  }
  if (!failed) {
    fromFinding('Installing', 'package-manager', 10);
    log('Installing', 24, `$ ${a.pm.install}`, 'cmd');
    fromFinding('Installing', 'monorepo', 40);
    fromFinding('Installing', 'git-dependency', 300);
    let installMs = 1800 + a.count * between(130, 190);
    const costs = { bcrypt: 4800, argon2: 3900, canvas: 11800, sqlite: 5200, 'node-sass': 6400, puppeteer: 8200, sharp: 600 };
    for (const fid of ['bcrypt', 'argon2', 'canvas', 'sqlite', 'node-sass', 'sharp', 'puppeteer']) {
      const f = fromFinding('Installing', fid, between(300, 1200));
      if (!f?.log) continue;
      if (fid === 'node-sass') {
        fail('Installing', 'node-gyp exited with code 1: install failed');
        break;
      }
      const cost = costs[fid] ?? 0;
      installMs += cost;
      t += Math.round(cost * 0.8);
      if (['bcrypt', 'argon2', 'canvas', 'sqlite'].includes(fid)) {
        const pkgName = fid === 'sqlite' ? f.packages[0] : fid;
        log('Installing', cost * 0.2, `${pkgName}: native addon built in ${(cost / 1000).toFixed(1)}s`, 'muted', fid);
      }
    }
    if (!failed) {
      const post = fromFinding('Installing', 'postinstall', 200);
      if (post) {
        const cost = post.level === 'ok' ? 900 : 2600;
        installMs += cost;
        t += cost;
      }
      const rest = Math.max(600, installMs - (t - installing.start));
      log('Installing', rest, `Installed ${packages.toLocaleString('en-US')} packages in ${(installMs / 1000).toFixed(1)}s`, 'success');
    }
  }
  installing.end = t;

  // --- Building -------------------------------------------------------------------
  const building = phase('Building');
  if (!failed) {
    building.start = t;
    const script = a.scripts.build;
    if (script) {
      log('Building', 40, `$ ${a.pm.run} build`, 'cmd');
      log('Building', 8, `> ${script}`, 'muted');
    } else if (a.framework?.build) {
      log('Building', 40, `$ ${a.framework.build}`, 'cmd');
    } else {
      log('Building', 40, 'No build step: deploying your source as it is', 'muted');
    }
    fromFinding('Building', 'framework', between(260, 480));
    fromFinding('Building', 'adapter', 40);
    const prisma = fromFinding('Building', 'prisma', 120);
    if (prisma?.level === 'ok') t += 1600;
    if (fromFinding('Building', 'monorepo', 900)) fail('Building', 'Build failed: set the root directory to one of your apps');
    if (!failed) {
      if (modules) log('Building', buildBase * between(0.45, 0.6), `Transformed ${modules.toLocaleString('en-US')} modules`, 'muted');
      for (const fid of ['server', 'websockets', 'background-jobs', 'env-vars']) fromFinding('Building', fid, between(90, 220));
      if (staticModel.prerendered) log('Building', buildBase * between(0.25, 0.35), `Prerendered ${staticModel.prerendered} ${plural(staticModel.prerendered, 'page')}`, 'muted');
      for (const fn of a.functions) {
        log('Building', between(80, 260), `Traced function ${fn.name} · ${fn.runtime === 'edge' ? 'edge' : 'Node'} · ${fn.sizeMB} MB`, 'muted');
      }
      const buildMs = t - building.start;
      log('Building', between(120, 260), `Build completed in ${seconds(buildMs + 200)}`, 'success');
    }
    building.end = t;
  }

  // --- Deploying ----------------------------------------------------------------------
  const deploying = phase('Deploying');
  if (!failed) {
    deploying.start = t;
    if (staticFiles) log('Deploying', 300 + staticFiles * 5, `Uploaded ${staticFiles} static files (${staticMB} MB) to ${PLATFORM.regions} regions`);
    for (const fn of a.functions) {
      if (fn.runtime === 'edge') {
        log('Deploying', between(240, 420), `Created edge function ${fn.name} in ${PLATFORM.regions} regions (${fn.sizeMB} MB)`);
      } else if (fn.sizeMB > PLATFORM.functionLimitMB) {
        const f = byId.get('puppeteer');
        log('Deploying', between(500, 900), `Function ${fn.name} is ${fn.sizeMB} MB, over the ${PLATFORM.functionLimitMB} MB limit`, 'error', f?.id ?? '');
        fail('Deploying', 'Deployment failed: a function is too large');
        break;
      } else {
        log('Deploying', between(420, 820), `Created Node function ${fn.name} in ${region.code.toUpperCase()} · 1 GB · ${fn.sizeMB} MB`);
      }
    }
    if (!failed) {
      fromFinding('Deploying', 'spa-fallback', 30);
      log('Deploying', between(160, 320), 'Deployment is live on its own URL', 'success');
    }
    deploying.end = t;
  }

  // --- Assigning domains --------------------------------------------------------------
  const assigning = phase('Assigning domains');
  const url = `${a.name}-${id}.airstrip.sh`;
  const domains = [`${a.name}.airstrip.sh`, `${a.name}-git-main.airstrip.sh`];
  if (!failed) {
    assigning.start = t;
    log('Assigning domains', between(90, 160), `Assigned ${url}`);
    fromFinding('Assigning domains', 'auth', 20);
    log('Assigning domains', between(280, 520), `Assigned ${domains[0]} (production)`);
    log('Assigning domains', 40, `Ready in ${seconds(t + 40)}`, 'success');
    assigning.end = t;
  }

  // Phase status: ok, warn (it logged warnings), error, or skipped after a failure.
  let reached = true;
  for (const p of phases) {
    const own = lines.filter((l) => l.phase === p.name);
    if (!reached || !own.length) {
      p.status = 'skipped';
      continue;
    }
    p.lines = own.length;
    p.warnings = own.filter((l) => l.level === 'warn').length;
    p.status = own.some((l) => l.level === 'error') ? 'error' : p.warnings ? 'warn' : 'ok';
    if (p.name === failed) reached = false;
  }

  return {
    id,
    commit,
    url,
    domains,
    region,
    lines,
    phases,
    outcome: failed ? 'error' : 'ready',
    failedPhase: failed,
    durationMs: t,
    routes: staticModel,
    staticFiles,
    staticMB,
    packages,
  };
}

// Pages and routes by kind of output. Only for the card and the log.
function routesFor(a, int) {
  const nodeFns = a.functions.filter((f) => f.runtime === 'node').length;
  const edgeFns = a.functions.filter((f) => f.runtime === 'edge').length;
  switch (a.output) {
    case 'static': {
      const pages = a.site === 'blog' ? int(18, 46) : a.site === 'docs' ? int(24, 60) : int(6, 18);
      return { static: pages, node: 0, edge: 0, prerendered: pages, files: pages * 3 + int(30, 70) };
    }
    case 'ssr': {
      const pre = int(4, 11);
      return { static: pre, node: int(3, 8), edge: 0, prerendered: pre, files: int(60, 150) };
    }
    case 'hybrid': {
      if (a.framework?.output === 'spa') return { static: 1, node: int(6, 12), edge: 0, prerendered: 0, files: int(18, 48) };
      const pre = int(6, 14);
      return { static: pre, node: int(4, 9), edge: edgeFns, prerendered: pre, files: int(90, 190) };
    }
    case 'spa':
      return { static: 1, node: 0, edge: 0, prerendered: 0, files: int(16, 44) };
    case 'api':
      return { static: 0, node: nodeFns ? int(6, 14) : 0, edge: edgeFns ? int(4, 10) : 0, prerendered: 0, files: 0 };
    default:
      return { static: 0, node: 0, edge: 0, prerendered: 0, files: 0 };
  }
}

export function seconds(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function plural(n, word) {
  return n === 1 ? word : `${word}s`;
}

// Small, stable hash and PRNG: the same input always gives the same deployment.
export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
