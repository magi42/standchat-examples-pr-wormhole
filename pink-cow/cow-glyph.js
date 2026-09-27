// The question mark and the "?" spot icon, shared by the 3D cow's hatch and
// the chat card's header. No three.js here, so the chat can load without it.

export const SPOT_COLOR = '#c92f69';
export const GLYPH_COLOR = '#fff5f8';

/** A faceted question mark in a unit box, y up, centred on x = 0. */
export function questionMarkOutline() {
  const hook = [];
  const centreY = 0.68;
  const outer = 0.29;
  const inner = 0.13;
  const start = (170 * Math.PI) / 180;
  const end = (-40 * Math.PI) / 180;
  const steps = 7;
  for (let i = 0; i <= steps; i += 1) {
    const angle = start + ((end - start) * i) / steps;
    hook.push([Math.cos(angle) * outer, centreY + Math.sin(angle) * outer]);
  }
  hook.push([0.08, 0.37], [0.08, 0.265], [-0.08, 0.265], [-0.08, 0.41]);
  for (let i = steps; i >= 0; i -= 1) {
    const angle = start + ((end - start) * i) / steps;
    hook.push([Math.cos(angle) * inner, centreY + Math.sin(angle) * inner]);
  }
  const dot = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    dot.push([Math.cos(angle) * 0.09, 0.105 + Math.sin(angle) * 0.09]);
  }
  return { hook, dot };
}

/** The small "?" spot icon, as the chat card draws it: a blob in a unit-wide box, y down. */
const SPOT_ICON_BLOB = [
  [0.1, 0.35], [0.24, 0.1], [0.55, 0.04], [0.84, 0.14], [0.97, 0.42],
  [0.9, 0.74], [0.66, 0.94], [0.34, 0.95], [0.1, 0.78], [0.02, 0.55],
];
export const SPOT_ICON_ASPECT = 0.82;

/** Polygons for the spot icon at `size` pixels wide, offset by (x, y). */
export function spotIconPolygons(x, y, size) {
  const height = size * SPOT_ICON_ASPECT;
  const blob = SPOT_ICON_BLOB.map(([bx, by]) => [x + bx * size, y + by * height]);
  const { hook, dot } = questionMarkOutline();
  const glyphHeight = size * 0.62;
  const map = ([gx, gy]) => [x + size * 0.5 + gx * glyphHeight, y + height * 0.9 - gy * glyphHeight];
  return { blob, glyph: [hook.map(map), dot.map(map)] };
}
