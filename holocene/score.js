// HOLOCENE's score, and the film's clock. An original minimalist score in the
// spirit of the organ-and-choir film music of the early 1980s: a pipe organ,
// deep pedal lines, a low male chant, a high choir and repeating broken chords
// that grow one note at a time. Everything is synthesized with Web Audio
// oscillators and filters: no samples, no files. Public domain.
//
// The music is the clock. The pictures cut on its bars and beats, so the score
// keeps the time for the whole film: which section plays, which bar, which
// beat, all read from the audio clock (AudioContext.currentTime) and corrected
// for the output's delay, so the picture matches what the viewer hears.
//
// How it is built:
// - Instruments are small functions that schedule one note or chord: organ,
//   pedal, chant (low male choir), choir (high voices), pluck (arpeggio notes),
//   brass, and a few noises (chuff, thump, tick).
// - Each section of timeline.js has a pattern: a function that schedules one
//   bar of music, and reports the chord, the intensity and the accents.
// - A lookahead scheduler plays the patterns bar by bar a little ahead of the
//   audio clock, follows the sections in order, repeats the loop sections until
//   the director queues the next one, and fires events when bars are heard.
//
// Without Web Audio the same clock runs silently on performance.now(), so the
// film still plays.

import { SECTIONS, bpmAt, barSeconds } from './timeline.js';

const LOOKAHEAD = 0.3; // seconds of music scheduled ahead of the audio clock
const TICK = 50; // milliseconds between scheduler runs
const START_DELAY = 0.1; // seconds from start() to the first downbeat

// ---------------------------------------------------------------------------
// Notes and chords

const PITCH = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function midi(name) {
  const [, n, o] = name.match(/^([A-G][#b]?)(\d)$/);
  return PITCH[n] + (Number(o) + 1) * 12;
}
const notes = (s) => s.split(' ').map(midi);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// The chords, in D minor, each voiced for every part: the pedal's bass note,
// the low chant, the organ's hands, the arpeggio's tones (low to high) and the
// high choir. Written out by hand so the voices move by small steps.
const CHORDS = {};
function chord(name, bass, chant, organ, full, arp, pad) {
  CHORDS[name] = { name, bass: midi(bass), chant: notes(chant), organ: notes(organ), full: notes(full), arp: notes(arp), pad: notes(pad) };
}
chord('Dm', 'D2', 'D3 F3 A3', 'D3 A3 D4 F4', 'D3 A3 D4 F4 A4 D5', 'D4 F4 A4 D5 F5 A5 D6', 'A4 D5 F5');
chord('Bb', 'Bb1', 'D3 F3 Bb3', 'Bb2 F3 Bb3 D4', 'Bb2 F3 Bb3 D4 F4 Bb4', 'Bb3 D4 F4 Bb4 D5 F5 Bb5', 'Bb4 D5 F5');
chord('C', 'C2', 'E3 G3 C4', 'C3 G3 C4 E4', 'C3 G3 C4 E4 G4 C5', 'C4 E4 G4 C5 E5 G5 C6', 'G4 C5 E5');
chord('A', 'A1', 'E3 A3 C#4', 'A2 E3 A3 C#4', 'A2 E3 A3 C#4 E4 A4', 'A3 C#4 E4 A4 C#5 E5 A5', 'A4 C#5 E5');
chord('F', 'F2', 'F3 A3 C4', 'F3 A3 C4 F4', 'F2 C3 F3 A3 C4 F4', 'F4 A4 C5 F5 A5 C6 F6', 'A4 C5 F5');
chord('Gm', 'G1', 'D3 G3 Bb3', 'G2 D3 G3 Bb3', 'G2 D3 G3 Bb3 D4 G4', 'G3 Bb3 D4 G4 Bb4 D5 G5', 'G4 Bb4 D5');
chord('D', 'D2', 'D3 F#3 A3', 'D3 A3 D4 F#4', 'D3 A3 D4 F#4 A4 D5', 'D4 F#4 A4 D5 F#5 A5 D6', 'A4 D5 F#5');
chord('Dsus2', 'D2', 'D3 A3 E4', 'D3 A3 D4 E4', 'D3 A3 D4 E4 A4 D5', 'D4 E4 A4 D5 E5 A5 D6', 'A4 D5 E5');
chord('Bbmaj7', 'Bb1', 'D3 F3 A3', 'Bb2 F3 A3 D4', 'Bb2 F3 A3 D4 E4 A4', 'Bb3 F4 A4 D5 E5 A5 D6', 'A4 D5 E5');
chord('Csus2', 'C2', 'D3 G3 C4', 'C3 G3 D4 G4', 'C3 G3 C4 D4 G4 C5', 'C4 D4 G4 C5 D5 G5 C6', 'G4 C5 D5');
chord('Asus4', 'A1', 'D3 E3 A3', 'A2 E3 A3 D4', 'A2 E3 A3 D4 E4 A4', 'A3 D4 E4 A4 D5 E5 A5', 'A4 D5 E5');
// Chords over a held D in the bass: the dissonant pedal of the heat.
chord('Eb/D', 'D2', 'Eb3 G3 Bb3', 'Eb3 G3 Bb3 Eb4', 'D3 Eb3 G3 Bb3 Eb4 G4', 'Eb4 G4 Bb4 Eb5 G5 Bb5 Eb6', 'G4 Bb4 Eb5');
chord('C/D', 'D2', 'E3 G3 C4', 'C3 G3 C4 E4', 'D3 G3 C4 E4 G4 C5', 'C4 E4 G4 C5 E5 G5 C6', 'G4 C5 E5');
chord('Bb/D', 'D2', 'D3 F3 Bb3', 'D3 F3 Bb3 D4', 'D3 F3 Bb3 D4 F4 Bb4', 'Bb3 D4 F4 Bb4 D5 F5 Bb5', 'Bb4 D5 F5');
chord('A/D', 'D2', 'E3 A3 C#4', 'D3 E3 A3 C#4', 'D3 E3 A3 C#4 E4 A4', 'A3 C#4 E4 A4 C#5 E5 A5', 'A4 C#5 E5');
chord('Gm/D', 'D2', 'D3 G3 Bb3', 'D3 G3 Bb3 D4', 'D3 G3 Bb3 D4 G4 Bb4', 'G3 Bb3 D4 G4 Bb4 D5 G5', 'G4 Bb4 D5');
// The worst future: a cluster, and a darker chord on the same pedal.
chord('cluster', 'D2', 'A2 D3 Eb3', 'D3 Eb3 F3 Ab3', 'D3 Eb3 Ab3 D4 Eb4 F4', 'D4 Eb4 F4 Ab4 D5 Eb5 Ab5', 'Ab4 D5 Eb5');
chord('Ebm/D', 'D2', 'Bb2 Eb3 Gb3', 'D3 Gb3 Bb3 Eb4', 'D3 Gb3 Bb3 Eb4 Gb4 Bb4', 'Eb4 Gb4 Bb4 Eb5 Gb5 Bb5 Eb6', 'Gb4 Bb4 Eb5');

// A figure of the first n tones: the additive process. Played over a steady
// stream of notes, a figure of 3 against a bar of 8 makes the accents wander,
// and each time it grows by a note the pattern shifts again.
const grow = (n) => Array.from({ length: n }, (_, i) => i);

// ---------------------------------------------------------------------------
// Sound design constants

// Pipe timbres, as the amplitudes of each pipe's own harmonics.
// Principals: the organ's own voice, bright but round, the even harmonics a
// little weaker. Flutes: nearly pure; a stopped flute (bourdon) has mostly odd
// harmonics. Reeds: the trumpet's brassy spectrum, strongest around the 4th.
const PIPES = {
  principal: series(28, (n) => (n % 2 ? 1 : 0.75) / n ** 1.25),
  flute: { 1: 1, 2: 0.14, 3: 0.05, 4: 0.02 },
  stopped: { 1: 1, 2: 0.03, 3: 0.16, 5: 0.04 },
  reed: series(36, (n) => (n <= 4 ? 0.35 + 0.65 * (n / 4) : (4 / n) ** 1.05)),
};
function series(count, amp) {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, amp(i + 1)]));
}

// Registrations. A pipe organ note sounds several ranks of pipes at once:
// 16' an octave below the key, 8' at pitch, 4' an octave above, 2 2/3' a
// twelfth above, and so on. Each group below is one oscillator whose wave is
// the sum of its ranks, pitched at the group's lowest rank (`base`, in feet);
// a rank is [base ÷ its footage, pipe, level]. Every group of every note is
// tuned a few cents off its neighbours, fixed per pipe, so the ensemble beats
// slowly the way a real organ's pipes do.
const STOPS = {
  // Hushed: a stopped 8' flute and a soft 4' flute.
  flute: [
    { base: 8, ranks: [[1, 'stopped', 1]] },
    { base: 8, ranks: [[2, 'flute', 0.3]] },
  ],
  // The principal chorus: 16' bourdon, 8' principal, 8' flute with 4'
  // principal, and a little 2 2/3' and 2'.
  diapason: [
    { base: 16, ranks: [[1, 'stopped', 0.4]] },
    { base: 8, ranks: [[1, 'principal', 1]] },
    { base: 8, ranks: [[1, 'flute', 0.45], [2, 'principal', 0.5]] },
    { base: 8, ranks: [[3, 'principal', 0.14], [4, 'principal', 0.2]] },
  ],
  // Full organ: principals from 16' up, a mixture of high ranks, and the
  // reeds (16' and 8' trumpets, 4' clarion). The cathedral opening.
  full: [
    { base: 16, ranks: [[1, 'principal', 0.6]] },
    { base: 8, ranks: [[1, 'principal', 1]] },
    { base: 8, ranks: [[1, 'flute', 0.5], [2, 'principal', 0.7]] },
    { base: 8, ranks: [[3, 'principal', 0.35], [4, 'principal', 0.45], [6, 'principal', 0.25], [8, 'principal', 0.2]] },
    { base: 16, ranks: [[1, 'reed', 0.28], [2, 'reed', 0.5], [4, 'reed', 0.22]] },
  ],
  // The pedal: 32' and 16' bourdons for weight, 16', 8' and 4' principals
  // for pitch you can hear on small speakers.
  pedal: [
    { base: 32, ranks: [[1, 'stopped', 0.55]], long: true },
    { base: 16, ranks: [[1, 'stopped', 1]] },
    { base: 16, ranks: [[1, 'principal', 0.45], [2, 'principal', 0.5], [4, 'principal', 0.18]] },
  ],
  // Arpeggio pipes: one quick rank each.
  'pluck-organ': [{ base: 8, ranks: [[1, 'principal', 1], [2, 'flute', 0.35]] }],
  'pluck-reed': [{ base: 8, ranks: [[1, 'reed', 0.8], [2, 'principal', 0.25]] }],
  'pluck-flute': [{ base: 8, ranks: [[1, 'flute', 1], [2, 'flute', 0.25]] }],
  // The reed chorus, for the swells and stabs.
  reeds: [
    { base: 8, ranks: [[1, 'reed', 1]] },
    { base: 8, ranks: [[1, 'reed', 0.6], [2, 'reed', 0.35]] },
  ],
};

// The voice: a glottal pulse, the buzz of the vocal folds, whose harmonics
// fall by 12 dB an octave, rather than a sawtooth's 6.
const GLOTTAL = series(64, (n) => 1 / (1 + (n / 1.6) ** 2));

// Vowels as formants: [centre Hz, Q, gain] for F1–F4. The men sing with the
// formants of low male voices, the women with female ones and the singer's
// formant near 3 kHz, the ring that carries a trained voice through a hall.
const VOWELS = {
  oh: [[400, 5, 1], [750, 7, 0.55], [2450, 9, 0.5], [2850, 10, 0.4]],
  ah: [[700, 5, 1], [1100, 7, 0.65], [2550, 9, 0.55], [2900, 10, 0.45]],
  oo: [[320, 5, 1], [800, 8, 0.35], [2300, 9, 0.25], [2850, 10, 0.2]],
};
const HIGH_VOWELS = {
  oh: [[550, 5, 1], [900, 6, 0.5], [2850, 8, 0.5], [3400, 10, 0.2]],
  ah: [[850, 5, 1], [1250, 6, 0.6], [2950, 8, 0.6], [3500, 10, 0.3]],
  oo: [[420, 5, 1], [800, 6, 0.3], [2800, 8, 0.3], [3300, 10, 0.12]],
};

// Loudness of each instrument at velocity 1. Balanced by rendering the
// sections offline (Score.render) and measuring the levels.
const LOUD = { organ: 0.1, pedal: 0.12, chant: 0.1, choir: 0.055, pluck: 0.45, brass: 0.14, noise: 0.5, synth: 0.1 };

// How much of each instrument goes to the room (always) and to the cathedral
// (its level is automated for emphasis, see Synth.cathedral).
const ROOM = { organ: 0.35, pedal: 0.12, chant: 0.45, choir: 0.5, pluck: 0.3, brass: 0.3, noise: 0.2, synth: 0.45 };
const NAVE = { organ: 0.7, pedal: 0.22, chant: 0.8, choir: 0.9, pluck: 0.35, brass: 0.6, noise: 0.08, synth: 0.6 };
const KINDS = ['organ', 'pedal', 'chant', 'choir', 'pluck', 'brass', 'noise', 'synth'];

