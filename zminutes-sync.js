/* Append-only Drive changes: concurrent devices never replace a shared snapshot. */
(() => {
  const A = ZM,
    S = ZMinutesStore,
    $ = A.$,
    CLIENT = "zminutes-drive-client-id";
  let token = "",
    authorizedClient = "",
    folder = "",
    syncing = false,
    gis;
  const status = (s) => {
    $("syncState").textContent = s;
    $("driveStatus").textContent = s;
  };
  try {
    $("driveClientId").value = localStorage.getItem(CLIENT) || "";
  } catch {}
  async function loadGIS() {
    if (window.google?.accounts?.oauth2) return;
    if (gis) return gis;
    gis = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      const timer = setTimeout(
        () =>
          reject(
            new Error("Google sign-in did not load. Check your connection."),
          ),
        15000,
      );
      s.onload = () => {
        clearTimeout(timer);
        window.google?.accounts?.oauth2
          ? resolve()
          : reject(new Error("Google sign-in unavailable"));
      };
      s.onerror = () => {
        clearTimeout(timer);
        s.remove();
        reject(new Error("Could not load Google sign-in"));
      };
      document.head.append(s);
    }).catch((e) => {
      gis = null;
      throw e;
    });
    return gis;
  }
  async function authorize() {
    if (!window.google?.accounts?.oauth2) {
      await loadGIS();
      throw new Error(
        "Google sign-in is ready. Tap Sync now again to open it.",
      );
    }
    const client = $("driveClientId").value.trim();
    if (!client.endsWith(".apps.googleusercontent.com"))
      throw new Error("Save your Google OAuth Client ID in Settings first.");
    await new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
          expired = true;
          reject(new Error("Sign-in timed out"));
        }, 60000),
        finish = (e) => {
          clearTimeout(timer);
          reject(new Error(e.message || e.type || "Sign-in canceled"));
        };
      const c = google.accounts.oauth2.initTokenClient({
        client_id: client,
        scope: "https://www.googleapis.com/auth/drive.file",
        error_callback: finish,
        callback: (r) => {
          clearTimeout(timer);
          if (expired) return;
          if (r.error) reject(new Error(r.error_description || r.error));
          else {
            token = r.access_token;
            authorizedClient = client;
            folder = "";
            resolve();
          }
        },
      });
      c.requestAccessToken();
    });
  }
  async function ensureAuthorized() {
    if (token && authorizedClient === $("driveClientId").value.trim()) return;
    token = "";
    authorizedClient = "";
    await authorize();
  }
  async function api(path, options = {}) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 45000);
    try {
      const r = await fetch("https://www.googleapis.com/" + path, {
        ...options,
        signal: controller.signal,
        headers: { ...options.headers, Authorization: "Bearer " + token },
      });
      if (!r.ok) {
        if (r.status === 401) {
          token = "";
          authorizedClient = "";
          throw new Error("Google session expired. Tap Sync now to reconnect.");
        }
        throw new Error("Drive returned " + r.status);
      }
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }
  async function list(q) {
    const files = [];
    let page = "";
    do {
      const d = await api(
        "drive/v3/files?" +
          new URLSearchParams({
            q,
            fields: "nextPageToken,files(id,name,modifiedTime,appProperties)",
            pageSize: "1000",
            ...(page ? { pageToken: page } : {}),
          }),
      );
      files.push(...d.files);
      page = d.nextPageToken || "";
    } while (page);
    return files;
  }
  async function getFolder() {
    if (folder) return folder;
    const folders = await list(
      "name='zMinutes' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    );
    if (folders.length)
      return (folder = folders.sort((a, b) => a.id.localeCompare(b.id))[0].id);
    return (folder = (
      await api("drive/v3/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "zMinutes",
          mimeType: "application/vnd.google-apps.folder",
        }),
      })
    ).id);
  }
  async function upload(bundle, namespace = "changes-v3") {
    const batch = crypto.randomUUID(),
      boundary = "zm_" + batch,
      metadata = {
        name: "zminutes-changes-" + batch + ".json",
        mimeType: "application/json",
        parents: [await getFolder()],
        appProperties: { zminutes: namespace },
      },
      body = new Blob([
        "--" + boundary + "\r\nContent-Type: application/json\r\n\r\n",
        JSON.stringify(metadata),
        "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n",
        JSON.stringify(bundle),
        "\r\n--" + boundary + "--",
      ]);
    return api("upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body,
    });
  }
  async function verifyUpload(file, payload) {
    if (!file?.id) throw new Error("Drive did not return an upload ID.");
    const remote = await api("drive/v3/files/" + file.id + "?alt=media");
    if (JSON.stringify(remote) !== JSON.stringify(payload))
      throw new Error(
        "Drive upload verification failed. Local changes are still pending.",
      );
    for (let attempt = 0; attempt < 3; attempt++) {
      const visible = await list(
        "trashed=false and appProperties has { key='zminutes' and value='" + (payload.format === "notes-v1" ? "notes-v1" : "changes-v3") + "' }",
      );
      if (visible.some((item) => item.id === file.id)) return;
      if (attempt < 2)
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
    }
    throw new Error(
      "Drive saved changes but cannot list them yet. Local changes remain pending; retry Sync later.",
    );
  }
  async function sync(manual = true, initialize = false) {
    if (syncing) return;
    if (!A.ready) return;
    if (A.recording || A.aiBusy) {
      status("Sync paused until recording / AI finishes");
      return;
    }
    if (!navigator.onLine) {
      status("Offline · pending changes stay on this device");
      return;
    }
    syncing = true;
    try {
      await A.flush();
      status("Connecting to Drive…");
      await ensureAuthorized();
      const notesResult = await A.personal?.sync({list,api,upload,verifyUpload});
      const seen = new Set((await S.get("meta", "drive-seen-v3")) || []),
        bundles = [],
        received = [];
      const files = await list(
        "trashed=false and appProperties has { key='zminutes' and value='changes-v3' }",
      );
      $("newDriveHistory").hidden = true;
      for (const f of files)
        if (!seen.has(f.id)) {
          bundles.push(await api("drive/v3/files/" + f.id + "?alt=media"));
          received.push(f.id);
        }
      // A v1 snapshot is only inspected through Recovery. Importing it as if it
      // were an already-uploaded v2 change makes other devices miss its data.
      if (!files.length) {
        const legacyChanges = await list(
          "trashed=false and appProperties has { key='zminutes' and value='changes-v2' }",
        );
        if (legacyChanges.length && !(await S.get("meta", "drive-v3-cutover"))) {
          status("Upgrading Drive history to Notes v3…");
          const oldBundles = [];
          for (const item of legacyChanges)
            oldBundles.push(await api("drive/v3/files/" + item.id + "?alt=media"));
          await S.merge(oldBundles, "v2");
          await S.meta("drive-v2-cutover-files", legacyChanges.map((item) => item.id));
          await A.reload();
        }
        const local = await S.snapshot();
        const hasLocalWork =
          ["meetings", "tasks", "fieldNotes"].some(
            (kind) => local[kind].length,
          ) || local.projects.some((project) => project.id !== "inbox");
        const legacy = await list(
          "trashed=false and name='zminutes-sync.json'",
        );
        if (!legacyChanges.length && legacy.length && !initialize) {
          $("newDriveHistory").hidden = !hasLocalWork;
          status(
            "Sync paused · old Drive snapshot found. Inspect it in Recovery before starting a new history.",
          );
          return;
        }
        if (!legacyChanges.length && hasLocalWork && !initialize) {
          $("newDriveHistory").hidden = false;
          status(
            "Sync paused · no Drive history visible. Check account and Client ID, or start a new history in Settings.",
          );
          return;
        }
      }
      if (!(await S.get("meta", "drive-v3-cutover"))) {
        await A.flush();
        await S.cutoverV3();
        await A.reload();
      }
      if (A.recording || A.aiBusy) {
        status("Sync paused until recording / AI finishes");
        return;
      }
      if (bundles.length) {
        await A.flush();
        document.querySelector(".app").inert = true;
        try {
          await S.merge(bundles, "v3");
          await S.acknowledge(
            bundles.flatMap((bundle) => bundle.ops.map((op) => op.id)),
          );
          await A.reload();
          received.forEach((id) => seen.add(id));
          await S.meta("drive-seen-v3", [...seen]);
        } finally {
          document.querySelector(".app").inert = false;
        }
      }
      const pending = await S.pendingV3();
      if (
        !files.length &&
        !bundles.length &&
        !pending.some((op) => op.kind !== "projects" || op.entityId !== "inbox")
      ) {
        status(
          notesResult?.hasNotes ? (notesResult.conflicts ? "Notes synced · review Notes conflicts" : "Notes synced · no meeting data on Drive") : "No Drive data found. Check the Google account and Client ID before adding meetings.",
        );
        return;
      }
      for (let i = 0; i < pending.length; i += 30) {
        const batch = pending.slice(i, i + 30),
          payload = await S.bundle(batch, "v3");
        if (payload.ops.length) {
          const uploaded = await upload(payload);
          status("Verifying Drive upload…");
          await verifyUpload(uploaded, payload);
          seen.add(uploaded.id);
        }
        await S.acknowledge(batch.map((o) => o.id));
        await S.meta("drive-seen-v3", [...seen]);
      }
      await A.renderConflicts();
      status(
        notesResult?.conflicts ? "Notes sync conflicts · review Personal Notes" : A.conflicts.length
          ? `${A.conflicts.length} sync conflict(s) · review Settings before editing those items`
          : (await S.pendingV3()).length
            ? "New changes are waiting for sync"
            : "Synced · " + new Date().toLocaleTimeString(),
      );
    } catch (e) {
      console.error(e);
      status("Sync needs attention · " + e.message);
      if (manual) A.notice(e.message, true);
    } finally {
      syncing = false;
    }
  }
  $("saveDriveClientBtn").onclick = () =>
    A.run(async () => {
      const id = $("driveClientId").value.trim();
      if (!id.endsWith(".apps.googleusercontent.com"))
        throw new Error("Use an OAuth Web Client ID, not an API key.");
      localStorage.setItem(CLIENT, id);
      token = "";
      authorizedClient = "";
      folder = "";
      $("newDriveHistory").hidden = true;
      await loadGIS();
      status("Ready · tap Sync now");
    });
  $("syncBtn").onclick = $("syncSettingsBtn").onclick = () => sync();
  $("startDriveHistoryBtn").onclick = () => sync(true, true);
  window.addEventListener("zminutes:datachange", () => {
    if (syncing) return;
    status("Local changes · tap Sync now");
  });
  window.addEventListener("zminutes:ready", () => {
    A.run(async () =>
      status(
        ((await S.get("meta", "drive-v3-cutover")) ? (await S.pendingV3()).length : (await S.pending()).length)
          ? "Local changes · tap Sync now"
          : "Saved on this device",
      ),
    );
    if ($("driveClientId").value && navigator.onLine) loadGIS().catch(() => {});
  });
  $("backupBtn").onclick = () =>
    A.run(async () => {
      await A.flush();
      A.download(
        new Blob([JSON.stringify(await S.portable())], {
          type: "application/json",
        }),
        "zMinutes-backup-" + A.today() + ".json",
      );
    });
  $("restoreBtn").onclick = () => $("restoreInput").click();
  $("restoreInput").onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    A.run(async () => {
      if (A.recording || A.aiBusy)
        throw new Error("Finish recording and AI requests before restoring.");
      const raw = JSON.parse(await file.text());
      ZMinutesModel.validateBackup(raw);
      window.ZMinutesPersonalStore?.validate(raw);
      if (
        !confirm(
          "Replace this device’s data with the backup? Current data will be downloaded first.",
        )
      )
        return;
      await A.flush();
      A.download(
        new Blob([JSON.stringify(await S.portable())], {
          type: "application/json",
        }),
        "zMinutes-before-restore-" + Date.now() + ".json",
      );
      document.querySelector(".app").inert = true;
      try {
        await S.restore(raw);
        await A.reload();
        A.notice("Backup restored.");
      } finally {
        document.querySelector(".app").inert = false;
      }
    });
  };
  A.sync = {
    sync,
    list,
    api,
    prepareRecovery: ensureAuthorized,
  };
})();
