// The film's structure, shared by the score (score.js), the pictures
// (projector.js and the scenes) and the director (film.js). The music is the
// clock: every section is a number of bars at a tempo, and every cut, title and
// year on screen lands on one of its beats.
//
// A section plays once and moves on to `next`, unless it loops. A looping
// section is a moment where the film waits for the viewer: it repeats its
// phrase until the director queues the next section, and the change happens at
// the end of a phrase, so the music never stops mid-thought.

export const SECTIONS = {
  // Hand stencils in firelight, a slow flame, the title.
  overture: { bpm: 60, bars: 12, beatsPerBar: 4, scene: 'titles', next: 'name', cuts: [0, 4, 8], dissolve: 2 },
  // Stand asks the viewer's name. Waits.
  name: { bpm: 60, bars: 2, beatsPerBar: 4, scene: 'void', loop: true, cuts: [0] },
  // 20,000 years ago: the ice.
  ice: { bpm: 60, bars: 8, beatsPerBar: 4, scene: 'ice', next: 'holocene', cuts: [0, 3, 6], dissolve: 2 },
  // 11,700 years ago: the ice retreats, the long stable warm age begins.
  holocene: { bpm: 84, bars: 12, beatsPerBar: 4, scene: 'holocene', next: 'fields', cuts: [0, 4, 8, 10], dissolve: 1 },
  // 8000 BCE: the first fields. Choice 1. Waits.
  fields: { bpm: 84, bars: 2, beatsPerBar: 4, scene: 'fields', loop: true, cuts: [0] },
  // 8000 BCE to 1700 CE: seas, forests, towns.
  ages: { bpm: 84, bars: 8, beatsPerBar: 4, scene: 'ages', next: 'steam', cuts: [0, 2, 4, 6], dissolve: 1 },
  // 1712 to 1900: coal and steam.
  steam: { bpm: 108, bars: 12, beatsPerBar: 4, scene: 'steam', next: 'coal', cuts: [0, 2, 4, 6, 8, 10] },
  // The furnace. Choice 2. Waits.
  coal: { bpm: 108, bars: 2, beatsPerBar: 4, scene: 'coal', loop: true, cuts: [0] },
  // 1900 to 1950: oil.
  oil: { bpm: 96, bars: 12, beatsPerBar: 4, scene: 'oil', next: 'grid', cuts: [0, 2, 4, 6, 8, 10] },
  // 1950 to 1979: the great acceleration. Tempo rises bar by bar, cuts get faster.
  grid: { bpm: 120, bpmEnd: 168, bars: 24, beatsPerBar: 4, scene: 'grid', next: 'sun', cuts: 'grid' },
  // 1979: the oil crisis, and solar panels on the White House. Choice 3. Waits.
  sun: { bpm: 80, bars: 2, beatsPerBar: 4, scene: 'sun', loop: true, cuts: [0] },
  // 1979 to 1988: the sun or the oil, as the viewer chose.
  turn: { bpm: 100, bars: 8, beatsPerBar: 4, scene: 'turn', next: 'warning', cuts: [0, 2, 4, 6], dissolve: 1 },
  // 1988: the warning. A hush. Choice 4. Waits.
  warning: { bpm: 72, bars: 2, beatsPerBar: 4, scene: 'warning', loop: true, cuts: [0] },
  // 1988 to 2026: heat, fire, melt, flood.
  heat: { bpm: 132, bars: 16, beatsPerBar: 4, scene: 'heat', next: 'now', cuts: [0, 2, 4, 6, 8, 10, 12, 14] },
  // 2026: now. The viewer holds to pull the projected 2100 down.
  now: { bpm: 72, bars: 12, beatsPerBar: 4, scene: 'now', next: 'future', cuts: [0] },
  // 2026 to 2100: one possible future, from the viewer's choices.
  future: { bpm: 72, bars: 12, beatsPerBar: 4, scene: 'future', next: 'epilogue', cuts: [0, 4, 8], dissolve: 2 },
  // The definition card and the narrator's last line.
  epilogue: { bpm: 60, bars: 8, beatsPerBar: 4, scene: 'epilogue', next: 'coda', cuts: [0] },
  // After the last line: an invitation to talk, over the dusk. Waits.
  coda: { bpm: 60, bars: 2, beatsPerBar: 4, scene: 'epilogue', loop: true, cuts: [0] },
  // End credits.
  credits: { bpm: 60, bars: 16, beatsPerBar: 4, scene: 'credits', next: null, cuts: [0] },
};

export const ORDER = Object.keys(SECTIONS);

// Tempo of a bar. Only `grid` changes tempo, one step per bar.
export function bpmAt(name, bar) {
  const s = SECTIONS[name];
  if (!s.bpmEnd) return s.bpm;
  const k = Math.min(1, Math.max(0, bar / Math.max(1, s.bars - 1)));
  return s.bpm + (s.bpmEnd - s.bpm) * k;
}

