# Testing the LinkHub Extension in Browsers

Step-by-step, assumes zero extension experience. Total time: ~15 minutes.

## 0. Prerequisites

The extension is only a remote control — the backend must be running first:

1. Backend API on `http://localhost:5000` (see `PROJECT_GUIDE.md` §6.2).
2. Quick check in a terminal — you must get JSON back, not an error:
   ```bash
   curl "http://localhost:5000/api/auth/salt?email=you@example.com"
   # → {"salt":"..."}
   ```
3. Web dashboard open in a tab: `http://localhost:5173` (for cross-checking).

> If step 2 fails, stop here — the extension will show
> "Cannot reach the server", which is correct behavior (see Test 6).

## 1. Load the extension

### Chrome / Edge / Brave (identical steps)

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Enable **Developer mode** (toggle, top-right).
3. Click **Load unpacked** → select this repo folder (it holds `manifest.json`).
4. You should see "LinkHub Tab Saver 0.1.0" with no red errors.
5. Click the puzzle-piece (🧩) toolbar button → pin **LinkHub Tab Saver** so its icon stays visible.

### Firefox (temporary test install)

1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**.
2. Select any file inside this repo folder (e.g. `manifest.json`).
3. Note: temporary add-ons vanish on browser restart — reload it each session.
4. If the popup looks broken, check §4 troubleshooting (service-worker differences).

## 2. Test 1 — Sign in / Create account (popup auth)

1. Click the LinkHub toolbar icon.
2. Confirm the **server URL** box at the bottom is empty (= default `http://localhost:5000`). Leave it.
3. Go to **Create Account**, enter `you@example.com` + a password, submit.
4. **Expected:** popup switches to the main view showing your email + Save buttons.
5. **Verify in backend** (proves zero-knowledge split worked):
   ```bash
   PGPASSWORD=linkhub_password psql -U linkhub -h 127.0.0.1 -p 5433 -d linkhub \
     -c "SELECT email, length(password_hash), length(master_key_salt) FROM users;"
   # password_hash ~60 chars (bcrypt), master_key_salt 32 hex chars
   ```
6. Click **Lock**, then **Sign In** with the same credentials → back to main view.

## 3. Test 2 — Save this window (core flow)

1. Open 5–6 real tabs in one window, e.g. `https://example.com`,
   a Wikipedia article, a GitHub repo. Also keep one `chrome://extensions`
   tab open (it must be *skipped* — extensions can't read system pages).
2. Click the LinkHub icon → **Save this window**.
3. **Expected:** progress bar `Saving 1/5… 5/5`, then `Saved 5 tab(s)…`.
   (Count = web tabs only; the `chrome://` tab is silently skipped.)
4. **Verify in dashboard** (`http://localhost:5173`): refresh → cards appear
   with `Ingesting…` first, then real titles/summaries/folders within ~30s.
5. **Verify via API** (optional):
   ```bash
   # log in via curl to grab a token, then:
   curl "http://localhost:5000/api/bookmarks" -H "Authorization: Bearer <TOKEN>"
   ```
6. Save the same window again → still `Saved 5` (dedupe by URL; no duplicates —
   confirm card count in dashboard didn't double).

## 4. Test 3 — Right-click save (background worker)

1. Right-click any page → **Save page to LinkHub** → toolbar badge shows **✓**.
2. Right-click any hyperlink → **Save link to LinkHub** → badge **✓**.
3. **Expected:** new cards in the dashboard after processing.
4. Without signing in first, badge shows **!** instead (auth required).

## 5. Test 4 — Restore a folder to tabs

1. In the popup: **Load folders** → pick one → **Open folder**.
2. **Expected:** that folder's bookmarks open as background (inactive) tabs.
3. Safety cap: folders with >30 items ask for confirmation first.

## 6. Test 5 — Save all windows

1. Open a second browser window with 2–3 tabs → popup → **Save all**.
2. **Expected:** `Saved N tab(s)` where N spans both windows.

## 7. Test 6 — Server-down behavior (error paths that must be friendly)

1. Stop the backend, click **Save this window**.
2. **Expected:** `Cannot reach the server. Is the backend running? …` —
   never a `JSON.parse` error. Restart backend to recover.

## 8. Test 7 — Website as side panel

1. In the popup, click **Open as side panel →**.
2. **Expected:** a side panel opens with the LinkHub dashboard loaded inside
   (same login state as the dashboard tab — sign in there once).
3. Save tabs from the popup while the panel is open → refresh the panel (⟳)
   → new cards appear. Full website, inside the extension.
4. If the panel shows the fallback message instead, the browser blocked the
   frame — click **Open dashboard in a tab instead** (also reachable via ⧉ Tab).

## 9. Reading extension logs (when something looks wrong)

| Symptom | Where to look |
|---|---|
| Popup shows wrong message / button stuck | Right-click the popup → **Inspect** → Console tab |
| Right-click save badge shows `!` | `chrome://extensions` → LinkHub **Details** → **Inspect views: service worker** → Console |
| `Could not establish connection` / manifest red text on load | Reload unpacked; re-check `manifest.json` edits with `python3 -m json.tool manifest.json` |
| 401 "Session expired" during save | Normal after 7 days or server secret change — sign in again in the popup |
| Tabs saved (202) but stuck on `Ingesting…` | Backend/worker issue, not the extension: check backend terminal log and `PROJECT_GUIDE.md` §6.3 |
| Testing against a LAN/prod server | Change server URL in popup **and** add its origin to `host_permissions` in `manifest.json`, then reload the extension |

## 9. Done = all green checklist

- [ ] Extension loads with no manifest errors
- [ ] Account created + signed in from popup; user row in DB
- [ ] Save-this-window count matches web tabs (system pages skipped, no dupes)
- [ ] Dashboard shows processed cards (title, summary, folder, tags)
- [ ] Right-click page + link save works (✓ badge)
- [ ] Folder restore opens background tabs (confirm prompt over 30)
- [ ] Server-down gives the friendly message, not a JSON crash
- [ ] Side panel opens with the dashboard embedded (or clean fallback to tab)
