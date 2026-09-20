# Learn to Build a Web Extension (From Zero)

You will rebuild the ideas behind LinkHub Tab Saver yourself, one small
working step at a time. No prior extension knowledge assumed — only basic
JavaScript (variables, functions, `async/await`, `fetch`).

**How to use this file:** do the lessons in order. Each ends with a
checkpoint — don't move on until you see it. Your practice folder is
`~/linkhub-learn/` (separate from the repo's `extension/` so you can't break
the real one). Final lesson maps everything you built to the real files.

---

## Lesson 0 — What an extension even is (5 min, no code)

A browser extension is just **a tiny website the browser loads specially**:
HTML + CSS + JS files in a folder, plus a `manifest.json` that says what the
files may do. "May do" matters: a normal website cannot list your tabs or
read another site's cookies. An extension can — but only after it **declares**
each power in the manifest and the user accepts it at install. That list is
called **permissions**.

Three pieces you'll use:

| Piece | Plain meaning | In our project |
|---|---|---|
| **Popup** | The little panel when you click the toolbar icon. A normal HTML page, dies when closed. | `popup.html` |
| **Service worker** | Invisible background script. No page, no DOM. Wakes on events (install, right-click). | `background.js` |
| **APIs** (`chrome.*`) | The superpowers: `chrome.tabs`, `chrome.storage`, `chrome.contextMenus`. Only available to extensions. | everywhere |

> Key mental model: the popup is forgetful (closes = all variables gone).
> Anything that must survive — login token, settings — goes in
> `chrome.storage`. The service worker is also forgetful (browser kills it
> when idle) — so it reads storage fresh on every event.

**Checkpoint:** can you explain to someone why a popup can't "remember" a
token in a variable? (Answer: the page is destroyed on close.)

---

## Lesson 1 — Your first extension: Hello Popup (10 min)

1. Create the practice folder and two files:

`~/linkhub-learn/manifest.json`
```json
{
  "manifest_version": 3,
  "name": "Learn Ext",
  "version": "0.1.0",
  "action": { "default_popup": "popup.html" }
}
```

`~/linkhub-learn/popup.html`
```html
<!DOCTYPE html>
<html><body style="width:200px;background:#0b0f19;color:#fff">
  <h3>Hello, tabs!</h3>
  <script src="popup.js"></script>
</body></html>
```

`~/linkhub-learn/popup.js`
```js
console.log('popup alive');
```

2. Open `chrome://extensions` → Developer mode ON → **Load unpacked** →
   pick `~/linkhub-learn`. Pin the icon, click it.

**Checkpoint:** you see "Hello, tabs!". Right-click the popup → Inspect →
Console shows `popup alive`. You just ran code inside the browser chrome.

*Concepts: `manifest_version: 3` (the current standard), `action.default_popup`.*

---

## Lesson 2 — Permissions + the tabs API (15 min)

Goal: list your open tabs. Tab contents are private, so this needs permission.

1. Add to `manifest.json`:
```json
"permissions": ["tabs"]
```
2. Replace `popup.js`:
```js
async function main() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  document.body.insertAdjacentHTML(
    'beforeend',
    `<p>${tabs.length} tabs open</p>` +
      tabs.map((t) => `<div>• ${t.title || t.url}</div>`).join('')
  );
}
main();
```
3. Go to `chrome://extensions` → click the reload ⟳ icon on your extension →
   reopen the popup.

**Checkpoint:** popup lists your tabs. Open a `chrome://extensions` tab and
reload — notice its `title` shows but `url` is hidden/empty. That's the
browser protecting system pages; your code must expect missing URLs.

*Concepts: declaring powers, `chrome.tabs.query`, reloading during dev.*
*Real-file link: this is the seed of `lhApi.cleanTabs()` in `common.js` —
ours additionally keeps only `http(s)`, strips `#fragments`, dedupes.*

**Exercise:** filter the list to `http(s)` URLs only with a regex test, and
show the count of skipped tabs. (Solution pattern is in `common.js`.)

---

