(() => {
  const A = ZM,
    $ = A.$;
  let promptEvent, registration;
  const feedback = (text) => {
    A.notice(text, false, { source: "install" });
  };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptEvent = e;
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    feedback(
      "The browser reported installation. Search zMinutes in your app drawer or Home screen.",
    );
  });
  $("installBtn").onclick = () =>
    A.run(async () => {
      if (matchMedia("(display-mode: standalone)").matches) {
        feedback("zMinutes is running as an installed app.");
        return;
      }
      if (promptEvent) {
        const p = promptEvent;
        promptEvent = null;
        await p.prompt();
        const result = await p.userChoice;
        feedback(
          result.outcome === "accepted"
            ? "Installation requested. Wait for the browser to finish, then check your app drawer."
            : "Installation dismissed. You can try again from the browser menu.",
        );
      } else {
        feedback(
          "Open your browser menu → Install app or Add to Home screen. If it offers Open in app, installation already exists.",
        );
      }
    });
  $("backupSettingsBtn").onclick = () => $("backupBtn").click();
  $("restoreSettingsBtn").onclick = () => $("restoreBtn").click();
  $("importSettingsBtn").onclick = () => $("importMeetingBtn").click();
  $("updateAppBtn").onclick = () =>
    A.run(async () => {
      if (A.recording || A.aiBusy || A.live?.busy)
        throw new Error("Finish recording or AI requests before updating.");
      await A.flush();
      await registration?.update();
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: "ACTIVATE" });
        A.feedback.show("update", "Update ready. Reload zMinutes to use it.", { target: "updateStatus" });
      } else
        A.feedback.show("update", "Update check completed. Reload to use the latest available version.", { target: "updateStatus" });
    });
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((r) => {
        registration = r;
        const notice = () => {
          if (r.waiting)
            $("updateStatus").textContent =
              "A new version is ready. Select Check for updates when your work is saved.";
        };
        notice();
        r.addEventListener("updatefound", () =>
          r.installing?.addEventListener("statechange", notice),
        );
      })
      .catch((e) => {
        $("updateStatus").textContent =
          "Offline installation unavailable: " + e.message;
      });
  window.addEventListener("error", (e) => {
    if (!A.ready) {
      $("bootStatus").textContent = "The app could not start: " + e.message;
      $("bootRetry").hidden = false;
    }
  });
  A.start();
})();
