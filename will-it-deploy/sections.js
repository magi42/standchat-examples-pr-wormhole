// Art for "What happens on every push": a branch graph with preview URLs, a
// rollback you can try, and a route map from the region nearest the visitor.
// Decoration for the made-up product; nothing here talks to Stand.

import { REGIONS } from './deploy.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONO = "font-family=\"'Geist Mono', ui-monospace, monospace\"";

export function drawArt(home) {
  const art = (name) => document.querySelector(`[data-art="${name}"]`);
  branches(art('branches'));
  rollback(art('rollback'));
  map(art('map'), home);
  const note = document.querySelector('[data-map-note]');
  if (note) note.innerHTML = `From where you are, functions would run in <b>${esc(home.code.toUpperCase())}</b>, ${esc(home.city)}.`;
}

// A branch, its preview, and the merge that ships it.
function branches(node) {
  if (!node) return;
  const chip = (cx, y, label, url, live) => {
    const w = (label.length + url.length) * 6.9 + 44;
    const x = cx - w / 2;
    return `<g class="url-chip${live ? ' is-live' : ''}" transform="translate(${x.toFixed(1)} ${y})">
      <rect width="${w.toFixed(1)}" height="26" rx="13"/><circle class="ok" cx="14" cy="13" r="3.5"/>
      <text x="25" y="17"><tspan fill="#8F8F8F">${esc(label)}</tspan><tspan dx="7">${esc(url)}</tspan></text></g>`;
  };
  node.innerHTML = `<svg viewBox="0 0 520 220" preserveAspectRatio="xMidYMid meet" aria-hidden="true" ${MONO}>
    <path class="art-line" d="M24 150H496"/>
    <path class="art-line is-branch" d="M140 150C172 150 172 96 204 96H336C368 96 368 150 400 150" data-draw/>
    <path class="art-leader" d="M316 90V60"/>
    <path class="art-leader" d="M400 156V178"/>
    <circle class="art-dot" cx="64" cy="150" r="5.5"/><circle class="art-dot" cx="140" cy="150" r="5.5"/>
    <circle class="art-dot" cx="262" cy="150" r="5.5"/>
    <circle class="art-dot is-branch" cx="228" cy="96" r="5.5"/><circle class="art-dot is-branch is-head" cx="316" cy="96" r="6.5"/>
    <circle class="art-dot is-head" cx="400" cy="150" r="7"/>
    <text x="24" y="138" font-size="11" fill="#8F8F8F">main</text>
    <text x="206" y="124" font-size="11" fill="#404040">cart-redesign</text>
    <g data-reveal>${chip(316, 32, 'Preview', 'shop-3k1f.airstrip.sh', false)}</g>
    <g data-reveal>${chip(392, 180, 'Production', 'shop.airstrip.sh', true)}</g>
  </svg>`;
  reveal(node, [...node.querySelectorAll('[data-reveal]')]);
}

// Three production deployments; rolling back moves "Current", nothing rebuilds.
function rollback(node) {
  if (!node) return;
  const rows = [
    { msg: 'Redesign the checkout', meta: 'a3f9e21 · 4m ago', bad: true },
    { msg: 'Round taxes per line item', meta: '7c1d0b4 · 2h ago' },
    { msg: 'Winter collection banner', meta: 'e90b37a · 1d ago' },
  ];
  let current = 0;
  node.innerHTML = `<div class="rollback" role="list" aria-label="Recent production deployments">${rows.map((r, i) => `
      <div class="rb-row${r.bad ? ' is-bad' : ''}" role="listitem" data-row="${i}">
        <span class="status is-ready" aria-hidden="true"><i></i></span>
        <span class="rb-msg">${esc(r.msg)}</span>
        <span class="mono">${esc(r.meta)}</span>
        <span class="rb-current" data-current hidden>Current</span>
      </div>`).join('')}</div>
    <div class="rb-actions"><p data-rb-note aria-live="polite">Errors are up since the last deploy.</p><button type="button" class="btn btn-ghost btn-sm" data-rb>Roll back</button></div>`;
  const button = node.querySelector('[data-rb]');
  const note = node.querySelector('[data-rb-note]');
  const paint = () => {
    for (const row of node.querySelectorAll('[data-row]')) {
      const on = Number(row.dataset.row) === current;
      row.classList.toggle('is-current', on);
      row.querySelector('[data-current]').hidden = !on;
    }
  };
  paint();
  button.addEventListener('click', () => {
    current = current === 0 ? 1 : 0;
    paint();
    note.textContent = current === 1 ? 'Rolled back in 0.3 s. Nothing was rebuilt.' : 'Back on the latest deployment.';
    button.textContent = current === 1 ? 'Undo' : 'Roll back';
  });
}

