/* Recovery is deliberately separate from Sync: inspection never uploads or replaces data. */
(() => {
  const A = ZM,
    S = ZMinutesStore,
    M = ZMinutesModel,
    $ = A.$;
  let versions = [],
    preview = null;
  const report = (message) => ($("recoveryStatus").textContent = message);
  const counts = (raw) => {
    const data = M.validateBackup(raw);
    return `${data.meetings.length} meetings, ${data.tasks.length} tasks, ${data.fieldNotes.length} field notes`;
  };
  const showPreview = (raw, source) => {
    const data = M.validateBackup(raw);
    preview = raw;
    const names = data.meetings.length
      ? `<details><summary>Show meeting names (${data.meetings.length})</summary><ul>${data.meetings
          .map(
            (meeting) =>
              `<li>${A.esc(meeting.title || "Untitled meeting")} · ${A.esc(meeting.date || "No date")}</li>`,
          )
          .join("")}</ul></details>`
      : "";
    $("dataRecoveryList").innerHTML =
      `<div class="file-row"><span>${A.esc(source)} · ${A.esc(counts(raw))}</span></div>` +
      names +
      '<div class="settings-actions"><button class="secondary" data-download-recovery>Download this copy</button><button class="primary" data-import-recovery>Recover missing items</button></div>';
    report("Preview ready. Existing items will remain untouched.");
  };
  async function scanLocal() {
    await A.flush();
    const current = await S.snapshot(),
      known = new Set(
        M.kinds.flatMap((kind) =>
          current[kind].map((row) => M.key(kind, row.id)),
        ),
      ),
      candidates = new Map();
    const consider = (kind, raw) => {
      if (!raw?.id || known.has(M.key(kind, raw.id))) return;
      try {
        const value = M.normalize(kind, raw),
          key = M.key(kind, value.id),
          previous = candidates.get(key);
        if (!previous || value.updated >= previous.updated)
          candidates.set(key, value);
      } catch {}
    };
    for (const op of await S.all("journal"))
      if (op.value) consider(op.kind, op.value);
    const oldKeys = {
      meetings: "meeting-note-data",
      projects: "zminutes-projects-v1",
      tasks: "zminutes-tasks-v1",
      fieldNotes: "zminutes-field-notes-v1",
    };
    for (const [kind, storageKey] of Object.entries(oldKeys)) {
      const saved = await S.get("records", kind);
      if (Array.isArray(saved)) for (const row of saved) consider(kind, row);
      try {
        const legacy = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (Array.isArray(legacy))
          for (const row of legacy) consider(kind, row);
      } catch {}
    }
    const backup = {
      app: "zMinutes",
      version: 2,
      projects: [...current.projects],
      meetings: [],
      tasks: [],
      fieldNotes: [],
      files: [],
    };
    for (const [key, value] of candidates) {
      const kind = key.split(":")[0];
      backup[kind].push(value);
    }
    if (
      !backup.meetings.length &&
      !backup.tasks.length &&
      !backup.fieldNotes.length
    ) {
      preview = null;
      $("dataRecoveryList").innerHTML = "";
      report(
        "No missing items found in this browser's local history. Try Drive versions or a downloaded backup.",
      );
      return;
    }
    showPreview(backup, "This device's saved history");
  }
  async function scanDrive() {
    preview = null;
    $("dataRecoveryList").innerHTML = "";
    report("Looking for earlier zMinutes Drive snapshots…");
    await A.sync.prepareRecovery();
    const files = await A.sync.list(
      "trashed=false and name='zminutes-sync.json'",
    );
    versions = [];
    for (const file of files) {
      versions.push({
        fileId: file.id,
        revisionId: null,
        modifiedTime: file.modifiedTime,
      });
      let page = "";
      do {
        const data = await A.sync.api(
          "drive/v3/files/" +
            encodeURIComponent(file.id) +
            "/revisions?" +
            new URLSearchParams({
              fields: "nextPageToken,revisions(id,modifiedTime)",
              pageSize: "1000",
              ...(page ? { pageToken: page } : {}),
            }),
        );
        versions.push(
          ...(data.revisions || []).map((revision) => ({
            fileId: file.id,
            revisionId: revision.id,
            modifiedTime: revision.modifiedTime,
          })),
        );
        page = data.nextPageToken || "";
      } while (page);
    }
    versions.sort((a, b) =>
      String(b.modifiedTime).localeCompare(String(a.modifiedTime)),
    );
    $("dataRecoveryList").innerHTML = versions
      .map(
        (v, i) =>
          `<div class="file-row"><span>${v.revisionId ? "Drive revision" : "Current Drive copy"} · ${A.esc(new Date(v.modifiedTime).toLocaleString())}</span><button class="secondary" data-preview-version="${i}">Preview</button></div>`,
      )
      .join("");
    report(
      versions.length
        ? `${versions.length} Drive versions found. Choose one from before the data disappeared.`
        : "No older zMinutes snapshot is visible to this Google account and OAuth Client ID. Check Drive directly for zminutes-sync.json or a downloaded backup.",
    );
  }
  $("scanLocalHistoryBtn").onclick = () => A.run(scanLocal);
  $("scanDriveHistoryBtn").onclick = () => A.run(scanDrive);
  $("dataRecoveryList").onclick = (event) =>
    A.run(async () => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.previewVersion !== undefined) {
        const v = versions[Number(button.dataset.previewVersion)];
        if (!v) throw new Error("Drive version not found");
        const raw = await A.sync.api(
          "drive/v3/files/" +
            encodeURIComponent(v.fileId) +
            (v.revisionId
              ? "/revisions/" + encodeURIComponent(v.revisionId)
              : "") +
            "?alt=media",
        );
        showPreview(raw, new Date(v.modifiedTime).toLocaleString());
      } else if (button.hasAttribute("data-download-recovery")) {
        if (!preview) return;
        A.download(
          new Blob([JSON.stringify(preview)], { type: "application/json" }),
          "zMinutes-recovered-copy-" + Date.now() + ".json",
        );
      } else if (button.hasAttribute("data-import-recovery")) {
        if (!preview) return;
        if (A.recording || A.aiBusy)
          throw new Error("Finish recording and AI requests before recovery.");
        await A.flush();
        A.download(
          new Blob([JSON.stringify(await S.portable())], {
            type: "application/json",
          }),
          "zMinutes-before-recovery-" + Date.now() + ".json",
        );
        const count = await S.importMissing(preview);
        await A.reload();
        report(
          `${count} missing items recovered. Existing items were kept. Download a backup before syncing again.`,
        );
        $("dataRecoveryList").innerHTML = "";
        preview = null;
      }
    });
})();