// A pulse wave with a 30% duty cycle, for the polysynth's second layer.
const PULSE = series(48, (n) => Math.abs(Math.sin(n * Math.PI * 0.3)) / n);

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A fixed number in -1..1 for a pipe, so each pipe keeps its own tuning.
function pipeHash(a, b) {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1103515245);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

// ---------------------------------------------------------------------------
// The synthesizer: the mixing desk, the two acoustics and the instruments.

class Synth {
  constructor(ctx) {
    const c = (this.ctx = ctx);
    this.rng = mulberry32(1982);

    // Master: a gentle compressor to hold the dynamics together, a limiter,
    // and a soft clipper that keeps the very last peaks under full scale.
    // Browsers' compressors add their own make-up gain (about +8 dB for the
    // first, +2 dB for the limiter), so the level going in is kept low.
    this.mix = this.#gain(0.5);
    const low = this.#filter('highpass', 28, 0.7);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.02;
    comp.release.value = 0.3;
    const makeup = this.#gain(0.7);
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -4;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.15;
    const clip = c.createWaveShaper();
    clip.curve = softClip();
    this.fader = this.#gain(1); // stop() fades this
    this.mute = this.#gain(1); // setMuted() sets this
    this.mix.connect(low).connect(comp).connect(makeup).connect(limit).connect(clip).connect(this.fader).connect(this.mute).connect(c.destination);

    // Two acoustics. The room: a stone hall of about 2.5 seconds that
    // everything sits in. The cathedral: a vast nave, 9 seconds, whose level
    // the music raises for its big moments.
    this.room = c.createConvolver();
    this.room.buffer = impulse(c, this.rng, { seconds: 2.6, predelay: 0.022, low: 1.5, mid: 2.3, high: 0.9, early: 8 });
    this.roomIn = this.#gain(1);
    this.roomOut = this.#gain(0.5); // the grid's cut ducks this
    this.roomIn.connect(this.room).connect(this.#filter('highpass', 160, 0.7)).connect(this.roomOut).connect(this.mix);
    this.nave = c.createConvolver();
    this.nave.buffer = impulse(c, this.rng, { seconds: 9.5, predelay: 0.065, low: 4.5, mid: 8.5, high: 2.6, early: 14 });
    this.naveIn = this.#gain(0.3); // Synth.cathedral() automates this
    this.naveIn.connect(this.nave).connect(this.#filter('highpass', 110, 0.7)).connect(this.#gain(0.6)).connect(this.mix);

    // One input per instrument, with its shared processing.
    this.inputs = {};
    const out = (kind, gain) => {
      const o = this.#gain(gain);
      o.connect(this.mix);
      o.connect(this.#gain(ROOM[kind])).connect(this.roomIn);
      o.connect(this.#gain(NAVE[kind])).connect(this.naveIn);
      return o;
    };
    // The organ has no tremulant or chorus: a cathedral organ holds still.
    this.inputs.organ = this.#gain(1);
    this.inputs.organ.connect(this.#filter('highpass', 40, 0.6)).connect(out('organ', 1));
    this.inputs.pedal = this.#gain(1);
    this.inputs.pedal.connect(this.#filter('highpass', 26, 0.7)).connect(this.#filter('lowpass', 1400, 0.6)).connect(out('pedal', 1));
    // The chant and the choir: many singers into one formant bank each.
    this.formants = {};
    for (const [kind, vowels, pre, body, makeupGain] of [
      ['chant', VOWELS, 4500, 300, 5],
      ['choir', HIGH_VOWELS, 6000, 700, 4],
    ]) {
      const input = (this.inputs[kind] = this.#gain(1));
      // The mouth radiates highs more strongly than lows (about +6 dB an
      // octave), which lifts the glottal buzz up to the singer's formant.
      const mouth = this.#filter('highshelf', 1200, 0.7);
      mouth.gain.value = 12;
      const shaped = input.connect(this.#filter('highpass', kind === 'chant' ? 80 : 200, 0.6)).connect(mouth).connect(this.#filter('lowpass', pre, 0.6));
      const sum = this.#gain(makeupGain);
      const bank = vowels.oh.map(([f, q, g]) => {
        const bp = this.#filter('bandpass', f, q);
        const level = this.#gain(g);
        shaped.connect(bp).connect(level).connect(sum);
        return { bp, level };
      });
      // A little of the plain voice below the first formant, for body.
      shaped.connect(this.#filter('lowpass', body, 0.7)).connect(this.#gain(0.3)).connect(sum);
      sum.connect(out(kind, 1));
      this.formants[kind] = { bank, vowels };
    }
    this.inputs.pluck = this.#gain(1);
    this.inputs.pluck.connect(out('pluck', 1));
    this.inputs.brass = this.#gain(1);
    this.inputs.brass.connect(this.#filter('highpass', 70, 0.6)).connect(out('brass', 1));
    this.inputs.noise = this.#gain(1);
    this.inputs.noise.connect(out('noise', 1));

    // The polysynth (for the ice) has its own echo: a ping-pong delay, each
    // repeat crossing to the other side and a little darker than the last.
    this.inputs.synth = this.#gain(1);
    const synthOut = out('synth', 1);
    this.inputs.synth.connect(synthOut);
    const echoIn = this.#gain(0.5);
    echoIn.channelCount = 1;
    echoIn.channelCountMode = 'explicit';
    this.inputs.synth.connect(echoIn);
    this.echoes = [c.createDelay(4), c.createDelay(4)];
    const [left, right] = this.echoes;
    for (const d of this.echoes) d.delayTime.value = 1.5;
    const darkL = this.#filter('lowpass', 2400, 0.5);
    const darkR = this.#filter('lowpass', 2400, 0.5);
    const merge = c.createChannelMerger(2);
    echoIn.connect(left).connect(darkL).connect(this.#gain(0.45)).connect(right).connect(darkR).connect(this.#gain(0.45)).connect(left);
    darkL.connect(merge, 0, 0);
    darkR.connect(merge, 0, 1);
    const echoOut = this.#gain(0.9);
    merge.connect(echoOut);
    echoOut.connect(this.mix);
    echoOut.connect(this.#gain(0.4)).connect(this.roomIn);

    // Wave tables, built once: every registration group, and the voice.
    this.waves = new Map();
    for (const [name, groups] of Object.entries(STOPS)) {
      groups.forEach((g, i) => {
        const h = {};
        for (const [mult, pipe, level] of g.ranks) {
          for (const [n, a] of Object.entries(PIPES[pipe])) {
            const k = mult * Number(n);
            if (k < 160) h[k] = (h[k] ?? 0) + a * level;
          }
        }
        this.waves.set(`${name}${i}`, periodicWave(c, h));
      });
    }
    this.waves.set('glottal', periodicWave(c, GLOTTAL));
    this.waves.set('pulse', periodicWave(c, PULSE));
    this.noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.rng() * 2 - 1;
  }

  #gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  #filter(type, f, q) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  // A gate for every instrument, so a section's music can be faded or cut
  // on its own. `filtered` adds a low-pass per instrument (for `now`).
  layer(filtered = false, level = 1) {
    return new Layer(this, filtered, level);
  }

  // The instruments, bound to a layer, for the patterns to call.
  voices(layer) {
    const g = layer.gates;
    return {
      organ: (t, n, dur, vel, o) => this.organ(g.organ, t, n, dur, vel, o),
      pedal: (t, n, dur, vel, o) => this.pedal(g.pedal, t, n, dur, vel, o),
      chant: (t, n, dur, vel, o) => this.voice(g.chant, 'chant', t, n, dur, vel, o),
      choir: (t, n, dur, vel, o) => this.voice(g.choir, 'choir', t, n, dur, vel, o),
      pluck: (t, n, dur, vel, o) => this.pluck(g.pluck, t, n, dur, vel, o),
      brass: (t, n, dur, vel, o) => this.brass(g.brass, t, n, dur, vel, o),
      chuff: (t, vel) => this.chuff(g.noise, t, vel),
      thump: (t, vel) => this.thump(g.noise, t, vel),
      tick: (t, vel, pitch) => this.tick(g.noise, t, vel, pitch),
      pad: (t, n, dur, vel, o) => this.pad(g.synth, t, n, dur, vel, o),
      lead: (t, phrase, beat, vel, o) => this.lead(g.synth, t, phrase, beat, vel, o),
      bell: (t, n, vel, o) => this.bell(g.synth, t, n, vel, o),
      gust: (t, dur, vel) => this.gust(g.synth, t, dur, vel),
    };
  }

  // The chant and choir sing one vowel at a time; this glides to another.
  vowel(kind, t, name) {
    const f = this.formants[kind];
    f.vowels[name].forEach(([freq, q, g], i) => {
      f.bank[i].bp.frequency.setTargetAtTime(freq, t, 0.25);
      f.bank[i].bp.Q.setTargetAtTime(q, t, 0.25);
      f.bank[i].level.gain.setTargetAtTime(g, t, 0.25);
    });
  }

  // How much of everything goes into the cathedral, from time t, reached
  // with time constant tau.
  cathedral(t, amount, tau = 0.5) {
    this.naveIn.gain.setTargetAtTime(amount, t, tau);
  }

  // The echo's time, from t (set at the start of a section, not while its
  // repeats are sounding).
  echo(t, seconds) {
    for (const d of this.echoes) d.delayTime.setValueAtTime(seconds, t);
  }

  // The grid's cut: the room's tail stops with the music, and only the
  // cathedral is left ringing.
  duckHall(t) {
    const g = this.roomOut.gain;
    g.setTargetAtTime(0, t, 0.015);
    g.setTargetAtTime(0.5, t + 1.5, 1.5);
  }

  // An attack–hold–release envelope. Every note has one, so nothing clicks.
  // Returns when the sound is over, for stopping the oscillators.
  #envelope(param, t, dur, peak, attack, release) {
    const a = Math.max(0.004, attack);
    const end = t + Math.max(dur, a);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, end);
    param.setTargetAtTime(0, end, Math.max(0.005, release) / 5);
    return end + Math.max(0.005, release) * 1.2;
  }

  // Disconnect a note's nodes when its source ends, to keep the graph small.
  #cleanup(source, nodes) {
    source.addEventListener('ended', () => {
      for (const n of nodes) n.disconnect();
    });
  }

  #osc(wave, f, t, stop, detune = 0) {
    const o = this.ctx.createOscillator();
    if (this.waves.has(wave)) o.setPeriodicWave(this.waves.get(wave));
    else o.type = wave;
    o.frequency.value = f;
    o.detune.value = detune;
    o.start(t);
    o.stop(stop);
    return o;
  }

  #pan(v) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, v));
    return p;
  }

  #noise(t, stop) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start(t, this.rng() * 1.8);
    src.stop(stop);
    return src;
  }

  // Speech: a pipe takes time to start sounding, longer for big low pipes.
  #speech(m, dur) {
    return Math.min(0.03 + 0.1 * Math.min(1, Math.max(0, (66 - m) / 36)), dur * 0.3);
  }

  // One pipe-organ note on a registration: a group of oscillators, each a set
  // of ranks, each group tuned a little off; a chiff as the pipes start to
  // speak; placed left or right by pitch, the way an organ's pipes stand in
  // two towers (C, D, E… on one side, C#, D#… on the other).
  #pipes(dest, stop, t, m, dur, peak, attack, release, { chiff = 1, pan = 0, extra = 0 } = {}) {
    const f = hz(m);
    const env = this.#gain(0);
    const long = dur > 1.5;
    // Legato: a key is let go just after the next one speaks, so chords
    // join without a gap, as an organist plays them.
    const held = dur + Math.min(0.08, dur * 0.1);
    const end = this.#envelope(env.gain, t, held, peak, Math.max(attack, this.#speech(m, dur)), release);
    const side = m < 48 ? 0 : m % 2 ? 0.3 : -0.3;
    const p = this.#pan(side + pan);
    env.connect(p).connect(dest);
    let first;
    STOPS[stop].forEach((g, i) => {
      if (g.long && !long) return;
      // Higher ranks speak a moment sooner than the big ones.
      const o = this.#osc(`${stop}${i}`, f * (8 / g.base), t + (g.base / 8) * 0.004 * (1 + extra), end, pipeHash(m, i + 17 * stop.length) * 2.5);
      o.connect(env);
      first ??= o;
    });
    this.#cleanup(first, [env, p]);
    if (chiff > 0) this.#chiff(p, t, f, chiff);
    return { end, source: first };
  }

  // The chiff: a short breath of noise at a pipe's pitch as it starts to speak.
  #chiff(dest, t, f, amount) {
    const src = this.#noise(t, t + 0.12);
    const bp = this.#filter('bandpass', Math.min(f * 2, 9000), 14);
    const env = this.#gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amount * 0.9, t + 0.006);
    env.gain.setTargetAtTime(0, t + 0.006, 0.018);
    src.connect(bp).connect(env).connect(dest);
    this.#cleanup(src, [bp, env]);
  }

  // The organ's wind: a faint rush that comes and goes with the chord.
  #wind(dest, t, end, level, attack) {
    const src = this.#noise(t, end);
    const bp = this.#filter('bandpass', 700, 0.6);
    const env = this.#gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.setTargetAtTime(0, end - 0.3, 0.08);
    src.connect(bp).connect(env).connect(dest);
    this.#cleanup(src, [bp, env]);
  }

  // A chord on the manuals. `stop` picks the registration: 'flute' for the
  // hushed places, 'diapason' for the principal chorus, 'full' for the
  // plenum with reeds. Pipes stop quickly; the room carries the release.
  organ(dest, t, midis, dur, vel, { stop = 'flute', attack = 0.08, release = 0.35, pan = 0, chiff } = {}) {
    midis = [].concat(midis);
    const peak = vel * LOUD.organ * { flute: 1.3, diapason: 1, full: 0.75 }[stop];
    const rel = Math.min(release, 0.6);
    let end = t;
    for (const m of midis) end = Math.max(end, this.#pipes(dest, stop, t, m, dur, peak, attack, rel, { chiff: (chiff ?? (stop === 'flute' ? 0.5 : 0.8)) * peak, pan }).end);
    this.#wind(dest, t, end, peak * 0.05, Math.max(0.05, attack));
  }

  // The pedal: 16' and 8' pipes, with the 32' for long notes.
  pedal(dest, t, m, dur, vel, { attack = 0.12, release = 0.4 } = {}) {
    const peak = vel * LOUD.pedal;
    this.#pipes(dest, 'pedal', t, m, dur, peak, attack, Math.min(release, 0.5), { chiff: peak * 0.25, extra: 2 });
  }

  // A choir section: many singers on each note, each with a slightly
  // different pitch, a slow drift and a vibrato of their own that begins a
  // moment after the note does. Their pitch lines are drawn once as curves
  // (cheap: no modulated oscillators). A glottal-pulse source and a breath of
  // noise go through the shared formant bank of `kind`. Notes swell a little
  // towards their middle, like a sung phrase.
  voice(dest, kind, t, midis, dur, vel, { attack, release } = {}) {
    const high = kind === 'choir';
    attack = Math.max(0.1, attack ?? (high ? 1.2 : 0.6));
    release ??= high ? 1.2 : 0.9;
    midis = [].concat(midis);
    const singers = Math.max(4, Math.min(8, Math.floor(20 / midis.length)));
    const peak = (vel * LOUD[kind] * 2.2) / Math.sqrt(singers);
    const end = t + Math.max(dur, attack);
    const stop = end + release * 1.2;
    const sides = [-0.45, 0.45].map((pan) => {
      const env = this.#gain(0);
      const g = env.gain;
      g.setValueAtTime(0, t);
      if (dur > 2) {
        g.linearRampToValueAtTime(peak * 0.8, t + attack);
        g.linearRampToValueAtTime(peak, t + Math.max(attack, dur * 0.55));
        g.linearRampToValueAtTime(peak * 0.85, end);
      } else {
        g.linearRampToValueAtTime(peak, t + attack);
        g.setValueAtTime(peak, end);
      }
      g.setTargetAtTime(0, end, release / 5);
      const p = this.#pan(pan);
      env.connect(p).connect(dest);
      return { env, p };
    });
    let first;
    for (const m of midis) {
      const f = hz(m);
      for (let s = 0; s < singers; s++) {
        const start = t + this.rng() * 0.09;
        const o = this.ctx.createOscillator();
        o.setPeriodicWave(this.waves.get('glottal'));
        try {
          o.frequency.automationRate = 'k-rate';
        } catch {}
        o.frequency.setValueCurveAtTime(singerLine(f, stop - start, high, this.rng), start, stop - start);
        o.start(start);
        o.stop(stop);
        o.connect(sides[s % 2].env);
        first ??= o;
      }
    }
    // Breath: a little noise through the same vowel.
    const breath = this.#noise(t, stop);
    const bg = this.#gain(0);
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(vel * LOUD[kind] * 0.35, t + attack);
    bg.gain.setValueAtTime(vel * LOUD[kind] * 0.35, end);
    bg.gain.setTargetAtTime(0, end, release / 5);
    breath.connect(bg).connect(dest);
    this.#cleanup(first, [...sides.flatMap((x) => [x.env, x.p])]);
    this.#cleanup(breath, [bg]);
  }

  // An arpeggio note. 'organ' and 'reed' are quick single pipes with a chiff;
  // 'piano' is a struck, decaying tone that darkens as it fades.
  pluck(dest, t, m, dur, vel, { kind = 'organ', pan = 0 } = {}) {
    const f = hz(m);
    const peak = vel * LOUD.pluck;
    if (kind === 'piano') {
      // Two partials: the note, and its octave, which dies away faster, so
      // the tone darkens as it fades. Cheaper than a moving filter.
      const env = this.#gain(0);
      const p = this.#pan(pan);
      env.connect(p).connect(dest);
      const decay = Math.max(0.25, 0.9 - (m - 60) * 0.02);
      const end = t + dur + 0.5;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak * 1.3, t + 0.004);
      env.gain.setTargetAtTime(0, t + 0.004, decay);
      env.gain.setTargetAtTime(0, t + dur, 0.08);
      const a = this.#osc('triangle', f, t, end);
      const b = this.#osc('sine', f * 2, t, end, 3);
      const bright = this.#gain(0);
      bright.gain.setValueAtTime(0.45, t);
      bright.gain.setTargetAtTime(0, t, decay * 0.3);
      a.connect(env);
      b.connect(bright).connect(env);
      this.#cleanup(a, [env, p, bright]);
      return;
    }
    this.#pipes(dest, `pluck-${kind}`, t, m, dur, peak * 0.8, 0.012, 0.07, { chiff: peak * 0.5, pan });
  }

  // The reeds as brass: trumpet pipes behind a swell box (a low-pass that
  // opens). A swell opens slowly; a stab opens at once and closes again.
  brass(dest, t, midis, dur, vel, { stab = false } = {}) {
    midis = [].concat(midis);
    const lp = this.#filter('lowpass', 300, 0.9);
    const box = this.#gain(1);
    box.connect(lp).connect(dest);
    const peak = vel * LOUD.brass * 0.6;
    if (stab) {
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.linearRampToValueAtTime(1800 + 2600 * vel, t + 0.03);
      lp.frequency.setTargetAtTime(1100, t + 0.03, 0.18);
    } else {
      lp.frequency.setValueAtTime(350, t);
      lp.frequency.linearRampToValueAtTime(900 + 2800 * vel, t + dur * 0.9);
      lp.frequency.setTargetAtTime(500, t + dur, 0.2);
    }
    let last = null;
    for (const m of midis) {
      const note = this.#pipes(box, 'reeds', t, m, dur, peak, stab ? 0.025 : dur * 0.5, stab ? 0.12 : 0.35, { chiff: 0 });
      if (!last || note.end >= last.end) last = note;
    }
    if (last) this.#cleanup(last.source, [lp, box]);
  }

  // The machine: a breath of steam through a valve.
  chuff(dest, t, vel) {
    const src = this.#noise(t, t + 0.25);
    const bp = this.#filter('bandpass', 1100, 0.9);
    const env = this.#gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * LOUD.noise * 0.5, t + 0.006);
    env.gain.setTargetAtTime(0, t + 0.006, 0.035);
    src.connect(bp).connect(env).connect(dest);
    this.#cleanup(src, [bp, env]);
  }

  // A soft low blow, like a piston or a far drum.
  thump(dest, t, vel) {
    const o = this.#osc('sine', 100, t, t + 0.5);
    o.frequency.setValueAtTime(100, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.14);
    const env = this.#gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * LOUD.noise, t + 0.005);
    env.gain.setTargetAtTime(0, t + 0.005, 0.08);
    o.connect(env).connect(dest);
    this.#cleanup(o, [env]);
  }

  // A clock's tick: a short, high, damped ping and a click of noise.
  tick(dest, t, vel, pitch = 2100) {
    const o = this.#osc('sine', pitch, t, t + 0.12);
    const env = this.#gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * LOUD.noise * 0.35, t + 0.002);
    env.gain.setTargetAtTime(0, t + 0.002, 0.014);
    o.connect(env).connect(dest);
    this.#cleanup(o, [env]);
    const src = this.#noise(t, t + 0.06);
    const hp = this.#filter('highpass', 3500, 0.7);
    const nenv = this.#gain(0);
    nenv.gain.setValueAtTime(0, t);
    nenv.gain.linearRampToValueAtTime(vel * LOUD.noise * 0.25, t + 0.001);
    nenv.gain.setTargetAtTime(0, t + 0.001, 0.005);
    src.connect(hp).connect(nenv).connect(dest);
    this.#cleanup(src, [hp, nenv]);
  }
}

// ---- The polysynth, for the ice: in the spirit of the big analogue
// polyphonic synthesizers of the early 1980s. ----

Object.assign(Synth.prototype, {
  // A pad: per note a saw and a pulse wave, slightly apart in tune and in
  // the stereo field, each drifting slowly, through a resonant low-pass whose
  // cutoff swells open over the note and sinks again, the way a player
  // leans into the keys. Slow to arrive, slow to leave.
  pad(dest, t, midis, dur, vel, { attack = 2.5, release = 3, bright = 1 } = {}) {
    const c = this.ctx;
    const end = t + Math.max(dur, attack);
    const stop = end + release * 1.2;
    for (const m of [].concat(midis)) {
      const f = hz(m);
      const env = c.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(vel * LOUD.synth, t + attack);
      env.gain.setValueAtTime(vel * LOUD.synth, end);
      env.gain.setTargetAtTime(0, end, release / 5);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 4;
      try {
        lp.frequency.automationRate = 'k-rate';
      } catch {}
      lp.frequency.setValueCurveAtTime(swellLine(f, stop - t, bright * (0.6 + vel), this.rng), t, stop - t);
      lp.connect(env).connect(dest);
      const nodes = [env, lp];
      let first;
      for (const [wave, cents, side] of [['sawtooth', -7, -0.55], ['pulse', 7, 0.55]]) {
        const o = c.createOscillator();
        if (wave === 'pulse') o.setPeriodicWave(this.waves.get('pulse'));
        else o.type = wave;
        try {
          o.frequency.automationRate = 'k-rate';
        } catch {}
        o.frequency.setValueCurveAtTime(driftLine(f, cents, stop - t, this.rng), t, stop - t);
        const p = c.createStereoPanner();
        p.pan.value = side;
        o.connect(p).connect(lp);
        o.start(t);
        o.stop(stop);
        nodes.push(p);
        first ??= o;
      }
      first.addEventListener('ended', () => nodes.forEach((n) => n.disconnect()));
    }
  },

  // A solo line on one voice: it glides from note to note (portamento),
  // with a vibrato that comes in late on each long note, and a filter that
  // opens a little as each note begins. `phrase` is [[beat, 'A4', beats]…].
  lead(dest, t, phrase, beat, vel, { attack = 0.5, release = 2 } = {}) {
    const c = this.ctx;
    const notesAt = phrase.map(([at, name, len]) => ({ at: at * beat, f: hz(midi(name)), len: len * beat }));
    const last = notesAt[notesAt.length - 1];
    const dur = last.at + last.len;
    const stop = dur + release * 1.2;
    const rate = 60;
    const n = Math.ceil(stop * rate) + 1;
    const pitch = new Float32Array(n);
    const cutoff = new Float32Array(n);
    const vib = 4.8 + this.rng() * 0.6;
    let f = notesAt[0].f;
    for (let i = 0; i < n; i++) {
      const x = i / rate;
      let k = 0;
      while (k + 1 < notesAt.length && notesAt[k + 1].at <= x) k++;
      const note = notesAt[k];
      f += (note.f - f) * (1 - Math.exp(-1 / (rate * 0.13)));
      const since = x - note.at;
      const grow = Math.min(1, Math.max(0, (since - 0.7) / 1.2));
      pitch[i] = f * 2 ** ((14 * grow * Math.sin(6.283 * vib * x)) / 1200);
      cutoff[i] = Math.min(4000, note.f * (2.2 + 2.2 * Math.exp(-since / 0.5)));
    }
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * LOUD.synth * 1.2, t + attack);
    env.gain.setValueAtTime(vel * LOUD.synth * 1.2, t + dur);
    env.gain.setTargetAtTime(0, t + dur, release / 5);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2.5;
    try {
      lp.frequency.automationRate = 'k-rate';
    } catch {}
    lp.frequency.setValueCurveAtTime(cutoff, t, stop);
    const p = c.createStereoPanner();
    p.pan.value = -0.15;
    lp.connect(env).connect(p).connect(dest);
    let first;
    for (const [wave, ratio] of [['sawtooth', 1], ['pulse', 1.004]]) {
      const o = c.createOscillator();
      if (wave === 'pulse') o.setPeriodicWave(this.waves.get('pulse'));
      else o.type = wave;
      try {
        o.frequency.automationRate = 'k-rate';
      } catch {}
      o.frequency.setValueCurveAtTime(pitch.map((v) => v * ratio), t, stop);
      o.connect(lp);
      o.start(t);
      o.stop(t + stop);
      first ??= o;
    }
    first.addEventListener('ended', () => [env, lp, p].forEach((x) => x.disconnect()));
  },

  // A bell: frequency modulation at an inharmonic ratio, the modulation
  // dying faster than the tone, so it strikes bright and fades pure.
  bell(dest, t, m, vel, { decay = 4.5, pan = 0.3 } = {}) {
    const c = this.ctx;
    const f = hz(m);
    const stop = t + decay * 1.6;
    const carrier = c.createOscillator();
    carrier.frequency.value = f;
    const mod = c.createOscillator();
    mod.frequency.value = f * 3.5;
    const index = c.createGain();
    index.gain.setValueAtTime(f * 1.1, t);
    index.gain.setTargetAtTime(0, t, decay * 0.18);
    mod.connect(index).connect(carrier.frequency);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * LOUD.synth * 1.4, t + 0.006);
    env.gain.setTargetAtTime(0, t + 0.006, decay / 4);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    carrier.connect(env).connect(p).connect(dest);
    for (const o of [carrier, mod]) {
      o.start(t);
      o.stop(stop);
    }
    carrier.addEventListener('ended', () => [index, env, p].forEach((x) => x.disconnect()));
  },

  // Wind: noise through a band-pass that wanders slowly up and down, one
  // stream on each side, swelling in and out over `dur` seconds.
  gust(dest, t, dur, vel) {
    const c = this.ctx;
    for (const side of [-0.7, 0.7]) {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.6;
      try {
        bp.frequency.automationRate = 'k-rate';
      } catch {}
      const n = Math.ceil(dur * 20) + 1;
      const ph = this.rng() * 6.28;
      bp.frequency.setValueCurveAtTime(new Float32Array(n).map((_, i) => 500 * 2 ** (1.3 * Math.sin(ph + (i / 20) * 0.35) + 0.4 * Math.sin(ph * 2 + (i / 20) * 1.1))), t, dur);
      const env = c.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(vel * LOUD.synth * 0.6, t + dur * 0.45);
      env.gain.linearRampToValueAtTime(0, t + dur);
      const p = c.createStereoPanner();
      p.pan.value = side;
      src.connect(bp).connect(env).connect(p).connect(dest);
      src.start(t, this.rng() * 1.8);
      src.stop(t + dur + 0.05);
      src.addEventListener('ended', () => [bp, env, p].forEach((x) => x.disconnect()));
    }
  },
});

