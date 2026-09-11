import { BOX, meterBar, slider, depthGlyph, depthClass, padRight, padLeft, center, clamp01 } from '../screen/glyphs.js';
import { SOURCE_IDS, DEST_IDS } from '../audio/matrix.js';
import { NOTE_NAMES, noteName, SCALE_ABBR } from '../audio/theory.js';
import * as L from './layout.js';

const MODULE_LABELS = {
  VCO1: 'VCO-1', VCO2: 'VCO-2', NOISE: 'NOISE', LADDER: 'LADDER',
  ADSR1: 'ADSR-1', ADSR2: 'ADSR-2', VCA: 'VCA',
  CPLX: 'CPLX', FOLD: 'FOLD', LPG: 'LPG', FNGEN: 'FNGEN',
  ENTROPY: 'ENTROPY', RING: 'RING', DELAY: 'DELAY',
};

export const EAST_MODULES = ['VCO1', 'VCO2', 'NOISE', 'LADDER', 'ADSR1', 'ADSR2', 'VCA'];
export const WEST_MODULES = ['CPLX', 'FOLD', 'LPG', 'FNGEN', 'ENTROPY', 'RING', 'DELAY'];
const ADSR_SET = new Set(['ADSR1', 'ADSR2']);

export const SRC_LABELS = { VCO1: 'VCO1', VCO2: 'VCO2', NOISE: 'NOISE', CPLX: 'CPLX', FOLD: 'FOLD', LFO1: 'LFO-1', LFO2: 'LFO-2', ADSR1: 'ADSR1', ADSR2: 'ADSR2', FNGEN: 'FNGEN', ENTROPY: 'ENTRPY', GATE: 'GATE', KBDCV: 'KBDCV' };
export const DEST_CODES = { 'VCO1.FM': 'V1', 'VCO2.FM': 'V2', 'CPLX.INDEX': 'CX', 'LADDER.CUTOFF': 'LC', 'LADDER.IN': 'LI', 'FOLD.DRIVE': 'FD', 'FOLD.IN': 'FI', 'LPG.STRIKE': 'LS', 'VCA.GAIN': 'VG', 'RING.CARRIER': 'RC', 'RING.IN': 'RI', 'DELAY.TIME': 'DT', 'PAN': 'PN', 'ENTROPY.RATE': 'ER', 'MASTER.LVL': 'ML' };


// ------------------------------------------------------------- frame -----
export function drawFrame(screen) {
  const { cols, rows } = screen;
  screen.put(0, L.ROW_TOP, BOX.tl); screen.hline(1, L.ROW_TOP, cols - 2, BOX.h); screen.put(cols - 1, L.ROW_TOP, BOX.tr);
  screen.put(0, L.ROW_TITLE, BOX.v); screen.put(cols - 1, L.ROW_TITLE, BOX.v);
  hsep(screen, L.ROW_HDR_SEP, [L.SEP1_X, L.SEP2_X], BOX.teeRight, BOX.teeDownThin, BOX.teeLeft);
  for (let y = L.BODY_Y; y < L.BODY_Y + L.BODY_H; y++) {
    screen.put(0, y, BOX.v); screen.put(L.SEP1_X, y, BOX.thinV); screen.put(L.SEP2_X, y, BOX.thinV); screen.put(cols - 1, y, BOX.v);
  }
  hsep(screen, L.ROW_FOOT_SEP, [L.SEP1_X, L.SEP2_X], BOX.teeRight, BOX.teeUpThin, BOX.teeLeft);
  screen.put(0, L.ROW_SEQ, BOX.v); screen.put(cols - 1, L.ROW_SEQ, BOX.v);
  hsep(screen, L.ROW_SEQ_SEP, [], BOX.teeRight, BOX.h, BOX.teeLeft);
  screen.put(0, L.ROW_METER, BOX.v); screen.put(cols - 1, L.ROW_METER, BOX.v);
  hsep(screen, L.ROW_METER_SEP, [], BOX.teeRight, BOX.h, BOX.teeLeft);
  screen.put(0, L.ROW_CMD, BOX.v); screen.put(cols - 1, L.ROW_CMD, BOX.v);
  screen.put(0, L.ROW_BOTTOM, BOX.bl); screen.hline(1, L.ROW_BOTTOM, cols - 2, BOX.h); screen.put(cols - 1, L.ROW_BOTTOM, BOX.br);
}

