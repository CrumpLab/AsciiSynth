import { EAST_MODULES, WEST_MODULES, flattenRack } from './panels.js';
import { SOURCE_IDS, DEST_IDS } from '../audio/matrix.js';
import { PRESETS, listPresetNames } from '../state/patches.js';
import { serializePatch, parsePatch, applyPatch } from '../state/patch.js';
import { generatePatch } from '../state/randomizer.js';
import { SCALES, NOTE_NAMES, parseKey } from '../audio/theory.js';

// Bottom two rows of a QWERTY keyboard, laid out like a real keyboard
// instrument: naturals along the bottom row, sharps on the row above
// sitting in the gaps between them.
const NATURAL = { z: 0, x: 2, c: 4, v: 5, b: 7, n: 9, m: 11, ',': 12, '.': 14 };
const SHARP = { s: 1, d: 3, g: 6, h: 8, j: 10, l: 13 };
const BASE_MIDI = 48; // C3

export function keyToMidi(key, octave) {
  const k = key.toLowerCase();
  if (k in NATURAL) return BASE_MIDI + NATURAL[k] + octave * 12;
  if (k in SHARP) return BASE_MIDI + SHARP[k] + octave * 12;
  return null;
}

function clampWrap(v, n) { return ((v % n) + n) % n; }

