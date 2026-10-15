/* Tiptap bridge. Only this module reads the live editor document. */
(() => {
  const A = ZM, S = ZMinutesStore, M = ZMinutesModel;
  let editor, meetingId = "", dirty = false, timer, mounting = false, generation = 0;
  const host = document.getElementById("noteEditor");
  const status = document.getElementById("noteMigrationStatus");
  function flushPending() {
    clearTimeout(timer);
    if (!dirty || !editor || !meetingId) return;
    const m = A.data.meetings.find((item) => item.id === meetingId);
    if (!m) return;
    const doc = editor.getJSON();
    m.noteDoc = doc;
    m.noteSchemaVersion = 1;
    m.note = M.noteText(doc);
    dirty = false;
    A.queue("meetings", m);
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
    editor.chain().focus().insertContentAt(pos, { type: "noteCallout", attrs: { kind }, content: [] }).run();
  }
  function insertSource(value, label, source = "transcript", language = "") {
    if (!editor?.isEditable || !value) return false;
    const paragraphs = [label, ...value.split(/\r?\n/)].map((text) => ({
      type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}),
    }));
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, {
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
