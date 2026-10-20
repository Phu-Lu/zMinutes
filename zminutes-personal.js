/* Standalone Notes: no meeting surrogate, independent editor and transcription owner. */
(() => {
  const A = ZM,
    S = ZMinutesStore,
    P = ZMinutesPersonalStore,
    M = ZMinutesModel,
    $ = A.$,
    e = A.esc;
  const view = document.createElement("section");
  view.id = "personalView";
  view.className = "hidden";
  view.innerHTML = `<div class="panel-intro"><h1>Notes</h1><p>Your personal notebook. Independent of meetings and projects.</p></div>
  <div class="personal-workspace"><aside class="personal-list"><button id="pnNew" class="primary">+ New note</button><input id="pnSearch" aria-label="Search notes" placeholder="Search notes…"><select id="pnFilter" aria-label="Filter notes"><option>All</option><option>Pinned</option><option>Archived</option><option>Trash</option></select><input id="pnLabelFilter" aria-label="Filter by label" placeholder="Filter by label"><div id="pnList"></div></aside>
  <section id="pnDetail" class="personal-detail"><p>Select a note or create one.</p></section></div>`;
  document.querySelector("main.shell").append(view);
  let rows = [],
    current = null,
    editor = null,
    dirty = false,
    timer,
    saveTail = Promise.resolve(),
    filter = "All",
    query = "",
    labelFilter = "",
    job = null,
    capture = null,
    checkpointTail = Promise.resolve(),
    recordTimer,
    anchor = null,
    loadVersion = 0;
  const status = (text, error = false, busy = false) =>
    A.feedback.show("personal", text, { target: "pnStatus", error, busy });
  const run = (fn) =>
    A.run(async () => {
      try {
        await fn();
      } catch (err) {
        if ($("pnStatus")) status(err.message, true);
        throw err;
      }
    });
  function changed() {
    dirty = true;
    $("pnSave").textContent = "Unsaved changes";
    clearTimeout(timer);
    timer = setTimeout(() => run(flush), 350);
  }
  async function flush() {
    clearTimeout(timer);
    await saveTail.catch(() => {});
    if (!dirty || !current || !editor) return saveTail;
    const recordings =
      review?.noteId === current.id
        ? current.value.recordings.map((r) =>
            r.id === review.recordingId
              ? { ...r, transcript: review.text, inserted: review.inserted }
              : r,
          )
        : current.value.recordings;
    const value = M.normalize("notes", {
      ...current.value,
      recordings,
      title: $("pnTitle").value,
      labels: $("pnLabels").value.split(","),
      noteDoc: editor.getJSON(),
      updated: Date.now(),
    });
    const id = current.id,
      parents = [...current.heads];
    dirty = false;
    current.value = value;
    const task = saveTail
      .catch(() => {})
      .then(async () => {
        try {
          const saved = await P.save(value, parents);
          if (current?.id === id) {
            current.heads = saved.heads;
            if (!dirty) $("pnSave").textContent = "Saved on this device";
          }
          rows = await P.all();
          renderList();
          A.feedback.resolve("personal-save");
        } catch (err) {
          if (current?.id === id) dirty = true;
          A.notice("Notes could not be saved: " + err.message, true, {
            source: "personal-save",
            critical: true,
            label: "Unsaved note",
            action: () => A.navigate("personal"),
          });
          throw err;
        }
      });
    saveTail = task;
    return task;
  }
  async function patch(values) {
    await flush();
    const id = current.id;
    current = await P.save(
      { ...current.value, ...values, updated: Date.now() },
      current.heads,
    );
    rows = await P.all();
    renderList();
    return id;
  }
  function renderList() {
    const notes = rows
      .filter((r) => r.value)
      .map((r) => r.value)
      .filter((n) =>
        filter === "Trash"
          ? n.trashed
          : !n.trashed &&
            (filter === "Archived"
              ? n.archived
              : !n.archived && (filter !== "Pinned" || n.pinned)),
      )
      .filter(
        (n) =>
          (n.title + " " + n.note + " " + n.labels.join(" "))
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()) &&
          (!labelFilter ||
            n.labels.some(
              (l) => l.toLocaleLowerCase() === labelFilter.toLocaleLowerCase(),
            )),
      )
      .sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated,
      );
    $("pnList").innerHTML =
      notes
        .map(
          (n) =>
            `<button class="personal-item ${current?.id === n.id ? "selected" : ""}" data-note="${e(n.id)}"><strong>${n.pinned ? "★ " : ""}${e(n.title || "Untitled note")}</strong><span>${e(n.note.slice(0, 100) || "Empty note")}</span><small>${e(n.labels.join(" · "))}</small></button>`,
        )
        .join("") || "<p>No notes here.</p>";
  }
  async function render() {
    rows = await P.all();
    renderList();
    if (current && !dirty && !job && !capture) {
      const row = rows.find((r) => r.id === current.id);
      if (!row?.value) {
        current = null;
        editor?.destroy();
        editor = null;
        $("pnDetail").innerHTML = "<p>Select a note.</p>";
      } else if (JSON.stringify(row.heads) !== JSON.stringify(current.heads))
        await open(row.id);
    }
    await conflicts();
  }
  async function open(id) {
    if (A.recording || job)
      throw new Error(
        "Stop recording or cancel transcription before changing notes.",
      );
    await flush();
    const token = ++loadVersion;
    const row = await S.get("personalNotes", id);
    if (token !== loadVersion || !row?.value) return;
    editor?.destroy();
    current = row;
    dirty = false;
    anchor = null;
    review = null;
    view.classList.add("personal-open");
    $("pnDetail").innerHTML =
      `<button id="pnBack" class="link-btn">← All notes</button><input id="pnTitle" aria-label="Note title" placeholder="Untitled note"><div class="personal-actions"><button id="pnPin"></button><button id="pnArchive"></button><button id="pnTrash"></button>${row.value.trashed ? '<button id="pnDelete">Delete forever</button>' : ""}</div><label>Labels<input id="pnLabels" placeholder="Personal, Ideas, …"></label><p id="pnSave" role="status">Saved on this device</p>
      <div class="personal-tools" role="toolbar" aria-label="Note formatting">${[
        ["bold", "Bold"],
        ["italic", "Italic"],
        ["underline", "Underline"],
        ["strike", "Strike"],
        ["bulletList", "Bullets"],
        ["orderedList", "Numbered"],
        ["taskList", "Checklist"],
        ["undo", "Undo"],
        ["redo", "Redo"],
      ]
        .map(
          ([cmd, label]) =>
            `<button data-pn-command="${cmd}" type="button">${label}</button>`,
        )
        .join(
          "",
        )}<label class="secondary">Picture<input id="pnImage" type="file" accept="image/*" hidden></label></div><div id="pnEditor"></div><p id="pnStatus" role="status" hidden></p>
      <div class="personal-actions"><button id="pnCopy">Copy text</button><button id="pnPdf">PDF</button><button id="pnWord">Word</button></div>
      <details><summary>Pictures</summary><div id="pnPhotos"></div></details>
      <section class="personal-audio"><h2>Audio notes</h2><div class="personal-actions"><button id="pnRecord" class="primary">Record</button><span id="pnTimer">00:00</span></div><label><input id="pnConsent" type="checkbox"> Allow cloud transcription for this note</label><p>Audio stays on this device. Transcribe sends audio to your selected provider.</p><div id="pnRecordings"></div><details><summary>Interrupted recordings</summary><div id="pnRecovery"></div></details></section>
      <section id="pnReview" hidden><h2>Review transcript</h2><progress id="pnProgress" value="0" max="1"></progress><button id="pnCancel">Cancel transcription</button><textarea id="pnTranscript" aria-label="Review transcript"></textarea><div class="personal-actions"><button id="pnInsert">Insert into note</button><button id="pnAppend">Append to note</button></div><p id="pnInsertHint"></p></section>`;
    const n = row.value;
    $("pnTitle").value = n.title;
    $("pnLabels").value = n.labels.join(", ");
    $("pnConsent").checked = n.cloudAudioAllowed;
    $("pnPin").textContent = n.pinned ? "Unpin" : "Pin";
    $("pnArchive").textContent = n.archived ? "Unarchive" : "Archive";
    $("pnTrash").textContent = n.trashed ? "Restore" : "Move to Trash";
    editor = ZMinutesTiptap.create($("pnEditor"), changed, {
      personal: true,
      resolvePhoto: (id) => current?.value.photos.find((p) => p.id === id),
    });
    editor.commands.setContent(n.noteDoc || ZMinutesTiptap.empty(), {
      emitUpdate: false,
      errorOnInvalidContent: true,
    });
    editor.setEditable(!n.trashed, false);
    editor.on("selectionUpdate", () => {
      if (editor.isFocused)
        anchor = {
          id: current.id,
          pos: editor.state.selection.from,
          revision: editor.state.doc,
        };
    });
    $("pnTitle").oninput = $("pnLabels").oninput = changed;
    $("pnBack").onclick = () =>
      run(async () => {
        await flush();
        view.classList.remove("personal-open");
      });
    $("pnPin").onclick = () =>
      run(async () => {
        await patch({ pinned: !current.value.pinned });
        await open(id);
      });
    $("pnArchive").onclick = () =>
      run(async () => {
        await patch({ archived: !current.value.archived });
        await open(id);
      });
    $("pnTrash").onclick = () =>
      run(async () => {
        if (capture || job) throw new Error("Finish audio work first.");
        await patch({ trashed: !current.value.trashed });
        await open(id);
      });
    if ($("pnDelete"))
      $("pnDelete").onclick = () =>
        run(async () => {
          if (
            confirm(
              "Permanently delete this note? Synced devices will also remove it.",
            )
          ) {
            await flush();
            await P.remove(id);
            await render();
          }
        });
    $("pnConsent").onchange = () =>
      run(async () => {
        if (!$("pnConsent").checked) job?.controller.abort();
        await patch({ cloudAudioAllowed: $("pnConsent").checked });
      });
    $("pnImage").onchange = (event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (file) run(() => addImage(file));
    };
    $("pnRecord").onclick = () => run(record);
    $("pnCopy").onclick = () =>
      run(async () => {
        await flush();
        await navigator.clipboard.writeText(current.value.note);
        status("Copied.");
      });
    $("pnPdf").onclick = () => run(() => exportNote("pdf"));
    $("pnWord").onclick = () => run(() => exportNote("word"));
    $("pnCancel").onclick = () => job?.controller.abort();
    $("pnInsert").onclick = () => run(() => insertTranscript(false));
    $("pnAppend").onclick = () => run(() => insertTranscript(true));
    $("pnTranscript").oninput = () => {
      if (review) {
        review.text = $("pnTranscript").value;
        changed();
      }
    };
    await renderMedia();
    renderList();
  }
  view.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-pn-command]")) event.preventDefault();
  });
  view.addEventListener("click", (event) => {
    const b = event.target.closest("[data-pn-command]");
    if (!b || !editor?.isEditable) return;
    const cmd = b.dataset.pnCommand;
    const map = {
      bold: "toggleBold",
      italic: "toggleItalic",
      underline: "toggleUnderline",
      strike: "toggleStrike",
      bulletList: "toggleBulletList",
      orderedList: "toggleOrderedList",
      taskList: "toggleTaskList",
      undo: "undo",
      redo: "redo",
    };
    editor.chain().focus()[map[cmd]]().run();
  });
  async function addImage(file) {
    if (current.value.trashed) throw new Error("Restore this note first.");
    await flush();
    const id = current.id,
      photo = {
        id: crypto.randomUUID(),
        mediaId: await S.addMedia(file, file.name),
      };
    if (current.id !== id)
      throw new Error("Note changed; select the image again.");
    await patch({ photos: [...current.value.photos, photo] });
    editor
      .chain()
      .insertContent({ type: "meetingImage", attrs: { photoId: photo.id } })
      .run();
    await flush();
    await renderMedia();
  }
  async function renderMedia() {
    const id = current.id,
      n = current.value;
    $("pnPhotos").innerHTML = n.photos
      .map(
        (p) =>
          `<button data-pn-remove-photo="${e(p.id)}">Delete picture ${e(p.id.slice(0, 6))}</button>`,
      )
      .join("");
    $("pnPhotos").onclick = (event) =>
      run(async () => {
        const pid = event.target.dataset.pnRemovePhoto;
        if (!pid) return;
        if (M.notePhotoIds(current.value.noteDoc).has(pid)) {
          status(
            "Picture is used in this note. Remove it from the editor first.",
            true,
          );
          $("pnEditor").scrollIntoView({ block: "center" });
          return;
        }
        const photo = current.value.photos.find((p) => p.id === pid);
        await patch({
          photos: current.value.photos.filter((p) => p.id !== pid),
        });
        await S.removeMediaIfUnreferenced(photo.mediaId);
        await renderMedia();
      });
    const entries = await Promise.all(
      n.recordings.map(async (r) => ({ r, url: await S.mediaURL(r.audioId) })),
    );
    if (current?.id !== id) return;
    $("pnRecordings").innerHTML = entries
      .map(
        ({ r, url }) =>
          `<article class="personal-recording"><strong>${e(r.label || "Recording")}</strong>${url ? `<audio controls src="${e(url)}"></audio>` : "<p>Audio available on the recording device</p>"}<div class="personal-actions"><button data-pn-transcribe="${e(r.id)}" ${url ? "" : "disabled"}>Transcribe</button>${r.transcript ? `<button data-pn-review="${e(r.id)}">Review transcript</button>` : ""}${url ? `<a download="recording.wav" href="${e(url)}">Download</a>` : ""}<button data-pn-delete-audio="${e(r.id)}" ${url ? "" : "disabled"}>Delete audio</button></div></article>`,
      )
      .join("");
    $("pnRecordings").onclick = (event) =>
      run(async () => {
        const b = event.target.closest("button");
        if (!b) return;
        const rid =
          b.dataset.pnTranscribe ||
          b.dataset.pnReview ||
          b.dataset.pnDeleteAudio;
        const r = current.value.recordings.find((x) => x.id === rid);
        if (b.dataset.pnTranscribe) return transcribe(r);
        if (b.dataset.pnReview) return showReview(r);
        if (capture || job) throw new Error("Finish audio work first.");
        if (
          confirm(
            "Delete audio from this device? Transcript and note text will be kept.",
          )
        ) {
          await patch({
            recordings: current.value.recordings.map((x) =>
              x.id === rid ? { ...x, audioId: "" } : x,
            ),
          });
          await S.removeMediaIfUnreferenced(r.audioId);
          await renderMedia();
        }
      });
    const sessions = (await S.all("sessions")).filter(
      (s) => s.noteId === id && s.id !== capture?.session.id,
    );
    const interrupted = (await S.all("sessions")).filter(
      (s) => s.noteId && s.id !== capture?.session.id,
    );
    if (!interrupted.length) A.feedback.resolve("personal-audio");
    $("pnRecovery").innerHTML =
      sessions
        .map(
          (s) =>
            `<button data-pn-recover="${e(s.id)}">Recover ${e(s.title || "recording")}</button>`,
        )
        .join("") || "No interrupted recordings.";
    $("pnRecovery").onclick = (event) =>
      run(async () => {
        const sid = event.target.dataset.pnRecover;
        if (!sid) return;
        const s = sessions.find((s) => s.id === sid);
        const chunks = (await S.all("chunks"))
          .filter((c) => c.sessionId === sid)
          .sort((a, b) => a.index - b.index);
        if (!chunks.length) throw new Error("No audio samples were saved.");
        await saveAudio(s, ZMinutesCapture.wav(chunks.map((c) => c.bytes)));
        await renderMedia();
      });
  }
  async function saveAudio(session, blob) {
    const row = await S.get("personalNotes", session.noteId);
    if (!row?.value || row.value.trashed)
      throw new Error("Restore the note before recovering audio.");
    if (!row.value.recordings.some((r) => r.id === session.id)) {
      const audioId = await S.addMedia(blob, "Note recording.wav");
      const saved = await P.save(
        {
          ...row.value,
          updated: Date.now(),
          recordings: [
            ...row.value.recordings,
            {
              id: session.id,
              audioId,
              createdAt: session.created,
              label: "Recording " + (row.value.recordings.length + 1),
            },
          ],
        },
        row.heads,
      );
      if (current?.id === row.id) current = saved;
    }
    await S.discardSession(session.id);
  }
  async function record() {
    if (capture) {
      const c = capture;
      try {
        await c.engine.stop();
        await checkpointTail;
        const chunks = (await S.all("chunks"))
          .filter((x) => x.sessionId === c.session.id)
          .sort((a, b) => a.index - b.index);
        await flush();
        await saveAudio(
          c.session,
          ZMinutesCapture.wav(chunks.map((x) => x.bytes)),
        );
        status("Recording saved.");
        A.feedback.resolve("personal-audio");
      } catch (err) {
        A.notice("Recording needs recovery: " + err.message, true, {
          source: "personal-audio",
          critical: true,
          label: "Interrupted note audio",
          action: () => A.navigate("personal"),
        });
        throw err;
      } finally {
        capture = null;
        A.recording = false;
        clearInterval(recordTimer);
        $("pnRecord").textContent = "Record";
        await renderMedia();
      }
      return;
    }
    if (A.recording || A.aiBusy || job || current.value.trashed)
      throw new Error("Finish the current task or restore this note first.");
    const context = new AudioContext(),
      resumed = context.resume();
    let stream, engine;
    const session = {
      id: crypto.randomUUID(),
      noteId: current.id,
      title: current.value.title,
      created: Date.now(),
      rate: 16000,
    };
    A.recording = true;
    $("pnRecord").disabled = true;
    status("Connecting to microphone…", false, true);
    try {
      const request = navigator.mediaDevices.getUserMedia({ audio: true });
      let expired = false;
      request.then(
        (s) => {
          if (expired) s.getTracks().forEach((t) => t.stop());
        },
        () => {},
      );
      try {
        stream = await ZMinutesCapture.bounded(
          request,
          15000,
          "Microphone did not respond. Check permissions and input device.",
        );
      } catch (err) {
        expired = true;
        throw err;
      }
      let index = 0;
      await S.checkpoint(session, 0, null);
      checkpointTail = Promise.resolve();
      engine = new ZMinutesCapture.Capture(stream, context, (bytes) => {
        const i = index++;
        checkpointTail = checkpointTail.then(() =>
          S.checkpoint(session, i, bytes),
        );
        checkpointTail.catch((err) => {
          engine.abort();
          status("Audio storage failed: " + err.message, true);
        });
      });
      await engine.start(resumed);
      capture = { engine, session };
      $("pnRecord").textContent = "Stop";
      status("Recording…", false, true);
      stream.getAudioTracks().forEach(
        (track) =>
          (track.onended = () => {
            if (capture?.session.id === session.id) run(record);
          }),
      );
      recordTimer = setInterval(() => {
        $("pnTimer").textContent = new Date(Date.now() - session.created)
          .toISOString()
          .slice(14, 19);
      }, 1000);
    } catch (err) {
      engine?.abort();
      stream?.getTracks().forEach((t) => t.stop());
      context.close().catch(() => {});
      A.recording = false;
      status(err.message, true);
      throw err;
    } finally {
      $("pnRecord").disabled = false;
    }
  }
  let review = null;
  function showReview(r) {
    review = {
      noteId: current.id,
      recordingId: r.id,
      text: r.transcript || "",
      inserted: r.inserted,
    };
    $("pnReview").hidden = false;
    $("pnTranscript").value = review.text;
    $("pnCancel").hidden = !job;
    $("pnInsert").disabled = $("pnAppend").disabled = !!r.inserted || !!job;
    $("pnInsertHint").textContent = r.inserted
      ? "Already inserted. Use Undo in the editor if needed."
      : "Review, then insert at your marked position or append.";
  }
  async function saveReview() {
    if (!review || current?.id !== review.noteId) return;
    clearTimeout(review.timer);
    await patch({
      recordings: current.value.recordings.map((r) =>
        r.id === review.recordingId ? { ...r, transcript: review.text } : r,
      ),
    });
  }
  async function transcribe(r) {
    if (job || A.aiBusy || A.recording)
      throw new Error("Finish the current recording or AI request first.");
    if (!current.value.cloudAudioAllowed)
      throw new Error("Allow cloud transcription for this note first.");
    const config = A.ai.transcriptionConfig(),
      item = await S.get("media", r.audioId);
    if (!item)
      throw new Error("Audio is only available on the recording device.");
    await flush();
    job = { noteId: current.id, controller: new AbortController() };
    A.aiBusy = true;
    showReview(r);
    status("Decoding audio…", false, true);
    const completed = [];
    try {
      const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(
          await item.blob.arrayBuffer(),
        ),
        total = Math.round((audio.length * 16000) / audio.sampleRate),
        hop = 90 * 16000;
      $("pnProgress").max = Math.max(1, Math.ceil(total / hop));
      $("pnProgress").value = 0;
      for (let start = 0; start < total; start += hop) {
        if (job.controller.signal.aborted)
          throw new DOMException("Canceled", "AbortError");
        status(
          `Transcribing ${completed.length + 1} / ${Math.ceil(total / hop)}…`,
          false,
          true,
        );
        const result = await A.ai.transcribePart(
          A.ai.pcmSegment(audio, start, Math.min(hop, total - start)),
          config,
          job.controller.signal,
        );
        if (job.controller.signal.aborted)
          throw new DOMException("Canceled", "AbortError");
        completed.push(result);
        review.text = completed.join("\n\n");
        $("pnTranscript").value = review.text;
        $("pnProgress").value = completed.length;
        await saveReview();
      }
      status("Transcript ready. Review before inserting.");
    } catch (err) {
      status(
        err.name === "AbortError"
          ? "Transcription canceled. Saved text and audio kept."
          : "Transcription failed: " + err.message,
        true,
      );
    } finally {
      job = null;
      A.aiBusy = false;
      $("pnCancel").hidden = true;
      $("pnInsert").disabled = $("pnAppend").disabled = !!review.inserted;
      await renderMedia();
    }
  }
  async function insertTranscript(append) {
    if (!review || review.noteId !== current?.id || review.inserted || job)
      return;
    const text = $("pnTranscript").value.trim();
    if (!text) throw new Error("Transcript is empty.");
    if (
      !append &&
      (!anchor ||
        anchor.id !== current.id ||
        anchor.revision !== editor.state.doc)
    )
      throw new Error("Choose a position in the note, or use Append to note.");
    const pos = append ? editor.state.doc.content.size : anchor.pos;
    editor.commands.insertContentAt(
      pos,
      ZMinutesTiptap.plainDocument(text).content,
    );
    review.inserted = true;
    $("pnInsert").disabled = $("pnAppend").disabled = true;
    await patch({
      recordings: current.value.recordings.map((r) =>
        r.id === review.recordingId
          ? { ...r, transcript: text, inserted: true }
          : r,
      ),
    });
    status("Transcript inserted and saved.");
  }
  async function conflicts() {
    let box = $("pnConflicts");
    if (!box) {
      box = document.createElement("details");
      box.id = "pnConflicts";
      view.prepend(box);
    }
    const list = await P.conflicts(),
      wasOpen = box.open;
    box.hidden = !list.length;
    box.innerHTML =
      `<summary>Notes sync conflicts · ${list.length}</summary>` +
      list
        .map(
          (c) =>
            `<section><h3>${e(c.versions.find((v) => v.value)?.value.title || "Untitled note")}</h3>${c.versions.map((v, i) => `<details><summary>Version ${i + 1}${v.value ? "" : " · Deleted"}</summary><pre>${e(v.value?.note || "Deleted note")}</pre><button data-pn-conflict="${e(c.id)}" data-version="${e(v.id)}">Keep this version</button></details>`).join("")}</section>`,
        )
        .join("");
    box.open = wasOpen;
    box.onclick = (event) =>
      run(async () => {
        const b = event.target.closest("[data-pn-conflict]");
        if (!b) return;
        await flush();
        const c = list.find((c) => c.id === b.dataset.pnConflict),
          v = c.versions.find((v) => v.id === b.dataset.version);
        if (v.value)
          await P.save(
            v.value,
            c.versions.map((v) => v.id),
          );
        else await P.remove(c.id);
        await render();
      });
  }
  async function sync(drive) {
    await flush();
    document.querySelector(".app").inert = true;
    try {
      const seen = new Set((await S.get("meta", "personal-seen-v1")) || []),
        files = await drive.list(
          "trashed=false and appProperties has { key='zminutes' and value='notes-v1' }",
        );
      const bundles = [],
        received = [];
      for (const f of files)
        if (!seen.has(f.id)) {
          bundles.push(
            await drive.api("drive/v3/files/" + f.id + "?alt=media"),
          );
          received.push(f.id);
        }
      if (bundles.length) {
        await P.merge(bundles);
        received.forEach((id) => seen.add(id));
        await S.meta("personal-seen-v1", [...seen]);
      }
      const pending = await P.pending();
      for (let i = 0; i < pending.length; i += 20) {
        const batch = pending.slice(i, i + 20),
          payload = await P.bundle(batch),
          file = await drive.upload(payload, "notes-v1");
        await drive.verifyUpload(file, payload);
        await P.acknowledge(batch.map((o) => o.id));
        seen.add(file.id);
        await S.meta("personal-seen-v1", [...seen]);
      }
      if (A.section === "personal") await render();
      return {
        hasNotes: (await P.all()).some((r) => r.value),
        conflicts: (await P.conflicts()).length,
      };
    } finally {
      document.querySelector(".app").inert = false;
    }
  }
  async function exportNote(type) {
    await flush();
    if (!current) return;
    const n = current.value;
    if (type === "word") return A.personalWord(n);
    const container = document.createElement("div");
    container.innerHTML = editor.getHTML();
    for (const img of container.querySelectorAll("img[data-photo-id]")) {
      const p = n.photos.find((p) => p.id === img.dataset.photoId),
        m = p && (await S.get("media", p.mediaId));
      if (m) img.src = await S.toDataURL(m.blob);
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${e(n.title || "Untitled note")}</title><style>body{font:12pt Arial;line-height:1.6;padding:24px}img{max-width:100%;height:auto}ul[data-type=taskList]{list-style:none}input{vertical-align:middle}</style></head><body><h1>${e(n.title || "Untitled note")}</h1>${container.innerHTML}</body></html>`;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px";
    document.body.append(frame);
    frame.srcdoc = html;
    await new Promise((resolve) => (frame.onload = resolve));
    await Promise.all(
      [...frame.contentDocument.images].map((img) =>
        img.decode().catch(() => {}),
      ),
    );
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  }
  $("personalNotesNav").onclick = () => run(() => A.navigate("personal"));
  $("pnNew").onclick = () =>
    run(async () => {
      if (A.recording || job) throw new Error("Finish audio work first.");
      await flush();
      const row = await P.save({
        id: crypto.randomUUID(),
        title: "",
        noteDoc: ZMinutesTiptap.empty(),
        updated: Date.now(),
      });
      rows = await P.all();
      await open(row.id);
      $("pnTitle").focus();
    });
  $("pnList").onclick = (event) => {
    const b = event.target.closest("[data-note]");
    if (b) run(() => open(b.dataset.note));
  };
  $("pnSearch").oninput = () => {
    query = $("pnSearch").value;
    renderList();
  };
  $("pnFilter").onchange = () => {
    filter = $("pnFilter").value;
    renderList();
  };
  $("pnLabelFilter").oninput = () => {
    labelFilter = $("pnLabelFilter").value;
    renderList();
  };
  A.personal = {
    flush,
    render,
    sync,
    isDirty: () => dirty,
    busy: () => !!capture || !!job || (A.recording && A.section === "personal"),
  };
  window.addEventListener("zminutes:ready", () =>
    run(async () => {
      const interrupted = (await S.all("sessions")).filter((s) => s.noteId);
      if (interrupted.length)
        A.notice("Interrupted note audio is available on this device.", true, {
          source: "personal-audio",
          critical: true,
          label: "Interrupted note audio · " + interrupted.length,
          action: async () => {
            await A.navigate("personal");
            await open(interrupted[0].noteId);
          },
        });
    }),
  );
  window.addEventListener("beforeunload", (event) => {
    if (dirty || capture || job) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
})();
