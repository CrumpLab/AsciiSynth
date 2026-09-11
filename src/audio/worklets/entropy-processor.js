// Buchla-266-flavored "source of uncertainty": a clocked random generator
// running on the audio thread. smooth=0 gives stepped sample & hold;
// smooth>0 glides toward each new target ("fluctuating random").
class EntropyProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 4, minValue: 0.02, maxValue: 200, automationRate: 'k-rate' },
      { name: 'smooth', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
    this.current = 0;
    this.target = Math.random() * 2 - 1;
  }

  process(inputs, outputs, params) {
    const output = outputs[0][0];
    if (!output) return true;
    const rate = params.rate[0];
    const smooth = params.smooth[0];
    const period = sampleRate / Math.max(0.02, rate);
    const glideCoef = smooth > 0 ? 1 - Math.exp(-1 / (smooth * period + 1)) : 1;
    for (let i = 0; i < output.length; i++) {
      this.phase++;
      if (this.phase >= period) {
        this.phase = 0;
        this.target = Math.random() * 2 - 1;
        if (smooth <= 0) this.current = this.target;
      }
      this.current += (this.target - this.current) * glideCoef;
      output[i] = this.current;
    }
    return true;
  }
}
registerProcessor('entropy-processor', EntropyProcessor);
