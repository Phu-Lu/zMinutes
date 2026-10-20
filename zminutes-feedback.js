/* Transient feedback is separate from persistent application/data state. */
(() => {
  const A = ZM, $ = A.$, active = new Map(), issues = new Map();
  function dismiss(source) {
    const entry = active.get(source);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.cleanup();
    entry.host.hidden = true;
    active.delete(source);
  }
  function resolve(source) {
    dismiss(source);
    issues.get(source)?.remove();
    issues.delete(source);
  }
  function show(source, message, options = {}) {
    const target = $(options.target || "appNotice");
    if (!target) return;
    if (!message) {
      for (const [key, entry] of active) if (entry.target === target) dismiss(key);
      target.textContent = "";
      return;
    }
    dismiss(source);
    // One owner per rendered surface. Replaced timers can never dismiss its successor.
    for (const [key, entry] of active) if (entry.target === target) dismiss(key);
    const host = options.container ? $(options.container) : target;
    const entry = { target, host, remaining: options.error ? 8000 : 4000, timer: null };
    active.set(source, entry);
    target.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    target.append(text);
    target.classList.toggle("error", !!options.error);
    target.classList.add("feedback-message");
    target.setAttribute("role", "status");
    host.hidden = false;
    host.classList.remove("hidden");
    target.hidden = false;
    const pause = () => {
      if (!entry.timer) return;
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.started));
    };
    const resume = () => {
      if (options.busy || entry.timer || active.get(source) !== entry ||
          host.matches(":hover") || host.contains(document.activeElement)) return;
      entry.started = Date.now();
      entry.timer = setTimeout(() => {
        if (active.get(source) === entry) dismiss(source);
      }, entry.remaining);
    };
    const focusOut = () => queueMicrotask(resume);
    entry.cleanup = () => {
      host.removeEventListener("mouseenter", pause);
      host.removeEventListener("mouseleave", resume);
      host.removeEventListener("focusin", pause);
      host.removeEventListener("focusout", focusOut);
    };
    host.addEventListener("mouseenter", pause);
    host.addEventListener("mouseleave", resume);
    host.addEventListener("focusin", pause);
    host.addEventListener("focusout", focusOut);
    if (!options.busy) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "feedback-close";
      close.setAttribute("aria-label", "Dismiss notification");
      close.onclick = () => dismiss(source);
      target.append(close);
    }
    if (options.critical) {
      issues.get(source)?.remove();
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "issue-badge";
      badge.textContent = options.label || "Data needs attention";
      badge.onclick = () => {
        show(source, message, options);
        if (options.action) A.run(options.action);
      };
      $("notificationIssues").append(badge);
      issues.set(source, badge);
    }
    resume();
  }
  A.feedback = { show, dismiss, resolve };
  A.notice = (message, error = false, options = {}) =>
    show(options.source || "app", message, { ...options, error });
})();