function hsep(screen, y, teeXs, left, teeCh, right) {
  screen.put(0, y, left);
  screen.hline(1, y, screen.cols - 2, BOX.h);
  for (const x of teeXs) screen.put(x, y, teeCh);
  screen.put(screen.cols - 1, y, right);
}

// ------------------------------------------------------------- title -----
export function drawTitleBar(screen, state) {
  const uptime = fmtUptime(Date.now() - state.epoch);
  const cpu = Math.round(state.engine.ready ? state.engine.cpuMeter() : 0);
  const dirty = state.dirty ? '*' : '';
  const left = ` ASCIISYNTH  SYS/7 ▸ "${state.systemName}"`;
  const right = `PATCH: ${state.patchName}${dirty}   up ${uptime}   cpu ${meterBar(cpu / 100, 7)} ${String(cpu).padStart(2)}%  `;
  screen.text(1, L.ROW_TITLE, padRight(left, 46), 'bright');
  screen.text(47, L.ROW_TITLE, padRight(right, screen.cols - 48), 'dim');
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// Flattens a rack's modules into one selectable param list — this is what
// Up/Down walks through, and what a nudge (left/right) applies to.
export function flattenRack(moduleIds, engine) {
  const out = [];
  for (const modId of moduleIds) {
    const mod = engine.modules[modId];
    for (const key of Object.keys(mod.params)) out.push({ modId, key });
  }
  return out;
}

export function drawRack(screen, x, y, w, h, moduleIds, engine, tag, selectedFlatIndex, active) {
  let cy = y;
  let flatIdx = 0;
  const bottom = y + h;
  moduleIds.forEach((modId, idx) => {
    if (cy >= bottom) return;
    const mod = engine.modules[modId];
    const keys = Object.keys(mod.params);
    const moduleStart = flatIdx;
    const isFocusedModule = selectedFlatIndex >= moduleStart && selectedFlatIndex < moduleStart + keys.length;
    const headerCls = isFocusedModule ? (active ? 'accent' : 'bright') : 'bright';
    let header = `▸ ${MODULE_LABELS[modId] || modId}`;
    if (idx === 0) header = padRight(header, w - tag.label.length) + tag.label;
    screen.text(x, cy, padRight(header, w), headerCls);
    cy++;
    if (ADSR_SET.has(modId)) {
      cy = drawAdsrQuad(screen, x, cy, w, mod, selectedFlatIndex - moduleStart, active);
      flatIdx += keys.length;
    } else {
      keys.forEach((key, pi) => {
        if (cy >= bottom) return;
        const selected = flatIdx === selectedFlatIndex;
        drawParamRow(screen, x, cy, w, mod.params[key], selected && active);
        cy++; flatIdx++;
      });
    }
    if (idx < moduleIds.length - 1 && cy < bottom) cy++; // spacer between modules
  });
}

function drawParamRow(screen, x, y, w, p, selected) {
  const prefix = selected ? '› ' : '  ';
  const labelW = 6;
  const valueW = 6;
  screen.text(x, y, prefix, selected ? 'accent' : '');
  screen.text(x + 2, y, padRight(p.label, labelW), selected ? 'accent' : 'dim');
  const ctrlX = x + 2 + labelW + 1;
  if (p.enumOptions) {
    const ctrlW = w - (2 + labelW + 1);
    const txt = center(`‹ ${p.fmt(p.value)} ›`, ctrlW);
    screen.text(ctrlX, y, txt, selected ? 'accent' : '');
  } else {
    const ctrlW = w - (2 + labelW + 1 + 1 + valueW);
    const t = clamp01((p.value - p.min) / (p.max - p.min || 1));
    screen.text(ctrlX, y, slider(t, Math.max(3, ctrlW)), selected ? 'accent' : 'dim');
    screen.text(ctrlX + Math.max(3, ctrlW) + 1, y, padLeft(p.fmt(p.value), valueW), selected ? 'accent' : '');
  }
}

function drawAdsrQuad(screen, x, y, w, mod, selectedSub, active) {
  const keys = ['attack', 'decay', 'sustain', 'release'];
  const letters = ['A', 'D', 'S', 'R'];
  const segW = Math.floor((w - 2) / 4);
  let cx = x + 2;
  keys.forEach((k, i) => {
    const p = mod.params[k];
    const t = clamp01((p.value - p.min) / (p.max - p.min || 1));
    const bar = meterBar(t, Math.max(2, segW - 2));
    screen.text(cx, y, letters[i] + bar, i === selectedSub ? (active ? 'accent' : 'bright') : 'dim');
    cx += segW;
  });
  return y + 1;
}

// ------------------------------------------------------------ matrix -----
export function drawMatrix(screen, x, y, w, h, engine, focus, notesLines, epoch) {
  const count = engine.matrix.count();
  screen.text(x, y, padRight(`ROUTING MATRIX`, w - 10), 'bright');
  screen.text(x + w - 10, y, padLeft(`[${String(count).padStart(2, '0')}/${DEST_IDS.length}]`, 10), 'dim');
  let cy = y + 1;
  const labelW = 6;
  let header = ' '.repeat(labelW);
  for (const dst of DEST_IDS) header += DEST_CODES[dst];
  screen.text(x, cy, header, 'dim');
  cy++;
  SOURCE_IDS.forEach((src, ri) => {
    let line = padRight(SRC_LABELS[src], labelW);
    screen.text(x, cy, line, focus.panel === 'MATRIX' && focus.row === ri ? 'accent' : 'dim');
    DEST_IDS.forEach((dst, ci) => {
      const depth = engine.matrix.getDepth(src, dst);
      const glyph = depthGlyph(depth);
      const isCursor = focus.panel === 'MATRIX' && focus.row === ri && focus.col === ci;
      const cls = isCursor ? 'cursor' : depthClass(depth);
      screen.put(x + labelW + ci * 2, cy, glyph, cls);
    });
    cy++;
  });
  cy++;
  if (focus.panel === 'MATRIX') {
    const src = SOURCE_IDS[focus.row], dst = DEST_IDS[focus.col];
    const depth = engine.matrix.getDepth(src, dst);
    const line = `› ${SRC_LABELS[src]} ▸ ${dst}   depth ${(depth >= 0 ? '+' : '') + depth.toFixed(2)}`;
    screen.text(x, cy, padRight(line, w), 'accent');
  } else {
    screen.text(x, cy, padRight('› move here to patch (tab)', w), 'dim');
  }
  cy += 2;
  if (cy < y + h) {
    screen.text(x, cy, '◇ LOG ◇', 'dim'); cy++;
    for (const line of notesLines) {
      if (cy >= y + h) break;
      const text = typeof line === 'function' ? line(epoch) : line;
      screen.text(x, cy, padRight(text, w), 'dim');
      cy++;
    }
  }
}

// --------------------------------------------------------------- seq -----
// All 16 steps have to fit in one fixed-width row alongside the transport
// and scale readout, so cells sit flush against each other (no per-step
// gap) — the edit cursor is color-only here rather than a glyph, same as
// the matrix cursor. A thin separator every 4 steps groups them into beats.
export function drawSeq(screen, x, y, w, seq, active) {
  const playGlyph = seq.playing ? '▶' : '·';
  const scaleTag = `${NOTE_NAMES[seq.scaleKey]}${SCALE_ABBR[seq.scaleName] || seq.scaleName.slice(0, 4)}`;
  const s = `SEQ ▸ ${playGlyph} ${seq.bpm}  ${scaleTag} ┃ `;
  screen.text(x, y, s, 'bright');
  let cx = x + s.length;
  const editIdx = seq.editIndex || 0;
  seq.steps.forEach((step, i) => {
    const isPlayCursor = i === seq.cursor && seq.playing;
    const isEditCursor = active && i === editIdx;
    const gateCh = step.gate ? (step.tie ? '~' : '─') : '·';
    const label = step.gate ? noteName(step.note) : '···';
    const text = padRight(label, 3) + gateCh;
    const cls = isPlayCursor ? 'cursor' : isEditCursor ? 'bright' : (step.gate ? 'accent' : 'dim');
    screen.text(cx, y, text, cls);
    cx += 4;
    if (i % 4 === 3 && i !== seq.steps.length - 1) { screen.put(cx, y, '·', 'dim'); cx += 1; }
  });
  const tail = ` ┃ ${String(editIdx).padStart(2, '0')}/${seq.steps.length}`;
  screen.text(cx, y, tail, active ? 'accent' : 'dim');
}

// ------------------------------------------------------------ meters -----
export function drawMeters(screen, x, y, w, engine) {
  const { l, r, scope } = readMeters(engine);
  const lDb = levelToDb(l), rDb = levelToDb(r);
  const barW = 16;
  let cx = x;
  screen.text(cx, y, 'L ', 'dim'); cx += 2;
  screen.text(cx, y, meterBar(l, barW), l > 0.9 ? 'warn' : 'accent'); cx += barW;
  screen.text(cx, y, ' ' + padLeft(fmtDb(lDb), 7) + ' ┃ ', 'dim'); cx += 11;
  const scopeW = Math.max(10, w - (cx - x) - 2 - barW - 12);
  screen.text(cx, y, scope.slice(0, scopeW), 'accent'); cx += scopeW;
  screen.text(cx, y, ' ┃ R ', 'dim'); cx += 5;
  screen.text(cx, y, meterBar(r, barW), r > 0.9 ? 'warn' : 'accent'); cx += barW;
  screen.text(cx, y, ' ' + padLeft(fmtDb(rDb), 7), 'dim');
}

function levelToDb(v) { return v <= 0.0001 ? -60 : 20 * Math.log10(v); }
function fmtDb(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + 'dB'; }

const scopeChars = ['⎽', '⎼', '−', '⎻', '⎺'];
function readMeters(engine) {
  if (!engine.ready) return { l: 0, r: 0, scope: '·'.repeat(40) };
  const { analyserL, analyserR, analyserScope } = engine;
  const l = rmsOf(analyserL), r = rmsOf(analyserR);
  const buf = engine._scopeBuf || (engine._scopeBuf = new Float32Array(analyserScope.fftSize));
  analyserScope.getFloatTimeDomainData(buf);
  const n = 40;
  let scope = '';
  const step = Math.floor(buf.length / n);
  for (let i = 0; i < n; i++) {
    const v = buf[i * step];
    const idx = Math.max(0, Math.min(scopeChars.length - 1, Math.round((v + 1) / 2 * (scopeChars.length - 1))));
    scope += scopeChars[idx];
  }
  return { l, r, scope };
}
function rmsOf(analyser) {
  if (!analyser) return 0;
  const buf = analyser._buf || (analyser._buf = new Float32Array(analyser.fftSize));
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// -------------------------------------------------------------- boot -----
export function drawBoot(screen, lines, revealed) {
  screen.clear();
  const x = 10, y0 = 10;
  for (let i = 0; i < Math.min(revealed, lines.length); i++) {
    screen.text(x, y0 + i, lines[i], i === revealed - 1 ? 'bright' : 'dim');
  }
}

// ------------------------------------------------------------- cmdline -----
export function drawCmdLine(screen, x, y, w, state) {
  if (state.status) {
    screen.text(x, y, padRight(state.status, w), 'accent');
    return;
  }
  const hint = '[?] help  [tab] focus  [9/0] octave  [esc] cancel';
  if (state.cmdMode) {
    const line = `:${state.cmdBuffer}▌`;
    screen.text(x, y, padRight(line, w - hint.length - 1), 'bright');
  } else {
    screen.text(x, y, padRight(`: ready — z..l plays, : for commands`, w - hint.length - 1), 'dim');
  }
  screen.text(x + w - hint.length, y, hint, 'dim');
}
