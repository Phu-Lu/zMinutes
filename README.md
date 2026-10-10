# zMinutes

zMinutes is a personal, local-first meeting notebook for desktop and Android. It is a static installable PWA: GitHub Pages serves only the app files. There is no zMinutes backend, account, or server-side meeting database.

## Install

Open the app URL in Microsoft Edge on Windows or Chrome on Android, then choose **Install app** in the browser. After the first successful load, the app shell is cached for offline use. Meetings and settings are stored in that browser on that device.

The GitHub Pages site is publicly reachable. This exposes the app code and interface, not the meetings stored in the browser. API keys are kept in the current browser session; meeting content is sent to a cloud AI only when the user selects that provider and requests a recap or explicitly enables cloud transcription.

## Local development

From this folder, run:

```powershell
python -m http.server 4174 --bind 127.0.0.1
```

Then open <http://127.0.0.1:4174/>. Use a secure origin (HTTPS or localhost) for microphone, camera, service workers, and PWA installation.

## Data and sync

The app stores meeting records in IndexedDB and uses localStorage as a fallback. Export a backup before clearing browser data or switching devices. Optional Google Drive sync shares selected app data; raw audio is excluded.
