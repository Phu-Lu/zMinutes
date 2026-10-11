# Build 25 verification

## Automated

- `npm test`: migration, local audio preservation, durable outbox, concurrent changes without hiding this device's version, deletion conflicts, stale-tab heads, rejected malformed input, atomic restore rollback, and recording checkpoints. Legacy recorder tests remain as regression references.
- `npm run test:browser`: meeting creation/dialog close; agenda/notes/people/photo tabs and persistence; tasks and field notes after reload; real WebAudio pipeline with a synthetic microphone; WAV save; forced worklet failure using the compatibility recorder; stalled resume and close releasing the UI; exact 44.1 kHz transcription duration; AI response after switching meetings; Vietnamese DOCX content; isolated PDF print; layouts at 360, 412, 800, 1024, and 1366 CSS pixels; offline reload; two isolated browser databases exchanging changes through the production Drive adapter with a mocked transport, including a new phone meeting, a stale legacy snapshot, and legacy-only Drive safety; recovery preview meeting names; idempotent `.ics` calendar import; and local task reminder eligibility.

Tests write screenshots/PDFs to ignored `test-results/`. Browser tests do not grant access to a physical microphone or call paid AI services. Passing responsive tests is not equivalent to testing Android hardware or proving every control's visual layout.

## Physical acceptance still required

On Windows Edge/Chrome, Pixel 6 Chrome, and Zebra ET40 Chrome:

1. Confirm Settings shows build 25 on both devices. Do not clear site storage to update.
2. Create a meeting, click Record, speak for 15 seconds. Confirm the timer advances, Stop saves, playback is audible, and the downloaded WAV plays outside the app.
3. Deny mic permission and retry after granting it. Cancel a pending request. Unplug a selected USB mic. Confirm no indefinite loading state.
4. Record for at least 10 minutes. Switch meeting tabs and stop from the global banner. Test screen lock/background interruption; recover any interrupted audio from Settings.
5. Install from Chrome's menu, wait for Android completion, find zMinutes in the app drawer, launch standalone, then reopen offline. Browser installation depends on OS/browser eligibility and is not under app control.
6. Back up both devices before real Drive sync. On a newly connected empty device, tap Sync first and verify it does not replace existing Drive data. On the phone, create a meeting with notes and agenda, sync, then sync the PC and phone again; verify the meeting remains on both. Edit the same meeting offline on both, sync, resolve in Settings, and confirm both agree without losing local audio. If older data is missing, use Settings → Recover missing data, expand meeting names, and download the correct copy before importing. A legacy-only Drive with existing local work must pause instead of uploading.
7. With your own keys, test Gemini/OpenAI transcription and recap, invalid key, cancellation, and network interruption. Record two clips in one meeting, transcribe both, and verify their order in the combined transcript and recap. Test custom recap prompt, Solutions with internal context and Gemini Google Search sources. No existing recap should disappear on failure.

Do not claim these physical/cloud acceptance checks passed based solely on desktop automation.
