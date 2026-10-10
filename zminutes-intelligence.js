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
        m.transcript,
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
  async function text(m, c, signal) {
    const prompt =
      "Summarize this meeting accurately in its original language. Return HTML using only h3, p, ul, li, strong. Sections: Overview, Decisions, Action items, Open questions. Do not invent facts.\n" +
      JSON.stringify({
        title: m.title,
        date: m.date,
        note: m.note,
        transcript: m.transcript,
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
    await A.flush();
    const m = structuredClone(A.data.meetings.find((m) => m.id === id));
    if (!m) throw new Error("Meeting not found");
    job = new AbortController();
    A.aiBusy = true;
    $("cancelAiBtn").hidden = false;
    $("generateSummaryBtn").disabled = true;
    $("aiStatus").textContent = "Working: " + m.title;
    try {
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
    }
  }
  async function recap(id) {
    return run(id, async (m, c, signal) => {
      const result = await text(m, c, signal);
      if (signal.aborted) throw new DOMException("Canceled", "AbortError");
      if (!result.trim())
        throw new Error("The provider returned an empty recap");
      await A.updateMeeting(id, {
        summary: A.sanitize(result),
        summaryType: c.provider === "quick" ? "quick" : "ai",
      });
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
  async function transcribe(id, blob) {
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
      await A.updateMeeting(id, { transcript });
      if (A.meetingId === id) $("transcriptInput").value = transcript;
    });
  }
  $("generateSummaryBtn").onclick = () => A.run(() => recap(A.meetingId));
  $("cancelAiBtn").onclick = () => job?.abort();
  A.ai = { recap, transcribe, quick, pcmSegment };
})();
