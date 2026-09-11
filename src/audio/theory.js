// Minimal music theory: note naming and a scale/key system the sequencer
// randomizer and quantizer both lean on.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi) {
  const n = NOTE_NAMES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  return n + oct;
}

// Interval sets from the root, in semitones.
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorpent: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholetone: [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// Short, fixed-width tags for cramped display — kept ≤4 chars, no collisions.
export const SCALE_ABBR = {
  major: 'maj', minor: 'min', dorian: 'dor', phrygian: 'phr', lydian: 'lyd',
  mixolydian: 'mix', locrian: 'loc', pentatonic: 'pent', minorpent: 'mpnt',
  blues: 'blu', wholetone: 'wt', chromatic: 'chr',
};

const FLATS = { db: 'c#', eb: 'd#', gb: 'f#', ab: 'g#', bb: 'a#', fb: 'e', cb: 'b' };

// Parses "c", "C#", "eb", or a bare 0-11 into a pitch class; returns
// `fallback` (default: unchanged/0) on anything unrecognized.
export function parseKey(input, fallback = 0) {
  if (input == null || input === '') return fallback;
  const s = String(input).trim().toLowerCase();
  if (/^\d+$/.test(s)) return ((parseInt(s, 10) % 12) + 12) % 12;
  const norm = FLATS[s] || s;
  const idx = NOTE_NAMES.findIndex((n) => n.toLowerCase() === norm);
  return idx === -1 ? fallback : idx;
}

// Shifts `midi` by the smallest signed number of semitones that lands its
// pitch class on a tone of the scale rooted at `rootPc`.
export function nearestInScale(midi, rootPc, intervals) {
  const pc = (((midi - rootPc) % 12) + 12) % 12;
  let best = intervals[0], bestDist = 99;
  for (const iv of intervals) {
    const d = Math.min(Math.abs(iv - pc), 12 - Math.abs(iv - pc));
    if (d < bestDist) { bestDist = d; best = iv; }
  }
  let delta = best - pc;
  if (delta > 6) delta -= 12;
  if (delta < -6) delta += 12;
  return midi + delta;
}

// A random MIDI note within ±spread of `center`, snapped onto the scale.
export function randomNoteInScale(rng, rootPc, intervals, center, spread) {
  const raw = center + Math.floor(rng() * (spread * 2 + 1)) - spread;
  return nearestInScale(raw, rootPc, intervals);
}
