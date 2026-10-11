# zMinutes

zMinutes is a personal, local-first meeting notebook for desktop and Android. It is a static installable PWA: GitHub Pages serves only the app files. There is no zMinutes backend, account, or server-side meeting database.

## Install

Open the app URL in Microsoft Edge on Windows or Chrome on Android, then choose **Install app** in the browser. After the first successful load, the app shell is cached for offline use. Meetings and settings are stored in that browser on that device.

The GitHub Pages site is publicly reachable. This exposes the app code and interface, not the meetings stored in the browser. API keys are saved in that browser's local storage on that device (not synced or exported); meeting content is sent to a cloud AI only when the user selects that provider and requests a recap or explicitly enables cloud transcription.

## Sync between devices

Open **Settings → Google Drive sync** on each browser, save the same Google OAuth Web Client ID, then choose **Sync now** and authorize the same Google account. In Google Cloud, enable the Google Drive API and register `https://phu-lu.github.io` as an authorized JavaScript origin. The app uses Google's narrow `drive.file` scope. It syncs projects, meetings, tasks, and field notes; raw audio, AI API keys, and OAuth tokens stay local. Press **Sync now** in each browser session; the short-lived access token is intentionally not stored.

## Local development

From this folder, run:

```powershell
python -m http.server 4174 --bind 127.0.0.1
```

Then open <http://127.0.0.1:4174/>. Use a secure origin (HTTPS or localhost) for microphone, camera, service workers, and PWA installation.

## Data and sync

Version 2 uses one IndexedDB repository for records, media, recording checkpoints, and a durable sync outbox. Existing records are migrated once; the original legacy stores are left intact. A failed save is shown explicitly instead of silently falling back to a second database. Export a backup before clearing browser data or switching devices.

Drive sync uploads immutable changes only when you tap **Sync now**. A newly connected empty device will not upload its empty workspace when Drive contains no data. Concurrent edits are retained for resolution in Settings rather than silently overwriting each other. Deletions propagate as tombstones. Photos sync; audio, imported/exported packages, and API keys remain local. Local audio is preserved when receiving a remote meeting update. Backups include audio and attachments; restore validates and commits atomically. The original v1 Drive snapshot is not deleted. If data went missing, use **Settings → Recover missing data** to inspect local history or old Drive snapshot versions, download a copy, then add only missing records. Recovery does not replace current records. Update both devices before resuming sync.

## Recording and AI

Record starts the browser audio context directly from the button gesture. The audio processor is bundled locally; a compatibility recorder is used if AudioWorklet fails. Startup stages have deadlines and cancellation, and the timer advances only when samples arrive. PCM chunks are checkpointed every second; interrupted recordings can be recovered in Settings. Audio is saved as 16 kHz mono WAV with playback, download, import, and retranscription controls. Background recording is subject to OS/browser suspension; keep the app visible for reliable capture.

Settings supports Gemini, OpenAI, Ollama, or a clearly labelled offline quick draft (not a local language model). Gemini transcription can reuse the Gemini recap key; OpenAI transcription needs an OpenAI key. “Transcription provider” chooses the audio-to-text service; “Transcription API key” is optional if the same provider key is already entered above. The Cloud transcription switch sets only the default for **future** meetings; permission is still visible per meeting in Recap. Each meeting may contain multiple local audio clips. Transcription is stored per clip and the combined transcript is used for recaps, suggested solutions, Word, and PDF. A per-meeting recap prompt can be edited in Recap. Suggested solutions use project meetings, tasks, and field notes as internal context; optional web search uses the selected provider's native search tool (Gemini Google Search or OpenAI web search). Ollama uses project data only and cannot search the web without an additional search service. Project context is sent to the selected AI provider only when the user requests generation. AI jobs stay attached to their original meeting even if you navigate elsewhere. Existing recaps are kept if an AI request fails.

## Reminders and calendar import

Tasks can have an explicit reminder date/time. If no reminder is set, an unfinished task is highlighted as due or overdue from 9:00 on its due day. Meetings are highlighted when they are within 30 minutes of starting. zMinutes shows reminders when the app is open; Settings can also request browser notifications. A closed PWA cannot guarantee scheduled delivery. Telegram bot delivery while the app is closed requires a separate scheduled cloud job with a protected bot token and a readable copy of reminder data; this is not implemented in the local-only app.

Calendar accepts an `.ics` file exported from Google Calendar, Outlook, or another company calendar. It imports events into the selected project, preserves existing imported meetings on re-import, and does not overwrite notes. Time zones and all-day events are handled; recurring series are not expanded automatically, so export individual occurrences if needed. Direct account-to-account calendar sync is not implemented yet.

## Updates and development checks

This release is **2.0 / build 25** (visible in Settings). Gemini transcription uses the selected Gemini recap model by default; Settings also allows a separate transcription model. Use Settings → Check for updates, then reload after saving. Updates never force a reload during recording. Installation is performed by the browser: accepting a prompt is not proof that Android has finished installing the app.

```powershell
npm ci
npm test
npm run test:browser
```

Browser tests use installed Edge on Windows and Playwright Chromium on Linux. On Linux, first run `npx playwright install --with-deps chromium`. Tests use synthetic audio and mocked cloud responses; they do not spend API credits or access a real Drive account. See [TESTING.md](TESTING.md) for coverage and physical-device checks. Deployment runs these tests before publishing.

Active modules are `zminutes-model`, `repository`, `app`, `views`, `capture`, `audio`, `intelligence`, `exports`, `sync`, and `pwa`. Legacy scripts remain in the repository for reference but are not loaded by the new interface. Immutable history is retained for recoverability; history compaction is intentionally deferred.
