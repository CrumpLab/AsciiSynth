# ASCIISYNTH

A browser synthesizer whose entire interface is a grid of characters — a
Moog-ish east chain and a Buchla-ish west chain sharing one EMS-Putney-style
patch matrix, dressed as a terminal instrument from a machine that predates
you. See [plan.md](plan.md) for the design brief this implements.

No build step, no dependencies — the whole thing is ES modules and the raw
Web Audio API, run directly by the browser.

## Run it

Browsers won't load ES modules or AudioWorklets over `file://`, so serve the
folder over plain HTTP:

```
cd AsciiSynth
python3 -m http.server 8080     # or: npx serve .
```

Then open **http://localhost:8080**. Press any key (or click) to power on —
that keypress is also the required gesture to unlock audio.

## Playing it

```
tab / shift-tab     cycle focus: east rack ▸ matrix ▸ west rack ▸ sequencer
arrows               move within the focused panel
←/→ on a param       adjust it (hold shift for a coarse step)
space                toggle a matrix pin · toggle a sequencer step's gate
+ / -                nudge the focused pin's depth      i    invert it
z x c v b n m , .    the natural notes, one octave from C
s d   g h j   l      the sharps, sitting above the gaps between them
9 / 0                octave down / up

on the sequencer (tab to it):
  ← / →              select a step        ↑ / ↓   its pitch (shift = octave)
  space              toggle that step      t       toggle tie
  r                  randomize all 16      enter   start / stop
  [ / ]              tempo (shift for ×5)

:                     command line — :save, :load, :patch <name>, :rand [n],
                      :gen [seed], :bpm <n>, :scale [name] [key], :key <note>,
                      :randseq [seed], :clear, :panic, :help
?                     help overlay (it's missing a page — that's on purpose)
```

Three built-in patches beyond the boot default: `:patch drone`,
`:patch uncertainty`, `:patch putney`.

## What it actually is

Everything on screen is a real `AudioNode` graph — the routing matrix is a
literal patch bay: each lit cell is a `GainNode` (the attenuverter) sitting
between a source's output and a destination's `AudioParam`, and Web Audio
sums every incoming connection on its own, so this is modular routing, not a
simulation of it. Four custom `AudioWorklet` processors do the DSP native
nodes can't: a Huovilainen-style 4-pole ladder filter, and a clocked
sample-&-hold/random source. The wavefolder and low-pass gate are native
`WaveShaperNode`/`BiquadFilterNode` compositions per the plan's "prototype
with natives first" guidance.

`:gen` randomizes every module and the matrix into a brand-new patch (an
evocative name plus the seed that reproduces it, e.g. `ghost lattice 7
[2938741]`) — `:gen 2938741` regenerates exactly that patch on any machine.
`:rand [n]` is the narrower version: it only scrambles matrix pins, leaving
the sound-shaping params alone.

`:save` prints the patch as a plain text block; `:load` pastes one back in —
the same format the instrument reads, writes, and (mostly) displays.

`:scale <name> [key]` (12 scales — major, minor, the modes, two pentatonics,
blues, whole tone, chromatic) sets the sequencer's scale and re-snaps every
existing step onto it, so changing it is immediately audible rather than
just a bias on future randomization; `:key <note>` changes just the root.
`:randseq [seed]` (or `r` with the sequencer focused) randomizes all 16
steps' pitch, gate, and tie within the current scale — seeded the same way
`:gen` is, so a seed reproduces the exact sequence.

## Project layout

```
index.html / style.css       shell + CRT/phosphor theme
src/main.js                  boot, render loop, wiring
src/screen/                  the character framebuffer + glyph helpers
src/audio/
  engine.js                  master bus, default signal chain, note handling
  modules.js                 factory for every synth module
  matrix.js                  the patch bay (sources, destinations, pins)
  scheduler.js                16-step lookahead sequencer
  theory.js                   scales, keys, note naming
  worklets/                  ladder-processor.js, entropy-processor.js
src/state/                   patch (de)serialization, built-in + random presets
src/ui/                       panel rendering, input/keymap, flavor text
src/util/rng.js               seedable PRNG shared by :gen and :randseq
```

## Known limitations

- Desktop keyboard only — no touch/mobile layout.
- Monophonic, with a note-priority stack (hold several keys, release one,
  it glides back to whichever's still held rather than cutting out).
- The routing matrix ships with 13 sources × 15 destinations rather than the
  full ~18×17 sketched in the plan's mockup — a deliberately smaller but
  fully real set; extending it is just adding entries to `matrix.js` and
  `engine.js`'s `destMap`/`srcMap`.
- No MIDI input, no audio export yet (both noted as open questions in the
  plan).
