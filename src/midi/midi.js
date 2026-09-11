// Web MIDI input. Any connected controller feeds the same note-priority
// stack the QWERTY keyboard does (engine.noteOn/noteOff) — this is a mono
// instrument, so a MIDI keyboard and the computer keyboard are just two
// hands on one voice, not separate ones. See plan.md §11.2.
//
// By default every connected input is merged into that one voice. `:midi n`
// narrows it to a single port (useful if two inputs are echoing the same
// notes back at each other); `:midi all` reverts to merging everything.

const NOTE_OFF = 0x8, NOTE_ON = 0x9, CONTROL_CHANGE = 0xb;
const SUSTAIN_CC = 64;

export function createMidiInput({ engine, setStatus }) {
  const supported = typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  const inputs = new Map(); // port id -> name, in first-seen order
  const heldNotes = new Set();
  const sustainedNotes = new Set();
  let sustain = false;
  let access = null;
  let lastError = null;
  let selectedId = null; // null = listen to every connected input

  function handleMessage(port, e) {
    if (!engine.ready) return;
    if (selectedId != null && port.id !== selectedId) return;
    const [status, d1, d2] = e.data;
    const type = status >> 4;
    if (type === NOTE_ON && d2 > 0) {
      heldNotes.add(d1);
      sustainedNotes.delete(d1);
      engine.noteOn(d1, d2 / 127);
    } else if (type === NOTE_OFF || (type === NOTE_ON && d2 === 0)) {
      heldNotes.delete(d1);
      if (sustain) sustainedNotes.add(d1);
      else engine.noteOff(d1);
    } else if (type === CONTROL_CHANGE && d1 === SUSTAIN_CC) {
      sustain = d2 >= 64;
      if (!sustain) {
        for (const n of sustainedNotes) if (!heldNotes.has(n)) engine.noteOff(n);
        sustainedNotes.clear();
      }
    }
  }

  function attach(port) {
    port.onmidimessage = (e) => handleMessage(port, e);
    if (!inputs.has(port.id)) inputs.set(port.id, port.name || 'unnamed device');
  }

  function detach(port) {
    inputs.delete(port.id);
    if (selectedId === port.id) selectedId = null;
  }

  function refresh() {
    const seen = new Set();
    for (const port of access.inputs.values()) {
      seen.add(port.id);
      if (port.state === 'connected') attach(port);
    }
    for (const id of [...inputs.keys()]) if (!seen.has(id)) detach({ id });
  }

  async function connect() {
    if (!supported) return;
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
      lastError = null;
      refresh();
      access.onstatechange = (e) => {
        const port = e.port;
        if (port.type !== 'input') return;
        if (port.state === 'connected') { attach(port); setStatus(`midi: ${port.name || 'device'} connected`); }
        else { detach(port); setStatus(`midi: ${port.name || 'device'} disconnected`); }
      };
    } catch (err) {
      access = null;
      lastError = err;
    }
  }

  // Ordered list for display/selection — `:midi 2` picks list()[1].
  function list() {
    return [...inputs.entries()].map(([id, name]) => ({ id, name }));
  }

  function select(n) {
    const items = list();
    const item = items[n - 1];
    if (!item) return false;
    selectedId = item.id;
    return true;
  }

  function selectAll() {
    selectedId = null;
  }

  function status() {
    if (!supported) return 'unsupported — try Chrome or Edge';
    if (!access) return lastError ? `blocked — allow MIDI for this page and retry :midi` : 'not connected — run :midi to request access';
    if (!inputs.size) return 'no devices found — plug one in, then retry :midi';
    const items = list();
    const names = items.map((it, i) => {
      const tag = selectedId == null ? '' : (it.id === selectedId ? ' [selected]' : ' [muted]');
      return `${i + 1}:${it.name}${tag}`;
    });
    return names.join('  ');
  }

  function releaseAll() {
    heldNotes.clear();
    sustainedNotes.clear();
    sustain = false;
  }

  return { connect, status, list, select, selectAll, releaseAll };
}
