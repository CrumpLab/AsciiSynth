// The patch is text. serializePatch() and parsePatch() are exact inverses,
// and the block they trade in is deliberately plain enough to hand-edit —
// paste it into a text file, into a forum post, back into the command line.

export function serializePatch(engine, name = 'untitled') {
  const lines = [];
  lines.push(`ASCIISYNTH PATCH v1 "${name}"`);
  for (const [modId, mod] of Object.entries(engine.modules)) {
    const kv = Object.entries(mod.params).map(([k, p]) => `${k}=${fmtNum(p.value)}`).join(' ');
    lines.push(`${modId} ${kv}`);
  }
  lines.push('PATCH:');
  for (const [src, dst, depth] of engine.matrix.serialize()) {
    lines.push(`${src}>${dst} ${fmtNum(depth)}`);
  }
  lines.push('END');
  return lines.join('\n');
}

function fmtNum(v) {
  return Number.isInteger(v) ? String(v) : Number(v.toFixed(4)).toString();
}

export function parsePatch(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let name = 'untitled';
  const modules = {};
  const pins = [];
  let inPatch = false;
  for (const line of lines) {
    const nameMatch = line.match(/^ASCIISYNTH PATCH v\d+\s+"([^"]*)"/i);
    if (nameMatch) { name = nameMatch[1]; continue; }
    if (/^PATCH:$/i.test(line)) { inPatch = true; continue; }
    if (/^END$/i.test(line)) { break; }
    if (inPatch) {
      const m = line.match(/^([A-Z0-9_]+)>([A-Z0-9_.]+)\s+(-?[\d.]+)/i);
      if (m) pins.push([m[1].toUpperCase(), m[2].toUpperCase(), parseFloat(m[3])]);
      continue;
    }
    const parts = line.split(/\s+/);
    const modId = parts[0].toUpperCase();
    const params = {};
    for (let i = 1; i < parts.length; i++) {
      const kv = parts[i].match(/^([a-zA-Z_]+)=(-?[\d.]+)/);
      if (kv) params[kv[1]] = parseFloat(kv[2]);
    }
    modules[modId] = params;
  }
  return { name, modules, pins };
}

export function applyPatch(engine, parsed) {
  for (const [modId, params] of Object.entries(parsed.modules)) {
    const mod = engine.modules[modId];
    if (!mod) continue;
    for (const [key, value] of Object.entries(params)) {
      const p = mod.params[key];
      if (p && Number.isFinite(value)) p.set(value);
    }
  }
  engine.matrix.clear();
  for (const [src, dst, depth] of parsed.pins) {
    engine.connectPin(src, dst, depth);
  }
  return parsed.name;
}
