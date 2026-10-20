(() => {
  const A = ZM,
    $ = A.$,
    e = A.esc;
  $("summaryOutput").before($("recapKind"));
  // Shared stroke icons, independent of device fonts and available offline.
  const icons = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    meetings: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
    field: '<path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="14" r="4"/>',
    files: '<path d="M8 3h9l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM17 3v5h4M3 7v11M10 12h7M10 16h5"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--card)"/><circle cx="15" cy="17" r="3" fill="var(--card)"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    back: '<path d="m11 5-7 7 7 7M4 12h16"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    sync: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15"/>',
    install: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    restore: '<path d="M3 4v5h5M4 9a8 8 0 1 1 0 6M12 8v5l3 2"/>',
    import: '<path d="M12 16V3m-4 4 4-4 4 4M4 14v7h16v-7"/>',
  };
  const icon = (name) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || icons.files}</svg>`;
  document.querySelectorAll("[data-ui-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.uiIcon); });
  const sections = [
    ["overview", "Overview"],
    ["meetings", "Meetings"],
    ["calendar", "Calendar"],
    ["tasks", "Tasks"],
    ["field", "Field notes"],
    ["files", "Files"],
  ];
  const head = (title, desc) =>
    `<div class="sec-head"><h1>${title}</h1><p>${desc}</p></div>`;
  const empty = (text) => `<p class="empty-note">${text}</p>`;
  const project = () =>
    A.data.projects.find((p) => p.id === A.project) || ZMinutesModel.inbox();
  const meetings = () =>
    A.data.meetings.filter((m) => m.projectId === A.project);
  const tasks = () => A.data.tasks.filter((t) => t.projectId === A.project);
  const light = (t) =>
    t.status === "done"
      ? "green"
      : t.due && t.due < A.today()
        ? "red"
        : "amber";
  const label = (t) =>
    t.status === "done"
      ? "Completed"
      : light(t) === "red"
        ? "Overdue"
        : "In progress";
  const date = (v) =>
    v && !isNaN(new Date(v))
      ? new Date(v).toLocaleString(undefined, {
          dateStyle: "medium",
          ...(v.includes("T") ? { timeStyle: "short" } : {}),
        })
      : "Not scheduled";
  A.formatDate = date;
  A.projectPhotos = () =>
    [
      ...meetings().flatMap((m) =>
        m.photos.map((p) => ({
          ...p,
          meetingId: m.id,
          title: m.title,
          updated: m.updated,
        })),
      ),
      ...A.data.fieldNotes
        .filter((f) => f.projectId === A.project)
        .flatMap((f) =>
          f.photos.map((p) => ({ ...p, title: f.title, updated: f.updated })),
        ),
    ].sort((a, b) => b.updated - a.updated);
  A.render = () => {
    $("projectList").innerHTML = A.data.projects
      .map(
        (p) =>
          `<div class="proj${p.id === A.project ? " current open" : ""}"><button class="proj-head" data-project="${e(p.id)}" title="${e(p.name)}" aria-label="${e(p.name)}"><span class="proj-chip">${icon("folder")}</span><span class="proj-name">${e(p.name)}</span></button>${p.id === A.project ? '<nav class="proj-nav" aria-label="Project navigation">' + sections.map(([id, title]) => `<button class="nav-item${A.section === id ? " active" : ""}" data-go="${id}" title="${title}" aria-label="${title}" ${A.section === id ? 'aria-current="page"' : ''}>${icon(id)}<span class="nav-label">${title}</span></button>`).join("") + "</nav>" : ""}</div>`,
      )
      .join("");
    $("crumbs").textContent =
      project().name +
      " › " +
      (A.current()?.title ||
        sections.find((s) => s[0] === A.section)?.[1] ||
        "Settings");
    const view = A.meetingId
      ? "editorView"
      : A.section === "overview"
        ? "overviewView"
        : A.section === "meetings"
          ? "homeView"
          : A.section === "personal"
            ? "personalView"
          : A.section === "settings"
            ? "settingsView"
            : "placeholderView";
    for (const id of [
      "editorView",
      "overviewView",
      "homeView",
      "settingsView",
      "placeholderView",
      "personalView",
    ])
      $(id).classList.toggle("hidden", id !== view);
    $("backBtn").classList.toggle("hidden", !A.meetingId);
    $("newMeetingBtn").classList.toggle("hidden", !!A.meetingId);
    if (A.meetingId) A.renderEditor();
    else if (A.section === "overview") A.renderOverview();
    else if (A.section === "meetings") A.renderMeetings();
    else if (A.section === "personal") A.run(() => A.personal?.render());
    else if (A.section !== "settings") A.renderSection();
    if (A.section === "personal" && !A.meetingId) { $("crumbs").textContent = "Personal Notes"; $("newMeetingBtn").classList.add("hidden"); }
    A.loadImages();
  };
  A.renderOverview = () => {
    const ms = meetings().sort((a, b) => b.updated - a.updated),
      ts = tasks(),
      open = ts.filter((t) => t.status !== "done"),
      photos = A.projectPhotos();
    const stat = (color, icon, title, count, sub, go) =>
      `<button class="stat ${color}" data-go="${go}"><span class="stat-ic">${icon}</span><span><span class="stat-label">${title}</span><br><span class="stat-num">${count}</span><br><span class="stat-sub">${sub}</span></span></button>`;
    $("overviewView").innerHTML =
      `<div class="ov-head"><span class="ov-icon">▱</span><div><h1>${e(project().name)}</h1><p>Meetings, tasks and field notes in one place.</p><button class="link-btn" id="renameProject">Rename project</button>${A.project !== "inbox" ? '<button class="link-btn" id="deleteProject">Delete project</button>' : ""}</div></div><div class="ov-stats">${stat("blue", "▣", "Meetings", ms.length, "Total project meetings", "meetings")}${stat("amber", "✓", "Open actions", open.length, ts.length - open.length + " completed", "tasks")}${stat("green", "▧", "Field photos", photos.length, "Meeting and field-note photos", "field")}</div><div class="ov-grid"><div class="ov-col main"><section class="ov-card"><h2>Tasks</h2>${
        open
          .slice(0, 5)
          .map(
            (t) =>
              `<label class="act"><input type="checkbox" data-task-status="${e(t.id)}"><span>${e(t.title)}<small>${e(t.due || "No due date")}</small></span></label>`,
          )
          .join("") || empty("No open tasks.")
      }<button class="link-btn" data-go="tasks">View tasks →</button></section><section class="ov-card"><div class="ov-card-head"><h2>Recent</h2><button class="link-btn" data-go="meetings">View all →</button></div>${
        ms
          .slice(0, 5)
          .map(
            (m) =>
              `<button class="calendar-entry" data-open="${e(m.id)}"><span>${e(date(m.date))}</span><strong>${e(m.title || "Untitled meeting")}</strong><small>${m.summary ? "Recap ready" : "No recap"}</small></button>`,
          )
          .join("") || empty("No meetings yet.")
      }<button class="primary" data-new>+ New meeting</button></section></div><div class="ov-col side"><section class="ov-card"><h2>Latest field photos</h2><div class="shots">${photos
        .slice(0, 3)
        .map(
          (p) =>
            `<img data-media="${e(p.mediaId)}" alt="${e(p.note || p.title)}">`,
        )
        .join(
          "",
        )}</div>${photos.length ? "" : empty("No photos yet.")}</section></div></div>`;
    $("renameProject").onclick = () =>
      A.run(async () => {
        const name = prompt("Project name", project().name);
        if (name?.trim()) {
          await A.save("projects", { ...project(), name: name.trim() });
          A.render();
        }
      });
    if ($("deleteProject"))
      $("deleteProject").onclick = () =>
        A.run(async () => {
          if (
            !confirm(
              "Move this project’s items to Personal Workspace and delete the project?",
            )
          )
            return;
          await A.flush();
          for (const kind of ["meetings", "tasks", "fieldNotes", "files"])
            for (const r of A.data[kind].filter(
              (r) => r.projectId === A.project,
            ))
              await A.save(kind, { ...r, projectId: "inbox" });
          await ZMinutesStore.remove("projects", A.project);
          A.project = "inbox";
          await A.reload();
        });
  };
  A.renderMeetings = (query = $("searchInput").value) => {
    const q = query.toLowerCase(),
      ms = meetings()
        .filter((m) =>
          [
            m.title,
            m.note,
            ZMinutesModel.fullTranscript(m),
            m.location,
            ...m.stakeholders.map((p) => p.name),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
        .sort((a, b) => b.updated - a.updated);
    $("meetingsHead").innerHTML = head(
      "My meetings",
      "All meetings in this project.",
    );
    $("meetingCount").textContent = ms.length + " meetings";
    $("meetingList").innerHTML =
      ms
        .map(
          (m) =>
            `<article class="meeting-card"><button class="card-main" data-open="${e(m.id)}"><span class="meeting-date" aria-hidden="true">${e(m.date && !isNaN(new Date(m.date)) ? new Date(m.date).getDate() : "–")}</span><span class="meeting-info"><strong>${e(m.title || "Untitled meeting")}</strong><small>${e(date(m.date))}${m.location ? " · " + e(m.location) : ""}</small></span><span class="meeting-open" aria-hidden="true">›</span></button><details class="meeting-menu"><summary aria-label="More actions for ${e(m.title || "Untitled meeting")}" title="More actions">•••</summary><div><button class="delete-btn" data-delete-meeting="${e(m.id)}" aria-label="Delete ${e(m.title || "Untitled meeting")}">Delete meeting</button></div></details></article>`,
        )
        .join("") || empty("No matching meetings.");
  };
  A.resizePrompts = () => {
    if (A.tab !== "summary") return;
    for (const id of ["summaryPromptInput", "solutionPromptInput"]) {
      const input = $(id);
      input.style.height = "auto";
      input.style.height =
        Math.min(
          Math.max(input.scrollHeight + 2, 68),
          Math.min(innerHeight * 0.4, 360),
        ) + "px";
    }
  };
  $("summaryPromptInput")
    .closest("details")
    .addEventListener("toggle", () => A.resizePrompts());
  window.addEventListener("resize", () => A.resizePrompts());
  A.renderEditor = (full = true) => {
    const m = A.current();
    if (!m) return;
    if (full && (!A.aiBusy || A.recapStatusMeetingId !== m.id)) {
      $("recapStatus").hidden = true;
      $("recapStatus").textContent = "";
    }
    if (full) {
      $("titleInput").value = m.title;
      $("dateInput").value = m.date;
      $("locationInput").value = m.location;
      A.richNotes?.mount(m);
      $("transcriptInput").value = m.transcript;
      $("summaryPromptInput").value = m.summaryPrompt;
      $("solutionPromptInput").value = m.solutionPrompt;
    }
    $("projectPicker").innerHTML = A.data.projects
      .map((p) => `<option value="${e(p.id)}">${e(p.name)}</option>`)
      .join("");
    $("projectPicker").value = m.projectId;
    $("agendaBadge").textContent = m.agenda.length;
    $("photoBadge").textContent = m.photos.length;
    $("stakeholderBadge").textContent = m.stakeholders.length;
    document.querySelectorAll(".tabs [data-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === A.tab);
      b.setAttribute("aria-selected", String(b.dataset.tab === A.tab));
    });
    ["note", "agenda", "stakeholders", "field", "summary"].forEach((tab) =>
      $(tab + "Panel").classList.toggle("hidden", tab !== A.tab),
    );
    if (full) {
      $("agendaList").innerHTML = m.agenda
        .map(
          (a) =>
            `<div class="agenda-item"><input type="checkbox" data-agenda-done="${e(a.id)}" ${a.done ? "checked" : ""} aria-label="Question answered"><label>${e(a.text)}</label><button data-remove-agenda="${e(a.id)}" class="remove" aria-label="Remove question">×</button><textarea class="agenda-note" data-agenda-note="${e(a.id)}" placeholder="Answer or notes…">${e(a.note)}</textarea></div>`,
        )
        .join("");
      $("photoList").innerHTML = m.photos
        .map(
          (p) =>
            `<article class="photo-card"><img data-media="${e(p.mediaId)}" alt="${e(p.note || "Field photo")}"><textarea data-photo-note="${e(p.id)}" placeholder="Caption or observation">${e(p.note)}</textarea><button class="link-btn" data-remove-photo="${e(p.id)}">Remove photo</button></article>`,
        )
        .join("");
      $("stakeholderList").innerHTML =
        m.stakeholders
          .map(
            (p) =>
              `<article class="stakeholder-row"><div><strong>${e(p.name)}</strong><small>${e(p.role)}</small></div><select data-person-status="${e(p.id)}" aria-label="Attendance">${["invited", "attended", "not-attended"].map((v) => `<option value="${v}" ${p.status === v ? "selected" : ""}>${v}</option>`).join("")}</select><button data-remove-person="${e(p.id)}" class="mini-delete" aria-label="Remove person">×</button></article>`,
          )
          .join("") || empty("No stakeholders yet.");
    }
    $("summaryOutput").innerHTML = m.summary
      ? A.formatAiText(m.summary)
      : "<p>No recap yet. Generate one when the meeting ends.</p>";
    $("summaryOutput").classList.toggle("empty", !m.summary);
    $("generateSummaryBtn").textContent = m.summary ? "✦ Regenerate recap" : "✦ Generate recap";
    $("recapKind").textContent =
      m.summaryType === "quick"
        ? "Offline draft · not an AI model"
        : m.summaryType === "ai"
          ? "AI recap"
          : m.summary
            ? "Saved recap"
            : "";
    $("meetingCloudAudioEnabled").checked = m.cloudAudioAllowed;
    $("liveCloudHelpBtn").hidden = m.cloudAudioAllowed;
    $("liveCloudHint").textContent = m.cloudAudioAllowed
      ? "Optional: sends audio every 30 seconds using your transcription model and key. May increase API costs. Off for each new recording."
      : "Live draft needs cloud transcription permission for this meeting. Use the button above to review and enable it.";
    $("solutionGroundingInput").checked = m.solutionGrounding;
    $("transcriptCombined").textContent =
      ZMinutesModel.fullTranscript(m) || "No transcript yet.";
    $("manualTranscriptLabel").textContent = m.transcript.trim() ? "Additional text · saved" : "Add text";
    if ($("manualTranscript").dataset.meeting !== m.id) {
      $("manualTranscript").open = false;
      $("manualTranscript").dataset.meeting = m.id;
    }
    A.showTranslation?.();
    $("solutionOutput").innerHTML = m.solutions
      ? A.formatAiText(m.solutions)
      : "<p>No suggested solutions yet.</p>";
    $("solutionOutput").classList.toggle("empty", !m.solutions);
    $("solutionSources").innerHTML = m.solutionSources
      .filter((s) => /^https?:\/\//i.test(s.url))
      .map(
        (s) =>
          `<div><a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title || s.url)}</a></div>`,
      )
      .join("");
    const recordings = m.recordings.filter((r) => r.audioId);
    if (!recordings.some((r) => r.id === A.selectedRecordingId))
      A.selectedRecordingId = recordings.at(-1)?.id || null;
    $("recordingList").innerHTML = recordings
      .map((r, i) => {
        const transcribed = m.transcriptSegments.some(
          (segment) => segment.recordingId === r.id,
        );
        const name = r.label || "Recording " + (i + 1);
        const stamp = r.createdAt ? new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Saved audio";
        const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
        const action = (key, label, path, cls = "") => `<button type="button" class="${cls}" data-${key}-recording="${e(r.id)}" aria-label="${label} ${e(name)}" title="${label}">${icon(path)}</button>`;
        return `<div class="file-row ${A.selectedRecordingId === r.id ? "selected" : ""}"><div class="recording-meta" title="${e(name + ' · ' + stamp)}"><strong>${e(name)}</strong><small>${transcribed ? "Transcribed" : "Ready"} · ${e(stamp)}</small></div><div class="recording-actions">${action("select", "Play", '<path d="m9 5 11 7-11 7z"/>')}${action("transcribe", "Transcribe", '<path d="M4 6h16M4 12h16M4 18h10"/>')}${action("download", "Download", '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>')}${action("delete", "Delete", '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>', "mini-delete")}</div></div>`;
      })
      .join("");
    const chosenRecording = recordings.find(
      (r) => r.id === A.selectedRecordingId,
    );
    const audio = $("audioPlayback");
    if (audio.dataset.media !== chosenRecording?.audioId) {
      audio.dataset.media = chosenRecording?.audioId || "";
      audio.removeAttribute("src");
      audio.hidden = true;
      ZMinutesStore.mediaURL(chosenRecording?.audioId).then((url) => {
        if (audio.dataset.media === chosenRecording?.audioId && url) {
          audio.src = url;
        }
      });
    }
    A.resizePrompts();
    A.loadImages();
  };
  A.renderSection = () => {
    const box = $("placeholderView");
    if (A.section === "tasks") {
      const d = A.drafts.task || {},
        ts = tasks().sort((a, b) =>
          (a.due || "9999").localeCompare(b.due || "9999"),
        );
      box.innerHTML =
        head("Tasks", "Shared by your project dashboard and calendar.") +
        `<section class="ov-card task-create"><h2>Add a task</h2><form id="taskForm" class="task-form"><label>Task<input id="taskTitle" required placeholder="What needs to be done?" value="${e(d.title || "")}"></label><label>Due date<input id="taskDue" type="date" value="${e(d.due || A.day)}"></label><label>Remind at<input id="taskRemindAt" type="datetime-local" value="${e(d.remindAt || "")}"></label><label>Meeting<select id="taskMeeting"><option value="">No linked meeting</option>${meetings()
          .map(
            (m) =>
              `<option value="${e(m.id)}" ${d.meetingId === m.id ? "selected" : ""}>${e(m.title)}</option>`,
          )
          .join(
            "",
          )}</select></label><button class="primary">+ Add task</button></form></section><section class="ov-card">${ts.map((t) => `<article class="task-card"><span class="signal ${light(t)}" title="${label(t)}"></span><div><strong>${e(t.title)}</strong><small>${label(t)} · ${e(t.due || "No due date")}${t.remindAt ? " · Reminder " + e(date(t.remindAt)) : ""}${t.meetingId ? " · " + e(A.data.meetings.find((m) => m.id === t.meetingId)?.title || "Unlinked meeting") : ""}</small><details class="task-edit"><summary>Edit</summary><form data-task-edit="${e(t.id)}"><input name="title" required value="${e(t.title)}" aria-label="Task title"><input name="due" type="date" value="${e(t.due)}"><label>Remind at<input name="remindAt" type="datetime-local" value="${e(t.remindAt)}"></label><button class="secondary">Save changes</button></form></details></div><select data-task-status="${e(t.id)}" aria-label="Task status"><option value="in-progress" ${t.status !== "done" ? "selected" : ""}>In progress</option><option value="done" ${t.status === "done" ? "selected" : ""}>Completed</option></select><button class="mini-delete" data-delete-task="${e(t.id)}" aria-label="Delete task">×</button></article>`).join("") || empty("No tasks yet.")}</section>`;
    } else if (A.section === "calendar") {
      const d = new Date(A.day + "T12:00:00"),
        y = d.getFullYear(),
        m = d.getMonth(),
        first = new Date(y, m, 1, 12),
        start = 1 - first.getDay(),
        items = (day) => [
          ...meetings()
            .filter((x) => x.date.slice(0, 10) === day)
            .map((x) => ({ id: x.id, title: x.title, type: "Meeting" })),
          ...tasks()
            .filter((t) => t.due === day)
            .map((t) => ({ title: t.title, type: label(t) })),
        ];
      const cells = Array.from({ length: 42 }, (_, i) => {
        const x = new Date(y, m, start + i, 12),
          key = new Date(x - x.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 10);
        return `<button class="cal-day${key === A.day ? " selected" : ""}${x.getMonth() !== m ? " outside" : ""}" data-day="${key}"><span>${x.getDate()}</span>${items(key).length ? "<i></i>" : ""}</button>`;
      }).join("");
      box.innerHTML =
        head("Calendar", "Choose a day for meetings and task deadlines.") +
        `<section class="ov-card calendar-card"><div class="calendar-toolbar"><button class="secondary" data-month="-1" aria-label="Previous month">‹</button><h2>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><button class="secondary" data-month="1" aria-label="Next month">›</button><button class="secondary" data-today>Today</button></div><div class="calendar-grid calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => "<span>" + x + "</span>").join("")}</div><div class="calendar-grid">${cells}</div><div class="calendar-selected"><h3>${e(date(A.day))}</h3><div class="calendar-create"><button class="primary" data-create-meeting>+ Meeting</button><button class="secondary" data-create-task>+ Task</button></div>${
          items(A.day)
            .map(
              (x) =>
                `<button class="calendar-entry" ${x.id ? 'data-open="' + e(x.id) + '"' : 'data-go="tasks"'}><span>${x.type}</span><strong>${e(x.title)}</strong></button>`,
            )
            .join("") || empty("Nothing scheduled.")
        }<div class="calendar-import-actions"><button id="icsBtn" class="link-btn">Export calendar (.ics)</button><label class="link-btn">Import calendar (.ics)<input id="icsImportInput" type="file" accept=".ics,text/calendar" hidden></label></div><p class="settings-help">Import a Google Calendar or company calendar .ics file. Re-import skips duplicate events. Recurring series are not expanded automatically; export individual occurrences if needed.</p></div></section>`;
      $("icsBtn").onclick = () => A.exports.calendar();
      $("icsImportInput").onchange = (event) => {
        const file = event.target.files[0];
        event.target.value = "";
        if (file) A.run(() => A.exports.importCalendar(file));
      };
    } else if (A.section === "field") {
      const d = A.drafts.field || {},
        fs = A.data.fieldNotes.filter((f) => f.projectId === A.project),
        photos = meetings().flatMap((m) =>
          m.photos.map((p) => ({ ...p, meetingId: m.id, title: m.title })),
        );
      box.innerHTML =
        head("Field notes", "Site observations and meeting photos.") +
        `<section class="ov-card field-create"><h2>${d.id ? "Edit field note" : "New field note"}</h2><form id="fieldForm" class="field-form"><label>Title<input id="fieldTitle" required placeholder="Observation title" value="${e(d.title || "")}"></label><label>Location<input id="fieldLocation" placeholder="Location" value="${e(d.location || "")}"></label><label class="field-body-label">Observation<textarea id="fieldText" placeholder="Observation and follow-up">${e(d.text || "")}</textarea></label><div class="field-photo-actions"><label class="field-upload">Take photo<input id="fieldCameraPhotos" type="file" accept="image/*" capture="environment" hidden></label><label class="field-upload">Choose from device<input id="fieldPhotos" type="file" accept="image/*" multiple hidden></label></div><div class="field-preview">${(d.photos || []).map((p) => `<img data-media="${e(p.mediaId)}" alt="Selected photo">`).join("")}</div><button class="primary">Save field note</button></form></section><section class="ov-card"><h2>Saved field notes</h2>${fs.map((f) => `<article class="field-card"><h3>${e(f.title)}</h3><p>${e(f.location)}</p><div class="field-text">${e(f.text)}</div><div class="field-card-photos">${f.photos.map((p) => `<img data-media="${e(p.mediaId)}" alt="${e(p.note || f.title)}">`).join("")}</div><button class="link-btn" data-edit-field="${e(f.id)}">Edit</button><button class="mini-delete" data-delete-field="${e(f.id)}" aria-label="Delete field note">×</button></article>`).join("") || empty("No standalone notes yet.")}<h2>Meeting photos</h2><div class="tiles">${photos.map((p) => `<button class="tile" data-open="${e(p.meetingId)}" data-tab="field"><img data-media="${e(p.mediaId)}" alt="${e(p.note || p.title)}"><span class="tile-cap">${e(p.note || p.title)}</span></button>`).join("")}</div></section>`;
    } else if (A.section === "files") {
      const files = [
        ...A.data.files.filter((f) => f.projectId === A.project),
        ...A.projectPhotos().map((p) => ({
          mediaId: p.mediaId,
          title: p.note || p.title || "Photo",
          type: "Image",
        })),
        ...meetings().flatMap((m) =>
          m.recordings
            .filter((r) => r.audioId)
            .map((r) => ({
              mediaId: r.audioId,
              title: m.title + " — " + r.label,
              type: "Recording (local)",
            })),
        ),
      ];
      box.innerHTML =
        head(
          "Files",
          "Meeting packages, photos and recordings available on this device.",
        ) +
        `<section class="ov-card">${files.map((f) => `<article class="file-row"><div><strong>${e(f.title)}</strong><small>${e(f.type)}</small></div><button class="secondary" data-download="${e(f.mediaId)}">Download</button></article>`).join("") || empty("No files yet. Import a meeting package or add media.")}</section>`;
    }
    A.loadImages();
  };
})();
