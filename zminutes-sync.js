/* Append-only Drive changes: concurrent devices never replace a shared snapshot. */
(() => {
  const A = ZM,
    S = ZMinutesStore,
    $ = A.$,
    CLIENT = "zminutes-drive-client-id";
  let token = "",
    folder = "",
    syncing = false,
    gis,
    timer;
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
            folder = "";
            resolve();
          }
        },
      });
      c.requestAccessToken();
    });
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
  async function upload(bundle) {
    const batch = crypto.randomUUID(),
      boundary = "zm_" + batch,
      metadata = {
        name: "zminutes-changes-" + batch + ".json",
        mimeType: "application/json",
        parents: [await getFolder()],
        appProperties: { zminutes: "changes-v2" },
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
  const hash = async (s) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  async function legacyBundle(raw, file) {
    const data = ZMinutesModel.validateBackup(raw),
      ops = [],
      media = {};
    data.tasks = ZMinutesModel.legacyTasks(data.meetings, data.tasks);
    for (const kind of ["projects", "meetings", "tasks", "fieldNotes"])
      for (const record of data[kind]) {
        const value = ZMinutesModel.publicValue(kind, record);
        for (const p of value.photos || []) {
          if (p.data?.startsWith("data:image/")) {
            p.mediaId = "legacy-image-" + (await hash(p.data));
            media[p.mediaId] = { name: "Imported field photo", data: p.data };
          }
          delete p.data;
        }
        const id =
          "legacy-" +
          file.id +
          "-" +
          (await hash(kind + JSON.stringify(value)));
        ops.push({ id, kind, entityId: value.id, parents: [], value });
      }
    return { app: "zMinutes", format: "changes-v2", ops, media };
  }
  async function sync(manual = true) {
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
      if (!token) await authorize();
      const seen = new Set((await S.get("meta", "drive-seen-v2")) || []),
        bundles = [],
        received = [];
      const files = await list(
        "trashed=false and appProperties has { key='zminutes' and value='changes-v2' }",
      );
      for (const f of files)
        if (!seen.has(f.id)) {
          bundles.push(await api("drive/v3/files/" + f.id + "?alt=media"));
          received.push(f.id);
        }
      for (const f of await list(
        "trashed=false and name='zminutes-sync.json'",
      )) {
        const key = "legacy:" + f.id + ":" + f.modifiedTime;
        if (!seen.has(key)) {
          bundles.push(
            await legacyBundle(
              await api("drive/v3/files/" + f.id + "?alt=media"),
              f,
            ),
          );
          received.push(key);
        }
      }
      if (A.recording || A.aiBusy) {
        status("Sync paused until recording / AI finishes");
        return;
      }
      if (bundles.length) {
        await A.flush();
        document.querySelector(".app").inert = true;
        try {
          await S.merge(bundles);
          await A.reload();
          received.forEach((id) => seen.add(id));
          await S.meta("drive-seen-v2", [...seen]);
        } finally {
          document.querySelector(".app").inert = false;
        }
      }
      const pending = await S.pending();
      for (let i = 0; i < pending.length; i += 30) {
        const batch = pending.slice(i, i + 30),
          payload = await S.bundle(batch);
        if (payload.ops.length) {
          const uploaded = await upload(payload);
          seen.add(uploaded.id);
        }
        await S.acknowledge(batch.map((o) => o.id));
        await S.meta("drive-seen-v2", [...seen]);
      }
      status(
        (await S.pending()).length
          ? "New changes are waiting for sync"
          : "Synced · " + new Date().toLocaleTimeString(),
      );
      await A.renderConflicts();
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
      await loadGIS();
      status("Ready · tap Sync now");
    });
  $("syncBtn").onclick = $("syncSettingsBtn").onclick = () => sync();
  window.addEventListener("zminutes:datachange", () => {
    if (syncing) return;
    clearTimeout(timer);
    status("Local changes · waiting to sync");
    if (token) timer = setTimeout(() => sync(false), 3000);
  });
  window.addEventListener("online", () => {
    if (token) sync(false);
  });
  window.addEventListener("zminutes:ready", () => {
    A.run(async () =>
      status(
        (await S.pending()).length
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
  A.sync = { sync, legacyBundle };
})();
