// Original orchestral space-adventure miniature. All instruments, engine noise,
// and the reverberation impulse are synthesized here; no audio files or samples.
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const BEAT = .625;
const CHORDS = [
  [48, 55, 60, 64, 67, 74], // C add 9
  [45, 52, 57, 60, 64, 71], // A minor 9
  [53, 60, 65, 69, 72, 76], // F major 7
  [43, 50, 55, 62, 67, 69], // G suspended
  [48, 55, 60, 64, 71, 74], // arrival: C major 9
  [48, 55, 64, 67, 72, 76],
];
// An original rising call and answering phrase, not a franchise theme.
const MELODY = [
  [.8, 67, .8], [1.8, 72, .6], [2.6, 74, .6], [3.3, 76, 1],
  [4.6, 71, .8], [5.6, 69, .5], [6.3, 72, .5], [7, 76, 1.1],
  [8.5, 77, .7], [9.4, 76, .6], [10.2, 72, .6], [11, 69, 1],
  [12.5, 74, .8], [13.5, 79, .7], [14.4, 78, .7], [15.3, 74, .5],
  [16.2, 76, 2], [19, 74, 1.1], [20.6, 72, 3],
];

function ramp(param, value, now, duration) {
  // Hold the current envelope when skipping, muting, or replaying mid-fade.
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
  else { const current = param.value; param.cancelScheduledValues(now); param.setValueAtTime(current, now); }
  param.linearRampToValueAtTime(value, now + duration);
}

function noiseBuffer(context, seconds, decay = 0) {
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  let seed = 72819;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 2147483648 - 1) * (decay ? Math.exp(-i / data.length * decay) : 1);
    }
  }
  return buffer;
}

export function createAudioGraph(context) {
  const master = context.createGain(); master.gain.value = 0;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -12; limiter.knee.value = 12;
  limiter.ratio.value = 4; limiter.attack.value = .004; limiter.release.value = .25;
  master.connect(limiter); limiter.connect(context.destination);
  const music = context.createGain(); music.gain.value = 0; music.connect(master);
  const score = context.createGain(); score.connect(music);
  const reverb = context.createConvolver(); reverb.buffer = noiseBuffer(context, 2.4, 6);
  const wet = context.createGain(); wet.gain.value = .3;
  score.connect(reverb); reverb.connect(wet); wet.connect(music);
  const engine = context.createGain(); engine.gain.value = 0; engine.connect(master);
  const effects = context.createGain(); effects.gain.value = .5; effects.connect(master);
  const noise = noiseBuffer(context, 3);
  const air = context.createBufferSource(); air.buffer = noise; air.loop = true;
  const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 140; filter.Q.value = .5;
  const airLevel = context.createGain(); airLevel.gain.value = .35;
  air.connect(filter); filter.connect(airLevel); airLevel.connect(engine); air.start();
  for (const frequency of [46, 69.1, 92]) {
    const oscillator = context.createOscillator(); oscillator.frequency.value = frequency;
    const level = context.createGain(); level.gain.value = .19;
    oscillator.connect(level); level.connect(engine); oscillator.start();
  }
  const horn = context.createPeriodicWave(new Float32Array(8), new Float32Array([0, 1, .48, .29, .19, .12, .07, .035]));
  return { master, music, score, engine, effects, filter, noise, horn };
}

// Scheduling uses the audio clock. An unlock halfway through the intro joins
// the current musical phrase instead of replaying the opening out of sync.
export function scheduleApproach(context, graph, elapsed = 0) {
  const bus = context.createGain(); bus.connect(graph.score);
  const sources = new Set();
  const origin = context.currentTime + .035 - elapsed;
  function track(source, nodes) {
    sources.add(source);
    source.onended = () => { sources.delete(source); source.disconnect(); for (const node of nodes) node.disconnect(); };
  }
  function note(midi, at, duration, kind, volume, pan = 0) {
    const remaining = at + duration - elapsed;
    if (remaining <= .04) return;
    const start = Math.max(context.currentTime + .035, origin + at);
    const length = Math.min(duration, remaining);
    const envelope = context.createGain(); envelope.gain.value = 0;
    const attack = Math.min(kind === 'strings' ? .55 : kind === 'horn' ? .12 : .008, length * .3);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + attack);
    envelope.gain.setValueAtTime(volume * .75, start + Math.max(attack, length * .65));
    envelope.gain.exponentialRampToValueAtTime(.0001, start + length + .3);
    const stereo = context.createStereoPanner(); stereo.pan.value = pan;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = .6;
    filter.frequency.setValueAtTime(kind === 'horn' ? 600 : kind === 'strings' ? 1800 : 4500, start);
    if (kind === 'horn') {
      filter.frequency.linearRampToValueAtTime(2200, start + attack + .12);
      filter.frequency.linearRampToValueAtTime(800, start + length + .3);
    }
    filter.connect(envelope); envelope.connect(stereo); stereo.connect(bus);
    const detunes = kind === 'strings' ? [-7, 7] : [0];
    let finished = 0;
    for (const detune of detunes) {
      const oscillator = context.createOscillator(); oscillator.frequency.value = hz(midi); oscillator.detune.value = detune;
      if (kind === 'horn') oscillator.setPeriodicWave(graph.horn);
      else oscillator.type = kind === 'strings' ? 'triangle' : 'sine';
      oscillator.connect(filter); sources.add(oscillator);
      oscillator.onended = () => {
        sources.delete(oscillator); oscillator.disconnect();
        if (++finished === detunes.length) { filter.disconnect(); envelope.disconnect(); stereo.disconnect(); }
      };
      oscillator.start(start); oscillator.stop(start + length + .35);
    }
  }
  CHORDS.forEach((chord, bar) => {
    const at = bar * 4 * BEAT;
    chord.forEach((pitch, i) => note(pitch, at, 3.2, 'strings', .016, (i - 2.5) / 4));
    note(chord[0] - 12, at, 2.7, 'strings', .025);
    for (let i = 0; i < 8; i++) {
      note(chord[2 + i % 4] + 12, at + i * BEAT / 2, .5, 'bell', .028, Math.sin(i * 1.7) * .7);
    }
  });
  for (const [beat, pitch, duration] of MELODY) note(pitch, beat * BEAT, duration * BEAT, 'horn', .105, -.12);
  // Engine flyby: a filtered noise swell underneath the camera's final approach.
  if (elapsed < 10) {
    const start = context.currentTime + .035;
    const end = origin + 10.2;
    const source = context.createBufferSource(); source.buffer = graph.noise; source.loop = true;
    const filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = .65;
    filter.frequency.setValueAtTime(180 + elapsed * 60, start);
    filter.frequency.exponentialRampToValueAtTime(1100, Math.max(start + .05, origin + 8.8));
    filter.frequency.exponentialRampToValueAtTime(180, end);
    const envelope = context.createGain(); envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(.13, Math.max(start + .06, origin + 8.7));
    envelope.gain.linearRampToValueAtTime(0, end);
    source.connect(filter); filter.connect(envelope); envelope.connect(bus);
    source.start(start); source.stop(end + .1); track(source, [filter, envelope]);
  }
  return {
    stop() {
      ramp(bus.gain, 0, context.currentTime, .08);
      for (const source of sources) { try { source.stop(context.currentTime + .1); } catch { /* Already ended. */ } }
      setTimeout(() => bus.disconnect(), 150);
    },
  };
}

