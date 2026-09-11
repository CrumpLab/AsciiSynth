// The patch matrix: a set of named sources and destinations, and a sparse
// map of "pins" connecting them. A pin is just a GainNode (the attenuverter)
// sitting between a source outlet and a destination inlet — Web Audio sums
// multiple incoming connections on any AudioParam/AudioNode automatically,
// so this really is a modular patch bay, not a simulation of one.

// Per-destination scale: how far a full-depth (±1) pin actually swings the
// target parameter. Keeps a bipolar -1..1 depth knob musically useful across
// wildly different parameter ranges (Hz vs. gain vs. seconds).
export const DEST_SCALE = {
  'VCO1.FM': 300,
  'VCO2.FM': 300,
  'CPLX.INDEX': 2,
  'LADDER.CUTOFF': 4000,
  'LADDER.IN': 0.6,
  'FOLD.DRIVE': 2.5,
  'FOLD.IN': 0.6,
  'LPG.STRIKE': 2500,
  'VCA.GAIN': 0.8,
  'RING.CARRIER': 1,
  'RING.IN': 0.7,
  'DELAY.TIME': 0.25,
  'PAN': 1,
  'ENTROPY.RATE': 20,
  'MASTER.LVL': 0.5,
};

export const SOURCE_IDS = ['VCO1', 'VCO2', 'NOISE', 'CPLX', 'FOLD', 'LFO1', 'LFO2', 'ADSR1', 'ADSR2', 'FNGEN', 'ENTROPY', 'GATE', 'KBDCV'];
export const DEST_IDS = ['VCO1.FM', 'VCO2.FM', 'CPLX.INDEX', 'LADDER.CUTOFF', 'LADDER.IN', 'FOLD.DRIVE', 'FOLD.IN', 'LPG.STRIKE', 'VCA.GAIN', 'RING.CARRIER', 'RING.IN', 'DELAY.TIME', 'PAN', 'ENTROPY.RATE', 'MASTER.LVL'];

export class Matrix {
  constructor(ctx) {
    this.ctx = ctx;
    this.pins = new Map(); // "SRC>DST" -> { node: GainNode, depth: number }
  }

  key(src, dst) { return `${src}>${dst}`; }

  getDepth(src, dst) {
    const p = this.pins.get(this.key(src, dst));
    return p ? p.depth : 0;
  }

  // Sets the depth for a src->dst pin. depth in [-1,1]; 0 removes the pin.
  setDepth(src, dst, depth, srcNode, dstTarget) {
    const key = this.key(src, dst);
    depth = Math.max(-1, Math.min(1, depth));
    let pin = this.pins.get(key);
    if (Math.abs(depth) < 0.001) {
      if (pin) { pin.node.disconnect(); this.pins.delete(key); }
      return;
    }
    const scale = DEST_SCALE[dst] ?? 1;
    if (!pin) {
      if (!srcNode || !dstTarget) return;
      const node = this.ctx.createGain();
      node.gain.value = depth * scale;
      srcNode.connect(node);
      node.connect(dstTarget);
      pin = { node, depth };
      this.pins.set(key, pin);
    } else {
      pin.depth = depth;
      pin.node.gain.setTargetAtTime(depth * scale, this.ctx.currentTime, 0.01);
    }
  }

  toggle(src, dst, srcNode, dstTarget, defaultDepth = 0.6) {
    const cur = this.getDepth(src, dst);
    this.setDepth(src, dst, cur ? 0 : defaultDepth, srcNode, dstTarget);
  }

  clear() {
    for (const pin of this.pins.values()) pin.node.disconnect();
    this.pins.clear();
  }

  count() { return this.pins.size; }

  // Serializes all pins as [src, dst, depth] triples for patch save.
  serialize() {
    const out = [];
    for (const [key, pin] of this.pins) {
      const [src, dst] = key.split('>');
      out.push([src, dst, Math.round(pin.depth * 100) / 100]);
    }
    return out;
  }
}
