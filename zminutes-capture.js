/* Start AudioContext inside the click gesture. No network is needed to load the worklet. */
(() => {
  async function bounded(promise, ms, message) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function wav(parts, rate = 16000) {
    const bytes = parts.reduce((n, p) => n + p.byteLength, 0),
      h = new ArrayBuffer(44),
      v = new DataView(h),
      word = (at, s) =>
        [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    word(0, "RIFF");
    v.setUint32(4, 36 + bytes, true);
    word(8, "WAVE");
    word(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    word(36, "data");
    v.setUint32(40, bytes, true);
    return new Blob([h, ...parts], { type: "audio/wav" });
  }
  const worklet = `class Capture extends AudioWorkletProcessor{constructor(){super();this.buffer=new Float32Array(4096);this.used=0;this.port.onmessage=()=>{this.flush();this.port.postMessage({flushed:true})}}flush(){if(this.used){const samples=this.buffer.slice(0,this.used);this.port.postMessage({samples},[samples.buffer]);this.used=0}}process(inputs,outputs){const input=inputs[0]?.[0];if(input)for(let at=0;at<input.length;){const n=Math.min(input.length-at,4096-this.used);this.buffer.set(input.subarray(at,at+n),this.used);this.used+=n;at+=n;if(this.used===4096)this.flush()}for(const out of outputs[0]||[])out.fill(0);return true}}registerProcessor('zminutes-capture',Capture);`;
  class Capture {
    constructor(stream, context, onChunk) {
      this.stream = stream;
      this.context = context;
      this.onChunk = onChunk;
      this.parts = [];
      this.phase = 0;
      this.sum = 0;
      this.count = 0;
      this.samples = 0;
      this.closed = false;
      this.lastSample = Date.now();
      this.first = new Promise((r) => (this.firstResolve = r));
    }
    append(input) {
      if (this.closed) return;
      const out = [];
      for (const value of input) {
        this.sum += value;
        this.count++;
        this.phase += 16000;
        if (this.phase >= this.context.sampleRate) {
          this.phase -= this.context.sampleRate;
          out.push(Math.max(-1, Math.min(1, this.sum / this.count)));
          this.sum = 0;
          this.count = 0;
        }
      }
      if (!out.length) return;
      const bytes = new Uint8Array(out.length * 2),
        view = new DataView(bytes.buffer);
      out.forEach((x, i) =>
        view.setInt16(i * 2, x < 0 ? x * 32768 : x * 32767, true),
      );
      this.samples += out.length;
      this.lastSample = Date.now();
      if (this.onChunk) this.onChunk(bytes);
      else this.parts.push(bytes);
      this.firstResolve();
    }
    disconnect() {
      try {
        this.source?.disconnect();
      } catch {}
      try {
        this.node?.disconnect();
      } catch {}
      if (this.node?.port) this.node.port.close();
      if (this.node) this.node.onaudioprocess = null;
    }
    async start(resumed) {
      await bounded(
        resumed || this.context.resume(),
        3000,
        "Audio could not start. Tap Record again while this tab is visible.",
      );
      if (this.closed) throw new Error("Recording canceled");
      if (this.context.state !== "running")
        throw new Error("Audio is paused by the browser. Tap Record again.");
      this.source = this.context.createMediaStreamSource(this.stream);
      try {
        if (!this.context.audioWorklet || !window.AudioWorkletNode)
          throw new Error("AudioWorklet unavailable");
        const url = URL.createObjectURL(
          new Blob([worklet], { type: "text/javascript" }),
        );
        try {
          await bounded(
            this.context.audioWorklet.addModule(url),
            2000,
            "Audio processor did not load",
          );
        } finally {
          URL.revokeObjectURL(url);
        }
        if (this.closed) throw new Error("Recording canceled");
        this.node = new AudioWorkletNode(this.context, "zminutes-capture");
        this.node.port.onmessage = (e) => {
          if (e.data.samples) this.append(e.data.samples);
          if (e.data.flushed) this.flushed?.();
        };
        this.source.connect(this.node);
        this.node.connect(this.context.destination);
        await bounded(this.first, 2500, "Audio processor received no samples");
        this.engine = "AudioWorklet";
      } catch (error) {
        this.disconnect();
        if (this.closed) throw error;
        // Compatibility path for browsers whose worklet cannot initialize.
        this.source = this.context.createMediaStreamSource(this.stream);
        this.node = this.context.createScriptProcessor(4096, 1, 1);
        this.node.onaudioprocess = (e) => {
          this.append(e.inputBuffer.getChannelData(0));
          e.outputBuffer.getChannelData(0).fill(0);
        };
        this.source.connect(this.node);
        this.node.connect(this.context.destination);
        await bounded(
          this.first,
          2500,
          "The microphone opened but delivered no audio. Check the system input device.",
        );
        this.engine = "Compatibility";
      }
    }
    async stop() {
      if (this.closed) throw new Error("Recorder is closed");
      try {
        this.source?.disconnect();
        if (this.node?.port)
          await bounded(
            new Promise((r) => {
              this.flushed = r;
              this.node.port.postMessage("flush");
            }),
            300,
            "Flush timeout",
          ).catch(() => {});
      } finally {
        this.abort();
      }
      return wav(this.parts);
    }
    abort() {
      if (this.closed) return;
      this.closed = true;
      this.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      if (this.context.state !== "closed")
        this.context
          .close()
          .catch(
            () => {},
          ); /* Never wait for a browser close promise to restore the UI. */
    }
  }
  window.ZMinutesCapture = { Capture, wav, bounded };
})();
