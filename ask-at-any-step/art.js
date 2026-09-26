// Everything drawn by script on this page: icons, flags, product art and the
// dot map. Plain SVG strings, all original. Only constants and numbers go
// into them, never visitor text.

const circle = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

// 20 × 20 line icons, drawn with a 1.5 stroke.
const ICONS = {
  box: 'M10 2.8 16.7 6.2v7.6L10 17.2 3.3 13.8V6.2z M3.5 6.3 10 9.6l6.5-3.3 M10 9.6v7.4 M6.7 4.5l6.6 3.4',
  download: 'M10 3.5v8.5 M6.5 8.5 10 12l3.5-3.5 M4 13.5v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1',
  calendar: 'M5 4.5h10A1.5 1.5 0 0 1 16.5 6v8.5A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5z M3.5 8h13 M7 3v3 M13 3v3 M7 11h.01 M10 11h.01 M13 11h.01 M7 13.5h.01 M10 13.5h.01',
  repeat: 'M4.5 9A5.5 5.5 0 0 1 14 5.6l1.5 1.4 M15.5 3.5V7H12 M15.5 11A5.5 5.5 0 0 1 6 14.4L4.5 13 M4.5 16.5V13H8',
  ruler: 'M3.6 12.6 12.6 3.6a1 1 0 0 1 1.4 0l2.4 2.4a1 1 0 0 1 0 1.4l-9 9a1 1 0 0 1-1.4 0L3.6 14a1 1 0 0 1 0-1.4z M6.2 10l1.6 1.6 M8.2 8l1.1 1.1 M10.2 6l1.6 1.6',
  heart: 'M10 16.2S3.5 12.4 3.5 7.6A3.3 3.3 0 0 1 10 6.1a3.3 3.3 0 0 1 6.5 1.5c0 4.8-6.5 8.6-6.5 8.6z',
  grid: 'M4.5 3.5h3.5a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z M12 3.5h3.5a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z M4.5 11h3.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z M12 11h3.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z',
  store: 'M4.5 9.2V16h11V9.2 M3.2 4h13.6l1 3.3a2.2 2.2 0 0 1-4.2 1.3 2.2 2.2 0 0 1-4.1 0 2.2 2.2 0 0 1-4.1 0 2.2 2.2 0 0 1-4.2-1.3z M8.5 16v-3.5h3V16',
  tent: 'M5 17V3.5 M5 4.2h9.5l-2 3 2 3H5',
  sparkle: 'M10 2.8c.5 3.7 3.5 6.7 7.2 7.2-3.7.5-6.7 3.5-7.2 7.2-.5-3.7-3.5-6.7-7.2-7.2 3.7-.5 6.7-3.5 7.2-7.2z',
  send: 'M10 15.5v-11 M5.5 9 10 4.5 14.5 9',
  close: 'M5.5 5.5l9 9 M14.5 5.5l-9 9',
  down: 'M6 8l4 4 4-4',
  right: 'M8 6l4 4-4 4',
  left: 'M12 6l-4 4 4 4',
  up: 'M6 12l4-4 4 4',
  check: 'M5 10.5 8.3 13.8 15 7',
  globe: `${circle(10, 10, 6.5)} M3.5 10h13 M10 3.5c-2 2-2.8 4.3-2.8 6.5s.8 4.5 2.8 6.5 M10 3.5c2 2 2.8 4.3 2.8 6.5s-.8 4.5-2.8 6.5`,
  pin: `M10 17s-5-4.3-5-8.5a5 5 0 0 1 10 0c0 4.2-5 8.5-5 8.5z ${circle(10, 8.5, 1.8)}`,
  lock: 'M6.5 9V7a3.5 3.5 0 0 1 7 0v2 M5.5 9h9a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z',
  cart: `M2.5 3.5h2l1.8 9h8.9l1.6-6.5H5.2 ${circle(7.5, 16, 1.2)} ${circle(14, 16, 1.2)}`,
  search: `${circle(8.8, 8.8, 5.3)} M12.8 12.8l3.7 3.7`,
  user: `${circle(10, 7, 3)} M4.5 16.5c.8-2.8 3-4.5 5.5-4.5s4.7 1.7 5.5 4.5`,
  tag: `M3.5 4.5v5.1a1 1 0 0 0 .3.7l6.4 6.4a1 1 0 0 0 1.4 0l5-5a1 1 0 0 0 0-1.4l-6.4-6.4a1 1 0 0 0-.7-.3H4.5a1 1 0 0 0-1 1z ${circle(7, 7, 1)}`,
  import: 'M10 3v8 M6.8 7.8 10 11l3.2-3.2 M3.5 12.5h3.3l1 2h4.4l1-2h3.3 M3.5 12.5V15a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-2.5',
  card: 'M4 5h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 5z M2.5 8.5h15 M5.5 12h3',
  percent: `M5 15 15 5 ${circle(6, 6, 1.7)} ${circle(14, 14, 1.7)}`,
  truck: `M2.5 5h9v8.5h-9z M11.5 8h3.2l2.8 3v2.5h-6 ${circle(5.5, 14.5, 1.5)} ${circle(14, 14.5, 1.5)}`,
  clock: `${circle(10, 10, 6.5)} M10 6.5V10l2.5 1.5`,
  reader: 'M6.5 2.5h7a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 16V4a1.5 1.5 0 0 1 1.5-1.5z M7.5 5h5v3.5h-5z M8 11.5h.01 M10 11.5h.01 M12 11.5h.01 M8 14h.01 M10 14h.01 M12 14h.01',
  chat: 'M4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4.5A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4z',
  more: `${circle(5, 10, 0.9)} ${circle(10, 10, 0.9)} ${circle(15, 10, 0.9)}`,
  external: 'M8.5 4.5H5a1 1 0 0 0-1 1V15a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1v-3.5 M11.5 3.5h5v5 M16.5 3.5 9.5 10.5',
  info: `${circle(10, 10, 6.5)} M10 9v4.5 M10 6.6v.01`,
  alert: 'M10 3.5 17 16H3z M10 8.5v3.5 M10 14.2v.01',
  refresh: 'M15.5 10a5.5 5.5 0 1 1-1.6-3.9 M15.5 3.5v3.3h-3.3',
  arrow: 'M4 10h12 M11.5 5.5 16 10l-4.5 4.5',
  back: 'M16 10H4 M8.5 5.5 4 10l4.5 4.5',
  eye: `M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z ${circle(10, 10, 2.3)}`,
  apps: 'M4.5 3.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z M12.5 3.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z M4.5 11.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z M14 11.5v5 M11.5 14h5',
  star: 'M10 3.5l2 4.1 4.5.7-3.3 3.2.8 4.5-4-2.1-4 2.1.8-4.5-3.3-3.2 4.5-.7z',
  edit: 'M12.3 4.2l3.5 3.5L7.5 16H4v-3.5z M10.5 6l3.5 3.5',
};

