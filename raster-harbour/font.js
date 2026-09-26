// The scroller's font: a proportional pixel font drawn for this example, public
// domain like the rest of it. Every glyph sits in an 11-row cell:
//
//   rows 0–1    accents over capitals
//   rows 2–8    capitals and digits; lowercase x-height is rows 4–8
//   rows 9–10   descenders
//
// Accented letters are composed from a base letter and a mark (é is e and ´),
// so the sheets below cover most languages written in Latin letters. Anything
// else, like Cyrillic, CJK or emoji, is drawn by the browser: see gl.js.

export const CELL = 11; // rows in a glyph cell
export const LINE = 12; // line height, in font pixels
export const SPACE = 3; // width of a space; letters are 1 pixel apart
export const BALL = '\uE000'; // a private-use character: the typing indicator's ball

// Sheets: a line of labels, then one row of pixels per line for every glyph,
// starting at the given row of the cell. '#' is ink.
const SHEETS = [
  [2, `
A     B     C     D     E     F     G     H     I   J     K     L     M
.###. ####. .###. ####. ##### ##### .###. #...# ### ....# #...# #.... #...#
#...# #...# #...# #...# #.... #.... #...# #...# .#. ....# #..#. #.... ##.##
#...# #...# #.... #...# #.... #.... #.... #...# .#. ....# #.#.. #.... #.#.#
##### ####. #.... #...# ####. ####. #.### ##### .#. ....# ##... #.... #.#.#
#...# #...# #.... #...# #.... #.... #...# #...# .#. #...# #.#.. #.... #...#
#...# #...# #...# #...# #.... #.... #...# #...# .#. #...# #..#. #.... #...#
#...# ####. .###. ####. ##### #.... .#### #...# ### .###. #...# ##### #...#
`],
  [2, `
N     O     P     Q     R     S     T     U     V     W     X     Y     Z
#...# .###. ####. .###. ####. .###. ##### #...# #...# #...# #...# #...# #####
#...# #...# #...# #...# #...# #...# ..#.. #...# #...# #...# #...# #...# ....#
##..# #...# #...# #...# #...# #.... ..#.. #...# #...# #...# .#.#. .#.#. ...#.
#.#.# #...# ####. #...# ####. .###. ..#.. #...# #...# #.#.# ..#.. ..#.. ..#..
#..## #...# #.... #.#.# #.#.. ....# ..#.. #...# .#.#. #.#.# .#.#. ..#.. .#...
#...# #...# #.... #..#. #..#. #...# ..#.. #...# .#.#. #.#.# #...# ..#.. #....
#...# .###. #.... .##.# #...# .###. ..#.. .###. ..#.. .#.#. #...# ..#.. #####
`],
  [2, `
a     b     c     d     e     f    g     h     i j   k    l  m
..... #.... ..... ....# ..... ..## ..... #.... # ..# #... #. .....
..... #.... ..... ....# ..... .#.. ..... #.... . ... #... #. .....
.###. ####. .###. .#### .###. #### .#### ####. # ..# #..# #. ##.#.
....# #...# #.... #...# #...# .#.. #...# #...# # ..# #.#. #. #.#.#
.#### #...# #.... #...# ##### .#.. #...# #...# # ..# ##.. #. #.#.#
#...# #...# #.... #...# #.... .#.. #...# #...# # ..# #.#. #. #.#.#
.#### ####. .###. .#### .###. .#.. .#### #...# # ..# #..# .# #.#.#
..... ..... ..... ..... ..... .... ....# ..... . ..# .... .. .....
..... ..... ..... ..... ..... .... .###. ..... . ##. .... .. .....
`],
  [2, `
n     o     p     q     r    s     t    u     v     w     x     y     z
..... ..... ..... ..... .... ..... .#.. ..... ..... ..... ..... ..... .....
..... ..... ..... ..... .... ..... .#.. ..... ..... ..... ..... ..... .....
####. .###. ####. .#### #.## .#### #### #...# #...# #...# #...# #...# #####
#...# #...# #...# #...# ##.. #.... .#.. #...# #...# #...# .#.#. #...# ...#.
#...# #...# #...# #...# #... .###. .#.. #...# #...# #.#.# ..#.. #...# ..#..
#...# #...# #...# #...# #... ....# .#.. #...# .#.#. #.#.# .#.#. #...# .#...
#...# .###. ####. .#### #... ####. ..## .#### ..#.. .#.#. #...# .#### #####
..... ..... #.... ....# .... ..... .... ..... ..... ..... ..... ....# .....
..... ..... #.... ....# .... ..... .... ..... ..... ..... ..... .###. .....
`],
  [2, `
0     1     2     3     4     5     6     7     8     9
.###. ..#.. .###. .###. ...#. ##### ..##. ##### .###. .###.
#...# .##.. #...# #...# ..##. #.... .#... ....# #...# #...#
#...# ..#.. ....# ....# .#.#. ####. #.... ...#. #...# #...#
#.#.# ..#.. ...#. ..##. #..#. ....# ####. ..#.. .###. .####
#...# ..#.. ..#.. ....# ##### ....# #...# .#... #...# ....#
#...# ..#.. .#... #...# ...#. #...# #...# .#... #...# ...#.
.###. .###. ##### .###. ...#. .###. .###. .#... .###. .##..
`],
  [2, `
!  "   #     $     %     &     '  (  )  *     +     ,  -    .  /
#  #.# .#.#. ..#.. ##..# .##.. #  .# #. ..... ..... .. .... . ....#
#  #.# .#.#. .#### ##.#. #..#. #  #. .# ..#.. ..... .. .... . ...#.
#  ... ##### #.#.. ...#. #.#.. .  #. .# #.#.# ..#.. .. .... . ...#.
#  ... .#.#. .###. ..#.. .#... .  #. .# .###. ..#.. .. .... . ..#..
#  ... ##### ..#.# .#... #.#.# .  #. .# #.#.# ##### .. #### . .#...
.  ... .#.#. ####. .#.## #..#. .  #. .# ..#.. ..#.. .. .... . .#...
#  ... .#.#. ..#.. #..## .##.# .  #. .# ..... ..#.. .# .... # #....
.  ... ..... ..... ..... ..... .  #. .# ..... ..... #. .... . .....
.  ... ..... ..... ..... ..... .  .# #. ..... ..... .. .... . .....
`],
  [2, `
:  ;  <    =    >    ?     @     [  \\     ]  ^     _     \`  {   |  }   ~
.  .. .... .... .... .###. .###. ## #.... ## ..#.. ..... #. ..# # #.. .....
.  .. .... .... .... #...# #...# #. .#... .# .#.#. ..... .# .#. # .#. .....
.  .. ...# .... #... ....# #.### #. .#... .# #...# ..... .. .#. # .#. .##.#
#  .# .##. #### .##. ..##. #.#.# #. ..#.. .# ..... ..... .. #.. # ..# #..#.
.  .. #... .... ...# ..#.. #.### #. ...#. .# ..... ..... .. .#. # .#. .....
.  .. .##. #### .##. ..... #.... #. ...#. .# ..... ..... .. .#. # .#. .....
#  .# ...# .... #... ..#.. .###. #. ....# .# ..... ..... .. ..# # #.. .....
.  #. .... .... .... ..... ..... #. ..... .# ..... ##### .. ... # ... .....
.  .. .... .... .... ..... ..... ## ..... ## ..... ..... .. ... # ... .....
`],
  [2, `
…     –     —       ·  •   €     £     °   ×   →       ←       ↑     ↓     ♪     ♥       ✦       «     »     ¡ ¿
..... ..... ....... . ... ..### ..##. .#. ... ....... ....... ..#.. ..#.. ..#.. ....... ...#... ..... ..... . .....
..... ..... ....... . ... .#... .#..# #.# ... ....... ....... .###. ..#.. ..##. .##.##. ...#... ..... ..... . .....
..... ..... ....... . ... ####. .#... .#. #.# ....#.. ..#.... #.#.# ..#.. ..#.# ####### ..###.. ..... ..... # ..#..
..... ..... ....... . .#. .#... ###.. ... .#. .....#. .#..... ..#.. ..#.. ..#.. ####### ####### .#.#. #.#.. . .....
..... ##### ####### # ### ####. .#... ... #.# ####### ####### ..#.. #.#.# .##.. .#####. ..###.. #.#.. .#.#. # ..#..
..... ..... ....... . .#. .#... .#... ... ... .....#. .#..... ..#.. .###. ###.. ..###.. ...#... .#.#. #.#.. # .##..
#.#.# ..... ....... . ... ..### ##### ... ... ....#.. ..#.... ..#.. ..#.. .#... ...#... ...#... ..... ..... # #....
..... ..... ....... . ... ..... ..... ... ... ....... ....... ..... ..... ..... ....... ....... ..... ..... # #...#
..... ..... ....... . ... ..... ..... ... ... ....... ....... ..... ..... ..... ....... ....... ..... ..... # .###.
`],
  [2, `
ß     æ       Æ       ø     Ø     œ       Œ       ð     Ð      þ     Þ     ı ȷ   ł   Ł
.###. ....... .###### ..... .###. ....... .###### .#.#. .####. #.... #.... . ... .#. .#...
#...# ....... #..#... ..... #..## ....... #..#... ..#.. .#...# #.... ####. . ... .#. .#...
#..#. .##.##. #..#... .###. #..## .##.##. #..#... .#.#. .#...# ####. #...# # ..# .## .#.#.
#.##. ...#..# #####.. #..## #.#.# #..#..# #..###. ....# ###..# #...# #...# # ..# ##. .##..
#...# .###### #..#... #.#.# #.#.# #..#### #..#... .#### .#...# #...# ####. # ..# .#. ##...
#...# #..#... #..#... ##..# ##..# #..#... #..#... #...# .#...# #...# #.... # ..# .#. .#...
#.##. .##.### #..#### .###. .###. .##.### .###### .###. .####. ####. #.... # ..# ..# .####
..... ....... ....... ..... ..... ....... ....... ..... ...... #.... ..... . ..# ... .....
..... ....... ....... ..... ..... ....... ....... ..... ...... #.... ..... . ##. ... .....
`],
];

