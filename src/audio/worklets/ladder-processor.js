// A 4-pole transistor-ladder-style lowpass filter, running in the audio
// thread. Four cascaded one-pole stages with a tanh-saturated feedback path —
// pushing RESONANCE up drives the feedback hard enough to self-oscillate,
// same as the real thing.
class LadderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'cutoff', defaultValue: 1200, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'resonance', defaultValue: 0.2, minValue: 0, maxValue: 1.1, automationRate: 'k-rate' },
      { name: 'drive', defaultValue: 1, minValue: 0.2, maxValue: 6, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.s1 = this.s2 = this.s3 = this.s4 = 0;
  }

  process(inputs, outputs, params) {
    const input = (inputs[0] && inputs[0][0]) || null;
    const output = outputs[0][0];
    if (!output) return true;
    const cutoffArr = params.cutoff;
    const reso = params.resonance[0];
    const drive = params.drive[0];
    const n = output.length;
    for (let i = 0; i < n; i++) {
      const fc = cutoffArr.length > 1 ? cutoffArr[i] : cutoffArr[0];
      const fNorm = Math.min(0.49, Math.max(0.0005, fc / sampleRate));
      const g = 1 - Math.exp(-2 * Math.PI * fNorm);
      const x = input ? input[i] : 0;
      const fb = reso * 4.2 * this.s4;
      const inp = Math.tanh((x - fb) * drive);
      this.s1 += g * (inp - this.s1);
      this.s2 += g * (this.s1 - this.s2);
      this.s3 += g * (this.s2 - this.s3);
      this.s4 += g * (this.s3 - this.s4);
      output[i] = this.s4;
    }
    return true;
  }
}
registerProcessor('ladder-processor', LadderProcessor);
