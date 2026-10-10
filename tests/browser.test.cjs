const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    ),
    file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".webmanifest")
            ? "application/manifest+json"
            : file.endsWith(".png")
              ? "image/png"
              : file.endsWith(".svg")
                ? "image/svg+xml"
                : "text/html",
    );
    res.end(data);
  });
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.platform === "win32" ? { channel: "msedge" } : {}),
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    const context = await browser.newContext({
        permissions: ["microphone"],
        viewport: { width: 1366, height: 900 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("meeting-note-ai", "malformed-json");
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto(base);
    await page.waitForFunction(() => window.ZM?.ready);
    await page.locator("#newMeetingBtn").click();
    await page.locator("#newTitle").fill("Cuộc họp kiểm thử");
    await page
      .getByRole("button", { name: "Create meeting", exact: true })
      .click();
    await page.waitForFunction(
      () => ZM.meetingId && !document.getElementById("newMeetingDialog").open,
    );
    const id = await page.evaluate(() => ZM.meetingId);
    await page
      .locator("#noteInput")
      .fill("Nội dung tiếng Việt\nQuyết định cần lưu.");
    await page.locator('.tabs [data-tab="agenda"]').click();
    await page.locator("#agendaInput").fill("Question one");
    await page.locator("#agendaForm button").click();
    await page.locator(".agenda-note").fill("Answer saved");
    await page.locator('.tabs [data-tab="stakeholders"]').click();
    await page.locator("#stakeholderName").fill("Phú");
    await page.locator("#stakeholderForm button").click();
    await page.locator('.tabs [data-tab="field"]').click();
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      c.getContext("2d").fillRect(0, 0, 64, 64);
      return c.toDataURL().split(",")[1];
    });
    await page
      .locator("#photoInput")
      .setInputFiles({
        name: "pixel.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
    await page.waitForFunction(() => ZM.current().photos.length === 1);
    await page.locator('.tabs [data-tab="summary"]').click();
    await page.locator("#generateSummaryBtn").click();
    await page.waitForFunction(() => ZM.current().summaryType === "quick");
    await page.evaluate(() => ZM.navigate("tasks"));
    await page.locator("#taskTitle").fill("Task retained");
    await page.locator("#taskForm button").click();
    await page.waitForFunction(() => ZM.data.tasks.length === 1);
    await page.evaluate(() => ZM.navigate("field"));
    await page.locator("#fieldTitle").fill("Site inspection");
    await page.locator("#fieldText").fill("Observation");
    await page.locator("#fieldForm button").click();
    await page.waitForFunction(() => ZM.data.fieldNotes.length === 1);
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    assert.equal(
      await page.evaluate(() => ZM.data.tasks[0].title),
      "Task retained",
    );
    assert.equal(
      await page.evaluate(() => ZM.data.fieldNotes[0].text),
      "Observation",
    );
    await page.evaluate((id) => ZM.open(id), id);
    assert.equal(
      await page.locator("#noteInput").inputValue(),
      "Nội dung tiếng Việt\nQuyết định cần lưu.",
    );
    assert.equal(
      await page.evaluate(() => ZM.current().agenda[0].note),
      "Answer saved",
    );
    await page.locator("#recordBtn").click();
    await page.waitForFunction(
      () => document.getElementById("recordLabel").textContent === "Recording",
      {},
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => document.getElementById("recordTimer").textContent !== "00:00",
    );
    await page.locator("#recordBtn").click();
    await page.waitForFunction(() => ZM.current().audioId && !ZM.recording);
    assert.equal(
      await page.evaluate(
        async () => (await ZMinutesStore.all("sessions")).length,
      ),
      0,
    );
    const audioSize = await page.evaluate(
      async () =>
        (await ZMinutesStore.get("media", ZM.current().audioId)).blob.size,
    );
    assert.ok(audioSize > 32000);
    console.log("PASS: microphone capture, WAV save, media and core workflows");
    // Force worklet failure: the real browser must capture through the compatibility engine.
    await page.evaluate(() => {
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        constructor(...args) {
          super(...args);
          Object.defineProperty(this, "audioWorklet", {
            value: {
              addModule: () => new Promise(() => {}),
            },
          });
        }
      };
    });
    await page.locator("#recordBtn").click();
    await page.waitForFunction(() =>
      document
        .getElementById("recordStatus")
        .textContent.includes("Compatibility"),
    );
    await page.locator("#recordBtn").click();
    await page.waitForFunction(() => !ZM.recording);
    console.log("PASS: worklet failure falls back without hanging");
    // A stalled resume and stalled close must still release the UI.
    await page.evaluate(() => {
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        resume() {
          return new Promise(() => {});
        }
        close() {
          super.close().catch(() => {});
          return new Promise(() => {});
        }
      };
    });
    await page.locator("#recordBtn").click();
    await page.waitForFunction(() => !ZM.recording, {}, { timeout: 7000 });
    assert.match(
      await page.locator("#recordStatus").textContent(),
      /could not start/,
    );
    assert.equal(await page.locator("#recordBtn").isEnabled(), true);
    console.log("PASS: stalled audio startup and cleanup cannot trap Record");
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    await page.evaluate((id) => ZM.open(id, "summary"), id);
    assert.equal(
      await page.evaluate(async () => {
        const audio = {
            sampleRate: 44100,
            length: 44100,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(44100),
          },
          blob = ZM.ai.pcmSegment(audio, 0, 16000),
          v = new DataView(await blob.arrayBuffer());
        return v.getUint32(40, true) / 2 / v.getUint32(24, true);
      }),
      1,
    );
    const other = await page.evaluate(async () => {
      const id = crypto.randomUUID();
      await ZM.save("meetings", {
        id,
        title: "Other meeting",
        projectId: "inbox",
      });
      return id;
    });
    let releaseAI, requestStarted;
    const started = new Promise((r) => (requestStarted = r));
    await page.route(
      "https://generativelanguage.googleapis.com/**",
      async (route) => {
        requestStarted();
        await new Promise((r) => (releaseAI = r));
        await route.fulfill({
          json: {
            candidates: [
              {
                content: {
                  parts: [{ text: "Transcript for original meeting" }],
                },
              },
            ],
          },
        });
      },
    );
    await page.evaluate(async (id) => {
      await ZM.updateMeeting(id, { cloudAudioAllowed: true });
      document.getElementById("transcriptionApiKey").value = "test-only";
      const media = await ZMinutesStore.get("media", ZM.current().audioId);
      window.aiTest = ZM.ai.transcribe(id, media.blob);
    }, id);
    await started;
    await page.evaluate((other) => ZM.open(other), other);
    releaseAI();
    await page.evaluate(() => window.aiTest);
    assert.equal(
      await page.evaluate(
        (id) => ZM.data.meetings.find((m) => m.id === id).transcript,
        id,
      ),
      "Transcript for original meeting",
    );
    assert.equal(await page.evaluate(() => ZM.current().transcript), "");
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.evaluate((id) => ZM.open(id, "summary"), id);
    console.log(
      "PASS: 44.1 kHz duration and AI results stay with the original meeting",
    );
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#docBtn").click();
    const doc = await downloadPromise,
      bytes = fs.readFileSync(await doc.path());
    await doc.saveAs(path.join(root, "test-results", "meeting.docx"));
    assert.ok(doc.suggestedFilename().endsWith(".docx"));
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.ok(bytes.includes(Buffer.from("Nội dung tiếng Việt")));
    assert.ok(bytes.includes(Buffer.from("word/document.xml")));
    await page.evaluate(() => (window.print = () => {}));
    await page.locator("#pdfBtn").click();
    await page.waitForSelector(".print-document", { state: "attached" });
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator("#settingsView").isVisible(), false);
    assert.ok(await page.locator(".print-document").isVisible());
    await page.pdf({
      path: path.join(root, "test-results", "meeting.pdf"),
      format: "A4",
    });
    await page.emulateMedia({ media: "screen" });
    console.log("PASS: Vietnamese DOCX and isolated print document");
    for (const width of [360, 412, 800, 1024, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      for (const section of [
        "overview",
        "tasks",
        "calendar",
        "field",
        "settings",
      ]) {
        await page.evaluate((section) => ZM.navigate(section), section);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        );
        assert.equal(overflow, false, section + " overflow at " + width);
      }
      if (width === 360)
        await page.screenshot({
          path: path.join(root, "test-results", "phone.png"),
          fullPage: true,
          animations: "disabled",
        });
    }
    console.log("PASS: responsive widths 360 / 412 / 800 / 1024 / 1366");
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    assert.equal(await page.evaluate(() => ZM.data.meetings.length), 2);
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    console.log("PASS: offline reload and no unhandled browser errors");
    // Two isolated browser devices with a fake Drive transport; exercise the production sync adapter.
    const drive = [],
      folders = [],
      routeDrive = async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        let result;
        if (url.pathname.includes("/upload/")) {
          const boundary = request
              .headers()
              ["content-type"].split("boundary=")[1],
            segments = request.postData().split("--" + boundary),
            read = (s) =>
              JSON.parse(s.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim()),
            meta = read(segments[1]),
            payload = read(segments[2]),
            id = "file-" + drive.length;
          drive.push({ ...meta, id, payload });
          result = { id };
        } else if (request.method() === "POST") {
          const id = "folder-" + folders.length;
          folders.push({ id });
          result = { id };
        } else if (url.searchParams.get("alt") === "media")
          result = drive.find((f) => url.pathname.endsWith("/" + f.id)).payload;
        else {
          const q = url.searchParams.get("q") || "";
          result = {
            files: q.includes("appProperties")
              ? drive.map(({ payload, ...f }) => f)
              : q.includes("folder")
                ? folders
                : [],
          };
        }
        await route.fulfill({ json: result });
      };
    await context.route("https://www.googleapis.com/**", routeDrive);
    const contextB = await browser.newContext({
      viewport: { width: 800, height: 1000 },
    });
    await contextB.route("https://www.googleapis.com/**", routeDrive);
    const phone = await contextB.newPage();
    await phone.goto(base);
    await phone.waitForFunction(() => ZM?.ready);
    for (const p of [page, phone])
      await p.evaluate(() => {
        document.getElementById("driveClientId").value =
          "test.apps.googleusercontent.com";
        window.google = {
          accounts: {
            oauth2: {
              initTokenClient: (options) => ({
                requestAccessToken: () =>
                  options.callback({ access_token: "test-only" }),
              }),
            },
          },
        };
      });
    await page.evaluate(() => ZM.sync.sync());
    await phone.evaluate(() => ZM.sync.sync());
    assert.equal(await phone.evaluate(() => ZM.data.meetings.length), 2);
    assert.equal(
      await phone.evaluate(
        () =>
          ZM.data.meetings.find((m) => m.title === "Cuộc họp kiểm thử").audioId,
      ),
      "",
    );
    await page.evaluate(
      (id) => ZM.updateMeeting(id, { note: "Edited on PC" }),
      id,
    );
    await phone.evaluate(
      (id) => ZM.updateMeeting(id, { note: "Edited on phone" }),
      id,
    );
    await phone.evaluate(() => ZM.sync.sync());
    await page.evaluate(() => ZM.sync.sync());
    assert.ok((await page.evaluate(() => ZM.conflicts.length)) > 0);
    assert.ok(
      await page.evaluate(
        (id) => ZM.data.meetings.find((m) => m.id === id).audioId,
        id,
      ),
    );
    await page.evaluate(async () => {
      const c = ZM.conflicts.find((c) => c.kind === "meetings"),
        v = c.versions.find((v) => v.value.note === "Edited on PC").value,
        old = ZM.data.meetings.find((m) => m.id === c.id);
      await ZMinutesStore.put(
        c.kind,
        { ...v, audioId: old.audioId },
        c.versions.map((v) => v.id),
      );
      await ZM.reload();
    });
    await page.evaluate(() => ZM.sync.sync());
    await phone.evaluate(() => ZM.sync.sync());
    assert.equal(
      await phone.evaluate(
        (id) => ZM.data.meetings.find((m) => m.id === id).note,
        id,
      ),
      "Edited on PC",
    );
    assert.equal(await phone.evaluate(() => ZM.conflicts.length), 0);
    assert.ok(
      drive.every((f) => !JSON.stringify(f.payload).includes("data:audio")),
    );
    console.log(
      "PASS: two-device sync, concurrent edits, conflict resolution, local audio preserved",
    );
    await contextB.close();
    await context.close();
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