export function icon(name, { size = 20, className = 'icon' } = {}) {
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONS[name] ?? ''}"/></svg>`;
}

// Flags as simple blocks of colour, 3:2. No emoji: they render the same everywhere.
const stripes = (dir, colors) => colors.map((c, i) => {
  const size = 1 / colors.length;
  return dir === 'h'
    ? `<rect y="${(i * 20 * size).toFixed(2)}" width="30" height="${(20 * size + 0.1).toFixed(2)}" fill="${c}"/>`
    : `<rect x="${(i * 30 * size).toFixed(2)}" width="${(30 * size + 0.1).toFixed(2)}" height="20" fill="${c}"/>`;
}).join('');
const nordic = (bg, cross, x, w, y, h) => `<rect width="30" height="20" fill="${bg}"/><rect x="${x}" width="${w}" height="20" fill="${cross}"/><rect y="${y}" width="30" height="${h}" fill="${cross}"/>`;
const usDots = Array.from({ length: 12 }, (_, i) => `<circle cx="${2 + (i % 4) * 3}" cy="${2 + Math.floor(i / 4) * 3.4}" r=".75" fill="#fff"/>`).join('');

const FLAGS = {
  US: `<rect width="30" height="20" fill="#fff"/>${[0, 2, 4, 6].map((i) => `<rect y="${(i * 20) / 7}" width="30" height="${20 / 7}" fill="#B8243A"/>`).join('')}<rect width="13.5" height="${(20 * 4) / 7}" fill="#2B3B7E"/>${usDots}`,
  GB: '<rect width="30" height="20" fill="#1B2B6B"/><path d="M0 0l30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0l30 20M30 0L0 20" stroke="#C4283B" stroke-width="1.4"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6"/><path d="M15 0v20M0 10h30" stroke="#C4283B" stroke-width="3.4"/>',
  DE: stripes('h', ['#141414', '#D0202A', '#F3C300']),
  FR: stripes('v', ['#2A4FA0', '#fff', '#E3413B']),
  NL: stripes('h', ['#B0232E', '#fff', '#26488E']),
  ES: '<rect width="30" height="20" fill="#B8232A"/><rect y="5" width="30" height="10" fill="#F2BE14"/>',
  IT: stripes('v', ['#1E8A4C', '#fff', '#CF2F3A']),
  SE: nordic('#1E6BA6', '#F6C818', 9.4, 3.8, 8, 4),
  FI: nordic('#fff', '#1B3F7E', 8.3, 5, 7.3, 5.4),
  JP: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#C21E3A"/>',
};

