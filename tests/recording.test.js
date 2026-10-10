const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'zminutes-ai.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(getUserMedia) {
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
  class FakeRecorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob(['audio'], { type: 'audio/webm' }) });
      this.onstop();
    }
  }
  class FakeFileReader {
    readAsDataURL() { this.result = 'data:audio/webm;base64,YXVkaW8='; queueMicrotask(() => this.onload()); }
  }
  const context = {
    Blob, FileReader: FakeFileReader, MediaRecorder: FakeRecorder, console: { ...console, error() {} },
    current: meeting, elapsed: 0, saveCurrent() {}, persist() {}, renderSummary() {}, formatTime: String,
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: { mediaDevices: { getUserMedia }, permissions: { async query() { return { state: 'granted' }; } } },
    window: { isSecureContext: true, MediaRecorder: FakeRecorder },
    document: { getElementById: element, addEventListener() {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 15000 ? 10 : ms), clearTimeout,
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
  assert.match(meeting.audio, /^data:audio\/webm/);
  assert.equal(stopped, 1);
  assert.equal(element('recordBtn').disabled, false);
});

test('imported phone audio is saved without opening the microphone', async () => {
  const { element, meeting } = harness(() => { throw new Error('Microphone should not be requested'); });
  const input = element('audioFileInput');
  await input.onchange({ target: { files: [{ type: 'audio/mp4', name: 'meeting.m4a', size: 5 }], value: 'meeting.m4a' } });
  assert.match(meeting.audio, /^data:audio\/webm/);
  assert.match(element('recordStatus').textContent, /saved with this meeting/i);
});
