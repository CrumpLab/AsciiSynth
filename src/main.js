import { Screen } from './screen/screen.js';
import { Engine } from './audio/engine.js';
import { Sequencer } from './audio/scheduler.js';
import { SOURCE_IDS, DEST_IDS } from './audio/matrix.js';
import { DEFAULT_PATCH } from './state/patches.js';
import { parsePatch, applyPatch } from './state/patch.js';
import * as L from './ui/layout.js';
import {
  drawFrame, drawTitleBar, drawRack, drawMatrix, drawSeq, drawMeters, drawCmdLine, drawBoot,
  EAST_MODULES, WEST_MODULES, LFO_MODULES,
} from './ui/panels.js';
import { createInput } from './ui/input.js';
import { createMidiInput } from './midi/midi.js';
import { BOOT_LINES, HELP_LINES } from './ui/flavor.js';

const screenEl = document.getElementById('screen');
const screen = new Screen(L.COLS, L.ROWS, screenEl);
const engine = new Engine();
const seq = new Sequencer(engine);

// The instrument's uptime counter starts before this session did — see
// plan §7. A few days, an odd number of hours: it should look like it was
// just sitting there.
const EPOCH_OFFSET_MS = (3 * 86400 + 7 * 3600 + 42 * 60 + 11) * 1000;

const state = {
  engine,
  epoch: Date.now() - EPOCH_OFFSET_MS,
  systemName: 'PUTNEY WEST',
  patchName: '(unnamed) recovered',
  dirty: false,
  status: '', statusTimer: null,
  overlay: null,
  cmdMode: false, cmdBuffer: '',
  focus: { panel: 'EAST', eastIndex: 0, westIndex: 0, lfoIndex: 0, row: 0, col: 0 },
  octave: 0,
  gestureDone: false,
  bootError: null,
  bootDone: false,
  bootRevealed: 0,
  plainMode: false,
};

function setStatus(msg, ms = 2600) {
  state.status = msg;
  announce(msg);
  clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => { state.status = ''; }, ms);
}

const liveEl = document.getElementById('live');
function announce(msg) { if (liveEl) liveEl.textContent = msg; }

// ------------------------------------------------------------ overlay -----
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayPre = document.getElementById('overlay-pre');
const overlayTextarea = document.getElementById('overlay-textarea');
const overlayActions = document.getElementById('overlay-actions');

function clearActions() { overlayActions.innerHTML = ''; }
function addAction(label, fn) {
  const b = document.createElement('button');
  b.textContent = label; b.onclick = fn;
  overlayActions.appendChild(b);
  return b;
}

function showOverlay(kind, content = '') {
  state.overlay = kind;
  overlayEl.hidden = false;
  overlayPre.hidden = true; overlayTextarea.hidden = true; clearActions();
  if (kind === 'help') {
    overlayTitle.textContent = '§ HELP — SYS/7 MANUAL (incomplete)';
    overlayPre.hidden = false; overlayPre.textContent = HELP_LINES.join('\n');
    addAction('close', hideOverlay);
  } else if (kind === 'save') {
    overlayTitle.textContent = `§ PATCH — "${state.patchName}"  (copy this block; :load pastes it back)`;
    overlayTextarea.hidden = false; overlayTextarea.value = content; overlayTextarea.readOnly = true;
    addAction('copy', async () => {
      try { await navigator.clipboard.writeText(content); setStatus('copied to clipboard'); }
      catch { overlayTextarea.select(); document.execCommand('copy'); setStatus('copied'); }
    });
    addAction('close', hideOverlay);
    setTimeout(() => { overlayTextarea.focus(); overlayTextarea.select(); }, 10);
  } else if (kind === 'load') {
    overlayTitle.textContent = '§ LOAD PATCH — paste a saved block, then Load';
    overlayTextarea.hidden = false; overlayTextarea.value = ''; overlayTextarea.readOnly = false;
    addAction('load', () => {
      try {
        const parsed = parsePatch(overlayTextarea.value);
        if (!Object.keys(parsed.modules).length) throw new Error('empty');
        const name = applyPatch(engine, parsed);
        state.patchName = name; state.dirty = false;
        setStatus(`loaded "${name}"`);
        hideOverlay();
      } catch { setStatus('could not read that as a patch'); }
    });
    addAction('cancel', hideOverlay);
    setTimeout(() => overlayTextarea.focus(), 10);
  }
}
function hideOverlay() { state.overlay = null; overlayEl.hidden = true; }

// -------------------------------------------------------------- input -----
const midi = createMidiInput({ engine, setStatus });
const input = createInput({ state, engine, seq, midi, setStatus, showOverlay, hideOverlay });

