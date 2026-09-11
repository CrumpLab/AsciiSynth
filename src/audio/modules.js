// Factory functions for every synth module. Each module exposes:
//   outlets  — { name: AudioNode }        things you can patch FROM
//   inlets   — { name: AudioParam|AudioNode } things you can patch TO
//   params   — [{ key,label,min,max,value,step,unit,set(v),get() }]  front-panel controls
//   dispose()
//
// Modules only know Web Audio. The matrix (matrix.js) is what turns outlets
// and inlets into a modular patch graph; the panels (ui/panels.js) are what
// turns `params` into text on screen.

import { clamp } from '../screen/glyphs.js';

function param(key, label, opts) {
  const p = {
    key, label,
    min: opts.min ?? 0, max: opts.max ?? 1,
    step: opts.step ?? 0.01,
    unit: opts.unit ?? '',
    value: opts.value ?? opts.min ?? 0,
    fmt: opts.fmt || ((v) => v.toFixed(2)),
    onSet: opts.onSet || (() => {}),
    enumOptions: opts.enumOptions || null,
  };
  p.set = (v) => { p.value = clamp(v, p.min, p.max); p.onSet(p.value); };
  p.nudge = (dir, coarse) => {
    const range = p.max - p.min;
    const step = coarse ? range / 12 : (p.step || range / 40);
    p.set(p.value + dir * step);
  };
  p.set(p.value);
  return p;
}

// Builds a pulse-width comparator curve for a WaveShaperNode: turns a
// sawtooth into a variable-width pulse by thresholding it.
function pwCurve(pw, n = 1024) {
  const curve = new Float32Array(n);
  const threshold = pw * 2 - 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = x > threshold ? 1 : -1;
  }
  return curve;
}

function foldCurve(stages, n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = (i / (n - 1)) * 2 - 1;
    for (let s = 0; s < stages; s++) {
      x = Math.sin(x * (Math.PI / 2) * 1.6);
    }
    curve[i] = x;
  }
  return curve;
}

