// The party tune: four channels, the way a tracker would play it. Bass,
// chords as a fast arpeggio (one note every fiftieth of a second, like a C64
// or an Amiga faking a chord), a pulse-wave lead and noise drums, all made with
// Web Audio oscillators. An original tune for this example, public domain.
//
// The music is on by default, like a demo's. Browsers allow no sound before
// the visitor's first click, tap or key press, so it starts with that. Any
// element with data-music-toggle turns it on and off, and off is remembered.

const BPM = 125;
const ROW = 60 / BPM / 4; // a row is a sixteenth note
const LOOKAHEAD = 0.12; // seconds of music scheduled ahead
const VOLUME = 0.5;

// Chords by bar, as [bass root, chord notes] in note names.
const CHORDS = {
  Am: ['A1', ['A4', 'C5', 'E5']],
  F: ['F1', ['F4', 'A4', 'C5']],
  C: ['C2', ['C5', 'E5', 'G5']],
  G: ['G1', ['G4', 'B4', 'D5']],
  E: ['E1', ['E4', 'G#4', 'B4']],
  Dm: ['D2', ['D5', 'F5', 'A5']],
};

// The lead, one bar per line: note:length in rows, '-' rests.
const LEAD_A = [
  'E5:2 A5:2 C6:4 B5:2 A5:2 E5:4',
  'F5:2 A5:2 C6:4 D6:2 C6:2 A5:4',
  'G5:2 C6:2 E6:4 D6:2 C6:2 G5:4',
  'B5:4 D6:2 B5:2 G5:4 -:4',
];
const LEAD_B = [
  'A5:4 -:2 A5:2 C6:2 E6:2 D6:2 C6:2',
  'A5:6 G5:2 F5:4 A5:4',
  'G5:4 B5:4 D6:4 G6:4',
  'G#5:4 B5:4 E6:8',
];

// Parts: chords for four bars, whether the chords and the lead play.
const SONG = [
  { bars: ['Am', 'F', 'C', 'G'], arp: false, lead: null },
  { bars: ['Am', 'F', 'C', 'G'], arp: true, lead: null },
  { bars: ['Am', 'F', 'C', 'G'], arp: true, lead: LEAD_A },
  { bars: ['Am', 'F', 'G', 'E'], arp: true, lead: LEAD_B },
  { bars: ['Dm', 'Am', 'F', 'G'], arp: true, lead: null },
  { bars: ['Am', 'F', 'C', 'G'], arp: true, lead: LEAD_A },
  { bars: ['Am', 'F', 'G', 'E'], arp: true, lead: LEAD_B },
];
const LOOP_TO = 1; // after the last part, back to the second

