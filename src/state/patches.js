// The instrument boots into someone else's patch, half-remembered. A few
// more are reachable with `:patch <name>`.

export const DEFAULT_PATCH = `ASCIISYNTH PATCH v1 "(unnamed) recovered"
VCO1 wave=0 pw=0.5 tune=0
VCO2 wave=2 pw=0.5 tune=-6
NOISE color=0 level=0.18
LADDER cutoff=1400 resonance=0.35 drive=1.2
ADSR1 attack=0.01 decay=0.25 sustain=0.55 release=0.35
ADSR2 attack=0.4 decay=0.6 sustain=0.3 release=0.3
VCA level=0.7 curve=0
LFO1 shape=0 rate=4.5
LFO2 shape=0 rate=0.3
CPLX ratio=1.5 index=0.3
FOLD drive=1.0 stages=2 symmetry=0
LPG mode=0 response=0.15 depth=0.7
FNGEN rise=0.05 fall=0.4 cycle=0
ENTROPY rate=4 spread=0
RING level=0.5
DELAY time=0.3 feedback=0.35 mix=0.3
PATCH:
ADSR1>LADDER.CUTOFF 0.40
LFO1>LADDER.CUTOFF 0.15
LFO2>PAN 0.50
ENTROPY>FOLD.DRIVE 0.30
KBDCV>CPLX.INDEX 0.20
END`;

export const PRESETS = {
  drone: `ASCIISYNTH PATCH v1 "drone"
VCO1 wave=0 pw=0.5 tune=0
VCO2 wave=0 pw=0.5 tune=7
NOISE color=1 level=0.05
LADDER cutoff=600 resonance=0.92 drive=2.5
ADSR1 attack=1.5 decay=1 sustain=1 release=2
ADSR2 attack=2 decay=1 sustain=1 release=3
VCA level=0.6 curve=1
LFO1 shape=0 rate=0.08
LFO2 shape=1 rate=0.05
CPLX ratio=2 index=0.1
FOLD drive=0.5 stages=1 symmetry=0
LPG mode=2 response=0.8 depth=0.5
FNGEN rise=2 fall=3 cycle=1
ENTROPY rate=0.3 spread=0.8
RING level=0.3
DELAY time=0.6 feedback=0.55 mix=0.4
PATCH:
LFO1>LADDER.CUTOFF 0.60
FNGEN>LADDER.CUTOFF 0.30
ENTROPY>VCO2.FM 0.10
LFO2>DELAY.TIME 0.40
END`,

  uncertainty: `ASCIISYNTH PATCH v1 "uncertainty"
VCO1 wave=1 pw=0.3 tune=0
VCO2 wave=1 pw=0.7 tune=-12
NOISE color=0 level=0.1
LADDER cutoff=3000 resonance=0.1 drive=1
ADSR1 attack=0.005 decay=0.1 sustain=0.2 release=0.1
ADSR2 attack=0.02 decay=0.3 sustain=0 release=0.2
VCA level=0.5 curve=1
LFO1 shape=3 rate=9
LFO2 shape=2 rate=0.6
CPLX ratio=2.83 index=1.4
FOLD drive=2.6 stages=4 symmetry=0.2
LPG mode=2 response=0.05 depth=0.9
FNGEN rise=0.01 fall=0.15 cycle=0
ENTROPY rate=11 spread=0.15
RING level=0.6
DELAY time=0.18 feedback=0.5 mix=0.35
PATCH:
ENTROPY>CPLX.INDEX 0.70
ENTROPY>FOLD.DRIVE 0.50
KBDCV>ENTROPY.RATE 0.60
NOISE>RING.IN 0.40
GATE>RING.CARRIER 0.80
LFO1>PAN 0.90
END`,

  putney: `ASCIISYNTH PATCH v1 "putney west"
VCO1 wave=0 pw=0.5 tune=0
VCO2 wave=2 pw=0.5 tune=4
NOISE color=1 level=0.12
LADDER cutoff=1800 resonance=0.55 drive=1.4
ADSR1 attack=0.02 decay=0.35 sustain=0.5 release=0.4
ADSR2 attack=0.1 decay=0.5 sustain=0.2 release=0.6
VCA level=0.68 curve=0
LFO1 shape=0 rate=5.2
LFO2 shape=1 rate=0.22
CPLX ratio=1.5 index=0.6
FOLD drive=1.4 stages=3 symmetry=-0.15
LPG mode=1 response=0.2 depth=0.75
FNGEN rise=0.08 fall=0.9 cycle=0
ENTROPY rate=2.5 spread=0.4
RING level=0.4
DELAY time=0.31 feedback=0.4 mix=0.28
PATCH:
ADSR1>LADDER.CUTOFF 0.55
LFO1>VCO2.FM 0.10
LFO2>PAN 0.60
ADSR2>FOLD.DRIVE 0.35
ENTROPY>LPG.STRIKE 0.25
KBDCV>CPLX.INDEX 0.30
VCO2>RING.IN 0.60
LFO1>RING.CARRIER 0.35
END`,
};

export function listPresetNames() { return Object.keys(PRESETS); }
