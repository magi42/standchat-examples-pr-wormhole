// The product tour: Marquee's editor building a website for Loam, a made-up
// ceramics studio. It looks like a screen recording, but it's HTML and CSS set
// by render(t), a pure function of time: every element's state comes from the
// script in tour-script.js, so seeking is instant and any moment can be drawn
// again exactly, which is what lets a question point at one.
//
// The editor is laid out at a fixed design size and scaled to fit, like a
// video. Narrow players get a compact editor (panels become a bottom sheet),
// so the tour stays legible on a phone.

import { SPRITE, picture } from './art.js';
import { TEMPLATES, templateThumb } from './thumbs.js';
import * as S from './tour-script.js';

const SIZES = { full: [1120, 630], compact: [400, 500] };
const FRAME_X = { d: 0, t: 1320, p: 2250 }; // World positions of the three breakpoints.
const FRAME_W = { d: 1200, t: 810, p: 390 };
const LAYER_OF = { 'd:headline': 'heading', 'd:image': 'image', 'd:button': 'button', 'd:list': 'list', 'p:headline': 'phone' };
const KIND_OF = { headline: 'text', image: 'image', button: 'component', list: 'list' };

// Motion helpers -------------------------------------------------------------

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const round = (value, digits) => Number(value.toFixed(digits));
const EASE = {
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  out: (x) => 1 - (1 - x) ** 3,
  in: (x) => x * x * x,
  linear: (x) => x,
};
/** 0 → 1 over [start, start + duration]. */
const ramp = (t, start, duration, ease = EASE.inOut) => (duration <= 0 ? (t >= start ? 1 : 0) : ease(clamp((t - start) / duration)));
/** Visibility of something open from `open` until `close`, with short fades. */
const shown = (t, [open, close], fadeIn = 0.22, fadeOut = 0.18) =>
  Math.min(ramp(t, open, fadeIn, EASE.out), 1 - ramp(t, close, fadeOut, EASE.in));
/** Piecewise values: [[t, v], …], eased between keys. */
function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, to] = keys[i];
    if (t < t1) {
      const [t0, from] = keys[i - 1];
      return lerp(from, to, EASE.inOut((t - t0) / (t1 - t0)));
    }
  }
  return keys.at(-1)[1];
}
const mix = (a, b, p) => `rgb(${a.map((c, i) => Math.round(lerp(c, b[i], p))).join(' ')})`;