// A synth oscillator's pitch: `cents` off true, wandering a few cents.
function driftLine(f, cents, seconds, rng) {
  const rate = 20;
  const n = Math.ceil(seconds * rate) + 1;
  const a = 2 + rng() * 2;
  const w = 0.1 + rng() * 0.15;
  const p = rng() * 6.28;
  return new Float32Array(n).map((_, i) => f * 2 ** ((cents + a * Math.sin(p + 6.283 * w * (i / rate))) / 1200));
}

// A pad's filter over a note: closed, swelling open over the first
// seconds, then sinking slowly with a little unsteadiness, like pressure.
function swellLine(f, seconds, amount, rng) {
  const rate = 30;
  const n = Math.ceil(seconds * rate) + 1;
  const peak = Math.min(6000, 400 + f * (2 + 3.5 * amount));
  const rise = 2 + rng() * 2;
  const p = rng() * 6.28;
  return new Float32Array(n).map((_, i) => {
    const x = i / rate;
    const up = 1 - Math.exp(-x / rise);
    const sink = Math.exp(-Math.max(0, x - rise * 1.5) / 14);
    return 220 + (peak - 220) * up * (0.55 + 0.45 * sink) * (1 + 0.08 * Math.sin(p + x * 0.9));
  });
}

// One singer's pitch over a note, as a curve of frequencies 50 times a
// second: a small fixed offset from the true pitch, a slow wander, a scoop
// up into the note, and a vibrato of the singer's own rate and depth that
// starts a moment in and grows.
function singerLine(f, seconds, high, rng) {
  const rate = 50;
  const n = Math.max(2, Math.ceil(seconds * rate) + 1);
  const curve = new Float32Array(n);
  const offset = (rng() - 0.5) * 12;
  const drift = [0, 1].map(() => ({ a: 2 + rng() * 3, f: 0.06 + rng() * 0.18, p: rng() * 6.28 }));
  const vib = { rate: (high ? 5.3 : 5) + rng() * 0.9, depth: high ? 14 + rng() * 14 : 9 + rng() * 9, onset: 0.25 + rng() * 0.45, p: rng() * 6.28 };
  const scoop = 10 + rng() * 15;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const grow = Math.min(1, Math.max(0, (t - vib.onset) / 0.7));
    let cents = offset - scoop * Math.exp(-t / 0.07);
    for (const d of drift) cents += d.a * Math.sin(6.283 * d.f * t + d.p);
    cents += vib.depth * grow * Math.sin(6.283 * vib.rate * t + vib.p);
    curve[i] = f * 2 ** (cents / 1200);
  }
  return curve;
}