// ---------------------------------------------------------------- VCO -----
export function createVCO(ctx, id, { baseFreq = 220 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = baseFreq;
  osc.start();

  const pwShaper = ctx.createWaveShaper();
  pwShaper.curve = pwCurve(0.5);
  const outStage = ctx.createGain();
  outStage.gain.value = 0.3;

  let wave = 'saw';
  const waves = ['saw', 'pulse', 'tri'];
  function route() {
    try { osc.disconnect(); } catch {}
    try { pwShaper.disconnect(); } catch {}
    if (wave === 'pulse') {
      osc.type = 'sawtooth';
      osc.connect(pwShaper);
      pwShaper.connect(outStage);
    } else {
      osc.type = wave === 'tri' ? 'triangle' : 'sawtooth';
      osc.connect(outStage);
    }
  }
  route();

  const params = {
    wave: param('wave', 'WAVE', { value: 0, min: 0, max: 2, step: 1, enumOptions: ['SAW', 'PLS', 'TRI'], fmt: (v) => waves[Math.round(v)].toUpperCase(),
      onSet: (v) => { wave = waves[Math.round(v)]; route(); } }),
    pw: param('pw', 'PW', { value: 0.5, min: 0.05, max: 0.95, fmt: (v) => Math.round(v * 100) + '%', onSet: (v) => { pwShaper.curve = pwCurve(v); } }),
    tune: param('tune', 'TUNE', { value: 0, min: -100, max: 100, step: 1, unit: 'ct', fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(0) + '¢',
      onSet: (v) => { osc.detune.setTargetAtTime(v, ctx.currentTime, 0.02); } }),
  };

  return {
    id,
    outlets: { OUT: outStage },
    inlets: { FM: osc.frequency },
    params,
    setNoteFreq(freq, t = ctx.currentTime) { osc.frequency.setTargetAtTime(freq, t, 0.005); },
    dispose() { try { osc.stop(); } catch {} osc.disconnect(); pwShaper.disconnect(); outStage.disconnect(); },
  };
}

// -------------------------------------------------------------- NOISE -----
export function createNoise(ctx, id) {
  const bufSize = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start();

  const tilt = ctx.createBiquadFilter();
  tilt.type = 'lowpass';
  tilt.frequency.value = 20000;

  const outStage = ctx.createGain();
  outStage.gain.value = 0.25;
  src.connect(tilt);
  tilt.connect(outStage);

  const params = {
    color: param('color', 'COLOR', { value: 0, min: 0, max: 1, step: 1, enumOptions: ['WHITE', 'PINK'], fmt: (v) => (v < 0.5 ? 'WHITE' : 'PINK'),
      onSet: (v) => { tilt.frequency.setTargetAtTime(v < 0.5 ? 20000 : 800, ctx.currentTime, 0.02); } }),
    level: param('level', 'LEVEL', { value: 0.25, fmt: (v) => Math.round(v * 100) + '%', onSet: (v) => { outStage.gain.setTargetAtTime(v, ctx.currentTime, 0.02); } }),
  };

  return {
    id, outlets: { OUT: outStage }, inlets: {}, params,
    dispose() { try { src.stop(); } catch {} src.disconnect(); tilt.disconnect(); outStage.disconnect(); },
  };
}

// ------------------------------------------------------------- LADDER -----
export function createLadder(ctx, id) {
  const inputSum = ctx.createGain();
  inputSum.gain.value = 1;
  const node = new AudioWorkletNode(ctx, 'ladder-processor');
  inputSum.connect(node);

  const params = {
    cutoff: param('cutoff', 'CUTOFF', { value: 1200, min: 20, max: 12000, step: 100, fmt: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + 'Hz',
      onSet: (v) => { node.parameters.get('cutoff').setTargetAtTime(v, ctx.currentTime, 0.01); } }),
    resonance: param('resonance', 'RESO', { value: 0.2, min: 0, max: 1.05, fmt: (v) => v.toFixed(2),
      onSet: (v) => { node.parameters.get('resonance').setValueAtTime(v, ctx.currentTime); } }),
    drive: param('drive', 'DRIVE', { value: 1, min: 0.2, max: 6, fmt: (v) => v.toFixed(1) + 'x',
      onSet: (v) => { node.parameters.get('drive').setValueAtTime(v, ctx.currentTime); } }),
  };

  return {
    id,
    outlets: { OUT: node },
    inlets: { CUTOFF: node.parameters.get('cutoff'), IN: inputSum },
    params,
    dispose() { inputSum.disconnect(); node.disconnect(); },
  };
}

// --------------------------------------------------------------- ADSR -----
export function createADSR(ctx, id) {
  const src = ctx.createConstantSource();
  src.offset.value = 0;
  src.start();
  const params = {
    attack: param('attack', 'A', { value: 0.01, min: 0.001, max: 3, fmt: (v) => v >= 1 ? v.toFixed(2) + 's' : Math.round(v * 1000) + 'ms' }),
    decay: param('decay', 'D', { value: 0.2, min: 0.001, max: 3, fmt: (v) => v >= 1 ? v.toFixed(2) + 's' : Math.round(v * 1000) + 'ms' }),
    sustain: param('sustain', 'S', { value: 0.6, min: 0, max: 1, fmt: (v) => Math.round(v * 100) + '%' }),
    release: param('release', 'R', { value: 0.3, min: 0.001, max: 5, fmt: (v) => v >= 1 ? v.toFixed(2) + 's' : Math.round(v * 1000) + 'ms' }),
  };
  function trigger(t = ctx.currentTime) {
    const { attack, decay, sustain } = params;
    const p = src.offset;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(1, t + attack.value);
    p.linearRampToValueAtTime(sustain.value, t + attack.value + decay.value);
  }
  function release(t = ctx.currentTime) {
    const p = src.offset;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(0, t + params.release.value);
  }
  return {
    id, outlets: { OUT: src }, inlets: {}, params, trigger, release,
    dispose() { try { src.stop(); } catch {} src.disconnect(); },
  };
}

// ---------------------------------------------------------------- VCA -----
export function createVCA(ctx, id) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  let levelVal = 0.7, curveVal = 0;
  function applyBase() {
    const v = curveVal < 0.5 ? levelVal : levelVal ** 2;
    gain.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
  }
  const params = {
    level: param('level', 'LEVEL', { value: 0.7, fmt: (v) => Math.round(v * 100) + '%', onSet: (v) => { levelVal = v; applyBase(); } }),
    curve: param('curve', 'CURVE', { value: 0, min: 0, max: 1, step: 1, enumOptions: ['LIN', 'EXP'], fmt: (v) => v < 0.5 ? 'LIN' : 'EXP', onSet: (v) => { curveVal = v; applyBase(); } }),
  };
  return {
    id, outlets: { OUT: gain }, inlets: { IN: gain, GAIN: gain.gain }, params,
    dispose() { gain.disconnect(); },
  };
}

