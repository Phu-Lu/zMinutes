/* Best-effort local reminders. A closed PWA cannot run a reliable timer. */
(() => {
  const A = ZM,
    $ = A.$,
    KEY = "zminutes-reminders-seen-v1";
  const seen = () => A.safeRead(KEY, {});
  const enabled = () =>
    typeof Notification !== "undefined" &&
    Notification.permission === "granted";
  const dateKey = (stamp) => {
    const d = new Date(stamp);
    return new Date(d - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  };
  const due = (now = new Date()) => {
    const today = dateKey(now),
      items = [];
    for (const task of A.data.tasks) {
      if (task.status === "done") continue;
      if (task.remindAt) {
        const at = new Date(task.remindAt);
        if (at <= now && now - at < 7 * 86400000)
          items.push({
            key: `task:${task.id}:${task.remindAt}`,
            title: "Task reminder",
            body: task.title,
          });
      } else if (task.due && task.due <= today && now.getHours() >= 9)
        items.push({
          key: `task-due:${task.id}:${today}`,
          title: task.due < today ? "Overdue task" : "Task due today",
          body: task.title,
        });
    }
    for (const meeting of A.data.meetings) {
      const at = new Date(meeting.date);
      if (meeting.date && !isNaN(at) && at - now <= 30 * 60000 && at - now >= 0)
        items.push({
          key: `meeting:${meeting.id}:${meeting.date}`,
          title: "Meeting starts soon",
          body: meeting.title || "Untitled meeting",
        });
    }
    return items;
  };
  async function show(item) {
    if (!enabled()) return;
    if (navigator.serviceWorker?.ready) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(item.title, {
          body: item.body,
          tag: item.key,
          icon: "./zminutes-icon-192.png",
        });
        return;
      } catch (error) {
        console.warn("Service worker notification unavailable", error);
      }
    }
    new Notification(item.title, { body: item.body, tag: item.key });
  }
  async function check() {
    if (!A.ready || document.visibilityState !== "visible") return [];
    const delivered = seen(),
      fresh = due().filter((item) => !delivered[item.key]);
    if (!fresh.length) return [];
    for (const item of fresh) {
      await show(item);
      delivered[item.key] = Date.now();
    }
    const cutoff = Date.now() - 45 * 86400000;
    for (const [key, stamp] of Object.entries(delivered))
      if (stamp < cutoff) delete delivered[key];
    localStorage.setItem(KEY, JSON.stringify(delivered));
    A.notice(
      fresh.length === 1
        ? `${fresh[0].title}: ${fresh[0].body}`
        : `${fresh.length} reminders are due. Open Tasks or Calendar.`,
    );
    return fresh;
  }
  $("enableRemindersBtn").onclick = () =>
    A.run(async () => {
      if (typeof Notification === "undefined")
        throw new Error("This browser does not support system notifications.");
      const permission = await Notification.requestPermission();
      $("reminderStatus").textContent =
        permission === "granted"
          ? "Notifications enabled while the app is open."
          : "System notifications are blocked; in-app reminders still appear while open.";
      await check();
    });
  $("checkRemindersBtn").onclick = () =>
    A.run(async () => {
      const items = await check();
      A.notice(items.length
        ? `${items.length} reminder(s) shown.`
        : "No new reminders due now.", false, { source: "reminders" });
    });
  window.addEventListener("zminutes:ready", () => {
    $("reminderStatus").textContent = enabled()
      ? "Notifications enabled while the app is open."
      : "In-app reminders are active while the app is open.";
    A.run(check);
  });
  window.addEventListener("zminutes:datachange", () => A.run(check));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") A.run(check);
  });
  setInterval(() => A.run(check), 60000);
  A.reminders = { due, check };
})();
