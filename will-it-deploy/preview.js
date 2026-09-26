// The deployment card's thumbnail: a small drawing of "your site", made from
// the package.json's name and description, in a layout that suits the kind of
// app (a shop, a dashboard, a blog, an API…). An SVG, so it scales crisply.

import { hash } from './deploy.js';

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const FONT = "font-family=\"Geist, ui-sans-serif, system-ui, sans-serif\"";
const MONO = "font-family=\"'Geist Mono', ui-monospace, monospace\"";

/** Colors for a project: its own hue, picked from its name. */
export function palette(name) {
  const h = hash(`${name}#hue`) % 360;
  return {
    hue: h,
    accent: `hsl(${h} 68% 50%)`,
    deep: `hsl(${h} 55% 26%)`,
    soft: `hsl(${h} 70% 95%)`,
    mid: `hsl(${h} 55% 84%)`,
    alt: `hsl(${(h + 40) % 360} 70% 62%)`,
  };
}

export function title(name) {
  const words = String(name).replace(/-(app|web|site|api|store|shop)$/, '').split(/[-_.]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'My app';
}

/** The thumbnail's HTML for a state: building, ready or error. */
export function previewMarkup(a, d, state) {
  if (state === 'building') {
    return `<div class="pv pv-skeleton"><div class="bars"><i></i><i></i><i></i></div><span>Building…</span></div>`;
  }
  if (state === 'error') {
    const reason = d.failedPhase === 'Deploying' ? 'A function is over the size limit' : d.failedPhase === 'Building' ? 'Nothing to deploy from here' : 'The install stopped';
    return `<div class="pv pv-error" role="img" aria-label="No preview: the deployment failed"><div><svg class="i" style="width:20px;height:20px"><use href="#i-error"/></svg><span style="display:block;margin-top:4px">No preview</span><small>${esc(reason)}</small></div></div>`;
  }
  const kind = a.site === 'store' || /shop|store|market/.test(a.name) ? 'store' : a.site;
  const draw = { store, dashboard, blog, api, docs }[kind] ?? app;
  const p = palette(a.name);
  const svg = draw({ a, d, p, name: title(a.name), text: a.description || 'Built and served by Airstrip.' });
  return `<div class="pv" role="img" aria-label="Preview of ${esc(title(a.name))}">${svg}</div>`;
}

// Words wrapped to lines of about n characters.
function wrap(text, n, max = 2) {
  const words = String(text).split(/\s+/);
  const lines = [''];
  for (const w of words) {
    if ((lines.at(-1) + ' ' + w).trim().length > n && lines.at(-1)) {
      if (lines.length === max) {
        lines[max - 1] = `${lines[max - 1].replace(/[.,;:]?$/, '')}…`;
        return lines;
      }
      lines.push(w);
    } else {
      lines[lines.length - 1] = `${lines.at(-1)} ${w}`.trim();
    }
  }
  return lines;
}

const frame = (inner, bg = '#FFFFFF') => `<svg viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="400" fill="${bg}"/>${inner}</svg>`;
const bar = (x, y, w, h = 10, fill = '#E6E6E6', r = 5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const nav = (name, p, dark = false) => `
  <circle cx="40" cy="34" r="9" fill="${p.accent}"/>
  <text x="58" y="40" ${FONT} font-size="17" font-weight="600" letter-spacing="-0.6" fill="${dark ? '#FFF' : '#171717'}">${esc(name)}</text>
  ${bar(372, 29, 44, 10, dark ? '#3A3A3A' : '#E4E4E4')}${bar(430, 29, 52, 10, dark ? '#3A3A3A' : '#E4E4E4')}${bar(496, 29, 40, 10, dark ? '#3A3A3A' : '#E4E4E4')}
  <rect x="556" y="20" width="60" height="28" rx="14" fill="${dark ? '#FFF' : '#171717'}"/>`;

function store({ name, text, p }) {
  const lines = wrap(text, 22);
  const products = [0, 1, 2, 3].map((i) => {
    const x = 32 + i * 148;
    const h = (p.hue + i * 28) % 360;
    return `<rect x="${x}" y="268" width="132" height="92" rx="10" fill="hsl(${h} 60% 92%)"/>
      <ellipse cx="${x + 66}" cy="${318 + (i % 2) * 4}" rx="${18 + (i % 3) * 5}" ry="${26 - (i % 2) * 6}" fill="hsl(${h} 45% ${58 + i * 4}%)"/>
      <rect x="${x + 56}" y="${288 + (i % 2) * 4}" width="20" height="8" rx="3" fill="hsl(${h} 45% ${48 + i * 4}%)"/>
      ${bar(x, 370, 80, 8, '#DADADA', 4)}${bar(x + 96, 370, 36, 8, '#171717', 4)}`;
  }).join('');
  return frame(`${nav(name, p)}
    <text ${FONT} font-size="30" font-weight="600" letter-spacing="-1.4" fill="#171717">${lines.map((l, i) => `<tspan x="32" y="${108 + i * 36}">${esc(l)}</tspan>`).join('')}</text>
    ${bar(32, 108 + lines.length * 36 - 6, 220, 9, '#D9D9D9')}
    <rect x="32" y="${136 + lines.length * 36 - 14}" width="104" height="32" rx="16" fill="#171717"/>
    <rect x="388" y="72" width="228" height="176" rx="14" fill="${p.soft}"/>
    <circle cx="502" cy="168" r="60" fill="${p.mid}"/>
    <ellipse cx="502" cy="176" rx="30" ry="46" fill="${p.accent}"/>
    <rect x="488" y="116" width="28" height="12" rx="4" fill="${p.deep}"/>
    ${products}`);
}

function dashboard({ name, p }) {
  const points = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [216 + i * 46, 250 - [20, 38, 30, 62, 54, 80, 72, 104, 118][i]]);
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
  const stat = (x, label, value) => `<rect x="${x}" y="84" width="128" height="72" rx="10" fill="#FFF" stroke="#EAEAEA"/>
    ${bar(x + 14, 100, 56, 7, '#DDD', 3)}<text x="${x + 14}" y="140" ${FONT} font-size="20" font-weight="600" letter-spacing="-0.8" fill="#171717">${value}</text>`;
  return frame(`<rect width="168" height="400" fill="#111"/>
    <circle cx="34" cy="34" r="9" fill="${p.accent}"/>
    <text x="52" y="40" ${FONT} font-size="15" font-weight="600" letter-spacing="-0.5" fill="#FFF">${esc(name)}</text>
    ${[0, 1, 2, 3, 4].map((i) => bar(24, 84 + i * 30, [92, 70, 84, 64, 76][i], 9, i === 0 ? '#FFF' : '#3A3A3A', 4)).join('')}
    <rect x="168" width="472" height="400" fill="#FAFAFA"/>
    ${bar(196, 36, 140, 12, '#171717', 6)}
    ${stat(196, 'Invoiced', '$12,480')}${stat(338, 'Clients', '38')}${stat(480, 'Paid', '94%')}
    <rect x="196" y="172" width="412" height="110" rx="10" fill="#FFF" stroke="#EAEAEA"/>
    <path d="${path}L584 262L216 262Z" fill="${p.soft}"/>
    <path d="${path}" fill="none" stroke="${p.accent}" stroke-width="3" stroke-linejoin="round"/>
    ${[0, 1, 2].map((i) => `<rect x="196" y="${298 + i * 32}" width="412" height="26" rx="6" fill="#FFF" stroke="#EFEFEF"/>${bar(210, 306 + i * 32, 120, 9, '#DDD')}${bar(540, 306 + i * 32, 52, 9, i === 1 ? p.mid : '#E8E8E8')}`).join('')}`, '#FAFAFA');
}

function blog({ name, text, p }) {
  const lines = wrap(text, 30);
  const posts = [0, 1, 2].map((i) => `<text x="120" y="${250 + i * 44}" ${MONO} font-size="11" fill="#8F8F8F">${['Mar 14', 'Feb 27', 'Feb 02'][i]}</text>
    ${bar(200, 240 + i * 44, [230, 196, 250][i], 11, '#171717')}${bar(200, 258 + i * 44, [160, 190, 120][i], 7, '#D6D6D6')}`).join('');
  return frame(`<text x="120" y="52" ${FONT} font-size="16" font-weight="600" letter-spacing="-0.5" fill="#171717">${esc(name)}</text>
    ${bar(440, 42, 34, 9, '#E0E0E0')}${bar(486, 42, 34, 9, '#E0E0E0')}
    <rect x="120" y="82" width="54" height="6" rx="3" fill="${p.accent}"/>
    <text ${FONT} font-size="30" font-weight="600" letter-spacing="-1.3" fill="#171717">${lines.map((l, i) => `<tspan x="120" y="${128 + i * 36}">${esc(l)}</tspan>`).join('')}</text>
    ${bar(120, 144 + lines.length * 36 - 20, 300, 9, '#DDD')}
    ${posts}`, '#FFFDF8');
}

function api({ a, d }) {
  const rows = [
    ['GET', '/health', '200', '38 ms'],
    ['POST', '/v1/dispatch', '201', '112 ms'],
    ['GET', '/v1/drivers', '200', '64 ms'],
  ];
  return frame(`<text x="32" y="46" ${MONO} font-size="13" fill="#8F8F8F">${esc(d.url)}</text>
    <text ${MONO} font-size="15" fill="#EDEDED">
      <tspan x="32" y="96" fill="#45D483">{</tspan>
      <tspan x="52" y="124"><tspan fill="#7CB7FF">"ok"</tspan>: <tspan fill="#FFB224">true</tspan>,</tspan>
      <tspan x="52" y="152"><tspan fill="#7CB7FF">"service"</tspan>: "${esc(a.name)}",</tspan>
      <tspan x="52" y="180"><tspan fill="#7CB7FF">"version"</tspan>: "${esc(a.version || '1.0.0')}",</tspan>
      <tspan x="52" y="208"><tspan fill="#7CB7FF">"region"</tspan>: "${esc(d.region.code)}"</tspan>
      <tspan x="32" y="236" fill="#45D483">}</tspan>
    </text>
    ${rows.map(([m, path, code, ms], i) => `<rect x="32" y="${270 + i * 36}" width="576" height="28" rx="6" fill="#161616"/>
      <text x="46" y="${289 + i * 36}" ${MONO} font-size="12.5" fill="#A1A1A1">${m}</text>
      <text x="104" y="${289 + i * 36}" ${MONO} font-size="12.5" fill="#EDEDED">${path}</text>
      <text x="470" y="${289 + i * 36}" ${MONO} font-size="12.5" fill="#45D483">${code}</text>
      <text x="530" y="${289 + i * 36}" ${MONO} font-size="12.5" fill="#868686">${ms}</text>`).join('')}`, '#0A0A0A');
}

function docs({ name, p }) {
  return frame(`<rect width="170" height="400" fill="#FAFAFA"/>
    <circle cx="34" cy="34" r="8" fill="${p.accent}"/>
    <text x="50" y="39" ${FONT} font-size="14" font-weight="600" fill="#171717">${esc(name)}</text>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => bar(24, 76 + i * 26, [70, 96, 84, 60, 90, 72, 80][i], 8, i === 2 ? p.accent : '#DDD', 4)).join('')}
    ${bar(206, 44, 220, 16, '#171717', 8)}${bar(206, 76, 360, 9, '#DDD')}${bar(206, 94, 320, 9, '#DDD')}
    <rect x="206" y="122" width="400" height="96" rx="8" fill="#0A0A0A"/>
    ${[0, 1, 2].map((i) => bar(222, 140 + i * 22, [180, 240, 150][i], 8, i === 1 ? p.alt : '#555', 4)).join('')}
    ${bar(206, 240, 180, 13, '#171717', 6)}${bar(206, 266, 380, 9, '#DDD')}${bar(206, 284, 350, 9, '#DDD')}${bar(206, 302, 290, 9, '#DDD')}`);
}

function app({ name, text, p }) {
  const lines = wrap(text, 24);
  const days = Array.from({ length: 21 }, (_, i) => {
    const x = 380 + (i % 7) * 34;
    const y = 128 + Math.floor(i / 7) * 34;
    const on = [3, 4, 10, 11, 12, 17].includes(i);
    return `<rect x="${x}" y="${y}" width="28" height="28" rx="7" fill="${on ? p.accent : '#F0F0F0'}"/>`;
  }).join('');
  return frame(`${nav(name, p)}
    <text ${FONT} font-size="30" font-weight="600" letter-spacing="-1.3" fill="#171717">${lines.map((l, i) => `<tspan x="32" y="${124 + i * 36}">${esc(l)}</tspan>`).join('')}</text>
    ${bar(32, 124 + lines.length * 36 - 8, 250, 9, '#DDD')}${bar(32, 142 + lines.length * 36 - 8, 190, 9, '#DDD')}
    <rect x="32" y="${170 + lines.length * 36 - 8}" width="116" height="34" rx="17" fill="#171717"/>
    <rect x="364" y="86" width="252" height="166" rx="14" fill="#FFF" stroke="#EAEAEA"/>
    ${bar(380, 102, 90, 10, '#171717')}
    ${days}
    ${[0, 1, 2].map((i) => `<rect x="${32 + i * 196}" y="292" width="184" height="76" rx="12" fill="${i === 1 ? p.soft : '#F6F6F6'}"/>${bar(48 + i * 196, 310, 70, 9, i === 1 ? p.accent : '#CFCFCF')}${bar(48 + i * 196, 330, 130, 8, '#DDD')}${bar(48 + i * 196, 346, 100, 8, '#DDD')}`).join('')}`);
}