// ---------------------------------------------------------------- LFO -----
export function createLFO(ctx, id, { defaultRate = 3 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = defaultRate;
  osc.start();
  const outStage = ctx.createGain();
  outStage.gain.value = 1;
  osc.connect(outStage);
  const shapes = ['sine', 'triangle', 'square', 'sawtooth'];
  const params = {
    shape: param('shape', 'SHAPE', { value: 0, min: 0, max: 3, step: 1, enumOptions: ['SIN', 'TRI', 'SQR', 'SAW'], fmt: (v) => shapes[Math.round(v)].toUpperCase(),
      onSet: (v) => { osc.type = shapes[Math.round(v)]; } }),
    rate: param('rate', 'RATE', { value: defaultRate, min: 0.02, max: 30, fmt: (v) => v.toFixed(2) + 'Hz',
      onSet: (v) => { osc.frequency.setTargetAtTime(v, ctx.currentTime, 0.01); } }),
  };
  return {
    id, outlets: { OUT: outStage }, inlets: {}, params,
    dispose() { try { osc.stop(); } catch {} osc.disconnect(); outStage.disconnect(); },
  };
}

// --------------------------------------------------------------- CPLX -----
// A complex/FM oscillator: carrier + modulator, mod index patchable at
// audio rate through the matrix (CPLX.INDEX).
export function createCPLX(ctx, id, { baseFreq = 220 } = {}) {
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = baseFreq;
  carrier.start();

  const modulator = ctx.createOscillator();
  modulator.type = 'sine';
  modulator.frequency.value = baseFreq * 1.5;
  modulator.start();

  const modIndex = ctx.createGain();
  modIndex.gain.value = 40; // Hz of deviation at index=1
  modulator.connect(modIndex);
  modIndex.connect(carrier.frequency);

  const outStage = ctx.createGain();
  outStage.gain.value = 0.3;
  carrier.connect(outStage);

  let ratio = 1.5;
  const params = {
    ratio: param('ratio', 'RATIO', { value: 1.5, min: 0.25, max: 8, step: 0.25, fmt: (v) => v.toFixed(2) + ':1',
      onSet: (v) => { ratio = v; syncRatio(); } }),
    index: param('index', 'INDEX', { value: 0.3, min: 0, max: 4, fmt: (v) => v.toFixed(2),
      onSet: (v) => { modIndex.gain.setTargetAtTime(v * 60, ctx.currentTime, 0.01); } }),
  };
  function syncRatio() { modulator.frequency.setTargetAtTime(carrier.frequency.value * ratio, ctx.currentTime, 0.01); }

  return {
    id,
    outlets: { OUT: outStage },
    inlets: { INDEX: modIndex.gain },
    params,
    setNoteFreq(freq, t = ctx.currentTime) {
      carrier.frequency.setTargetAtTime(freq, t, 0.005);
      modulator.frequency.setTargetAtTime(freq * ratio, t, 0.005);
    },
    dispose() {
      try { carrier.stop(); } catch {} try { modulator.stop(); } catch {}
      carrier.disconnect(); modulator.disconnect(); modIndex.disconnect(); outStage.disconnect();
    },
  };
}

// ---------------------------------------------------------------- FOLD ----
export function createFold(ctx, id) {
  const inputSum = ctx.createGain();
  inputSum.gain.value = 1;
  const drive = ctx.createGain();
  drive.gain.value = 1;
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  const outStage = ctx.createGain();
  outStage.gain.value = 1;

  inputSum.connect(drive);
  drive.connect(shaper);
  shaper.connect(outStage);

  const dcOffset = ctx.createConstantSource();
  dcOffset.offset.value = 0;
  dcOffset.start();
  dcOffset.connect(inputSum);
  shaper.curve = foldCurve(2);

  const params = {
    drive: param('drive', 'DRIVE', { value: 1, min: 0.1, max: 5, fmt: (v) => v.toFixed(2), onSet: (v) => { drive.gain.setTargetAtTime(v, ctx.currentTime, 0.01); } }),
    stages: param('stages', 'FOLD', { value: 2, min: 1, max: 6, step: 1, fmt: (v) => Math.round(v), onSet: (v) => { shaper.curve = foldCurve(Math.round(v)); } }),
    symmetry: param('symmetry', 'SYMM', { value: 0, min: -1, max: 1, fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2),
      onSet: (v) => { dcOffset.offset.setTargetAtTime(v * 0.5, ctx.currentTime, 0.01); } }),
  };

  return {
    id,
    outlets: { OUT: outStage },
    inlets: { DRIVE: drive.gain, IN: inputSum },
    params,
    dispose() { try { dcOffset.stop(); } catch {} inputSum.disconnect(); drive.disconnect(); shaper.disconnect(); outStage.disconnect(); dcOffset.disconnect(); },
  };
}

