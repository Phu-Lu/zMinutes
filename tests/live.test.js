const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
function setup(transcribe) {
  const nodes = new Map();
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, { hidden: false, textContent: "" }); return nodes.get(id); };
  const meeting = { id: "meeting", cloudAudioAllowed: true, transcriptSegments: [{ id: "old", recordingId: "old", text: "Existing transcript" }] };
  const A = { $, data: { meetings: [meeting] }, ai: { transcribePart: transcribe },
    flush: async () => {}, updateMeeting: async (id, patch) => Object.assign(meeting, structuredClone(patch)) };
  vm.runInNewContext(fs.readFileSync(require("node:path").join(__dirname, "../zminutes-live.js"), "utf8"), {
    ZM: A, ZMinutesCapture: { wav: (parts) => new Blob(parts) }, AbortController,
    crypto: { randomUUID }, console,
  });
  const start = () => A.live.start({ id: "recording", meetingId: "meeting", title: "Test", created: 1 }, { p: "openai", model: "custom-audio-model", key: "test" });
  return { A, $, meeting, start };
}
const chunk = () => new Uint8Array(20 * 16000 * 2);
test("live chunks run sequentially, keep selected model, and append one stable persisted segment", async () => {
  let active = 0, peak = 0, calls = 0;
  const { A, meeting, start } = setup(async (blob, config) => {
    peak = Math.max(peak, ++active); calls++;
    assert.equal(config.model, "custom-audio-model");
    await new Promise((resolve) => setImmediate(resolve)); active--; return "chunk " + calls;
  });
  const s = start(); A.live.push(s, chunk()); A.live.push(s, chunk()); A.live.push(s, new Uint8Array(32000));
  await A.live.finish(s);
  assert.equal(calls, 3); assert.equal(peak, 1); assert.equal(A.live.busy, false);
  assert.equal(meeting.transcriptSegments.length, 2);
  assert.equal(meeting.transcriptSegments[0].text, "Existing transcript");
  assert.match(meeting.transcriptSegments[1].text, /chunk 1\n\nchunk 2\n\nchunk 3/);
});
test("live stop rejects late responses and retains earlier persisted chunks", async () => {
  let resolve;
  let calls = 0;
  const { A, meeting, start } = setup(async () => ++calls === 1 ? "saved" : new Promise((r) => { resolve = r; }));
  const s = start(); A.live.push(s, chunk()); await s.tail;
  A.live.push(s, chunk()); await new Promise((r) => setImmediate(r));
  A.live.stop(s, "Stopped"); resolve("must not appear"); await A.live.finish(s);
  assert.match(meeting.transcriptSegments[1].text, /saved/);
  assert.doesNotMatch(meeting.transcriptSegments[1].text, /must not appear/);
});
test("live failure and revoked consent stop uploads without altering existing transcript", async () => {
  for (const revoke of [false, true]) {
    let calls = 0;
    const { A, meeting, start, $ } = setup(async () => { calls++; throw new Error("Invalid model"); });
    const s = start(); if (revoke) meeting.cloudAudioAllowed = false;
    A.live.push(s, chunk()); await A.live.finish(s);
    assert.equal(calls, revoke ? 0 : 1);
    assert.equal(meeting.transcriptSegments.length, 1);
    assert.match($("liveDraftStatus").textContent, /stopped/i);
    assert.equal(A.live.busy, false);
  }
});
test("live queue is bounded and never grows indefinitely on a slow connection", async () => {
  let calls = 0;
  const { A, start } = setup(async () => { calls++; return "unused"; });
  const s = start(); for (let i = 0; i < 20; i++) A.live.push(s, chunk());
  assert.ok(s.pending <= 3); assert.equal(s.bytes, 0);
  await A.live.finish(s); assert.equal(calls, 0); assert.equal(A.live.busy, false);
});

test("live translate adds a translation per chunk but keeps the saved transcript original-only", async () => {
  const { A, $, meeting, start } = setup(async () => "xin chao moi nguoi");
  $("liveTranslateEnabled").checked = true;
  const seen = [];
  A.ai.translateLive = async (meetingId, original) => { seen.push([meetingId, original]); return "hello everyone"; };
  const shared = [];
  A.ai.setLiveTranslation = (id, parts) => shared.push([id, [...parts]]);
  const s = start(); A.live.push(s, chunk());
  await A.live.finish(s);
  assert.deepEqual(seen, [["meeting", "xin chao moi nguoi"]]);
  assert.match($("liveDraftText").textContent, /xin chao moi nguoi\n→ hello everyone/);
  assert.equal(meeting.transcriptSegments.at(-1).text.includes("hello everyone"), false);
  assert.deepEqual(shared.at(-1), ["meeting", ["hello everyone"]]);
});
test("a translation failure does not stop the live transcript", async () => {
  const { A, $, meeting, start } = setup(async () => "one chunk");
  $("liveTranslateEnabled").checked = true;
  A.ai.translateLive = async () => { throw new Error("quota exceeded"); };
  const s = start(); A.live.push(s, chunk()); A.live.push(s, chunk());
  await A.live.finish(s);
  assert.equal(s.failed, false);
  assert.equal(meeting.transcriptSegments.at(-1).text.includes("one chunk"), true);
  assert.match($("liveDraftText").textContent, /Translation unavailable: quota exceeded/);
});
