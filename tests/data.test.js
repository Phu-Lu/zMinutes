const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { IDBFactory, IDBKeyRange } = require("fake-indexeddb"),
  M = require("../zminutes-model");
function repository(initial = {}, db = new IDBFactory()) {
  const values = new Map(Object.entries(initial)),
    scope = {
      ZMinutesModel: M,
      indexedDB: db,
      IDBKeyRange,
      crypto: require("node:crypto").webcrypto,
      Blob,
      URL,
      fetch,
      Uint8Array,
      Event,
      console,
      navigator: {},
      localStorage: { getItem: (k) => values.get(k) || null },
      dispatchEvent() {},
      FileReader: class {
        readAsDataURL(blob) {
          blob.arrayBuffer().then((b) => {
            this.result =
              "data:" +
              blob.type +
              ";base64," +
              Buffer.from(b).toString("base64");
            this.onload();
          });
        }
      },
    };
  scope.window = scope;
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../zminutes-repository.js"), "utf8"),
    scope,
  );
  return { store: scope.ZMinutesStore, db, values };
}
const change = (id, parents, title, value = true) => ({
  id,
  kind: "meetings",
  entityId: "meeting",
  parents,
  value: value ? M.normalize("meetings", { id: "meeting", title }) : null,
});
test("concurrent edits preserve both versions, order independent, retries idempotent", () => {
  const base = change("base", [], "Base"),
    a = change("a", ["base"], "PC"),
    b = change("b", ["base"], "Phone");
  const result = M.reduce([base, a, b, a]);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(M.reduce([b, a, base]), result);
  assert.equal(
    M.reduce([base, a, b, change("resolve", ["a", "b"], "Chosen")]).conflicts
      .length,
    0,
  );
});
test("delete tombstones do not resurrect; concurrent edits remain recoverable", () => {
  const base = change("base", [], "Base"),
    deleted = change("delete", ["base"], "", false);
  assert.equal(Object.keys(M.reduce([deleted, base]).entities).length, 0);
  const r = M.reduce([deleted, base, change("edit", ["base"], "Offline edit")]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.entities["meetings:meeting"].value.title, "Offline edit");
});
test("migration preserves media and is idempotent; legacy action becomes one linked task", async () => {
  const { store: S, values } = repository({
    "meeting-note-data": JSON.stringify([
      {
        id: "meeting",
        title: "Tiếng Việt",
        note: "✓ ACTION ITEM: Follow up",
        audio: "data:audio/wav;base64,AAAA",
        photos: [{ id: "p", data: "data:image/png;base64,AAAA" }],
      },
    ]),
  });
  await S.init();
  const first = await S.snapshot();
  assert.equal(first.meetings[0].title, "Tiếng Việt");
  assert.ok(first.meetings[0].audioId);
  assert.equal(first.meetings[0].audio, undefined);
  assert.equal(first.tasks.length, 1);
  assert.equal((await S.all("media")).length, 2);
  assert.ok(values.has("meeting-note-data"));
  await S.init();
  assert.equal((await S.snapshot()).tasks.length, 1);
  assert.equal((await S.all("media")).length, 2);
});
test("outbox and task survive repository reopen; acknowledgement removes only uploaded changes", async () => {
  const { store: S, db } = repository();
  await S.init();
  await S.put("tasks", { id: "task", title: "Persist me" });
  const before = await S.pending();
  const { store: T } = repository({}, db);
  await T.init();
  assert.equal((await T.snapshot()).tasks[0].title, "Persist me");
  assert.equal((await T.pending()).length, before.length);
  await T.put("tasks", { id: "task", title: "Newer" });
  await T.acknowledge(before.map((o) => o.id));
  assert.equal((await T.pending()).length, 1);
});
test("remote changes retain local audio and conflict versions", async () => {
  const { store: S } = repository();
  await S.init();
  await S.put("meetings", {
    id: "meeting",
    title: "PC",
    audioId: "local-audio",
  });
  const base = (await S.all("journal")).find((o) => o.entityId === "meeting");
  await S.merge([
    {
      app: "zMinutes",
      format: "changes-v2",
      ops: [change("remote", [base.id], "Phone")],
      media: {},
    },
  ]);
  const m = (await S.snapshot()).meetings[0];
  assert.equal(m.audioId, "local-audio");
  assert.equal(m.title, "Phone");
});
test("concurrent remote change cannot silently hide this device's meeting", async () => {
  const { store: S } = repository();
  await S.init();
  await S.put("meetings", {
    id: "meeting",
    title: "Phone meeting",
    note: "Unsynced field notes",
  });
  await S.merge([
    {
      app: "zMinutes",
      format: "changes-v2",
      ops: [change("0000-remote", [], "Older PC copy")],
      media: {},
    },
  ]);
  const meeting = (await S.snapshot()).meetings[0];
  assert.equal(meeting.title, "Phone meeting");
  assert.equal(meeting.note, "Unsynced field notes");
  assert.equal(M.reduce(await S.all("journal")).conflicts.length, 1);
});
test("legacy records mistakenly marked uploaded are queued once for v2 publishing", async () => {
  const { store: S } = repository();
  await S.init();
  await S.merge([
    {
      app: "zMinutes",
      format: "changes-v2",
      ops: [change("legacy-old-file-meeting", [], "Migrated meeting")],
      media: {},
    },
  ]);
  assert.equal(await S.republishLegacy(), 1);
  assert.equal(
    (await S.pending()).filter((op) => op.id.startsWith("legacy-")).length,
    1,
  );
  assert.equal(await S.republishLegacy(), 0);
  await S.acknowledge(["legacy-old-file-meeting"]);
  assert.equal(await S.republishLegacy(), 0);
});
test("a meeting remains visible when its project disappears", async () => {
  const { store: S } = repository();
  await S.init();
  await S.put("projects", { id: "site", name: "Site" });
  await S.put("meetings", {
    id: "meeting",
    projectId: "site",
    title: "Keep visible",
  });
  await S.remove("projects", "site");
  const snapshot = await S.snapshot();
  assert.equal(snapshot.meetings[0].projectId, "inbox");
  assert.equal(snapshot.meetings[0].title, "Keep visible");
  assert.equal(
    (await S.get("entities", "meetings:meeting")).value.projectId,
    "site",
  );
});
test("multiple recordings survive backup/restore; missing-only recovery does not overwrite", async () => {
  const { store: S } = repository();
  await S.init();
  const first = await S.addMedia(
    new Blob(["first"], { type: "audio/wav" }),
    "first.wav",
  );
  const second = await S.addMedia(
    new Blob(["second"], { type: "audio/wav" }),
    "second.wav",
  );
  await S.put("meetings", {
    id: "meeting",
    title: "Current",
    audioId: second,
    recordings: [
      { id: "clip-1", audioId: first, label: "First" },
      { id: "clip-2", audioId: second, label: "Second" },
    ],
    transcriptSegments: [
      { id: "segment-2", recordingId: "clip-2", text: "Second words" },
      { id: "segment-1", recordingId: "clip-1", text: "First words" },
    ],
  });
  const backup = await S.portable();
  assert.equal(backup.meetings[0].recordings.length, 2);
  assert.ok(
    backup.meetings[0].recordings.every((r) =>
      r.data?.startsWith("data:audio/"),
    ),
  );
  assert.match(
    M.fullTranscript(backup.meetings[0]),
    /First words[\s\S]*Second words/,
  );
  const { store: T } = repository();
  await T.init();
  await T.restore(backup);
  assert.equal((await T.snapshot()).meetings[0].recordings.length, 2);
  assert.equal((await T.all("media")).length, 2);
  await T.put("meetings", {
    ...(await T.snapshot()).meetings[0],
    title: "Keep current",
  });
  assert.equal(await T.importMissing(backup), 0);
  assert.equal((await T.snapshot()).meetings[0].title, "Keep current");
  assert.equal(
    await T.importMissing({
      ...backup,
      meetings: [...backup.meetings, { id: "lost", title: "Recovered" }],
    }),
    1,
  );
  assert.equal(
    (await T.snapshot()).meetings.find((m) => m.id === "lost").title,
    "Recovered",
  );
});
test("invalid restore leaves all records unchanged", async () => {
  const { store: S } = repository();
  await S.init();
  await S.put("tasks", { id: "t", title: "Keep" });
  const before = JSON.stringify(await S.snapshot());
  await assert.rejects(() =>
    S.restore({ app: "zMinutes", meetings: [], projects: [null] }),
  );
  assert.equal(JSON.stringify(await S.snapshot()), before);
});
test("restore rolls back if an IndexedDB write fails mid-transaction", async () => {
  const { store: S } = repository();
  await S.init();
  await S.put("tasks", { id: "t", title: "Keep" });
  const before = JSON.stringify(await S.snapshot()),
    db = await S.open(),
    original = db.transaction.bind(db);
  db.transaction = (names, mode) => {
    const tx = original(names, mode);
    if (mode === "readwrite" && names.includes("journal")) {
      const store = tx.objectStore("journal");
      store.put = () => {
        throw new Error("Simulated quota failure");
      };
    }
    return tx;
  };
  await assert.rejects(() =>
    S.restore({
      app: "zMinutes",
      meetings: [],
      projects: [M.inbox()],
      tasks: [{ id: "other", title: "Replace" }],
    }),
  );
  db.transaction = original;
  assert.equal(JSON.stringify(await S.snapshot()), before);
});
test("recording checkpoints survive reload and can be removed after save", async () => {
  const { store: S, db } = repository();
  await S.init();
  await S.checkpoint(
    { id: "recording", meetingId: "m" },
    0,
    new Uint8Array([1, 2]),
  );
  const { store: T } = repository({}, db);
  assert.equal((await T.all("chunks"))[0].bytes.length, 2);
  await T.discardSession("recording");
  assert.equal((await T.all("chunks")).length, 0);
});
test("a stale tab write preserves unseen conflict heads", async () => {
  const { store: S } = repository();
  await S.init();
  await S.put("meetings", { id: "m", title: "Base" });
  const base = (await S.get("entities", "meetings:m")).heads;
  await S.put("meetings", { id: "m", title: "Tab A" }, base);
  await S.put("meetings", { id: "m", title: "Tab B" }, base);
  assert.equal((await S.get("entities", "meetings:m")).heads.length, 2);
  assert.equal(M.reduce(await S.all("journal")).conflicts.length, 1);
});
test("malformed remote values cannot become silent deletions", async () => {
  const { store: S } = repository();
  await S.init();
  await S.put("meetings", { id: "meeting", title: "Keep" });
  await assert.rejects(() =>
    S.merge([
      {
        app: "zMinutes",
        format: "changes-v2",
        ops: [
          { id: "bad", kind: "meetings", entityId: "meeting", parents: [] },
        ],
      },
    ]),
  );
  assert.equal((await S.snapshot()).meetings[0].title, "Keep");
});