// Hand-drawn bold for letters whose strokes would run together when smeared.
const BOLD_SHEETS = [
  [2, `
M       N       W       m        w       0      O
##...## ##...## ##...## ........ ....... .####. .####.
###.### ###..## ##...## ........ ....... ##..## ##..##
##.#.## ####.## ##...## #######. ##...## ##..## ##..##
##.#.## ##.#### ##.#.## ##.##.## ##...## ##..## ##..##
##...## ##..### ##.#.## ##.##.## ##.#.## ##..## ##..##
##...## ##...## ###.### ##.##.## ##.#.## ##..## ##..##
##...## ##...## ##...## ##.##.## .##.##. .####. .####.
`],
];

// Same shapes as other characters.
const ALIASES = {
  '’': "'", '‘': "'", '‚': ',', '′': "'", '“': '"', '”': '"', '„': '"', '″': '"',
  '‐': '-', '‑': '-', '−': '-', '‒': '–', '\u00A0': ' ', '\u2009': ' ', '\u202F': ' ',
  '✧': '✦', '★': '✦', '☆': '✦', '⋆': '✦', '∗': '*', '✱': '*', '❤': '♥', '♡': '♥', '♫': '♪',
  '⇒': '→', '➜': '→', '➔': '→', '▸': '→', '▶': '→', '⇐': '←', '◂': '←', '◀': '←', '▲': '↑', '▼': '↓',
  '‹': '<', '›': '>', '∙': '·', '⋅': '·', '◦': '•', '●': '•', '▪': '•', '✕': '×', '✖': '×',
};