function periodicWave(c, harmonics) {
  const n = Math.max(...Object.keys(harmonics).map(Number)) + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (const [k, a] of Object.entries(harmonics)) imag[Number(k)] = a;
  return c.createPeriodicWave(real, imag);
}

// Straight through below 0.7, then bends smoothly towards 0.95.
function softClip() {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < 0.7 ? a : 0.7 + 0.25 * Math.tanh((a - 0.7) / 0.25);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

// A generated impulse response for a stone space. Silence for the pre-delay,
// then a handful of early reflections off near walls, then a diffuse tail that
// builds up and decays. The tail is split into three bands that decay at
// their own rates (`low`, `mid`, `high`: seconds to fall by 60 dB): the highs
// die first, as air and stone absorb them, and the lows are kept shorter than
// the middle so the room does not fill up with rumble.
function impulse(c, rng, { seconds, predelay, low, mid, high, early }) {
  const sr = c.sampleRate;
  const n = Math.floor(sr * seconds);
  const buffer = c.createBuffer(2, n, sr);
  const kLow = 1 - Math.exp((-2 * Math.PI * 220) / sr);
  const kHigh = 1 - Math.exp((-2 * Math.PI * 3200) / sr);
  const decay = (t60) => Math.exp(-6.9 / (t60 * sr));
  const [dLow, dMid, dHigh] = [decay(low), decay(mid), decay(high)];
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    let lpLow = 0;
    let lpHigh = 0;
    let gLow = 1;
    let gMid = 1;
    let gHigh = 1;
    const start = Math.floor(predelay * sr);
    const build = 0.06 * sr;
    for (let i = start; i < n; i++) {
      const w = rng() * 2 - 1;
      lpLow += (w - lpLow) * kLow;
      const rest = w - lpLow;
      lpHigh += (rest - lpHigh) * kHigh;
      const x = i - start;
      const onset = 1 - Math.exp(-x / build);
      d[i] = (lpLow * gLow * 1.4 + lpHigh * gMid + (rest - lpHigh) * gHigh * 0.7) * onset * 0.5;
      gLow *= dLow;
      gMid *= dMid;
      gHigh *= dHigh;
    }
    // Early reflections: short, slightly dulled clicks, different per ear.
    for (let e = 0; e < early; e++) {
      const at = Math.floor((predelay * (0.35 + rng() * 0.6) + e * 0.009 + rng() * 0.01) * sr);
      const amp = (0.7 - (e / early) * 0.45) * (rng() < 0.5 ? -1 : 1);
      for (let k = 0; k < 24 && at + k < n; k++) d[at + k] += amp * Math.exp(-k / 5);
    }
  }
  return buffer;
}

// A group of gates, one per instrument, that a section's notes play through.
// `level` is the section's loudness, so the film has dynamics: the waiting
// loops sit back, the grid and the heat come forward.
class Layer {
  constructor(synth, filtered, level) {
    const c = synth.ctx;
    this.level = level;
    this.gates = {};
    this.filters = [];
    this.nodes = [];
    for (const kind of KINDS) {
      const g = c.createGain();
      g.gain.value = level;
      let head = g;
      if (filtered) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 20000;
        f.Q.value = 0.6;
        g.connect(f);
        head = f;
        this.filters.push(f);
        this.nodes.push(f);
      }
      head.connect(synth.inputs[kind]);
      this.gates[kind] = g;
      this.nodes.push(g);
    }
  }

  #each(fn) {
    for (const g of Object.values(this.gates)) fn(g.gain);
  }

  // Glide the whole layer to a share (0..1) of its level.
  glide(share, t, tau) {
    this.#each((p) => p.setTargetAtTime(share * this.level, t, tau));
  }

  // Grow (or shrink) the level steadily from t0 to t1.
  ramp(from, to, t0, t1) {
    this.#each((p) => {
      p.setValueAtTime(from, t0);
      p.linearRampToValueAtTime(to, t1);
    });
    this.level = to;
  }

  // Close the gates hard at time t.
  cut(t, fade = 0.025) {
    this.#each((p) => {
      p.setValueAtTime(this.level, t - fade);
      p.linearRampToValueAtTime(0, t);
    });
  }

  // A long fade to silence, quick at first then gentle, over `dur` seconds.
  fadeOut(t, dur) {
    const curve = new Float32Array(64).map((_, i) => this.level * (1 - i / 63) ** 2.2);
    this.#each((p) => p.setValueCurveAtTime(curve, t, dur));
  }

  dispose() {
    for (const n of this.nodes) n.disconnect();
  }
}

// ---------------------------------------------------------------------------
// The patterns: one function per section, called once per bar. `b` holds the
// bar (b.bar within the phrase, b.abs since the section began), its start time
// b.t and beat length b.beat in seconds, b.at(beats) for times inside the bar,
// the instruments (b.v; for `now` also b.tense and b.calm), and b.accent(),
// b.level() and b.chord() to report what the pictures should know.

// A stream of notes through one bar: `div` notes per beat, cycling through a
// figure of indexes into `tones` (indexes past the end go up an octave). The
// first note of each figure leans a little, so the ear hears the groups.
function stream(b, tones, { div = 2, figure, vel = 0.4, len = 0.8, kind = 'organ', from = 0, beats = b.bpb - from, shift = 0, lean = 1.3, pan = 0, voice = b.v } = {}) {
  const step = b.beat / div;
  const n = Math.round(beats * div);
  for (let i = 0; i < n; i++) {
    const k = i % figure.length;
    const idx = figure[k];
    const note = tones[idx % tones.length] + 12 * Math.floor(idx / tones.length) + shift;
    voice.pluck(b.at(from) + i * step, note, step * len, vel * (k === 0 ? lean : 1), { kind, pan: pan + (k % 2 ? 0.15 : -0.15) });
  }
}

// How loud each section sits in the film (the grid grows on its own).
const LOUDNESS = { overture: 1, name: 0.65, ice: 0.7, holocene: 0.85, fields: 0.7, ages: 0.95, steam: 1.05, coal: 0.8, oil: 1.05, grid: 0.75, sun: 0.7, turn: 0.95, warning: 1.1, heat: 1.15, now: 1, future: 0.8, epilogue: 0.6, coda: 0.5, credits: 1 };

// How much of the music reaches the cathedral in each section. The patterns
// raise it further for the big moments.
const CATHEDRAL = { overture: 0.45, name: 0.3, ice: 0.55, holocene: 0.3, fields: 0.3, ages: 0.25, steam: 0.15, coal: 0.2, oil: 0.15, grid: 0.12, sun: 0.35, turn: 0.25, warning: 0.35, heat: 0.12, now: 0.2, future: 0.4, epilogue: 0.95, coda: 0.9, credits: 0.35 };

