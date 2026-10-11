/* Shared contract and order-independent immutable change reducer. */
(function (root) {
  const kinds = ["projects", "meetings", "tasks", "fieldNotes", "files"];
  const text = (v) => (typeof v === "string" ? v : "");
  const list = (v) =>
    Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
  const inbox = () => ({
    id: "inbox",
    name: "Personal Workspace",
    color: "#0078d4",
  });
  function normalize(kind, raw) {
    if (
      !kinds.includes(kind) ||
      !raw ||
      typeof raw !== "object" ||
      !text(raw.id)
    )
      throw new Error("Invalid " + kind + " record");
    const r = { id: raw.id };
    if (kind === "projects")
      return {
        ...r,
        name: text(raw.name).trim() || "Untitled project",
        color: /^#[a-f0-9]{6}$/i.test(raw.color) ? raw.color : "#0078d4",
      };
    Object.assign(r, {
      projectId: text(raw.projectId) || "inbox",
      title: text(raw.title),
      updated: Number(raw.updated) || 0,
    });
    if (kind === "meetings")
      Object.assign(r, {
        date: text(raw.date),
        externalCalendarUid: text(raw.externalCalendarUid),
        calendarSource: text(raw.calendarSource),
        location: text(raw.location),
        note: text(raw.note),
        transcript: text(raw.transcript),
        transcriptSegments: list(raw.transcriptSegments).map((s, i) => ({
          id: text(s.id) || r.id + "-segment-" + i,
          recordingId: text(s.recordingId),
          createdAt: Number(s.createdAt) || 0,
          text: text(s.text),
          ...(Number.isFinite(s.order) ? { order: s.order } : {}),
        })),
        summary: text(raw.summary),
        summaryType: text(raw.summaryType) || (raw.summary ? "existing" : ""),
        summaryPrompt: text(raw.summaryPrompt),
        solutions: text(raw.solutions),
        solutionPrompt: text(raw.solutionPrompt),
        solutionSources: list(raw.solutionSources).map((s) => ({
          title: text(s.title),
          url: text(s.url),
        })),
        solutionGrounding: raw.solutionGrounding !== false,
        cloudAudioAllowed: !!raw.cloudAudioAllowed,
        agenda: list(raw.agenda).map((a, i) => ({
          id: text(a.id) || r.id + "-agenda-" + i,
          text: text(a.text),
          note: text(a.note),
          done: !!a.done,
        })),
        stakeholders: list(raw.stakeholders).map((p, i) => ({
          id: text(p.id) || r.id + "-person-" + i,
          name: text(p.name),
          role: text(p.role),
          status: ["attended", "not-attended"].includes(p.status)
            ? p.status
            : "invited",
        })),
        photos: list(raw.photos).map((p, i) => ({
          id: text(p.id) || r.id + "-photo-" + i,
          mediaId: text(p.mediaId),
          note: text(p.note),
          ...(p.data ? { data: text(p.data) } : {}),
        })),
        audioId: text(raw.audioId),
        recordings: list(raw.recordings).length
          ? list(raw.recordings).map((a, i) => ({
              id: text(a.id) || r.id + "-recording-" + i,
              audioId: text(a.audioId),
              createdAt: Number(a.createdAt) || 0,
              label: text(a.label) || "Recording " + (i + 1),
              ...(a.data ? { data: text(a.data) } : {}),
            }))
          : raw.audioId || raw.audio
            ? [
                {
                  id: r.id + "-earlier-recording",
                  audioId: text(raw.audioId),
                  createdAt: Number(raw.updated) || 0,
                  label: "Earlier recording",
                },
              ]
            : [],
        ...(raw.audio ? { audio: text(raw.audio) } : {}),
      });
    if (kind === "tasks")
      Object.assign(r, {
        meetingId: text(raw.meetingId),
        due: /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : "",
        remindAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw.remindAt)
          ? raw.remindAt
          : "",
        status: raw.status === "done" ? "done" : "in-progress",
      });
    if (kind === "fieldNotes")
      Object.assign(r, {
        location: text(raw.location),
        text: text(raw.text),
        photos: (Array.isArray(raw.photos) ? raw.photos : []).map((p, i) =>
          typeof p === "string"
            ? { id: r.id + "-photo-" + i, data: p, mediaId: "", note: "" }
            : {
                id: text(p.id) || r.id + "-photo-" + i,
                mediaId: text(p.mediaId),
                note: text(p.note),
                ...(p.data ? { data: text(p.data) } : {}),
              },
        ),
      });
    if (kind === "files")
      Object.assign(r, {
        meetingId: text(raw.meetingId),
        mediaId: text(raw.mediaId),
        type: text(raw.type),
      });
    return r;
  }
  function publicValue(kind, value) {
    if (!value) return null;
    const copy = normalize(kind, value);
    delete copy.audio;
    delete copy.audioId;
    delete copy.recordings;
    return copy;
  }
  const key = (kind, id) => kind + ":" + id;
  const orderedSegments = (meeting) =>
    list(meeting.transcriptSegments)
      .slice()
      .sort((a, b) => {
        if (Number.isFinite(a.order) || Number.isFinite(b.order))
          return (
            (Number.isFinite(a.order) ? a.order : Infinity) -
              (Number.isFinite(b.order) ? b.order : Infinity) ||
            (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)
          );
        const recordings = list(meeting.recordings);
        const ai = recordings.findIndex((item) => item.id === a.recordingId);
        const bi = recordings.findIndex((item) => item.id === b.recordingId);
        return (
          (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) ||
          (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)
        );
      });
  const fullTranscript = (meeting) =>
    [
      text(meeting.transcript),
      ...orderedSegments(meeting).map((segment, i) => {
        const recording = list(meeting.recordings).find(
          (item) => item.id === segment.recordingId,
        );
        return `${recording?.label || "Recording " + (i + 1)}:\n${text(segment.text)}`;
      }),
    ]
      .filter(Boolean)
      .join("\n\n");
  function reduce(operations) {
    const byId = new Map();
    for (const op of operations) {
      if (
        !op ||
        !text(op.id) ||
        !kinds.includes(op.kind) ||
        !text(op.entityId) ||
        !Array.isArray(op.parents) ||
        op.parents.some((p) => typeof p !== "string" || p === op.id)
      )
        throw new Error("Invalid sync change");
      if (op.value !== null && op.value?.id !== op.entityId)
        throw new Error("Sync identity mismatch");
      const canonical = {
        id: op.id,
        kind: op.kind,
        entityId: op.entityId,
        parents: [...op.parents].sort(),
        value: op.value === null ? null : publicValue(op.kind, op.value),
      };
      if (
        byId.has(op.id) &&
        JSON.stringify(byId.get(op.id)) !== JSON.stringify(canonical)
      )
        throw new Error("Conflicting sync change ID");
      byId.set(op.id, canonical);
    }
    const superseded = new Set();
    for (const op of byId.values())
      for (const p of op.parents) {
        const parent = byId.get(p);
        if (
          parent &&
          (parent.kind !== op.kind || parent.entityId !== op.entityId)
        )
          throw new Error("Invalid sync ancestry");
        superseded.add(p);
      }
    const groups = {};
    for (const op of byId.values())
      if (!superseded.has(op.id))
        (groups[key(op.kind, op.entityId)] ??= []).push(op);
    const result = { entities: {}, heads: {}, conflicts: [] };
    for (const [k, heads] of Object.entries(groups)) {
      heads.sort((a, b) => a.id.localeCompare(b.id));
      result.heads[k] = heads.map((h) => h.id);
      if (new Set(heads.map((h) => JSON.stringify(h.value))).size > 1)
        result.conflicts.push({
          key: k,
          kind: heads[0].kind,
          id: heads[0].entityId,
          versions: heads,
        });
      const chosen = heads.find((h) => h.value !== null) || heads[0];
      if (chosen.value)
        result.entities[k] = {
          kind: chosen.kind,
          id: chosen.entityId,
          value: chosen.value,
        };
    }
    return result;
  }
  function validateBackup(data) {
    if (
      data?.app !== "zMinutes" ||
      !Array.isArray(data.meetings) ||
      !Array.isArray(data.projects)
    )
      throw new Error("Invalid zMinutes backup");
    const out = {};
    for (const kind of kinds) {
      if (data[kind] && !Array.isArray(data[kind]))
        throw new Error("Invalid " + kind + " list");
      out[kind] = (data[kind] || []).map((r) => normalize(kind, r));
      if (new Set(out[kind].map((r) => r.id)).size !== out[kind].length)
        throw new Error("Duplicate record IDs");
    }
    if (!out.projects.some((p) => p.id === "inbox"))
      out.projects.unshift(inbox());
    for (const kind of kinds.filter((k) => k !== "projects"))
      for (const r of out[kind])
        if (!out.projects.some((p) => p.id === r.projectId))
          r.projectId = "inbox";
    return out;
  }
  function legacyTasks(meetings, tasks) {
    const out = [...tasks];
    for (const m of meetings)
      String(m.note || "")
        .split("\n")
        .forEach((line, i) => {
          const match = line.match(
              /^\s*(?:✓\s*)?ACTION ITEM\s*:\s*(\[x\]\s*)?(.*)$/i,
            ),
            id = "legacy-task-" + m.id + "-" + i;
          if (match?.[2].trim() && !out.some((t) => t.id === id))
            out.push(
              normalize("tasks", {
                id,
                projectId: m.projectId,
                meetingId: m.id,
                title: match[2].trim(),
                status: match[1] ? "done" : "in-progress",
              }),
            );
        });
    return out;
  }
  const api = {
    kinds,
    inbox,
    normalize,
    publicValue,
    key,
    orderedSegments,
    fullTranscript,
    reduce,
    validateBackup,
    legacyTasks,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.ZMinutesModel = api;
})(globalThis);
