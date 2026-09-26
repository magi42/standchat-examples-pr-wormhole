// The tour's script: what happens when, in seconds. tour.js turns it into
// pixels with render(t), a pure function of time, so any moment can be shown
// instantly. The chapters and moments also go into the Stand-in's prompt, which
// is how it can answer about what's on screen and point back to a time.

export const DURATION = 110;
export const POSTER = 40.5; // First frame, and ~5 s later the social image: a phone-only edit.

export const CHAPTERS = [
  { id: 'templates', name: 'Templates', start: 0 },
  { id: 'canvas', name: 'Canvas', start: 13 },
  { id: 'breakpoints', name: 'Breakpoints', start: 31 },
  { id: 'cms', name: 'CMS', start: 48 },
  { id: 'effects', name: 'Effects', start: 64 },
  { id: 'localization', name: 'Localization', start: 80 },
  { id: 'publish', name: 'Publish', start: 94 },
];

// What's on screen, in windows of a few seconds. `label` names the moment in
// the question's context chip and in the prompt; `caption` narrates it.
export const MOMENTS = [
  { t: 0, label: 'picking a template', caption: 'Start from a template. Each one is a complete, responsive site.' },
  { t: 6, label: 'template opens', caption: 'It opens on the canvas, ready to make your own.' },
  { t: 13, label: 'typing the headline', caption: 'Click any text on the canvas and type. The canvas is the site.' },
  { t: 19, label: 'swapping the hero image', caption: 'Swap an image straight from your assets.' },
  { t: 24, label: 'switching the button variant', caption: 'Buttons are components: switch a variant and every instance follows.' },
  { t: 31, label: 'adding tablet', caption: 'Add a tablet breakpoint from the frame’s + menu.' },
  { t: 36, label: 'adding phone: 3 frames side by side', caption: 'Add phone too. All three layouts sit side by side.' },
  { t: 39, label: 'phone-only headline size', caption: 'Breakpoints follow desktop until you override them, like this smaller headline on phone.' },
  { t: 48, label: 'the Journal collection', caption: 'Content lives in CMS collections, like the studio’s Journal.' },
  { t: 54, label: 'list connected, cards fill in', caption: 'Connect a list to a collection, and the cards fill themselves in.' },
  { t: 64, label: 'adding a scroll effect', caption: 'Add a scroll effect from the Effects panel. No timeline to wire up.' },
  { t: 70, label: 'preview: image drifts on scroll', caption: 'Preview it right away: the image drifts as the page scrolls.' },
  { t: 80, label: 'adding French', caption: 'Add a language, and every string is translated for you to review.' },
  { t: 86, label: 'page in French', caption: 'The whole page in French, on its own /fr address.' },
  { t: 94, label: 'publishing to loam.studio', caption: 'Publish to your own domain. It’s live in seconds.' },
  { t: 100, label: 'live site', caption: 'The live site: SSL, a global CDN, and nothing to maintain.' },
];

/** 42 → "0:42" */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function chapterAt(t) {
  return CHAPTERS.findLast((c) => c.start <= t) ?? CHAPTERS[0];
}

export function momentAt(t) {
  return MOMENTS.findLast((m) => m.t <= t) ?? MOMENTS[0];
}

// The studio's site, in the template's words and then its own, in two languages.
export const TEMPLATE_HEADLINE = 'Your studio, beautifully online.';
export const COPY = {
  en: {
    nav1: 'Shop', nav2: 'Journal', nav3: 'Studio', nav4: 'Visit', lang: 'EN', bag: 'Bag (0)',
    eyebrow: 'Ceramics studio · Since 2019',
    headline: 'Stoneware for slow mornings.',
    lede: 'Cups, bowls and vases, thrown and glazed by hand in small batches.',
    cta: 'Shop the collection', link: 'Visit the studio →',
    jtitle: 'From the studio', jall: 'All posts →',
    t1: 'Twelve glazes, one kiln', d1: 'Mar 12',
    t2: 'Notes from a wood firing', d2: 'Feb 26',
    t3: 'Why we trim by hand', d3: 'Feb 3',
    foot: 'Open Thursday to Sunday, 10–6', news: 'Kiln notes, once a month',
  },
  fr: {
    nav1: 'Boutique', nav2: 'Journal', nav3: 'Atelier', nav4: 'Visite', lang: 'FR', bag: 'Panier (0)',
    eyebrow: 'Atelier de céramique · Depuis 2019',
    headline: 'Du grès pour les matins lents.',
    lede: 'Tasses, bols et vases, tournés et émaillés à la main, en petites séries.',
    cta: 'Voir la collection', link: 'Visiter l’atelier →',
    jtitle: 'Nouvelles de l’atelier', jall: 'Tous les articles →',
    t1: 'Douze émaux, un seul four', d1: '12 mars',
    t2: 'Carnet d’une cuisson au bois', d2: '26 févr.',
    t3: 'Pourquoi tournasser à la main', d3: '3 févr.',
    foot: 'Ouvert du jeudi au dimanche, 10 h–18 h', news: 'Nouvelles du four, une fois par mois',
  },
};

