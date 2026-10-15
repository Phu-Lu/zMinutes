(() => {
  const A = ZM,
    S = ZMinutesStore,
    $ = A.$,
    xml = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&apos;",
          })[c],
      );
  const safe = (s) => (s || "Meeting").replace(/[\\/:*?"<>|]/g, "-");
  const plain = (html) => {
    const t = document.createElement("div");
    t.innerHTML = A.sanitize(html);
    t.querySelectorAll("p,h3,li,br").forEach((x) => x.append("\n"));
    return t.textContent;
  };
  function blocks(m) {
    if (!m) throw new Error("Open a meeting before exporting.");
    const summary = plain(m.summary).trim(),
      solutions = plain(m.solutions).trim();
    if (!summary && !solutions)
      throw new Error(
        "Generate a recap or suggested solutions before exporting.",
      );
    return [
      { title: m.title || "Untitled meeting", level: 1 },
      { title: [A.formatDate(m.date), m.location].filter(Boolean).join(" · ") },
      ...(summary ? [{ title: "Recap", level: 2 }, { title: summary }] : []),
      ...(solutions
        ? [
            { title: "Suggested solutions", level: 2 },
            { title: solutions },
            ...m.solutionSources.map((source) => ({
              title: source.title + " · " + source.url,
            })),
          ]
        : []),
    ];
  }
  const sharingText = (m) =>
    blocks(m)
      .map((b) => b.title)
      .join("\n\n");
  async function print() {
    await A.flush();
    const m = structuredClone(A.current());
    if (!m) return;
    document.querySelector(".print-document")?.remove();
    const root = document.createElement("article");
    root.className = "print-document";
    for (const b of blocks(m)) {
      const el = document.createElement(b.level ? "h" + b.level : "p");
      el.textContent = b.title;
      root.append(el);
    }
    document.body.append(root);
    window.print();
  }
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) {
      c ^= b;
      for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  function zip(files) {
    const enc = new TextEncoder(),
      parts = [],
      central = [];
    let offset = 0;
    for (const [name, raw] of Object.entries(files)) {
      const n = enc.encode(name),
        data = typeof raw === "string" ? enc.encode(raw) : raw,
        h = new Uint8Array(30 + n.length),
        v = new DataView(h.buffer),
        sum = crc(data);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x800, true);
      v.setUint32(14, sum, true);
      v.setUint32(18, data.length, true);
      v.setUint32(22, data.length, true);
      v.setUint16(26, n.length, true);
      h.set(n, 30);
      parts.push(h, data);
      const c = new Uint8Array(46 + n.length),
        w = new DataView(c.buffer);
      w.setUint32(0, 0x02014b50, true);
      w.setUint16(4, 20, true);
      w.setUint16(6, 20, true);
      w.setUint16(8, 0x800, true);
      w.setUint32(16, sum, true);
      w.setUint32(20, data.length, true);
      w.setUint32(24, data.length, true);
      w.setUint16(28, n.length, true);
      w.setUint32(42, offset, true);
      c.set(n, 46);
      central.push(c);
      offset += h.length + data.length;
    }
    const end = new Uint8Array(22),
      v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, central.length, true);
    v.setUint16(10, central.length, true);
    v.setUint32(
      12,
      central.reduce((n, c) => n + c.length, 0),
      true,
    );
    v.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }
  async function word() {
    await A.flush();
    const m = structuredClone(A.current());
    if (!m) return;
    const p = (text, bold = false) =>
      '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>' +
      (bold ? "<w:b/>" : "") +
      '</w:rPr><w:t xml:space="preserve">' +
      xml(text) +
      "</w:t></w:r></w:p>";
    const body = blocks(m)
      .flatMap((b) => b.title.split("\n").map((line) => p(line, !!b.level)))
      .join("");
    const files = {};
    files["[Content_Types].xml"] =
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    files["_rels/.rels"] =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    files["word/document.xml"] =
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' +
      body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="1020" w:bottom="1020" w:left="1020"/></w:sectPr></w:body></w:document>';
    A.download(zip(files), safe(m.title) + ".docx");
  }
  async function meetingPackage() {
    await A.flush();
    const m = (await S.portable()).meetings.find((m) => m.id === A.meetingId);
    if (!m) return;
    const name = safe(m.title) + ".meeting.json",
      blob = new Blob(
        [JSON.stringify({ ...m, format: "meeting-note-package-v3" })],
        { type: "application/json" },
      );
    A.download(blob, name);
    await A.save("files", {
      id: crypto.randomUUID(),
      projectId: m.projectId,
      meetingId: m.id,
      title: name,
      mediaId: await S.addMedia(blob, name),
      type: "Exported meeting package",
    });
  }
  async function importPackage(file) {
    const raw = JSON.parse(await file.text());
    if (!raw || typeof raw !== "object" || typeof raw.title !== "string")
      throw new Error("Invalid meeting package");
    const m = ZMinutesModel.normalize("meetings", {
      ...raw,
      id: crypto.randomUUID(),
      projectId: A.project,
    });
    for (const recording of m.recordings) {
      if (recording.data?.startsWith("data:audio/")) {
        recording.audioId = await S.addMedia(
          await (await fetch(recording.data)).blob(),
          recording.label || "Imported recording",
        );
      } else recording.audioId = "";
      delete recording.data;
    }
    if (m.recordings.some((recording) => recording.audioId))
      m.audioId = m.recordings
        .filter((recording) => recording.audioId)
        .at(-1).audioId;
    else if (m.audio) {
      m.audioId = await S.addMedia(
        await (await fetch(m.audio)).blob(),
        "Imported recording",
      );
      if (m.recordings.length) m.recordings[0].audioId = m.audioId;
      delete m.audio;
    }
    for (const p of m.photos) {
      if (p.data?.startsWith("data:image/"))
        p.mediaId = await S.addMedia(
          await (await fetch(p.data)).blob(),
          "Imported photo",
        );
      else p.mediaId = "";
      delete p.data;
    }
    await A.save("meetings", m);
    await A.save("files", {
      id: crypto.randomUUID(),
      projectId: A.project,
      meetingId: m.id,
      title: file.name,
      mediaId: await S.addMedia(file, file.name),
      type: "Imported meeting package",
    });
    await A.open(m.id);
  }
  function calendar() {
    const escape = (s) =>
        String(s)
          .replace(/\\/g, "\\\\")
          .replace(/\r?\n/g, "\\n")
          .replace(/,/g, "\\,")
          .replace(/;/g, "\\;"),
      stamp = (v) =>
        new Date(v)
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, ""),
      lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//zMinutes//EN"];
    for (const m of A.data.meetings.filter(
      (m) => m.projectId === A.project && m.date && !isNaN(new Date(m.date)),
    ))
      lines.push(
        "BEGIN:VEVENT",
        "UID:" + m.id + "@zminutes",
        "DTSTAMP:" + stamp(Date.now()),
        "DTSTART:" + stamp(m.date),
        "SUMMARY:" + escape(m.title),
        "END:VEVENT",
      );
    lines.push("END:VCALENDAR");
    A.download(
      new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" }),
      "zMinutes.ics",
    );
  }
  function parseIcs(raw) {
    const lines = raw
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n[ \t]/g, "")
      .split("\n");
    const events = [];
    let current = null;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") {
        current = {};
        continue;
      }
      if (line === "END:VEVENT") {
        if (current) events.push(current);
        current = null;
        continue;
      }
      if (!current) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon),
        value = line.slice(colon + 1);
      const name = key.split(";")[0].toUpperCase();
      if (
        [
          "UID",
          "SUMMARY",
          "DESCRIPTION",
          "LOCATION",
          "STATUS",
          "RECURRENCE-ID",
          "DTSTART",
        ].includes(name)
      )
        current[name] = { key, value };
    }
    const unescape = (s) =>
      s
        .replace(/\\[nN]/g, "\n")
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\\\/g, "\\");
    const local = (time) => {
      if (!time) return "";
      const value = time.value;
      if (/^\d{8}$/.test(value))
        return (
          value.slice(0, 4) +
          "-" +
          value.slice(4, 6) +
          "-" +
          value.slice(6, 8) +
          "T09:00"
        );
      const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(
        value,
      );
      if (!match) return "";
      const [, y, mo, day, hour, minute, second, utc] = match;
      const tz = /(?:^|;)TZID=([^;]+)/i
        .exec(time.key)?.[1]
        ?.replace(/^"|"$/g, "");
      if (!utc && !tz) return `${y}-${mo}-${day}T${hour}:${minute}`;
      let stamp = Date.UTC(+y, +mo - 1, +day, +hour, +minute, +(second || 0));
      if (tz && !utc) {
        try {
          const format = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
          });
          for (let i = 0; i < 3; i++) {
            const parts = Object.fromEntries(
              format
                .formatToParts(new Date(stamp))
                .map((p) => [p.type, p.value]),
            );
            const shown = Date.UTC(
              +parts.year,
              +parts.month - 1,
              +parts.day,
              +parts.hour,
              +parts.minute,
              +parts.second,
            );
            stamp +=
              Date.UTC(+y, +mo - 1, +day, +hour, +minute, +(second || 0)) -
              shown;
          }
        } catch {
          return "";
        }
      }
      const date = new Date(stamp);
      return new Date(stamp - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    };
    return events
      .filter((event) => event.STATUS?.value !== "CANCELLED")
      .map((event) => ({
        uid: (event.UID?.value || "") + (event["RECURRENCE-ID"]?.value || ""),
        title: unescape(event.SUMMARY?.value || "Untitled event"),
        date: local(event.DTSTART),
        location: unescape(event.LOCATION?.value || ""),
        note: unescape(event.DESCRIPTION?.value || ""),
      }))
      .filter((event) => event.uid && event.date);
  }
  async function importCalendar(file) {
    if (file.size > 5 * 1024 * 1024)
      throw new Error("Choose an .ics calendar file smaller than 5 MB.");
    const events = parseIcs(await file.text());
    if (!events.length)
      throw new Error("No dated events found in this .ics file.");
    if (events.length > 5000)
      throw new Error(
        "This calendar contains too many events to import at once.",
      );
    await A.flush();
    const existing = new Set(
      A.data.meetings
        .filter((meeting) => meeting.projectId === A.project)
        .map((meeting) => meeting.externalCalendarUid)
        .filter(Boolean),
    );
    let added = 0;
    for (const event of events) {
      if (existing.has(event.uid)) continue;
      await A.save("meetings", {
        id: crypto.randomUUID(),
        projectId: A.project,
        title: event.title,
        date: event.date,
        location: event.location,
        note: event.note,
        externalCalendarUid: event.uid,
        calendarSource: file.name,
      });
      existing.add(event.uid);
      added++;
    }
    A.renderSection();
    A.notice(
      `${added} calendar events imported; ${events.length - added} already present.`,
    );
  }
  $("pdfBtn").onclick = () => A.run(print);
  $("docBtn").onclick = () => A.run(word);
  $("packageBtn").onclick = () => A.run(meetingPackage);
  $("importMeetingBtn").onclick = () => $("importMeetingInput").click();
  $("importMeetingInput").onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) A.run(() => importPackage(f));
  };
  $("shareBtn").onclick = () =>
    A.run(async () => {
      await A.flush();
      const m = A.current(),
        text = sharingText(m);
      if (navigator.share) await navigator.share({ title: m.title, text });
      else {
        await navigator.clipboard.writeText(text);
        A.notice("Meeting copied.");
      }
    });
  $("emailBtn").onclick = () =>
    A.run(async () => {
      await A.flush();
      const m = A.current();
      location.href =
        "mailto:?subject=" +
        encodeURIComponent(m.title) +
        "&body=" +
        encodeURIComponent(sharingText(m));
    });
  A.exports = {
    calendar,
    importCalendar,
    parseIcs,
    print,
    word,
    zip,
    blocks,
    sharingText,
    importPackage,
  };
})();
