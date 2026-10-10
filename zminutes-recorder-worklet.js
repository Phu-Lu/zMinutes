class ZMinutesPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.used = 0;
    this.port.onmessage = event => {
      if (event.data !== 'flush') return;
      this.sendChunk();
      this.port.postMessage({ flushed: true });
    };
  }

  sendChunk() {
    if (!this.used) return;
    const samples = this.buffer.slice(0, this.used);
    this.port.postMessage({ samples }, [samples.buffer]);
    this.used = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (let offset = 0; offset < input.length;) {
        const count = Math.min(input.length - offset, this.buffer.length - this.used);
        this.buffer.set(input.subarray(offset, offset + count), this.used);
        this.used += count;
        offset += count;
        if (this.used === this.buffer.length) this.sendChunk();
      }
    }
    for (const output of outputs[0] || []) output.fill(0);
    return true;
  }
}

registerProcessor('zminutes-pcm-recorder', ZMinutesPcmProcessor);
