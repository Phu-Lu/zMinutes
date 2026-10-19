/* Provider-neutral, bounded live draft queue. Audio capture/storage never waits on AI. */
(() => {
  const A = ZM, $ = A.$;
  const limit = 30 * 16000 * 2;
  let current = null;
  const status = (s, message) => {
    if (current !== s) return;
    $("liveDraftPanel").hidden = false;
    $("liveDraftStatus").textContent = `${s.title} · ${message}`;
  };
  function stop(s, reason) {
    if (!s || s.failed) return;
    s.failed = true;
    s.controller.abort();
    s.buffers = [];
    s.bytes = 0;
    status(s, `${reason} Saved draft kept. Audio capture is independent; use Transcribe after saving for a full transcript.`);
    $("stopLiveBtn").hidden = true;
    $("dismissLiveBtn").hidden = false;
  }
  function enqueue(s) {
    if (s.failed || !s.bytes) return;
    if (s.pending >= 3) { stop(s, "Live draft stopped: connection cannot keep up."); return; }
    const blob = ZMinutesCapture.wav(s.buffers);
    s.buffers = [];
    s.bytes = 0;
    s.pending++;
    s.tail = s.tail.then(async () => {
      if (s.failed) return;
      const m = A.data.meetings.find((m) => m.id === s.meetingId);
      if (!m?.cloudAudioAllowed) throw new Error("Cloud transcription permission was removed.");
      status(s, `Live draft · processing chunk ${s.done + 1} · ${s.config.p} / ${s.config.model}`);
      const text = await A.ai.transcribePart(blob, s.config, s.controller.signal);
      if (s.failed || s.controller.signal.aborted) return;
      // Re-check consent after the response; never apply a late canceled response.
      if (!A.data.meetings.find((m) => m.id === s.meetingId)?.cloudAudioAllowed)
        throw new Error("Cloud transcription permission was removed.");
      s.done++;
      if (text.trim()) {
        s.text.push(text.trim());
        await A.flush();
        if (s.failed || s.controller.signal.aborted) return;
        const meeting = A.data.meetings.find((m) => m.id === s.meetingId);
        if (!meeting) throw new Error("Meeting no longer available.");
        if (!meeting.cloudAudioAllowed) throw new Error("Cloud transcription permission was removed.");
        const old = meeting.transcriptSegments.find((item) => item.recordingId === s.id);
        const segment = { ...old, id: old?.id || s.segmentId, recordingId: s.id,
          createdAt: s.created, text: "[Live draft — review for accuracy]\n" + s.text.join("\n\n") };
        await A.updateMeeting(s.meetingId, { transcriptSegments: old
          ? meeting.transcriptSegments.map((item) => item.id === old.id ? segment : item)
          : [...meeting.transcriptSegments, segment] });
        if (current === s) $("liveDraftText").textContent = segment.text;
      }
      status(s, `Live draft · ${s.done} chunks processed and saved · listening…`);
    }).catch((error) => stop(s, `Live draft stopped: ${error.message}`))
      .finally(() => { s.pending--; });
  }
  function start(session, config) {
    if (current && !current.finished) throw new Error("Wait for the previous Live draft to finish.");
    const s = { ...session, config, segmentId: crypto.randomUUID(), buffers: [], bytes: 0,
      pending: 0, done: 0, text: [], tail: Promise.resolve(), controller: new AbortController(), failed: false };
    current = s;
    $("liveDraftText").textContent = "First text appears after about 30 seconds of audio plus provider processing time.";
    $("stopLiveBtn").hidden = false;
    $("dismissLiveBtn").hidden = true;
    status(s, `Live draft · listening · ${config.p} / ${config.model}`);
    return s;
  }
  function push(s, bytes) {
    if (!s || s.failed || s.closed) return;
    for (let at = 0; at < bytes.length && !s.failed;) {
      const size = Math.min(limit - s.bytes, bytes.length - at);
      s.buffers.push(bytes.slice(at, at + size));
      s.bytes += size;
      at += size;
      if (s.bytes >= limit) enqueue(s);
    }
  }
  async function finish(s) {
    if (!s) return;
    s.closed = true;
    enqueue(s);
    if (!s.failed) status(s, "Audio saved · finishing Live draft…");
    await s.tail;
    s.finished = true;
    if (!s.failed) status(s, s.text.length ? "Live draft saved. Review before using it in Notes or Recap." : "No speech text returned. Audio is saved; you can transcribe it again.");
    if (current === s) {
      $("stopLiveBtn").hidden = true;
      $("dismissLiveBtn").hidden = false;
    }
  }
  $("stopLiveBtn").onclick = () => stop(current, "Live draft stopped by you.");
  $("dismissLiveBtn").onclick = () => { $("liveDraftPanel").hidden = true; };
  // Explicit opt-in for each recording; never silently enable network uploads on another device.
  A.live = { start, push, finish, stop,
    owns: (id) => !!id && current?.id === id && !current.finished,
    get busy() { return !!current && !current.finished; } };
})();
