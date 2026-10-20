/* Personal Notes use separate entity/journal stores and a separate Drive namespace. */
(() => {
  const S = ZMinutesStore,
    M = ZMinutesModel;
  const key = (id) => M.key("notes", id);
  const normalize = (value) => M.normalize("notes", value);
  const all = () => S.all("personalNotes");
  const journal = () => S.all("personalJournal");
  async function save(value, parents) {
    return S.serial(async () => {
      value = value && normalize(value);
      const id = value.id,
        old = await S.get("personalNotes", id);
      const op = {
        id: crypto.randomUUID(),
        kind: "notes",
        entityId: id,
        parents: parents || old?.heads || [],
        value: M.publicValue("notes", value),
        uploaded: false,
      };
      const row = {
        id,
        value,
        heads: [
          ...(old?.heads || []).filter((h) => !op.parents.includes(h)),
          op.id,
        ],
      };
      await S.transaction(["personalNotes", "personalJournal"], (tx) => {
        tx.objectStore("personalNotes").put(row, id);
        tx.objectStore("personalJournal").put(op, op.id);
      });
      window.dispatchEvent(new Event("zminutes:datachange"));
      return row;
    });
  }
  async function remove(id) {
    return S.serial(async () => {
      const old = await S.get("personalNotes", id);
      const op = {
        id: crypto.randomUUID(),
        kind: "notes",
        entityId: id,
        parents: old?.heads || [],
        value: null,
        uploaded: false,
      };
      await S.transaction(["personalNotes", "personalJournal"], (tx) => {
        tx.objectStore("personalNotes").put(
          { id, value: null, heads: [op.id] },
          id,
        );
        tx.objectStore("personalJournal").put(op, op.id);
      });
      window.dispatchEvent(new Event("zminutes:datachange"));
    });
  }
  async function merge(bundles) {
    const media = [];
    for (const b of bundles) {
      if (
        b?.app !== "zMinutes" ||
        b.format !== "notes-v1" ||
        !Array.isArray(b.ops) ||
        b.ops.some((o) => o.kind !== "notes")
      )
        throw new Error("Invalid Notes sync bundle");
      M.reduce(b.ops);
      for (const [id, item] of Object.entries(b.media || {})) {
        if (!item.data?.startsWith("data:image/"))
          throw new Error("Notes sync accepts images only");
        media.push({
          id,
          name: item.name,
          blob: await (await fetch(item.data)).blob(),
        });
      }
    }
    return S.serial(async () => {
      const known = await journal(),
        byId = new Map(known.map((o) => [o.id, o]));
      M.reduce([...known, ...bundles.flatMap((b) => b.ops)]);
      for (const b of bundles)
        for (const op of b.ops)
          if (!byId.has(op.id)) byId.set(op.id, { ...op, uploaded: true });
      const reduced = M.reduce([...byId.values()]),
        old = await all();
      await S.transaction(
        ["personalNotes", "personalJournal", "media"],
        (tx) => {
          for (const item of media) tx.objectStore("media").put(item, item.id);
          for (const op of byId.values())
            tx.objectStore("personalJournal").put(op, op.id);
          for (const [k, heads] of Object.entries(reduced.heads)) {
            const id = byId.get(heads[0]).entityId,
              prior = old.find((r) => r.id === id);
            let value =
              reduced.conflicts.some((c) => c.key === k) && prior?.value
                ? prior.value
                : reduced.entities[k]?.value || null;
            if (value)
              value = normalize({
                ...value,
                recordings: (value.recordings || []).map((r) => ({
                  ...r,
                  audioId:
                    prior?.value?.recordings.find((a) => a.id === r.id)
                      ?.audioId || "",
                })),
              });
            tx.objectStore("personalNotes").put({ id, value, heads }, id);
          }
        },
      );
      return reduced.conflicts;
    });
  }
  async function bundle(ops) {
    const media = {};
    for (const op of ops)
      for (const p of op.value?.photos || []) {
        const item = await S.get("media", p.mediaId);
        if (item)
          media[p.mediaId] = {
            name: item.name,
            data: await S.toDataURL(item.blob),
          };
        else
          throw new Error(
            "A Notes image is missing locally. Restore it before syncing.",
          );
      }
    return {
      app: "zMinutes",
      format: "notes-v1",
      ops: ops.map(({ uploaded, ...op }) => op),
      media,
    };
  }
  async function acknowledge(ids) {
    await S.serial(async () => {
      const ops = await journal();
      await S.transaction(["personalJournal"], (tx) => {
        for (const op of ops)
          if (ids.includes(op.id))
            tx.objectStore("personalJournal").put(
              { ...op, uploaded: true },
              op.id,
            );
      });
    });
  }
  async function portable() {
    const notes = (await all())
      .filter((r) => r.value)
      .map((r) => normalize(r.value));
    for (const n of notes) {
      for (const p of n.photos) {
        const m = await S.get("media", p.mediaId);
        if (m) p.data = await S.toDataURL(m.blob);
        delete p.mediaId;
      }
      for (const r of n.recordings) {
        const m = await S.get("media", r.audioId);
        if (m) r.data = await S.toDataURL(m.blob);
        delete r.audioId;
      }
    }
    return notes;
  }
  function validate(raw) {
    if (raw.notes === undefined) return null;
    if (raw.version !== 4 || !Array.isArray(raw.notes))
      throw new Error("Unsupported Notes backup");
    const notes = raw.notes.map(normalize);
    if (new Set(notes.map((n) => n.id)).size !== notes.length)
      throw new Error("Duplicate Notes IDs");
    for (const n of notes) {
      for (const p of n.photos)
        if (!p.data?.startsWith("data:image/"))
          throw new Error("Backup is missing a Notes image");
      for (const r of n.recordings)
        if (r.data && !r.data.startsWith("data:audio/"))
          throw new Error("Invalid Notes audio");
    }
    return notes;
  }
  async function prepareRestore(raw) {
    const notes = validate(raw);
    if (notes === null) return null;
    const media = [];
    for (let i = 0; i < notes.length; i++)
      notes[i] = await S.convert("notes", notes[i], media);
    return { notes, media };
  }
  async function restoreRows(prepared) {
    if (!prepared) return [];
    const old = await all(),
      incoming = new Map(prepared.notes.map((n) => [n.id, n]));
    for (const r of old) if (!incoming.has(r.id)) incoming.set(r.id, null);
    return [...incoming].map(([id, value]) => {
      const op = {
        id: crypto.randomUUID(),
        kind: "notes",
        entityId: id,
        parents: old.find((r) => r.id === id)?.heads || [],
        value: M.publicValue("notes", value),
        uploaded: false,
      };
      return { row: { id, value, heads: [op.id] }, op };
    });
  }
  window.ZMinutesPersonalStore = {
    all,
    journal,
    save,
    remove,
    merge,
    bundle,
    acknowledge,
    portable,
    validate,
    prepareRestore,
    restoreRows,
    pending: async () => (await journal()).filter((o) => !o.uploaded),
    conflicts: async () => M.reduce(await journal()).conflicts,
  };
})();
