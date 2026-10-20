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
      ...(process.platform === "win32" && process.env.ZMINUTES_BROWSER !== "chromium" ? { channel: "msedge" } : {}),
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
    const dialogFields = await page.locator("#newMeetingDialog input, #newMeetingDialog select").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
    assert.ok(dialogFields.every((height) => Math.abs(height - 44) < 1), "new meeting dialog field heights match");
    await page.locator("#newMeetingDialog").screenshot({ path: path.join(root, "test-results", "new-meeting-purple.png") });
    await page
      .getByRole("button", { name: "Create meeting", exact: true })
      .click();
    await page.waitForFunction(
      () => ZM.meetingId && !document.getElementById("newMeetingDialog").open,
    );
    const id = await page.evaluate(() => ZM.meetingId);
    const note = page.locator("#noteEditor .ProseMirror");
    await note.waitFor();
    await page.waitForFunction(() => document.querySelector("#noteEditor .ProseMirror")?.getAttribute("contenteditable") === "true");
    await note.fill("Nội dung tiếng Việt\nQuyết định cần lưu.");
    await page.evaluate(() => {
      const text = document.querySelector("#noteEditor .ProseMirror p").firstChild;
      const range = document.createRange();
      range.setStart(text, 9); range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.locator('[data-insert="decision"]').click();
    assert.equal(await page.evaluate(() => ZM.tab), "note");
    assert.match(await note.innerHTML(), /data-note-kind="decision"/);
    await page.locator('[data-insert="task"]').click();
    assert.equal(await page.evaluate(() => ZM.tab), "note");
    assert.match(await page.evaluate(() => ZM.richNotes && document.querySelector('#noteEditor').innerHTML), /data-note-kind="task"/);
    await page.locator('[data-insert="important"]').click();
    assert.equal(await page.evaluate(() => ZM.tab), "note");
    assert.match(await page.evaluate(() => document.querySelector('#noteEditor').innerHTML), /data-note-kind="important"/);
    await note.fill("Before text after");
    await page.evaluate(() => {
      const text = document.querySelector("#noteEditor .ProseMirror p").firstChild;
      const range = document.createRange(); range.setStart(text, 7); range.setEnd(text, 11);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.locator("#noteStyleBtn").click();
    await page.locator('[data-format="bold"]').click();
    assert.match(await note.innerHTML(), /<strong>text<\/strong>/);
    await page.locator('[data-format="underline"]').click();
    assert.match(await note.innerHTML(), /<u>/);
    await page.locator('[data-format="strike"]').click();
    assert.match(await note.innerHTML(), /<s>/);
    await page.locator('[data-format="italic"]').click();
    assert.match(await note.innerHTML(), /<em>/);
    await note.fill("One\nTwo");
    await page.evaluate(() => {
      const content = document.querySelector("#noteEditor .ProseMirror");
      const range = document.createRange(); range.selectNodeContents(content);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.locator('[data-format="numbered"]').click();
    assert.equal(await note.locator("ol li").count(), 2);
    await note.fill("Nội dung tiếng Việt\nQuyết định cần lưu.");
    assert.equal(await page.locator("#transcriptInput").isVisible(), false);
    await page.locator("#manualTranscriptLabel").click();
    await page.locator("#transcriptInput").fill("Supplier said delivery is Friday.");
    await context.grantPermissions(["microphone", "clipboard-read", "clipboard-write"]);
    await page.locator("#copyTranscriptBtn").click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Supplier said delivery is Friday.");
    await page.locator("#addTranscriptToNotesBtn").click();
    assert.match(await note.innerText(), /TRANSCRIPT:[\s\S]*Supplier said delivery is Friday\./);
    await note.fill("Nội dung tiếng Việt\nQuyết định cần lưu.");
    await page.locator("#transcriptInput").fill("");
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
    await page.locator("#photoInput").setInputFiles({
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
    await page.evaluate(() => ZM.flush());
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
    assert.match(
      await page.locator("#noteEditor .ProseMirror").innerText(),
      /Nội dung tiếng Việt[\s\S]*Quyết định cần lưu\./,
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
    await page.evaluate(() => {
      document.getElementById("aiProvider").value = "gemini";
      document.getElementById("aiModel").value = "gemini-3.5-flash";
      document.getElementById("aiApiKey").value = "test-only";
      document.getElementById("transcriptionProvider").value = "gemini";
      document.getElementById("transcriptionModel").value = "";
      document.getElementById("saveAiSettingsBtn").click();
    });
    let releaseAI, requestStarted, transcriptionUrl;
    const started = new Promise((r) => (requestStarted = r));
    await page.route(
      "https://generativelanguage.googleapis.com/**",
      async (route) => {
        transcriptionUrl = route.request().url();
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
      window.aiTest = ZM.ai.transcribe(
        id,
        media.blob,
        ZM.current().recordings.at(-1).id,
      );
    }, id);
    await started;
    assert.equal(await page.locator("#aiJobPanel").isVisible(), true);
    assert.equal(await page.locator("#aiJobPanel #aiStatus").count(), 1);
    assert.equal(await page.locator("#settingsView #aiStatus").count(), 0);
    assert.equal(await page.locator("#aiJobProgress").isVisible(), true);
    await page.evaluate(() => ZM.run(() => ZM.ai.transcribe(ZM.meetingId, new Blob())));
    assert.equal(await page.locator("#appNotice").textContent(), "");
    await page.setViewportSize({ width: 412, height: 915 });
    await page.evaluate(() => ZM.nav(false));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(root, "test-results", "transcription-progress-phone.png") });
    await page.setViewportSize({ width: 1366, height: 900 });
    // Emulate the stale banner left by an older build; completion clears only this warning.
    await page.evaluate(() => ZM.notice("An AI request is already running. Wait or cancel it.", true));
    assert.match(
      transcriptionUrl,
      /\/models\/gemini-3\.5-flash:generateContent$/,
    );
    await page.evaluate((other) => ZM.open(other), other);
    releaseAI();
    await page.evaluate(() => window.aiTest);
    assert.equal(await page.evaluate(() => ZM.aiBusy), false);
    assert.equal(await page.locator("#appNotice").isVisible(), false);
    assert.equal(await page.locator("#cancelAiBtn").isVisible(), false);
    assert.equal(await page.locator("#aiJobProgress").isVisible(), false);
    await page.locator("#dismissAiJobBtn").click();
    assert.equal(await page.locator("#aiJobPanel").isVisible(), false);
    assert.equal(
      await page.evaluate(
        (id) =>
          ZMinutesModel.fullTranscript(
            ZM.data.meetings.find((m) => m.id === id),
          ),
        id,
      ),
      "Recording 2:\nTranscript for original meeting",
    );
    assert.equal(await page.evaluate(() => ZM.current().transcript), "");
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.evaluate((id) => ZM.open(id, "summary"), id);
    let chunkCalls = 0, releaseChunk;
    await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
      chunkCalls++;
      if (chunkCalls === 2) await new Promise((resolve) => { releaseChunk = resolve; });
      try {
        await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "Partial chunk text" }] } }] } });
      } catch (error) {
        // Cancel aborts the second intercepted request before its mocked response.
        if (chunkCalls !== 2 || !/already handled|aborted/i.test(error.message)) throw error;
      }
    });
    await page.evaluate(() => {
      const audio = ZMinutesCapture.wav([new Uint8Array(91 * 16000 * 2)]);
      window.chunkJob = ZM.ai.transcribe(ZM.meetingId, audio, ZM.current().recordings.at(-1).id)
        .catch((error) => error.name);
    });
    await page.waitForFunction(() => document.getElementById("aiJobProgress").value === 1 && document.getElementById("aiJobProgress").max === 2);
    assert.equal(await page.locator("#aiTranscriptPreviewText").textContent(), "Partial chunk text");
    await page.locator("#aiTranscriptPreview summary").click();
    await page.locator("#cancelAiBtn").click();
    assert.equal(await page.evaluate(() => window.chunkJob), "AbortError");
    assert.equal(await page.evaluate(() => ZM.aiBusy), false);
    assert.equal(await page.locator("#aiJobProgress").isVisible(), false);
    assert.equal(await page.evaluate(() => ZMinutesModel.fullTranscript(ZM.current())), "Recording 2:\nTranscript for original meeting");
    releaseChunk?.();
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.locator("#dismissAiJobBtn").click();
    console.log("PASS: workspace AI progress, duplicate-click cleanup, partial chunk preview and cancellation retain saved transcript");
    const aiCalls = [];
    await page.route(
      "https://generativelanguage.googleapis.com/**",
      async (route) => {
        const body = route.request().postDataJSON();
        aiCalls.push(body);
        await route.fulfill({
          json: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: body.tools
                        ? "<p>Use phased rollout.</p>"
                        : body.contents[0].parts.some((p) => p.inlineData)
                          ? "First clip transcript"
                          : "<p>Custom recap.</p>",
                    },
                  ],
                },
                ...(body.tools
                  ? {
                      groundingMetadata: {
                        groundingChunks: [
                          {
                            web: {
                              title: "Google source",
                              uri: "https://example.com/source",
                            },
                          },
                        ],
                      },
                    }
                  : {}),
              },
            ],
          },
        });
      },
    );
    await page.evaluate(async (id) => {
      const m = ZM.data.meetings.find((item) => item.id === id);
      const clip = m.recordings[0];
      const item = await ZMinutesStore.get("media", clip.audioId);
      await ZM.ai.transcribe(id, item.blob, clip.id);
      await ZM.updateMeeting(id, {
        summaryPrompt: "Focus on blockers and owners.",
        solutionPrompt: "Offer a practical rollout.",
      });
      await ZM.ai.recap(id);
      await ZM.ai.solutions(id);
    }, id);
    const aiState = await page.evaluate((id) => {
      const m = ZM.data.meetings.find((item) => item.id === id);
      return {
        segments: m.transcriptSegments,
        full: ZMinutesModel.fullTranscript(m),
        summary: m.summary,
        solutions: m.solutions,
        sources: m.solutionSources,
      };
    }, id);
    assert.equal(aiState.segments.length, 2);
    assert.match(
      aiState.full,
      /First clip transcript[\s\S]*Transcript for original meeting/,
    );
    assert.match(aiState.summary, /Custom recap/);
    assert.match(aiState.solutions, /phased rollout/);
    assert.equal(aiState.sources[0].url, "https://example.com/source");
    assert.ok(
      aiCalls.some(
        (call) =>
          call.contents[0].parts[0].text.includes(
            "Focus on blockers and owners.",
          ) &&
          call.contents[0].parts[0].text.includes("First clip transcript") &&
          call.contents[0].parts[0].text.includes(
            "Transcript for original meeting",
          ),
      ),
    );
    assert.ok(
      aiCalls.some(
        (call) =>
          call.tools?.[0]?.google_search &&
          call.contents[0].parts[0].text.includes("Offer a practical rollout."),
      ),
    );
    await page.unroute("https://generativelanguage.googleapis.com/**");
    let openaiRequest;
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      openaiRequest = route.request().postDataJSON();
      await route.fulfill({
        json: {
          output: [
            {
              type: "web_search_call",
              action: {
                type: "search",
                sources: [{ type: "url", url: "https://example.org/evidence" }],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Option A uses a phased rollout.",
                  annotations: [
                    {
                      type: "url_citation",
                      title: "Evidence",
                      url: "https://example.org/evidence",
                      end_index: 32,
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    });
    await page.evaluate(async (id) => {
      document.getElementById("aiProvider").value = "openai";
      document.getElementById("aiModel").value = "gpt-4.1-mini";
      document.getElementById("aiApiKey").value = "test-only";
      document.getElementById("saveAiSettingsBtn").click();
      await ZM.ai.solutions(id);
    }, id);
    assert.equal(openaiRequest.tools[0].type, "web_search");
    assert.equal(openaiRequest.tool_choice, "required");
    assert.ok(openaiRequest.input.includes("First clip transcript"));
    assert.equal(
      await page.evaluate(
        (id) =>
          ZM.data.meetings.find((m) => m.id === id).solutionSources[0].url,
        id,
      ),
      "https://example.org/evidence",
    );
    assert.equal(
      await page
        .locator('#solutionOutput a[href="https://example.org/evidence"]')
        .count(),
      1,
    );
    await page.unroute("https://api.openai.com/v1/responses");
    console.log(
      "PASS: multi-clip transcript, custom recap, Gemini and OpenAI grounded solutions",
    );
    const rawDownload = page.waitForEvent("download");
    await page.locator("#packageBtn").click();
    const raw = await rawDownload,
      rawMeeting = JSON.parse(fs.readFileSync(await raw.path(), "utf8"));
    assert.equal(await page.locator("#packageBtn").textContent(), "↓ Raw Data");
    assert.match(rawMeeting.note, /Nội dung tiếng Việt/);
    assert.equal(rawMeeting.photos.length, 1);
    assert.ok(
      rawMeeting.recordings.some((r) => r.data?.startsWith("data:audio/")),
    );
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#docBtn").click();
    const doc = await downloadPromise,
      bytes = fs.readFileSync(await doc.path());
    await doc.saveAs(path.join(root, "test-results", "meeting.docx"));
    assert.ok(doc.suggestedFilename().endsWith(".docx"));
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.ok(bytes.includes(Buffer.from("Custom recap")));
    assert.ok(bytes.includes(Buffer.from("phased rollout")));
    assert.equal(bytes.includes(Buffer.from("Nội dung tiếng Việt")), false);
    assert.equal(bytes.includes(Buffer.from("word/media/")), false);
    const sharedBlocks = await page.evaluate(() =>
      ZM.exports
        .blocks(ZM.current())
        .map((block) => block.title)
        .join("\n"),
    );
    assert.match(sharedBlocks, /Custom recap[\s\S]*phased rollout/);
    assert.match(sharedBlocks, /https:\/\/example\.org\/evidence/);
    assert.doesNotMatch(
      sharedBlocks,
      /Nội dung tiếng Việt|First clip transcript/,
    );
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (payload) => {
          window.lastShare = payload;
        },
      });
    });
    await page.locator("#shareBtn").click();
    await page.waitForFunction(() => window.lastShare?.text);
    assert.equal(
      await page.evaluate(() => window.lastShare.text),
      await page.evaluate(() => ZM.exports.sharingText(ZM.current())),
    );
    assert.match(
      await page.evaluate(() => {
        try {
          ZM.exports.blocks({ ...ZM.current(), summary: "", solutions: "" });
        } catch (error) {
          return error.message;
        }
      }),
      /Generate a recap or suggested solutions/,
    );
    assert.ok(bytes.includes(Buffer.from("word/document.xml")));
    await page.evaluate(() => (window.print = () => {}));
    await page.locator("#pdfBtn").click();
    await page.waitForSelector(".print-document", { state: "attached" });
    const printed = await page.locator(".print-document").textContent();
    assert.match(printed, /Custom recap/);
    assert.match(printed, /phased rollout/);
    assert.doesNotMatch(printed, /Nội dung tiếng Việt/);
    assert.equal(await page.locator(".print-document img").count(), 0);
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator("#settingsView").isVisible(), false);
    assert.ok(await page.locator(".print-document").isVisible());
    await page.pdf({
      path: path.join(root, "test-results", "meeting.pdf"),
      format: "A4",
    });
    await page.emulateMedia({ media: "screen" });
    console.log("PASS: Vietnamese DOCX and isolated print document");
    await page.evaluate(async (meetingId) => {
      await ZM.updateMeeting(meetingId, {
        transcript: "Transcript already saved in an older meeting.",
        summary: "<p>Earlier recap remains available.</p>",
        summaryType: "existing",
      });
    }, other);
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    await page.evaluate((meetingId) => ZM.open(meetingId, "note"), other);
    await page.evaluate(() => {
      document.getElementById("aiProvider").value = "gemini";
      document.getElementById("aiModel").value = "gemini-3.5-flash";
      document.getElementById("aiApiKey").value = "test-only";
    });
    let releaseLegacy, legacyRequest, legacyStartedResolve;
    const legacyStarted = new Promise((resolve) => {
      legacyStartedResolve = resolve;
    });
    await page.route(
      "https://generativelanguage.googleapis.com/**",
      async (route) => {
        legacyRequest = route.request().postDataJSON();
        await new Promise((release) => {
          releaseLegacy = release;
          legacyStartedResolve();
        });
        await route.fulfill({
          json: {
            candidates: [
              { content: { parts: [{ text: "<p>Recap of old data.</p>" }] } },
            ],
          },
        });
      },
    );
    await page.locator("#transcriptRecapBtn").click();
    await legacyStarted;
    assert.equal(await page.locator("#summaryPanel").isVisible(), true);
    assert.match(
      await page.locator("#recapStatus").textContent(),
      /Generating recap/,
    );
    assert.match(
      legacyRequest.contents[0].parts[0].text,
      /Transcript already saved/,
    );
    releaseLegacy();
    await page.waitForFunction(
      () =>
        document.getElementById("recapStatus").textContent === "Recap saved.",
    );
    assert.match(
      await page.locator("#summaryOutput").textContent(),
      /Recap of old data/,
    );
    assert.ok(
      await page
        .locator("#summaryOutput")
        .evaluate((node) => node.getBoundingClientRect().height < 240),
    );
    await page.locator("#solutionPromptInput").fill("Short question");
    const shortPromptHeight = await page
      .locator("#solutionPromptInput")
      .evaluate((node) => node.getBoundingClientRect().height);
    await page
      .locator("#solutionPromptInput")
      .fill("Long question\n".repeat(20));
    const longPromptHeight = await page
      .locator("#solutionPromptInput")
      .evaluate((node) => node.getBoundingClientRect().height);
    assert.ok(shortPromptHeight < longPromptHeight && longPromptHeight <= 362);
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.route("https://generativelanguage.googleapis.com/**", (route) =>
      route.fulfill({
        status: 429,
        json: { error: { message: "Quota exceeded" } },
      }),
    );
    await page.locator("#generateSummaryBtn").click();
    await page.waitForFunction(() =>
      document
        .getElementById("recapStatus")
        .textContent.includes("Quota exceeded"),
    );
    assert.match(
      await page.locator("#summaryOutput").textContent(),
      /Recap of old data/,
    );
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.evaluate(() => {
      document.getElementById("aiProvider").value = "quick";
    });
    await page.locator("#generateSummaryBtn").click();
    await page.waitForFunction(() => ZM.current().summaryType === "quick");
    await page.waitForFunction(() =>
      document
        .getElementById("summaryOutput")
        .textContent.includes("Transcript already saved"),
    );
    assert.match(
      await page.locator("#summaryOutput").textContent(),
      /Transcript already saved/,
    );
    assert.equal(await page.locator("#summaryOutput.empty").count(), 0);
    console.log(
      "PASS: persisted meeting recap, visible progress and failure recovery",
    );
    await page.evaluate((meetingId) => ZM.open(meetingId, "note"), id);
    const clipToDelete = await page.evaluate(() => ZM.current().recordings[0]);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(`[data-delete-recording="${clipToDelete.id}"]`).click();
    await page.waitForFunction(
      (clipId) => !ZM.current().recordings.some((r) => r.id === clipId),
      clipToDelete.id,
    );
    await page.waitForFunction(() =>
      document
        .getElementById("appNotice")
        .textContent.includes("Recording deleted"),
    );
    assert.equal(
      await page.evaluate(
        (audioId) => ZMinutesStore.get("media", audioId),
        clipToDelete.audioId,
      ),
      undefined,
    );
    assert.match(
      await page.evaluate(() => ZMinutesModel.fullTranscript(ZM.current())),
      /First clip transcript[\s\S]*Transcript for original meeting/,
    );
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    await page.evaluate((meetingId) => ZM.open(meetingId, "note"), id);
    assert.equal(await page.locator("#recordingList .file-row").count(), 1);
    assert.match(
      await page.evaluate(() => ZMinutesModel.fullTranscript(ZM.current())),
      /First clip transcript[\s\S]*Transcript for original meeting/,
    );
    for (const width of [360, 412, 800, 1024, 1366]) {
      await page.setViewportSize({ width, height: 915 });
      const row = page.locator("#recordingList .file-row").first();
      const metrics = await row.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const buttons = [...node.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
        return { right: box.right, viewport: innerWidth, height: box.height,
          buttons: buttons.map((b) => ({top:b.top, width:b.width, height:b.height, right:b.right})) };
      });
      await page.locator(".notes-audio").screenshot({ path: path.join(root, "test-results", `audio-purple-${width}.png`) });
      assert.ok(metrics.right <= metrics.viewport + 1 && metrics.height < 90, "recording row compact at " + width + ": " + JSON.stringify(metrics));
      assert.ok(metrics.buttons.every((b) => b.width >= 44 && b.height >= 44 && b.right <= metrics.right), "audio targets fit at " + width);
      assert.ok(metrics.buttons.every((b) => Math.abs(b.top - metrics.buttons[0].top) < 1), "audio actions share one row");
      await page.locator(".notes-audio").screenshot({ path: path.join(root, "test-results", `audio-purple-${width}.png`) });
    }
    await page.setViewportSize({ width:1366, height:900 });
    console.log(
      "PASS: audio deletion persists while transcripts remain ordered",
    );
    await page.locator("#translationLanguage").selectOption("");
    await page.locator("#translateTranscriptBtn").click();
    await page.waitForFunction(() => document.getElementById("appNotice").textContent.includes("target language"));
    await page.evaluate(() => {
      document.getElementById("aiProvider").value = "gemini";
      document.getElementById("aiModel").value = "gemini-3.5-flash";
      document.getElementById("aiApiKey").value = "test-only";
    });
    await page.locator("#translationLanguage").selectOption("Vietnamese");
    assert.equal(await page.locator("#translationLanguage").inputValue(), "Vietnamese");
    assert.match(await page.locator(".translation-source").textContent(), /Detect language/);
    let translationPrompt;
    await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
      translationPrompt = route.request().postDataJSON().contents[0].parts[0].text;
      await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "SOURCE_LANGUAGES: English\nBản dịch cuộc họp." }] } }] } });
    });
    await page.locator("#translateTranscriptBtn").click();
    await page.waitForFunction(() => document.getElementById("translationOutput").textContent.includes("Bản dịch cuộc họp."));
    assert.equal(await page.locator("#appNotice").isVisible(), false);
    assert.equal(await page.locator("#detectedLanguage").textContent(), "English");
    assert.ok(!(await page.locator("#translationOutput").textContent()).includes("SOURCE_LANGUAGES"));
    assert.match(translationPrompt, /First clip transcript[\s\S]*Transcript for original meeting/);
    assert.equal(await page.locator("#translationPanel").isVisible(), true);
    await page.locator("#addTranslationToNotesBtn").click();
    await page.waitForFunction(() => document.getElementById("noteEditor").textContent.includes("Bản dịch cuộc họp."));
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.evaluate(() => {
      document.getElementById("translationLanguage").value = "English";
      document.getElementById("translationLanguage").dispatchEvent(new Event("change"));
      document.getElementById("aiProvider").value = "openai";
      document.getElementById("aiModel").value = "gpt-4.1-mini";
      document.getElementById("aiApiKey").value = "test-only";
    });
    assert.equal(await page.locator("#translationPanel").isVisible(), false);
    let openaiTranslationPrompt;
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      openaiTranslationPrompt = route.request().postDataJSON().input;
      await route.fulfill({ json: { output: [{ content: [{ text: "SOURCE_LANGUAGES: Korean, Japanese\nMeeting translated to English." }] }] } });
    });
    await page.locator("#translateTranscriptBtn").click();
    await page.waitForFunction(() => document.getElementById("translationOutput").textContent.includes("Meeting translated to English."));
    assert.equal(await page.locator("#detectedLanguage").textContent(), "Mixed: Korean, Japanese");
    assert.match(openaiTranslationPrompt, /Translate the following meeting transcript into English/);
    assert.match(openaiTranslationPrompt, /Detect the source language automatically/);
    await page.unroute("https://api.openai.com/v1/responses");
    let flexibleTranslationPrompt;
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      flexibleTranslationPrompt = route.request().postDataJSON().input;
      const text = (flexibleTranslationPrompt.includes("into Korean.") ? "SOURCE_LANGUAGES:\n" : "") + "Translated into the requested language.";
      await route.fulfill({ json: { output: [{ content: [{ text }] }] } });
    });
    await page.locator("#translationLanguage").selectOption("Korean");
    assert.equal(await page.locator("#translationPanel").isVisible(), false);
    await page.locator("#translateTranscriptBtn").click();
    await page.waitForFunction(() => document.getElementById("translationOutput").textContent.includes("Translated into the requested language."));
    assert.match(flexibleTranslationPrompt, /into Korean\. Detect the source language automatically/);
    await page.locator("#addTranslationToNotesBtn").click();
    await page.waitForFunction(() => ZM.current().noteDoc?.content.some((block) => block.attrs?.language === "Korean"));
    assert.equal(await page.locator("#detectedLanguage").textContent(), "Not identified");
    await page.locator("#translationLanguage").selectOption("custom");
    await page.locator("#customTranslationLanguage").fill("Zulu");
    assert.equal(await page.locator("#customTranslationLanguage").inputValue(), "Zulu");
    await page.locator("#translateTranscriptBtn").click();
    await page.waitForFunction(() => ZM.translation?.language === "Zulu");
    assert.match(flexibleTranslationPrompt, /into Zulu/);
    assert.equal(await note.innerText().then((text) => text.includes("Zulu")), false, "Add to Notes must not steal typing focus from the target language");
    await page.locator("#translationLanguage").selectOption("Swahili");
    await page.locator("#translateTranscriptBtn").click();
    await page.waitForFunction(() => ZM.translation?.language === "Swahili");
    assert.match(flexibleTranslationPrompt, /into Swahili\. Detect the source language automatically/);
    await page.unroute("https://api.openai.com/v1/responses");
    await page.setViewportSize({ width: 412, height: 915 });
    const languageLayout = await page.locator(".translation-target").evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      inputRight: node.querySelector("select").getBoundingClientRect().right,
      viewport: innerWidth,
    }));
    assert.ok(languageLayout.right <= languageLayout.viewport + 1 && languageLayout.inputRight <= languageLayout.viewport + 1);
    await page.evaluate(() => ZM.nav(false));
    await page.waitForTimeout(300);
    await page.locator(".transcript-card").screenshot({ path: path.join(root, "test-results", "translation-auto-detect-phone.png") });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.evaluate(() => ZM.flush());
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    await page.evaluate((meetingId) => ZM.open(meetingId, "note"), id);
    assert.equal(await page.locator("#translationLanguage").inputValue(), "Swahili");
    assert.match(await page.locator("#noteEditor .ProseMirror").innerText(), /TRANSLATION \(English → Vietnamese\):[\s\S]*Bản dịch cuộc họp\./);
    assert.match(await page.locator("#noteEditor .ProseMirror").innerText(), /TRANSLATION \(Korean\):[\s\S]*Translated into the requested language\./);
    console.log("PASS: transcript translation and insert into persisted Notes");
    await page.locator("#noteEditor .ProseMirror").fill("Older point one\nOlder point two\nOlder point three\nOlder point four\nOlder point five");
    await page.locator("#manualTranscriptLabel").click();
    await page.locator("#transcriptInput").fill("A newly discussed warehouse issue.");
    await page.evaluate(async () => {
      await ZM.flush();
      await ZM.updateMeeting(ZM.meetingId, { summary: "<p>Previous recap.</p>", summaryType: "existing" });
      document.getElementById("aiProvider").value = "gemini";
      document.getElementById("aiModel").value = "gemini-3.5-flash";
      document.getElementById("aiApiKey").value = "test-only";
      document.getElementById("translationLanguage").value = "Vietnamese";
      document.getElementById("translationLanguage").dispatchEvent(new Event("change"));
    });
    await page.route("https://generativelanguage.googleapis.com/**", (route) =>
      route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "NEW TRANSLATED WAREHOUSE FINDING. The receiving area has limited space for the next delivery and the current storage layout blocks a loading path. The site team needs to check capacity, mark blocked zones, and confirm a revised layout. Operations should receive the updated plan before the delivery date." }] } }] } }),
    );
    await page.locator("#translateTranscriptBtn").click();
    await page.waitForFunction(() => document.getElementById("translationOutput").textContent.includes("NEW TRANSLATED"));
    await page.locator("#addTranslationToNotesBtn").click();
    await page.evaluate(() => ZM.flush());
    assert.match(await page.evaluate(() => ZM.current().note), /NEW TRANSLATED WAREHOUSE FINDING/);
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.evaluate(() => { document.getElementById("aiProvider").value = "quick"; ZM.tab = "summary"; ZM.renderEditor(false); });
    await page.locator("#generateSummaryBtn").click();
    await page.waitForFunction(() => ZM.current().summaryType === "quick");
    await page.waitForFunction(() => document.getElementById("summaryOutput").textContent.includes("NEW TRANSLATED WAREHOUSE FINDING"));
    assert.match(await page.locator("#summaryOutput").textContent(), /NEW TRANSLATED WAREHOUSE FINDING/);
    let refreshedPrompt, digestPrompt;
    await page.evaluate(() => {
      document.getElementById("aiProvider").value = "gemini";
      document.getElementById("aiModel").value = "gemini-3.5-flash";
      document.getElementById("aiApiKey").value = "test-only";
    });
    await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
      const prompt = route.request().postDataJSON().contents[0].parts[0].text;
      await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: prompt.startsWith("Summarize ONLY") ? "<p>This is about a warehouse issue.</p>" : "<h3>Overview</h3><p>Earlier meeting context.</p>" }] } }] } });
    });
    await page.locator("#generateSummaryBtn").click();
    await page.waitForFunction(() => document.getElementById("recapStatus").textContent.includes("did not summarize"));
    assert.match(await page.locator("#summaryOutput").textContent(), /NEW TRANSLATED WAREHOUSE FINDING/);
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
      const prompt = route.request().postDataJSON().contents[0].parts[0].text;
      if (prompt.startsWith("Summarize ONLY")) digestPrompt = prompt;
      else refreshedPrompt = prompt;
      await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: prompt.startsWith("Summarize ONLY")
        ? "- Warehouse finding changes the receiving workflow and needs a capacity check before the next delivery.\n- Confirm the revised storage layout with the site team and record any blocked areas.\n- Send the updated plan to the operations owner after the capacity review."
        : "<h3>Overview</h3>\nNew warehouse finding included.\n\n### Action items\n- Confirm warehouse capacity\n- Send revised plan" }] } }] } });
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.locator("#generateSummaryBtn").click();
    await page.waitForFunction(() => ZM.current().summaryType === "ai");
    assert.match(refreshedPrompt, /NEW TRANSLATED WAREHOUSE FINDING/);
    assert.match(digestPrompt, /NEW TRANSLATED WAREHOUSE FINDING/);
    assert.match(await page.locator("#summaryOutput").textContent(), /changes the receiving workflow/);
    assert.equal(await page.locator("#summaryOutput h3").count(), 3);
    assert.equal(await page.locator("#summaryOutput li").count(), 5);
    const phoneRecap = await page.locator("#summaryOutput").evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      viewport: innerWidth,
      paragraphMargin: parseFloat(getComputedStyle(node.querySelector("p")).marginBottom),
    }));
    assert.ok(phoneRecap.right <= phoneRecap.viewport + 1 && phoneRecap.paragraphMargin >= 8);
    await page.screenshot({ path: path.join(root, "test-results", "recap-translation-pixel6.png"), fullPage: true });
    assert.match(await page.evaluate(() => ZM.formatAiText("### Older recap\n- First point\n- Second point")), /<h3>Older recap<\/h3><ul><li>First point<\/li><li>Second point<\/li><\/ul>/);
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    await page.evaluate((meetingId) => ZM.open(meetingId, "summary"), id);
    assert.equal(await page.locator("#summaryOutput li").count(), 5);
    assert.equal(await page.locator("#summaryOutput h3").count(), 3);
    assert.match(await page.evaluate(() => ZM.formatAiText("<h3>Overview</h3>\nText after HTML.\n\n### Tasks\n- First\n- Second")), /<h3>Overview<\/h3><p>Text after HTML\.<\/p><h3>Tasks<\/h3><ul><li>First<\/li><li>Second<\/li><\/ul>/);
    await page.unroute("https://generativelanguage.googleapis.com/**");
    let openaiDigestPrompt;
    await page.evaluate(() => {
      document.getElementById("aiProvider").value = "openai";
      document.getElementById("aiModel").value = "gpt-4.1-mini";
      document.getElementById("aiApiKey").value = "test-only";
    });
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      const prompt = route.request().postDataJSON().input;
      if (prompt.startsWith("Summarize ONLY")) openaiDigestPrompt = prompt;
      await route.fulfill({ json: { output: [{ content: [{ text: prompt.startsWith("Summarize ONLY")
        ? "<ul><li>Check available receiving capacity before delivery because the current area is constrained.</li><li>Mark the blocked loading route and confirm a revised storage layout with the site team.</li><li>Send the agreed layout and timing to operations before the delivery date.</li></ul>"
        : "<h3>Overview</h3><p>Warehouse coordination is the main topic.</p>" }] }] } });
    });
    await page.locator("#generateSummaryBtn").click();
    await page.waitForFunction(() => document.getElementById("recapStatus").textContent === "Recap saved.");
    assert.match(openaiDigestPrompt, /NEW TRANSLATED WAREHOUSE FINDING/);
    assert.match(await page.locator("#summaryOutput").textContent(), /blocked loading route/);
    assert.equal(await page.locator("#appNotice").isVisible(), false);
    await page.unroute("https://api.openai.com/v1/responses");
    let unstructuredCalls = 0;
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      const prompt = route.request().postDataJSON().input;
      if (!prompt.startsWith("Summarize ONLY")) unstructuredCalls++;
      const response = prompt.startsWith("Summarize ONLY")
        ? "<ul><li>The receiving space is limited and needs a capacity check before the next delivery.</li><li>The blocked loading route requires an agreed revised layout with the site team.</li><li>Operations should receive the plan before the delivery date.</li></ul>"
        : unstructuredCalls === 1
          ? "<p>Dưới đây là bản dịch nội dung cuộc họp: **Tiêu đề:** ChipMong **Ngày:** 15/10/2026 **Bản ghi chép:** " + "Nội dung ghi âm được chép lại nguyên văn. ".repeat(12) + "</p>"
          : "<h3>Overview</h3><p>Receiving capacity and layout need review.</p><h3>Action items</h3><ul><li>Confirm the layout with operations.</li></ul>";
      await route.fulfill({ json: { output: [{ content: [{ text: response }] }] } });
    });
    await page.locator("#generateSummaryBtn").click();
    await page.waitForFunction(() => document.getElementById("recapStatus").textContent === "Recap saved.");
    assert.equal(unstructuredCalls, 2);
    assert.equal(await page.locator("#summaryOutput h3").count(), 3);
    assert.doesNotMatch(await page.locator("#summaryOutput").textContent(), /Dưới đây là bản dịch/);
    await page.unroute("https://api.openai.com/v1/responses");
    console.log("PASS: translated Notes refresh existing Gemini/OpenAI recaps; weak digests fail safely and mobile mixed formatting stays structured");
    const phoneMarkdownHtml = "<p>Dưới đây là phần nội dung đã được dịch hoàn chỉnh sang tiếng Việt, giữ nguyên ngữ cảnh và văn phong trao đổi trong cuộc họp: **Thông tin cuộc họp:** **Tiêu đề:** ChipMong **Ngày:** 15/10/2026 - 09:00 **Bản ghi chép (Transcript):** Bản ghi âm 1: Đây là các yêu cầu của họ. Những gì họ cần là chúng ta đưa ra một đề xuất kỹ thuật kèm theo báo giá thương mại. Kế hoạch bao gồm các công ty khác trong tập đoàn.</p>";
    await page.evaluate(async ({ meetingId, summary }) => {
      await ZM.updateMeeting(meetingId, { summary, summaryType: "ai" });
    }, { meetingId: id, summary: phoneMarkdownHtml });
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    await page.evaluate((meetingId) => ZM.open(meetingId, "summary"), id);
    await page.waitForFunction(() => document.querySelector("#summaryOutput h3")?.textContent === "Thông tin cuộc họp");
    assert.equal(await page.locator("#summaryOutput").textContent().then((text) => text.includes("**")), false);
    assert.equal(await page.locator("#summaryOutput h3").count(), 1);
    assert.ok(await page.locator("#summaryOutput p").count() >= 4);
    assert.match(await page.locator("#summaryOutput strong").allTextContents().then((texts) => texts.join(" ")), /Tiêu đề:.*Ngày:.*Bản ghi chép/);
    assert.match(await page.evaluate(() => ZM.formatAiText("**Thông tin cuộc họp:** **Tiêu đề:** ChipMong **Ngày:** 15/10/2026")), /<h3>Thông tin cuộc họp<\/h3><p><strong>Tiêu đề:<\/strong> ChipMong<\/p><p><strong>Ngày:<\/strong> 15\/10\/2026<\/p>/);
    assert.match(await page.evaluate(() => ZM.formatAiText('<p>**Overview:** see <a href="https://example.org/source">source</a></p>')), /<strong>Overview:<\/strong> see <a href="https:\/\/example.org\/source"/);
    const phoneStored = await page.locator("#summaryOutput").evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      viewport: innerWidth,
      paragraphMargin: parseFloat(getComputedStyle(node.querySelector("p")).marginBottom),
    }));
    assert.ok(phoneStored.right <= phoneStored.viewport + 1 && phoneStored.paragraphMargin >= 8);
    await page.setViewportSize({ width: 360, height: 800 });
    assert.ok(await page.locator("#summaryOutput").evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 1));
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(root, "test-results", "recap-saved-mixed-format-pixel6.png"), fullPage: true });
    console.log("PASS: previously saved phone recap with HTML-wrapped inline Markdown renders headings and separate fields after reload");
    await page.evaluate(() => ZM.navigate("overview"));
    assert.deepEqual(
      await page.locator("#overviewView .ov-grid h2").allTextContents(),
      ["Tasks", "Recent", "Latest field photos"],
    );
    await page.evaluate(() => ZM.navigate("meetings"));
    assert.equal(
      await page.locator("#homeView .section-head h2").textContent(),
      "My meetings",
    );
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
        if (section === "overview") {
          const cards = await page
            .locator("#overviewView .ov-grid .ov-card")
            .evaluateAll((nodes) =>
              nodes.map((node) => {
                const box = node.getBoundingClientRect();
                return { top: box.top, bottom: box.bottom, left: box.left };
              }),
            );
          assert.ok(
            cards[0].bottom <= cards[1].top,
            "Tasks must precede Recent at " + width,
          );
          if (width < 1100)
            assert.ok(
              cards[1].bottom <= cards[2].top,
              "Photos must follow Recent at " + width,
            );
          else
            assert.ok(
              cards[2].left > cards[0].left,
              "Photos must occupy the right column",
            );
        }
      }
      await page.evaluate((meetingId) => ZM.open(meetingId, "summary"), id);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
        "recap overflow at " + width,
      );
      if (width === 360)
        await page.screenshot({
          path: path.join(root, "test-results", "phone.png"),
          fullPage: true,
          animations: "disabled",
        });
      await page.evaluate((meetingId) => ZM.open(meetingId, "note"), id);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
        false,
        "notes and transcript overflow at " + width,
      );
      if (width === 360)
        await page.screenshot({ path: path.join(root, "test-results", "phone-notes.png"), fullPage: true, animations: "disabled" });
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
      legacyFiles = [],
      folders = [],
      withheldUploadIds = new Set();
    let phoneCanSeeDrive = true,
      withholdNewUploads = false;
    const routeDrive = async (route, hideDrive = false) => {
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
        if (withholdNewUploads) withheldUploadIds.add(id);
        result = { id };
      } else if (request.method() === "POST") {
        const id = "folder-" + folders.length;
        folders.push({ id });
        result = { id };
      } else if (url.searchParams.get("alt") === "media")
        result = [...drive, ...legacyFiles].find((f) =>
          url.pathname.endsWith("/" + f.id),
        ).payload;
      else {
        const q = url.searchParams.get("q") || "";
        result = {
          files: q.includes("appProperties")
            ? (hideDrive
                ? []
                : drive.filter((f) => !withheldUploadIds.has(f.id) && (!q.includes("value='") || q.includes("value='" + f.appProperties?.zminutes + "'")))
              ).map(({ payload, ...f }) => f)
            : q.includes("name='zminutes-sync.json'")
              ? legacyFiles.map(({ payload, ...f }) => f)
              : q.includes("folder")
                ? folders
                : [],
        };
      }
      await route.fulfill({ json: result });
    };
    await context.route("https://www.googleapis.com/**", (route) =>
      routeDrive(route),
    );
    const contextB = await browser.newContext({
      viewport: { width: 800, height: 1000 },
    });
    await contextB.route("https://www.googleapis.com/**", (route) =>
      routeDrive(route, !phoneCanSeeDrive),
    );
    const phone = await contextB.newPage();
    await phone.goto(base);
    await phone.waitForFunction(() => ZM?.ready);
    for (const p of [page, phone])
      await p.evaluate(() => {
        document.getElementById("driveClientId").value =
          "test.apps.googleusercontent.com";
        window.__authRequests = 0;
        window.google = {
          accounts: {
            oauth2: {
              initTokenClient: (options) => ({
                requestAccessToken: () => {
                  window.__authRequests++;
                  options.callback({ access_token: "test-only" });
                },
              }),
            },
          },
        };
      });
    await phone.evaluate(() => ZM.sync.sync());
    assert.equal(
      drive.length,
      0,
      "An empty new device must not upload over Drive",
    );
    await page.evaluate(() => ZM.sync.sync());
    assert.equal(drive.length, 0, "First-device setup must be explicit");
    assert.match(
      await page.locator("#syncState").textContent(),
      /no Drive history visible/,
    );
    await page.evaluate(() => ZM.navigate("settings"));
    await page.locator("#startDriveHistoryBtn").click();
    await page.waitForFunction(() =>
      document.getElementById("syncState").textContent.startsWith("Synced"),
    );
    await phone.evaluate(() => ZM.sync.sync());
    assert.equal(await phone.evaluate(() => ZM.data.meetings.length), 2);
    await page.screenshot({ path: path.join(root, "test-results", "notes-v14-sync-v3.png") });
    assert.equal(
      await phone.evaluate(
        () =>
          ZM.data.meetings.find((m) => m.title === "Cuộc họp kiểm thử").audioId,
      ),
      "",
    );
    await page.evaluate((id) => ZM.open(id), id);
    await page.locator("#noteEditor .ProseMirror").fill("Edited on PC");
    await page.evaluate(() => ZM.flush());
    await phone.evaluate((id) => ZM.open(id), id);
    await phone.locator("#noteEditor .ProseMirror").fill("Edited on phone");
    await phone.evaluate(() => ZM.flush());
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
        v = c.versions.find((v) => v.value?.note?.includes("Edited on PC")).value,
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
    assert.match(
      await phone.evaluate(
        (id) => ZM.data.meetings.find((m) => m.id === id).note,
        id,
      ),
      /Edited on PC/,
    );
    assert.equal(await phone.evaluate(() => ZM.conflicts.length), 0);
    assert.ok(
      drive.every((f) => !JSON.stringify(f.payload).includes("data:audio")),
    );
    const phoneMeetingId = await phone.evaluate(async () => {
      const id = crypto.randomUUID();
      await ZM.save("meetings", {
        id,
        projectId: "inbox",
        title: "Phone-created meeting",
        note: "Important new phone notes",
        date: "2026-10-22T14:00",
        agenda: [
          {
            id: crypto.randomUUID(),
            text: "Phone question",
            note: "Phone answer",
          },
        ],
      });
      return id;
    });
    withholdNewUploads = true;
    await phone.evaluate(() => ZM.sync.sync());
    assert.ok(
      await phone.evaluate(
        async (id) =>
          (await ZMinutesStore.pending()).some((op) => op.entityId === id),
        phoneMeetingId,
      ),
      "An unlisted upload must remain pending",
    );
    assert.match(
      await phone.locator("#syncState").textContent(),
      /needs attention/,
    );
    withholdNewUploads = false;
    withheldUploadIds.clear();
    const uploadsBeforeRetry = drive.length;
    await phone.evaluate(() => ZM.sync.sync());
    assert.equal(
      drive.length,
      uploadsBeforeRetry,
      "Retry must reuse the verified change file",
    );
    assert.equal(
      await phone.evaluate(
        (id) => ZM.data.meetings.find((m) => m.id === id)?.note,
        phoneMeetingId,
      ),
      "Important new phone notes",
    );
    await page.evaluate(() => ZM.sync.sync());
    assert.equal(
      await page.evaluate(
        (id) => ZM.data.meetings.find((m) => m.id === id)?.note,
        phoneMeetingId,
      ),
      "Important new phone notes",
    );
    await phone.evaluate(() => ZM.sync.sync());
    assert.equal(
      await phone.evaluate(
        (id) => ZM.data.meetings.find((m) => m.id === id)?.agenda[0].note,
        phoneMeetingId,
      ),
      "Phone answer",
    );
    phoneCanSeeDrive = false;
    await phone.evaluate(() => ZM.sync.sync());
    assert.match(
      await phone.locator("#syncState").textContent(),
      /no Drive history visible/,
    );
    phoneCanSeeDrive = true;
    legacyFiles.push({
      id: "legacy-snapshot",
      name: "zminutes-sync.json",
      modifiedTime: "2026-10-11T00:00:00Z",
      payload: {
        app: "zMinutes",
        projects: [{ id: "inbox", name: "Personal Workspace" }],
        meetings: [
          { id: phoneMeetingId, title: "Stale PC copy", note: "old" },
          { id: "stale-only", title: "Old snapshot record" },
        ],
      },
    });
    await phone.evaluate(() => ZM.sync.sync());
    assert.equal(
      await phone.evaluate(
        (id) => ZM.data.meetings.find((m) => m.id === id)?.note,
        phoneMeetingId,
      ),
      "Important new phone notes",
    );
    assert.equal(
      await phone.evaluate(() =>
        ZM.data.meetings.some((m) => m.id === "stale-only"),
      ),
      false,
    );
    const activeFiles = drive.splice(0);
    await phone.evaluate(() => ZM.sync.sync());
    assert.equal(
      drive.length,
      0,
      "Do not upload local work into a legacy-only Drive",
    );
    assert.match(
      await phone.locator("#syncState").textContent(),
      /Sync paused · old Drive snapshot found/,
    );
    await phone.evaluate(() => ZM.navigate("settings"));
    await phone.locator("#scanDriveHistoryBtn").click();
    await phone.getByText("Current Drive copy").waitFor();
    await phone.locator("[data-preview-version='0']").click();
    await phone.waitForFunction(() =>
      document
        .getElementById("dataRecoveryList")
        .textContent.includes("Stale PC copy"),
    );
    drive.push(...activeFiles);
    legacyFiles.length = 0;
    const authBeforeClientChange = await page.evaluate(() => __authRequests);
    await page.evaluate(() => {
      document.getElementById("driveClientId").value =
        "new-client.apps.googleusercontent.com";
      document.getElementById("saveDriveClientBtn").click();
    });
    await page.waitForFunction(() =>
      document
        .getElementById("syncState")
        .textContent.includes("Ready · tap Sync now"),
    );
    await page.evaluate(() => ZM.sync.sync());
    assert.equal(
      await page.evaluate(() => __authRequests),
      authBeforeClientChange + 1,
    );
    console.log(
      "PASS: two-device sync, fresh phone meeting, upload verification, changed Client ID, and legacy safety",
    );
    await page.evaluate(async () => {
      const calendar = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:company-42",
        "SUMMARY:Company planning",
        "DTSTART;TZID=Asia/Ho_Chi_Minh:20261020T093000",
        "LOCATION:Conference room",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const file = new File([calendar], "company.ics", {
        type: "text/calendar",
      });
      await ZM.exports.importCalendar(file);
      await ZM.exports.importCalendar(file);
    });
    assert.equal(
      await page.evaluate(
        () =>
          ZM.data.meetings.filter((m) => m.externalCalendarUid === "company-42")
            .length,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(() =>
        new Date(
          ZM.data.meetings.find(
            (m) => m.externalCalendarUid === "company-42",
          ).date,
        ).toISOString(),
      ),
      "2026-10-20T02:30:00.000Z",
    );
    await page.evaluate(async () => {
      await ZM.save("tasks", {
        id: "reminder-task",
        title: "Call supplier",
        due: "2026-10-20",
        remindAt: "2026-10-19T09:00",
      });
    });
    assert.ok(
      await page.evaluate(() =>
        ZM.reminders
          .due(new Date("2026-10-19T09:01:00"))
          .some((r) => r.body === "Call supplier"),
      ),
    );
    console.log(
      "PASS: calendar import is idempotent and task reminder becomes due",
    );
    await phone.evaluate(async (id) => {
      await ZMinutesStore.remove("meetings", id);
      await ZM.reload();
      await ZM.navigate("settings");
    }, phoneMeetingId);
    await phone.locator("#scanLocalHistoryBtn").click();
    await phone.waitForFunction(() =>
      document
        .getElementById("dataRecoveryList")
        .textContent.includes("Phone-created meeting"),
    );
    console.log("PASS: recovery preview identifies missing meeting by title");
    drive.push({ id: "late-old-client", modifiedTime: "2026-10-25T10:00:00Z",
      appProperties: { zminutes: "changes-v2" }, payload: { app: "zMinutes", format: "changes-v2",
        ops: [{ id: "old-client-edit", kind: "meetings", entityId: id, parents: [],
          value: { id, projectId: "inbox", title: "Old client late edit", note: "Late v2 Notes", updated: Date.now() } }], media: {} } });
    const beforeLateSync = await page.evaluate((meetingId) => ZM.data.meetings.find((m) => m.id === meetingId).noteDoc, id);
    await page.evaluate(() => ZM.sync.sync());
    assert.equal(JSON.stringify(await page.evaluate((meetingId) => ZM.data.meetings.find((m) => m.id === meetingId).noteDoc, id)), JSON.stringify(beforeLateSync));
    await page.evaluate(() => ZM.navigate("settings"));
    await page.locator("#scanLegacyChangesBtn").click();
    await page.waitForFunction(() => document.getElementById("dataRecoveryList").textContent.includes("Old client late edit"));
    await page.locator("[data-import-legacy]").first().click();
    assert.ok(await page.evaluate(() => ZM.data.meetings.some((m) => m.title === "Old client late edit (Recovered copy)")));
    console.log("PASS: late v2 client cannot overwrite v3 Notes; explicit recovery imports a copy");
    await page.evaluate(async () => {
      await ZM.save("meetings", { id: "legacy-rich-note", projectId: "inbox", title: "Legacy Markdown", note: "**Original**\n- First item\n✓ ACTION ITEM: Follow up" });
      await ZM.open("legacy-rich-note");
    });
    await page.waitForFunction(() => ZM.current()?.noteDoc && document.querySelector("#noteEditor .ProseMirror")?.getAttribute("contenteditable") === "true");
    await page.screenshot({ path: path.join(root, "test-results", "notes-v14-migration.png") });
    assert.equal(await page.evaluate(() => ZM.current().noteOriginalMarkdown), "**Original**\n- First item\n✓ ACTION ITEM: Follow up");
    assert.ok((await page.evaluate(() => ZMinutesStore.noteMigrationBackups())).some((b) => b.meetingId === "legacy-rich-note"));
    const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
    await page.locator("#noteImageInput").setInputFiles({ name: "inline.png", mimeType: "image/png", buffer: imageBytes });
    await page.waitForFunction(() => ZM.current()?.noteDoc?.content?.some((block) => JSON.stringify(block).includes("meetingImage")));
    const inlinePhotoId = await page.evaluate(() => ZM.current().photos.at(-1).id);
    assert.ok(await page.evaluate((photoId) => ZM.current().photos.some((p) => p.id === photoId && p.mediaId), inlinePhotoId));
    await page.evaluate(() => ZM.flush());
    await page.reload();
    await page.waitForFunction(() => ZM?.ready);
    await page.evaluate(() => ZM.open("legacy-rich-note", "field"));
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(`[data-remove-photo="${inlinePhotoId}"]`).click();
    await page.waitForFunction(() => ZM.tab === "note");
    assert.ok(await page.evaluate((photoId) => ZM.current().photos.some((p) => p.id === photoId), inlinePhotoId));
    await page.locator("#noteEditor img[data-photo-id]").waitFor();
    console.log("PASS: legacy Notes recovery, inline shared image, reload and deletion guard");
    for (const [name, width, height] of [["desktop", 1366, 900], ["pixel6", 412, 915], ["et40", 800, 1280]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => ZM.nav(false));
      await page.waitForTimeout(450);
      const layout = await page.evaluate(() => {
        const writer = document.querySelector(".notes-writing").getBoundingClientRect();
        const context = document.querySelector(".notes-context").getBoundingClientRect();
        const toolbar = document.querySelector(".note-toolbar").getBoundingClientRect();
        return { writer: { right: writer.right, bottom: writer.bottom }, context: { left: context.left, top: context.top }, toolbar: { width: toolbar.width, right: toolbar.right }, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth };
      });
      assert.ok(layout.scrollWidth <= layout.viewport + 1, `${name}: horizontal overflow`);
      assert.ok(layout.toolbar.width > 0 && layout.toolbar.right <= layout.viewport + 1, `${name}: toolbar clipped`);
      if (name === "desktop") assert.ok(layout.context.left >= layout.writer.right, "desktop: audio must sit beside notes");
      else assert.ok(layout.context.top >= layout.writer.bottom, `${name}: audio must follow notes`);
      await page.screenshot({ path: path.join(root, "test-results", `notes-redesign-${name}.png`), fullPage: true });
      await page.screenshot({ path: path.join(root, "test-results", `notes-redesign-${name}-viewport.png`) });
    }
    await page.locator("#noteStyleBtn").click();
    assert.equal(await page.locator("#noteStyleMenu").isVisible(), true);
    await page.screenshot({ path: path.join(root, "test-results", "notes-redesign-et40-format-menu.png") });
    for (const [name, setup] of [
      ["recap", () => { ZM.tab = "summary"; ZM.renderEditor(false); }],
      ["agenda", () => { ZM.tab = "agenda"; ZM.renderEditor(false); }],
      ["people", () => { ZM.tab = "stakeholders"; ZM.renderEditor(false); }],
      ["field", () => { ZM.tab = "field"; ZM.renderEditor(false); }],
      ["overview", () => { ZM.meetingId = null; ZM.section = "overview"; ZM.render(); }],
      ["meetings", () => { ZM.section = "meetings"; ZM.render(); }],
      ["tasks", () => { ZM.section = "tasks"; ZM.render(); }],
      ["settings", () => { ZM.section = "settings"; ZM.render(); }],
      ["calendar", () => { ZM.section = "calendar"; ZM.render(); }],
      ["files", () => { ZM.section = "files"; ZM.render(); }],
      ["project-field", () => { ZM.section = "field"; ZM.render(); }],
    ]) {
      await page.evaluate(setup);
      for (const [device, width, height] of [["desktop", 1366, 900], ["pixel6", 412, 915], ["et40", 800, 1280]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => ZM.nav(false));
        await page.waitForTimeout(350);
        const metrics = await page.evaluate(() => {
          const top = document.querySelector(".topbar").getBoundingClientRect();
          return { page: document.documentElement.scrollWidth, viewport: innerWidth, topRight: top.right };
        });
        assert.ok(metrics.page <= metrics.viewport + 1, `${name} ${device}: page overflows horizontally`);
        assert.ok(metrics.topRight <= metrics.viewport + 1, `${name} ${device}: app bar clipped`);
        const fields = await page.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]):not(.title-input), select').evaluateAll((nodes) =>
          nodes.filter((n) => n.getBoundingClientRect().width && n.getBoundingClientRect().height).map((n) => ({
            id: n.id, height:n.getBoundingClientRect().height, font:getComputedStyle(n).fontFamily, size:getComputedStyle(n).fontSize,
            right:n.getBoundingClientRect().right, viewport:innerWidth
          })));
        for (const field of fields) {
          assert.ok(Math.abs(field.height - 44) < 1, `${name} ${device}: ${field.id} inconsistent field height ${field.height}`);
          assert.ok(field.font.includes("Segoe UI"), `${name}: ${field.id} inconsistent font`);
          assert.equal(field.size, width <= 799 ? "16px" : "14px", `${name}: ${field.id} inconsistent field type size`);
          assert.ok(field.right <= field.viewport + 1, `${name}: ${field.id} clipped`);
        }
        await page.screenshot({ path: path.join(root, "test-results", `ui-${name}-${device}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 412, height: 915 });
    await page.evaluate(() => { ZM.section = "meetings"; ZM.render(); ZM.nav(false); });
    await page.locator(".meeting-menu summary").first().click();
    assert.equal(await page.locator(".meeting-menu .delete-btn").first().isVisible(), true);
    await page.locator(".top-more summary").click();
    assert.equal(await page.locator("#backupBtn").isVisible(), true);
    for (const id of ["aiSettingsBtn", "installBtn", "restoreBtn", "importMeetingBtn"]) {
      assert.equal(await page.locator(`#${id}`).isVisible(), true, `${id}: missing from mobile More menu`);
      const box = await page.locator(`#${id}`).boundingBox();
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 413, `${id}: clipped or undersized`);
    }
    assert.equal(await page.locator(".proj-nav .nav-item .ui-icon").count(), 6);
    await page.screenshot({ path: path.join(root, "test-results", "toolbar-more-pixel6.png") });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".top-more").evaluate((el) => el.open), false);
    assert.equal(await page.locator(".top-more summary").evaluate((el) => el === document.activeElement), true);
    await page.locator(".top-more summary").click();
    await page.locator("#aiSettingsBtn").click();
    await page.waitForFunction(() => ZM.section === "settings");
    assert.equal(await page.locator(".top-more").evaluate((el) => el.open), false);
    await page.locator(".top-more summary").click();
    // Tap the page margin, outside the floating menu (which overlaps the heading).
    await page.mouse.click(5, 450);
    assert.equal(await page.locator(".top-more").evaluate((el) => el.open), false);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.locator(".top-more summary").click();
    await page.screenshot({ path: path.join(root, "test-results", "toolbar-more-desktop.png") });
    await page.keyboard.press("Escape");
    await page.unroute("https://generativelanguage.googleapis.com/**");
    await page.unroute("https://api.openai.com/**");
    const liveCalls = [];
    await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
      liveCalls.push({ provider: "gemini", url: route.request().url() });
      await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "Gemini live text" }] } }] } });
    });
    await page.route("https://api.openai.com/**", async (route) => {
      liveCalls.push({ provider: "openai", body: route.request().postData() });
      await route.fulfill({ json: { text: "OpenAI live text" } });
    });
    for (const provider of ["gemini", "openai"]) {
      const liveId = await page.evaluate(async (provider) => {
        const id = crypto.randomUUID();
        await ZM.save("meetings", { id, title: "Live test " + provider, projectId: "inbox", cloudAudioAllowed: true });
        await ZM.open(id, "note"); ZM.nav(false);
        document.getElementById("transcriptionProvider").value = provider;
        document.getElementById("transcriptionModel").value = "chosen-" + provider + "-audio-model";
        document.getElementById("transcriptionApiKey").value = "test-key";
        return id;
      }, provider);
      await page.locator("#liveDraftEnabled").check();
      await page.locator("#recordBtn").click();
      await page.waitForFunction(() => document.getElementById("recordLabel").textContent === "Recording");
      assert.equal(await page.locator("#liveDraftPanel").isVisible(), true);
      await page.waitForTimeout(1200);
      await page.locator("#globalStopBtn").click();
      await page.waitForFunction(() => !ZM.recording && !ZM.live.busy);
      assert.equal(await page.locator("#liveDraftEnabled").isChecked(), false);
      const saved = await page.evaluate((id) => {
        const m = ZM.data.meetings.find((m) => m.id === id);
        return { recordings: m.recordings.length, segments: m.transcriptSegments.length, text: ZMinutesModel.fullTranscript(m) };
      }, liveId);
      assert.equal(saved.recordings, 1); assert.equal(saved.segments, 1);
      assert.match(saved.text, /live text/);
      const calls = liveCalls.filter((call) => call.provider === provider);
      assert.equal(calls.length, 1, "Live stop must not retranscribe full audio automatically");
      assert.ok((calls[0].url || calls[0].body).includes("chosen-" + provider + "-audio-model"));
    }
    await page.setViewportSize({ width: 412, height: 915 });
    await page.evaluate(() => { ZM.nav(false); window.scrollTo(0, 0); });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(root, "test-results", "live-draft-phone.png") });
    await page.reload();
    await page.waitForFunction(() => window.ZM?.ready);
    assert.ok(await page.evaluate(() => ZM.data.meetings.filter((m) => m.title.startsWith("Live test ")).every((m) => m.recordings.length === 1 && m.transcriptSegments.length === 1)));
    console.log("PASS: opt-in Live draft captures audio, respects custom Gemini/OpenAI models, saves transcript and avoids duplicate transcription");
    const feedbackPage = await context.newPage();
    await feedbackPage.goto(base);
    await feedbackPage.waitForFunction(() => window.ZM?.ready);
    await feedbackPage.clock.install();
    await feedbackPage.mouse.move(0, 0);
    await feedbackPage.evaluate(() => ZM.notice("Success"));
    await feedbackPage.clock.runFor(3999);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), true);
    await feedbackPage.clock.runFor(2);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), false);
    console.log("PASS: success notification expires after four seconds");
    await feedbackPage.evaluate(() => ZM.notice("Error", true));
    await feedbackPage.clock.runFor(7999);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), true);
    await feedbackPage.clock.runFor(2);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), false);
    await feedbackPage.evaluate(() => ZM.notice("First"));
    await feedbackPage.clock.runFor(3000);
    await feedbackPage.evaluate(() => ZM.notice("Replacement"));
    await feedbackPage.clock.runFor(1001);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), true);
    await feedbackPage.locator("#appNotice").hover();
    await feedbackPage.clock.runFor(9000);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), true);
    await feedbackPage.mouse.move(0, 0);
    await feedbackPage.locator("#appNotice button").focus();
    await feedbackPage.clock.runFor(9000);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), true);
    await feedbackPage.locator("#appNotice button").click();
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), false);
    await feedbackPage.mouse.move(0, 0);
    await feedbackPage.evaluate(() => {
      document.activeElement.blur();
      ZM.feedback.show("test-critical", "Not saved", { critical: true, error: true, label: "Unsaved test data" });
    });
    await feedbackPage.clock.runFor(8001);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), false);
    assert.equal(await feedbackPage.locator(".issue-badge").filter({ hasText: "Unsaved test data" }).isVisible(), true);
    await feedbackPage.evaluate(() => ZM.feedback.resolve("test-critical"));
    assert.equal(await feedbackPage.locator(".issue-badge").filter({ hasText: "Unsaved test data" }).count(), 0);
    await feedbackPage.evaluate(() => ZM.feedback.show("long-job", "Working", { busy: true }));
    await feedbackPage.clock.fastForward(60000);
    assert.equal(await feedbackPage.locator("#appNotice").isVisible(), true);
    await feedbackPage.evaluate(() => ZM.feedback.resolve("long-job"));
    console.log("PASS: error timers, replacement, hover/focus, dismissal and critical notification lifecycle");
    await feedbackPage.evaluate(async () => {
      await ZM.navigate("settings");
      window.realReduce = ZMinutesModel.reduce;
      window.mockConflicts = [];
      ZMinutesModel.reduce = () => ({ conflicts: window.mockConflicts });
      await ZM.renderConflicts();
    });
    assert.equal(await feedbackPage.locator("#installHelp").count(), 0);
    assert.equal(await feedbackPage.locator("#conflictCount").textContent(), "0");
    assert.equal(await feedbackPage.locator("#syncConflictsDetails").evaluate((el) => el.open), false);
    await feedbackPage.locator("#syncConflictsDetails > summary").click();
    for (const count of [1, 4]) {
      await feedbackPage.evaluate(async (count) => {
        window.mockConflicts = Array.from({ length: count }, (_, i) => ({
          id: "test-" + i, kind: "meetings", versions: [{ value: { title: "Test conflict " + i } }, { value: null }],
        }));
        await ZM.renderConflicts();
      }, count);
      assert.equal(await feedbackPage.locator("#conflictCount").textContent(), String(count));
      assert.equal(await feedbackPage.locator("#syncConflictsDetails").evaluate((el) => el.open), true);
    }
    await feedbackPage.locator("#syncConflictsDetails > summary").click();
    await feedbackPage.evaluate(async () => {
      ZMinutesModel.reduce = window.realReduce;
      await ZM.renderConflicts();
      for (let i = 0; i < 2; i++) await ZMinutesStore.checkpoint({ id: "recovery-ui-" + i, title: "Interrupted test", created: Date.now(), meetingId: "missing", rate: 16000 }, 0, null);
      await ZM.audio.renderRecovery();
    });
    assert.equal(await feedbackPage.locator("#recordingRecoveryCount").textContent(), "2");
    assert.equal(await feedbackPage.locator("#recordingRecoveryDetails").evaluate((el) => el.open), false);
    await feedbackPage.locator("#recordingRecoveryDetails > summary").click();
    assert.equal(await feedbackPage.locator("#recoveryList [data-recover]").count(), 2);
    await feedbackPage.locator("#recordingRecoveryDetails > summary").click();
    for (const width of [1366, 800, 412, 360]) {
      await feedbackPage.setViewportSize({ width, height: 1000 });
      await feedbackPage.evaluate(() => { ZM.nav(false); window.scrollTo(0, 0); });
      await feedbackPage.clock.runFor(400);
      await feedbackPage.screenshot({ path: path.join(root, "test-results", `settings-build38-${width}.png`), fullPage: true });
    }
    await feedbackPage.evaluate(async () => {
      const id = crypto.randomUUID();
      await ZM.save("meetings", { id, title: "Cloud permission test", projectId: "inbox" });
      await ZM.open(id);
    });
    for (const width of [1366, 800, 412, 360]) {
      await feedbackPage.setViewportSize({ width, height: 1000 });
      await feedbackPage.locator("#liveDraftEnabled").scrollIntoViewIfNeeded();
      assert.equal(await feedbackPage.locator("#liveDraftEnabled").isVisible(), true);
      const bounds = await feedbackPage.locator(".live-option-row").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await feedbackPage.locator(".notes-audio").screenshot({
        path: path.join(root, "test-results", `live-option-build38-${width}.png`),
      });
    }
    await feedbackPage.locator("#liveDraftEnabled").check();
    await feedbackPage.locator("#recordBtn").click();
    assert.match(await feedbackPage.locator("#recordStatus").textContent(), /Enable cloud transcription/);
    await feedbackPage.locator("#liveCloudHelpBtn").click();
    await feedbackPage.locator("#meetingCloudAudioEnabled").check();
    await feedbackPage.waitForFunction(() => ZM.current().cloudAudioAllowed);
    assert.equal(await feedbackPage.locator("#recordStatus").isVisible(), false);
    console.log("PASS: notification durations, replacement, hover/focus, critical badges, Settings disclosures and cloud permission correction");
    await feedbackPage.close();
    await contextB.close();
    await context.close();
  } catch (error) {
    const pages = browser?.contexts().flatMap((context) => context.pages()) || [];
    for (const [index, failedPage] of pages.entries()) {
      await failedPage.screenshot({ path: path.join(root, "test-results", `failure-${index}.png`), fullPage: true }).catch(() => {});
      const state = await failedPage.evaluate(() => ({
        aiBusy: window.ZM?.aiBusy,
        translationLanguage: document.getElementById("translationLanguage")?.value,
        customLanguage: document.getElementById("customTranslationLanguage")?.value,
        translation: window.ZM?.translation?.language,
        notices: ["appNotice", "aiStatus", "transcriptActionStatus"].map((id) => document.getElementById(id)?.textContent),
      })).catch(() => ({}));
      fs.writeFileSync(path.join(root, "test-results", `failure-${index}.json`), JSON.stringify({ error: String(error), state }, null, 2));
    }
    throw error;
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
