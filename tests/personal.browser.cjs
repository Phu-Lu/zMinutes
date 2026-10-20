const { chromium } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const file = path.resolve(
    root,
    "." +
      (req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0]),
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    res.statusCode = err ? 404 : 200;
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(err ? "Missing" : data);
  });
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  try {
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => ZM.ready);
    await page.locator("#personalNotesNav").click();
    await page.locator("#pnNew").click();
    await page.locator("#pnTitle").fill("Personal ideas");
    const editor = page.locator("#pnEditor .ProseMirror");
    await editor.fill("Xin chào notes");
    await page.locator("#pnLabels").fill("Ideas, Work");
    await page.evaluate(() => ZM.flush());
    const id = await page.evaluate(
      async () => (await ZMinutesPersonalStore.all())[0].id,
    );
    assert.equal(await page.evaluate(() => ZM.data.meetings.length), 0);
    await page.locator('[data-pn-command="taskList"]').click();
    await page.evaluate(() => ZM.flush());
    assert.equal(await editor.locator("ul[data-type=taskList]").count(), 1);
    await page.locator("#pnImage").setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.waitForFunction(
      async () =>
        (await ZMinutesPersonalStore.all())[0].value.photos.length === 1,
    );
    await page.evaluate(() => ZM.flush());
    assert.equal(await editor.locator("img[data-photo-id]").count(), 1);
    await page.getByText("Pictures", { exact: true }).click();
    await page.locator("[data-pn-remove-photo]").click();
    assert.match(
      await page.locator("#pnStatus").innerText(),
      /used in this note/,
    );
    await page.locator("#pnPin").click();
    await page.waitForFunction(
      () => document.getElementById("pnPin").textContent === "Unpin",
    );
    for (const width of [1366, 800, 412, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => ZM.nav(false));
      await page.waitForTimeout(400);
      const bounds = await page.locator("#pnEditor").boundingBox();
      assert.ok(bounds.x + bounds.width <= width + 1);
      await page.screenshot({
        path: path.join(root, "test-results", `personal-notes-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.reload();
    await page.waitForFunction(() => ZM.ready);
    await page.locator("#personalNotesNav").click();
    await page.locator(`[data-note="${id}"]`).click();
    assert.match(await editor.innerText(), /Xin chào/);
    assert.equal(await editor.locator("img[data-photo-id]").count(), 1);
    await page.locator("#pnRecord").click();
    await page.waitForFunction(
      () => document.getElementById("pnRecord").textContent === "Stop",
    );
    await page.waitForTimeout(600);
    await page.locator("#pnRecord").click();
    await page.waitForFunction(() => !ZM.recording);
    await page.waitForSelector("[data-pn-transcribe]");
    await page.locator("[data-pn-transcribe]").click();
    assert.match(await page.locator("#pnStatus").innerText(), /Allow cloud/);
    await page.evaluate(() => {
      document.getElementById("transcriptionProvider").value = "openai";
      document.getElementById("transcriptionApiKey").value = "test";
      document.getElementById("transcriptionModel").value =
        "test-selected-model";
    });
    await page.route(
      "https://api.openai.com/v1/audio/transcriptions",
      (route) => route.fulfill({ json: { text: "Voice note transcript." } }),
    );
    await page.locator("#pnConsent").check();
    await page.locator("[data-pn-transcribe]").click();
    await page.waitForFunction(
      () =>
        !ZM.aiBusy &&
        document.getElementById("pnTranscript").value.includes("Voice note"),
    );
    await page.locator("#pnAppend").click();
    assert.match(await editor.innerText(), /Voice note transcript/);
    assert.equal(await page.locator("#pnAppend").isDisabled(), true);
    await page.unroute("https://api.openai.com/v1/audio/transcriptions");
    await page.route(
      "https://api.openai.com/v1/audio/transcriptions",
      () => {},
    );
    await page.locator("[data-pn-transcribe]").click();
    await page.waitForFunction(() => ZM.aiBusy);
    await page.locator("#pnCancel").click();
    await page.waitForFunction(() => !ZM.aiBusy);
    assert.match(
      await page.locator("#pnTranscript").inputValue(),
      /Voice note transcript/,
    );
    await page.unroute("https://api.openai.com/v1/audio/transcriptions");
    await page.route(
      "https://api.openai.com/v1/audio/transcriptions",
      (route) =>
        route.fulfill({
          status: 400,
          json: { error: { message: "Test API rejected audio" } },
        }),
    );
    await page.locator("[data-pn-transcribe]").click();
    await page.waitForFunction(
      () =>
        !ZM.aiBusy &&
        document
          .getElementById("pnStatus")
          .textContent.includes("Transcription failed"),
    );
    assert.match(await editor.innerText(), /Voice note transcript/);
    await page.locator("[data-pn-delete-audio]").click();
    await page.waitForFunction(
      async () =>
        !(await ZMinutesPersonalStore.all())[0].value.recordings[0].audioId,
    );
    assert.match(await editor.innerText(), /Voice note transcript/);
    await page.locator("#pnTrash").click();
    await page.waitForFunction(
      () => document.getElementById("pnTrash").textContent === "Restore",
    );
    await page.locator("#pnTrash").click();
    await page.waitForFunction(
      () => document.getElementById("pnTrash").textContent === "Move to Trash",
    );
    const downloaded = page.waitForEvent("download");
    await page.locator("#pnWord").click();
    const word = await downloaded;
    const bytes = fs.readFileSync(await word.path());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.ok(bytes.includes(Buffer.from("word/media/image1.png")));
    assert.ok(bytes.includes(Buffer.from("Xin chào")));
    assert.ok(!bytes.includes(Buffer.from("audio/wav")));
    let failUpload = true;
    const remote = [],
      transport = async (method, value) => {
        if (method === "list") return remote.map((b, i) => ({ id: String(i) }));
        if (method === "upload") {
          if (failUpload) throw new Error("Simulated offline upload");
          remote.push(value);
          return { id: String(remote.length - 1) };
        }
        if (method === "api")
          return remote[Number(value.split("/").pop().split("?")[0])];
        if (method === "verify")
          return (
            JSON.stringify(remote[Number(value.file.id)]) ===
            JSON.stringify(value.payload)
          );
      };
    const contextB = await browser.newContext(),
      phone = await contextB.newPage();
    await phone.goto("http://127.0.0.1:" + server.address().port);
    await phone.waitForFunction(() => ZM.ready);
    for (const p of [page, phone]) {
      await p.exposeFunction("notesTransport", transport);
      await p.evaluate(
        () =>
          (window.syncNotes = () =>
            ZM.personal.sync({
              list: (q) => notesTransport("list", q),
              api: (p) => notesTransport("api", p),
              upload: (b, namespace) => {
                if (namespace !== "notes-v1")
                  throw new Error("Wrong namespace");
                return notesTransport("upload", b);
              },
              verifyUpload: async (file, payload) => {
                if (!(await notesTransport("verify", { file, payload })))
                  throw new Error("Verify failed");
              },
            })),
      );
    }
    await assert.rejects(
      () => page.evaluate(() => syncNotes()),
      /offline upload/,
    );
    assert.ok(
      await page.evaluate(
        async () => (await ZMinutesPersonalStore.pending()).length > 0,
      ),
    );
    failUpload = false;
    await page.evaluate(() => syncNotes());
    await phone.evaluate(() => syncNotes());
    assert.equal(
      await phone.evaluate(
        async () =>
          (await ZMinutesPersonalStore.all()).filter((r) => r.value).length,
      ),
      1,
    );
    assert.equal(
      await phone.evaluate(
        async () => (await ZMinutesPersonalStore.all())[0].value.photos.length,
      ),
      1,
    );
    await page.evaluate(async (id) => {
      const r = await ZMinutesStore.get("personalNotes", id);
      await ZMinutesPersonalStore.save(
        { ...r.value, title: "PC edited" },
        r.heads,
      );
    }, id);
    await phone.evaluate(async (id) => {
      const r = await ZMinutesStore.get("personalNotes", id);
      await ZMinutesPersonalStore.save(
        { ...r.value, title: "Phone edited" },
        r.heads,
      );
    }, id);
    await page.evaluate(() => syncNotes());
    await phone.evaluate(() => syncNotes());
    assert.equal(
      await phone.evaluate(
        async () => (await ZMinutesPersonalStore.conflicts()).length,
      ),
      1,
    );
    await phone.evaluate(() => ZM.navigate("personal"));
    await phone.locator("#pnConflicts summary").first().click();
    await phone.locator("#pnConflicts details summary").first().click();
    await phone.locator("[data-pn-conflict]").first().click();
    await phone.waitForFunction(
      async () => (await ZMinutesPersonalStore.conflicts()).length === 0,
    );
    await phone.evaluate(() => syncNotes());
    await page.evaluate(() => syncNotes());
    assert.equal(
      await page.evaluate(
        async () => (await ZMinutesPersonalStore.conflicts()).length,
      ),
      0,
    );
    await contextB.close();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: standalone Notes rich text, checklist, image protection, persistence, responsive layout, microphone, consent, transcript review/insert, trash, DOCX with images, two-device sync and manual conflicts",
    );
  } catch (err) {
    await page.screenshot({
      path: path.join(root, "test-results", "personal-failure.png"),
      fullPage: true,
    });
    throw err;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
