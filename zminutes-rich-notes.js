/* Tiptap bridge. Only this module reads the live editor document. */
(() => {
  const A = ZM, S = ZMinutesStore, M = ZMinutesModel;
  let editor, meetingId = "", dirty = false, timer, mounting = false, generation = 0;
  const host = document.getElementById("noteEditor");
  const status = document.getElementById("noteMigrationStatus");
  // Every Action item block carries a stable task ID so it can be mirrored into the project's Tasks.
  function assignTaskIds() {
    if (!editor?.isEditable) return;
    const missing = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "noteCallout" && node.attrs.kind === "task" && !node.attrs.taskId) missing.push([pos, node.attrs]);
    });
    if (!missing.length) return;
    const tr = editor.state.tr.setMeta("addToHistory", false);
    for (const [pos, attrs] of missing) tr.setNodeMarkup(pos, undefined, { ...attrs, taskId: "note-task-" + crypto.randomUUID() });
    editor.view.dispatch(tr);
  }
  function syncTasks(m, doc) {
    const wanted = new Map();
    const visit = (node) => {
      if (node.type === "noteCallout" && node.attrs?.kind === "task" && node.attrs.taskId) {
        const title = (node.content || []).map((n) => n.text || "").join("").trim();
        if (title) wanted.set(node.attrs.taskId, title);
      }
      (node.content || []).forEach(visit);
    };
    visit(doc);
    for (const [id, title] of wanted) {
      const task = A.data.tasks.find((t) => t.id === id);
      if (!task) {
        const created = M.normalize("tasks", { id, projectId: m.projectId, meetingId: m.id, title, status: "in-progress" });
        A.data.tasks.push(created);
        A.queue("tasks", created);
      } else if (task.title !== title) {
        task.title = title;
        A.queue("tasks", task);
      }
    }
    // A removed Action item removes its open task; finished tasks stay as history.
    for (const task of A.data.tasks.filter((t) => t.meetingId === m.id && t.id.startsWith("note-task-") && !wanted.has(t.id) && t.status !== "done")) {
      A.data.tasks.splice(A.data.tasks.indexOf(task), 1);
      A.pending.delete(M.key("tasks", task.id));
      S.remove("tasks", task.id).catch(() => {});
    }
  }
  function flushPending() {
    clearTimeout(timer);
    if (!dirty || !editor || !meetingId) return;
    const m = A.data.meetings.find((item) => item.id === meetingId);
    if (!m) return;
    assignTaskIds();
    const doc = editor.getJSON();
    m.noteDoc = doc;
    m.noteSchemaVersion = 1;
    m.note = M.noteText(doc);
    dirty = false;
    A.queue("meetings", m);
    syncTasks(m, doc);
  }
  function changed() {
    if (mounting) return;
    dirty = true;
    document.getElementById("saveState").textContent = "Unsaved changes";
    clearTimeout(timer);
    timer = setTimeout(flushPending, 350);
  }
  async function mount(m) {
    if (meetingId === m.id && editor) return;
    clearTimeout(timer);
    editor?.destroy();
    meetingId = m.id;
    const token = ++generation;
    mounting = true;
    editor = ZMinutesTiptap.create(host, changed);
    const instance = editor;
    status.textContent = "";
    try {
      if (m.noteDoc) {
        instance.commands.setContent(m.noteDoc, { emitUpdate: false, errorOnInvalidContent: true });
      } else {
        const converted = ZMinutesTiptap.legacyDocument(m.note);
        instance.commands.setContent(converted.doc, { emitUpdate: false, errorOnInvalidContent: true });
        status.textContent = converted.warning || (m.note ? "Original Markdown saved for recovery." : "");
        const saved = await S.migrateNote(m.id, converted.doc);
        const index = A.data.meetings.findIndex((item) => item.id === m.id);
        if (index >= 0) A.data.meetings[index] = saved.value;
        A.heads[M.key("meetings", m.id)] = saved.heads;
      }
      if (token === generation && A.meetingId === m.id) instance.setEditable(true);
    } catch (e) {
      status.textContent = "Notes migration paused: " + e.message + ". Original Notes are unchanged.";
      A.notice(status.textContent, true);
    } finally { if (token === generation) mounting = false; }
  }
  function command(name) {
    if (!editor?.isEditable) return;
    const chain = editor.chain().focus();
    const commands = {
      bold: () => chain.toggleBold().run(),
      italic: () => chain.toggleItalic().run(),
      underline: () => chain.toggleUnderline().run(),
      strike: () => chain.toggleStrike().run(),
      list: () => chain.toggleBulletList().run(),
      numbered: () => chain.toggleOrderedList().run(),
      undo: () => chain.undo().run(),
      redo: () => chain.redo().run(),
    };
    commands[name]?.();
  }
  function insertCallout(kind) {
    if (!editor?.isEditable) return;
    const pos = editor.state.selection.to;
    editor.chain().focus().insertContentAt(pos, { type: "noteCallout", attrs: { kind, ...(kind === "task" ? { taskId: "note-task-" + crypto.randomUUID() } : {}) }, content: [] }).run();
  }
  function insertSource(value, label, source = "transcript", language = "") {
    if (!editor?.isEditable || !value) return false;
    const paragraphs = [label, ...value.split(/\r?\n/)].map((text) => ({
      type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}),
    }));
    // This action originates outside Notes. Tiptap's deferred focus can steal
    // the next keystrokes from the translation language input (and open the
    // mobile keyboard). Insert without changing the user's focused control.
    editor.chain().insertContentAt(editor.state.doc.content.size, {
      type: "sourceBlock", attrs: { source, language }, content: paragraphs,
    }).run();
    return true;
  }
  async function insertImage(file) {
    if (!editor?.isEditable) throw new Error("Open Notes before adding an image.");
    const m = A.current();
    if (!m) return;
    flushPending();
    await A.flush();
    const photo = await A.photo(file);
    await A.updateMeeting(m.id, { photos: [...A.current().photos, photo] });
    editor.chain().focus().insertContent({ type: "meetingImage", attrs: { photoId: photo.id } }).run();
    flushPending();
    await A.flush();
    A.renderEditor(false);
  }
  document.getElementById("noteImageInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) A.run(() => insertImage(file));
  });
  document.querySelector(".note-photo-button").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      document.getElementById("noteImageInput").click();
    }
  });
  document.getElementById("noteStyleBtn").addEventListener("click", () => {
    const menu = document.getElementById("noteStyleMenu");
    menu.hidden = !menu.hidden;
    document.getElementById("noteStyleBtn").setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.getElementById("downloadNoteMigrationBtn").addEventListener("click", () => A.run(async () => {
    await A.flush();
    const backups = await S.noteMigrationBackups();
    if (!backups.length) throw new Error("No original Markdown Notes have been migrated on this device.");
    A.download(new Blob([JSON.stringify({ app: "zMinutes", format: "original-notes-v1", backups }, null, 2)], { type: "application/json" }),
      "zMinutes-original-notes-" + A.today() + ".json");
  }));
  A.richNotes = { mount, flushPending, command, insertCallout, insertSource, insertImage,
    isDirty: () => dirty,
    reset: () => { ++generation; clearTimeout(timer); editor?.destroy(); editor = null; meetingId = ""; dirty = false; mounting = false; },
    referenced: (photoId) => M.notePhotoIds(A.current()?.noteDoc).has(photoId),
    goToNotes: () => { A.tab = "note"; A.renderEditor(false); editor?.commands.focus(); },
  };
})();