// ----------------------------------------------------------------- LPG ----
// Native-node low-pass gate: a strike envelope drives both a lowpass
// filter's cutoff and a VCA together, vactrol-style (asymmetric slew).
export function createLPG(ctx, id) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 200;
  filter.Q.value = 0.3;
  const vca = ctx.createGain();
  vca.gain.value = 0;
  filter.connect(vca);

  const strike = ctx.createConstantSource();
  strike.offset.value = 0;
  strike.start();

  let mode = 0; // 0=VCA 1=VCF 2=BOTH
  const modes = ['VCA', 'VCF', 'BOTH'];
  const params = {
    mode: param('mode', 'MODE', { value: 0, min: 0, max: 2, step: 1, enumOptions: ['VCA', 'VCF', 'BOTH'], fmt: (v) => modes[Math.round(v)], onSet: (v) => { mode = Math.round(v); } }),
    response: param('response', 'RESP', { value: 0.15, min: 0.005, max: 1.5, fmt: (v) => v < 0.1 ? 'fast' : v < 0.5 ? 'med' : 'slow' }),
    depth: param('depth', 'DEPTH', { value: 0.7, min: 0, max: 1, fmt: (v) => v.toFixed(2) }),
  };

  function strikeGate(open, t = ctx.currentTime) {
    const target = open ? 1 : 0;
    const tc = params.response.value * (open ? 0.3 : 1);
    strike.offset.cancelScheduledValues(t);
    strike.offset.setTargetAtTime(target, t, Math.max(0.003, tc));
    const depth = params.depth.value;
    if (mode === 0 || mode === 2) vca.gain.setTargetAtTime(open ? depth : 0, t, Math.max(0.003, tc));
    if (mode === 1 || mode === 2) filter.frequency.setTargetAtTime(open ? 200 + depth * 6000 : 150, t, Math.max(0.003, tc));
  }

  return {
    id,
    outlets: { OUT: vca },
    inlets: { IN: filter, STRIKE: filter.frequency },
    params,
    strikeGate,
    dispose() { try { strike.stop(); } catch {} filter.disconnect(); vca.disconnect(); strike.disconnect(); },
  };
}

