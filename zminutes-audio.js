(() => {
  const A = ZM,
    S = ZMinutesStore,
    $ = A.$,
    { Capture, wav, bounded } = ZMinutesCapture;
  let recording = null,
    request = null,
    timer,
    wake;
  const message = (text, error = false) => {
    if (A.feedback) A.feedback.show("audio", text, { target: "recordStatus", error,
      busy: !error && A.recording && !/saved|imported/i.test(text) });
    else { $("recordStatus").textContent = text; $("recordStatus").classList.toggle("error", error); }
  };
  function reset() {
    clearInterval(timer);
    A.recording = false;
    $("liveDraftEnabled").disabled = false;
    $("liveDraftEnabled").checked = false;
    $("recordBtn").disabled = false;
    $("recordBtn").innerHTML = "● <span>Record</span>";
    $("recordDot").classList.remove("live");
    $("recordLabel").textContent = "Not recording";
    $("recordingBanner").hidden = true;
    wake?.release().catch(() => {});
    wake = null;
  }
  async function commitChunks(r) {
    if (!r.buffers.length) return;
    const parts = r.buffers.splice(0),
      bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    const index = r.index++;
    r.writes = r.writes.then(() => S.checkpoint(r.session, index, bytes));
    await r.writes;
  }
  async function finish() {
    if (!recording || recording.stopping) return;
    const r = recording;
    r.stopping = true;
    clearInterval(timer);
    $("recordBtn").disabled = true;
    message("Saving recording…");
    try {
      await r.engine.stop();
      await commitChunks(r);
      await r.writes;
      const chunks = (await S.all("chunks"))
        .filter((c) => c.sessionId === r.session.id)
        .sort((a, b) => a.index - b.index);
      if (!chunks.length) throw new Error("No audio was captured");
      const blob = wav(chunks.map((c) => c.bytes)),
        audioId = await S.addMedia(
          blob,
          "Recording-" + r.session.meetingId + ".wav",
        );
      await A.flush();
      const meeting = A.data.meetings.find((m) => m.id === r.session.meetingId),
        recording = {
          id: r.session.id,
          audioId,
          createdAt: r.session.created,
          label: "Recording " + ((meeting?.recordings.length || 0) + 1),
        };
      await A.updateMeeting(r.session.meetingId, {
        audioId,
        recordings: [...meeting.recordings, recording],
      });
      await S.discardSession(r.session.id);
      message("Audio saved on this device.");
      if (r.live) A.live.finish(r.live);
      if (
        !r.live &&
        A.data.meetings.find((m) => m.id === r.session.meetingId)
          ?.cloudAudioAllowed
      )
        A.run(() => A.ai.transcribe(r.session.meetingId, blob, recording.id));
    } catch (e) {
      if (r.live) { A.live.stop(r.live, "Recording needs recovery."); A.live.finish(r.live); }
      message("Recording remains in recovery: " + e.message, true);
      A.notice(
        "Recording needs recovery. Open Settings → Recover recordings.",
        true,
        { source: "recording-recovery", critical: true, label: "Interrupted audio", action: openRecovery },
      );
    } finally {
      r.engine.abort();
      recording = null;
      reset();
      A.run(renderRecovery);
    }
  }
  async function start() {
    if (recording) return finish();
    if (request) {
      request.canceled = true;
      request.reject(new Error("Recording canceled"));
      return;
    }
    const m = A.current();
    if (!m) return;
    let liveConfig;
    if ($("liveDraftEnabled").checked) {
      try {
        if (A.live.busy) throw new Error("Wait for the previous Live draft to finish.");
        if (!m.cloudAudioAllowed) throw new Error("Enable cloud transcription for this meeting in Recap before using Live draft.");
        liveConfig = A.ai.transcriptionConfig();
      } catch (error) { message(error.message, true); return; }
    }
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      message("Recording requires HTTPS and microphone support.", true);
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      message(
        "Audio recording is unavailable. Import an audio file instead.",
        true,
      );
      return;
    }
    // These calls must happen synchronously inside the user gesture, before any storage/network await.
    $("liveDraftEnabled").disabled = true;
    const context = new Context(),
      resume = context.resume();
    resume.catch(() => {});
    const r = { canceled: false },
      cancel = new Promise((_, reject) => (r.reject = reject));
    request = r;
    A.recording = true;
    $("recordBtn").innerHTML = "× <span>Cancel</span>";
    message("Connecting to microphone…");
    let stream, engine, active;
    try {
      const opening = navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((s) => {
          if (r.canceled) {
            s.getTracks().forEach((t) => t.stop());
            throw new Error("Recording canceled");
          }
          return s;
        });
      stream = await Promise.race([
        bounded(
          opening,
          15000,
          "Microphone request timed out. Check the browser permission and system input.",
        ),
        cancel,
      ]);
      message("Microphone connected. Starting capture…");
      const session = {
          id: crypto.randomUUID(),
          meetingId: m.id,
          title: m.title,
          created: Date.now(),
          rate: 16000,
        };
      active = { session, index: 0, buffers: [], writes: Promise.resolve() };
      r.sessionId = session.id;
      await Promise.race([
        bounded(
          S.checkpoint(session, 0, null),
          3000,
          "Recording storage did not open. Retry or check available space.",
        ),
        cancel,
      ]);
      if (r.canceled) throw new Error("Recording canceled");
      engine = new Capture(stream, context, (bytes) => {
        active.buffers.push(bytes);
        if (liveConfig) {
          // Start only after capture produces audio; failed mic startup sends nothing.
          active.live ||= A.live.start(session, liveConfig);
          A.live.push(active.live, bytes);
        }
      });
      active.engine = engine;
      await Promise.race([
        bounded(
          engine.start(resume),
          8500,
          "Audio startup timed out. Tap Record to retry.",
        ),
        cancel,
      ]);
      if (r.canceled) throw new Error("Recording canceled");
      recording = active;
      request = null;
      $("recordBtn").innerHTML = "■ <span>Stop</span>";
      $("recordLabel").textContent = "Recording";
      $("recordDot").classList.add("live");
      $("recordingBanner").hidden = false;
      $("recordingBannerText").textContent =
        "Recording: " + (m.title || "Untitled meeting");
      message("Recording · " + engine.engine);
      navigator.wakeLock
        ?.request("screen")
        .then((x) => (wake = x))
        .catch(() => {});
      timer = setInterval(() => {
        const seconds = Math.floor(engine.samples / 16000);
        $("recordTimer").textContent =
          String(Math.floor(seconds / 60)).padStart(2, "0") +
          ":" +
          String(seconds % 60).padStart(2, "0");
        commitChunks(active).catch((e) => {
          message("Storage interrupted: " + e.message, true);
          finish();
        });
        if (Date.now() - engine.lastSample > 6000) {
          message("Audio input was interrupted. Saving captured audio.", true);
          finish();
        }
      }, 1000);
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (recording === active) finish();
        }),
      );
    } catch (e) {
      r.canceled = true;
      if (active?.live) { A.live.stop(active.live, "Audio startup failed."); A.live.finish(active.live); }
      engine?.abort();
      stream?.getTracks().forEach((t) => t.stop());
      if (context.state !== "closed") context.close().catch(() => {});
      request = null;
      reset();
      message(
        e.name === "NotAllowedError"
          ? "Microphone access was blocked by the browser or system."
          : e.message,
        true,
      );
      if (r.sessionId) S.discardSession(r.sessionId).catch(console.error);
    }
  }
  async function renderRecovery() {
    const sessions = await S.all("sessions");
    const interrupted = sessions.filter((s) => !s.noteId && s.id !== recording?.session.id);
    $("recordingRecoveryCount").textContent = String(interrupted.length);
    if (!interrupted.length) A.feedback?.resolve("recording-recovery");
    else if (A.feedback) A.notice("Interrupted audio is available on this device.", true, {
      source: "recording-recovery", critical: true, label: `Interrupted audio · ${interrupted.length}`, action: openRecovery,
    });
    $("recoveryList").innerHTML =
      interrupted
        .map(
          (s) =>
            `<div class="file-row"><span>${A.esc(s.title || "Interrupted recording")} · ${new Date(s.created).toLocaleString()}</span><button class="secondary" data-recover="${A.esc(s.id)}">Recover audio</button></div>`,
        )
        .join("") || "<p>No interrupted recordings.</p>";
  }
  async function openRecovery() {
    await A.navigate("settings");
    $("recordingRecoveryDetails").open = true;
    $("recordingRecoveryDetails").scrollIntoView({ block: "center" });
  }
  $("liveCloudHelpBtn").onclick = () => A.run(async () => {
    A.tab = "summary";
    A.renderEditor(false);
    $("meetingCloudAudioEnabled").scrollIntoView({ block: "center" });
    $("meetingCloudAudioEnabled").focus();
  });
  $("recoveryList").onclick = (e) => {
    const id = e.target.closest("[data-recover]")?.dataset.recover;
    if (!id) return;
    A.run(async () => {
      const session = await S.get("sessions", id),
        chunks = (await S.all("chunks"))
          .filter((c) => c.sessionId === id)
          .sort((a, b) => a.index - b.index);
      if (!chunks.length)
        throw new Error("This session ended before audio was captured");
      const blob = wav(chunks.map((c) => c.bytes));
      if (A.data.meetings.some((m) => m.id === session.meetingId)) {
        const audioId = await S.addMedia(blob, "Recovered recording.wav");
        const meeting = A.data.meetings.find((m) => m.id === session.meetingId);
        await A.updateMeeting(session.meetingId, {
          audioId,
          recordings: [
            ...meeting.recordings,
            {
              id: session.id,
              audioId,
              createdAt: session.created,
              label: "Recovered recording " + (meeting.recordings.length + 1),
            },
          ],
        });
        await S.discardSession(id);
      } else A.download(blob, "Recovered-recording.wav");
      await renderRecovery();
      A.notice("Recovered audio is available.");
    });
  };
  $("recordBtn").onclick = start;
  $("globalStopBtn").onclick = () => A.run(finish);
  $("audioFileInput").onchange = (e) => {
    const id = A.meetingId,
      file = e.target.files[0];
    e.target.value = "";
    if (!id || !file) return;
    A.run(async () => {
      if (
        !file.type.startsWith("audio/") &&
        !/\.(m4a|mp3|wav|webm)$/i.test(file.name)
      )
        throw new Error("Choose an audio recording");
      const audioId = await S.addMedia(file, file.name);
      const meeting = A.data.meetings.find((m) => m.id === id),
        recording = {
          id: crypto.randomUUID(),
          audioId,
          createdAt: Date.now(),
          label: file.name,
        };
      await A.updateMeeting(id, {
        audioId,
        recordings: [...meeting.recordings, recording],
      });
      message("Audio imported and saved.");
      if (A.data.meetings.find((m) => m.id === id)?.cloudAudioAllowed)
        await A.ai.transcribe(id, file, recording.id);
    });
  };
  $("recordingList").onclick = (event) =>
    A.run(async () => {
      const button = event.target.closest("button");
      if (!button) return;
      const id =
        button.dataset.selectRecording ||
        button.dataset.transcribeRecording ||
        button.dataset.downloadRecording ||
        button.dataset.deleteRecording;
      const m = A.current(),
        recording = m?.recordings.find((r) => r.id === id);
      if (button.dataset.deleteRecording) {
        if (!recording) throw new Error("Recording not found.");
        if (A.aiBusy || A.live?.owns(id))
          throw new Error(
            "Finish or cancel the current AI request before deleting audio.",
          );
        if (
          !confirm(
            "Delete this audio file from this device? Its transcript, recap, and solutions will stay.",
          )
        )
          return;
        const remaining = m.recordings.filter((r) => r.id !== id),
          order = new Map(
            ZMinutesModel.orderedSegments(m).map((segment, index) => [
              segment.id,
              index,
            ]),
          ),
          audio = $("audioPlayback");
        audio.pause();
        audio.removeAttribute("src");
        audio.dataset.media = "";
        audio.load();
        A.selectedRecordingId = remaining.at(-1)?.id || null;
        await A.updateMeeting(m.id, {
          recordings: remaining,
          audioId: remaining.at(-1)?.audioId || "",
          transcriptSegments: m.transcriptSegments.map((segment) => ({
            ...segment,
            order: order.get(segment.id),
          })),
        });
        await S.removeMediaIfUnreferenced(recording.audioId);
        A.notice("Recording deleted. Transcript and recap were kept.");
        return;
      }
      const item = await S.get("media", recording?.audioId);
      if (!recording || !item)
        throw new Error("This recording is not available on this device.");
      A.selectedRecordingId = id;
      A.renderEditor(false);
      if (button.dataset.selectRecording) {
        const url = await S.mediaURL(recording.audioId);
        if (!url) throw new Error("Recording audio is unavailable.");
        $("audioPlayback").src = url;
        $("audioPlayback").hidden = false;
        await $("audioPlayback")
          .play()
          .catch(() => {});
      } else if (button.dataset.downloadRecording) {
        A.download(item.blob, item.name);
      } else if (button.dataset.transcribeRecording) {
        await A.ai.transcribe(m.id, item.blob, id);
      }
    });
  window.addEventListener("zminutes:ready", () => A.run(renderRecovery));
  A.audio = { finish, renderRecovery };
})();
