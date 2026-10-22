const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
async function waitUntil(predicate, message) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (error, data) => {
    res.statusCode = error ? 404 : 200;
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(error ? "Missing" : data);
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  let rejectNext = 0;
  const files = [], folders = [];
  await context.addInitScript(() => {
    localStorage.setItem("zminutes-drive-client-id", "test.apps.googleusercontent.com");
    window.__authRequests = 0;
    window.__authGestures = [];
    window.__popupMode = "ok";
  });
  await context.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.google={accounts:{oauth2:{initTokenClient:(options)=>({requestAccessToken:()=>{
      window.__authRequests++;
      window.__authGestures.push(navigator.userActivation.isActive);
      if(window.__popupMode==='blocked') options.error_callback({type:'popup_failed_to_open'});
      else if(window.__popupMode==='denied') options.callback({error:'access_denied'});
      else options.callback({access_token:'test-'+window.__authRequests,expires_in:window.__expiresIn||3600});
    }})}}};`,
  }));
  await context.route("https://www.googleapis.com/**", async (route) => {
    if (rejectNext) {
      const status = rejectNext;
      rejectNext = 0;
      return route.fulfill({ status, json: { error: { message: "Test expired session" } } });
    }
    const request = route.request(), url = new URL(request.url());
    let result;
    if (url.pathname.includes("/upload/")) {
      const boundary = request.headers()["content-type"].split("boundary=")[1];
      const pieces = request.postData().split("--" + boundary);
      const parse = (piece) => JSON.parse(piece.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim());
      const meta = parse(pieces[1]), payload = parse(pieces[2]);
      const id = "file-" + files.length;
      files.push({ ...meta, id, payload });
      result = { id };
    } else if (request.method() === "POST") {
      const id = "folder-" + folders.length;
      folders.push({ id });
      result = { id };
    } else if (url.searchParams.get("alt") === "media") {
      result = files.find((file) => url.pathname.endsWith("/" + file.id))?.payload;
    } else {
      const query = url.searchParams.get("q") || "";
      result = { files: query.includes("mimeType") ? folders
        : query.includes("name='zminutes-sync.json'") ? []
        : query.includes("appProperties") ? files
          .filter((file) => !query.includes("value='") || query.includes("value='" + file.appProperties?.zminutes + "'"))
          .map(({ payload, ...file }) => file)
        : [] };
    }
    await route.fulfill({ json: result });
  });
  const page = await context.newPage();
  try {
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => ZM.ready && !!window.google?.accounts?.oauth2 && !document.getElementById("syncBtn").disabled);
    await page.evaluate(async () => {
      await ZMinutesPersonalStore.save({ id: "auth-note-1", title: "First local note", noteDoc: ZMinutesTiptap.empty(), updated: Date.now() });
    });
    await page.locator("#syncBtn").click();
    await waitUntil(() => files.filter((file) => file.appProperties?.zminutes === "notes-v1").length === 1, "Home did not upload the first note");
    await page.waitForFunction(() => document.getElementById("driveStatus").textContent.startsWith("Notes synced") && !document.getElementById("syncBtn").disabled);
    assert.equal(await page.evaluate(async () => (await ZMinutesPersonalStore.pending()).length), 0);
    assert.equal(await page.evaluate(() => __authRequests), 1, "Home must sign in and finish uploading on the same click");
    assert.deepEqual(await page.evaluate(() => __authGestures), [true], "The Google popup must be requested from a user gesture");
    assert.equal(files.filter((file) => file.appProperties?.zminutes === "notes-v1").length, 1);
    assert.match(await page.locator("#driveStatus").textContent(), /Notes synced/);
    await page.screenshot({ path: path.join(root, "test-results", "sync-home-desktop-1366.png") });

    await page.evaluate(async () => {
      await ZMinutesPersonalStore.save({ id: "auth-note-2", title: "Second local note", noteDoc: ZMinutesTiptap.empty(), updated: Date.now() });
    });
    rejectNext = 401;
    await page.locator("#syncBtn").click();
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "auth" && !document.getElementById("syncBtn").disabled);
    assert.equal(await page.evaluate(async () => (await ZMinutesPersonalStore.pending()).length), 1, "401 must not acknowledge unsent Notes");
    assert.equal(await page.locator("#syncBtn .action-label").textContent(), "Reconnect & sync");
    await page.locator("#syncBtn").click();
    await waitUntil(() => files.filter((file) => file.appProperties?.zminutes === "notes-v1").length === 2, "Reconnect did not upload the pending note");
    await page.waitForFunction(() => document.getElementById("driveStatus").textContent.startsWith("Notes synced") && !document.getElementById("syncBtn").disabled);
    assert.equal(await page.evaluate(async () => (await ZMinutesPersonalStore.pending()).length), 0);
    assert.equal(await page.evaluate(() => __authRequests), 2);
    assert.equal(files.filter((file) => file.appProperties?.zminutes === "notes-v1").length, 2);
    assert.equal(await page.locator("#appNotice").isVisible(), false, "Successful retry clears the old auth toast");

    await page.evaluate(() => ZM.navigate("settings"));
    rejectNext = 403;
    await page.locator("#syncSettingsBtn").click();
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "error" && !document.getElementById("syncSettingsBtn").disabled);
    assert.match(await page.locator("#driveStatus").textContent(), /denied access \(403\)/);
    assert.equal(await page.locator("#syncSettingsBtn").textContent(), "↻ Sync now", "403 is not an expired token");
    await page.locator("#syncSettingsBtn").click();
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "success");
    assert.equal(await page.evaluate(() => __authRequests), 2, "A 403 must not force repeated sign-in");

    rejectNext = 401;
    await page.locator("#syncSettingsBtn").click();
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "auth");
    await page.evaluate(() => { window.__popupMode = "blocked"; });
    await page.locator("#syncSettingsBtn").click();
    await page.waitForFunction(() => !document.getElementById("syncSettingsBtn").disabled);
    assert.match(await page.locator("#driveStatus").textContent(), /popup was blocked/);
    await page.evaluate(() => { window.__popupMode = "ok"; window.__expiresIn = 1; });
    await page.locator("#syncSettingsBtn").click();
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "success");
    assert.equal(await page.locator("#appNotice").isVisible(), false);
    const beforeNearExpiry = await page.evaluate(() => __authRequests);
    await page.evaluate(() => { window.__expiresIn = 3600; });
    await page.locator("#syncSettingsBtn").click();
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "success" && !document.getElementById("syncSettingsBtn").disabled);
    assert.equal(await page.evaluate(() => __authRequests), beforeNearExpiry + 1, "A nearly expired token must reconnect before Drive requests");

    const beforeOffline = await page.evaluate(() => __authRequests);
    await context.setOffline(true);
    await page.locator("#syncBtn").click();
    assert.equal(await page.locator("#syncTopStatus").getAttribute("data-state"), "offline");
    await context.setOffline(false);
    assert.equal(await page.evaluate(() => __authRequests), beforeOffline);

    await page.evaluate(async () => {
      await ZM.save("meetings", { id: "auth-meeting", projectId: "inbox", title: "Meeting before reconnect" });
    });
    await page.locator("#syncSettingsBtn").click();
    await page.waitForFunction(() => !document.getElementById("newDriveHistory").hidden);
    await page.locator("#startDriveHistoryBtn").click();
    await waitUntil(() => files.filter((file) => file.appProperties?.zminutes === "changes-v3").length === 1, "Initial meeting history was not uploaded");
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "success");
    assert.equal(await page.evaluate(async () => (await ZMinutesStore.pendingV3()).length), 0);
    await page.evaluate(async () => {
      const meeting = ZM.data.meetings.find((item) => item.id === "auth-meeting");
      await ZM.save("meetings", { ...meeting, title: "Meeting after reconnect" });
    });
    rejectNext = 401;
    await page.locator("#syncBtn").click();
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "auth" && !document.getElementById("syncBtn").disabled);
    assert.ok(await page.evaluate(async () => (await ZMinutesStore.pendingV3()).length) > 0, "401 must retain the pending meeting edit");
    await page.locator("#syncBtn").click();
    await waitUntil(() => files.filter((file) => file.appProperties?.zminutes === "changes-v3").length === 2, "Reconnect did not upload the meeting edit");
    await page.waitForFunction(() => document.getElementById("syncTopStatus").dataset.state === "success");
    assert.equal(await page.evaluate(async () => (await ZMinutesStore.pendingV3()).length), 0);
    assert.equal(await page.evaluate(() => ZM.data.meetings.find((item) => item.id === "auth-meeting").title), "Meeting after reconnect");

    await page.evaluate(() => ZM.navigate("home"));
    await page.setViewportSize({ width: 412, height: 915 });
    await page.evaluate(() => ZM.nav(false));
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.screenshot({ path: path.join(root, "test-results", "sync-home-phone-412.png"), fullPage: true });
    console.log("PASS: one-click Home and Settings sync, user-gesture sign-in, near-expiry token, 401 reconnect, 403, blocked popup, offline, pending Notes/meeting and mobile status");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