// -------------------------------------------------------------- FNGEN -----
// A rise/fall function generator that can self-cycle (LFO-ish) or act as a
// second envelope.
export function createFNGEN(ctx, id) {
  const src = ctx.createConstantSource();
  src.offset.value = 0;
  src.start();
  let cycling = null;
  const params = {
    rise: param('rise', 'RISE', { value: 0.05, min: 0.002, max: 3, fmt: (v) => v >= 1 ? v.toFixed(2) + 's' : Math.round(v * 1000) + 'ms' }),
    fall: param('fall', 'FALL', { value: 0.4, min: 0.002, max: 5, fmt: (v) => v >= 1 ? v.toFixed(2) + 's' : Math.round(v * 1000) + 'ms' }),
    cycle: param('cycle', 'CYCLE', { value: 0, min: 0, max: 1, step: 1, enumOptions: ['OFF', 'ON'], fmt: (v) => v ? 'on' : 'off', onSet: (v) => { v ? startCycle() : stopCycle(); } }),
  };
  function segment(t = ctx.currentTime) {
    src.offset.cancelScheduledValues(t);
    src.offset.setValueAtTime(0, t);
    src.offset.linearRampToValueAtTime(1, t + params.rise.value);
    src.offset.linearRampToValueAtTime(0, t + params.rise.value + params.fall.value);
  }
  function startCycle() {
    stopCycle();
    const tick = () => { segment(); cycling = setTimeout(tick, (params.rise.value + params.fall.value) * 1000); };
    tick();
  }
  function stopCycle() { if (cycling) { clearTimeout(cycling); cycling = null; } }
  return {
    id, outlets: { OUT: src }, inlets: {}, params,
    trigger: segment,
    dispose() { stopCycle(); try { src.stop(); } catch {} src.disconnect(); },
  };
}

// ------------------------------------------------------------- ENTROPY ----
export function createEntropy(ctx, id) {
  const node = new AudioWorkletNode(ctx, 'entropy-processor');
  const outStage = ctx.createGain();
  outStage.gain.value = 1;
  node.connect(outStage);
  const params = {
    rate: param('rate', 'RATE', { value: 4, min: 0.05, max: 60, fmt: (v) => v.toFixed(1) + 'Hz',
      onSet: (v) => { node.parameters.get('rate').setValueAtTime(v, ctx.currentTime); } }),
    spread: param('spread', 'SPREAD', { value: 0, min: 0, max: 1, fmt: (v) => v.toFixed(2),
      onSet: (v) => { node.parameters.get('smooth').setValueAtTime(v, ctx.currentTime); } }),
  };
  return {
    id, outlets: { OUT: outStage }, inlets: { RATE: node.parameters.get('rate') }, params,
    dispose() { node.disconnect(); outStage.disconnect(); },
  };
}

// ---------------------------------------------------------------- RING ----
export function createRing(ctx, id) {
  const carrierParam = ctx.createGain(); // used only as a named inlet target via .gain
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const params = {
    level: param('level', 'LEVEL', { value: 0.5, fmt: (v) => Math.round(v * 100) + '%' }),
  };
  return {
    id, outlets: { OUT: gain }, inlets: { IN: gain, CARRIER: gain.gain }, params,
    dispose() { gain.disconnect(); carrierParam.disconnect(); },
  };
}

// --------------------------------------------------------------- DELAY ----
export function createDelay(ctx, id) {
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  const inputSum = ctx.createGain();
  const outStage = ctx.createGain();

  inputSum.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(outStage);
  inputSum.connect(outStage); // dry pass-through so DELAY can sit inline

  const params = {
    time: param('time', 'TIME', { value: 0.3, min: 0.01, max: 1.5, fmt: (v) => Math.round(v * 1000) + 'ms',
      onSet: (v) => { delay.delayTime.setTargetAtTime(v, ctx.currentTime, 0.01); } }),
    feedback: param('feedback', 'FDBK', { value: 0.35, min: 0, max: 0.92, fmt: (v) => Math.round(v * 100) + '%',
      onSet: (v) => { feedback.gain.setTargetAtTime(v, ctx.currentTime, 0.01); } }),
    mix: param('mix', 'MIX', { value: 0.3, min: 0, max: 1, fmt: (v) => Math.round(v * 100) + '%',
      onSet: (v) => { wet.gain.setTargetAtTime(v, ctx.currentTime, 0.01); } }),
  };

  return {
    id, outlets: { OUT: outStage }, inlets: { IN: inputSum, TIME: delay.delayTime }, params,
    dispose() { [delay, feedback, wet, inputSum, outStage].forEach((n) => n.disconnect()); },
  };
}