## Lesson 3 — Storage: remembering things (10 min)

Variables die with the popup. Storage doesn't.

```js
// save
await chrome.storage.local.set({ username: 'rohit' });
// load (later, even after browser restart)
const { username } = await chrome.storage.local.get(['username']);
```

Add to your popup: an `<input id="name">` + button that saves, and on load
greets the stored name. Reload the popup — the greeting survives.

**Checkpoint:** close the popup, reopen it — name still there.

*Concepts: `storage` permission, async get/set.*
*Real-file link: `popup.js` `loadState()` stores `apiBase/token/encryptionKey/email` exactly like this. "Lock" is just `storage.local.remove(...)`.*

---

## Lesson 4 — Talking to a server: fetch + host_permissions (20 min)

Your popup can `fetch()` like any page — but to *your* server it must declare it:

```json
"host_permissions": ["http://localhost:5000/*"]
```

Without that line, the request is blocked. (This is also why our manifest
lists `:5173` and box-wide `localhost` variants.)

Try it against the running LinkHub backend:
```js
const res = await fetch('http://localhost:5000/api/auth/salt?email=a@b.c');
console.log(await res.json()); // → { salt: '...' }
```

**Checkpoint:** you see a salt in the popup's Inspect console.

*Concepts: extensions are still bound by request allowlists; backend CORS
(`Access-Control-Allow-Origin`) must also permit the call — ours uses `*`
in dev.*
*Real-file link: every function in `common.js` (`getSalt`, `login`,
`ingestOne`) is this pattern + headers.*

**Exercise:** intentionally stop the backend and run the fetch. See the
`TypeError: Failed to fetch`? That's the exact error our `friendlyError()`
translates into human words. Good error handling *is* a feature.

---

## Lesson 5 — Crypto without a library (15 min, mostly understanding)

LinkHub never sends your password. Instead the extension **derives** two keys
from it with PBKDF2 (a slow hash, 100,000 rounds) and the browser does it with
built-in WebCrypto — no library:

```js
const { encryptionKey, authKey } = await lhDeriveKeys(password, salt);
// encryptionKey → stays on device, decrypts your archives
// authKey       → sent to server as your "password"
```

Copy `extension/crypto.js` into your practice folder and call `lhDeriveKeys`
from the console with any password+salt. Same inputs → same outputs (try it
twice). Different salt → totally different keys.

**Checkpoint:** can you explain why the server can't read your archives even
though it stored them? (Answer: it only ever saw the auth half + ciphertext.)

*Real-file link: `crypto.js` is a line-for-line port of `frontend/src/crypto.ts`.
Both apps must use identical parameters or login breaks — that's why the file
header says "must stay in sync". This is your first taste of protocol compatibility.*

---

## Lesson 6 — Login end-to-end (20 min, the big one)

Chain Lessons 4+5+3 into the real flow:

```js
// 1. get salt for this email
const salt = await lhApi.getSalt(BASE, email);
// 2. derive keys locally
const { encryptionKey, authKey } = await lhDeriveKeys(password, salt);
// 3. log in with the auth half
const res = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, passwordHash: authKey }),
});
// 4. remember the session
const { token } = await res.json();
await chrome.storage.local.set({ token, encryptionKey, email });
```

Implement it with two inputs + a button in your practice popup.

**Checkpoint:** after login, `chrome.storage.local.get(['token'])` in the
console shows a JWT (three `xxx.yyy.zzz` parts). Paste the middle part into
jwt.io — see your email inside? That's how the server knows who you are on
every later request (`Authorization: Bearer <token>`).

*Real-file link: `lhApi.login()` in `common.js`, wired to the form in `popup.js`.*

---

## Lesson 7 — Save tabs with a progress loop (20 min)

Now the product feature. For each tab URL:

```js
await fetch(BASE + '/api/bookmarks/ingest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Encryption-Key': encryptionKey, // server encrypts archives with this
  },
  body: JSON.stringify({ url }),
}); // → HTTP 202 = "queued, will process in background"
```

