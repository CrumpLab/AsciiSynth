# ASCIISYNTH — Plan

A browser-based synthesizer whose entire interface is a grid of characters.

Not "a synth with a retro theme." A synth that genuinely *is* text: every knob is a
glyph, every patch cable is a pin in a character matrix, and a saved patch is a block
of ASCII you can paste into a forum post. The sound engine is serious; the presentation
is a 1978 terminal that someone left running in a basement.

**Design target:** the user should feel *oriented* — panels are labeled, the layout never
moves — while suspecting the machine knows things they don't. Legible skeleton, mysterious
flesh.

---

## 1. Audio stack — recommendation

### The short version

| Layer | Choice | Why |
|---|---|---|
| Core graph | **Raw Web Audio API** (`AudioNode` / `AudioParam`) | The patch matrix *is* a node graph. Any abstraction that hides the graph fights the central idea. |
| Scheduling / utility | **Tone.js** (v15+), used à la carte | Best-in-class lookahead transport, `Tone.Signal`, ramps, tempo-relative time. Interops with raw nodes via `.input` / `.output` / `context.rawContext`. |
| Custom DSP | **AudioWorklet**, hand-written | Moog ladder, wavefolder, low-pass gate, and the random source have no native equivalent. |
| Optional deep DSP | **Faust** → `faustwasm` | If the hand-written worklets get painful, Faust compiles `.dsp` to a WASM worklet and has reference ladder/folder implementations. |

### Why this combination

Web Audio already gives us, natively and cheaply (C++ speed, off the main thread):
`OscillatorNode`, `BiquadFilterNode`, `GainNode`, `DelayNode`, `WaveShaperNode`,
`StereoPannerNode`, `ConvolverNode`, `AnalyserNode`, `ConstantSourceNode`.

Critically, most of their parameters are **`AudioParam`s**, which accept *audio-rate*
connections. That is the whole ballgame: `lfo.connect(filter.frequency)` is a patch cable.
A matrix cell is just a `GainNode` sitting between an outlet and an inlet, and its gain is
the attenuverter. We get modular routing for free from the platform.

**Use Tone.js for, and only for:**
- `Tone.Transport` — sample-accurate lookahead scheduling (the Chris Wilson "two clocks"
  pattern, already done correctly). Sequencer and clocked modules ride on this.
- `Tone.Signal` / `Tone.Add` / `Tone.Multiply` / `Tone.Scale` — signal math for the matrix.
- Curve helpers, `Tone.Midi`, tempo-relative time strings (`"16n"`).

**Do not use** `Tone.Synth`, `Tone.MonoSynth`, `Tone.PolySynth`, or the effect presets.
They are pre-wired voices; we are building the wiring. Mixing paradigms here is the single
most likely way this project turns into mush.

### Alternatives considered

- **Elementary Audio** — declarative functional DSP, genuinely elegant, renders to a
  worklet. Rejected: its "re-render the whole graph" model is a poor fit for a patch matrix
  where the user mutates one connection at a time, and the licensing story is less simple
  than "it's an npm package."