// An airline-style route map, centered on the visitor's region so routes fan out both ways.
function map(node, home) {
  if (!node) return;
  const W = 720;
  const H = 300;
  const wrapLon = (lon) => ((lon - home.lon + 540) % 360) - 180; // -180..180 around home
  const x = (lon) => W / 2 + (wrapLon(lon) / 360) * W * 0.96;
  const y = (lat) => ((70 - lat) / 120) * H;
  const grid = [];
  for (let d = -180; d <= 180; d += 30) grid.push(`M${(W / 2 + (d / 360) * W * 0.96).toFixed(1)} 0V${H}`);
  for (let lat = 60; lat >= -40; lat -= 20) grid.push(`M0 ${y(lat).toFixed(1)}H${W}`);
  const hx = x(home.lon);
  const hy = y(home.lat);
  const arcs = REGIONS.filter((r) => r.code !== home.code).map((r, i) => {
    const tx = x(r.lon);
    const ty = y(r.lat);
    const lift = Math.min(70, Math.hypot(tx - hx, ty - hy) * 0.22);
    return `<path class="map-arc" style="--n:${i}" d="M${hx.toFixed(1)} ${hy.toFixed(1)}Q${((hx + tx) / 2).toFixed(1)} ${((hy + ty) / 2 - lift).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}"/>`;
  }).join('');
  // Labels where they fit: home first, then the rest, skipping any that would collide.
  const placed = [];
  const labels = [];
  for (const r of [home, ...REGIONS.filter((r) => r.code !== home.code)]) {
    const lx = x(r.lon) + 7;
    const ly = y(r.lat) - 7;
    const box = { x1: lx - 2, x2: lx + 26, y1: ly - 10, y2: ly + 3 };
    if (placed.some((b) => b.x1 < box.x2 && box.x1 < b.x2 && b.y1 < box.y2 && box.y1 < b.y2) || box.x2 > W - 4) continue;
    placed.push(box);
    labels.push(`<text class="map-label${r === home ? ' is-home' : ''}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${r.code.toUpperCase()}</text>`);
  }
  const dots = REGIONS.map((r) => {
    const isHome = r.code === home.code;
    return `<circle class="map-dot${isHome ? ' is-home' : ''}" cx="${x(r.lon).toFixed(1)}" cy="${y(r.lat).toFixed(1)}" r="${isHome ? 4.5 : 3}"><title>${esc(r.city)}</title></circle>`;
  }).join('');
  node.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="18 regions around the world, with routes from ${esc(home.city)}">
    <path class="map-graticule" d="${grid.join('')}"/>
    <g data-arcs>${arcs}</g>
    <circle class="map-ring" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="12"/>
    ${dots}${labels.join('')}
  </svg>`;
  reveal(node, [], () => {
    for (const arc of node.querySelectorAll('.map-arc')) arc.classList.add('is-drawn');
  });
}

// Plays an entrance once the art scrolls into view. Reduced motion: it's just there.
function reveal(node, parts, onShow) {
  if (reduced.matches || !('IntersectionObserver' in window)) {
    onShow?.();
    return;
  }
  for (const p of parts) {
    p.style.opacity = '0';
    p.style.transform = 'translateY(6px)';
  }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    parts.forEach((p, i) => {
      p.style.transition = `opacity .5s ${0.2 + i * 0.25}s, transform .5s ${0.2 + i * 0.25}s`;
      p.style.opacity = '1';
      p.style.transform = 'none';
    });
    onShow?.();
  }, { threshold: 0.3 });
  io.observe(node);
}