function ensureGesture() {
  if (state.gestureDone) return;
  state.gestureDone = true;
  engine.boot().then(() => {
    const parsed = parsePatch(DEFAULT_PATCH);
    applyPatch(engine, parsed);
    state.patchName = parsed.name;
    state.dirty = false;
  }).catch((err) => {
    console.error(err);
    state.bootError = (err && err.message) || String(err);
  });
  midi.connect();
}

window.addEventListener('keydown', (e) => {
  ensureGesture();
  // Don't hijack browser/system shortcuts.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  input.onKeyDown(e);
});
window.addEventListener('keyup', (e) => input.onKeyUp(e));
window.addEventListener('mousedown', () => ensureGesture(), { once: true });

// Matrix cell clicks: map pixel position back to grid cell.
screenEl.addEventListener('click', (e) => {
  if (!engine.ready || !state.bootDone) return;
  const rect = screenEl.getBoundingClientRect();
  const cs = getComputedStyle(screenEl);
  const padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
  const padR = parseFloat(cs.paddingRight) || 0, padB = parseFloat(cs.paddingBottom) || 0;
  const cw = (rect.width - padL - padR) / L.COLS;
  const ch = (rect.height - padT - padB) / L.ROWS;
  const col = Math.floor((e.clientX - rect.left - padL) / cw);
  const row = Math.floor((e.clientY - rect.top - padT) / ch);
  const gridY0 = L.BODY_Y + 2;
  const gridX0 = L.MID_X + 6;
  if (row >= gridY0 && row < gridY0 + SOURCE_IDS.length && col >= gridX0) {
    const destIdx = Math.floor((col - gridX0) / 2);
    if (destIdx >= 0 && destIdx < DEST_IDS.length) input.onMatrixClick(row - gridY0, destIdx);
  }
});

// ---------------------------------------------------------------- boot -----
const bootTimer = setInterval(() => {
  state.bootRevealed = Math.min(BOOT_LINES.length, state.bootRevealed + 1);
  if (state.bootRevealed >= BOOT_LINES.length) clearInterval(bootTimer);
}, 220);

// -------------------------------------------------------- reduced motion --
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reducedMotion) document.body.classList.add('reduced-motion');

// ----------------------------------------------------------- render loop --
function render() {
  document.body.classList.toggle('plain-mode', state.plainMode);
  screen.clear();

  if (!engine.ready) {
    const msg = state.bootError ? 'boot failed' : state.gestureDone ? 'booting…' : 'A S C I I S Y N T H';
    const sub = state.bootError || (state.gestureDone ? '' : 'press any key, or click, to begin');
    screen.text(38, 18, msg, state.bootError ? 'warn' : 'bright');
    if (sub) screen.text(Math.max(0, 50 - Math.floor(sub.length / 2)), 20, sub, state.bootError ? 'warn' : 'dim');
    return;
  }
  if (!state.bootDone) {
    drawBoot(screen, BOOT_LINES, state.bootRevealed);
    return;
  }

  drawFrame(screen);
  drawTitleBar(screen, state);
  drawRack(screen, L.LEFT_X, L.BODY_Y, L.LEFT_W, L.BODY_H, EAST_MODULES, engine, { label: '[ EAST ]' }, state.focus.eastIndex, state.focus.panel === 'EAST');
  const lfoY = drawMatrix(screen, L.MID_X, L.BODY_Y, L.MID_W, engine, state.focus);
  drawRack(screen, L.MID_X, lfoY, L.MID_W, (L.BODY_Y + L.BODY_H) - lfoY, LFO_MODULES, engine, { label: '[ LFO ]' }, state.focus.lfoIndex, state.focus.panel === 'LFO');
  drawRack(screen, L.RIGHT_X, L.BODY_Y, L.RIGHT_W, L.BODY_H, WEST_MODULES, engine, { label: '[ WEST ]' }, state.focus.westIndex, state.focus.panel === 'WEST');
  drawSeq(screen, L.LEFT_X, L.ROW_SEQ, L.COLS - 2, seq, state.focus.panel === 'SEQ');
  drawMeters(screen, L.LEFT_X, L.ROW_METER, L.COLS - 2, engine);
  drawCmdLine(screen, L.LEFT_X, L.ROW_CMD, L.COLS - 2, state);
}

let sized = false;
function fitScreen() {
  const wrap = document.getElementById('crtwrap');
  wrap.style.transform = 'none';
  const rect = screenEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const availW = window.innerWidth * 0.97;
  const availH = window.innerHeight * 0.97;
  const scale = Math.min(availW / rect.width, availH / rect.height, 1.8);
  wrap.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', fitScreen);

function loop() {
  try {
    render();
    screen.flush();
    if (!sized) { sized = true; fitScreen(); }
  } catch (err) {
    console.error('render error:', err);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