export function flag(code) {
  return `<svg class="flag" viewBox="0 0 30 20" width="21" height="14" aria-hidden="true" focusable="false">${FLAGS[code] ?? ''}</svg>`;
}

// Product art, 120 × 120, coloured by the storefront's look.
const shadow = (p, rx = 30) => `<ellipse cx="60" cy="99" rx="${rx}" ry="4.5" fill="${p.ink}" opacity=".13"/>`;
const flame = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><circle cy="9" r="13" fill="#FFC867" opacity=".2"/><path d="M0 0c4.5 5.5 6.5 9 6.5 12a6.5 6.5 0 0 1-13 0c0-3 2-6.5 6.5-12z" fill="#F29A38"/><path d="M0 7c2.2 2.8 3.2 4.6 3.2 6a3.2 3.2 0 0 1-6.4 0c0-1.4 1-3.2 3.2-6z" fill="#FFE3A1"/></g>`;

const ART = {
  mug: (p) => `${shadow(p)}
    <path d="M84 55h4a11 11 0 0 1 0 22h-4" fill="none" stroke="${p.clay}" stroke-width="6.5"/>
    <path d="M36 42h50v41a13 13 0 0 1-13 13H49a13 13 0 0 1-13-13z" fill="${p.clay}"/>
    <path d="M36 42h50v15c-4 3-7.5-2-12 .8s-6.5 6-11.5 3.2-7-5.4-12-2.4-8 4-14.5.4z" fill="${p.accent}"/>
    <ellipse cx="61" cy="42" rx="25" ry="5.5" fill="${p.accent}"/>
    <ellipse cx="61" cy="42" rx="21.5" ry="3.8" fill="${p.deep}"/>
    <g fill="${p.ink}" opacity=".28"><circle cx="46" cy="74" r="1"/><circle cx="55" cy="82" r=".8"/><circle cx="67" cy="71" r="1"/><circle cx="74" cy="86" r=".9"/><circle cx="61" cy="90" r=".8"/><circle cx="50" cy="88" r=".7"/><circle cx="79" cy="75" r=".8"/></g>
    <path d="M42 67v14" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>`,

  candle: (p) => `${shadow(p, 28)}
    <rect x="37" y="46" width="46" height="52" rx="9" fill="#fff" fill-opacity=".62"/>
    <rect x="41" y="55" width="38" height="39" rx="6" fill="${p.wax}"/>
    <rect x="37" y="66" width="46" height="17" fill="${p.accent}"/>
    <rect x="47" y="71.5" width="26" height="2.4" rx="1.2" fill="#fff" opacity=".9"/>
    <rect x="51" y="76" width="18" height="2" rx="1" fill="#fff" opacity=".6"/>
    <rect x="37" y="46" width="46" height="5" rx="2.5" fill="${p.ink}" opacity=".08"/>
    <path d="M60 55v-6" stroke="${p.ink}" stroke-width="1.6" stroke-linecap="round"/>
    ${flame(60, 31)}
    <path d="M41.5 53v39" stroke="#fff" stroke-opacity=".75" stroke-width="2.5" stroke-linecap="round"/>`,

  tote: (p) => `${shadow(p, 29)}
    <path d="M57 51V39a8.5 8.5 0 0 1 17 0v12" fill="none" stroke="${p.strapBack}" stroke-width="4" stroke-linecap="round"/>
    <path d="M34 50h52l-3.5 46h-45z" fill="${p.canvas}"/>
    <path d="M36.6 55.5h46.8" stroke="${p.ink}" stroke-opacity=".2" stroke-dasharray="2.5 2.5"/>
    <path d="M46 52V40a8.5 8.5 0 0 1 17 0v12" fill="none" stroke="${p.strap}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="60" cy="73" r="8.5" fill="${p.accent}"/>
    <path d="M45 88c5-5.5 9.5-7.5 15-7.5s10 2 15 7.5" stroke="${p.ink}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,

  print: (p) => `${shadow(p, 27)}
    <rect x="31" y="18" width="58" height="80" rx="2" fill="#fff"/>
    <rect x="31.5" y="18.5" width="57" height="79" rx="2" fill="none" stroke="${p.ink}" stroke-opacity=".12"/>
    <rect x="37" y="24" width="46" height="60" fill="${p.soft}"/>
    <circle cx="68" cy="42" r="9" fill="${p.accent}"/>
    <path d="M37 72c7-9 14-13 21-13s12 4 25 13v12H37z" fill="${p.leaf}"/>
    <path d="M37 78c9-6 16-8 24-8s14 2 22 8v6H37z" fill="${p.deep}"/>
    <rect x="44" y="89" width="32" height="2" rx="1" fill="${p.ink}" opacity=".3"/>
    <circle cx="86" cy="92" r="11" fill="${p.ink}"/>
    <path d="M86 86.5v8 M82.5 91.5 86 95l3.5-3.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  ticket: (p) => `${shadow(p, 32)}
    <g transform="rotate(-8 60 62)">
      <path d="M18 43h84v12a6 6 0 0 0 0 12v12H18V67a6 6 0 0 0 0-12z" fill="${p.accent}"/>
      <path d="M74 46v30" stroke="#fff" stroke-opacity=".55" stroke-dasharray="3 3"/>
      <text x="27" y="59.5" font-size="11" font-weight="700" letter-spacing=".06em" fill="#fff">CLASS</text>
      <text x="27" y="70" font-size="7" fill="#fff" opacity=".85">Candle pouring</text>
      <text x="88" y="59" font-size="6.5" font-weight="600" fill="#fff" text-anchor="middle" opacity=".85">SAT</text>
      <text x="88" y="69.5" font-size="8" font-weight="700" fill="#fff" text-anchor="middle">10:00</text>
    </g>`,

  box: (p) => `${shadow(p, 31)}
    <path d="M31 57h58v37a3 3 0 0 1-3 3H34a3 3 0 0 1-3-3z" fill="${p.kraft}"/>
    <rect x="27" y="46" width="66" height="13" rx="2.5" fill="${p.kraftDark}"/>
    <rect x="55" y="46" width="10" height="51" fill="${p.accent}"/>
    <path d="M60 46c-7-11-18-10-17-4s10 6 17 4z M60 46c7-11 18-10 17-4s-10 6-17 4z" fill="${p.accent}"/>
    <circle cx="60" cy="46" r="3.4" fill="${p.deep}"/>
    <g transform="rotate(8 84 78)"><rect x="72" y="70" width="25" height="13" rx="3" fill="#fff"/><circle cx="76.5" cy="76.5" r="1.4" fill="${p.kraftDark}"/><text x="86.5" y="79" font-size="6" font-weight="600" text-anchor="middle" fill="${p.ink}">monthly</text></g>`,

  tapers: (p) => `${shadow(p, 24)}
    <rect x="46" y="39" width="10" height="59" rx="4" fill="${p.accent}"/>
    <rect x="64" y="33" width="10" height="65" rx="4" fill="${p.leaf}"/>
    <path d="M51 39v-5 M69 33v-5" stroke="${p.ink}" stroke-width="1.4" stroke-linecap="round"/>
    ${flame(51, 19, 0.72)}${flame(69, 13, 0.72)}
    <path d="M43 80h34" stroke="${p.deep}" stroke-width="5"/>
    <path d="M60 80l-7 10 M60 80l6 11" stroke="${p.deep}" stroke-width="3" stroke-linecap="round"/>
    <path d="M49 82v12" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`,
};

export function art(name, palette, { label = '' } = {}) {
  const draw = ART[name];
  if (!draw) return '';
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="art" viewBox="0 0 120 120" ${a11y} focusable="false">${draw(palette)}</svg>`;
}

