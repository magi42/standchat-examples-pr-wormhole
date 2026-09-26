// Template thumbnails: tiny websites drawn in HTML and CSS (tour.css, ".tt").
// Every size is in container units, so one thumbnail works at any width: in the
// tour's template gallery and in the page's template strip.
import { picture } from './art.js';

export const TEMPLATES = [
  { id: 'atelier', name: 'Atelier', price: 'Free', kind: 'Shop · Portfolio' },
  { id: 'northwind', name: 'Northwind', price: '$49', kind: 'Startup' },
  { id: 'ledger', name: 'Ledger', price: '$39', kind: 'Finance' },
  { id: 'parade', name: 'Parade', price: '$29', kind: 'Events' },
  { id: 'harbor', name: 'Harbor', price: '$59', kind: 'Agency' },
  { id: 'quiet', name: 'Quiet', price: 'Free', kind: 'Blog' },
  { id: 'orbit', name: 'Orbit', price: '$39', kind: 'App' },
  { id: 'tessera', name: 'Tessera', price: '$49', kind: 'Architecture' },
];

const nav = (logo, links = 3, button = false) =>
  `<div class="tt-nav"><i class="tt-logo">${logo}</i><span class="tt-links">${'<s></s>'.repeat(links)}</span>${button ? '<em class="tt-btn tt-btn-s"></em>' : ''}</div>`;

const BODIES = {
  atelier: () => `${nav('atelier')}
    <div class="tt-split">
      <div class="tt-copy"><b class="tt-eyebrow"></b><div class="tt-h">Your studio, beautifully online.</div><p></p><p class="tt-short"></p><em class="tt-btn"></em></div>
      ${picture('arch', 'tt-img')}
    </div>`,
  northwind: () => `${nav('◆ northwind', 3, true)}
    <div class="tt-orb"></div>
    <div class="tt-center"><b class="tt-pill">New · Release notes</b><div class="tt-h">Ship calmer software.</div><p></p><div class="tt-row"><em class="tt-btn"></em><em class="tt-btn tt-ghost"></em></div></div>
    <div class="tt-ui"><s></s><s></s><s></s></div>`,
  ledger: () => `${nav('ledger', 4, true)}
    <div class="tt-split">
      <div class="tt-copy"><div class="tt-h">Money, made legible.</div><p></p><p class="tt-short"></p><em class="tt-btn"></em></div>
      <div class="tt-chart"><b>$48,210</b>${'<s></s>'.repeat(7)}</div>
    </div>`,
  parade: () => `${nav('PARADE', 3)}
    <div class="tt-sun"></div>
    <div class="tt-h">Parade<br>Weekend</div>
    <div class="tt-dates"><b>06.12–06.14</b><b>Riverside</b></div>`,
  harbor: () => `${nav('Harbor&nbsp;&amp;&nbsp;Co.', 4)}
    <div class="tt-h">We build brands that outlast trends.</div>
    <div class="tt-grid"><s></s><s></s><s></s><s></s></div>`,
  quiet: () => `${nav('Quiet', 2)}
    <div class="tt-article"><b class="tt-eyebrow"></b><div class="tt-h">Notes on doing less, better</div><p></p><p></p><p class="tt-short"></p><div class="tt-byline"><i></i><s></s></div></div>`,
  orbit: () => `${nav('orbit', 3, true)}
    <div class="tt-split">
      <div class="tt-copy"><div class="tt-h">Your week, in orbit.</div><p></p><div class="tt-row"><em class="tt-btn"></em><em class="tt-btn tt-ghost"></em></div></div>
      <div class="tt-phone"><i></i><s></s><s></s><s></s></div>
    </div>`,
  tessera: () => `${nav('TESSERA', 3)}
    <div class="tt-blocks"><s></s><s></s><s></s></div>
    <div class="tt-h">Buildings for the long light.</div>`,
};

/** A template's thumbnail. Decorative: the name and price are shown next to it. */
export function templateThumb(id) {
  return `<div class="tt tt-${id}" aria-hidden="true">${BODIES[id]()}</div>`;
}