// Combining marks, as [upper row, lower row]. Above capitals they take rows 0–1
// (cap: a shape that keeps clear of the letter), above lowercase rows 1–2,
// leaving a row of air (hug: rows 2–3); below the letter, rows 9–10.
const MARKS = {
  '\u0300': { rows: ['#.', '.#'] }, // grave
  '\u0301': { rows: ['.#', '#.'] }, // acute
  '\u0302': { rows: ['.#.', '#.#'] }, // circumflex
  '\u0303': { rows: ['.#.#', '#.#.'] }, // tilde
  '\u0304': { rows: ['....', '####'], cap: ['####', '....'] }, // macron
  '\u0306': { rows: ['#..#', '.##.'] }, // breve
  '\u0307': { rows: ['.', '#'], cap: ['#', '.'] }, // dot above
  '\u0308': { rows: ['...', '#.#'], cap: ['#.#', '...'] }, // diaeresis
  '\u030A': { rows: ['.#.', '#.#'], hug: true }, // ring above, closed by the letter's top
  '\u030B': { rows: ['.#.#', '#.#.'] }, // double acute
  '\u030C': { rows: ['#.#', '.#.'] }, // caron
  '\u0326': { rows: ['.#', '#.'], below: true }, // comma below
  '\u0327': { rows: ['.#', '##'], below: true }, // cedilla
  '\u0328': { rows: ['#.', '.#'], below: true, right: true }, // ogonek
};

const rowBits = (token) => [...token].reduce((bits, c, x) => (c === '#' ? bits | (1 << x) : bits), 0);