// The dot map: land on a 2.5° grid (from Natural Earth's public-domain outlines),
// 144 × 49 cells from 75°N to 47.5°S. Each market lists its cells and a pin.
const MAP = {
  cols: 144,
  rows: 49,
  land: 'AADAAywA/P8AAABgAP4fAAEAAQKAPvYH+H8AAABguP//7x8A4P//K9wc+B8AgH+g1///////z////z98+AMC4L/8////////AP///684+AAB8P7///////9/wP///wMGcAAAfP7//////38fgAf+/wdeAAAAfP7//////wEBAAH4/x9+AABAKP//////f8ABAADw/3//AQCw+P///////8AAAADg////AwDA/////////wAAAADA//8vBwDA/////////wAAAADA//8/AACA/6//////fwAAAADA//8PAACA1wf/////PwIAAADA//8HAADwYW//////DwEAAACA//8DAADwQPn///9/BAEAAACA//8DAAAAD+D/////yAAAAAAA/v8BAADgD8D/////IAAAAAAA+n8AAADwf9f/////AQAAAAAA/IMAAADw///3////AQAAAAAA8IEAAAD8/7/P////AAAAAAAA4AEAAAD8/79/+P9/AQAAAAAAwBEAAAD+/3//8OcHAAAAAAAAwBsYAAD8/39/4MMLAAAAAAAAAB4AAAD+//8e4IEHAQAAAAAAAHAAAAD+//8HwIAPAwAAAAAAAAAUAAD8//8JwIAGAAAAAAAAAID+AAD4//8PAIAABAAAAAAAAAD+AQDw/f8PAAEBAAAAAAAAAAD+DwAA8P8HAIBhAAAAAAAAAAD/DwAA8P8DAABzAAAAAAAAAAD/PwAA8P8BAABzMQAAAAAAAAD//wEA8P8AAAACwQMAAAAAAAD//wMA4P8AAAAEgAcAAAAAAAD//wMA4P8AAACABQEAAAAAAAD+/wEA4P8AAAAAAAAAAAAAAAD+/wAA4P8IAAAAMAAAAAAAAAD4/wAA4P8MAAAAfgIAAAAAAADw/wAA4D8MAAAA/gcAAAAAAADw/wAA4D8GAADA/w8AAAAAAADwPwAAwD8GAADg/w8AAAAAAADwHwAAwB8AAADg/x8AAAAAAAD4DwAAgB8AAADA/x8AAAAAAAD4DwAAgA8AAADA/x8AAAAAAAD4BwAAgAMAAADAwx8AAAAAAAD4AQAAAAAAAAAAAA8AAAAAAAD4AAAAAAAAAAAAAARAAAAAAAA8AAAAAAAAAAAAAAQgAAAAAAA4AAAAAAAAAAAAAAAQAAAAAAAcAAAAAAAAAAAAAAAI',
  markets: {
    US: ['1463-1473 1606-1621 1628 1750-1766 1769-1771 1894-1914 2039-2057 2183-2201 2329-2344 2478-2486 2624-2625 2631 2775', 35.9, 14.7],
    GB: ['1078 1223 1366-1368', 70.8, 8.4],
    DE: ['1227-1229 1370-1373 1515-1516', 76.3, 9.6],
    FR: ['1510-1514 1655-1658 1799-1802', 73.3, 11.2],
    NL: ['1369', 73.5, 9.5],
    ES: ['1941-1944 2085-2087', 70.2, 13.9],
    IT: ['1660 1804 1949-1950 2094', 77.1, 12.8],
    SE: ['368 510-512 653-655 797-798 940-942 1085', 78.6, 4.9],
    FI: ['369-370 513-515 657-659 801-803', 82.3, 3.8],
    JP: ['1857 2000 2144 2286-2287 2429', 126.4, 15.7],
  },
};
const CELL = 10;
const dot = (i) => `M${((i % MAP.cols) + 0.5) * CELL} ${(Math.floor(i / MAP.cols) + 0.5) * CELL}h0`;
const cellsOf = (spec) => spec.split(' ').flatMap((part) => {
  const [from, to = from] = part.split('-').map(Number);
  return Array.from({ length: to - from + 1 }, (_, k) => from + k);
});
let landPath = '';