// Icons: 16px, drawn for this page.
const svg = (d, extra = '') => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" ${extra}>${d}</svg>`;
const I = {
  chevron: svg('<path d="M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  frame: svg('<path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
  text: svg('<path d="M3.5 4h9M8 4v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  cms: svg('<ellipse cx="8" cy="4" rx="5" ry="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
  globe: svg('<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 8h11M8 2.4c1.6 1.6 2.3 3.5 2.3 5.6S9.6 12 8 13.6C6.4 12 5.7 10.1 5.7 8S6.4 4 8 2.4z" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
  play: svg('<path d="M5 3.6v8.8a.5.5 0 0 0 .76.43l7-4.4a.5.5 0 0 0 0-.86l-7-4.4A.5.5 0 0 0 5 3.6z" fill="currentColor"/>'),
  pointer: svg('<path d="M4 2.5 12.5 8 8.3 8.9 6.4 13z" fill="currentColor"/>'),
  hand: svg('<path d="M5.5 8V4.2a1 1 0 0 1 2 0V7m0-3.6a1 1 0 0 1 2 0V7m0-2.3a1 1 0 0 1 2 0V9c0 2.6-1.6 4.5-4 4.5-1.7 0-2.7-.8-3.6-2.3L2.7 9.3a1 1 0 0 1 1.6-1.1L5.5 9.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  comment: svg('<path d="M3 3.5h10a.5.5 0 0 1 .5.5v6.5a.5.5 0 0 1-.5.5H7l-3 2.5V11H3a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'),
  page: svg('<path d="M4 2.5h5.5L12 5v8.5H4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
  home: svg('<path d="M3 7.2 8 3l5 4.2V13H3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
  desktop: svg('<rect x="2" y="3" width="12" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 13.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
  tablet: svg('<rect x="3.5" y="2" width="9" height="12" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
  phone: svg('<rect x="5" y="2" width="6" height="12" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
  image: svg('<rect x="2.5" y="3" width="11" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="m3 11.5 3.2-3.3 2.3 2.3 1.6-1.5 2.9 2.7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
  component: svg('<path d="m8 1.8 2.2 2.2L8 6.2 5.8 4zM8 9.8l2.2 2.2L8 14.2 5.8 12zM4 5.8 6.2 8 4 10.2 1.8 8zM12 5.8 14.2 8 12 10.2 9.8 8z" fill="currentColor"/>'),
  stack: svg('<path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
  section: svg('<rect x="2.5" y="4" width="11" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.6"/>'),
  search: svg('<circle cx="7" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="m10 10 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
  close: svg('<path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
  check: svg('<path d="m3.5 8.3 2.8 2.7 6-6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="currentColor"/><path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
  out: svg('<path d="M6 3.5h6.5V10M12.2 3.8 4 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  sort: svg('<path d="M5 3v10M2.8 5.2 5 3l2.2 2.2M11 13V3m-2.2 7.8L11 13l2.2-2.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  filter: svg('<path d="M2.5 4h11M4.5 8h7M6.5 12h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
  bolt: svg('<path d="M9 1.8 3.8 9h3.6L6.8 14.2 12.2 7H8.6z" fill="currentColor"/>'),
  scroll: svg('<rect x="4.5" y="1.8" width="7" height="12.4" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
  sparkle: svg('<path d="M8 2.2 9.4 6.6 13.8 8l-4.4 1.4L8 13.8 6.6 9.4 2.2 8l4.4-1.4z" fill="currentColor"/>'),
};

// The site being built: one markup, laid out by container queries for each
// breakpoint (tour.css, ".lm"). `p` prefixes its targets: d, t, p for the
// three breakpoints, v for the preview, l for the live site.
function site(p) {
  const s = (key) => `data-s="${key}"`;
  return `<div class="lm" data-r="${p}:site">
    <div class="lm-nav" data-r="${p}:nav">
      <span class="lm-logo">loam<i></i></span>
      <span class="lm-links"><span ${s('nav1')}></span><span ${s('nav2')}></span><span ${s('nav3')}></span><span ${s('nav4')}></span></span>
      <span class="lm-nav-r"><span class="lm-lang" ${s('lang')}></span><span ${s('bag')}></span></span>
      <span class="lm-burger"><i></i><i></i></span>
    </div>
    <div class="lm-hero" data-k="${p}:hero">
      <div class="lm-copy" data-r="${p}:copy">
        <p class="lm-eyebrow" ${s('eyebrow')}></p>
        <div class="lm-h1" data-k="${p}:headline" data-r="${p}:headline"></div>
        <p class="lm-lede" ${s('lede')}></p>
        <div class="lm-actions">
          <span class="lm-btn" data-k="${p}:button" data-r="${p}:button"><span ${s('cta')}></span></span>
          <span class="lm-link" ${s('link')}></span>
        </div>
      </div>
      <div class="lm-media" data-k="${p}:image" data-r="${p}:image">
        <div class="lm-media-in" data-r="${p}:media">${picture('arch', 'lm-img')}${picture('vessels', 'lm-img lm-img-new')}</div>
      </div>
    </div>
    <div class="lm-journal" data-k="${p}:journal" data-r="${p}:journal">
      <div class="lm-jhead"><div class="lm-h2" ${s('jtitle')}></div><span ${s('jall')}></span></div>
      <div class="lm-list" data-k="${p}:list" data-r="${p}:list">
        <div class="lm-empty" data-r="${p}:empty">${I.stack}<b>Collection list</b><span>Connect a collection to fill it in</span></div>
        ${[0, 1, 2].map((i) => `<div class="lm-card" data-k="${p}:card-${i}" data-r="${p}:card-${i}">
          <div class="lm-cover">${picture(`j${i + 1}`)}</div><div class="lm-date" ${s(`d${i + 1}`)}></div><div class="lm-h3" ${s(`t${i + 1}`)}></div>
        </div>`).join('')}
      </div>
    </div>
    <div class="lm-foot" data-r="${p}:foot">
      <span class="lm-logo">loam<i></i></span><span ${s('foot')}></span><span ${s('news')}></span>
    </div>
  </div>`;
}

function frame(p, name) {
  return `<div class="fr fr-${p}" data-r="${p}:frame" style="left:${FRAME_X[p]}px;width:${FRAME_W[p]}px">
    <div class="fr-head" data-r="${p}:head">
      <span class="fr-name">${I[{ d: 'desktop', t: 'tablet', p: 'phone' }[p]]}${name}</span><span class="fr-w">${FRAME_W[p]}</span>
      <span class="fr-add" data-k="${p}:add">${I.plus}</span>
    </div>
    <div class="fr-page">
      ${p === 'd' ? '<div class="fr-blank" data-r="d:blank">Empty page</div>' : ''}
      ${site(p)}
    </div>
  </div>`;
}

const layer = (key, icon, name, depth, extra = '') =>
  `<div class="ly" data-r="ly-${key}" style="--d:${depth}">${extra}<span class="ly-ic">${I[icon]}</span><span>${name}</span></div>`;

function markup() {
  const templateCards = TEMPLATES.slice(0, 6).map((tpl) => `
    <div class="tpl-card" data-k="tpl-${tpl.id}" data-r="tpl-${tpl.id}">
      <div class="tpl-thumb">${templateThumb(tpl.id)}<span class="tpl-check">${I.check}</span></div>
      <div class="tpl-meta"><b>${tpl.name}</b><span>${tpl.price}</span></div>
    </div>`).join('');

  return `
  <div class="tour" data-layout="full">
    <div class="cam" data-r="cam">
      <div class="ed">
        <header class="ed-top">
          <div class="ed-top-l">
            <span class="tb tb-project">${MARK}<b>Loam</b>${I.chevron}</span>
            <span class="tb-sep"></span>
            <span class="tb ic tb-opt">${I.plus}</span>
            <span class="tb ic tb-opt">${I.frame}</span>
            <span class="tb ic tb-opt">${I.text}</span>
            <span class="tb ic" data-k="tb-cms">${I.cms}</span>
            <span class="tb tb-locale" data-k="tb-locale">${I.globe}<b data-r="tb-locale-label">English</b>${I.chevron}</span>
          </div>
          <div class="ed-top-c"><span>Home</span><span class="ed-branch">main</span></div>
          <div class="ed-top-r">
            <span class="ed-people"><i style="--c:#E8A33D">IS</i><i style="--c:#7A6BF0">JO</i></span>
            <span class="tb ic" data-k="tb-preview">${I.play}</span>
            <span class="tb tb-opt tb-invite">Invite</span>
            <span class="tb tb-publish" data-k="tb-publish">Publish</span>
          </div>
        </header>

        <aside class="ed-left">
          <div class="pn-tabs"><span class="on">Layers</span><span>Assets</span><span>Insert</span></div>
          <div class="pn-sec">Pages</div>
          <div class="pg on">${I.home}Home</div><div class="pg">${I.page}Shop</div><div class="pg">${I.page}Journal</div><div class="pg">${I.page}Studio</div>
          <div class="pn-sec">Layers</div>
          <div class="ly-tree">
            ${layer('desktop', 'desktop', 'Desktop', 0)}
            <div class="ly-kids" data-r="ly-kids">
              ${layer('nav', 'section', 'Navigation', 1)}
              ${layer('hero', 'section', 'Hero', 1)}
              ${layer('heading', 'text', 'Heading', 2)}
              ${layer('text', 'text', 'Text', 2)}
              ${layer('button', 'component', 'Button', 2)}
              ${layer('image', 'image', 'Image', 2)}
              ${layer('journal', 'section', 'Journal', 1)}
              ${layer('list', 'stack', 'Collection list', 2)}
              ${layer('footer', 'section', 'Footer', 1)}
            </div>
            ${layer('tablet', 'tablet', 'Tablet', 0)}
            ${layer('phone', 'phone', 'Phone', 0)}
          </div>
        </aside>

        <div class="ed-canvas" data-k="canvas" data-r="canvas">
          <div class="world" data-r="world">${frame('d', 'Desktop')}${frame('t', 'Tablet')}${frame('p', 'Phone')}</div>
          <div class="hov" data-r="hov"></div>
          <div class="sel" data-r="sel"><i class="hd tl"></i><i class="hd tr"></i><i class="hd bl"></i><i class="hd br"></i><b class="sel-name" data-r="sel-name"></b><b class="sel-size" data-r="sel-size"></b></div>
          <div class="cv-tip" data-r="cv-tip">${I.page}<span>/journal/notes-from-a-wood-firing</span></div>
          <div class="ed-tools"><span class="on">${I.pointer}</span><span>${I.hand}</span><span>${I.comment}</span><b data-r="zoom">50%</b></div>
        </div>

        <aside class="ed-right" data-r="right">
          <div class="insp" data-r="insp-page">
            <div class="insp-head"><b>Home</b><span class="muted">Page</span></div>
            <div class="sec"><div class="sec-t">Breakpoints</div>
              <div class="bp-row">${I.desktop}<span>Desktop</span><em>1200</em></div>
              <div class="bp-row" data-r="bp-t">${I.tablet}<span>Tablet</span><em>810</em></div>
              <div class="bp-row" data-r="bp-p">${I.phone}<span>Phone</span><em>390</em></div>
            </div>
            <div class="sec"><div class="sec-t">Page</div>
              <div class="row"><label>Title</label><span class="fld">Loam · Stoneware</span></div>
              <div class="row"><label>Path</label><span class="fld">/</span></div>
              <div class="row"><label>Languages</label><span class="fld" data-r="page-langs">English</span></div>
            </div>
          </div>

          <div class="insp" data-r="insp-text">
            <div class="insp-head"><span class="insp-ic">${I.text}</span><b>Heading</b><span class="bp-chip" data-r="bp-chip">${I.phone}Phone</span></div>
            <div class="sec sec-extra"><div class="sec-t">Size</div>
              <div class="row two"><span class="fld"><i>W</i>Fill</span><span class="fld"><i>H</i>Fit</span></div>
            </div>
            <div class="sec"><div class="sec-t">Text</div>
              <div class="row row-extra"><span class="fld wide">Instrument Serif ${I.chevron}</span></div>
              <div class="row two"><span class="fld">Regular ${I.chevron}</span><span class="fld num" data-k="insp-size" data-r="insp-size"><i>Size</i><b data-r="size-v">72</b><span class="ovr" data-r="ovr"></span></span></div>
              <div class="row two"><span class="fld"><i>Line</i>1.05</span><span class="fld"><i>Letter</i>−1%</span></div>
              <div class="row row-extra"><span class="fld wide"><span class="sw" style="--c:#221C18"></span>221C18<em>100%</em></span></div>
            </div>
          </div>

          <div class="insp" data-r="insp-image">
            <div class="insp-head"><span class="insp-ic">${I.image}</span><b>Image</b></div>
            <div class="sec sec-image"><div class="sec-t">Image</div>
              <div class="img-row"><span class="img-thumb" data-r="img-thumb">${picture('arch', 'lm-img')}${picture('vessels', 'lm-img lm-img-new')}</span><span class="img-name" data-r="img-name">arch-study.jpg</span></div>
              <div class="row two"><span class="fld">Fill ${I.chevron}</span><span class="fld btn" data-k="insp-replace">Replace</span></div>
            </div>
            <div class="sec"><div class="sec-t">Effects<span class="sec-add" data-k="insp-fx-add">${I.plus}</span></div>
              <div class="fx" data-r="fx"><div class="fx-in">
                <div class="fx-head">${I.scroll}<b>Scroll transform</b></div>
                <div class="row"><label>Offset Y</label><span class="fld num" data-k="insp-fx-y" data-r="insp-fx-y"><b data-r="fx-y">0</b></span></div>
                <div class="row"><label>Scale</label><span class="fld num"><b>1.08</b></span></div>
                <div class="row"><label>Trigger</label><span class="fld">In view ${I.chevron}</span></div>
              </div></div>
            </div>
          </div>

          <div class="insp" data-r="insp-component">
            <div class="insp-head comp"><span class="insp-ic">${I.component}</span><b>Button</b><span class="comp-chip">Component</span></div>
            <div class="sec"><div class="sec-t">Button</div>
              <div class="row"><label>Variant</label><span class="fld sel-fld" data-k="insp-variant"><b data-r="variant-v">Primary</b>${I.chevron}</span></div>
              <div class="row"><label>Label</label><span class="fld" data-s="cta"></span></div>
              <div class="row"><label>Link</label><span class="fld">/shop</span></div>
            </div>
            <div class="sec sec-extra"><div class="sec-t">Instances</div><p class="insp-note">Used 6 times on 3 pages. Changes to the variant apply everywhere.</p></div>
          </div>

          <div class="insp" data-r="insp-list">
            <div class="insp-head"><span class="insp-ic">${I.stack}</span><b>Collection list</b></div>
            <div class="sec"><div class="sec-t">Collection</div>
              <div class="row"><label>Source</label><span class="fld sel-fld" data-k="insp-source"><b data-r="source-v">None</b>${I.chevron}</span></div>
              <div class="row"><label>Limit</label><span class="fld">3</span></div>
              <div class="row"><label>Sort</label><span class="fld">Newest first ${I.chevron}</span></div>
            </div>
            <div class="sec sec-extra"><div class="sec-t">Layout</div>
              <div class="row two"><span class="fld">Grid</span><span class="fld">3 columns</span></div>
              <div class="row"><label>Gap</label><span class="fld">24</span></div>
            </div>
          </div>
        </aside>
      </div>

      <div class="ov ov-tpl" data-r="ov-tpl">
        <div class="tpl-win">
          <div class="tpl-head"><b>New site</b><span class="tpl-search">${I.search}Search 240 templates</span><span class="tpl-x">${I.close}</span></div>
          <div class="tpl-main">
            <div class="tpl-cats"><span class="on">All</span><span>Shop</span><span>Portfolio</span><span>Startup</span><span>Blog</span><span>Events</span></div>
            <div class="tpl-grid" data-k="tpl-grid">${templateCards}</div>
          </div>
          <div class="tpl-foot"><span class="tpl-picked" data-r="tpl-picked">Pick a template to start from</span><span class="ed-btn-blue" data-k="tpl-use" data-r="tpl-use">Use template</span></div>
        </div>
      </div>

      <div class="ov ov-cms" data-r="ov-cms">
        <div class="cms-side">
          <div class="cms-t">Collections</div>
          <div class="cms-col on">${I.cms}<span>Journal</span><em>3</em></div>
          <div class="cms-col">${I.cms}<span>Products</span><em>24</em></div>
          <div class="cms-col">${I.cms}<span>Glazes</span><em>12</em></div>
          <div class="cms-col">${I.cms}<span>Workshops</span><em>6</em></div>
        </div>
        <div class="cms-main">
          <div class="cms-bar"><b>Journal</b><span class="cms-tools">${I.plus}${I.sort}${I.filter}${I.search}</span><span class="grow"></span><span class="ed-btn-dark" data-k="cms-done">Done</span></div>
          <div class="cms-table">
            <div class="cms-tr cms-th"><span>Title</span><span>Cover</span><span>Date</span><span>Status</span></div>
            ${[0, 1, 2].map((i) => `<div class="cms-tr" data-k="cms-row-${i}" data-r="cms-row-${i}">
              <span data-s="t${i + 1}"></span><span class="cms-cover">${picture(`j${i + 1}`)}</span><span data-s="d${i + 1}"></span><span class="cms-live"><i></i>Published</span>
            </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="menu menu-assets" data-r="menu-assets">
        <div class="menu-t">Assets</div>
        <div class="asset-grid">
          <span class="asset on" data-k="asset-arch">${picture('arch')}</span>
          <span class="asset" data-k="asset-vessels">${picture('vessels')}</span>
          <span class="asset">${picture('glaze')}</span>
          <span class="asset">${picture('kiln')}</span>
        </div>
      </div>
      <div class="menu" data-r="menu-variant">
        <div class="mi on">${I.check}Primary</div><div class="mi">Outline</div><div class="mi" data-k="variant-pill">Pill</div>
      </div>
      <div class="menu" data-r="menu-bp">
        <div class="menu-t">Add breakpoint</div>
        <div class="mi" data-k="bpmenu-tablet" data-r="bpmenu-tablet">${I.tablet}Tablet<em>810</em></div>
        <div class="mi" data-k="bpmenu-phone">${I.phone}Phone<em>390</em></div>
        <div class="mi">${I.frame}Custom…</div>
      </div>
      <div class="menu" data-r="menu-source">
        <div class="menu-t">Collections</div>
        <div class="mi" data-k="srcmenu-journal">${I.cms}Journal<em>3</em></div><div class="mi">${I.cms}Products<em>24</em></div><div class="mi">${I.cms}Glazes<em>12</em></div>
      </div>
      <div class="menu" data-r="menu-fx">
        <div class="mi">${I.sparkle}Appear</div><div class="mi" data-k="fxmenu-scroll">${I.scroll}Scroll transform</div><div class="mi">${I.pointer}Hover</div><div class="mi">${I.bolt}Press</div>
      </div>

      <div class="pop pop-locale" data-k="pop-locale" data-r="pop-locale">
        <div class="pop-head"><b>Languages</b><span class="muted">1 of 5 on Pro</span></div>
        <div class="loc-row"><span class="loc-code">EN</span><span>English</span><span class="chip">Default</span></div>
        <div class="loc-row loc-fr" data-k="loc-fr-row" data-r="loc-fr-row">
          <span class="loc-code">FR</span><span>Français</span>
          <span class="loc-prog"><i data-r="loc-bar"></i></span><span class="loc-count" data-r="loc-count">0 / 42</span>
        </div>
        <span class="loc-add" data-k="loc-add">${I.plus}Add language</span>
        <div class="menu loc-list" data-r="loc-list">
          <div class="mi">Deutsch</div><div class="mi">Español</div><div class="mi" data-k="loc-fr">Français</div><div class="mi">Italiano</div><div class="mi">Português</div>
        </div>
      </div>

      <div class="pop pop-publish" data-k="pop-publish" data-r="pop-publish">
        <div class="pop-head"><b>Publish</b><span class="muted" data-r="pub-when">Last published 2 days ago</span></div>
        <div class="pub-dom">${I.globe}<b>loam.studio</b><span class="chip">Primary</span></div>
        <div class="pub-dom sub">${I.globe}<span>loam-studio.marquee.site</span></div>
        <div class="pub-steps">
          <div class="pub-step" data-r="pub-step-0"><i>${I.check}</i><span>Optimizing 14 images</span></div>
          <div class="pub-step" data-r="pub-step-1"><i>${I.check}</i><span>Rendering 24 pages in 2 languages</span></div>
          <div class="pub-step" data-r="pub-step-2"><i>${I.check}</i><span>Deploying to 38 regions</span></div>
        </div>
        <div class="pub-foot">
          <span class="pub-live" data-r="pub-live"><i></i>Live on loam.studio</span>
          <span class="pub-btns">
            <span class="ed-btn-blue" data-k="pub-go" data-r="pub-go">Publish</span>
            <span class="ed-btn-dark" data-k="pub-visit" data-r="pub-visit">Visit site${I.out}</span>
          </span>
        </div>
      </div>

      <div class="ov ov-preview" data-k="preview" data-r="ov-preview">
        <div class="win-bar"><span class="win-dots"><i></i><i></i><i></i></span><span class="win-title">${I.play}Preview · Home</span><span class="win-dev" data-r="pv-dev">${I.desktop}Desktop</span><span class="win-x" data-k="preview-close">${I.close}</span></div>
        <div class="win-view"><div class="win-page" data-r="v:page">${site('v')}</div></div>
      </div>

      <div class="ov ov-live" data-k="live" data-r="ov-live">
        <div class="win-bar"><span class="win-dots"><i></i><i></i><i></i></span><span class="win-url">${I.lock}loam.studio</span></div>
        <div class="win-view"><div class="win-page" data-r="l:page">${site('l')}</div></div>
      </div>

      <div class="ripple" data-r="ripple-0"></div><div class="ripple" data-r="ripple-1"></div>
      <div class="cursor" data-r="cursor">
        <svg class="cur cur-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.8v15.9l4.1-3.9 2.7 6.1 2.7-1.2-2.6-6h5.9z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <svg class="cur cur-text" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 4h6M11.5 4v16M8.5 20h6" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M8.5 4h6M11.5 4v16M8.5 20h6" stroke="#111" stroke-width="1.6" stroke-linecap="round"/></svg>
        <svg class="cur cur-ew" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" fill="none" stroke="#111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
  </div>`;
}

// Marquee's mark: an M cut from three pieces.
export const MARK = '<svg class="mq-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 21V3h4.6v18z" fill="currentColor"/><path d="M16.4 3H21v18h-4.6z" fill="currentColor"/><path d="m8.6 3 3.4 5.2L15.4 3v7.1L12 15.3l-3.4-5.2z" fill="currentColor" opacity=".55"/></svg>';

let spriteAdded = false;

/**
 * Builds a tour inside `host` and returns its controls. Call render(t) with a
 * time in seconds; call resize() when the host's size changes. `layout` can
 * force 'full' or 'compact', for a preview that matches another player.
 */
export function createTour(host, { reducedMotion = () => false, layout: forced = () => null } = {}) {
  if (!spriteAdded) {
    document.body.insertAdjacentHTML('afterbegin', SPRITE);
    spriteAdded = true;
  }
  host.innerHTML = markup();
  const root = host.querySelector('.tour');
  // Like a video: seen, not read. Captions and the text version carry it for screen readers.
  root.setAttribute('aria-hidden', 'true');
  root.inert = true;
  const R = {};
  for (const el of root.querySelectorAll('[data-r]')) R[el.dataset.r] = el;
  const K = {};
  for (const el of root.querySelectorAll('[data-k]')) K[el.dataset.k] = el;
  const texts = [...root.querySelectorAll('[data-s]')].map((el) => ({ el, key: el.dataset.s, copy: el.closest('.lm') ? copyOf(el) : 'ui' }));

  let layout = 'full';
  let scale = 1;
  let origin = { x: 0, y: 0 };
  let cam = { x: 0, y: 0, z: 1 }; // Screen-recording zoom, on .cam
  let world = { x: 0, y: 0, z: 1 }; // Canvas pan and zoom, on .world (none until the first frame)
  let canvasBox = { x: 0, y: 0, w: 0, h: 0 };
  let sheet = 0; // How far the phone layout's inspector sheet is up, 0–1.
  let sheetH = 0;
  let last = -1;

  const hovers = hoverIntervals();

  // Tiny DOM writer: skips values that haven't changed since the last frame.
  const memo = new WeakMap();
  function css(el, prop, value) {
    if (!el) return;
    let seen = memo.get(el);
    if (!seen) memo.set(el, (seen = {}));
    if (seen[prop] === value) return;
    seen[prop] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else if (prop.startsWith('.')) el.classList.toggle(prop.slice(1), value);
    else el.style[prop] = value;
  }
  function fade(el, v, { y = 0, x = 0, s = 0, origin: o } = {}) {
    css(el, 'opacity', String(Math.round(v * 1000) / 1000));
    css(el, 'visibility', v > 0.001 ? 'visible' : 'hidden');
    const k = 1 - v;
    css(el, 'transform', `translate(${(x * k).toFixed(2)}px, ${(y * k).toFixed(2)}px)${s ? ` scale(${(1 - s * k).toFixed(4)})` : ''}`);
    if (o) css(el, 'transformOrigin', o);
  }

  // Geometry ---------------------------------------------------------------
  // Everything is measured in the editor's design pixels, before the zoom.

  function box(el) {
    const r = el.getBoundingClientRect();
    const x = (r.left - origin.x) / scale;
    const y = (r.top - origin.y) / scale;
    return { x: (x - cam.x) / cam.z, y: (y - cam.y) / cam.z, w: r.width / scale / cam.z, h: r.height / scale / cam.z };
  }
  function worldBox(el) {
    const b = box(el);
    return { x: (b.x - canvasBox.x - world.x) / world.z, y: (b.y - canvasBox.y - world.y) / world.z, w: b.w / world.z, h: b.h / world.z };
  }
  function point(spec) {
    const [key, at] = spec.split('@');
    const el = K[key];
    if (!el) return { x: 0, y: 0 };
    const b = box(el);
    const [fx, fy] = at ? at.split(',').map(Number) : [0.5, 0.5];
    return { x: b.x + b.w * fx, y: b.y + b.h * fy };
  }
  const union = (boxes) => {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  };
  const pad = (b, px, py = px) => ({ x: b.x - px, y: b.y - py, w: b.w + 2 * px, h: b.h + 2 * py });

  // The rectangle of the world each named view shows.
  function fit(name) {
    const hero = (p) => worldBox(K[`${p}:hero`]);
    const top = (p, extra = 0) => ({ x: FRAME_X[p], y: -60, w: FRAME_W[p], h: hero(p).y + hero(p).h + 60 + extra });
    switch (name) {
      case 'page-top': return pad(top('d'), 60, 20);
      case 'hero-text': return pad(union([worldBox(K['d:headline']), worldBox(K['d:button'])]), 90, 70);
      case 'hero': return pad(hero('d'), 40, 30);
      case 'journal': return pad(worldBox(K['d:journal']), 40, 20);
      case 'page': return pad(worldBox(R['d:frame']), 60, 40);
      case 'desktop-tablet': return pad(union([top('d'), top('t')]), 60, 20);
      case 'all-frames': return layout === 'compact' ? pad(union([top('t'), top('p')]), 40, 20) : pad(union([top('d'), top('t'), top('p')]), 60, 20);
      case 'tablet-phone': {
        // Tablet and phone up close, with the edge of desktop still in view.
        const b = union([top('t'), top('p')]);
        return layout === 'compact' ? pad(top('p'), 36, 20) : pad({ ...b, x: b.x - 200, w: b.w + 200 }, 50, 20);
      }
      default: return pad(top('d'), 60, 20);
    }
  }

  function viewFor(rect, inset) {
    const w = canvasBox.w;
    const h = canvasBox.h - inset;
    const z = Math.min(w / rect.w, h / rect.h);
    return { z, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, w, h };
  }

  // Hover states come from the cursor: a target is hovered while the cursor rests on it.
  function hoverIntervals() {
    const map = {};
    S.CURSOR.forEach((c, i) => {
      const key = c.at.split('@')[0];
      const next = S.CURSOR[i + 1];
      (map[key] ??= []).push([c.t - 0.05, next ? next.t - next.dur + 0.05 : Infinity]);
    });
    return map;
  }
  const hovered = (key, t) => (hovers[key] ?? []).some(([a, b]) => t >= a && t < b);

  // Rendering ---------------------------------------------------------------

  function render(t) {
    t = clamp(Number(t) || 0, 0, S.DURATION);
    last = t;
    const r = root.getBoundingClientRect();
    origin = { x: r.left, y: r.top };
    renderSite(t);
    renderChrome(t);
    renderOverlays(t);
    canvasBox = box(R.canvas);
    renderWorld(t);
    renderMarks(t);
    placeMenus(t);
    renderZoom(t);
    renderCursor(t);
  }

  function copyOf(el) {
    return el.closest('[data-r$=":site"]').dataset.r[0];
  }

  function renderSite(t) {
    const french = t >= S.AT.locale;
    const dip = 1 - 0.85 * Math.sin(Math.PI * clamp((t - (S.AT.locale - 0.2)) / 0.4));
    for (const { el, key, copy } of texts) {
      const lang = french && copy !== 'l' && copy !== 'v' ? 'fr' : 'en';
      css(el, 'text', S.COPY[lang][key]);
      if (copy === 'd' || copy === 't' || copy === 'p') css(el, 'opacity', String(dip));
    }

    // The headline: the template's words, selected, retyped, then translated.
    for (const p of ['d', 't', 'p', 'v', 'l']) {
      const h = R[`${p}:headline`];
      const lang = french && p !== 'l' && p !== 'v' ? 'fr' : 'en';
      let html;
      if (p === 'd' && t < S.AT.typing[1]) {
        const [a, b] = S.AT.typing;
        if (t < S.AT.selectAll[0]) html = esc(S.TEMPLATE_HEADLINE);
        else if (t < a) html = `<span class="hl">${esc(S.TEMPLATE_HEADLINE)}</span>`;
        else {
          const target = S.COPY.en.headline;
          const n = Math.floor(clamp((t - a) / (b - a)) * target.length + 1e-6);
          html = esc(target.slice(0, n));
        }
      } else {
        html = esc(S.COPY[lang].headline);
      }
      if (p === 'd' && t >= S.AT.edit[0] && t < S.AT.edit[1]) {
        const typing = t >= S.AT.typing[0] && t < S.AT.typing[1];
        const blink = typing || (t - S.AT.edit[0]) % 1.06 < 0.62;
        html += `<span class="caret"${blink ? '' : ' style="opacity:0"'}></span>`;
      }
      css(h, 'html', html);
      if (p === 'd' || p === 't' || p === 'p') css(h, 'opacity', String(dip));
      css(h, '.editing', p === 'd' && t >= S.AT.edit[0] && t < S.AT.edit[1]);
    }
    const phoneSize = Math.round(lerp(44, 36, ramp(t, S.AT.phoneSize[0], S.AT.phoneSize[1] - S.AT.phoneSize[0], EASE.linear)));
    css(R['p:headline'], 'fontSize', `${phoneSize}px`);

    // The desktop page fills in when the template is applied.
    const applied = t >= S.AT.applied;
    fade(R['d:blank'], 1 - ramp(t, S.AT.applied, 0.25));
    const parts = [['nav', 0], ['copy', 0.15], ['image', 0.3], ['journal', 0.45], ['foot', 0.6]];
    for (const [part, delay] of parts) fade(R[`d:${part}`], applied ? ramp(t, S.AT.applied + delay, 0.55, EASE.out) : 0, { y: 18 });

    // The hero image, the button variant and the journal list, in every copy.
    const swap = ramp(t, S.AT.image, 0.5);
    const pill = ramp(t, S.AT.variant, 0.45);
    css(R['img-thumb'], '--swap', swap.toFixed(3));
    for (const p of ['d', 't', 'p', 'v', 'l']) {
      css(R[`${p}:media`], '--swap', swap.toFixed(3));
      const b = R[`${p}:button`];
      css(b, '--btn-bg', mix([34, 28, 24], [196, 98, 45], pill));
      css(b, '--btn-r', `${lerp(6, 30, pill).toFixed(1)}px`);
    }
    for (const p of ['d', 't', 'p']) {
      fade(R[`${p}:empty`], 1 - ramp(t, S.AT.connect, 0.3));
      for (let i = 0; i < 3; i++) fade(R[`${p}:card-${i}`], ramp(t, S.AT.connect + 0.1 + i * 0.2, 0.45, EASE.out), { y: 14, s: 0.03 });
    }
    // Preview and live site: scrolling, with the scroll transform and appear effects.
    scrollSite('v', track(t, S.PREVIEW_SCROLL), t);
    scrollSite('l', track(t, S.LIVE_SCROLL), t);
  }

  function scrollSite(p, wanted, t) {
    const page = R[`${p}:page`];
    const view = page.parentElement;
    const k = view.clientWidth / page.offsetWidth || 1;
    // Never past the footer, whichever layout the page is in.
    const y = Math.max(0, Math.min(wanted, page.offsetHeight - view.clientHeight / k));
    css(page, 'transform', `translateY(${(-y * k).toFixed(1)}px) scale(${k.toFixed(4)})`);
    const effect = p === 'l' || t >= S.AT.fxAdded; // The preview shows the new effect.
    const q = clamp(y / 600);
    css(R[`${p}:media`], 'transform', effect ? `translateY(${(-120 * q).toFixed(1)}px) scale(${(1 + 0.08 * q).toFixed(4)})` : 'none');
    fade(R[`${p}:empty`], 0);
    const viewH = view.clientHeight / k;
    for (let i = 0; i < 3; i++) {
      const card = R[`${p}:card-${i}`];
      const top = card.offsetTop + R[`${p}:list`].offsetTop; // Both relative to the page.
      const v = clamp((y + viewH - top - 40 - i * 30) / 170);
      fade(card, EASE.out(v), { y: 30 });
    }
  }

  function activeSelection(t) {
    return S.SELECTIONS.find(([a, b]) => t >= a && t < b) ?? null;
  }

  function renderChrome(t) {
    const sel = activeSelection(t);
    const key = sel?.[2] ?? '';
    // Inspector: one panel per kind of selection, cross-fading.
    const panels = { page: 1, text: 0, image: 0, component: 0, list: 0 };
    for (const [a, b, k] of S.SELECTIONS) {
      const v = shown(t, [a, b], 0.16, 0.12);
      if (v > 0) {
        const kind = KIND_OF[k.split(':')[1]];
        panels[kind] = Math.max(panels[kind], v);
        panels.page = Math.min(panels.page, 1 - v);
      }
    }
    for (const [kind, v] of Object.entries(panels)) fade(R[`insp-${kind}`], v, { y: 4 });

    const phone = key.startsWith('p:') || (!sel && t > 39 && t < 47.4);
    css(R['bp-chip'], '.on', phone);
    const size = phone ? Math.round(lerp(44, 36, ramp(t, S.AT.phoneSize[0], S.AT.phoneSize[1] - S.AT.phoneSize[0], EASE.linear))) : 72;
    css(R['size-v'], 'text', String(size));
    css(R.ovr, '.on', phone && t >= S.AT.phoneSize[1]);
    css(R['insp-size'], '.active', t >= S.PRESSES[0][0] && t < S.PRESSES[0][1]);
    css(R['insp-fx-y'], '.active', t >= S.PRESSES[1][0] && t < S.PRESSES[1][1]);
    css(R['variant-v'], 'text', t >= S.AT.variant ? 'Pill' : 'Primary');
    css(R['source-v'], 'text', t >= S.AT.connect ? 'Journal' : 'None');
    css(R['img-name'], 'text', t >= S.AT.image ? 'vessels-on-clay.jpg' : 'arch-study.jpg');
    const fx = ramp(t, S.AT.fxAdded, 0.35);
    css(R.fx, '--open', fx.toFixed(3));
    css(R['insp-image'], '.fx-on', t >= S.AT.fxAdded);
    css(R['fx-y'], 'text', String(Math.round(lerp(0, -120, ramp(t, S.AT.fxDrag[0], S.AT.fxDrag[1] - S.AT.fxDrag[0], EASE.linear)))).replace('-', '−'));
    fade(R['bp-t'], ramp(t, S.AT.tablet, 0.3));
    fade(R['bp-p'], ramp(t, S.AT.phone, 0.3));
    css(R['page-langs'], 'text', t >= S.AT.translate[1] ? 'English, Français' : 'English');
    css(R['tb-locale-label'], 'text', t >= S.AT.locale ? 'Français' : 'English');

    // On phones the inspector is a bottom sheet, up while something is selected,
    // and as tall as the panel it shows (measured now that its values are set).
    sheet = Math.max(panels.text, panels.image, panels.component, panels.list);
    css(R.right, '--sheet', sheet.toFixed(3));
    if (layout === 'compact') {
      const top = Object.entries(panels).filter(([kind]) => kind !== 'page').sort((a, b) => b[1] - a[1])[0][0];
      sheetH = R[`insp-${top}`].scrollHeight + 14;
      css(R.right, 'height', `${sheetH}px`);
    } else {
      css(R.right, 'height', '');
    }

    // Layers: the tree fills in with the template; the selection is highlighted.
    fade(R['ly-kids'], ramp(t, S.AT.applied, 0.4));
    fade(R['ly-tablet'], ramp(t, S.AT.tablet, 0.4), { x: -6 });
    fade(R['ly-phone'], ramp(t, S.AT.phone, 0.4), { x: -6 });
    const on = LAYER_OF[key];
    for (const name of ['heading', 'image', 'button', 'list', 'phone']) css(R[`ly-${name}`], '.on', on === name);

    // Breakpoint frames slide in when added.
    const tab = ramp(t, S.AT.tablet, 0.6, EASE.out);
    const pho = ramp(t, S.AT.phone, 0.6, EASE.out);
    fade(R['t:frame'], tab, { x: -40 });
    fade(R['p:frame'], pho, { x: -40 });

    // Hover states for the editor's own buttons.
    for (const k of ['tb-cms', 'tb-locale', 'tb-preview', 'tb-publish', 'd:add', 't:add', 'insp-replace', 'insp-variant', 'insp-source', 'insp-fx-add', 'cms-done', 'loc-add', 'pub-go', 'pub-visit', 'preview-close', 'asset-vessels', 'variant-pill', 'bpmenu-tablet', 'bpmenu-phone', 'srcmenu-journal', 'fxmenu-scroll', 'loc-fr', 'loc-fr-row', 'cms-row-0', 'cms-row-1', 'cms-row-2', 'tpl-northwind', 'tpl-atelier', 'tpl-use']) {
      css(K[k], '.hover', hovered(k, t));
    }
  }

  function renderOverlays(t) {
    // Template gallery
    const tpl = shown(t, S.OPEN.templates, 0.2, 0.4);
    fade(R['ov-tpl'], tpl);
    css(R['ov-tpl'].firstElementChild, 'transform', `scale(${(0.97 + 0.03 * tpl).toFixed(4)})`);
    const picked = t >= 3.0;
    css(R['tpl-atelier'], '.picked', picked);
    css(R['tpl-use'], '.disabled', !picked);
    css(R['tpl-picked'], 'text', picked ? 'Atelier · Free · Shop, portfolio' : 'Pick a template to start from');

    // CMS
    const cms = shown(t, S.OPEN.cms, 0.3, 0.3);
    fade(R['ov-cms'], cms, { y: 10 });
    for (let i = 0; i < 3; i++) fade(R[`cms-row-${i}`], ramp(t, S.AT.cmsRows + i * 0.28, 0.4, EASE.out), { y: 8 });

    // Menus, before they're placed
    fade(R['menu-assets'], shown(t, S.OPEN.assets), { y: -4, s: 0.02 });
    fade(R['menu-variant'], shown(t, S.OPEN.variant), { y: -4, s: 0.02 });
    fade(R['menu-bp'], Math.max(shown(t, S.OPEN.bpTablet), shown(t, S.OPEN.bpPhone)), { y: -4, s: 0.02 });
    css(R['bpmenu-tablet'], '.disabled', t > S.OPEN.bpTablet[1]);
    fade(R['menu-source'], shown(t, S.OPEN.source), { y: -4, s: 0.02 });
    fade(R['menu-fx'], shown(t, S.OPEN.fx), { y: -4, s: 0.02 });

    // Languages
    fade(R['pop-locale'], shown(t, S.OPEN.locale), { y: -6, s: 0.02 });
    fade(R['loc-list'], shown(t, S.OPEN.languages), { y: -4 });
    fade(R['loc-fr-row'], ramp(t, S.OPEN.languages[1], 0.3), { y: -4 });
    const [ta, tb] = S.AT.translate;
    const done = ramp(t, ta, tb - ta, EASE.linear);
    css(R['loc-bar'], 'transform', `scaleX(${done.toFixed(4)})`);
    css(R['loc-count'], 'text', t >= tb ? '42 strings ✓' : `${Math.round(done * 42)} / 42`);
    css(R['loc-fr-row'], '.done', t >= tb);
    css(R['loc-fr-row'], '.active', t >= S.AT.locale);

    // Publish
    fade(R['pop-publish'], shown(t, S.OPEN.publish), { y: -6, s: 0.02 });
    const steps = S.AT.publishSteps;
    for (let i = 0; i < 3; i++) {
      const busy = t >= steps[i] && t < steps[i + 1];
      css(R[`pub-step-${i}`], '.busy', busy);
      css(R[`pub-step-${i}`], '.done', t >= steps[i + 1]);
      // Even the spinner is a function of time, so a paused frame stays still.
      css(R[`pub-step-${i}`], '--spin', busy ? `${Math.round((t * 420) % 360)}deg` : '0deg');
    }
    const live = t >= steps[3];
    css(R['pub-go'], 'text', t >= steps[0] ? 'Publishing…' : 'Publish');
    // Both buttons keep their place (the cursor aims at them); one shows at a time.
    css(R['pub-go'], '.off', live);
    css(R['pub-visit'], '.off', !live);
    css(R['pub-live'], '.on', live);
    css(R['pub-when'], 'text', live ? 'Published just now' : 'Last published 2 days ago');

    // Preview window and live site
    const pv = shown(t, S.OPEN.preview, 0.4, 0.35);
    fade(R['ov-preview'], pv, { y: 16, s: 0.03 });
    const lv = ramp(t, S.OPEN.live[0], 0.8, EASE.out);
    css(R['ov-live'], 'visibility', lv > 0 ? 'visible' : 'hidden');
    css(R['ov-live'], 'transform', `translateY(${((1 - lv) * 104).toFixed(2)}%)`);
  }

  function renderWorld(t) {
    const inset = layout === 'compact' ? sheetH * sheet : 0;
    let i = S.VIEWS.findLastIndex((v) => v.t - v.dur <= t);
    if (i < 0) i = 0;
    const v = S.VIEWS[i];
    const to = viewFor(fit(v.fit), inset);
    let z = to.z, cx = to.cx, cy = to.cy;
    if (t < v.t && i > 0) {
      const from = viewFor(fit(S.VIEWS[i - 1].fit), inset);
      const p = EASE.inOut((t - (v.t - v.dur)) / v.dur);
      z = Math.exp(lerp(Math.log(from.z), Math.log(to.z), p));
      cx = lerp(from.cx, to.cx, p);
      cy = lerp(from.cy, to.cy, p);
    }
    // Kept exactly as written to the DOM: the next frame measures through it.
    world = { z: round(z, 5), x: round(to.w / 2 - cx * z, 2), y: round((canvasBox.h - inset) / 2 - cy * z, 2) };
    css(R.world, 'transform', `translate(${world.x}px, ${world.y}px) scale(${world.z})`);
    // Frame labels keep their size on screen at any zoom.
    for (const p of ['d', 't', 'p']) {
      const head = R[`${p}:head`];
      css(head, 'width', `${(FRAME_W[p] * z).toFixed(2)}px`);
      css(head, 'transform', `scale(${(1 / z).toFixed(5)})`);
    }
    css(R.zoom, 'text', `${Math.round(z * 100)}%`);
  }

  function renderMarks(t) {
    const sel = activeSelection(t);
    const place = (el, b, v) => {
      fade(el, v);
      css(el, 'left', `${(b.x - canvasBox.x).toFixed(2)}px`);
      css(el, 'top', `${(b.y - canvasBox.y).toFixed(2)}px`);
      css(el, 'width', `${b.w.toFixed(2)}px`);
      css(el, 'height', `${b.h.toFixed(2)}px`);
    };
    if (sel) {
      const [a, , key, name] = sel;
      const el = K[key];
      const b = box(el);
      place(R.sel, b, ramp(t, a, 0.12));
      css(R.sel, '.comp', key.endsWith(':button'));
      css(R['sel-name'], 'text', name);
      const w = worldBox(el);
      css(R['sel-size'], 'text', `${Math.round(w.w)} × ${Math.round(w.h)}`);
    } else {
      fade(R.sel, 0);
    }
    // Hover outline: the canvas element under the resting cursor.
    let hov = null;
    for (const key of ['d:headline', 'd:image', 'd:button', 'd:list', 'd:card-1', 'p:headline']) {
      if (hovered(key, t) && sel?.[2] !== key) hov = key;
    }
    if (hov) place(R.hov, box(K[hov]), 1);
    else fade(R.hov, 0);
    // The CMS item's own page, shown on hover.
    const tip = shown(t, S.AT.cardTip, 0.2, 0.2);
    fade(R['cv-tip'], tip, { y: 4 });
    if (tip > 0) {
      const b = box(K['d:card-1']);
      css(R['cv-tip'], 'left', `${(b.x - canvasBox.x + b.w / 2).toFixed(1)}px`);
      css(R['cv-tip'], 'top', `${(b.y - canvasBox.y - 8).toFixed(1)}px`);
    }
  }

  // Menus open next to what opened them, wherever the layout put it.
  function placeMenus(t) {
    const W = SIZES[layout][0];
    const H = SIZES[layout][1];
    // Placed on every frame, open or not: the cursor aims at their items, and a
    // seek must find them where they'd be at that moment.
    const place = (menu, anchor, side = 'below', align = 'start') => {
      const a = box(anchor);
      const w = menu.offsetWidth;
      const h = menu.offsetHeight;
      let x;
      let y;
      if (side === 'left') {
        // Beside the inspector, level with the button that opened it.
        x = a.x - w - 10;
        y = box(K['insp-replace']).y - h / 2;
      } else if (side === 'above') {
        x = align === 'end' ? a.x + a.w - w : a.x;
        y = a.y - h - 6;
      } else {
        x = align === 'end' ? a.x + a.w - w : a.x;
        y = a.y + a.h + 6;
      }
      x = clamp(x, 8, W - w - 8);
      y = clamp(y, 8, H - h - 8);
      css(menu, 'left', `${x.toFixed(1)}px`);
      css(menu, 'top', `${y.toFixed(1)}px`);
    };
    const compact = layout === 'compact';
    place(R['menu-assets'], compact ? K['insp-replace'] : R.right, compact ? 'above' : 'left', 'end');
    place(R['menu-variant'], K['insp-variant'], compact ? 'above' : 'below', 'end');
    place(R['menu-bp'], t < 34 ? K['d:add'] : K['t:add'], 'below', 'end');
    place(R['menu-source'], K['insp-source'], compact ? 'above' : 'below', 'end');
    place(R['menu-fx'], K['insp-fx-add'], compact ? 'above' : 'below', 'end');
    place(R['pop-locale'], K['tb-locale'], 'below', 'start');
    place(R['pop-publish'], K['tb-publish'], 'below', 'end');
  }

  function renderZoom(t) {
    if (layout === 'compact' || reducedMotion()) {
      cam = { x: 0, y: 0, z: 1 };
    } else {
      const [W, H] = SIZES.full;
      const focus = (key) => {
        if (!key) return null;
        const b = box(K[key]);
        return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      };
      let i = S.ZOOMS.findLastIndex((z) => z.t - z.dur <= t);
      if (i < 0) i = 0;
      const k = S.ZOOMS[i];
      let z = k.z;
      let f = focus(k.at);
      if (t < k.t && i > 0) {
        const prev = S.ZOOMS[i - 1];
        const p = EASE.inOut((t - (k.t - k.dur)) / k.dur);
        z = lerp(prev.z, k.z, p);
        const f0 = focus(prev.at) ?? f;
        const f1 = f ?? f0;
        f = f0 && f1 ? { x: lerp(f0.x, f1.x, p), y: lerp(f0.y, f1.y, p) } : null;
      }
      f ??= { x: W / 2, y: H / 2 };
      cam = { z: round(z, 5), x: round(clamp(W / 2 - f.x * z, W - W * z, 0), 2), y: round(clamp(H / 2 - f.y * z, H - H * z, 0), 2) };
    }
    css(R.cam, 'transform', `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`);
  }

  function cursorAt(t) {
    let i = S.CURSOR.findLastIndex((c) => c.t - c.dur <= t);
    if (i < 0) i = 0;
    const c = S.CURSOR[i];
    const to = point(c.at);
    if (t >= c.t || i === 0) return to;
    const from = point(S.CURSOR[i - 1].at);
    const p = EASE.inOut((t - (c.t - c.dur)) / c.dur);
    // A slight arc, like a hand on a trackpad.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const bow = Math.sin(Math.PI * p) * 0.08;
    return { x: lerp(from.x, to.x, p) - dy * bow, y: lerp(from.y, to.y, p) + dx * bow };
  }

  function renderCursor(t) {
    const at = cursorAt(t);
    const pressed = S.CLICKS.some((c) => t >= c.t && t < c.t + (c.n === 2 ? 0.26 : 0.12)) || S.PRESSES.some(([a, b]) => t >= a && t < b);
    const shape = (t >= 14.5 && t < 18.2) ? 'text' : S.PRESSES.some(([a, b]) => t >= a - 0.1 && t < b + 0.05) ? 'ew' : 'arrow';
    css(R.cursor, 'transform', `translate(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px) scale(${pressed ? 0.86 : 1})`);
    for (const s of ['arrow', 'text', 'ew']) css(R.cursor, `.is-${s}`, s === shape);
    // Click ripples
    const rings = [];
    for (const c of S.CLICKS) {
      for (let k = 0; k < c.n; k++) {
        const start = c.t + k * 0.14;
        if (t >= start && t < start + 0.5) rings.push({ start, c });
      }
    }
    for (let j = 0; j < 2; j++) {
      const el = R[`ripple-${j}`];
      const ring = rings[j];
      if (!ring) {
        css(el, 'opacity', '0');
        continue;
      }
      const p = (t - ring.start) / 0.5;
      const pos = cursorAt(ring.c.t);
      css(el, 'opacity', String(((1 - p) * 0.55).toFixed(3)));
      css(el, 'transform', `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) scale(${(0.35 + EASE.out(p) * 0.9).toFixed(3)})`);
    }
  }

  function resize() {
    const width = host.clientWidth;
    if (!width) return;
    const next = forced() ?? (width < 560 ? 'compact' : 'full');
    if (next !== layout) {
      layout = next;
      root.dataset.layout = layout;
      host.dataset.layout = layout;
    }
    const [W, H] = SIZES[layout];
    scale = width / W;
    css(root, 'width', `${W}px`);
    css(root, 'height', `${H}px`);
    css(root, 'transform', `scale(${scale.toFixed(5)})`);
    host.style.setProperty('--tour-h', `${(H * scale).toFixed(2)}px`);
    if (last >= 0) render(last);
  }

  host.dataset.layout = layout;
  resize();
  return {
    render,
    resize,
    get layout() {
      return layout;
    },
    get time() {
      return last;
    },
    element: root,
  };
}

function esc(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
