/* Local microphone capture without MediaRecorder codecs. Produces 16 kHz mono WAV. */
const zMinutesWorkletUrl = new URL('./zminutes-recorder-worklet.js?v=18', document.currentScript.src).href;
class ZMinutesPcmRecorder {
  constructor(stream, context) {
    this.stream = stream;
    this.context = context;
    this.sampleRate = Math.min(16000, context.sampleRate);
    this.parts = [];
    this.samples = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.closed = false;
    this.firstChunk = new Promise(resolve => { this.resolveFirstChunk = resolve; });
  }

  async start() {
    await this.context.audioWorklet.addModule(zMinutesWorkletUrl);
    if (this.closed) throw new Error('Audio engine was canceled.');
    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'zminutes-pcm-recorder');
    this.node.port.onmessage = event => {
      if (event.data?.samples) {
        this.append(event.data.samples);
        this.resolveFirstChunk();
      }
      if (event.data?.flushed) this.resolveFlush?.();
    };
    this.source.connect(this.node);
    this.node.connect(this.context.destination);
    if (this.context.state !== 'running') await this.context.resume();
    if (this.closed) throw new Error('Audio engine was canceled.');
    let firstTimer;
    try {
      await Promise.race([
        this.firstChunk,
        new Promise((_, reject) => { firstTimer = setTimeout(() => reject(new Error('The audio engine received no microphone samples.')), 5000); }),
      ]);
    } finally { clearTimeout(firstTimer); }
  }

  append(input) {
    const output = [];
    for (const sample of input) {
      this.sum += sample;
      this.count++;
      this.phase += this.sampleRate;
      if (this.phase >= this.context.sampleRate) {
        this.phase -= this.context.sampleRate;
        output.push(Math.max(-1, Math.min(1, this.sum / this.count)));
        this.sum = 0;
        this.count = 0;
      }
    }
    if (!output.length) return;
    const bytes = new Uint8Array(output.length * 2), view = new DataView(bytes.buffer);
    output.forEach((value, i) => view.setInt16(i * 2, value < 0 ? value * 32768 : value * 32767, true));
    this.parts.push(bytes);
    this.samples += output.length;
  }

  async stop() {
    if (this.closed) throw new Error('Recorder is already closed.');
    this.source?.disconnect();
    if (this.node) {
      let flushTimer;
      try {
        await Promise.race([
          new Promise(resolve => { this.resolveFlush = resolve; this.node.port.postMessage('flush'); }),
          new Promise(resolve => { flushTimer = setTimeout(resolve, 500); }),
        ]);
      } finally { clearTimeout(flushTimer); }
    }
    const header = new ArrayBuffer(44), view = new DataView(header), bytes = this.samples * 2;
    const word = (at, text) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
    word(0, 'RIFF');view.setUint32(4, 36 + bytes, true);word(8, 'WAVE');word(12, 'fmt ');
    view.setUint32(16, 16, true);view.setUint16(20, 1, true);view.setUint16(22, 1, true);
    view.setUint32(24, this.sampleRate, true);view.setUint32(28, this.sampleRate * 2, true);
    view.setUint16(32, 2, true);view.setUint16(34, 16, true);word(36, 'data');view.setUint32(40, bytes, true);
    const blob = new Blob([header, ...this.parts], { type: 'audio/wav' });
    await this.abort();
    return blob;
  }

  async abort() {
    if (this.closed) return;
    this.closed = true;
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.port.close();
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}

window.ZMinutesPcmRecorder = ZMinutesPcmRecorder;