export function dotMap(markets = []) {
  if (!landPath) {
    const bits = Uint8Array.from(atob(MAP.land), (c) => c.charCodeAt(0));
    for (let i = 0; i < MAP.cols * MAP.rows; i++) if (bits[i >> 3] & (1 << (i & 7))) landPath += dot(i);
  }
  const [homeCode, ...others] = markets.filter((code) => MAP.markets[code]);
  const pinAt = (code) => MAP.markets[code].slice(1).map((v) => v * CELL);
  const lit = markets.filter((code) => MAP.markets[code]).map((code) => cellsOf(MAP.markets[code][0]).map(dot).join('')).join('');
  let routes = '';
  let pins = '';
  if (homeCode) {
    const [hx, hy] = pinAt(homeCode);
    for (const code of others) {
      const [x, y] = pinAt(code);
      const lift = Math.min(90, Math.hypot(x - hx, y - hy) * 0.35);
      routes += `<path class="map-route" d="M${hx} ${hy}Q${(hx + x) / 2} ${Math.min(hy, y) - lift} ${x} ${y}"/>`;
      pins += `<circle class="map-pin" cx="${x}" cy="${y}" r="7"/>`;
    }
    pins += `<circle class="map-home-halo" cx="${hx}" cy="${hy}" r="20"/><circle class="map-home" cx="${hx}" cy="${hy}" r="9"/>`;
  }
  const w = MAP.cols * CELL;
  const h = MAP.rows * CELL;
  return `<svg class="dot-map" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false"><path class="map-land" d="${landPath}"/><path class="map-lit" d="${lit}"/>${routes}${pins}</svg>`;
}
