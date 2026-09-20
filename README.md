# LinkHub Tab Saver (browser extension, Manifest V3)

One-click save of all open tabs into your self-hosted LinkHub. No bookmark
juggling: the server auto-files everything into folders.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest: `tabs`, `storage`, `contextMenus` + localhost server access |
| `crypto.js` | PBKDF2 key derivation (plain-JS port of `frontend/src/crypto.ts`, same 100k-iter parameters) |
| `common.js` | Shared API client: salt/login/register, tab cleaning + dedupe, throttled bulk ingest (5 concurrent), folder/bookmark listing |
| `popup.js` | Popup UI logic: auth, save-this-window / save-all with progress bar, folder restore (capped at 30 tabs) |
| `popup.html` | Popup UI (auth view, save card, restore card, server-URL setting) |
| `background.js` | Service worker: right-click "Save page/link to LinkHub" with ✓/! badge feedback |
| `sidepanel.html` / `sidepanel.js` | Side panel hosting the LinkHub website inside the browser (iframe + reload/open-in-tab + blocked-frame fallback) |

## Features

- **Sign in / Create account** from the popup — same zero-knowledge flow as the
  web app (keys derived locally, only the auth half ever leaves the device).
- **Save this window / Save all windows** — filters to `http(s)`, strips
  `#fragments`, dedupes, skips `chrome://` etc., POSTs each to
  `POST /api/bookmarks/ingest` with live progress. Expired sessions force a
  re-login automatically.
- **Restore** — load folders, open a folder's bookmarks as background tabs
  (30-tab safety cap with confirm).
- **Right-click save** — any page or link, no popup needed (badge confirms).
- **Server URL setting** — defaults to `http://localhost:5000`; extend
  `host_permissions` in `manifest.json` for a LAN/production host.

## Load it (Chrome / Edge / Brave)

1. Start the LinkHub backend first (see `PROJECT_GUIDE.md` §6.2).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select this `extension/` folder.
4. Click the LinkHub toolbar icon → set server URL if needed → Sign In
   (same account as the web dashboard).

Full step-by-step test plan (save/restore/error paths): see `TESTING.md`.

Want to understand or rebuild it yourself from scratch? Work through
`LEARN.md` — 10 lessons from "what is an extension" to a capstone that maps
every concept onto these files.

## Notes / limits

- No build step: vanilla JS on purpose, so anyone can read and audit it.
- Bulk save uses the single-URL ingest endpoint in a loop (concurrency 5).
  A future `POST /api/sessions/intake` bulk endpoint would make 70-tab dumps
  one request — the extension is ready to switch to it.
- Firefox: MV3 is largely compatible, but test `crypto.subtle` + service
  worker behavior before publishing to AMO.