// Length of one bar of a section, in seconds.
export function barSeconds(name, bar) {
  return (60 / bpmAt(name, bar)) * SECTIONS[name].beatsPerBar;
}

// Which shot plays at a beat position (beats since the section started).
// Returns { shot, start } where start is the beat the shot began on.
export function shotAt(name, beat) {
  const s = SECTIONS[name];
  const perBar = s.beatsPerBar;
  if (s.cuts === 'grid') {
    // Bars 0–7: a cut every 2 bars. 8–15: every bar. 16–23: every 2 beats.
    // Never faster than every 2 beats (under 3 cuts a second at 168 bpm).
    const bar = Math.floor(beat / perBar);
    if (bar < 8) return { shot: Math.floor(bar / 2), start: Math.floor(bar / 2) * 2 * perBar };
    if (bar < 16) return { shot: 4 + (bar - 8), start: bar * perBar };
    const half = Math.floor((beat - 16 * perBar) / 2);
    return { shot: 12 + half, start: 16 * perBar + half * 2 };
  }
  const bar = Math.floor(beat / perBar);
  let i = 0;
  for (let k = 0; k < s.cuts.length; k++) if (s.cuts[k] <= bar) i = k;
  return { shot: i, start: s.cuts[i] * perBar };
}

// History on screen. CO2 from ice cores (before 1958) and Mauna Loa, in ppm.
// Temperature from 1850, the change against 1850–1900, in °C (HadCRUT5,
// Berkeley Earth, Copernicus). Before 1850 the film shows no temperature.
export const CO2 = [
  [-18000, 190], [-9700, 255], [-8000, 260], [-3000, 268], [1000, 280], [1712, 277],
  [1850, 285], [1900, 296], [1950, 311], [1988, 351], [2000, 369], [2010, 389],
  [2020, 413], [2026, 430],
];
export const TEMP = [
  [1850, 0], [1900, 0], [1950, 0.1], [1988, 0.5], [2000, 0.6], [2010, 0.8],
  [2016, 1.1], [2020, 1.2], [2023, 1.45], [2024, 1.55], [2026, 1.5],
];

// The years each section spans on screen. Loops hold a single year.
export const YEARS = {
  ice: [-18000, -9700],
  holocene: [-9700, -8000],
  fields: [-8000, -8000],
  ages: [-8000, 1712],
  steam: [1712, 1900],
  coal: [1900, 1900],
  oil: [1900, 1950],
  grid: [1950, 1979],
  sun: [1979, 1979],
  turn: [1979, 1988],
  warning: [1988, 1988],
  heat: [1988, 2026],
  now: [2026, 2026],
  future: [2026, 2100],
};

// Five endings, the IPCC AR6 scenarios, from the viewer's answers: best
// estimates for temperature, CO2 approximate. `outcome` groups them for the
// pictures and the music; `severity` places each within the group.
export const SCENARIOS = [
  {
    scenario: 'SSP1-1.9', outcome: 'better', severity: 0, temp: 1.4, co2: 395, label: 'The curve bends.',
    co2Path: [[2026, 430], [2040, 440], [2060, 420], [2100, 395]],
    tempPath: [[2026, 1.5], [2050, 1.6], [2100, 1.4]],
  },
  {
    scenario: 'SSP1-2.6', outcome: 'better', severity: 0.25, temp: 1.8, co2: 445, label: 'The curve bends, late.',
    co2Path: [[2026, 430], [2050, 470], [2075, 460], [2100, 445]],
    tempPath: [[2026, 1.5], [2050, 1.7], [2100, 1.8]],
  },
  {
    scenario: 'SSP2-4.5', outcome: 'middle', severity: 0.5, temp: 2.7, co2: 600, label: 'The middle road.',
    co2Path: [[2026, 430], [2050, 500], [2075, 560], [2100, 600]],
    tempPath: [[2026, 1.5], [2050, 2.0], [2100, 2.7]],
  },
  {
    scenario: 'SSP3-7.0', outcome: 'worse', severity: 0.75, temp: 3.6, co2: 870, label: 'A divided, warming world.',
    co2Path: [[2026, 430], [2050, 540], [2075, 690], [2100, 870]],
    tempPath: [[2026, 1.5], [2050, 2.1], [2100, 3.6]],
  },
  {
    scenario: 'SSP5-8.5', outcome: 'worse', severity: 1, temp: 4.4, co2: 1135, label: 'Life out of balance.',
    co2Path: [[2026, 430], [2050, 560], [2075, 800], [2100, 1135]],
    tempPath: [[2026, 1.5], [2050, 2.4], [2100, 4.4]],
  },
];

export function lerpSeries(series, year) {
  if (year <= series[0][0]) return series[0][1];
  for (let i = 1; i < series.length; i++) {
    const [y1, v1] = series[i];
    if (year <= y1) {
      const [y0, v0] = series[i - 1];
      return v0 + ((v1 - v0) * (year - y0)) / (y1 - y0);
    }
  }
  return series[series.length - 1][1];
}
