/* Single application controller. Views never own a second copy of meeting data. */
(() => {
  const S = ZMinutesStore,
    M = ZMinutesModel,
    $ = (id) => document.getElementById(id);
  const A = (window.ZM = {
    data: Object.fromEntries(M.kinds.map((k) => [k, []])),
    heads: {},
    project: "inbox",
    section: "overview",
    meetingId: null,
    tab: "note",
    ready: false,
    day: localDate(),
    month: null,
    pending: new Map(),
    saving: 0,
    drafts: {},
    saveTail: Promise.resolve(),
  });
  function localDate() {
    const d = new Date();
    return new Date(d - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }
  A.$ = $;
  A.today = localDate;
  A.esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  A.current = () => A.data.meetings.find((m) => m.id === A.meetingId);
  A.safeRead = (key, f = {}) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") || f;
    } catch {
      return f;
    }
  };
  A.notice = (message, error = false) => {
    const box = $("appNotice");
    box.textContent = message;
    box.classList.toggle("error", error);
    box.hidden = !message;
  };
  A.run = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => {
        console.error(e);
        A.notice(e.message || "The action could not finish.", true);
      });
  A.download = (blob, name) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  A.save = (kind, value) => {
    value = M.normalize(kind, { ...value, updated: Date.now() });
    const k = M.key(kind, value.id),
      copy = structuredClone(value),
      index = A.data[kind].findIndex((r) => r.id === value.id);
    if (index < 0) A.data[kind].push(value);
    else A.data[kind][index] = value;
    $("saveState").textContent = "Saving…";
    A.saving++;
    const task = async () => {
      try {
        await S.put(kind, copy, A.heads[k] || []);
        A.heads[k] = (await S.get("entities", k)).heads;
        $("saveState").textContent = A.pending.size
          ? "Unsaved changes"
          : A.saving > 1
            ? "Saving…"
            : "Saved";
        if (!A.pending.size) $("retrySaveBtn").hidden = true;
        return copy;
      } catch (e) {
        $("saveState").textContent = "Save failed";
        $("retrySaveBtn").hidden = false;
        if (!A.pending.has(k)) A.pending.set(k, { kind, value: copy });
        throw e;
      } finally {
        A.saving--;
      }
    };
    const result = A.saveTail.then(task, task);
    A.saveTail = result.catch((e) => {
      A.notice(
        "Save failed. Your unsaved changes remain open: " + e.message,
        true,
      );
    });
    return result;
  };
  A.queue = (kind, value) => {
    A.pending.set(M.key(kind, value.id), {
      kind,
      value: structuredClone(value),
    });
    $("saveState").textContent = "Unsaved changes";
    clearTimeout(A.saveTimer);
    A.saveTimer = setTimeout(() => A.run(A.flush), 350);
  };
  A.flush = async () => {
    A.richNotes?.flushPending();
    clearTimeout(A.saveTimer);
    for (const [key, p] of [...A.pending]) {
      if (A.pending.get(key) !== p) continue;
      A.pending.delete(key);
      await A.save(p.kind, p.value);
    }
    await A.saveTail;
    await S.flush();
    if (A.pending.size)
      throw new Error(
        "Some changes could not be saved. Retry before continuing.",
      );
  };
  A.updateMeeting = async (id, patch) => {
    await A.flush();
    const m = A.data.meetings.find((m) => m.id === id);
    if (!m) throw new Error("The target meeting is no longer available.");
    await A.save("meetings", { ...m, ...patch });
    if (A.meetingId === id) A.renderEditor(false);
  };
  A.reload = async () => {
    await A.flush();
    A.richNotes?.reset();
    A.data = await S.snapshot();
    A.heads = Object.fromEntries(
      (await S.all("entities")).map((r) => [M.key(r.kind, r.id), r.heads]),
    );
    if (!A.data.projects.some((p) => p.id === A.project)) A.project = "inbox";
    if (A.meetingId && !A.current()) A.meetingId = null;
    A.render();
    await A.renderConflicts();
  };
  A.navigate = async (section, project = A.project) => {
    await A.flush();
    A.section = section;
    A.project = project;
    A.meetingId = null;
    A.render();
    A.nav(false);
  };
  A.open = async (id, tab = "note") => {
    await A.flush();
    const m = A.data.meetings.find((m) => m.id === id);
    if (!m) return;
    A.meetingId = id;
    $("transcriptActionStatus").textContent = "";
    A.project = m.projectId;
    A.tab = tab;
    A.render();
  };
  A.nav = (open) => {
    $("sidebar").classList.toggle("open", open);
    $("scrim").classList.toggle("show", open);
    $("menuBtn").setAttribute("aria-expanded", String(open));
  };
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.target.closest("[data-insert], [data-format], #noteStyleBtn"))
      event.preventDefault();
  });
  A.newDialog = (date) => {
    $("newDate").value = date || localDate() + "T09:00";
    $("newMeetingDialog").showModal();
    $("newTitle").focus();
  };
  A.photo = async (file) => {
    if (!file.type.startsWith("image/"))
      throw new Error("Choose an image file");
    let blob = file;
    try {
      const image = await createImageBitmap(file),
        scale = Math.min(1, 1920 / Math.max(image.width, image.height));
      if (scale < 1) {
        const c = document.createElement("canvas");
        c.width = Math.round(image.width * scale);
        c.height = Math.round(image.height * scale);
        c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
        blob =
          (await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85))) || file;
      }
      image.close();
    } catch {}
    return {
      id: crypto.randomUUID(),
      mediaId: await S.addMedia(blob, file.name),
      note: "",
    };
  };
  A.loadImages = () => {
    document.querySelectorAll("[data-media]").forEach((img) => {
      const id = img.dataset.media;
      S.mediaURL(id)
        .then((url) => {
          if (img.isConnected && img.dataset.media === id && url) img.src = url;
        })
        .catch(console.error);
    });
  };
  A.sanitize = (raw) => {
    const t = document.createElement("template");
    t.innerHTML = String(raw || "").replace(/```(?:html)?/g, "");
    const allowed = new Set([
      "H3",
      "P",
      "UL",
      "OL",
      "LI",
      "STRONG",
      "B",
      "EM",
      "BR",
      "A",
    ]);
    const walk = (n) =>
      [...n.childNodes].forEach((c) => {
        if (c.nodeType === 1) {
          if (!allowed.has(c.tagName))
            c.replaceWith(document.createTextNode(c.textContent));
          else {
            const href = c.tagName === "A" ? c.getAttribute("href") : "";
            [...c.attributes].forEach((a) => c.removeAttribute(a.name));
            if (c.tagName === "A") {
              if (!/^https?:\/\//i.test(href || "")) {
                c.replaceWith(document.createTextNode(c.textContent));
                return;
              }
              c.setAttribute("href", href);
              c.setAttribute("target", "_blank");
              c.setAttribute("rel", "noopener noreferrer");
            }
            walk(c);
          }
        }
      });
    walk(t.content);
    return t.innerHTML;
  };
  A.formatAiText = (raw) => {
    const value = String(raw || "")
      .trim()
      .replace(/^```(?:html|markdown|md)?\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/, "")
      .trim();
    if (!value) return "";
    const inline = (line) => A.esc(line).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const plain = (block) => {
      const html = [];
      let list = "";
      const prepared = block.replace(/([^\s])\s*(?=\*\*[^*\r\n]{2,100}:\*\*)/g, "$1\n");
      const closeList = () => {
        if (list) html.push(`</${list}>`);
        list = "";
      };
      for (const line of prepared.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) { closeList(); continue; }
        const heading = trimmed.match(/^#{1,6}\s+(.+)$/) ||
          trimmed.match(/^(Overview|Decisions|Action items|Open questions|Transcript (?:&|and) translation insights|Meeting details|Thông tin cuộc họp|Tóm tắt|Quyết định|Việc cần làm|Câu hỏi còn mở)\s*:\s*$/i) ||
          trimmed.match(/^\*\*(Overview|Decisions|Action items|Open questions|Transcript (?:&|and) translation insights|Meeting details|Thông tin cuộc họp|Tóm tắt|Quyết định|Việc cần làm|Câu hỏi còn mở):?\*\*\s*$/i);
        if (heading) { closeList(); html.push(`<h3>${inline(heading[1])}</h3>`); continue; }
        const bullet = trimmed.match(/^[-*+•]\s+(.+)$/);
        const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
        if (bullet || numbered) {
          const kind = bullet ? "ul" : "ol";
          if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
          html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
          continue;
        }
        closeList();
        html.push(`<p>${inline(trimmed)}</p>`);
      }
      closeList();
      return html.join("");
    };
    if (!/<\/?[a-z][^>]*>/i.test(value)) return A.sanitize(plain(value));
    const normalized = value
      .replace(/<(\/?)h[1-6](?=[\s>])/gi, "<$1h3")
      .replace(/<(\/?)div(?=[\s>])/gi, "<$1p")
      .replace(/<(\/?)section(?=[\s>])/gi, "<$1p");
    const template = document.createElement("template");
    template.innerHTML = normalized;
    const formatInlineNodes = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (!node.textContent.includes("**")) continue;
        const replacement = document.createElement("template");
        replacement.innerHTML = inline(node.textContent);
        node.replaceWith(replacement.content);
      }
    };
    const html = [...template.content.childNodes].map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return plain(node.textContent || "");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.tagName === "P" && node.children.length === 0 &&
          /\*\*|(?:^|\n)\s*(?:#{1,6}\s+|[-*+•]\s+|\d+[.)]\s+)/.test(node.textContent))
        return plain(node.textContent);
      formatInlineNodes(node);
      return node.outerHTML;
    }).join("");
    return A.sanitize(html);
  };
  A.renderConflicts = async () => {
    const conflicts = ZMinutesModel.reduce(await S.all("journal")).conflicts;
    A.conflicts = conflicts;
    $("conflictList").innerHTML = conflicts
      .map(
        (c, i) =>
          `<article class="ov-card"><h3>Conflicting ${A.esc(c.kind)}: ${A.esc(c.versions.find((v) => v.value)?.value.title || c.id)}</h3><p>Both versions are retained. Select the version to keep.</p>${c.versions.map((v, j) => `<details><summary>Version ${j + 1}${v.value ? "" : " — Deleted"}</summary><pre>${A.esc(JSON.stringify(v.value, null, 2))}</pre><button class="secondary" data-resolve="${i}" data-version="${j}">Use this version</button></details>`).join("")}</article>`,
      )
      .join("");
    $("conflictCount").textContent = conflicts.length
      ? conflicts.length + " conflicts need attention"
      : "No sync conflicts";
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    A.run(async () => {
      if (b.dataset.go) return A.navigate(b.dataset.go);
      if (b.dataset.project) return A.navigate("overview", b.dataset.project);
      if (b.dataset.open)
        return A.open(b.dataset.open, b.dataset.tab || "note");
      if (b.dataset.tab && b.closest(".tabs")) {
        await A.flush();
        A.tab = b.dataset.tab;
        A.renderEditor();
        return;
      }
      if (b.hasAttribute("data-new")) return A.newDialog();
      if (b.dataset.day) {
        A.day = b.dataset.day;
        A.renderSection();
        return;
      }
      if (b.dataset.month) {
        const d = new Date(A.day + "T12:00:00");
        d.setDate(1);
        d.setMonth(d.getMonth() + Number(b.dataset.month));
        A.day = new Date(d - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 10);
        A.renderSection();
        return;
      }
      if (b.hasAttribute("data-today")) {
        A.day = localDate();
        A.renderSection();
        return;
      }
      if (b.hasAttribute("data-create-meeting"))
        return A.newDialog(A.day + "T09:00");
      if (b.hasAttribute("data-create-task")) {
        await A.navigate("tasks");
        $("taskDue").value = A.day;
        return $("taskTitle").focus();
      }
      if (b.dataset.deleteMeeting) {
        if (!confirm("Delete this meeting?")) return;
        await A.flush();
        await S.remove("meetings", b.dataset.deleteMeeting);
        return A.reload();
      }
      if (b.dataset.deleteTask) {
        await S.remove("tasks", b.dataset.deleteTask);
        return A.reload();
      }
      if (b.dataset.deleteField) {
        if (!confirm("Delete this field note?")) return;
        await S.remove("fieldNotes", b.dataset.deleteField);
        return A.reload();
      }
      if (b.dataset.editField) {
        A.drafts.field = structuredClone(
          A.data.fieldNotes.find((f) => f.id === b.dataset.editField),
        );
        return A.renderSection();
      }
      if (b.dataset.removeAgenda) {
        const m = A.current();
        await A.updateMeeting(m.id, {
          agenda: m.agenda.filter((a) => a.id !== b.dataset.removeAgenda),
        });
        return A.renderEditor();
      }
      if (b.dataset.removePerson) {
        const m = A.current();
        await A.updateMeeting(m.id, {
          stakeholders: m.stakeholders.filter(
            (p) => p.id !== b.dataset.removePerson,
          ),
        });
        return A.renderEditor();
      }
      if (b.dataset.removePhoto) {
        await A.flush();
        const m = A.current();
        if (A.richNotes?.referenced(b.dataset.removePhoto)) {
          if (confirm("This photo is used in Notes. Go to Notes to remove its image first?"))
            A.richNotes.goToNotes();
          return;
        }
        await A.updateMeeting(m.id, {
          photos: m.photos.filter((p) => p.id !== b.dataset.removePhoto),
        });
        return A.renderEditor();
      }
      if (b.dataset.download) {
        const item = await S.get("media", b.dataset.download);
        if (!item)
          throw new Error("This attachment is not available on this device");
        return A.download(item.blob, item.name);
      }
      if (b.dataset.resolve !== undefined) {
        await A.flush();
        const c = A.conflicts[Number(b.dataset.resolve)],
          v = c.versions[Number(b.dataset.version)].value;
        if (v) {
          const old = A.data[c.kind].find((r) => r.id === c.id);
          await S.put(
            c.kind,
            { ...v, ...(old?.audioId ? { audioId: old.audioId } : {}) },
            c.versions.map((o) => o.id),
          );
        } else await S.remove(c.kind, c.id);
        return A.reload();
      }
      if (b.dataset.insert) {
        A.richNotes?.insertCallout(b.dataset.insert);
        return;
      }
      if (b.dataset.format) {
        A.richNotes?.command(b.dataset.format);
        return;
      }
    });
  });
  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (
      ![
        "newMeetingForm",
        "agendaForm",
        "stakeholderForm",
        "taskForm",
        "fieldForm",
      ].includes(f.id) &&
      !f.dataset.taskEdit
    )
      return;
    e.preventDefault();
    A.run(async () => {
      if (f.id === "newMeetingForm") {
        const title = $("newTitle").value.trim();
        if (!title) return;
        const templates = {
            project: [
              "Progress since last meeting",
              "Current blockers",
              "Decisions needed",
              "Next actions",
            ],
            site: [
              "Site conditions",
              "Safety and access",
              "Issues observed",
              "Required follow-up",
            ],
            oneonone: [
              "Check-in",
              "Wins and challenges",
              "Topics to discuss",
              "Next steps",
            ],
          },
          id = crypto.randomUUID();
        const cfg = A.safeRead("zminutes-ai-settings-v1");
        const button = f.querySelector("[type=submit]");
        button.disabled = true;
        try {
          await A.save(
            "meetings",
            M.normalize("meetings", {
              id,
              projectId: A.project,
              title,
              date: $("newDate").value,
              cloudAudioAllowed: !!cfg.cloudAudio,
              agenda: (templates[$("meetingTemplateSelect").value] || []).map(
                (text) => ({ id: crypto.randomUUID(), text }),
              ),
            }),
          );
          $("newMeetingDialog").close();
          f.reset();
          await A.open(id);
        } finally {
          button.disabled = false;
        }
        return;
      }
      if (f.id === "taskForm") {
        const title = $("taskTitle").value.trim();
        if (!title) return;
        await A.save("tasks", {
          id: crypto.randomUUID(),
          projectId: A.project,
          title,
          due: $("taskDue").value,
          remindAt: $("taskRemindAt").value,
          meetingId: $("taskMeeting").value,
          status: "in-progress",
        });
        delete A.drafts.task;
        return A.renderSection();
      }
      if (f.dataset.taskEdit) {
        const t = A.data.tasks.find((t) => t.id === f.dataset.taskEdit),
          title = f.elements.title.value.trim();
        if (!title) return;
        await A.save("tasks", {
          ...t,
          title,
          due: f.elements.due.value,
          remindAt: f.elements.remindAt.value,
        });
        return A.renderSection();
      }
      if (f.id === "fieldForm") {
        if (A.photosLoading)
          throw new Error(
            "Please wait for the selected photos to finish loading",
          );
        const title = $("fieldTitle").value.trim();
        if (!title) return;
        await A.save("fieldNotes", {
          ...A.drafts.field,
          id: A.drafts.field?.id || crypto.randomUUID(),
          projectId: A.project,
          title,
          location: $("fieldLocation").value,
          text: $("fieldText").value,
          photos: A.drafts.field?.photos || [],
        });
        delete A.drafts.field;
        return A.renderSection();
      }
      const m = A.current();
      if (!m) return;
      if (f.id === "agendaForm") {
        const text = $("agendaInput").value.trim();
        if (!text) return;
        await A.updateMeeting(m.id, {
          agenda: [
            ...m.agenda,
            { id: crypto.randomUUID(), text, note: "", done: false },
          ],
        });
      }
      if (f.id === "stakeholderForm") {
        const name = $("stakeholderName").value.trim();
        if (!name) return;
        await A.updateMeeting(m.id, {
          stakeholders: [
            ...m.stakeholders,
            {
              id: crypto.randomUUID(),
              name,
              role: $("stakeholderRole").value,
              status: "invited",
            },
          ],
        });
      }
      f.reset();
      A.renderEditor();
    });
  });
  document.addEventListener("input", (e) => {
    const t = e.target,
      m = A.current(),
      fields = {
        titleInput: "title",
        dateInput: "date",
        locationInput: "location",
        transcriptInput: "transcript",
        summaryPromptInput: "summaryPrompt",
        solutionPromptInput: "solutionPrompt",
      };
    if (m && fields[t.id]) {
      m[fields[t.id]] = t.value;
      A.queue("meetings", m);
      if (t.classList.contains("prompt-input")) A.resizePrompts();
      if (t.id === "transcriptInput") {
        $("transcriptCombined").textContent =
          M.fullTranscript(m) || "No transcript yet.";
        A.showTranslation?.();
      }
    }
    if (m && t.dataset.agendaNote) {
      m.agenda.find((a) => a.id === t.dataset.agendaNote).note = t.value;
      A.queue("meetings", m);
    }
    if (m && t.dataset.photoNote) {
      m.photos.find((p) => p.id === t.dataset.photoNote).note = t.value;
      A.queue("meetings", m);
    }
    if (t.closest("#taskForm"))
      A.drafts.task = {
        title: $("taskTitle").value,
        due: $("taskDue").value,
        remindAt: $("taskRemindAt").value,
        meetingId: $("taskMeeting").value,
      };
    if (t.closest("#fieldForm"))
      A.drafts.field = {
        ...A.drafts.field,
        title: $("fieldTitle").value,
        location: $("fieldLocation").value,
        text: $("fieldText").value,
      };
    if (t.id === "searchInput") A.renderMeetings(t.value);
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    A.run(async () => {
      const m = A.current();
      if (t.dataset.taskStatus) {
        const task = A.data.tasks.find((x) => x.id === t.dataset.taskStatus);
        await A.save("tasks", {
          ...task,
          status:
            t.type === "checkbox"
              ? t.checked
                ? "done"
                : "in-progress"
              : t.value,
        });
        return A.render();
      }
      if (m && t.dataset.agendaDone) {
        m.agenda.find((a) => a.id === t.dataset.agendaDone).done = t.checked;
        return A.save("meetings", m);
      }
      if (m && t.dataset.personStatus) {
        m.stakeholders.find((p) => p.id === t.dataset.personStatus).status =
          t.value;
        return A.save("meetings", m);
      }
      if (m && t.id === "meetingCloudAudioEnabled")
        return A.updateMeeting(m.id, { cloudAudioAllowed: t.checked });
      if (m && t.id === "solutionGroundingInput")
        return A.updateMeeting(m.id, { solutionGrounding: t.checked });
      if (m && t.id === "projectPicker") {
        await A.updateMeeting(m.id, { projectId: t.value });
        A.project = t.value;
        for (const task of A.data.tasks.filter((x) => x.meetingId === m.id))
          await A.save("tasks", { ...task, projectId: t.value });
        return A.render();
      }
      if (["photoInput", "photoCameraInput"].includes(t.id)) {
        const id = m?.id,
          files = [...t.files];
        t.value = "";
        if (!id) return;
        const photos = await Promise.all(files.map(A.photo)),
          target = A.data.meetings.find((x) => x.id === id);
        await A.updateMeeting(id, { photos: [...target.photos, ...photos] });
        return A.renderEditor();
      }
      if (["fieldPhotos", "fieldCameraPhotos"].includes(t.id)) {
        const files = [...t.files];
        t.value = "";
        A.photosLoading = true;
        try {
          const photos = await Promise.all(files.map(A.photo));
          A.drafts.field = {
            ...A.drafts.field,
            photos: [...(A.drafts.field?.photos || []), ...photos],
          };
          if (A.section === "field") A.renderSection();
        } finally {
          A.photosLoading = false;
        }
        return;
      }
      if (t.id === "agendaUpload") {
        const id = m?.id,
          file = t.files[0];
        t.value = "";
        if (!id || !file) return;
        const text = await file.text(),
          target = A.data.meetings.find((x) => x.id === id);
        const questions = text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        await A.updateMeeting(id, {
          agenda: [
            ...target.agenda,
            ...questions.map((text) => ({
              id: crypto.randomUUID(),
              text,
              note: "",
              done: false,
            })),
          ],
        });
        return A.renderEditor();
      }
    });
  });
  $("newMeetingBtn").onclick = $("heroNewBtn").onclick = () => A.newDialog();
  const topMore = document.querySelector(".top-more");
  topMore.addEventListener("click", (event) => {
    if (event.target.closest("button")) topMore.open = false;
  });
  document.addEventListener("pointerdown", (event) => {
    if (!topMore.contains(event.target)) topMore.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && topMore.open) {
      topMore.open = false;
      topMore.querySelector("summary").focus();
      event.preventDefault();
    }
  });
  $("newMeetingDialog").querySelector(".dialog-close").onclick = () =>
    $("newMeetingDialog").close();
  $("settingsNavBtn").onclick =
    $("aiSettingsBtn").onclick =
    $("manageAiBtn").onclick =
      () => A.run(() => A.navigate("settings"));
  $("backBtn").onclick = () => A.run(() => A.navigate(A.section));
  $("menuBtn").onclick = () => A.nav(!$("sidebar").classList.contains("open"));
  $("sbClose").onclick = $("scrim").onclick = () => A.nav(false);
  $("newProjectBtn").onclick = () =>
    A.run(async () => {
      const name = prompt("Project name");
      if (!name?.trim()) return;
      const id = crypto.randomUUID();
      await A.save("projects", { id, name: name.trim(), color: "#0078d4" });
      await A.navigate("overview", id);
    });
  $("moreBtn").onclick = () =>
    A.run(async () => {
      const m = A.current();
      if (m && confirm("Delete this meeting?")) {
        await A.flush();
        await S.remove("meetings", m.id);
        await A.reload();
      }
    });
  $("retrySaveBtn").onclick = () =>
    A.run(async () => {
      await A.flush();
      A.notice("Changes saved.");
    });
  window.addEventListener("beforeunload", (e) => {
    if (A.richNotes?.isDirty()) A.richNotes.flushPending();
    if (A.pending.size || A.saving || A.recording) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("zminutes:externalchange", () => {
    if (A.ready && !A.recording) A.run(A.reload);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) A.run(A.flush);
  });
  A.start = async () => {
    const boot = $("bootStatus");
    try {
      boot.textContent = "Opening your workspace…";
      await S.init();
      A.data = await S.snapshot();
      A.heads = Object.fromEntries(
        (await S.all("entities")).map((r) => [M.key(r.kind, r.id), r.heads]),
      );
      A.ready = true;
      A.render();
      await A.renderConflicts();
      document.querySelector(".app").inert = false;
      $("bootScreen").hidden = true;
      window.dispatchEvent(new Event("zminutes:ready"));
    } catch (e) {
      boot.textContent = "Could not open your workspace: " + e.message;
      $("bootRetry").hidden = false;
    }
  };
  $("bootRetry").onclick = () => A.start();
})();