Two professional touches (both in our `saveUrls`):

1. **Bounded concurrency** — don't fire 70 requests at once; run 5 workers
   pulling from a shared queue array (`queue.shift()`).
2. **Progress callback** — update bar + text after each completion, count
   failures separately, and abort everything on 401 (session dead → re-login).

**Checkpoint:** saving 5 tabs shows `Saving 1/5 … 5/5 → Saved 5 tab(s)`, and
the dashboard shows them processing.

**Exercise:** change concurrency 5 → 1 and feel the difference on 10 tabs.
That's why the knob exists.

---

## Lesson 8 — Service worker + right-click menu (15 min)

The popup can't act when closed. The service worker can — it wakes per event.
New file `background.js`, registered in the manifest:

```json
"background": { "service_worker": "background.js" },
"permissions": ["tabs", "storage", "contextMenus"]
```

```js
importScripts('crypto.js', 'common.js'); // SW has no <script> tags; this is how you share code

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save', title: 'Save to LinkHub', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const { token, encryptionKey } = await chrome.storage.local.get(['token', 'encryptionKey']);
  await lhApi.ingestOne(BASE, token, encryptionKey, tab.url);
  chrome.action.setBadgeText({ text: '✓' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
});
```

**Checkpoint:** right-click a page → menu item → ✓ badge appears.

*Gotchas worth knowing: no `window`/`document` in workers; `crypto.subtle`
works there (secure context); the worker is killed when idle, so always
re-read storage — never cache the token in a variable (our code does this right).*
*Real-file link: `background.js` — ours adds a link-context item and a `!` error badge.*

---

## Lesson 9 — Debugging like an extension dev (10 min)

| Problem | Tool |
|---|---|
| Popup JS broken | Right-click popup → **Inspect** → Console |
| Worker broken / menu dead | `chrome://extensions` → extension card → **Inspect views: service worker** |
| `Uncaught (in promise)` on fetch | Backend down or missing `host_permissions` |
| Changes not showing | Hit ⟳ on the extension card (workers/popups don't hot-reload) |
| Manifest red error on load | Validate: `python3 -m json.tool manifest.json` |

**Checkpoint:** deliberately break something (wrong function name) and find it
using the correct console from the table. This skill is half the job.

---

## Lesson 10 — Capstone: read the real thing (30 min)

You now know every idea in `extension/`. Read it in this order and notice how
small each file is:

1. `manifest.json` — Lessons 1, 2, 4, 8 (one line per power).
2. `crypto.js` — Lesson 5.
3. `common.js` — Lessons 4, 6, 7 (`cleanTabs`, `login/register`, `saveUrls`).
4. `popup.js` / `popup.html` — Lessons 3, 6, 7 (+ restore = `listCategories`/`listBookmarks` + `chrome.tabs.create`).
5. `background.js` — Lesson 8.
6. `TESTING.md` — run the full checklist against *your own understanding*.

**Final exercises (increasing difficulty):**
1. ★ Add a "Save only pinned tabs" button (`t.pinned` + `cleanTabs`).
2. ★★ Show per-URL failures in the popup (collect them from the progress callback).
3. ★★★ Add `POST /api/sessions/intake` support: if the endpoint exists, send all URLs in one request, else fall back to the loop. (This is how real client/server evolution works.)
4. ★★★★ Port the extension to Firefox: install temporarily via `about:debugging`, fix what breaks, note every difference. Genuinely useful contribution.

---

## Where to go next

- **Concepts:** MDN "Browser Extensions" docs (the `chrome.*` APIs are documented as `browser.*` there — same ideas, promises in Firefox).
- **Publishing:** Chrome Web Store needs a zip, 128px icon, screenshots, privacy disclosure (ours is easy: "no data leaves your server"). Don't publish until `JWT_SECRET` is required and CORS is tightened (see `PROJECT_GUIDE.md` §7).
- **Ideas to build:** auto-save on window close, tab-group-aware saving, keyboard shortcut (`commands` manifest key), per-folder restore into tab groups.
