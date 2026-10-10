(() => {
  const A = ZM,
    $ = A.$,
    e = A.esc;
  $("summaryOutput").before($("recapKind"));
  const sections = [
    ["overview", "Overview", "▦"],
    ["meetings", "Meetings", "▤"],
    ["calendar", "Calendar", "▣"],
    ["tasks", "Tasks", "✓"],
    ["field", "Field notes", "▧"],
    ["files", "Files", "▱"],
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
          `<div class="proj${p.id === A.project ? " current open" : ""}"><button class="proj-head" data-project="${e(p.id)}"><span class="proj-chip" style="--c:${e(p.color)}">${e(p.name[0])}</span><span class="proj-name">${e(p.name)}</span></button>${p.id === A.project ? '<nav class="proj-nav">' + sections.map(([id, title, icon]) => `<button class="nav-item${A.section === id ? " active" : ""}" data-go="${id}" title="${title}"><span class="ic">${icon}</span><span class="nav-label">${title}</span></button>`).join("") + "</nav>" : ""}</div>`,
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
          : A.section === "settings"
            ? "settingsView"
            : "placeholderView";
    for (const id of [
      "editorView",
      "overviewView",
      "homeView",
      "settingsView",
      "placeholderView",
    ])
      $(id).classList.toggle("hidden", id !== view);
    $("backBtn").classList.toggle("hidden", !A.meetingId);
    $("newMeetingBtn").classList.toggle("hidden", !!A.meetingId);
    if (A.meetingId) A.renderEditor();
    else if (A.section === "overview") A.renderOverview();
    else if (A.section === "meetings") A.renderMeetings();
    else if (A.section !== "settings") A.renderSection();
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
      `<div class="ov-head"><span class="ov-icon">▱</span><div><h1>${e(project().name)}</h1><p>Meetings, tasks and field notes in one place.</p><button class="link-btn" id="renameProject">Rename project</button>${A.project !== "inbox" ? '<button class="link-btn" id="deleteProject">Delete project</button>' : ""}</div></div><div class="ov-stats">${stat("blue", "▣", "Meetings", ms.length, "Total project meetings", "meetings")}${stat("amber", "✓", "Open actions", open.length, ts.length - open.length + " completed", "tasks")}${stat("green", "▧", "Field photos", photos.length, "Meeting and field-note photos", "field")}</div><div class="ov-grid"><section class="ov-card"><div class="ov-card-head"><h2>Recent meetings</h2><button class="link-btn" data-go="meetings">View all →</button></div>${
        ms
          .slice(0, 5)
          .map(
            (m) =>
              `<button class="calendar-entry" data-open="${e(m.id)}"><span>${e(date(m.date))}</span><strong>${e(m.title || "Untitled meeting")}</strong><small>${m.summary ? "Recap ready" : "No recap"}</small></button>`,
          )
          .join("") || empty("No meetings yet.")
      }<button class="primary" data-new>+ New meeting</button></section><div class="ov-col side"><section class="ov-card"><h2>Next actions</h2>${
        open
          .slice(0, 5)
          .map(
            (t) =>
              `<label class="act"><input type="checkbox" data-task-status="${e(t.id)}"><span>${e(t.title)}<small>${e(t.due || "No due date")}</small></span></label>`,
          )
          .join("") || empty("No open action items.")
      }<button class="link-btn" data-go="tasks">View tasks →</button></section><section class="ov-card"><h2>Latest field photos</h2><div class="shots">${photos
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
            m.transcript,
            m.location,
            ...m.stakeholders.map((p) => p.name),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
        .sort((a, b) => b.updated - a.updated);
    $("meetingsHead").innerHTML = head(
      "Meetings",
      "All meetings in this project.",
    );
    $("meetingCount").textContent = ms.length + " meetings";
    $("meetingList").innerHTML =
      ms
        .map(
          (m) =>
            `<article class="meeting-card"><button class="card-main" data-open="${e(m.id)}"><span class="meeting-date">${e(date(m.date))}</span><span class="meeting-info"><strong>${e(m.title || "Untitled meeting")}</strong><small>${e(m.location)}</small></span></button><button class="delete-btn" data-delete-meeting="${e(m.id)}" aria-label="Delete meeting">×</button></article>`,
        )
        .join("") || empty("No matching meetings.");
  };
  A.renderEditor = (full = true) => {
    const m = A.current();
    if (!m) return;
    if (full) {
      $("titleInput").value = m.title;
      $("dateInput").value = m.date;
      $("locationInput").value = m.location;
      $("noteInput").value = m.note;
      $("transcriptInput").value = m.transcript;
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
      ? A.sanitize(m.summary)
      : "<p>No recap yet. Generate one when the meeting ends.</p>";
    $("recapKind").textContent =
      m.summaryType === "quick"
        ? "Offline draft · not an AI model"
        : m.summaryType === "ai"
          ? "AI recap"
          : m.summary
            ? "Saved recap"
            : "";
    $("meetingCloudAudioEnabled").checked = m.cloudAudioAllowed;
    const audio = $("audioPlayback");
    if (audio.dataset.media !== m.audioId) {
      audio.dataset.media = m.audioId;
      audio.removeAttribute("src");
      audio.hidden = !m.audioId;
      ZMinutesStore.mediaURL(m.audioId).then((url) => {
        if (audio.dataset.media === m.audioId && url) {
          audio.src = url;
          audio.hidden = false;
        }
      });
    }
    $("downloadAudioBtn").disabled = $("transcribeAgainBtn").disabled =
      !m.audioId;
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
        `<section class="ov-card task-create"><h2>Add a task</h2><form id="taskForm" class="task-form"><input id="taskTitle" required placeholder="What needs to be done?" value="${e(d.title || "")}"><input id="taskDue" type="date" value="${e(d.due || A.day)}"><select id="taskMeeting"><option value="">No linked meeting</option>${meetings()
          .map(
            (m) =>
              `<option value="${e(m.id)}" ${d.meetingId === m.id ? "selected" : ""}>${e(m.title)}</option>`,
          )
          .join(
            "",
          )}</select><button class="primary">+ Add task</button></form></section><section class="ov-card">${ts.map((t) => `<article class="task-card"><span class="signal ${light(t)}" title="${label(t)}"></span><div><strong>${e(t.title)}</strong><small>${label(t)} · ${e(t.due || "No due date")}${t.meetingId ? " · " + e(A.data.meetings.find((m) => m.id === t.meetingId)?.title || "Unlinked meeting") : ""}</small><details class="task-edit"><summary>Edit</summary><form data-task-edit="${e(t.id)}"><input name="title" required value="${e(t.title)}" aria-label="Task title"><input name="due" type="date" value="${e(t.due)}"><button class="secondary">Save changes</button></form></details></div><select data-task-status="${e(t.id)}" aria-label="Task status"><option value="in-progress" ${t.status !== "done" ? "selected" : ""}>In progress</option><option value="done" ${t.status === "done" ? "selected" : ""}>Completed</option></select><button class="mini-delete" data-delete-task="${e(t.id)}" aria-label="Delete task">×</button></article>`).join("") || empty("No tasks yet.")}</section>`;
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
        }<button id="icsBtn" class="link-btn">Export calendar (.ics)</button></div></section>`;
      $("icsBtn").onclick = () => A.exports.calendar();
    } else if (A.section === "field") {
      const d = A.drafts.field || {},
        fs = A.data.fieldNotes.filter((f) => f.projectId === A.project),
        photos = meetings().flatMap((m) =>
          m.photos.map((p) => ({ ...p, meetingId: m.id, title: m.title })),
        );
      box.innerHTML =
        head("Field notes", "Site observations and meeting photos.") +
        `<section class="ov-card field-create"><h2>${d.id ? "Edit field note" : "New field note"}</h2><form id="fieldForm" class="field-form"><input id="fieldTitle" required placeholder="Observation title" value="${e(d.title || "")}"><input id="fieldLocation" placeholder="Location" value="${e(d.location || "")}"><textarea id="fieldText" placeholder="Observation and follow-up">${e(d.text || "")}</textarea><div class="field-photo-actions"><label class="field-upload">Take photo<input id="fieldCameraPhotos" type="file" accept="image/*" capture="environment" hidden></label><label class="field-upload">Choose from device<input id="fieldPhotos" type="file" accept="image/*" multiple hidden></label></div><div class="field-preview">${(d.photos || []).map((p) => `<img data-media="${e(p.mediaId)}" alt="Selected photo">`).join("")}</div><button class="primary">Save field note</button></form></section><section class="ov-card"><h2>Saved field notes</h2>${fs.map((f) => `<article class="field-card"><h3>${e(f.title)}</h3><p>${e(f.location)}</p><div class="field-text">${e(f.text)}</div><div class="field-card-photos">${f.photos.map((p) => `<img data-media="${e(p.mediaId)}" alt="${e(p.note || f.title)}">`).join("")}</div><button class="link-btn" data-edit-field="${e(f.id)}">Edit</button><button class="mini-delete" data-delete-field="${e(f.id)}" aria-label="Delete field note">×</button></article>`).join("") || empty("No standalone notes yet.")}<h2>Meeting photos</h2><div class="tiles">${photos.map((p) => `<button class="tile" data-open="${e(p.meetingId)}" data-tab="field"><img data-media="${e(p.mediaId)}" alt="${e(p.note || p.title)}"><span class="tile-cap">${e(p.note || p.title)}</span></button>`).join("")}</div></section>`;
    } else if (A.section === "files") {
      const files = [
        ...A.data.files.filter((f) => f.projectId === A.project),
        ...A.projectPhotos().map((p) => ({
          mediaId: p.mediaId,
          title: p.note || p.title || "Photo",
          type: "Image",
        })),
        ...meetings()
          .filter((m) => m.audioId)
          .map((m) => ({
            mediaId: m.audioId,
            title: m.title + " — audio",
            type: "Recording (local)",
          })),
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
