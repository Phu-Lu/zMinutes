(() => {
  const A = ZM,
    $ = A.$,
    S = ZMinutesStore,
    KEY = "zminutes-ai-settings-v1";
  let cfg = A.safeRead(KEY),
    job = null;
  const defaults = {
    gemini: "gemini-2.5-flash",
    openai: "gpt-4.1-mini",
    ollama: "qwen2.5:3b",
    quick: "",
  };
  cfg = {
    provider: "quick",
    keys: {},
    transcriptionProvider: "gemini",
    ...cfg,
  };
  if (!defaults.hasOwnProperty(cfg.provider)) cfg.provider = "quick";
  if (!cfg.keys || typeof cfg.keys !== "object") cfg.keys = {};
  if (cfg.key && !cfg.keys[cfg.provider]) cfg.keys[cfg.provider] = cfg.key;
  function display() {
    const p = cfg.provider;
    $("aiProvider").value = p;
    $("aiModel").value = cfg.model ?? defaults[p];
    $("aiApiKey").value = cfg.keys?.[p] || "";
    $("ollamaUrl").value = cfg.url || "http://localhost:11434";
    $("transcriptionProvider").value = cfg.transcriptionProvider;
    $("transcriptionModel").value = cfg.transcriptionModel || "";
    $("transcriptionApiKey").value = cfg.transcriptionKey || "";
    $("cloudAudioEnabled").checked = !!cfg.cloudAudio;
    fields();
  }
  function fields() {
    const p = $("aiProvider").value;
    $("apiKeyField").classList.toggle(
      "hidden",
      ["quick", "ollama"].includes(p),
    );
    $("ollamaUrlField").classList.toggle("hidden", p !== "ollama");
    $("apiKeyLabel").textContent =
      p === "gemini" ? "Gemini API key" : "OpenAI API key";
    $("aiHelp").textContent =
      p === "quick"
        ? "A structured extract of your notes; no AI model or network request."
        : p === "ollama"
          ? "Connect to your local Ollama installation. Allow this site origin in Ollama."
          : "The selected provider receives the meeting text when you generate a recap.";
    const transcriptProvider = $("transcriptionProvider").value;
    $("transcriptionModel").placeholder =
      transcriptProvider === "gemini"
        ? "Use selected Gemini model"
        : "gpt-4o-mini-transcribe";
    $("transcriptionModelHelp").textContent =
      transcriptProvider === "gemini"
        ? "Leave blank to use your selected Gemini recap model. If your recap provider differs, Gemini uses gemini-3.5-flash. Choose a Gemini model that accepts audio."
        : "Leave blank to use gpt-4o-mini-transcribe. Your Gemini recap model does not control OpenAI transcription.";
  }
  function read() {
    return {
      ...cfg,
      provider: $("aiProvider").value,
      model: $("aiModel").value.trim(),
      url: $("ollamaUrl").value.trim(),
      keys: {
        ...cfg.keys,
        [$("aiProvider").value]: $("aiApiKey").value.trim(),
      },
      transcriptionProvider: $("transcriptionProvider").value,
      transcriptionModel: $("transcriptionModel").value.trim(),
      transcriptionKey: $("transcriptionApiKey").value.trim(),
      cloudAudio: $("cloudAudioEnabled").checked,
    };
  }
  function save() {
    const next = read();
    localStorage.setItem(KEY, JSON.stringify(next));
    cfg = next;
    $("aiSaveStatus").textContent = "Saved on this device.";
  }
  display();
  $("aiProvider").onchange = () => {
    cfg.keys = { ...cfg.keys, [cfg.provider]: $("aiApiKey").value.trim() };
    cfg.provider = $("aiProvider").value;
    $("aiModel").value = defaults[cfg.provider];
    $("aiApiKey").value = cfg.keys[cfg.provider] || "";
    fields();
    $("aiSaveStatus").textContent = "Unsaved settings";
  };
  $("transcriptionProvider").onchange = () => {
    $("transcriptionModel").value = "";
    fields();
    $("aiSaveStatus").textContent = "Unsaved settings";
  };
  $("saveAiSettingsBtn").onclick = () => A.run(save);
  $("clearAiKeysBtn").onclick = () =>
    A.run(() => {
      if (!confirm("Clear API keys on this device?")) return;
      cfg.keys = {};
      cfg.transcriptionKey = "";
      $("aiApiKey").value = $("transcriptionApiKey").value = "";
      save();
    });
  function quick(m) {
    const lines = [
        m.note,
        ZMinutesModel.fullTranscript(m),
        ...m.agenda.map((a) => a.text + " " + a.note),
      ]
        .join("\n")
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean),
      list = (xs) =>
        xs.length
          ? "<ul>" +
            xs.map((x) => "<li>" + A.esc(x) + "</li>").join("") +
            "</ul>"
          : "<p>None captured.</p>";
    return (
      "<h3>Overview</h3><p>" +
      A.esc(lines.slice(0, 4).join(" ") || "No notes yet.") +
      "</p><h3>Decisions</h3>" +
      list(lines.filter((x) => /decision|decided|agree|approved|◇/i.test(x))) +
      "<h3>Action items</h3>" +
      list(
        A.data.tasks.filter((t) => t.meetingId === m.id).map((t) => t.title),
      ) +
      "<h3>Open questions</h3>" +
      list(m.agenda.filter((a) => !a.done).map((a) => a.text))
    );
  }
  async function request(url, options, signal) {
    const controller = new AbortController(),
      abort = () => controller.abort(signal.reason);
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(new Error("AI request timed out after 90 seconds")),
      90000,
    );
    try {
      const r = await fetch(url, { ...options, signal: controller.signal }),
        d = await r.json();
      if (!r.ok)
        throw new Error(
          d.error?.message || d.error || "Provider returned " + r.status,
        );
      return d;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  async function text(m, c, signal, override) {
    const prompt =
      override ||
      (m.summaryPrompt.trim() ||
        "Summarize this meeting accurately in its original language. Return HTML using only h3, p, ul, li, strong. Sections: Overview, Decisions, Action items, Open questions. Do not invent facts.") +
        "\nMeeting data:\n" +
        JSON.stringify({
          title: m.title,
          date: m.date,
          note: m.note,
          transcript: ZMinutesModel.fullTranscript(m),
          agenda: m.agenda,
          people: m.stakeholders,
          tasks: A.data.tasks.filter((t) => t.meetingId === m.id),
        });
    const key = c.keys?.[c.provider];
    if (c.provider === "quick") return quick(m);
    if (c.provider === "ollama") {
      const d = await request(
        c.url.replace(/\/$/, "") + "/api/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: c.model,
            messages: [{ role: "user", content: prompt }],
            stream: false,
          }),
        },
        signal,
      );
      return d.message?.content || "";
    }
    if (!key)
      throw new Error("Enter the selected provider API key in Settings.");
    if (c.provider === "gemini") {
      const d = await request(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(c.model) +
          ":generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
        signal,
      );
      return (
        d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
        ""
      );
    }
    const d = await request(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify({ model: c.model, input: prompt, store: false }),
      },
      signal,
    );
    return (
      d.output_text ||
      d.output
        ?.flatMap((x) => x.content || [])
        .map((x) => x.text || "")
        .join("") ||
      ""
    );
  }
  async function run(id, work) {
    if (job)
      throw new Error("An AI request is already running. Wait or cancel it.");
    job = new AbortController();
    A.aiBusy = true;
    $("cancelAiBtn").hidden = false;
    $("generateSummaryBtn").disabled = true;
    $("generateSolutionsBtn").disabled = true;
    $("aiStatus").textContent = "Preparing meeting data…";
    try {
      await A.flush();
      const m = structuredClone(A.data.meetings.find((m) => m.id === id));
      if (!m) throw new Error("Meeting not found");
      $("aiStatus").textContent = "Working: " + m.title;
      await work(m, structuredClone(read()), job.signal);
      $("aiStatus").textContent = "Completed: " + m.title;
    } catch (e) {
      $("aiStatus").textContent =
        e.name === "AbortError" ? "Canceled" : "Failed: " + e.message;
      throw e;
    } finally {
      job = null;
      A.aiBusy = false;
      $("cancelAiBtn").hidden = true;
      $("generateSummaryBtn").disabled = false;
      $("generateSolutionsBtn").disabled = false;
    }
  }
  function recapStatus(id, message, state) {
    if (A.meetingId !== id) return;
    A.recapStatusMeetingId = id;
    const box = $("recapStatus");
    box.textContent = message;
    box.dataset.state = state;
    box.hidden = false;
  }
  async function recap(id, requireTranscript = false) {
    recapStatus(id, "Generating recap…", "working");
    try {
      await run(id, async (m, c, signal) => {
        if (requireTranscript && !ZMinutesModel.fullTranscript(m).trim())
          throw new Error("Transcribe or enter meeting content first.");
        const result = await text(m, c, signal);
        if (signal.aborted) throw new DOMException("Canceled", "AbortError");
        const summary = A.sanitize(result);
        const visible = document.createElement("div");
        visible.innerHTML = summary;
        if (!visible.textContent.trim())
          throw new Error("The provider returned an empty recap");
        await A.updateMeeting(id, {
          summary,
          summaryType: c.provider === "quick" ? "quick" : "ai",
        });
      });
      recapStatus(id, "Recap saved.", "success");
    } catch (e) {
      recapStatus(
        id,
        e.name === "AbortError"
          ? "Recap canceled."
          : "Recap failed: " + e.message,
        "error",
      );
      throw e;
    }
  }
  async function solutions(id) {
    return run(id, async (m, c, signal) => {
      if (c.provider === "quick")
        throw new Error(
          "Select Gemini, OpenAI, or Ollama in Settings for suggested solutions.",
        );
      if (m.solutionGrounding && c.provider === "ollama")
        throw new Error(
          "Offline Ollama has no built-in web search. Turn off web sources to use project data only.",
        );
      const key = c.keys?.[c.provider];
      if ((c.provider === "gemini" || c.provider === "openai") && !key)
        throw new Error("Enter your selected provider API key in Settings.");
      const project = A.data.projects.find((p) => p.id === m.projectId);
      const related = A.data.meetings
        .filter((item) => item.projectId === m.projectId)
        .sort((a, b) =>
          a.id === id ? -1 : b.id === id ? 1 : b.updated - a.updated,
        )
        .slice(0, 12)
        .map((item) => ({
          source: item.title,
          date: item.date,
          notes: item.note.slice(0, 3500),
          transcript: ZMinutesModel.fullTranscript(item).slice(0, 6000),
          recap: item.summary.replace(/<[^>]+>/g, " ").slice(0, 1800),
        }));
      const context = {
        project: project?.name || m.projectId,
        meetings: related,
        tasks: A.data.tasks
          .filter((task) => task.projectId === m.projectId)
          .slice(0, 40)
          .map((task) => ({
            title: task.title,
            status: task.status,
            due: task.due,
          })),
        fieldNotes: A.data.fieldNotes
          .filter((note) => note.projectId === m.projectId)
          .slice(0, 20)
          .map((note) => ({
            title: note.title,
            location: note.location,
            text: note.text.slice(0, 2500),
            photoCaptions: note.photos.map((p) => p.note).filter(Boolean),
          })),
      };
      const prompt =
        "Suggest practical solutions for this meeting in the original language. Return HTML using only h3, p, ul, li, strong. Include: problem, 2-3 options with tradeoffs, recommended next steps, and open assumptions. Cite internal meeting titles when using project facts. Cite web sources when available. Distinguish verified facts from suggestions; do not invent project details.\n" +
        "User objective: " +
        (m.solutionPrompt.trim() ||
          "Find actionable solutions to the issues in this meeting.") +
        "\nInternal project context:\n" +
        JSON.stringify(context).slice(0, 36000);
      let result,
        sources = [];
      if (c.provider === "gemini") {
        const response = await request(
          "https://generativelanguage.googleapis.com/v1beta/models/" +
            encodeURIComponent(c.model) +
            ":generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": key,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              ...(m.solutionGrounding
                ? { tools: [{ google_search: {} }] }
                : {}),
            }),
          },
          signal,
        );
        const candidate = response.candidates?.[0];
        result = candidate?.content?.parts
          ?.map((part) => part.text || "")
          .join("");
        sources = (candidate?.groundingMetadata?.groundingChunks || [])
          .filter((chunk) => /^https?:\/\//i.test(chunk.web?.uri || ""))
          .map((chunk) => ({
            title: chunk.web.title || chunk.web.uri,
            url: chunk.web.uri,
          }));
      } else if (c.provider === "openai") {
        const response = await request(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + key,
            },
            body: JSON.stringify({
              model: c.model,
              input:
                prompt +
                "\nFor OpenAI, return plain text with paragraph breaks rather than HTML tags.",
              store: false,
              ...(m.solutionGrounding
                ? {
                    tools: [{ type: "web_search" }],
                    tool_choice: "required",
                    include: ["web_search_call.action.sources"],
                  }
                : {}),
            }),
          },
          signal,
        );
        const content = (response.output || [])
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content || [])
          .filter((part) => part.type === "output_text");
        result = content.length
          ? content
              .map((part) => {
                const raw = part.text || "";
                const annotations = (part.annotations || [])
                  .filter(
                    (annotation) =>
                      annotation.type === "url_citation" &&
                      /^https?:\/\//i.test(annotation.url || "") &&
                      Number.isInteger(annotation.end_index),
                  )
                  .sort((a, b) => a.end_index - b.end_index);
                let at = 0;
                const chunks = [];
                for (const citation of annotations) {
                  const end = Math.min(raw.length, citation.end_index);
                  if (end <= at) continue;
                  chunks.push(A.esc(raw.slice(at, end)));
                  chunks.push(` <a href="${A.esc(citation.url)}">[source]</a>`);
                  at = end;
                }
                chunks.push(A.esc(raw.slice(at)));
                return `<p>${chunks.join("").replace(/\n/g, "<br>")}</p>`;
              })
              .join("")
          : response.output_text || "";
        const citations = content
          .flatMap((part) => part.annotations || [])
          .filter((annotation) => annotation.type === "url_citation")
          .map((annotation) => ({
            title: annotation.title || annotation.url,
            url: annotation.url,
          }));
        const searched = (response.output || [])
          .filter((item) => item.type === "web_search_call")
          .flatMap((item) => item.action?.sources || [])
          .map((source) => ({
            title: source.title || source.url,
            url: source.url,
          }));
        sources = [
          ...new Map(
            [...citations, ...searched]
              .filter((source) => /^https?:\/\//i.test(source.url || ""))
              .map((source) => [source.url, source]),
          ).values(),
        ];
        if (
          m.solutionGrounding &&
          !response.output?.some((item) => item.type === "web_search_call")
        )
          throw new Error(
            "OpenAI did not run web search. Existing solutions were kept.",
          );
      } else {
        result = await text(m, c, signal, prompt);
      }
      if (signal.aborted) throw new DOMException("Canceled", "AbortError");
      if (!result?.trim())
        throw new Error("The provider returned no solutions.");
      await A.updateMeeting(id, {
        solutions: A.sanitize(result),
        solutionSources: sources,
      });
      if (A.meetingId === id) A.renderEditor(false);
    });
  }
  function pcmSegment(audio, start, count) {
    const bytes = new Uint8Array(count * 2),
      v = new DataView(bytes.buffer),
      ratio = audio.sampleRate / 16000,
      channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
        audio.getChannelData(i),
      );
    for (let i = 0; i < count; i++) {
      const pos = (start + i) * ratio,
        lo = Math.floor(pos),
        f = pos - lo;
      let x = 0;
      for (const ch of channels) {
        const a = ch[Math.min(lo, ch.length - 1)] || 0,
          b = ch[Math.min(lo + 1, ch.length - 1)] || 0;
        x += a + (b - a) * f;
      }
      x = Math.max(-1, Math.min(1, x / channels.length));
      v.setInt16(i * 2, x < 0 ? x * 32768 : x * 32767, true);
    }
    return ZMinutesCapture.wav([bytes]);
  }
  async function transcribe(id, blob, recordingId) {
    return run(id, async (m, c, signal) => {
      if (!m.cloudAudioAllowed)
        throw new Error("Cloud transcription is disabled for this meeting.");
      const p = c.transcriptionProvider,
        key = c.transcriptionKey || c.keys?.[p];
      const model =
        c.transcriptionModel?.trim() ||
        (p === "gemini"
          ? c.provider === "gemini"
            ? c.model
            : "gemini-3.5-flash"
          : "gpt-4o-mini-transcribe");
      if (!key) throw new Error("Enter a " + p + " API key in Settings.");
      const decoder = new OfflineAudioContext(1, 1, 16000),
        audio = await decoder.decodeAudioData(await blob.arrayBuffer()),
        total = Math.round((audio.length * 16000) / audio.sampleRate),
        hop = 90 * 16000,
        parts = [];
      for (let start = 0; start < total; start += hop) {
        if (signal.aborted) throw new DOMException("Canceled", "AbortError");
        const part = pcmSegment(audio, start, Math.min(hop, total - start));
        $("aiStatus").textContent =
          "Transcribing " +
          m.title +
          " · " +
          (Math.floor(start / hop) + 1) +
          "/" +
          Math.ceil(total / hop);
        let result;
        if (p === "openai") {
          const body = new FormData();
          body.append("file", part, "segment.wav");
          body.append("model", model);
          const d = await request(
            "https://api.openai.com/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: "Bearer " + key },
              body,
            },
            signal,
          );
          result = d.text || "";
        } else {
          const data = (await S.toDataURL(part)).split(",")[1],
            d = await request(
              "https://generativelanguage.googleapis.com/v1beta/models/" +
                encodeURIComponent(model) +
                ":generateContent",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-goog-api-key": key,
                },
                body: JSON.stringify({
                  contents: [
                    {
                      parts: [
                        {
                          text: "Transcribe the speech verbatim in its original language. Return only the transcript.",
                        },
                        { inlineData: { mimeType: "audio/wav", data } },
                      ],
                    },
                  ],
                }),
              },
              signal,
            );
          result =
            d.candidates?.[0]?.content?.parts
              ?.map((p) => p.text || "")
              .join("") || "";
        }
        parts.push(result);
      }
      if (signal.aborted) throw new DOMException("Canceled", "AbortError");
      const transcript = parts.join("\n").trim();
      if (!transcript)
        throw new Error(
          "No speech was returned. Existing transcript retained.",
        );
      const current = A.data.meetings.find((meeting) => meeting.id === id),
        targetId = recordingId || current.recordings.at(-1)?.id;
      if (targetId) {
        const old = current.transcriptSegments.find(
          (segment) => segment.recordingId === targetId,
        );
        const segment = {
          id: old?.id || crypto.randomUUID(),
          recordingId: targetId,
          createdAt: old?.createdAt || Date.now(),
          text: transcript,
          ...(old && Number.isFinite(old.order)
            ? { order: old.order }
            : current.transcriptSegments.some((item) =>
                  Number.isFinite(item.order),
                )
              ? {
                  order:
                    Math.max(
                      ...current.transcriptSegments
                        .map((item) => item.order)
                        .filter(Number.isFinite),
                    ) + 1,
                }
              : {}),
        };
        await A.updateMeeting(id, {
          transcriptSegments: old
            ? current.transcriptSegments.map((item) =>
                item.id === old.id ? segment : item,
              )
            : [...current.transcriptSegments, segment],
        });
      } else {
        await A.updateMeeting(id, {
          transcript: [current.transcript, transcript]
            .filter(Boolean)
            .join("\n\n"),
        });
      }
      if (A.meetingId === id) A.renderEditor(false);
    });
  }
  $("generateSummaryBtn").onclick = () => A.run(() => recap(A.meetingId));
  $("generateSolutionsBtn").onclick = () => A.run(() => solutions(A.meetingId));
  $("transcriptRecapBtn").onclick = () =>
    A.run(async () => {
      const id = A.meetingId;
      if (A.meetingId === id) {
        A.tab = "summary";
        A.renderEditor();
      }
      await recap(id, true);
    });
  $("cancelAiBtn").onclick = () => job?.abort();
  A.ai = { recap, solutions, transcribe, quick, pcmSegment };
})();