export function createInput({ state, engine, seq, setStatus, showOverlay, hideOverlay }) {
  const heldKeys = new Map(); // physical key -> midi note currently sounding

  const eastFlat = () => flattenRack(EAST_MODULES, engine);
  const westFlat = () => flattenRack(WEST_MODULES, engine);

  function cyclePanel(dir) {
    const order = ['EAST', 'MATRIX', 'WEST', 'SEQ'];
    const i = clampWrap(order.indexOf(state.focus.panel) + dir, order.length);
    state.focus.panel = order[i];
  }

  function moveVertical(dir, coarse) {
    const f = state.focus;
    if (f.panel === 'EAST') f.eastIndex = clampWrap(f.eastIndex + dir, eastFlat().length);
    else if (f.panel === 'WEST') f.westIndex = clampWrap(f.westIndex + dir, westFlat().length);
    else if (f.panel === 'MATRIX') f.row = clampWrap(f.row + dir, SOURCE_IDS.length);
    else if (f.panel === 'SEQ') nudgeSeqNote(-dir * (coarse ? 12 : 1)); // up-arrow (dir -1) should raise pitch
  }

  function nudgeSeqNote(semitones) {
    const step = seq.steps[seq.editIndex || 0];
    step.note = Math.max(12, Math.min(108, step.note + semitones));
    state.dirty = true;
  }

  function moveHorizontal(dir, coarse) {
    const f = state.focus;
    if (f.panel === 'EAST') {
      const entry = eastFlat()[f.eastIndex];
      if (entry) { engine.modules[entry.modId].params[entry.key].nudge(dir, coarse); state.dirty = true; }
    } else if (f.panel === 'WEST') {
      const entry = westFlat()[f.westIndex];
      if (entry) { engine.modules[entry.modId].params[entry.key].nudge(dir, coarse); state.dirty = true; }
    } else if (f.panel === 'MATRIX') {
      f.col = clampWrap(f.col + dir, DEST_IDS.length);
    } else if (f.panel === 'SEQ') {
      seq.editIndex = clampWrap((seq.editIndex || 0) + dir, seq.steps.length);
    }
  }

  function togglePrimary() {
    const f = state.focus;
    if (f.panel === 'MATRIX') {
      engine.togglePin(SOURCE_IDS[f.row], DEST_IDS[f.col]);
      state.dirty = true;
    } else if (f.panel === 'SEQ') {
      seq.steps[seq.editIndex || 0].gate = !seq.steps[seq.editIndex || 0].gate;
      state.dirty = true;
    }
  }

  function adjustDepthOrPitch(dir) {
    const f = state.focus;
    if (f.panel === 'MATRIX') {
      const src = SOURCE_IDS[f.row], dst = DEST_IDS[f.col];
      const cur = engine.matrix.getDepth(src, dst);
      const next = cur === 0 ? dir * 0.5 : cur + dir * 0.1;
      engine.connectPin(src, dst, Math.max(-1, Math.min(1, next)));
      state.dirty = true;
    } else if (f.panel === 'SEQ') {
      nudgeSeqNote(dir);
    }
  }

  function invertPin() {
    const f = state.focus;
    if (f.panel !== 'MATRIX') return;
    const src = SOURCE_IDS[f.row], dst = DEST_IDS[f.col];
    const cur = engine.matrix.getDepth(src, dst);
    if (cur) { engine.connectPin(src, dst, -cur); state.dirty = true; }
  }

  function setBpm(v) {
    seq.bpm = Math.max(20, Math.min(300, Math.round(v)));
    setStatus(`${seq.bpm} BPM`);
  }

  function toggleTie() {
    if (state.focus.panel !== 'SEQ') return;
    seq.steps[seq.editIndex || 0].tie = !seq.steps[seq.editIndex || 0].tie;
    state.dirty = true;
  }

  function runCommand(raw) {
    const text = raw.trim();
    if (!text) return;
    if (!engine.ready) { setStatus('still booting…'); return; }
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd.toLowerCase()) {
      case 'save': {
        const name = arg || state.patchName || 'untitled';
        state.patchName = name; state.dirty = false;
        showOverlay('save', serializePatch(engine, name));
        break;
      }
      case 'load':
        showOverlay('load', '');
        break;
      case 'patch': {
        const key = arg.toLowerCase();
        if (PRESETS[key]) {
          const name = applyPatch(engine, parsePatch(PRESETS[key]));
          state.patchName = name; state.dirty = false;
          setStatus(`loaded preset "${name}"`);
        } else {
          setStatus(`no such patch — try: ${listPresetNames().join(', ')}`);
        }
        break;
      }
      case 'rand': {
        const n = Math.max(1, Math.min(30, parseInt(arg, 10) || 8));
        for (let i = 0; i < n; i++) {
          const src = SOURCE_IDS[Math.floor(Math.random() * SOURCE_IDS.length)];
          const dst = DEST_IDS[Math.floor(Math.random() * DEST_IDS.length)];
          engine.connectPin(src, dst, (Math.random() * 2 - 1) * 0.8);
        }
        state.dirty = true;
        setStatus(`scrambled ${n} pins`);
        break;
      }
      case 'scale': {
        const parts = arg.split(/\s+/).filter(Boolean);
        const name = (parts[0] || '').toLowerCase();
        if (!name) { setStatus(`scale: ${NOTE_NAMES[seq.scaleKey]} ${seq.scaleName} — try: ${Object.keys(SCALES).join(', ')}`); break; }
        if (!SCALES[name]) { setStatus(`no such scale — try: ${Object.keys(SCALES).join(', ')}`); break; }
        const key = parts[1] != null ? parseKey(parts[1], seq.scaleKey) : undefined;
        seq.setScale(name, key);
        state.dirty = true;
        setStatus(`scale: ${NOTE_NAMES[seq.scaleKey]} ${seq.scaleName} — steps re-snapped`);
        break;
      }
      case 'key': {
        if (!arg.trim()) { setStatus(`key: ${NOTE_NAMES[seq.scaleKey]}`); break; }
        seq.setScale(seq.scaleName, parseKey(arg, seq.scaleKey));
        state.dirty = true;
        setStatus(`key: ${NOTE_NAMES[seq.scaleKey]} — steps re-snapped`);
        break;
      }
      case 'randseq': {
        const seed = arg.trim() ? (parseInt(arg, 10) >>> 0) : undefined;
        seq.randomizeSteps(seed);
        state.dirty = true;
        setStatus(`sequence randomized in ${NOTE_NAMES[seq.scaleKey]} ${seq.scaleName}`);
        break;
      }
      case 'bpm': case 'tempo': {
        const n = parseInt(arg, 10);
        if (Number.isFinite(n)) setBpm(n);
        else setStatus('usage: :bpm <20-300>');
        break;
      }
      case 'gen': case 'generate': {
        const seed = arg.trim() ? (parseInt(arg, 10) >>> 0) : undefined;
        const { name } = generatePatch(engine, seed);
        state.patchName = name; state.dirty = true;
        setStatus(`generated "${name}" — :save to keep it`);
        break;
      }
      case 'clear':
        engine.matrix.clear(); state.dirty = true; setStatus('matrix cleared');
        break;
      case 'panic':
        engine.panic(); setStatus('panic — all notes off');
        break;
      case 'plain':
        state.plainMode = !state.plainMode;
        setStatus(state.plainMode ? 'plain mode on' : 'plain mode off');
        break;
      case 'help':
        showOverlay('help');
        break;
      default:
        setStatus(`unknown command: ${cmd} — try :help`);
    }
  }

  function onKeyDown(e) {
    if (state.overlay) {
      if (e.key === 'Escape') { hideOverlay(); e.preventDefault(); }
      return; // overlay owns input (e.g. its <textarea>) otherwise
    }
    if (!state.bootDone) { state.bootDone = true; return; }

    if (state.cmdMode) {
      if (e.key === 'Enter') { runCommand(state.cmdBuffer); state.cmdMode = false; state.cmdBuffer = ''; }
      else if (e.key === 'Escape') { state.cmdMode = false; state.cmdBuffer = ''; }
      else if (e.key === 'Backspace') { state.cmdBuffer = state.cmdBuffer.slice(0, -1); }
      else if (e.key.length === 1) { state.cmdBuffer += e.key; }
      e.preventDefault();
      return;
    }

    const k = e.key;
    if (k === ':') { state.cmdMode = true; state.cmdBuffer = ''; e.preventDefault(); return; }
    if (k === '?') { showOverlay('help'); return; }
    if (k === 'Tab') { cyclePanel(e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    if (k === 'ArrowUp') { moveVertical(-1, e.shiftKey); e.preventDefault(); return; }
    if (k === 'ArrowDown') { moveVertical(1, e.shiftKey); e.preventDefault(); return; }
    if (k === 'ArrowLeft') { moveHorizontal(-1, e.shiftKey); e.preventDefault(); return; }
    if (k === 'ArrowRight') { moveHorizontal(1, e.shiftKey); e.preventDefault(); return; }
    if (k === ' ') { togglePrimary(); e.preventDefault(); return; }
    if (k === '+' || k === '=') { adjustDepthOrPitch(1); e.preventDefault(); return; }
    if (k === '-' || k === '_') { adjustDepthOrPitch(-1); e.preventDefault(); return; }
    if (k === 'i' || k === '~') { invertPin(); e.preventDefault(); return; }
    if (k === 't') { toggleTie(); return; }
    if (k === 'r' && state.focus.panel === 'SEQ') {
      seq.randomizeSteps();
      state.dirty = true;
      setStatus(`sequence randomized in ${NOTE_NAMES[seq.scaleKey]} ${seq.scaleName}`);
      e.preventDefault();
      return;
    }
    if (k === 'Enter' && state.focus.panel === 'SEQ') { seq.toggle(); e.preventDefault(); return; }
    if (k === '9') { state.octave = Math.max(-3, state.octave - 1); setStatus(`octave ${state.octave >= 0 ? '+' : ''}${state.octave}`); return; }
    if (k === '0') { state.octave = Math.min(3, state.octave + 1); setStatus(`octave ${state.octave >= 0 ? '+' : ''}${state.octave}`); return; }
    if (k === '[') { setBpm(seq.bpm - (e.shiftKey ? 5 : 1)); e.preventDefault(); return; }
    if (k === ']') { setBpm(seq.bpm + (e.shiftKey ? 5 : 1)); e.preventDefault(); return; }

    if (!e.repeat) {
      const midi = keyToMidi(k, state.octave);
      if (midi != null && !heldKeys.has(k)) {
        heldKeys.set(k, midi);
        engine.noteOn(midi);
      }
    }
  }

  function onKeyUp(e) {
    const k = e.key;
    if (heldKeys.has(k)) {
      const midi = heldKeys.get(k);
      heldKeys.delete(k);
      engine.noteOff(midi);
    }
  }

  function onMatrixClick(row, col) {
    state.focus.panel = 'MATRIX';
    state.focus.row = row; state.focus.col = col;
    engine.togglePin(SOURCE_IDS[row], DEST_IDS[col]);
    state.dirty = true;
  }

  return { onKeyDown, onKeyUp, runCommand, onMatrixClick };
}
