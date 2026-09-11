// A 16-step sequencer with a classic lookahead scheduler (Chris Wilson's
// "A Tale of Two Clocks"): a fast setInterval polls, but every note is
// scheduled against ctx.currentTime, so timing rides on the audio clock,
// not the browser's.

import { SCALES, nearestInScale, randomNoteInScale } from './theory.js';
import { mulberry32 } from '../util/rng.js';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;

export class Sequencer {
  constructor(engine) {
    this.engine = engine;
    this.bpm = 124;
    this.playing = false;
    this.scaleName = 'minor';
    this.scaleKey = 0; // C — the boot melody's notes already sit inside C minor
    this.steps = Array.from({ length: 16 }, (_, i) => ({
      note: 48 + [0, 3, 7, 10, 12, 7, 3, 0, 0, 3, 7, 10, 12, 15, 10, 7][i],
      gate: i % 2 === 0 || i % 3 === 0,
      tie: false,
      prob: 1,
    }));
    this.current = 0;
    this.cursor = 0;
    this.editIndex = 0;
    this._timer = null;
    this._nextStepTime = 0;
    this._lastGateOn = false;
  }

  stepDuration() { return 60 / this.bpm / 4; } // 16th notes

  // Sets scale and (optionally) key, then re-snaps every existing step onto
  // it — changing the scale is meant to audibly change the melody, not just
  // bias future randomization.
  setScale(name, key) {
    if (!SCALES[name]) return false;
    this.scaleName = name;
    if (key != null) this.scaleKey = ((key % 12) + 12) % 12;
    this.quantizeToScale();
    return true;
  }

  quantizeToScale() {
    const intervals = SCALES[this.scaleName];
    for (const step of this.steps) step.note = nearestInScale(step.note, this.scaleKey, intervals);
  }

  // Randomizes every step's pitch (within the current scale/key), gate,
  // tie, and probability. Seeded the same way :gen is — same seed, same
  // sequence, every time.
  randomizeSteps(seed) {
    const rng = seed != null ? mulberry32(seed) : Math.random;
    const intervals = SCALES[this.scaleName];
    for (const step of this.steps) {
      step.note = randomNoteInScale(rng, this.scaleKey, intervals, 48, 14);
      step.gate = rng() < 0.7;
      step.tie = step.gate && rng() < 0.12;
      step.prob = rng() < 0.85 ? 1 : Math.round((0.5 + rng() * 0.4) * 100) / 100;
    }
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.current = 0;
    this._nextStepTime = this.engine.ctx.currentTime + 0.05;
    this._timer = setInterval(() => this._tick(), LOOKAHEAD_MS);
  }

  stop() {
    this.playing = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._lastGateOn) { this.engine.noteOff(this.engine.currentNote); this._lastGateOn = false; }
  }

  toggle() { this.playing ? this.stop() : this.start(); }

  // The actual timing precision lives here: every note-on/off this schedules
  // is handed the exact audio-clock time it should happen at, via `t` on
  // engine.noteOn/noteOff, which forward it straight into setTargetAtTime /
  // linearRampToValueAtTime. The setInterval poll just decides *which*
  // events fall in the next lookahead window — it never times the events
  // themselves, so its own jitter doesn't reach the audio.
  _tick() {
    const ctx = this.engine.ctx;
    while (this._nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      this._scheduleStep(this.current, this._nextStepTime);
      this._nextStepTime += this.stepDuration();
      this.current = (this.current + 1) % this.steps.length;
    }
    // Move the visible step cursor roughly in step with what's audible.
    this.cursor = (this.current - 1 + this.steps.length) % this.steps.length;
  }

  _scheduleStep(i, time) {
    const step = this.steps[i];
    const fire = step.gate && Math.random() < step.prob;
    if (fire) {
      this.engine.noteOn(step.note, 0.9, time);
      this._lastGateOn = true;
      if (!step.tie) {
        this.engine.noteOff(step.note, time + this.stepDuration() * 0.85);
        this._lastGateOn = false;
      }
    } else if (!step.tie && this._lastGateOn) {
      this.engine.noteOff(this.engine.currentNote, time);
      this._lastGateOn = false;
    }
  }
}
