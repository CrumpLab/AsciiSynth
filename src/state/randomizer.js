import { SOURCE_IDS, DEST_IDS } from '../audio/matrix.js';
import { mulberry32 } from '../util/rng.js';

// Params keyed by these names get sampled on a log curve instead of linear —
// cutoff/rate/time-ish ranges span two or three orders of magnitude, and a
// linear draw would almost always land near the top of the range.
const LOG_KEYS = new Set(['cutoff', 'rate', 'attack', 'decay', 'release', 'rise', 'fall', 'time']);
// Keeps a couple of "how loud/open is this stage" params off the floor, so
// a generated patch is never silent by pure bad luck.
const MIN_FLOOR = { level: 0.3, depth: 0.35 };

function randRange(rng, lo, hi, log) {
  if (log && lo > 0) {
    const a = Math.log(lo), b = Math.log(hi);
    return Math.exp(a + rng() * (b - a));
  }
  return lo + rng() * (hi - lo);
}

export function randomizeParams(engine, rng) {
  for (const mod of Object.values(engine.modules)) {
    for (const [key, p] of Object.entries(mod.params)) {
      if (p.enumOptions) {
        p.set(p.min + Math.floor(rng() * (p.max - p.min + 1)));
        continue;
      }
      const lo = MIN_FLOOR[key] != null ? Math.max(p.min, MIN_FLOOR[key]) : p.min;
      let v = randRange(rng, lo, p.max, LOG_KEYS.has(key));
      if (p.step) v = p.min + Math.round((v - p.min) / p.step) * p.step; // snap to the knob's own step (e.g. FOLD stages stays a whole number)
      p.set(v);
    }
  }
}

export function randomizeMatrix(engine, rng, count) {
  engine.matrix.clear();
  const n = count ?? 4 + Math.floor(rng() * 7);
  for (let i = 0; i < n; i++) {
    const src = SOURCE_IDS[Math.floor(rng() * SOURCE_IDS.length)];
    const dst = DEST_IDS[Math.floor(rng() * DEST_IDS.length)];
    engine.connectPin(src, dst, rng() * 2 - 1);
  }
  return n;
}

const ADJ = [
  'uncertain', 'ghost', 'carrier', 'fractured', 'amber', 'recovered', 'drifting',
  'unlabeled', 'latent', 'feral', 'patient', 'borrowed', 'quiet', 'burnt',
  'phantom', 'obsolete', 'untraceable', 'half-erased', 'nameless', 'idle',
];
const NOUN = [
  'lattice', 'bloom', 'kernel', 'drift', 'fault', 'signal', 'choir', 'static',
  'vessel', 'husk', 'echo', 'fold', 'gate', 'tide', 'carrier', 'stem',
  'filament', 'uncertainty', 'putney', 'transient',
];

export function randomName(rng) {
  const adj = ADJ[Math.floor(rng() * ADJ.length)];
  const noun = NOUN[Math.floor(rng() * NOUN.length)];
  return rng() < 0.45 ? `${adj} ${noun} ${1 + Math.floor(rng() * 99)}` : `${adj} ${noun}`;
}

// Generates and applies a full random patch (every module param plus a
// fresh matrix), returning its name and the seed that reproduces it.
export function generatePatch(engine, seed) {
  const s = (seed != null ? seed : Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const rng = mulberry32(s);
  randomizeParams(engine, rng);
  randomizeMatrix(engine, rng);
  const name = `${randomName(rng)} [${s}]`;
  return { name, seed: s };
}