const NAMES = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function frequency(note) {
  const [, name, octave] = note.match(/^([A-G]#?)(\d)$/);
  const midi = NAMES[name] + (Number(octave) + 1) * 12;
  return 440 * 2 ** ((midi - 69) / 12);
}

// A pulse wave with a given duty cycle, from its Fourier series.
function pulseWave(context, duty) {
  const n = 64;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return context.createPeriodicWave(real, imag);
}

export class Tune {
  constructor() {
    this.playing = false;
    this.paused = false; // the tab is hidden
    this.context = null;
    this.hits = []; // times of kicks and snares, for the copper bars to flash on
    this.onchange = null;
  }

  // Starts the tune from the top. Call it from a click or key press: that is
  // when browsers let a page make sound.
  play() {
    if (this.playing) return;
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.context = new Context();
      const c = this.context;
      c.onstatechange = () => this.onchange?.();
      this.master = c.createGain();
      this.master.gain.value = VOLUME;
      // A little room: an echo a dotted eighth later.
      const delay = c.createDelay(1);
      delay.delayTime.value = ROW * 3;
      const feedback = c.createGain();
      feedback.gain.value = 0.22;
      const wet = c.createGain();
      wet.gain.value = 0.25;
      this.master.connect(c.destination);
      this.echo = c.createGain();
      this.echo.connect(delay);
      delay.connect(feedback).connect(delay);
      delay.connect(wet).connect(this.master);
      this.waves = { thin: pulseWave(c, 0.125), quarter: pulseWave(c, 0.25), half: pulseWave(c, 0.5) };
      const noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = noise;
    }
    // Not awaited: without a gesture the context waits, and so does the song.
    this.context.resume().catch(() => {});
    this.playing = true;
    this.paused = false;
    this.part = 0;
    this.row = 0;
    this.next = this.context.currentTime + 0.08;
    this.barZero = this.next; // where bars begin, for effects that keep time
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setValueAtTime(VOLUME, this.context.currentTime);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.#schedule(), 25);
    this.#schedule();
    this.onchange?.();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.paused = false;
    clearInterval(this.timer);
    const t = this.context.currentTime;
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.3);
    setTimeout(() => !this.playing && this.context?.suspend(), 400);
    this.onchange?.();
  }

  // A hidden tab: the song holds its place (the audio clock stops with it).
  pause() {
    if (!this.playing || this.paused) return;
    this.paused = true;
    clearInterval(this.timer);
    this.context.suspend();
  }

  unpause() {
    if (!this.paused) return;
    this.paused = false;
    this.context.resume().catch(() => {});
    this.timer = setInterval(() => this.#schedule(), 25);
  }

  get running() {
    return this.playing && !this.paused && this.context?.state === 'running';
  }

  // What the listener hears now: the audio clock minus the output's delay.
  #heard() {
    const c = this.context;
    return c.currentTime - (c.outputLatency || c.baseLatency || 0);
  }

  // 0–1: how hard the last drum hit, fading fast. For effects to pulse on the beat.
  level() {
    if (!this.running) return 0;
    const t = this.#heard();
    let level = 0;
    for (const hit of this.hits) if (hit.time <= t) level = Math.max(level, hit.strength * Math.exp(-(t - hit.time) * 7));
    this.hits = this.hits.filter((h) => t - h.time < 1);
    return level;
  }

  // 0–1 through the current bar, 0 on its first beat; null when silent.
  bar() {
    if (!this.running) return null;
    const bars = (this.#heard() - this.barZero) / (ROW * 16);
    return ((bars % 1) + 1) % 1;
  }

  #schedule() {
    const c = this.context;
    while (this.next < c.currentTime + LOOKAHEAD) {
      this.#playRow(this.next);
      this.next += ROW;
      this.row++;
      if (this.row >= 64) {
        this.row = 0;
        this.part = this.part + 1 >= SONG.length ? LOOP_TO : this.part + 1;
      }
    }
  }

  #playRow(t) {
    const part = SONG[this.part];
    const bar = Math.floor(this.row / 16);
    const step = this.row % 16;
    const [root, chord] = CHORDS[part.bars[bar]];

    // Drums: kick on the beat, snare on two and four, hats in between.
    if (step === 0 || step === 8 || (step === 10 && bar % 2 === 1)) this.#kick(t);
    if (step === 4 || step === 12) this.#snare(t);
    if (step % 2 === 1 || (this.part > 1 && step % 4 === 2)) this.#hat(t, step % 4 === 2 ? 0.05 : 0.03);
    if (this.part > 3 && step === 14 && bar === 3) this.#snare(t, 0.6);

    // Bass: root and octave, bouncing.
    if (step % 2 === 0) {
      const f = frequency(root) * (step % 4 === 2 ? 2 : 1);
      this.#note('quarter', f, t, ROW * 1.8, 0.16, { cutoff: 900 });
    }

    // Chords: a 3-3-2 rhythm of fast arpeggios.
    if (part.arp && [0, 3, 6, 8, 11, 14].includes(step)) {
      this.#arpeggio(chord.map(frequency), t, ROW * (step === 6 || step === 14 ? 2 : 3) * 0.92, 0.055);
    }

    // The lead.
    if (part.lead) {
      let at = 0;
      for (const token of part.lead[bar].split(' ')) {
        const [note, length] = token.split(':');
        if (at === step && note !== '-') this.#note('thin', frequency(note), t, ROW * Number(length) * 0.95, 0.07, { vibrato: true, echo: true });
        at += Number(length);
      }
    }
  }

  #envelope(gain, t, duration, peak, release = 0.04) {
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.004);
    gain.gain.setValueAtTime(peak, t + Math.max(0.005, duration - release));
    gain.gain.linearRampToValueAtTime(0, t + duration);
  }

  #note(wave, f, t, duration, peak, { cutoff = 6000, vibrato = false, echo = false } = {}) {
    const c = this.context;
    const osc = c.createOscillator();
    osc.setPeriodicWave(this.waves[wave]);
    osc.frequency.setValueAtTime(f, t);
    if (vibrato && duration > ROW * 3) {
      // A late, gentle vibrato on long notes, from an LFO.
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = 6;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.012, t + duration * 0.6);
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + duration + 0.05);
    }
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = c.createGain();
    this.#envelope(gain, t, duration, peak);
    osc.connect(filter).connect(gain).connect(this.master);
    if (echo) gain.connect(this.echo);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  #arpeggio(notes, t, duration, peak) {
    const c = this.context;
    const osc = c.createOscillator();
    osc.setPeriodicWave(this.waves.half);
    // The chord, one note at a time, fifty times a second.
    for (let i = 0, k = 0; i * 0.02 < duration; i++, k = (k + 1) % notes.length) osc.frequency.setValueAtTime(notes[k], t + i * 0.02);
    const gain = c.createGain();
    this.#envelope(gain, t, duration, peak, 0.03);
    osc.connect(gain).connect(this.master);
    gain.connect(this.echo);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  #kick(t) {
    const c = this.context;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
    this.hits.push({ time: t, strength: 1 });
  }

  #snare(t, strength = 1) {
    const c = this.context;
    const noise = c.createBufferSource();
    noise.buffer = this.noise;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 0.8;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.5 * strength, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + 0.18);
    const body = c.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(190, t);
    body.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const bodyGain = c.createGain();
    bodyGain.gain.setValueAtTime(0.35 * strength, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    body.connect(bodyGain).connect(this.master);
    body.start(t);
    body.stop(t + 0.12);
    this.hits.push({ time: t, strength: 0.7 * strength });
  }

  #hat(t, peak) {
    const c = this.context;
    const noise = c.createBufferSource();
    noise.buffer = this.noise;
    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = c.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + 0.06);
  }
}