// The cursor: where it arrives, when, and how long the move takes. A target is
// an element's data-k, optionally with a point inside it ("key@0.5,0.2").
export const CURSOR = [];
export const CLICKS = []; // { t, n: 1 | 2 }
export const PRESSES = []; // [down, up]: dragging a number field
const go = (t, at, dur = 0.8) => CURSOR.push({ t, at, dur });
const click = (t, n = 1) => CLICKS.push({ t, n });
const press = (down, up) => PRESSES.push([down, up]);

// Templates
go(0, 'tpl-grid@0.64,1.1', 0);
go(1.6, 'tpl-northwind@0.5,0.4', 1.1);
go(2.7, 'tpl-atelier@0.52,0.42', 0.8);
click(3.0);
go(4.4, 'tpl-use', 1.0);
click(4.7);
go(7.9, 'canvas@0.62,0.66', 1.5);
// Canvas
go(13.6, 'd:headline@0.46,0.5', 0.9);
click(14.0);
click(14.75, 2);
go(18.6, 'canvas@0.9,0.2', 0.45);
click(18.8);
go(19.8, 'd:image@0.5,0.44', 0.9);
click(20.0);
go(21.0, 'insp-replace', 0.85);
click(21.2);
go(22.05, 'asset-vessels', 0.65);
click(22.3);
go(24.6, 'd:button@0.5,0.5', 1.1);
click(24.8);
go(25.8, 'insp-variant', 0.85);
click(26.0);
go(26.8, 'variant-pill', 0.55);
click(27.0);
go(28.8, 'canvas@0.74,0.84', 1.2);
// Breakpoints
go(32.0, 'd:add', 1.1);
click(32.2);
go(32.85, 'bpmenu-tablet', 0.5);
click(33.0);
go(35.2, 't:add', 1.1);
click(35.4);
go(36.0, 'bpmenu-phone', 0.45);
click(36.2);
go(39.4, 'p:headline@0.5,0.5', 1.2);
click(39.6);
go(40.6, 'insp-size@0.78,0.5', 0.85);
press(40.75, 41.7);
go(41.6, 'insp-size@0.22,0.5', 0.8);
go(43.0, 'canvas@0.58,0.93', 1.2);
// CMS
go(48.9, 'tb-cms', 1.0);
click(49.1);
go(50.7, 'cms-row-0@0.3,0.5', 1.0);
go(51.5, 'cms-row-1@0.3,0.5', 0.6);
go(52.2, 'cms-row-2@0.3,0.5', 0.5);
go(53.4, 'cms-done', 0.9);
click(53.6);
go(54.9, 'd:list@0.5,0.5', 1.0);
click(55.1);
go(56.0, 'insp-source', 0.8);
click(56.2);
go(56.8, 'srcmenu-journal', 0.5);
click(57.0);
go(59.0, 'd:card-1@0.5,0.42', 1.3);
go(62.5, 'canvas@0.88,0.9', 1.2);
// Effects
go(65.0, 'd:image@0.5,0.42', 1.0);
click(65.2);
go(66.1, 'insp-fx-add', 0.8);
click(66.3);
go(66.9, 'fxmenu-scroll', 0.5);
click(67.1);
go(68.0, 'insp-fx-y@0.8,0.5', 0.8);
press(68.15, 69.1);
go(69.0, 'insp-fx-y@0.25,0.5', 0.75);
go(70.0, 'tb-preview', 0.8);
click(70.2);
go(71.3, 'preview@0.56,0.62', 0.9);
go(77.1, 'preview-close', 0.9);
click(77.3);
go(78.8, 'canvas@0.6,0.82', 1.1);
// Localization
go(80.8, 'tb-locale', 1.0);
click(81.0);
go(81.8, 'loc-add', 0.7);
click(82.0);
go(82.6, 'loc-fr', 0.45);
click(82.8);
go(85.5, 'loc-fr-row@0.35,0.5', 0.7);
click(85.7);
go(86.7, 'canvas@0.5,0.26', 0.8);
click(86.9);
go(88.8, 'd:headline@0.62,0.62', 1.4);
// Publish
go(94.9, 'tb-publish', 1.1);
click(95.1);
go(95.9, 'pub-go', 0.6);
click(96.1);
go(99.9, 'pub-visit', 0.8);
click(100.1);
go(101.8, 'live@0.56,0.64', 1.0);
go(107.6, 'l:card-1@0.5,0.45', 1.4);

