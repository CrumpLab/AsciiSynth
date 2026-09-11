// Glyph helpers — small pure functions that turn numeric state into
// the character strings the screen renderer draws.

export const BOX = {
  tl: '╔', tr: '╗', bl: '╚', br: '╝',
  h: '═', v: '║',
  teeDown: '╦', teeUp: '╩', teeRight: '╠', teeLeft: '╣', cross: '╬',
  teeDownThin: '╤', teeUpThin: '╧', // double horizontal meeting a single-line vertical
  thinH: '─', thinV: '│',
};

const BLOCKS = ' ░▒▓█';

// A horizontal meter bar of fixed width, value in [0,1].
export function meterBar(value, width) {
  const v = clamp01(value);
  const eighths = Math.round(v * width * (BLOCKS.length - 1));
  const full = Math.floor(eighths / (BLOCKS.length - 1));
  const rem = eighths % (BLOCKS.length - 1);
  let s = BLOCKS[BLOCKS.length - 1].repeat(Math.min(full, width));
  if (s.length < width) s += BLOCKS[rem];
  while (s.length < width) s += BLOCKS[0];
  return s.slice(0, width);
}

// A horizontal slider track with a knob, value in [0,1].
export function slider(value, width, knob = '●') {
  const v = clamp01(value);
  const pos = Math.round(v * (width - 1));
  let s = '';
  for (let i = 0; i < width; i++) s += i === pos ? knob : '─';
  return s;
}

// Single-cell glyph for a matrix pin depth in [-1,1]. 0 => open ('·').
export function depthGlyph(depth) {
  if (!depth) return '·';
  const mag = clamp01(Math.abs(depth));
  const idx = Math.max(1, Math.min(BLOCKS.length - 1, Math.round(mag * (BLOCKS.length - 1))));
  return BLOCKS[idx];
}

export function depthClass(depth) {
  if (!depth) return 'dim';
  return depth < 0 ? 'warn' : 'accent';
}

export function clamp01(v) { return Math.max(0, Math.min(1, v)); }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function padRight(s, w) { s = String(s); return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length); }
export function padLeft(s, w) { s = String(s); return s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s; }
export function center(s, w) {
  s = String(s);
  if (s.length >= w) return s.slice(0, w);
  const total = w - s.length;
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + s + ' '.repeat(total - left);
}

// Format helpers for panel values
export function fmtHz(hz) {
  if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + 'k';
  return Math.round(hz) + 'Hz';
}
export function fmtMs(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's';
  return Math.round(ms) + 'ms';
}
export function fmtPct(v) { return Math.round(v * 100) + '%'; }
export function fmtSigned(v, digits = 1) { return (v >= 0 ? '+' : '') + v.toFixed(digits); }
export function fmtDb(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + 'dB'; }