const PATTERNS = {
  // Black screen. A pedal note fades in, the chant enters over a bass that
  // steps down D, C, B flat, A, and the full organ arrives with the title.
  overture(b) {
    const { v, bar } = b;
    const B = b.beat;
    b.vowel('oh');
    if (bar === 0) {
      v.pedal(b.t, midi('D2'), 8 * B, 0.9, { attack: 5, release: 1 });
      b.level(0.08);
      b.accent(0, 0.3);
      b.chord('Dm');
    } else if (bar === 1) {
      b.level(0.16);
    } else if (bar === 2) {
      v.pedal(b.t, midi('C2'), 8 * B, 0.9, { attack: 0.8, release: 1.5 });
      v.chant(b.t, notes('D3 A3'), 8 * B, 0.75, { attack: 2.5, release: 1.5 });
      b.level(0.3);
      b.accent(0, 0.4);
      b.chord('C');
    } else if (bar === 4) {
      v.pedal(b.t, midi('Bb1'), 8 * B, 0.95, { attack: 0.8, release: 1.5 });
      v.chant(b.t, notes('D3 F3 Bb3'), 8 * B, 0.8, { attack: 1.5, release: 1.5 });
      v.organ(b.t, notes('Bb2 F3 D4'), 8 * B, 0.55, { attack: 3, release: 1.5 });
      b.level(0.45);
      b.accent(0, 0.5);
      b.chord('Bb');
    } else if (bar === 6) {
      v.pedal(b.t, midi('A1'), 8 * B, 1, { attack: 0.6, release: 1 });
      v.chant(b.t, notes('E3 A3 D4'), 4 * B, 0.9, { attack: 0.8, release: 0.6 });
      v.organ(b.t, notes('A2 E3 A3 D4'), 4 * B, 0.6, { stop: 'diapason', attack: 1.5, release: 0.5 });
      b.level(0.6);
      b.accent(0, 0.6);
      b.chord('Asus4');
    } else if (bar === 7) {
      v.chant(b.t, notes('E3 A3 C#4'), 4 * B, 1, { attack: 0.4, release: 0.6 });
      v.organ(b.t, notes('A2 E3 A3 C#4 E4'), 4 * B, 0.7, { stop: 'diapason', attack: 0.3, release: 0.4 });
      v.brass(b.at(1), notes('A2 E3 A3'), 3 * B, 0.5);
      b.level(0.72);
      b.accent(0, 0.5);
      b.chord('A');
    } else if (bar === 8) {
      // The title.
      v.pedal(b.t, midi('D2'), 8 * B, 1, { attack: 0.1, release: 2 });
      v.organ(b.t, CHORDS.Dm.full, 8 * B, 1, { stop: 'full', attack: 0.12, release: 3 });
      b.cathedral(1, 0, 0.2); // the title chord fills the whole nave
      v.chant(b.t, notes('D3 F3 A3 D4'), 8 * B, 1, { attack: 0.35, release: 2 });
      v.choir(b.t, CHORDS.Dm.pad, 8 * B, 0.8, { attack: 0.8, release: 2.5 });
      b.level(1);
      b.accent(0, 1);
      b.chord('Dm');
    } else if (bar === 9) {
      b.level(0.85);
    } else if (bar === 10) {
      v.pedal(b.t, midi('D2'), 8 * B, 0.7, { attack: 0.3, release: 2.5 });
      v.organ(b.t, notes('D3 F3 Bb3 D4 F4'), 4 * B, 0.55, { stop: 'diapason', attack: 0.4, release: 1 });
      b.cathedral(CATHEDRAL.overture, 0, 2);
      v.chant(b.t, notes('D3 F3 Bb3'), 4 * B, 0.65, { attack: 0.6, release: 1.2 });
      b.level(0.55);
      b.accent(0, 0.5);
      b.chord('Bb/D');
    } else if (bar === 11) {
      v.organ(b.t, notes('D3 A3 D4 F4'), 3.6 * B, 0.4, { attack: 0.5, release: 1.5 });
      v.chant(b.t, notes('D3 A3'), 3.5 * B, 0.45, { attack: 0.8, release: 2 });
      b.level(0.3);
      b.accent(0, 0.3);
      b.chord('Dm');
    }
  },

  // Stand asks the viewer's name: a hushed pulse on a suspended chord, over
  // a pedal that rocks between D and B flat. Loops without a seam.
  name(b) {
    const { v, bar } = b;
    const c = CHORDS[bar === 0 ? 'Dsus2' : 'Bbmaj7'];
    v.pedal(b.t, c.bass, 4 * b.beat, 0.45, { attack: 0.4, release: 0.8 });
    v.organ(b.t, bar === 0 ? notes('D3 A3') : notes('Bb2 F3'), 4 * b.beat, 0.3, { attack: 0.5, release: 0.8 });
    for (let i = 0; i < 4; i++) v.organ(b.at(i), notes('A3 D4 E4'), 0.8 * b.beat, i % 2 ? 0.26 : 0.34, { attack: 0.07, release: 0.3 });
    b.level(0.18);
    b.accent(0, bar === 0 ? 0.25 : 0.15);
    b.chord(c.name);
  },

  // The ice: cold and vast. Wide, slowly opening polysynth pads over the
  // pedal, a gliding solo line that sings in the middle register, bells
  // that strike and ring away through a long ping-pong echo, and wind.
  ice(b) {
    const { v, bar } = b;
    const B = b.beat;
    b.vowel('oo');
    if (bar === 0) b.echo(1.5 * B); // a dotted quarter
    if (bar === 0) {
      v.pedal(b.t, midi('D2'), 16 * B, 0.32, { attack: 3, release: 2 });
      v.pad(b.t, notes('D3 A3 E4'), 16 * B, 0.75, { attack: 4, release: 4, bright: 1.3 });
      v.gust(b.t, 16 * B, 0.55);
      b.chord('Dm');
    } else if (bar === 2) {
      v.pad(b.t, [midi('A4')], 8 * B, 0.4, { attack: 3, release: 3, bright: 1.3 });
    } else if (bar === 4) {
      v.pedal(b.t, midi('Bb1'), 8 * B, 0.32, { attack: 1.5, release: 2 });
      v.pad(b.t, notes('Bb2 F3 D4 A4'), 8 * B + 0.5, 0.75, { attack: 2.5, release: 4, bright: 1.3 });
      v.chant(b.t, notes('D3 A3'), 8 * B, 0.45, { attack: 3, release: 2 });
      v.gust(b.t, 16 * B, 0.65);
      b.chord('Bb');
    } else if (bar === 6) {
      v.pedal(b.t, midi('C2'), 8 * B, 0.32, { attack: 1.5, release: 2 });
      v.pad(b.t, notes('C3 G3 E4 G4'), 8 * B, 0.78, { attack: 2.5, release: 5, bright: 1.5 });
      v.chant(b.t, notes('C3 G3'), 8 * B, 0.45, { attack: 2, release: 2 });
      b.chord('C');
    }
    // The solo line, in two long phrases.
    if (bar === 1) v.lead(b.t, [[0, 'A4', 3], [3, 'C5', 1], [4, 'D5', 4], [8, 'A4', 4]], B, 0.75);
    if (bar === 4) v.lead(b.at(1), [[0, 'F4', 2], [2, 'A4', 2], [4, 'G4', 3], [7, 'F4', 1], [8, 'E4', 4], [12, 'G4', 2], [14, 'A4', 1]], B, 0.7);
    const bells = { 1: [2.5, 'E5'], 3: [1, 'A5'], 5: [3, 'D5'], 7: [0.5, 'E5'] };
    if (bells[bar]) v.bell(b.at(bells[bar][0]), midi(bells[bar][1]), 0.6, { pan: bar % 4 === 1 ? 0.35 : -0.35 });
    b.level(0.2 + bar * 0.015);
    if ([0, 3, 6].includes(bar)) b.accent(0, 0.35);
  },

  // The warm age: the high choir, and a gentle arpeggio that starts on the
  // third bar and grows by a note every two bars.
  holocene(b) {
    const { v, bar } = b;
    const c = CHORDS[['F', 'Bb', 'Dm', 'Bb', 'F', 'C'][Math.floor(bar / 2)]];
    b.vowel('ah');
    if (bar % 2 === 0) {
      v.pedal(b.t, c.bass, 8 * b.beat, 0.55, { attack: 0.5, release: 1 });
      v.choir(b.t, c.pad, 8 * b.beat + 0.2, 0.5 + bar * 0.02, { attack: 1.5, release: 1.5 });
      v.organ(b.t, c.organ, 8 * b.beat, 0.32, { attack: 0.8, release: 1 });
      if (bar >= 6) v.chant(b.t, c.chant, 8 * b.beat, 0.35, { attack: 1.2, release: 1.2 });
      b.accent(0, 0.5);
    }
    if (bar >= 2) stream(b, c.arp, { figure: grow(Math.min(6, 3 + Math.floor((bar - 2) / 2))), vel: 0.34 + (bar - 2) * 0.025 });
    b.level(0.3 + bar * 0.025);
    b.chord(c.name);
  },

  // The first fields: the warm age thinned to a waiting figure.
  fields(b) {
    const { v, bar } = b;
    const c = CHORDS[bar === 0 ? 'F' : 'Bb'];
    v.pedal(b.t, c.bass, 4 * b.beat, 0.4, { attack: 0.3, release: 0.6 });
    v.choir(b.t, c.pad, 4 * b.beat, 0.32, { attack: 0.9, release: 1 });
    stream(b, c.arp, { figure: [0, 1, 2, 1], vel: 0.28, lean: 1.2 });
    b.level(0.3);
    b.accent(0, bar === 0 ? 0.3 : 0.15);
    b.chord(c.name);
  },

  // Ten thousand years: a chord each bar, the bass moving, the figure growing
  // bar by bar, and triplets against it: three against two.
  ages(b) {
    const { v, bar } = b;
    const c = CHORDS[['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'][bar]];
    const B = b.beat;
    b.vowel('ah');
    v.pedal(b.t, c.bass, 2 * B, 0.6, { attack: 0.08, release: 0.3 });
    v.pedal(b.at(2), c.bass + 7, 2 * B, 0.5, { attack: 0.08, release: 0.3 });
    v.organ(b.t, c.organ, 4 * B, 0.35, { attack: 0.3, release: 0.5 });
    v.choir(b.t, c.pad, 4 * B, 0.42, { attack: 0.8, release: 1 });
    stream(b, c.arp, { figure: grow(Math.min(7, 3 + bar)), vel: 0.4 });
    if (bar >= 2) stream(b, c.arp.slice(3), { div: 3, figure: [0, 1, 2], vel: 0.22, kind: 'piano', lean: 1.2, pan: 0.2 });
    if (bar >= 4) v.chant(b.t, c.chant, 4 * B, 0.5, { attack: 0.4, release: 0.8 });
    b.level(0.5 + bar * 0.03);
    b.accent(0, bar % 2 === 0 ? 0.6 : 0.3);
    b.chord(c.name);
  },

  // Coal and steam: the pedal hammers eighths, a reed figure turns in
  // sixteenths like a crank, and the machine breathes.
  steam(b) {
    const { v, bar } = b;
    const c = CHORDS[['Dm', 'C', 'Dm', 'C', 'Bb', 'A'][Math.floor(bar / 2)]];
    const B = b.beat;
    b.vowel('oh');
    for (let i = 0; i < 8; i++) {
      v.pedal(b.at(i / 2), c.bass, 0.42 * B, i % 2 ? 0.5 : 0.75, { attack: 0.012, release: 0.08 });
      v.chuff(b.at(i / 2), i % 2 ? 0.3 : 0.5);
    }
    v.thump(b.t, 0.7);
    v.thump(b.at(2), 0.5);
    stream(b, c.organ, { div: 4, figure: [0, 1, 2, 1], vel: 0.32, kind: 'reed', len: 0.7, lean: 1.25 });
    if (bar >= 4) stream(b, c.arp, { figure: grow(3 + ((bar - 4) % 4)), vel: 0.3, shift: 0 });
    if (bar % 2 === 0 && bar >= 2) v.organ(b.t, c.full, 8 * B, 0.42, { stop: 'diapason', attack: 0.3, release: 0.5 });
    if (bar % 2 === 0 && bar >= 6) v.chant(b.t, c.chant, 8 * B, 0.6, { attack: 0.3, release: 0.6 });
    if (bar === 10) v.brass(b.t, notes('A2 E3 A3'), 8 * B, 0.6);
    b.level(0.55 + bar * 0.025);
    b.accent(0, bar % 2 === 0 ? 0.7 : 0.35);
    b.chord(c.name);
  },

  // The furnace, waiting for an answer: a low figure that turns and turns.
  coal(b) {
    const { v, bar } = b;
    const B = b.beat;
    const figure = bar === 0 ? notes('D2 A2 D3 A2') : notes('D2 Bb2 Eb3 Bb2');
    for (let i = 0; i < 8; i++) v.pedal(b.at(i / 2), figure[i % 4] + 12, 0.45 * B, i % 4 === 0 ? 0.55 : 0.4, { attack: 0.015, release: 0.1 });
    v.organ(b.t, bar === 0 ? notes('D3 F3 A3') : notes('Eb3 G3 Bb3'), 4 * B, 0.28, { attack: 0.25, release: 0.4 });
    for (let i = 0; i < 4; i++) v.tick(b.at(i), i === 0 ? 0.3 : 0.18, 1600);
    v.thump(b.t, 0.35);
    b.level(0.4);
    b.accent(0, bar === 0 ? 0.35 : 0.2);
    b.chord(bar === 0 ? 'Dm' : 'Eb/D');
  },

  // 1900 to 1950: oil. Heavy and sure of itself: the pedal rocks up and
  // down in eighths and the reeds answer on every off-beat, like pumpjacks;
  // an arpeggio grows and climbs; the organ fills out towards the grid.
  oil(b) {
    const { v, bar } = b;
    const B = b.beat;
    const c = CHORDS[['Dm', 'Bb', 'Dm', 'C', 'Bb', 'A'][Math.floor(bar / 2)]];
    b.vowel('oh');
    for (let i = 0; i < 8; i++) v.pedal(b.at(i / 2), c.bass + (i % 2 ? 12 : 0), 0.45 * B, i % 2 ? 0.55 : 0.8, { attack: 0.012, release: 0.08 });
    for (let i = 0; i < 4; i++) v.brass(b.at(i + 0.5), c.organ, 0.4 * B, 0.42 + bar * 0.02, { stab: true });
    v.thump(b.t, 0.6);
    v.thump(b.at(2), 0.45);
    if (bar >= 2) stream(b, c.arp, { figure: grow(Math.min(7, 3 + Math.floor((bar - 2) / 2))), vel: 0.34, kind: 'reed', len: 0.7, shift: bar >= 8 ? 12 : 0 });
    if (bar >= 8) stream(b, c.arp, { div: 4, figure: grow(3 + (bar % 4)), vel: 0.26, len: 0.6 });
    if (bar % 2 === 0 && bar >= 4) v.organ(b.t, c.full, 8 * B, 0.4 + bar * 0.02, { stop: bar >= 10 ? 'full' : 'diapason', attack: 0.2, release: 0.4 });
    if (bar % 2 === 0 && bar >= 6) v.chant(b.t, c.chant, 8 * B, 0.55, { attack: 0.3, release: 0.5 });
    b.level(0.55 + bar * 0.025);
    b.accent(0, bar % 2 === 0 ? 0.7 : 0.35);
    b.chord(c.name);
  },

  // The great acceleration. Four chords round and round, the tempo rising bar
  // by bar, a new layer every four bars, everything climbing, until it stops.
  grid(b) {
    const { v, bar } = b;
    const B = b.beat;
    const g = Math.floor(bar / 4); // which group of four bars: 0–5
    const cycle = ['Dm', 'Bb', 'C', 'A'];
    b.vowel('ah');
    // Louder bar by bar, up to the last bar.
    if (bar === 0 && b.layer) {
      let end = b.t;
      for (let k = 0; k < 23; k++) end += barSeconds('grid', k);
      b.layer.ramp(LOUDNESS.grid, 1.4, b.t, end);
    }
    // In the last four bars the chords change twice as fast.
    const halves = g === 5 ? [CHORDS[cycle[(bar * 2) % 4]], CHORDS[cycle[(bar * 2 + 1) % 4]]] : [CHORDS[cycle[bar % 4]]];
    const span = b.bpb / halves.length;
    halves.forEach((c, h) => {
      const from = h * span;
      const at = b.at(from);
      const up = g >= 3 ? 12 : 0;
      b.chord(c.name, from);
      // Pedal eighths, in octaves once the grid is running.
      for (let i = 0; i < span * 2; i++) {
        const note = c.bass + (g >= 3 && i % 2 ? 12 : 0);
        v.pedal(at + (i * B) / 2, note, 0.42 * B, i % 2 ? 0.5 : 0.72, { attack: 0.01, release: 0.07 });
      }
      // The sixteenths, growing through the four bars of each group.
      stream(b, c.arp, { div: 4, from, beats: span, figure: grow(3 + (bar % 4)), vel: 0.34 + g * 0.03, len: 0.7, shift: up });
      if (g >= 1) stream(b, c.organ, { div: 3, from, beats: span, figure: [0, 1, 2, 3, 2, 1], vel: 0.24 + g * 0.02, kind: 'organ', lean: 1.15, pan: -0.2, shift: g >= 4 ? 12 : 0 });
      if (g >= 1) v.chant(at, c.chant, span * B, 0.45 + g * 0.05, { attack: g >= 4 ? 0.08 : 0.25, release: 0.3 });
      if (g >= 2) {
        v.organ(at, c.full, span * B, 0.35 + g * 0.04, { stop: g >= 4 ? 'full' : 'diapason', attack: 0.05, release: 0.2 });
        v.brass(at, c.organ.map((n) => n + (g >= 4 ? 12 : 0)), 0.5 * B, 0.55 + g * 0.06, { stab: true });
        b.accent(from, 0.8);
      }
      if (g >= 4) {
        v.choir(at, c.pad.map((n) => n + (g >= 5 ? 12 : 0)), span * B, 0.35 + (g - 4) * 0.1, { attack: 0.3, release: 0.4 });
        stream(b, c.arp.slice(2), { div: 4, from, beats: span, figure: [4, 3, 2, 1, 0], vel: 0.22, kind: 'piano', lean: 1.1, pan: 0.25, shift: 12 });
      }
      if (g >= 2) for (let i = 0; i < span * 2; i++) v.chuff(at + (i * B) / 2, i % 2 ? 0.25 : 0.4);
    });
    if (g >= 4 && halves.length === 1) v.brass(b.at(2), halves[0].organ.map((n) => n + 12), 0.5 * B, 0.7, { stab: true });
    b.level(0.55 + (bar / 23) * 0.45);
    b.accent(0, bar % 4 === 0 ? 1 : g >= 2 ? 0.8 : 0.5);
    // The end: everything stops at once, the hall's tail with it.
    // The last two bars pour into the cathedral, so that after the cut the
    // nave is left ringing on its own.
    if (bar === 22) b.cathedral(1.6, 0, 1.5);
    if (bar === 23) {
      const end = b.t + b.dur;
      b.layer?.cut(end);
      b.duckHall(end);
    }
  },

  // 1979: sunlight on new panels, a choice. Hopeful but unsure: flutes,
  // high voices, a chord that does not quite settle.
  sun(b) {
    const { v, bar } = b;
    const B = b.beat;
    const c = CHORDS[bar === 0 ? 'F' : 'Csus2'];
    b.vowel('ah');
    v.pedal(b.t, c.bass, 4 * B, 0.32, { attack: 0.35, release: 0.5 });
    v.organ(b.t, c.organ, 4 * B, 0.3, { attack: 0.5, release: 0.5 });
    v.choir(b.t, c.pad, 4 * B + 0.3, 0.3, { attack: 1, release: 1.2 });
    stream(b, c.arp, { figure: [0, 1, 2, 1], vel: 0.22, kind: 'flute', lean: 1.15 });
    b.level(0.25);
    b.accent(0, bar === 0 ? 0.25 : 0.12);
    b.chord(c.name);
  },

  // 1979 to 1988, as the viewer chose (setTurn): towards the sun, bright
  // chords, flutes and the high choir; back to oil, the dark chords, the
  // pumping reeds and the chant. In between, some of each. Either way it
  // ends on A, into the hush of the warning.
  turn(b) {
    const { v, bar } = b;
    const B = b.beat;
    const oil = b.turn;
    const sun = 1 - oil;
    const c = CHORDS[(oil <= 0.5 ? ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Bb', 'A'] : ['Dm', 'Bb', 'Dm', 'Eb/D', 'Dm', 'Bb', 'Gm', 'A'])[bar]];
    b.vowel(oil <= 0.5 ? 'ah' : 'oh');
    v.pedal(b.t, c.bass, 2 * B, 0.5, { attack: 0.05, release: 0.3 });
    v.pedal(b.at(2), c.bass, 2 * B, 0.45, { attack: 0.05, release: 0.3 });
    v.organ(b.t, c.organ, 4 * B, 0.35, { stop: 'diapason', attack: 0.15, release: 0.4 });
    if (sun > 0.05) {
      v.choir(b.t, c.pad, 4 * B + 0.2, 0.5 * sun, { attack: 0.8, release: 1 });
      stream(b, c.arp, { figure: grow(3 + (bar % 4)), vel: 0.1 + 0.25 * sun, kind: 'flute' });
      if (bar >= 4) stream(b, c.arp.slice(3), { div: 1, figure: [0, 1, 2, 1], vel: 0.25 * sun, kind: 'piano', lean: 1.1, pan: 0.2 });
    }
    if (oil > 0.05) {
      for (let i = 0; i < 8; i++) if (i % 2) v.pedal(b.at(i / 2), c.bass + 12, 0.4 * B, 0.5 * oil, { attack: 0.012, release: 0.08 });
      for (let i = 0; i < 4; i++) v.brass(b.at(i + 0.5), c.organ, 0.4 * B, 0.5 * oil, { stab: true });
      v.chant(b.t, c.chant, 4 * B, 0.55 * oil, { attack: 0.3, release: 0.5 });
      if (bar >= 4) stream(b, c.arp, { div: 4, figure: grow(4), vel: 0.28 * oil, kind: 'reed', len: 0.6 });
    }
    if (bar === 7) v.brass(b.t, CHORDS.A.organ, 4 * B, 0.55);
    b.level(0.45 + 0.2 * oil + bar * 0.02);
    b.accent(0, bar % 2 === 0 ? 0.6 : 0.3);
    b.chord(c.name);
  },

  // 1988: the hush. One tone, held, and a clock.
  warning(b) {
    const { v, bar } = b;
    const B = b.beat;
    if (bar === 0) {
      // Each repetition's tone overlaps the next one's entry, so the loop
      // has no seam: the first fades in while the last is still sounding.
      v.organ(b.t, [midi('A4')], 8 * B + 0.4, 0.42, { attack: b.rep ? 0.8 : 0.5, release: 0.8, celeste: 2.5 });
      v.pedal(b.t, midi('D2'), 8 * B + 0.4, 0.18, { attack: b.rep ? 0.8 : 1.5, release: 1 });
    }
    for (let i = 0; i < 4; i++) v.tick(b.at(i), i === 0 ? 0.34 : 0.22, i % 2 ? 1800 : 2200);
    b.level(0.15);
    b.accent(0, bar === 0 ? 0.25 : 0.12);
    b.chord('Dm');
  },

  // 1988 to 2026: driving and dark. Chords over a held D that rub against
  // it, a chant on every beat, the sixteenths, brass rising every two bars.
  heat(b) {
    const { v, bar } = b;
    const B = b.beat;
    const c = CHORDS[['Dm', 'Eb/D', 'Dm', 'C/D', 'Dm', 'Eb/D', 'Bb/D', 'A/D', 'Dm', 'Eb/D', 'Dm', 'C/D', 'Bb/D', 'A/D', 'Eb/D', 'A/D'][bar]];
    const late = bar >= 8;
    b.vowel('ah');
    for (let i = 0; i < 8; i++) {
      v.pedal(b.at(i / 2), c.bass + (late && i % 2 ? 12 : 0), 0.42 * B, i % 2 ? 0.5 : 0.75, { attack: 0.01, release: 0.07 });
      v.chuff(b.at(i / 2), i % 2 ? 0.25 : 0.4);
    }
    v.thump(b.t, 0.6);
    stream(b, c.arp, { div: 4, figure: grow(4 + (bar % 4)), vel: 0.38, len: 0.7 });
    for (let i = 0; i < 4; i++) v.chant(b.at(i), c.chant, 0.8 * B, i === 0 ? 0.75 : 0.55, { attack: 0.04, release: 0.15 });
    v.organ(b.t, c.full, 4 * B, late ? 0.5 : 0.4, { stop: 'diapason', attack: 0.05, release: 0.2 });
    if (bar % 2 === 0) v.brass(b.t, c.organ, 8 * B, late ? 0.75 : 0.55);
    if (late) {
      v.choir(b.t, c.pad.map((n) => n + 12), 4 * B, 0.3, { attack: 0.4, release: 0.5 });
      stream(b, c.organ, { div: 3, figure: [0, 1, 2, 3, 2, 1], vel: 0.25, kind: 'organ', pan: -0.2, shift: 12 });
    }
    if (bar >= 12) v.brass(b.t, c.organ.map((n) => n + 12), 0.5 * B, 0.7, { stab: true });
    b.level(0.72 + bar * 0.015);
    b.accent(0, bar % 2 === 0 ? 0.7 : 0.4);
    b.chord(c.name);
  },

  // 2026. Two musics at once: a tense, crowded one and a clear one. Holding
  // the screen crossfades from the first to the second (setHold), and opens
  // the clear one's filter. Twelve bars: the tension climbs a step at bar 4
  // and thickens at bar 8; the clear music moves D minor, B flat, F, and
  // lands on an open D. The last bar is one chord, on the downbeat.
  now(b) {
    const { bar, tense, calm } = b;
    const B = b.beat;
    b.vowel('oh');
    const part = bar < 4 ? 0 : bar < 8 ? 1 : bar < 11 ? 2 : 3;
    const T = [
      { chant: 'D3 Eb3 A3', organ: 'D3 Eb3 A3 Bb3', arp: 'D4 Eb4 F4 A4 Bb4 D5' },
      { chant: 'Eb3 E3 Bb3', organ: 'Eb3 E3 Bb3 B3', arp: 'Eb4 E4 G4 Bb4 B4 Eb5' },
      { chant: 'D3 Eb3 A3 Bb3', organ: 'D3 Eb3 G3 A3 Bb3', arp: 'D4 Eb4 G4 A4 Bb4 D5 Eb5' },
      { chant: 'D3 Eb3 A3 Bb3', organ: 'D3 Eb3 A3 Bb3 D4 Eb4', arp: 'D4 Eb4 A4 Bb4 D5' },
    ][part];
    const C = [
      { bass: 'D2', chant: 'D3 F3 A3', organ: 'A3 D4 A4', choir: 'A4 D5 F5 A5', bell: 'D5 A5 F5 E5' },
      { bass: 'Bb1', chant: 'D3 F3 A3', organ: 'Bb3 D4 A4', choir: 'A4 D5 F5 A5', bell: 'D5 A5 F5 D5' },
      { bass: 'F2', chant: 'C3 F3 A3', organ: 'A3 C4 F4', choir: 'A4 C5 F5 A5', bell: 'C5 A5 F5 C6' },
      { bass: 'D2', chant: 'D3 A3 E4', organ: 'D3 A3 D4 E4 A4', choir: 'A4 D5 E5 A5', bell: 'D5 A5 E5 A5' },
    ][part];
    const len = bar === 10 ? 1 : bar === 11 ? 1 : 2; // bars per long note
    if (bar % 2 === 0 || bar === 11) {
      const d = len * 4 * B;
      tense.chant(b.t, notes(T.chant), d, 0.6 + part * 0.08, { attack: 0.5, release: 0.8 });
      tense.pedal(b.t, midi('D2'), d, 0.5, { attack: 0.4, release: 1 });
      tense.pedal(b.t, midi(part === 1 ? 'E2' : 'Eb2'), d, 0.22, { attack: 0.5, release: 0.8 });
      calm.pedal(b.t, midi(C.bass), d, 0.3, { attack: 0.8, release: 1 });
      calm.chant(b.t, notes(C.chant), d, 0.4, { attack: 0.8, release: 1.2 });
      calm.organ(b.t, notes(C.organ), d, 0.32, { attack: 1, release: 1 });
      calm.choir(b.t, notes(C.choir), d, 0.38 + part * 0.03, { attack: 1.2, release: bar === 11 ? 3 : 1.2 });
      b.accent(0, 0.5);
    }
    if (bar < 11) {
      tense.organ(b.t, notes(T.organ), 4 * B, 0.35 + part * 0.05, { stop: 'diapason', attack: 0.15, release: 0.3 });
      stream(b, notes(T.arp), { div: 4, figure: grow(5 + (bar % 2)), vel: 0.32 + part * 0.03, len: 0.7, voice: tense });
      if (part >= 2) stream(b, notes(T.arp), { div: 3, figure: [6, 4, 2, 5, 3, 1], vel: 0.24, kind: 'reed', len: 0.6, voice: tense, pan: 0.2 });
      const ticks = part >= 2 ? 16 : 8;
      for (let i = 0; i < ticks; i++) tense.tick(b.at((i * 4) / ticks), i % 2 ? 0.14 : 0.24, 1900);
      if (bar >= 4 && bar % 2 === 0) tense.brass(b.t, notes(T.organ), 8 * B, 0.4 + part * 0.1);
      stream(b, notes(C.bell), { div: 1, figure: [0, 1, 2, 3], vel: 0.26, kind: 'piano', lean: 1.1, voice: calm });
    } else {
      // The last bar lands: one chord on the downbeat, held.
      tense.organ(b.t, notes(T.organ), 3.5 * B, 0.7, { stop: 'full', attack: 0.05, release: 0.4 });
      tense.brass(b.t, notes(T.organ), 0.8 * B, 0.8, { stab: true });
      calm.organ(b.t, notes('D2 A2 D3 A3 D4 E4 A4'), 3.8 * B, 0.5, { stop: 'diapason', attack: 0.2, release: 0.6 });
      calm.pluck(b.t, midi('D5'), 3 * B, 0.3, { kind: 'piano' });
      b.accent(0, 1);
    }
    b.level(bar < 11 ? 0.62 + bar * 0.025 : 0.8);
    b.chord(part === 3 ? 'Dsus2' : 'Dm');
  },

  // 2100: one of three endings.
  future(b) {
    const { v, bar } = b;
    const B = b.beat;
    const outcome = b.outcome;
    if (outcome === 'better') {
      // Hopeful: major chords, space, and the last chord in D major.
      b.vowel('ah');
      const c = CHORDS[['Bb', 'F', 'Gm', 'C', 'F', 'D'][Math.floor(bar / 2)]];
      if (bar % 2 === 0) {
        v.pedal(b.t, c.bass, 8 * B, 0.5, { attack: 0.6, release: 1.2 });
        v.choir(b.t, c.pad, 8 * B + 0.2, 0.55, { attack: 1.5, release: 1.8 });
        v.organ(b.t, c.organ, 8 * B, bar === 10 ? 0.55 : 0.35, { stop: bar === 10 ? 'diapason' : 'flute', attack: 1, release: 1.5 });
        if (bar >= 4) v.chant(b.t, c.chant, 8 * B, 0.35, { attack: 1, release: 1.5 });
        b.accent(0, 0.5);
      }
      stream(b, c.arp, { figure: grow(Math.min(6, 3 + Math.floor(bar / 2))), vel: 0.3, kind: 'piano', lean: 1.15 });
      b.level(0.45 + bar * 0.015);
      b.chord(c.name);
    } else if (outcome === 'worse') {
      // Dark: a cluster, the chant low, the pedal pounding like a heart.
      b.vowel('oo');
      const c = CHORDS[['cluster', 'Eb/D', 'cluster', 'Ebm/D', 'cluster', 'cluster'][Math.floor(bar / 2)]];
      for (let i = 0; i < 4; i++) v.pedal(b.at(i), c.bass, 0.7 * B, i === 0 ? 0.6 : 0.42, { attack: 0.02, release: 0.2 });
      v.thump(b.t, 0.5);
      if (bar % 2 === 0) {
        v.chant(b.t, c.chant, 8 * B, 0.75, { attack: 1, release: 1.2 });
        v.organ(b.t, c.organ, 8 * B, 0.45, { stop: 'full', attack: 1.2, release: 1.2 });
        v.brass(b.t, notes('D3 Ab3 Eb4'), 8 * B, 0.4);
        b.accent(0, 0.6);
      }
      for (let i = 0; i < 8; i++) v.tick(b.at(i / 2), i % 2 ? 0.12 : 0.2, 1500);
      b.level(0.6 + bar * 0.01);
      b.chord(c.name);
    } else {
      // The middle road: suspended chords that never land.
      b.vowel('oo');
      const c = CHORDS[['Dsus2', 'Bbmaj7', 'Dsus2', 'Csus2', 'Bbmaj7', 'Asus4'][Math.floor(bar / 2)]];
      if (bar % 2 === 0) {
        v.pedal(b.t, c.bass, 8 * B, 0.45, { attack: 0.6, release: 1.2 });
        v.choir(b.t, c.pad, 8 * B + 0.2, 0.42, { attack: 1.5, release: 1.8 });
        v.organ(b.t, c.organ, 8 * B, 0.32, { attack: 1, release: 1.5 });
        if (bar >= 4) v.chant(b.t, c.chant, 8 * B, 0.35, { attack: 1.2, release: 1.5 });
        b.accent(0, 0.4);
      }
      stream(b, c.arp, { figure: [0, 1, 2, 1], vel: 0.26, lean: 1.2 });
      b.level(0.4);
      b.chord(c.name);
    }
  },

  // The overture's descent again, quiet: pedal, chant and a soft organ.
  epilogue(b) {
    const { v, bar } = b;
    const B = b.beat;
    b.vowel('oh');
    const steps = { 0: ['D2', 'D3 A3', null, 'Dm'], 2: ['C2', 'D3 A3', 'C3 G3 D4', 'C'], 4: ['Bb1', 'D3 F3 Bb3', 'Bb2 F3 D4', 'Bb'], 6: ['A1', 'E3 A3 D4', 'A2 E3 A3', 'Asus4'] };
    const s = steps[bar];
    if (s) {
      v.pedal(b.t, midi(s[0]), 8 * B, 0.6, { attack: bar === 0 ? 2 : 0.8, release: 1.5 });
      v.chant(b.t, notes(s[1]), bar === 6 ? 4 * B : 8 * B, 0.45, { attack: 1.5, release: 1.5 });
      if (s[2]) v.organ(b.t, notes(s[2]), 8 * B, 0.3, { attack: 1.5, release: 1.5 });
      b.accent(0, 0.3);
      b.chord(s[3]);
    }
    if (bar === 7) {
      v.chant(b.t, notes('E3 A3 C#4'), 4 * B, 0.45, { attack: 0.8, release: 1 });
      b.chord('A');
    }
    b.level(0.22 + (bar % 2) * 0.03);
  },

  // After the last line: the epilogue's calm, reduced to two bars that can
  // wait as long as they need to. Flutes, a soft pedal and a far-off choir
  // on "oo", deep in the cathedral. The chords follow the ending, and all
  // three lead home to the D minor the credits begin on.
  coda(b) {
    const { v, bar } = b;
    const B = b.beat;
    const pair = { better: ['D', 'Gm/D'], worse: ['Dm', 'Eb/D'] }[b.outcome] ?? ['Dsus2', 'Bbmaj7'];
    const c = CHORDS[pair[bar]];
    b.vowel('oo');
    // Every bar is built the same way and overlaps the next, so the loop
    // has no seam.
    v.pedal(b.t, c.bass, 4 * B, 0.3, { attack: 0.35, release: 0.5 });
    v.organ(b.t, c.organ, 4 * B, 0.3, { attack: 0.8, release: 0.5 });
    v.choir(b.t, c.pad, 4 * B + 0.3, 0.26, { attack: 1.4, release: 1.4 });
    // Small changes from one repetition to the next, so a long wait does not
    // wear: a high voice rises out of the choir, a bell sounds far off.
    if (bar === 0 && b.rep % 2 === 1) v.choir(b.at(1), [c.pad[c.pad.length - 1] + 5], 6 * B, 0.18, { attack: 2, release: 2 });
    if (bar === 1 && b.rep % 3 === 2) v.pluck(b.at(1.5), c.pad[1] + 12, 3 * B, 0.18, { kind: 'piano', pan: -0.4 });
    b.level(0.18);
    b.accent(0, bar === 0 ? 0.2 : 0.1);
    b.chord(c.name);
  },

  // The closing statement: the four chords of the grid, slow now, with the
  // figures, the chant and the high choir. Then a long fade over four bars.
  credits(b) {
    const { v, bar } = b;
    const B = b.beat;
    b.vowel('ah');
    const c = CHORDS[bar < 12 ? ['Dm', 'Bb', 'C', 'A'][bar % 4] : ['Dm', 'Bb/D', 'Dm', 'Dm'][bar - 12]];
    v.pedal(b.t, c.bass, 4 * B, 0.55, { attack: 0.3, release: 0.8 });
    stream(b, c.arp, { figure: grow(3 + (bar % 4)), vel: 0.36 });
    if (bar >= 4 && bar < 14) stream(b, c.arp.slice(3), { div: 3, figure: [0, 1, 2], vel: 0.2, kind: 'piano', lean: 1.15, pan: 0.2 });
    v.chant(b.t, c.chant, 4 * B, 0.5, { attack: 0.5, release: 1 });
    if (bar >= 4) v.choir(b.t, c.pad, 4 * B, 0.45, { attack: 0.8, release: 1.2 });
    if (bar >= 8 && bar < 12) v.organ(b.t, c.full, 4 * B, 0.55, { stop: 'full', attack: 0.3, release: 0.8 });
    else v.organ(b.t, c.organ, 4 * B, 0.3, { attack: 0.5, release: 0.8 });
    if (bar === 12) {
      b.layer?.fadeOut(b.t, 16 * B);
      b.cathedral(1, 0, 3); // fade out into the whole space
    }
    b.level(bar < 12 ? 0.5 + (bar >= 8 ? 0.15 : 0) : 0.5 * (1 - (bar - 12) / 4));
    b.accent(0, bar === 8 ? 0.8 : bar < 12 ? 0.4 : 0.15);
    b.chord(c.name);
  },
};

// ---------------------------------------------------------------------------
// The clock without sound: performance.now(), paused and resumed like an
// AudioContext.

class SilentClock {
  state = 'running';
  outputLatency = 0;
  baseLatency = 0;
  #origin = performance.now();
  #frozen = null;
  get currentTime() {
    return ((this.#frozen ?? performance.now()) - this.#origin) / 1000;
  }
  suspend() {
    this.#frozen ??= performance.now();
    this.state = 'suspended';
    return Promise.resolve();
  }
  resume() {
    if (this.#frozen != null) this.#origin += performance.now() - this.#frozen;
    this.#frozen = null;
    this.state = 'running';
    return Promise.resolve();
  }
}

// Instruments that do nothing, for the silent clock.
const SILENT = new Proxy({}, { get: () => () => {} });

// Beats since a section began, `time` seconds in. Only the grid changes tempo,
// one step per bar, so its bars are added up one by one.
function beatAt(name, time) {
  const def = SECTIONS[name];
  if (!def.bpmEnd) return time / (60 / def.bpm);
  let t = 0;
  for (let bar = 0; bar < 10000; bar++) {
    const d = barSeconds(name, Math.min(bar, def.bars - 1));
    if (time < t + d) return (bar + (time - t) / d) * def.beatsPerBar;
    t += d;
  }
  return 0;
}

// ---------------------------------------------------------------------------

// How long sound takes to reach the speakers. Some browsers and audio
// servers report nothing, or nonsense; past half a second it isn't believed.
function latency(c) {
  const value = c.outputLatency || c.baseLatency || 0;
  return Number.isFinite(value) && value > 0 && value < 0.5 ? value : 0;
}

export class Score extends EventTarget {
  #ctx = null;
  #synth = null;
  #offline = false;
  #timer = null;
  #cur = null; // the section being scheduled: { name, start, abs, time, layer, tense, calm }
  #segments = []; // recent sections and their start times, for position()
  #events = []; // events waiting to be heard, in time order
  #eventTimer = null;
  #accents = [];
  #levels = [];
  #chords = [];
  #live = new Set(); // layers that may still sound
  #queued = null;
  #running = false;
  #started = false;
  #paused = false;
  #muted = false;
  #hold = 0;
  #outcome = null;
  #turn = 0.5;
  #lastHeard = -Infinity;
  #holdLayers = null;

  // `context` is for rendering offline (see Score.render); normally leave it
  // out and the score makes its own AudioContext on start().
  constructor({ context } = {}) {
    super();
    if (context) this.#use(context);
  }

  #use(context) {
    this.#ctx = context;
    this.#offline = typeof OfflineAudioContext !== 'undefined' && context instanceof OfflineAudioContext;
    try {
      this.#synth = new Synth(context);
    } catch (error) {
      console.warn('Score: no synthesizer, the clock runs silent.', error);
      this.#synth = null;
    }
  }

  #ensure() {
    if (this.#ctx) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('no Web Audio');
      this.#use(new Context({ latencyHint: 'playback' }));
    } catch {
      this.#ctx = new SilentClock();
      this.#synth = null;
    }
    if (this.#synth) this.#synth.mute.gain.value = this.#muted ? 0 : 1;
  }

  // Start playing `section` from its first bar, a tenth of a second from now.
  // Call it from a click or key press: that is when browsers allow sound.
  start(section = 'overture') {
    if (!SECTIONS[section]) throw new Error(`Score: no section ${section}`);
    this.#ensure();
    const c = this.#ctx;
    if (c.state !== 'running' && !this.#offline) c.resume().catch(() => {});
    this.#halt(0.12);
    this.#paused = false;
    this.#queued = null;
    this.#segments = [];
    this.#accents = [];
    this.#levels = [];
    this.#chords = [];
    this.#lastHeard = -Infinity;
    this.#running = true;
    this.#started = true;
    if (this.#synth) {
      const g = this.#synth.fader.gain;
      g.cancelScheduledValues(c.currentTime);
      g.setValueAtTime(1, c.currentTime);
    }
    this.#begin(section, c.currentTime + START_DELAY);
    if (!this.#offline) {
      this.#timer = setInterval(() => this.#tick(), TICK);
      this.#tick();
    }
  }

  // Fade out and stop. start() can be called again later.
  stop() {
    if (!this.#started) return;
    this.#halt(0.6);
    this.#started = false;
    this.#segments = [];
    this.#cur = null;
    this.#paused = false;
    if (this.#ctx?.state === 'suspended' && !this.#offline) this.#ctx.resume().catch(() => {});
  }

  #halt(fade) {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#running = false;
    clearTimeout(this.#eventTimer);
    this.#events = [];
    if (!this.#synth || this.#offline) return;
    const now = this.#ctx.currentTime;
    for (const layer of this.#live) {
      layer.glide(0, now, fade / 4);
      setTimeout(() => layer.dispose(), fade * 1000 + 200);
    }
    this.#live.clear();
  }

  // Pause the whole film: the audio clock stops, and so does everything
  // that reads it.
  pause() {
    if (!this.#ctx || this.#paused) return;
    this.#paused = true;
    clearTimeout(this.#eventTimer);
    this.#ctx.suspend?.();
  }

  resume() {
    if (!this.#ctx || !this.#paused) return;
    this.#paused = false;
    Promise.resolve(this.#ctx.resume?.())
      .catch(() => {})
      .then(() => {
        if (!this.#paused) this.#arm();
      });
  }

  get paused() {
    return this.#paused;
  }

  setMuted(muted) {
    this.#muted = Boolean(muted);
    if (this.#synth) this.#synth.mute.gain.setTargetAtTime(this.#muted ? 0 : 1, this.#ctx.currentTime, 0.05);
  }

  get muted() {
    return this.#muted;
  }

  // Leave the current section at its next exit point for `name`.
  queue(name) {
    if (!SECTIONS[name]) throw new Error(`Score: no section ${name}`);
    this.#queued = name;
  }

  setHold(level) {
    this.#hold = Math.max(0, Math.min(1, Number(level) || 0));
    this.#applyHold();
  }

  // Holding brings the clear music up and the crowded one down, and opens the
  // clear one's filter from a muffled 350 Hz to fully open.
  #applyHold() {
    const layers = this.#holdLayers;
    if (!layers || !this.#synth) return;
    const h = this.#hold;
    const t = this.#ctx.currentTime;
    layers.tense.glide(1 - h, t, 0.25);
    layers.calm.glide(0.1 + 0.9 * h, t, 0.25);
    const cutoff = 350 * (18000 / 350) ** h;
    for (const f of layers.calm.filters) f.frequency.setTargetAtTime(cutoff, t, 0.25);
    // Held all the way, the music opens into the cathedral.
    if (this.#cur?.name === 'now') this.#synth.cathedral(t, CATHEDRAL.now + 0.8 * h ** 2, 0.4);
  }

  setOutcome(name) {
    this.#outcome = name;
  }

  // How the viewer answered at `sun`, for the music of `turn`: 0 = built on
  // the sun, 1 = went back to oil, 0.5 (the default) = in between. Call it
  // before `turn` is scheduled (about 0.3 s before it starts).
  setTurn(amount) {
    this.#turn = Math.max(0, Math.min(1, Number(amount) || 0));
  }

  // The listener's time: the audio clock minus the time the sound takes to
  // leave the speakers. Never goes backwards.
  #heard() {
    const c = this.#ctx;
    if (!c) return 0;
    const h = c.currentTime - latency(c);
    this.#lastHeard = Math.max(this.#lastHeard, h);
    return this.#lastHeard;
  }

  #segmentAt(h) {
    let seg = this.#segments[0];
    for (const s of this.#segments) if (s.start <= h) seg = s;
    return seg;
  }

  position() {
    if (!this.#started || !this.#segments.length) return { section: null, beat: 0, bar: 0, phraseBar: 0, bpm: 0, time: 0, started: false };
    const h = this.#heard();
    const seg = this.#segmentAt(h);
    const def = SECTIONS[seg.name];
    if (h < seg.start) return { section: seg.name, beat: 0, bar: 0, phraseBar: 0, bpm: bpmAt(seg.name, 0), time: 0, started: false };
    const time = h - seg.start;
    const beat = beatAt(seg.name, time);
    const bar = Math.floor(beat / def.beatsPerBar);
    return { section: seg.name, beat, bar, phraseBar: bar % def.bars, bpm: bpmAt(seg.name, Math.min(bar, def.bars - 1)), time, started: true };
  }

  get started() {
    return this.position().started;
  }

  // 0..1, jumps on a musical accent and fades over about half a second.
  accent() {
    if (!this.#started) return 0;
    const h = this.#heard();
    let a = 0;
    for (const x of this.#accents) if (x.t <= h) a = Math.max(a, x.v * Math.exp(-(h - x.t) * 5));
    if (this.#accents.length > 64) this.#accents = this.#accents.filter((x) => h - x.t < 2);
    return a;
  }

  // 0..1, how much music there is, gliding from bar to bar.
  level() {
    if (!this.#started) return 0;
    const h = this.#heard();
    const pts = this.#levels;
    let i = -1;
    for (let k = 0; k < pts.length; k++) if (pts[k].t <= h) i = k;
    if (i < 0) return 0;
    const cur = pts[i].v;
    const prev = i > 0 ? pts[i - 1].v : 0;
    let v = prev + (cur - prev) * Math.min(1, (h - pts[i].t) / 0.6);
    if (this.#segmentAt(h)?.name === 'now') v *= 1 - 0.5 * this.#hold;
    if (pts.length > 64 && i > 8) this.#levels = pts.slice(i - 2);
    return Math.max(0, Math.min(1, v + 0.12 * this.accent()));
  }

  // The viewer chose: an organ and chant swell answers on the next beat.
  hit() {
    if (!this.#running || this.#paused || !this.#segments.length) return;
    const c = this.#ctx;
    const h = this.#heard();
    const seg = this.#segmentAt(h);
    const beat = beatAt(seg.name, Math.max(0, h - seg.start));
    const B = 60 / bpmAt(seg.name, Math.min(Math.floor(beat / SECTIONS[seg.name].beatsPerBar), SECTIONS[seg.name].bars - 1));
    let t = Math.max(seg.start, h) + (Math.ceil(beat + 1e-6) - beat) * B;
    while (t < c.currentTime + 0.03) t += B;
    let name = 'Dm';
    for (const x of this.#chords) if (x.t <= t) name = x.name;
    const ch = CHORDS[name] ?? CHORDS.Dm;
    this.#accents.push({ t, v: 0.7 });
    const layer = seg.layer ?? this.#cur?.layer;
    if (!this.#synth || !layer) return;
    const v = this.#synth.voices(layer);
    v.organ(t, ch.organ, 2 * B, 0.45, { stop: 'diapason', attack: 0.3, release: 1.2 });
    v.chant(t, ch.chant, 2 * B, 0.5, { attack: 0.3, release: 1.2 });
  }

  // --- the scheduler ---

  #begin(name, t) {
    const layer = this.#synth ? this.#synth.layer(false, LOUDNESS[name]) : null;
    const cur = { name, start: t, abs: 0, time: t, layer };
    if (layer) this.#live.add(layer);
    this.#synth?.cathedral(t, CATHEDRAL[name], 0.8);
    if (name === 'now' && this.#synth) {
      cur.tense = this.#synth.layer();
      cur.calm = this.#synth.layer(true);
      this.#live.add(cur.tense);
      this.#live.add(cur.calm);
      this.#holdLayers = { tense: cur.tense, calm: cur.calm };
      this.#applyHold();
    }
    this.#cur = cur;
    this.#segments.push(cur);
    if (this.#segments.length > 4) this.#segments.shift();
    this.#emit(t, 'section', { name });
  }

  #tick() {
    if (!this.#running) return;
    const horizon = this.#ctx.currentTime + LOOKAHEAD;
    while (this.#running && this.#cur.time < horizon) this.#step();
  }

  // Schedule one bar, or move to the next section if this one is over.
  #step() {
    const cur = this.#cur;
    const def = SECTIONS[cur.name];
    const over = def.loop ? cur.abs > 0 && cur.abs % def.bars === 0 : cur.abs >= def.bars;
    if (over) {
      let next = null;
      if (def.loop) {
        if (this.#queued === cur.name) this.#queued = null;
        next = this.#queued;
      } else next = this.#queued ?? def.next;
      if (!def.loop || next) {
        this.#queued = null;
        this.#retire(cur);
        if (!next) {
          this.#running = false;
          clearInterval(this.#timer);
          this.#emit(cur.time, 'end', {});
          return;
        }
        this.#begin(next, cur.time);
        return;
      }
    }
    const bar = def.loop ? cur.abs % def.bars : cur.abs;
    const dur = barSeconds(cur.name, bar);
    const synth = this.#synth;
    const b = {
      name: cur.name,
      bar,
      abs: cur.abs,
      rep: Math.floor(cur.abs / def.bars),
      t: cur.time,
      dur,
      beat: dur / def.beatsPerBar,
      bpb: def.beatsPerBar,
      at: (beats) => cur.time + (beats * dur) / def.beatsPerBar,
      v: synth ? synth.voices(cur.layer) : SILENT,
      tense: synth && cur.tense ? synth.voices(cur.tense) : SILENT,
      calm: synth && cur.calm ? synth.voices(cur.calm) : SILENT,
      layer: cur.layer,
      outcome: this.#outcome ?? 'middle',
      turn: this.#turn,
      echo: (seconds) => synth?.echo(cur.time, seconds),
      vowel: (name) => {
        if (bar === 0 && synth) {
          synth.vowel('chant', cur.time, name);
          synth.vowel('choir', cur.time, name);
        }
      },
      duckHall: (t) => synth?.duckHall(t),
      cathedral: (amount, beats = 0, tau = 0.5) => synth?.cathedral(b.at(beats), amount, tau),
      accent: (beats, v) => this.#accents.push({ t: b.at(beats), v }),
      level: (v, beats = 0) => this.#levels.push({ t: b.at(beats), v }),
      chord: (name, beats = 0) => {
        this.#chords.push({ t: b.at(beats), name });
        if (this.#chords.length > 64) this.#chords.splice(0, 32);
      },
    };
    PATTERNS[cur.name](b);
    this.#emit(cur.time, 'bar', { section: cur.name, bar: cur.abs, phraseBar: bar });
    cur.abs++;
    cur.time += dur;
  }

  // A finished section's layer is let go once its last notes have rung out.
  #retire(cur) {
    if (this.#offline || !this.#synth) return;
    const layers = [cur.layer, cur.tense, cur.calm].filter(Boolean);
    const wait = (cur.time - this.#ctx.currentTime + 12) * 1000;
    setTimeout(() => {
      for (const l of layers) {
        if (!this.#live.has(l)) continue;
        this.#live.delete(l);
        l.dispose();
      }
    }, wait);
  }

  // --- events, fired when the listener hears them ---
  // Events wait in time order; one timer wakes up for the earliest, and
  // every event that is due fires in order, so `section` always comes before
  // its first `bar`.

  #emit(time, type, detail) {
    if (this.#offline) return;
    this.#events.push({ time, type, detail });
    if (this.#events.length === 1) this.#arm();
  }

  #arm() {
    clearTimeout(this.#eventTimer);
    if (this.#paused || !this.#events.length) return;
    const c = this.#ctx;
    const heard = c.currentTime - latency(c);
    this.#eventTimer = setTimeout(() => this.#flush(), Math.max(0, (this.#events[0].time - heard) * 1000));
  }

  #flush() {
    const c = this.#ctx;
    const heard = c.currentTime - latency(c) + 0.004;
    while (!this.#paused && this.#events.length && this.#events[0].time <= heard) {
      const e = this.#events.shift();
      this.dispatchEvent(new CustomEvent(e.type, { detail: e.detail }));
    }
    this.#arm();
  }

  // --- development ---

  // Render `seconds` of the score from `section` offline, for listening to
  // and measuring without a speaker. Resolves to an AudioBuffer. `solo` names
  // instruments to hear alone (e.g. ['pedal']), for balancing.
  static async render(section = 'overture', seconds = 16, { outcome = 'middle', hold = 0, turn = 0.5, sampleRate = 44100, solo = null } = {}) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    const score = new Score({ context: ctx });
    if (solo) for (const kind of KINDS) if (!solo.includes(kind.replace(/\d$/, ''))) score.#synth.inputs[kind].gain.value = 0;
    score.setOutcome(outcome);
    score.setTurn(turn);
    score.start(section);
    score.setHold(hold);
    // Schedule a little at a time, as live playback does, so the render also
    // shows what the music costs to play.
    const fill = (t) => {
      while (score.#running && score.#cur.time < Math.min(seconds, t + LOOKAHEAD)) score.#step();
    };
    for (let t = 0.25; t < seconds; t += 0.25) ctx.suspend(t).then(() => (fill(t), ctx.resume()));
    fill(0);
    return ctx.startRendering();
  }
}