// Things on the canvas that get selected: [from, to, element, layer name].
export const SELECTIONS = [
  [14.0, 18.8, 'd:headline', 'Heading'],
  [20.0, 23.9, 'd:image', 'Image'],
  [24.8, 30.6, 'd:button', 'Button'],
  [39.6, 47.6, 'p:headline', 'Heading'],
  [55.1, 61.8, 'd:list', 'Journal list'],
  [65.2, 78.9, 'd:image', 'Image'],
];

// Open windows, menus and popovers: [opens, closes].
export const OPEN = {
  templates: [-1, 4.8],
  assets: [21.2, 22.35],
  variant: [26.0, 27.05],
  bpTablet: [32.2, 33.0],
  bpPhone: [35.4, 36.2],
  cms: [49.2, 53.6],
  source: [56.2, 57.0],
  fx: [66.3, 67.1],
  preview: [70.3, 77.3],
  locale: [81.0, 86.9],
  languages: [82.0, 82.8],
  publish: [95.1, 100.1],
  live: [100.25, 999],
};

// One-off changes.
export const AT = {
  applied: 5.1, // the template fills the page
  edit: [14.75, 18.8], // editing the headline's text
  selectAll: [14.9, 15.3],
  typing: [15.3, 18.1],
  image: 22.3, // arch → vessels
  variant: 27.0, // Primary → Pill
  tablet: 33.05,
  phone: 36.25,
  phoneSize: [40.8, 41.6], // 44 → 36
  cmsRows: 49.6,
  connect: 57.05,
  cardTip: [59.0, 61.5],
  fxAdded: 67.1,
  fxDrag: [68.25, 69.0], // offset 0 → −120
  translate: [82.9, 85.2], // 0 → 42 strings
  locale: 85.9, // English → French
  publishSteps: [96.2, 97.2, 98.2, 99.1], // three steps, then live
};

// Where the canvas looks, and the moment it gets there: { t, fit, dur }.
export const VIEWS = [
  { t: 0, fit: 'page-top', dur: 0 },
  { t: 12.8, fit: 'hero-text', dur: 3.2 },
  { t: 19.9, fit: 'hero', dur: 1.0 },
  { t: 31.8, fit: 'page-top', dur: 1.0 },
  { t: 34.4, fit: 'desktop-tablet', dur: 1.3 },
  { t: 37.5, fit: 'all-frames', dur: 1.2 },
  { t: 39.3, fit: 'tablet-phone', dur: 1.3 },
  { t: 54.4, fit: 'journal', dur: 1.1 },
  { t: 63.6, fit: 'page', dur: 2.4 },
  { t: 65.1, fit: 'hero', dur: 1.2 },
  { t: 87.4, fit: 'hero', dur: 0.1 },
  { t: 92.6, fit: 'journal', dur: 3.0 },
  { t: 95.4, fit: 'page-top', dur: 1.6 },
];

// Screen-recording zooms on the whole editor (skipped on phones and with reduced motion).
export const ZOOMS = [
  { t: 0, z: 1, at: null, dur: 0 },
  { t: 15.1, z: 1.34, at: 'd:headline', dur: 0.8 },
  { t: 19.2, z: 1, at: null, dur: 0.8 },
  { t: 83.4, z: 1.3, at: 'pop-locale', dur: 0.7 },
  { t: 86.0, z: 1, at: null, dur: 0.7 },
  { t: 96.9, z: 1.26, at: 'pop-publish', dur: 0.7 },
  { t: 100.2, z: 1, at: null, dur: 0.5 },
];

// Scroll positions (site pixels) in the preview and on the live site.
export const PREVIEW_SCROLL = [[71.2, 0], [75.0, 760], [75.7, 760], [76.9, 180]];
export const LIVE_SCROLL = [[101.9, 0], [106.4, 820], [110, 820]];