function parse(top, sheet, into) {
  const lines = sheet.split('\n').filter((line) => line.trim());
  const labels = lines[0].trim().split(/\s+/);
  const rows = lines.slice(1).map((line) => line.trim().split(/\s+/));
  labels.forEach((label, i) => {
    const w = rows[0][i]?.length ?? 0;
    const bits = new Array(CELL).fill(0);
    rows.forEach((row, r) => {
      if (row[i]?.length !== w) throw new Error(`font.js: glyph ${label} has a row that isn't ${w} wide`);
      bits[top + r] = rowBits(row[i]);
    });
    into.set(label, { w, bits });
  });
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

// Splits text into what a reader sees as characters: 👋🏻 and é stay whole.
export function graphemes(text) {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

export class PixelFont {
  #glyphs = new Map();
  #bold = new Map();
  #cache = new Map();

  constructor() {
    for (const [top, sheet] of SHEETS) parse(top, sheet, this.#glyphs);
    for (const [top, sheet] of BOLD_SHEETS) parse(top, sheet, this.#bold);
    this.#glyphs.set(' ', { w: SPACE, bits: new Array(CELL).fill(0) });
    // A ball for the typing indicator and bullets drawn as sprites.
    this.#glyphs.set(BALL, { w: 5, bits: [0, 0, 0, 0, 0, 0b01110, 0b11111, 0b11111, 0b11111, 0b01110, 0] });
  }

  // The glyph for a grapheme, or null when the browser has to draw it.
  get(cluster) {
    if (this.#cache.has(cluster)) return this.#cache.get(cluster);
    const glyph = this.#compose(cluster);
    this.#cache.set(cluster, glyph);
    return glyph;
  }

  #compose(cluster) {
    const direct = this.#glyphs.get(ALIASES[cluster] ?? cluster);
    if (direct) return direct;
    const [base, ...marks] = [...cluster.normalize('NFD')];
    if (!marks.length || marks.some((m) => !MARKS[m])) return null;
    const above = marks.some((m) => !MARKS[m].below);
    const glyph = this.#glyphs.get(above && base === 'i' ? 'ı' : above && base === 'j' ? 'ȷ' : base);
    if (!glyph) return null;
    // Capitals and letters with ascenders take their accents higher.
    const tall = glyph.bits[2] || glyph.bits[3];
    let w = glyph.w;
    for (const m of marks) w = Math.max(w, MARKS[m].rows[0].length);
    const bits = new Array(CELL).fill(0);
    const baseX = (w - glyph.w) >> 1;
    glyph.bits.forEach((row, y) => (bits[y] = row << baseX));
    for (const m of marks) {
      const mark = MARKS[m];
      const mw = mark.rows[0].length;
      const x = mark.right ? baseX + glyph.w - mw : (w - mw) >> 1;
      const y = mark.below ? 9 : tall ? 0 : mark.hug ? 2 : 1;
      (tall && mark.cap ? mark.cap : mark.rows).forEach((token, r) => (bits[y + r] |= rowBits(token) << x));
    }
    return { w, bits };
  }

  // Bold for the scroller: every pixel doubled to the right, the Amiga way,
  // or a hand-drawn letter where that would fill it in.
  bold(glyph, cluster) {
    const drawn = this.#bold.get(ALIASES[cluster] ?? cluster);
    if (drawn) return drawn;
    return { w: glyph.w + 1, bits: glyph.bits.map((row) => row | (row << 1)) };
  }
}

// Breaks runs of text into lines no wider than maxWidth font pixels.
// runs: [{ text, ...style }]. measure(cluster) gives a grapheme's advance.
// Returns [{ width, glyphs: [{ ch, x, advance, run, index }] }]: x in font
// pixels, index the grapheme's position in the whole text.
export function wrap(runs, maxWidth, measure) {
  const lines = [];
  let line = { width: 0, glyphs: [] };
  let word = []; // glyphs of the word being collected
  let wordWidth = 0;
  const push = () => {
    lines.push(line);
    line = { width: 0, glyphs: [] };
  };
  const place = (glyph) => {
    glyph.x = line.width;
    line.glyphs.push(glyph);
    line.width += glyph.advance;
  };
  const flushWord = () => {
    if (!word.length) return;
    if (line.width && line.width + wordWidth - 1 > maxWidth) {
      // Drop the space the line ended on, then start a new line.
      while (line.glyphs.length && line.glyphs.at(-1).ch === ' ') line.width -= line.glyphs.pop().advance;
      push();
    }
    for (const glyph of word) {
      // A word wider than a line (a long URL) breaks anywhere.
      if (line.width && line.width + glyph.advance - 1 > maxWidth) push();
      place(glyph);
    }
    word = [];
    wordWidth = 0;
  };
  let index = 0;
  for (const run of runs) {
    for (const ch of graphemes(run.text)) {
      index++;
      if (ch === '\n') {
        flushWord();
        push();
        continue;
      }
      const glyph = { ch, x: 0, advance: measure(ch), run, index: index - 1 };
      if (ch === ' ' || ch === '\t') {
        flushWord();
        if (line.width) place({ ...glyph, ch: ' ' });
      } else {
        word.push(glyph);
        wordWidth += glyph.advance;
        // Break opportunities inside words: after a hyphen or a slash.
        if (ch === '-' || ch === '/') flushWord();
      }
    }
  }
  flushWord();
  if (line.glyphs.length || !lines.length) push();
  for (const l of lines) {
    while (l.glyphs.length && l.glyphs.at(-1).ch === ' ') l.width -= l.glyphs.pop().advance;
    l.width = Math.max(0, l.width - 1); // no letter spacing after the last glyph
  }
  return lines;
}
