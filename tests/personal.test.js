const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { IDBFactory, IDBKeyRange } = require("fake-indexeddb");
function device() {
  const c = {
    ZMinutesModel: require("../zminutes-model"),
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    crypto: require("node:crypto").webcrypto,
    Blob,
    URL,
    fetch,
    Uint8Array,
    Event,
    console,
    navigator: {},
    localStorage: { getItem: () => null },
    dispatchEvent() {},
    FileReader: class {
      readAsDataURL(b) {
        b.arrayBuffer().then((v) => {
          this.result = `data:${b.type};base64,${Buffer.from(v).toString("base64")}`;
          this.onload();
        });
      }
    },
  };
  c.window = c;
  vm.createContext(c);
  for (const file of ["zminutes-repository.js", "zminutes-personal-store.js"])
    vm.runInContext(fs.readFileSync(require.resolve("../" + file), "utf8"), c);
  return { S: c.ZMinutesStore, P: c.ZMinutesPersonalStore };
}
const note = (id, title) => ({
  id,
  title,
  noteDoc: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: title }] }],
  },
  updated: 1,
});
test("personal Notes are isolated from meeting snapshots, v3 outbox, and retain concurrent versions", async () => {
  const a = device(),
    b = device();
  await a.S.init();
  await b.S.init();
  await a.P.save(note("n", "First"));
  const bundle = await a.P.bundle(await a.P.pending());
  await b.P.merge([bundle]);
  assert.equal((await a.S.snapshot()).meetings.length, 0);
  assert.equal((await a.S.pendingV3()).length, 0);
  const heads = (await a.P.all())[0].heads;
  await a.P.save(note("n", "PC"), heads);
  await b.P.save(note("n", "Phone"));
  await a.P.merge([await b.P.bundle(await b.P.pending())]);
  assert.equal((await a.P.conflicts()).length, 1);
  assert.equal((await a.P.all())[0].value.title, "PC");
  await assert.rejects(
    () => a.S.merge([{ ...bundle, format: "changes-v3" }], "v3"),
    /separate/,
  );
});
test("personal sync includes images, not audio; stable IDs survive deletion tombstones", async () => {
  const a = device(),
    b = device();
  await a.S.init();
  await b.S.init();
  const image = await a.S.addMedia(
      new Blob(["image"], { type: "image/png" }),
      "x.png",
    ),
    audio = await a.S.addMedia(
      new Blob(["audio"], { type: "audio/wav" }),
      "x.wav",
    );
  await a.P.save({
    ...note("n", "Media"),
    photos: [{ id: "p", mediaId: image }],
    recordings: [{ id: "r", audioId: audio, transcript: "hello" }],
  });
  const bundle = await a.P.bundle(await a.P.pending());
  assert.deepEqual(Object.keys(bundle.media), [image]);
  assert.equal(bundle.ops[0].value.recordings[0].audioId, undefined);
  await b.P.merge([bundle]);
  assert.equal((await b.P.all())[0].value.photos[0].id, "p");
  assert.equal((await b.P.all())[0].value.recordings[0].audioId, "");
  assert.equal(await a.S.removeMediaIfUnreferenced(image), false);
  await a.P.remove("n");
  await b.P.merge([await a.P.bundle(await a.P.pending())]);
  assert.equal((await b.P.all())[0].value, null);
});
test("new backup restores personal media atomically; old backup preserves Notes", async () => {
  const a = device();
  await a.S.init();
  await a.P.save(note("n", "Keep me"));
  const backup = await a.S.portable();
  assert.equal(backup.version, 4);
  assert.equal(backup.notes.length, 1);
  await a.S.restore({
    app: "zMinutes",
    version: 3,
    projects: [],
    meetings: [],
  });
  assert.equal((await a.P.all())[0].value.title, "Keep me");
  await assert.rejects(
    () =>
      a.S.restore({
        ...backup,
        notes: [{ ...note("bad", "Bad"), photos: [{ id: "missing" }] }],
      }),
    /missing/,
  );
  assert.equal((await a.P.all())[0].value.title, "Keep me");
  await a.P.remove("n");
  await a.S.restore(backup);
  assert.equal((await a.P.all())[0].value.title, "Keep me");
});