// -- On by default -----------------------------------------------------------------

const KEY = 'raster-harbour:music';
function remembered() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // storage can be blocked
  }
}
function remember(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Then it's on again next time.
  }
}

class Music {
  #listeners = new Set();

  constructor() {
    this.tune = new Tune();
    this.tune.onchange = () => this.#changed();
    this.wanted = remembered() !== 'off';
    // The first click, tap or key press anywhere starts the music (except on
    // a music button, which decides for itself). Moving around with Tab or the
    // arrow keys doesn't count: a screen reader needs the quiet.
    const first = (event) => {
      if (event.target instanceof Element && event.target.closest('[data-music-toggle]')) return;
      if (event.type === 'keydown' && event.key.length > 1 && event.key !== 'Enter') return;
      if (this.wanted && !this.tune.running) this.#start();
      if (this.tune.running || !this.wanted) for (const type of GESTURES) removeEventListener(type, first, true);
    };
    const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend'];
    for (const type of GESTURES) addEventListener(type, first, true);
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-music-toggle]')) this.toggle();
    });
    document.addEventListener('visibilitychange', () => (document.hidden ? this.tune.pause() : this.tune.unpause()));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.#changed());
    else this.#changed();
  }

  // Playing out loud right now.
  get playing() {
    return this.tune.running;
  }

  level() {
    return this.tune.level();
  }

  bar() {
    return this.tune.bar();
  }

  // On while waiting for a first click: the click starts it. Otherwise flips.
  toggle() {
    if (this.wanted && !this.tune.running) {
      this.#start();
      return;
    }
    this.wanted = !this.wanted;
    remember(this.wanted ? 'on' : 'off');
    if (this.wanted) this.#start();
    else this.tune.stop();
    this.#changed();
  }

  #start() {
    if (this.tune.playing) this.tune.context.resume().catch(() => {});
    else this.tune.play();
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this);
    return () => this.#listeners.delete(listener);
  }

  #changed() {
    const state = this.playing ? 'playing' : this.wanted ? 'waiting' : 'off';
    for (const el of document.querySelectorAll('[data-music-toggle]')) {
      el.setAttribute('aria-pressed', String(this.wanted));
      el.dataset.state = state;
      el.title = { playing: 'Music on. Click to turn it off.', waiting: 'Music starts with your first click or key press.', off: 'Music off. Click to play the party tune.' }[state];
    }
    for (const listener of this.#listeners) listener(this);
  }
}

export const music = new Music();
