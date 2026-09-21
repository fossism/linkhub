# Publish LinkHub Tab Saver to the Chrome Web Store (step by step)

Assumes the extension is fully tested locally (`TESTING.md` all green).

## 1. What you need before starting

- [ ] A Google account + **one-time $5 developer registration fee**.
- [ ] The store zip (built in step 2 — test exactly what you ship).
- [ ] Icons: done — `icons/icon16|48|128.png` (wired in `manifest.json`).
- [ ] Screenshots: 1280×800 or 640×400 PNGs — take 3: popup save screen,
      side panel with dashboard, right-click menu. Capture with any screenshot
      tool while testing.
- [ ] Short description (≤132 chars), e.g.:
      `Save all open tabs to your self-hosted LinkHub in one click. Auto-organized, private.`
- [ ] Privacy story (reviewers read this): *"Passwords never leave the device —
      only a derived auth key is sent. Page archives are AES-256-GCM encrypted
      before upload; the server cannot read them. No analytics, no third parties."*

## 2. Build the exact zip you will upload

From the repo root (so `manifest.json` is at the zip root):

```bash
rm -f linkhub-extension.zip
zip -r linkhub-extension.zip manifest.json popup.html popup.js sidepanel.html \
  sidepanel.js background.js common.js crypto.js icons/ \
  -x '*.DS_Store'
unzip -l linkhub-extension.zip
```

Ship runtime files only — leave the `*.md` guides on GitHub, not in the zip.

## 3. Sanity-test the shippable

```bash
rm -rf /tmp/lh-store-test && mkdir -p /tmp/lh-store-test
unzip -q linkhub-extension.zip -d /tmp/lh-store-test
```

Load `/tmp/lh-store-test` unpacked in Chrome and redo `TESTING.md` Tests 1–4.
If it works from the zip, it works from the store.

## 4. Submit (developer dashboard)

1. Go to the Chrome Web Store Developer Dashboard → pay the $5 fee (first time).
2. **New Item** → upload `linkhub-extension.zip`.
3. **Store listing:** name `LinkHub Tab Saver`, short description (above),
   detailed description (paste from `README.md` features), category
   **Productivity**, language, upload screenshots.
4. **Privacy tab** — justify every sensitive item or expect rejection:
   - `tabs`: "Lists open tabs so the user can bulk-save the current window."
   - `storage`: "Stores server URL, login token and encryption key on-device."
   - `contextMenus`: "Right-click save of the current page/link."
   - `sidePanel`: "Embeds the user's own LinkHub dashboard beside their tabs."
   - `host_permissions` (localhost): "Default self-hosted server address;
     user-configurable in the popup."
   - Data usage: authentication tokens, website URLs the user chooses to save.
     No data sold, no third-party sharing.
5. **Distribution:** choose regions, visibility Public.
6. **Submit for review** — typically a few days; watch your email for reviewer
   questions and answer with the justifications above.

> Heads-up: the default server URL is `http://localhost:5000` (self-hosted).
> Reviewers sometimes flag localhost permissions — explain in the notes that
> the product *is* a self-hosted companion and the URL is user-configurable.

## 5. Ship updates later

1. Bump `"version"` in `manifest.json` (e.g. `0.1.0` → `0.2.0`).
2. Rebuild the zip (§2), retest (§3), upload as a new version of the same item.
3. Rollout is automatic after review; users update silently.

## 6. Firefox (AMO) in short

1. Test via `about:debugging` → Load Temporary Add-on (see `TESTING.md`).
2. Fix what breaks (`browser.*` vs `chrome.*`, service-worker quirks).
3. Submit the same zip at addons.mozilla.org → review → signed `.xpi`.
