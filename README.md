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

The app stores meeting records in IndexedDB and uses localStorage as a fallback. Export a backup before clearing browser data or switching devices. Optional Google Drive sync shares selected app data; raw audio is excluded.