- **RNBO (Cycling '74)** — Max patch → WASM. Excellent output, but commercial licensing and
  a Max-shaped authoring workflow we don't want in the loop.
- **WebAudioModules (WAM 2.0)** — a plugin standard. Interesting as a *future export* target
  (ship ASCIISYNTH as a WAM), not as the foundation.
- **Csound-WASM / Gibberish** — capable, but each brings a whole second runtime and scheduler
  to argue with Tone's.
- **Pure raw Web Audio, no Tone** — viable! If dependency minimalism matters more than
  velocity, hand-write the lookahead scheduler (~60 lines) and drop Tone. Keep this as the
  fallback if Tone's abstractions start leaking into the module layer.

### Custom worklets to write (4)

1. `ladder-processor` — Moog 4-pole transistor ladder, Huovilainen/Stilson model, 2× oversampled.
   Self-oscillates at high resonance. This is the "east coast" voice; the native `BiquadFilter`
   lowpass does not sound like this and never will.
2. `folder-processor` — west-coast wavefolder (5–7 stage, Buchla 259 flavor) with drive,
   symmetry/offset, and fold count. *A static `WaveShaperNode` curve with a gain stage in front
   gets 80% of this for 5% of the work — prototype that first and only write the worklet when
   the difference is audible.*
3. `lpg-processor` — low-pass gate with a vactrol model (asymmetric attack/decay slew feeding a
   coupled filter+VCA). The signature west-coast "bonk." Modes: VCA / VCF / BOTH.
4. `entropy-processor` — sample & hold, fluctuating random, stepped random, clocked/free —
   a Buchla 266 "Source of Uncertainty." One worklet, several outlets.

Everything else (oscillators, envelopes, VCAs, delay, pan, ring mod, noise) is native nodes
or trivial compositions of them.

### Audio gotchas to design around from day one

- **`AudioContext` must be created inside a user gesture.** The boot sequence (§5) doubles as
  the unlock gesture — the user presses a key to "power on" and that's the click.
- `latencyHint: 'interactive'`, and let the browser pick the sample rate; don't force 48k.
- Every `AudioParam` change from the UI uses `setTargetAtTime` or a short
  `linearRampToValueAtTime` (~10–20 ms), never `.value =`. Zipper noise ruins the illusion instantly.
- Node teardown: disconnect *and* null out. Orphaned `OscillatorNode`s never stop costing CPU.
- Hard-limit the master bus (`WaveShaperNode` tanh + makeup, or `DynamicsCompressor` as a
  backstop). A matrix with feedback paths *will* be driven into self-oscillation on purpose,
  and headphones should survive it.
- Meters read from `AnalyserNode` on the **render loop**, never on the audio thread.

---

## 2. Signal architecture

A hybrid instrument. Two philosophies sharing one matrix, which is the interesting part.

```
EAST (subtractive, Moog-ish)           WEST (additive/timbral, Buchla-ish)
  VCO-1  saw/pulse/tri + PWM             CPLX   complex osc: PRI + MOD, through-zero FM
  VCO-2  saw/pulse/tri, sync, detune     FOLD   wavefolder (drive / symmetry / stages)
  NOISE  white / pink                    LPG    low-pass gate, vactrol, VCA|VCF|BOTH
  LADDER 4-pole ladder LP, self-osc      FNGEN  rise/fall function gen, self-cycling
  ADSR   x2                              ENTROPY S&H, stepped + fluctuating random
  VCA    linear / exponential

SHARED
  LFO-1, LFO-2   free or tempo-synced, 6 shapes
  RING           ring mod / 4-quadrant multiplier
  DELAY          time / feedback / mix, modulatable time (tape-ish)
  SPACE          small convolver or FDN reverb
  MIX            2-in mixer → master → limiter → out
  KBD            keyboard CV: pitch, gate, velocity, last/low/high priority
  SEQ            16-step, per-step pitch/gate/tie/probability
```

Voicing: **monophonic first.** A single patched voice is the honest modular experience and
removes an entire category of complexity. Polyphony ships later as *N cloned graphs sharing one
matrix state* — the matrix is the patch, voices are instances of it.

### Module contract

```ts
interface Module {
  id: string;                       // "VCO1"
  outlets: Record<string, AudioNode>;   // things you can connect FROM
  inlets:  Record<string, AudioParam | AudioNode>;  // things you can connect TO
  params:  Record<string, Param>;   // front-panel controls (may also be matrix inlets)
  dispose(): void;
}
```

A matrix connection is created as:

```ts
const pin = ctx.createGain();
pin.gain.value = depth;            // -1 … +1, attenuverter
src.outlets[out].connect(pin);
pin.connect(dst.inlets[in]);       // AudioParam or AudioNode, both work
```

Store pins in a `Map<"SRC.OUT>DST.IN", GainNode>`. Only instantiate on connect. Disconnect
removes the node entirely.

---

## 3. The patch matrix

The centerpiece, and the reason this idea works in ASCII at all.

The reference is the **EMS VCS3 "Putney"** pin matrix — an instrument that was already
essentially a character grid in 1969. Rows are sources, columns are destinations, a pin at the
intersection makes the connection. It is *the* synthesizer UI that was waiting for a text
terminal.

Depth is encoded in the glyph, so the matrix is readable at a glance as a texture:

```
  ·  open          ░  25%          ▒  50%          ▓  75%          █  100%
  ‹  inverted (negative depth, shown dim/red)
```

Roughly 18 sources × 17 destinations. It does not fit comfortably on screen at full size,
and that is deliberate: the matrix scrolls, and there is always more machine than window.
A minimap strip shows where you are in it.

---

## 4. Screen layout

Fixed **100 × 40 character grid**, scaled to fit the viewport (never reflowed — a stable
layout is what makes the mystery feel intentional rather than broken).

```
╔════════════════════════════════════════════════════════════════════════════════════════════════╗
║ ASCIISYNTH  SYS/7 ▸ "PUTNEY WEST"     PATCH: untitled*   ◈◈◈◇◇   cpu ▓▓▓░░░░ 31%   44100 Hz    ║
╠══════════════════════════╤════════════════════════════════════════════╤════════════════════════╣
║ ▸ VCO-1          [ EAST ]│  ROUTING MATRIX            [ 07 / 18 ]     │ ▸ CPLX         [ WEST ]║
║   WAVE  ‹ SAW  PLS  TRI ›│        O O O C C L L V V P D D F F E O O   │   RATIO  ‹ 1:1  3:2 ›  ║
║   FREQ  ▓▓▓▓▓▓▓░░░  262Hz│        1 1 2 P P P A C C A L L L N N U U   │   INDEX  ▓▓▓▓░░░░░  .41║
║   PW    ▓▓▓▓▓░░░░░   50% │        F P F F T G D A A N Y Y D G T T T   │   TIMBR  ▓▓▓▓▓▓▓░░  .68║
║   TUNE  ─────●────  +0.0¢│        M W M M B V R M M   T F R R C L R   │   FOLD   ▓▓▓▓▓▓▓▓▓  .91║
║                          │  VCO1▸SAW · · ▒ · · · · █ · ▒ · · · · · · ·│   SYMM   ───●─────  -.2║
║ ▸ LADDER                 │  VCO1▸PLS · · · · ░ · · · · · · · · · · · ·│                        ║
║   CUTOFF ▓▓▓▓▓▓░░░░ 1.2k │  VCO2▸TRI ▓ · · · · · · ▒ · · · · · · · · ·│ ▸ LPG                  ║
║   RESO   ▓▓▓▓▓▓▓▓░░  .79 │  CPLX▸PRI · · · · · ▓ · · · · · · · · · · ·│   MODE  ‹ VCA VCF BOTH›║
║   TRACK  ▓▓▓▓▓░░░░░  50% │  FOLD▸OUT · · · · · █ · · ░ · · · · · · · ·│   RESP  ▓▓▓░░░░░░  fast║
║   ⚠ self-osc above .85   │  NOISE    · ░ · · · · · · · ‹ · · · · · · ·│   DEPTH  ▓▓▓▓▓▓░░  .62 ║
║                          │  LFO-1    ▒ · · ░ · · · · · █ · · · · · · ·│                        ║
║ ▸ ADSR-1                 │  LFO-2    · · · · ▓ · · · · · ▒ · · · · · ·│ ▸ FNGEN                ║
║   A ▓▓░░░░░░░░    4ms    │  FNGEN    · · · ▒ ▓ · · · · · · · · · · · ·│   RISE  ▓▓░░░░░░░  12ms║
║   D ▓▓▓▓▓▓░░░░  240ms    │  ADSR-1   · · · · · · █ ░ █ · · · · · · · ·│   FALL  ▓▓▓▓▓▓▓░░  .8s ║
║   S ▓▓▓▓▓▓▓░░░    72%    │  ADSR-2   · · · · · ▒ ░ · · · · · · · · · ·│   CYCLE  [x] on        ║
║   R ▓▓▓▓░░░░░░  180ms    │  ENTROPY  ░ · ▒ · · · · · · · · · · · · · ·│                        ║
║                          │  KBD▸CV   █ · █ █ · · ▓ · · · · · · · · · ·│ ▸ ENTROPY              ║
║ ▸ VCA                    │  KBD▸GATE · · · · · ▓ · · █ · · · ░ █ · · ·│   RATE ▓▓▓▓░░░░░  4.1Hz║
║   LEVEL ▓▓▓▓▓▓▓░░   .70  │  RING     · · · · · · · · ▒ · · · · · · · ·│   SPREAD ▓▓▓▓▓▓░░  .55 ║
║   CURVE ‹ LIN  EXP ›     │  LADDER   · · · · · · · · █ · ░ · · · · · ·│   ⌁ 0.31 ⌁ -0.77 ⌁     ║
╠══════════════════════════╧════════════════════════════════════════════╧════════════════════════╣
║ SEQ ▸ ▶ 124 BPM  ┃ C3· ·  E3─ ─  G3· ·  A#3~ ·  C4· ·  G3· ·  D#3─ ·  F3· · ┃ ▓ 04/16          ║
╠════════════════════════════════════════════════════════════════════════════════════════════════╣
║ L ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░  -6.2dB  ┃ ∿∿⋀⋁∿⋀⋀⋁∿∿⋀⋁∿⋀⋁∿∿⋀⋁∿⋀⋀⋁∿ ┃  R ▓▓▓▓▓▓▓▓▓▓░░░░░░ -8.1dB           ║
╠════════════════════════════════════════════════════════════════════════════════════════════════╣
║ :patch save moonlight_                                       [?] help  [tab] focus  [esc] menu ║
╚════════════════════════════════════════════════════════════════════════════════════════════════╝
```

Reading top to bottom: title/status bar, three-column body (EAST rack | MATRIX | WEST rack),
sequencer strip, stereo meters + scope, command line.

---

## 5. Interaction

**Keyboard-first, mouse-tolerant.** A text instrument that requires a mouse is a lie.

- `hjkl` / arrows — move the cell cursor within the focused panel
- `tab` / `shift-tab` — cycle panels (EAST → MATRIX → WEST → SEQ)
- `space` — toggle matrix pin; `+` / `-` — depth up/down; `~` — invert (attenuverter)
- `[` `]` — nudge focused param; `{` `}` — coarse; `0` — default; hold `shift` for fine
- `zxcvbnm,` / `sdghj` — the classic QWERTY piano row, ~2 octaves; `<` `>` transpose
- `:` — command line (`:save`, `:load`, `:rand 30`, `:clear`, `:seq`, `:panic`, `:help`)
- `?` — help overlay, which is deliberately incomplete (see §7)

Mouse: click a matrix cell to toggle, drag vertically on a param to change it, scroll the
matrix. No dragging of cables — the matrix *is* the cable.

**Accessibility.** A character UI is a gift here: the whole instrument is already text.
- `aria-live="polite"` region announcing focus changes and value edits
- Full keyboard path to every function (already required above)
- `prefers-reduced-motion` kills CRT flicker, glyph decay, and the boot sequence
- A `:plain` command drops all decoration to a high-contrast monochrome grid
- Audio only ever starts from an explicit gesture

---

## 6. Rendering the text

**Recommendation: a custom character framebuffer over a single `<pre>` (or a canvas).**

Not xterm.js (a terminal emulator is a lot of machinery to get a grid, and it wants to own
input). Not React (reconciling 4,000 cells per frame is exactly what React is bad at).
rot.js's `Display` module is a legitimate shortcut if we'd rather not write the renderer —
it's a solid canvas char-grid built for roguelikes — but the renderer is ~200 lines and
owning it means owning the effects.

Design:

```ts
type Cell = { ch: string; fg: number; bg: number; attr: number };  // attr: bold|dim|blink|inv
class Screen {
  buf: Cell[];  prev: Cell[];       // double buffer
  put(x, y, ch, style): void
  text(x, y, str, style): void
  box(x, y, w, h, style): void
  flush(): void                      // diff prev→buf, patch only changed spans
}
```

- Panels are pure functions `(state) => draws into Screen`. No DOM per widget.
- `requestAnimationFrame` at 30 fps for meters/scope; static panels redraw only on state change.
- Canvas backend if per-cell effects (phosphor persistence, per-glyph jitter) get expensive;
  DOM `<span>` spans are fine at 100×40 with diffing and are trivially selectable/copyable —
  **start with DOM**, since "you can select and copy the screen" is itself part of the art.

**Font.** Needs a true 1:2 cell ratio and box-drawing + block glyphs. Candidates:
`PxPlus IBM VGA 8x16` (Ultimate Oldschool PC Font Pack, CC-BY-SA — most authentic),
`IBM Plex Mono`, `JetBrains Mono`, or `Cascadia Mono`. Subset and self-host; never rely on
a system monospace, because missing `▓` or `╠` destroys the layout.

**CRT treatment** (all optional, all behind one toggle):
scanline overlay · subtle bloom on bright glyphs · barrel distortion (CSS or a WebGL post-pass)
· amber/green/white phosphor themes · very slight flicker keyed to master output level, so the
screen *breathes with the sound*.

---

## 7. Confusion and wonder — the deliberate part

The layout stays honest. The *content* does not explain itself.

- **Cryptic-but-consistent labels.** `SYMM`, `⌁`, `◈◈◈◇◇`, `07/18`. Every one means something
  exact. None are glossed on screen.
- **A fragmentary manual.** `?` opens a help overlay with sections missing — "§4 THE UNCERTAINTY
  SOURCE — [page torn]". What *is* documented is completely accurate. The instrument never lies,
  it only omits.
- **Uptime that predates you.** The status bar counts from a date before the session started.
- **Occupied matrix cells at boot.** The default patch is *someone else's patch*, half-erased.
- **Glyph decay.** Idle >90 s and characters in unused panels very occasionally degrade a step
  (`█`→`▓`→`▒`), restored the moment you touch them. Off under reduced-motion.
- **A boot sequence.** 3–4 seconds of self-test lines, one of which reports a fault it then
  quietly recovers from. Skippable with any key — which is also the audio unlock gesture.
- **Modules that appear.** One or two panels (a second entropy source, a feedback bus) only
  become visible after a condition is met — e.g. driving the ladder into self-oscillation for
  10+ seconds. Discoverable, never required.
- **The patch is ASCII.** `:save` prints the patch as a text block — matrix glyphs and all —
  that you can copy from the screen, paste into a text file, email, and `:load` back by pasting
  into the command line. The save format and the display are *the same artifact*. This is the
  whole thesis of the project in one feature; build it early.

Rule that keeps this from being annoying: **mystery in the surface, never in the mechanism.**
Nothing is random that affects the sound without the user causing it. No hidden state changes
audio. Every glyph maps to a real, inspectable value.

---

## 8. Project structure

```
AsciiSynth/
├─ index.html
├─ package.json          # vite + typescript + tone; that's the whole dep list
├─ vite.config.ts
├─ public/fonts/         # subset PxPlus IBM VGA
└─ src/
   ├─ main.ts            # boot, unlock, RAF loop
   ├─ screen/
   │   ├─ screen.ts      # framebuffer + diff renderer
   │   ├─ glyphs.ts      # box drawing, meters, sliders, matrix pins
   │   └─ crt.ts         # scanlines, bloom, phosphor themes
   ├─ audio/
   │   ├─ engine.ts      # AudioContext, master bus, limiter, panic
   │   ├─ matrix.ts      # pin graph: connect/disconnect/depth
   │   ├─ modules/       # vco.ts ladder.ts adsr.ts vca.ts cplx.ts lpg.ts
   │   │                 # fngen.ts entropy.ts lfo.ts ring.ts delay.ts space.ts
   │   └─ worklets/      # ladder.js folder.js lpg.js entropy.js
   ├─ ui/
   │   ├─ panels/        # one draw fn per panel
   │   ├─ focus.ts       # cursor, panel cycling
   │   └─ input.ts       # keymap, command line, mouse
   ├─ state/
   │   ├─ store.ts       # plain observable store; no framework
   │   └─ patch.ts       # serialize/parse the ASCII patch format
   └─ seq/
       ├─ transport.ts   # Tone.Transport wiring
       └─ sequencer.ts
```

Vite + TypeScript, no UI framework. Three runtime dependencies at most.

---

## 9. Milestones

**M0 — Spike (½ day).** One `<pre>`, one `OscillatorNode`, one `GainNode`, one key toggles a
pin that connects an LFO to pitch. Proves the whole architecture in 100 lines. *Do this before
anything else.*

**M1 — Screen engine.** Framebuffer, diff renderer, box/meter/slider glyph helpers, font
loaded, 100×40 locked and scaling. Static mockup of §4 rendering at 60 fps.

**M2 — East voice.** VCO-1/2, noise, ladder worklet, ADSR ×2, VCA, keyboard input, master
limiter. It makes a recognizably Moog-ish sound with panel controls only — no matrix yet.

**M3 — The matrix.** Pin graph, cursor, depth glyphs, scrolling, attenuverters. The instrument
becomes modular. This is the moment the project either sings or doesn't; budget accordingly.

**M4 — West voice.** Complex osc, wavefolder (WaveShaper first, worklet if needed), LPG,
function generator, entropy source. The two halves now share one matrix.

**M5 — Time.** Tone.Transport, 16-step sequencer with per-step gate/tie/probability, tempo-
synced LFOs, delay.

**M6 — Patch as text.** Serialize, copy, paste, load. Ships with 8–10 curated patches that
double as tutorials. Deep-link via URL hash for sharing.

**M7 — Atmosphere.** Boot sequence, CRT layer, phosphor themes, fragmentary manual, glyph decay,
hidden modules, reduced-motion and `:plain` paths.

**M8 — Ship.** Static build to GitHub Pages. Record a demo. Write the README in-character.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Matrix UX is unreadable in practice | Prototype §4 as a static mockup at M1 and stare at it for a day before building M3 |
| Custom worklets eat the schedule | WaveShaper/Biquad approximations first; worklets only where the difference is audible |
| Feedback paths blow up / hurt ears | Hard limiter on master from M2, `:panic` key, depth clamps on feedback destinations |
| "Mystery" reads as "broken" | Layout and labels are always stable; nothing hidden ever changes the sound on its own |
| Mobile | Out of scope. Desktop keyboard instrument. Show a polite in-character notice on small screens. |
| CPU with a dense patch | Lazy pin nodes, mono voice, worklet count kept ≤4, meters off the audio thread |

---

## 11. Open questions

1. Mono forever, or paraphonic later? (Recommendation: mono through M8; it's more honest and
   removes a large class of work.)
2. MIDI in via Web MIDI — worth it at M5, or a distraction?
3. Recording: `MediaRecorder` on the master bus for a WAV/WebM export is ~30 lines and makes
   the thing shareable. Probably M6.
4. Does the fragmentary manual imply a *character* — someone who built this machine — or is
   that one step too much narrative?