export class Sound {
  constructor(onChange = () => {}) {
    this.enabled = true;
    this.available = Boolean(window.AudioContext || window.webkitAudioContext);
    this.phase = 'bridge'; this.timeline = null; this.hidden = document.hidden;
    this.onChange = onChange;
  }
  get playing() { return this.enabled && !this.hidden && this.context?.state === 'running'; }
  get waiting() { return this.available && this.enabled && !this.playing; }
  ensureContext() {
    if (this.context || !this.available) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      this.context = new Audio(); this.graph = createAudioGraph(this.context);
      this.context.onstatechange = () => { if (this.playing) this.sync(); this.onChange(); };
    } catch {
      void this.context?.close().catch(() => {});
      this.context = null; this.graph = null; this.available = false;
    }
  }
  unlock() {
    if (!this.enabled || this.hidden || !this.available) return;
    this.ensureContext();
    if (!this.context) { this.onChange(); return; }
    // resume() can remain pending under autoplay policy. Never await it in the
    // scene lifecycle; a subsequent trusted gesture makes another attempt.
    void this.context.resume().then(() => {
      if (this.playing) this.sync();
      else if (this.hidden) void this.context.suspend().catch(() => {});
      this.onChange();
    }).catch(() => this.onChange());
    this.onChange();
  }
  sync() {
    const now = this.context.currentTime;
    ramp(this.graph.master.gain, .6, now, .3);
    if (this.timeline && this.scheduledTimeline !== this.timeline) {
      this.run?.stop();
      const elapsed = (performance.now() - this.timeline.started) / 1000;
      if (elapsed < 15 && (!this.timeline.arrived || performance.now() - this.timeline.arrived < 6000)) {
        this.run = scheduleApproach(this.context, this.graph, elapsed);
      }
      this.scheduledTimeline = this.timeline;
    }
    if (this.phase === 'intro') {
      ramp(this.graph.music.gain, .75, now, .65);
      ramp(this.graph.engine.gain, .16, now, 1.5);
      ramp(this.graph.filter.frequency, 600, now, 7);
    } else {
      // On first unlock in the bridge there is no late intro fanfare.
      const remaining = this.timeline?.arrived ? Math.max(0, 6 - (performance.now() - this.timeline.arrived) / 1000) : 0;
      ramp(this.graph.music.gain, 0, now, remaining || .05);
      ramp(this.graph.engine.gain, .035, now, remaining || .6);
      ramp(this.graph.filter.frequency, 140, now, remaining || .6);
    }
  }
  startIntro() {
    this.phase = 'intro'; this.timeline = { started: performance.now(), arrived: null };
    if (this.playing) this.sync();
    this.unlock();
  }
  enterBridge() {
    if (this.phase === 'intro' && this.timeline) this.timeline.arrived = performance.now();
    this.phase = 'bridge';
    if (this.playing) this.sync();
    this.unlock();
  }
  toggle() {
    if (!this.available) return;
    if (this.waiting && !this.hidden) { this.unlock(); return; }
    this.enabled = !this.enabled;
    if (!this.enabled && this.context) ramp(this.graph.master.gain, 0, this.context.currentTime, .08);
    else this.unlock();
    this.onChange();
  }
  setHidden(hidden) {
    this.hidden = hidden;
    if (hidden && this.context) {
      this.run?.stop(); this.run = null; this.scheduledTimeline = null;
      void this.context.suspend().catch(() => {});
    } else this.unlock();
    this.onChange();
  }
  ping(incoming) {
    if (!this.playing) return;
    const c = this.context, o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(this.graph.effects);
    o.frequency.setValueAtTime(incoming ? 280 : 650, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(incoming ? 700 : 130, c.currentTime + .6);
    g.gain.setValueAtTime(.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(.08, c.currentTime + .04);
    g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .7); o.start(); o.stop(c.currentTime + .72);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
}
