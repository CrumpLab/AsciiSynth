import {
  createVCO, createNoise, createLadder, createADSR, createVCA, createLFO,
  createCPLX, createFold, createLPG, createFNGEN, createEntropy, createRing, createDelay,
} from './modules.js';
import { Matrix, SOURCE_IDS, DEST_IDS } from './matrix.js';

const BASE_MIDI = 48; // C3

export function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

export class Engine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.modules = {};
    this.matrix = null;
    this.masterGain = null;
    this.analyser = null;
    this.currentNote = null;
    this.noteStack = [];
    this.octave = 0;
    this._onLevel = null;
  }

  async boot() {
    if (this.ready) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;

    if (!ctx.audioWorklet) {
      throw new Error('AudioWorklet unavailable — serve this over http://localhost or https://, not a bare IP or file://');
    }

    const base = new URL('./worklets/', import.meta.url);
    await ctx.audioWorklet.addModule(new URL('ladder-processor.js', base));
    await ctx.audioWorklet.addModule(new URL('entropy-processor.js', base));

    const m = this.modules;
    m.VCO1 = createVCO(ctx, 'VCO1', { baseFreq: midiToFreq(BASE_MIDI) });
    m.VCO2 = createVCO(ctx, 'VCO2', { baseFreq: midiToFreq(BASE_MIDI) });
    m.VCO2.params.tune.set(-6); // detuned by default, real synths never tune perfectly
    m.NOISE = createNoise(ctx, 'NOISE');
    m.LADDER = createLadder(ctx, 'LADDER');
    m.ADSR1 = createADSR(ctx, 'ADSR1');
    m.ADSR2 = createADSR(ctx, 'ADSR2');
    m.ADSR2.params.attack.set(0.4);
    m.ADSR2.params.decay.set(0.6);
    m.ADSR2.params.sustain.set(0.3);
    m.VCA = createVCA(ctx, 'VCA');
    m.LFO1 = createLFO(ctx, 'LFO1', { defaultRate: 4.5 });
    m.LFO2 = createLFO(ctx, 'LFO2', { defaultRate: 0.3 });
    m.CPLX = createCPLX(ctx, 'CPLX', { baseFreq: midiToFreq(BASE_MIDI) });
    m.FOLD = createFold(ctx, 'FOLD');
    m.LPG = createLPG(ctx, 'LPG');
    m.FNGEN = createFNGEN(ctx, 'FNGEN');
    m.ENTROPY = createEntropy(ctx, 'ENTROPY');
    m.RING = createRing(ctx, 'RING');
    m.DELAY = createDelay(ctx, 'DELAY');

    // --- normalled (default) signal path -----------------------------
    // EAST: VCO1 + VCO2 + NOISE -> LADDER -> VCA
    m.VCO1.outlets.OUT.connect(m.LADDER.inlets.IN);
    m.VCO2.outlets.OUT.connect(m.LADDER.inlets.IN);
    m.NOISE.outlets.OUT.connect(m.LADDER.inlets.IN);
    m.LADDER.outlets.OUT.connect(m.VCA.inlets.IN);
    m.ADSR1.outlets.OUT.connect(m.VCA.inlets.GAIN); // gain sums with VCA's own base level

    // WEST: CPLX -> FOLD -> LPG
    m.CPLX.outlets.OUT.connect(m.FOLD.inlets.IN);
    m.FOLD.outlets.OUT.connect(m.LPG.inlets.IN);

    // panner + mix bus
    const panner = ctx.createStereoPanner();
    const mix = ctx.createGain();
    mix.gain.value = 1;
    m.VCA.outlets.OUT.connect(mix);
    m.LPG.outlets.OUT.connect(mix);
    m.RING.outlets.OUT.connect(mix);
    mix.connect(m.DELAY.inlets.IN);

    const preLimiter = ctx.createGain();
    preLimiter.gain.value = 1;
    m.DELAY.outlets.OUT.connect(preLimiter);
    preLimiter.connect(panner);

    // soft-clip limiter + compressor backstop
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = '2x';
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    const master = ctx.createGain();
    master.gain.value = 0.8;

    panner.connect(shaper);
    shaper.connect(compressor);
    compressor.connect(master);

    const analyserScope = ctx.createAnalyser();
    analyserScope.fftSize = 1024;
    master.connect(analyserScope);

    const splitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 512;
    analyserR.fftSize = 512;
    master.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    master.connect(ctx.destination);

    this.masterGain = master;
    this.panner = panner;
    this.analyser = analyserScope;
    this.analyserScope = analyserScope;
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    this._mixBus = mix;
    this._preLimiter = preLimiter;

    // master-level trim used by the MASTER.LVL matrix destination
    this._masterTrimBase = 0.8;

    this.matrix = new Matrix(ctx);
    this._buildDestMap();
    this.ready = true;
  }

  _buildDestMap() {
    const m = this.modules;
    this.destMap = {
      'VCO1.FM': m.VCO1.inlets.FM,
      'VCO2.FM': m.VCO2.inlets.FM,
      'CPLX.INDEX': m.CPLX.inlets.INDEX,
      'LADDER.CUTOFF': m.LADDER.inlets.CUTOFF,
      'LADDER.IN': m.LADDER.inlets.IN,
      'FOLD.DRIVE': m.FOLD.inlets.DRIVE,
      'FOLD.IN': m.FOLD.inlets.IN,
      'LPG.STRIKE': m.LPG.inlets.STRIKE,
      'VCA.GAIN': m.VCA.inlets.GAIN,
      'RING.CARRIER': m.RING.inlets.CARRIER,
      'RING.IN': m.RING.inlets.IN,
      'DELAY.TIME': m.DELAY.inlets.TIME,
      'PAN': this.panner.pan,
      'ENTROPY.RATE': m.ENTROPY.inlets.RATE,
      'MASTER.LVL': this.masterGain.gain,
    };
    this.srcMap = {
      VCO1: m.VCO1.outlets.OUT,
      VCO2: m.VCO2.outlets.OUT,
      NOISE: m.NOISE.outlets.OUT,
      CPLX: m.CPLX.outlets.OUT,
      FOLD: m.FOLD.outlets.OUT,
      LFO1: m.LFO1.outlets.OUT,
      LFO2: m.LFO2.outlets.OUT,
      ADSR1: m.ADSR1.outlets.OUT,
      ADSR2: m.ADSR2.outlets.OUT,
      FNGEN: m.FNGEN.outlets.OUT,
      ENTROPY: m.ENTROPY.outlets.OUT,
      GATE: this._gateSrc().outlets.OUT,
      KBDCV: this._kbdCvSrc().outlets.OUT,
    };
  }

  _gateSrc() {
    if (this._gate) return this._gate;
    const src = this.ctx.createConstantSource();
    src.offset.value = 0;
    src.start();
    this._gate = { outlets: { OUT: src } };
    return this._gate;
  }

  _kbdCvSrc() {
    if (this._kbdcv) return this._kbdcv;
    const src = this.ctx.createConstantSource();
    src.offset.value = 0;
    src.start();
    this._kbdcv = { outlets: { OUT: src } };
    return this._kbdcv;
  }

  connectPin(src, dst, depth) {
    const srcNode = this.srcMap[src];
    const dstTarget = this.destMap[dst];
    this.matrix.setDepth(src, dst, depth, srcNode, dstTarget);
  }

  togglePin(src, dst) {
    const srcNode = this.srcMap[src];
    const dstTarget = this.destMap[dst];
    this.matrix.toggle(src, dst, srcNode, dstTarget);
  }

  // Monophonic with a note-priority stack: holding several keys and
  // releasing one glides back to whichever is still held, envelope intact,
  // instead of cutting the voice out from under it. `t` lets callers (the
  // sequencer) schedule exact future audio-clock times instead of "now" —
  // that's the entire point of the lookahead scheduler in scheduler.js.
  noteOn(midi, velocity = 0.9, t) {
    t = t ?? this.ctx.currentTime;
    const idx = this.noteStack.indexOf(midi);
    if (idx !== -1) this.noteStack.splice(idx, 1);
    this.noteStack.push(midi);
    this._soundNote(midi, t, true);
  }

  noteOff(midi, t) {
    t = t ?? this.ctx.currentTime;
    const idx = this.noteStack.indexOf(midi);
    if (idx !== -1) this.noteStack.splice(idx, 1);
    if (this.noteStack.length) {
      this._soundNote(this.noteStack[this.noteStack.length - 1], t, false);
    } else {
      this._releaseVoice(t);
    }
  }

  _soundNote(midi, t, retrigger) {
    const freq = midiToFreq(midi);
    this.modules.VCO1.setNoteFreq(freq, t);
    this.modules.VCO2.setNoteFreq(freq, t);
    this.modules.CPLX.setNoteFreq(freq, t);
    this._kbdcv.outlets.OUT.offset.setTargetAtTime((midi - 60) / 24, t, 0.01);
    this.currentNote = midi;
    if (retrigger) {
      this.modules.ADSR1.trigger(t);
      this.modules.ADSR2.trigger(t);
      this.modules.LPG.strikeGate(true, t);
      if (this.modules.FNGEN.params.cycle.value < 0.5) this.modules.FNGEN.trigger(t);
      this._gate.outlets.OUT.offset.setTargetAtTime(1, t, 0.003);
    }
  }

  _releaseVoice(t) {
    this.modules.ADSR1.release(t);
    this.modules.ADSR2.release(t);
    this.modules.LPG.strikeGate(false, t);
    this._gate.outlets.OUT.offset.setTargetAtTime(0, t, 0.01);
    this.currentNote = null;
  }

  panic() {
    if (!this.ready) return;
    this.noteStack = [];
    this._releaseVoice(this.ctx.currentTime);
  }

  cpuMeter() {
    // Web Audio has no exposed CPU metric; approximate from pin count + a
    // gentle idle wobble so the readout feels alive rather than fake-static.
    const base = 8 + this.matrix.count() * 1.1;
    return Math.min(97, base + Math.sin(performance.now() / 1300) * 3);
  }
}

function softClipCurve(n = 1024) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.5);
  }
  return curve;
}
