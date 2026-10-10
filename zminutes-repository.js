/* Entity writes and durable outbox changes commit in the same transaction. */
(() => {
  const M = ZMinutesModel;
  let opening,
    tail = Promise.resolve();
  const urls = new Map();
  const req = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const done = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(tx.error || new Error("Local storage transaction failed"));
    });
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const r = indexedDB.open("zminutes-local", 2);
      r.onupgradeneeded = () => {
        for (const name of [
          "records",
          "entities",
          "journal",
          "media",
          "meta",
          "sessions",
          "chunks",
        ])
          if (!r.result.objectStoreNames.contains(name))
            r.result.createObjectStore(name);
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          opening = null;
        };
        resolve(r.result);
      };
      r.onerror = () => {
        opening = null;
        reject(r.error);
      };
      r.onblocked = () => {
        opening = null;
        reject(new Error("Close other zMinutes tabs and retry the update."));
      };
    });
    return opening;
  }
  async function get(store, key) {
    const db = await open();
    return req(db.transaction(store).objectStore(store).get(key));
  }
  async function all(store) {
    const db = await open();
    return req(db.transaction(store).objectStore(store).getAll());
  }
  function serial(fn) {
    const run = () =>
      navigator.locks ? navigator.locks.request("zminutes-storage", fn) : fn();
    const next = tail.then(run, run);
    tail = next.catch(() => {});
    return next;
  }
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("zminutes-data-v2")
      : null;
  function notify() {
    window.dispatchEvent(new Event("zminutes:datachange"));
    channel?.postMessage("changed");
  }
  if (channel)
    channel.onmessage = () =>
      window.dispatchEvent(new Event("zminutes:externalchange"));
  async function transaction(stores, write) {
    const db = await open(),
      tx = db.transaction(stores, "readwrite"),
      finished = done(tx);
    try {
      write(tx);
    } catch (e) {
      tx.abort();
      await finished.catch(() => {});
      throw e;
    }
    await finished;
  }
  const toDataURL = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  const mediaRecord = (blob, name = "Attachment") => ({
    id: crypto.randomUUID(),
    blob,
    name,
    type: blob.type,
    created: Date.now(),
  });
  async function convert(kind, raw, media) {
    const value = M.normalize(kind, raw);
    if (value.audio?.startsWith("data:audio/")) {
      const item = mediaRecord(
        await (await fetch(value.audio)).blob(),
        "Recording",
      );
      media.push(item);
      value.audioId = item.id;
    }
    delete value.audio;
    for (const p of value.photos || []) {
      if (p.data?.startsWith("data:image/")) {
        const item = mediaRecord(
          await (await fetch(p.data)).blob(),
          "Field photo",
        );
        media.push(item);
        p.mediaId = item.id;
      }
      delete p.data;
    }
    return value;
  }
  async function init() {
    await open();
    return serial(async () => {
      if (await get("meta", "migrated-v2")) return;
      const oldKeys = {
          meetings: "meeting-note-data",
          projects: "zminutes-projects-v1",
          tasks: "zminutes-tasks-v1",
          fieldNotes: "zminutes-field-notes-v1",
          files: "zminutes-files-v1",
        },
        data = { app: "zMinutes" },
        media = [];
      for (const kind of M.kinds) {
        const stored = await get("records", kind);
        let legacy = [];
        try {
          legacy = JSON.parse(localStorage.getItem(oldKeys[kind]) || "[]");
        } catch {}
        data[kind] = Array.isArray(stored)
          ? stored
          : Array.isArray(legacy)
            ? legacy
            : [];
        data[kind] = data[kind]
          .filter((r) => r && typeof r === "object")
          .map((r) => ({ ...r, id: r.id || crypto.randomUUID() }));
      }
      const normalized = M.validateBackup(data);
      normalized.tasks = M.legacyTasks(normalized.meetings, normalized.tasks);
      const converted = [];
      for (const kind of M.kinds)
        for (const r of normalized[kind])
          converted.push({ kind, value: await convert(kind, r, media) });
      await transaction(["entities", "journal", "meta", "media"], (tx) => {
        for (const item of media) tx.objectStore("media").put(item, item.id);
        for (const { kind, value } of converted) {
          const id = crypto.randomUUID(),
            key = M.key(kind, value.id);
          tx.objectStore("entities").put(
            { kind, id: value.id, value, heads: [id] },
            key,
          );
          tx.objectStore("journal").put(
            {
              id,
              kind,
              entityId: value.id,
              parents: [],
              value: M.publicValue(kind, value),
              uploaded: false,
            },
            id,
          );
        }
        tx.objectStore("meta").put(true, "migrated-v2");
      });
    });
  }
  async function snapshot() {
    const data = Object.fromEntries(M.kinds.map((k) => [k, []]));
    for (const r of await all("entities"))
      if (r.value) data[r.kind].push(r.value);
    if (!data.projects.some((p) => p.id === "inbox"))
      data.projects.unshift(M.inbox());
    return data;
  }
  async function put(kind, value, parents) {
    return serial(async () => {
      value = M.normalize(kind, value);
      const key = M.key(kind, value.id),
        old = await get("entities", key),
        id = crypto.randomUUID(),
        op = {
          id,
          kind,
          entityId: value.id,
          parents: parents || old?.heads || [],
          value: M.publicValue(kind, value),
          uploaded: false,
        };
      const heads = [
        ...(old?.heads || []).filter((h) => !op.parents.includes(h)),
        id,
      ];
      await transaction(["entities", "journal"], (tx) => {
        tx.objectStore("entities").put(
          { kind, id: value.id, value, heads },
          key,
        );
        tx.objectStore("journal").put(op, id);
      });
      notify();
      return value;
    });
  }
  async function remove(kind, id) {
    return serial(async () => {
      if (kind === "projects" && id === "inbox")
        throw new Error("Personal Workspace cannot be deleted");
      const old = await get("entities", M.key(kind, id)),
        op = {
          id: crypto.randomUUID(),
          kind,
          entityId: id,
          parents: old?.heads || [],
          value: null,
          uploaded: false,
        };
      await transaction(["entities", "journal"], (tx) => {
        tx.objectStore("entities").put(
          { kind, id, value: null, heads: [op.id] },
          M.key(kind, id),
        );
        tx.objectStore("journal").put(op, op.id);
      });
      notify();
    });
  }
  async function addMedia(blob, name) {
    const item = mediaRecord(blob, name);
    await transaction(["media"], (tx) =>
      tx.objectStore("media").put(item, item.id),
    );
    return item.id;
  }
  async function mediaURL(id) {
    if (!id) return "";
    if (urls.has(id)) return urls.get(id);
    const item = await get("media", id);
    if (!item) return "";
    const url = URL.createObjectURL(item.blob);
    urls.set(id, url);
    return url;
  }
  async function portable(includeAudio = true) {
    const data = await snapshot();
    for (const m of data.meetings) {
      if (includeAudio && m.audioId) {
        const a = await get("media", m.audioId);
        if (a) m.audio = await toDataURL(a.blob);
      }
      delete m.audioId;
    }
    for (const kind of ["meetings", "fieldNotes"])
      for (const r of data[kind])
        for (const p of r.photos || []) {
          const a = await get("media", p.mediaId);
          if (a) p.data = await toDataURL(a.blob);
          delete p.mediaId;
        }
    for (const f of data.files) {
      const a = await get("media", f.mediaId);
      if (a) f.data = await toDataURL(a.blob);
    }
    return { app: "zMinutes", version: 2, ...data };
  }
  async function restore(raw) {
    const data = M.validateBackup(raw),
      media = [];
    for (const kind of M.kinds)
      for (let i = 0; i < data[kind].length; i++) {
        data[kind][i] = await convert(kind, data[kind][i], media);
        if (kind === "files" && raw.files?.[i]?.data) {
          const item = mediaRecord(
            await (await fetch(raw.files[i].data)).blob(),
            data[kind][i].title,
          );
          media.push(item);
          data[kind][i].mediaId = item.id;
        }
      }
    return serial(async () => {
      const old = await all("entities"),
        ops = [],
        rows = [];
      for (const kind of M.kinds) {
        const incoming = new Map(data[kind].map((r) => [r.id, r]));
        for (const row of old.filter((r) => r.kind === kind))
          if (!incoming.has(row.id)) incoming.set(row.id, null);
        for (const [id, value] of incoming) {
          const prior = old.find((r) => r.kind === kind && r.id === id),
            op = {
              id: crypto.randomUUID(),
              kind,
              entityId: id,
              parents: prior?.heads || [],
              value: M.publicValue(kind, value),
              uploaded: false,
            };
          ops.push(op);
          rows.push({ kind, id, value, heads: [op.id] });
        }
      }
      await transaction(["entities", "journal", "media"], (tx) => {
        for (const item of media) tx.objectStore("media").put(item, item.id);
        for (const r of rows)
          tx.objectStore("entities").put(r, M.key(r.kind, r.id));
        for (const op of ops) tx.objectStore("journal").put(op, op.id);
      });
      notify();
    });
  }
  async function pending() {
    return (await all("journal")).filter((o) => !o.uploaded);
  }
  async function bundle(ops) {
    const media = {},
      ids = new Set();
    for (const op of ops)
      for (const p of op.value?.photos || []) if (p.mediaId) ids.add(p.mediaId);
    for (const id of ids) {
      const item = await get("media", id);
      if (item)
        media[id] = { name: item.name, data: await toDataURL(item.blob) };
    }
    return {
      app: "zMinutes",
      format: "changes-v2",
      ops: ops.filter((o) => o.kind !== "files").map(({ uploaded, ...o }) => o),
      media,
    };
  }
  async function acknowledge(ids) {
    return serial(async () => {
      const ops = await all("journal");
      await transaction(["journal"], (tx) => {
        for (const op of ops)
          if (ids.includes(op.id))
            tx.objectStore("journal").put({ ...op, uploaded: true }, op.id);
      });
    });
  }
  async function merge(bundles) {
    const media = [];
    for (const b of bundles) {
      if (
        b?.app !== "zMinutes" ||
        b.format !== "changes-v2" ||
        !Array.isArray(b.ops)
      )
        throw new Error("Invalid Drive changes");
      M.reduce(b.ops);
      for (const [id, m] of Object.entries(b.media || {})) {
        if (!m.data?.startsWith("data:image/"))
          throw new Error("Unsupported synced attachment");
        media.push({
          id,
          name: m.name,
          blob: await (await fetch(m.data)).blob(),
        });
      }
    }
    return serial(async () => {
      const known = await all("journal"),
        old = await all("entities"),
        byId = new Map(known.map((o) => [o.id, o]));
      for (const b of bundles)
        for (const o of b.ops) {
          if (o.kind === "files") throw new Error("File records are local");
          if (byId.has(o.id)) {
            M.reduce([byId.get(o.id), o]);
            continue;
          }
          byId.set(o.id, {
            ...o,
            value: M.publicValue(o.kind, o.value),
            uploaded: true,
          });
        }
      const reduced = M.reduce([...byId.values()]);
      await transaction(["entities", "journal", "media", "meta"], (tx) => {
        for (const item of media) tx.objectStore("media").put(item, item.id);
        for (const op of byId.values())
          tx.objectStore("journal").put(op, op.id);
        for (const [key, heads] of Object.entries(reduced.heads)) {
          const prior = old.find((r) => M.key(r.kind, r.id) === key),
            entry = reduced.entities[key],
            sample = byId.get(heads[0]),
            value = entry ? M.normalize(sample.kind, entry.value) : null;
          if (value && sample.kind === "meetings" && prior?.value?.audioId)
            value.audioId = prior.value.audioId;
          tx.objectStore("entities").put(
            { kind: sample.kind, id: sample.entityId, value, heads },
            key,
          );
        }
        tx.objectStore("meta").put(reduced.conflicts, "conflicts");
      });
      notify();
      return reduced.conflicts;
    });
  }
  async function checkpoint(session, index, bytes) {
    await transaction(["sessions", "chunks"], (tx) => {
      tx.objectStore("sessions").put(session, session.id);
      if (bytes)
        tx.objectStore("chunks").put({ sessionId: session.id, index, bytes }, [
          session.id,
          index,
        ]);
    });
  }
  async function discardSession(id) {
    await transaction(["sessions", "chunks"], (tx) => {
      tx.objectStore("sessions").delete(id);
      tx.objectStore("chunks").delete(
        IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
      );
    });
  }
  window.ZMinutesStore = {
    open,
    init,
    snapshot,
    put,
    remove,
    addMedia,
    mediaURL,
    portable,
    restore,
    pending,
    bundle,
    acknowledge,
    merge,
    get,
    all,
    toDataURL,
    convert,
    checkpoint,
    discardSession,
    flush: () => tail,
    meta: async (k, v) =>
      transaction(["meta"], (tx) => tx.objectStore("meta").put(v, k)),
  };
})();
