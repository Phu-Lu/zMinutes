const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'zminutes-ai.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(getUserMedia, RecorderOverride) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: id === 'aiProvider' ? 'quick' : '', checked: false, textContent: '', disabled: false,
        firstChild: { textContent: '● ' },
        classList: { add() {}, remove() {}, toggle() {} },
        querySelector() { return this.span ||= { textContent: 'Record' }; },
        setAttribute() {}, addEventListener() {},
      });
    }
    return elements.get(id);
  };
  const meeting = { id: 'test-meeting', title: 'Test', note: '', transcript: '', agenda: [], photos: [], cloudAudioAllowed: false };
  class FakeAudioContext {
    constructor() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  class FakeRecorder {
    constructor(stream, audioContext) { this.stream = stream; this.context = audioContext; }
    async start() {}
    async stop() { return new Blob([new Uint8Array(50)], { type: 'audio/wav' }); }
    async abort() { this.stream.getTracks().forEach(track => track.stop()); await this.context.close(); }
  }
  class FakeFileReader {
    readAsDataURL(blob) { this.result = `data:${blob.type};base64,YXVkaW8=`; queueMicrotask(() => this.onload()); }
  }
  const context = {
    Blob, FileReader: FakeFileReader, console: { ...console, error() {} },
    current: meeting, elapsed: 0, saveCurrent() {}, persist() { return Promise.resolve(true); }, renderSummary() {}, formatTime: String,
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: { mediaDevices: { getUserMedia }, permissions: { async query() { return { state: 'granted' }; } } },
    window: { isSecureContext: true, AudioContext: FakeAudioContext, AudioWorkletNode: class {}, ZMinutesPcmRecorder: RecorderOverride || FakeRecorder },
    document: { getElementById: element, addEventListener() {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 15000 || ms === 8000 ? 10 : ms), clearTimeout,
    setInterval: () => 1, clearInterval() {},
  };
  vm.runInNewContext(source, context);
  return { context, element, meeting };
}

test('stalled microphone request times out, reports granted permission, and releases a late stream', async () => {
  let resolveMicrophone, stopped = 0;
  const request = new Promise(resolve => { resolveMicrophone = resolve; });
  const { context, element } = harness(() => request);
  await context.toggleRecord();
  assert.match(element('recordStatus').textContent, /permission granted.*request did not finish/i);
  assert.equal(element('recordBtn').disabled, false);
  resolveMicrophone({ getTracks: () => [{ stop() { stopped++; } }] });
  await tick();
  assert.equal(stopped, 1);
});

test('connecting request can be canceled without leaving the record button stuck', async () => {
  let resolveMicrophone, stopped = 0;
  const request = new Promise(resolve => { resolveMicrophone = resolve; });
  const { context, element } = harness(() => request);
  const connecting = context.toggleRecord();
  await context.toggleRecord();
  await connecting;
  assert.match(element('recordStatus').textContent, /canceled/i);
  assert.equal(element('recordBtn').disabled, false);
  resolveMicrophone({ getTracks: () => [{ stop() { stopped++; } }] });
  await tick();
  assert.equal(stopped, 1);
});

test('successful recording stores audio on the captured meeting and stops the mic track', async () => {
  let stopped = 0;
  const { context, element, meeting } = harness(async () => ({ getTracks: () => [{ stop() { stopped++; } }] }));
  await context.toggleRecord();
  assert.match(element('recordStatus').textContent, /is recording/i);
  await context.toggleRecord();
  await tick();
  assert.match(meeting.audio, /^data:audio\/wav/);
  assert.equal(stopped, 1);
  assert.equal(element('recordBtn').disabled, false);
});

test('audio engine startup failure is visible and releases the microphone', async () => {
  let stopped = 0;
  class BrokenRecorder {
    constructor(stream, context) { this.stream = stream; this.context = context; }
    async start() { throw new Error('audio engine failed'); }
    async abort() { this.stream.getTracks().forEach(track => track.stop()); await this.context.close(); }
  }
  const { context, element } = harness(async () => ({ getTracks: () => [{ stop() { stopped++; } }] }), BrokenRecorder);
  await context.toggleRecord();
  assert.match(element('recordStatus').textContent, /audio engine failed/i);
  assert.equal(element('recordBtn').disabled, false);
  assert.equal(stopped, 1);
});

test('imported phone audio is saved without opening the microphone', async () => {
  const { element, meeting } = harness(() => { throw new Error('Microphone should not be requested'); });
  const input = element('audioFileInput');
  await input.onchange({ target: { files: [{ type: 'audio/mp4', name: 'meeting.m4a', size: 5 }], value: 'meeting.m4a' } });
  assert.match(meeting.audio, /^data:audio\/mp4/);
  assert.match(element('recordStatus').textContent, /saved with this meeting/i);
});

test('PCM recorder produces a valid 16 kHz mono WAV and releases the track', async () => {
  const scope = { window: {}, Blob, Float32Array, Uint8Array, DataView, setTimeout, URL, document: { currentScript: { src: 'http://localhost/zminutes-recorder.js' } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'zminutes-recorder.js'), 'utf8'), scope);
  let stopped = 0;
  const context = { sampleRate: 48000, state: 'running', async close() { this.state = 'closed'; } };
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const recorder = new scope.window.ZMinutesPcmRecorder(stream, context);
  recorder.append(new Float32Array(4800).fill(0.25));
  const blob = await recorder.stop();
  const bytes = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(bytes.getUint32(24, true), 16000);
  assert.equal(bytes.getUint16(22, true), 1);
  assert.equal(bytes.getUint32(40, true), 3200);
  assert.equal(blob.size, 3244);
  assert.equal(stopped, 1);
});
