/* Side panel: hosts the LinkHub website (dashboard) inside the browser.
 * The dashboard URL is derived from the stored server URL the same way the
 * popup's "Open dashboard" link does: :5000 (API) -> :5173 (Vite dev).
 * If framing is blocked, we fall back to opening a full tab.
 */
'use strict';

const DEFAULT_BASE = 'http://localhost:5000';

function dashboardUrl(apiBase) {
  const base = (apiBase || DEFAULT_BASE).trim().replace(/\/+$/, '');
  // API :5000 <-> web :5173 convention (see popup.js openDash handler).
  if (/:5000$/.test(base)) return base.replace(/:5000$/, ':5173');
  return base;
}

async function init() {
  const stored = await chrome.storage.local.get(['apiBase']);
  const url = dashboardUrl(stored.apiBase);
  const frame = document.getElementById('frame');

  // If the frame fails to load (blocked / server down), show fallback.
  let loaded = false;
  frame.addEventListener('load', () => {
    loaded = true;
  });
  setTimeout(() => {
    if (!loaded) {
      document.getElementById('fallback').style.display = 'block';
      frame.style.display = 'none';
    }
  }, 8000);

  frame.src = url;

  document.getElementById('reloadBtn').addEventListener('click', () => {
    document.getElementById('fallback').style.display = 'none';
    frame.style.display = 'block';
    loaded = false;
    frame.src = url;
    setTimeout(() => {
      if (!loaded) {
        document.getElementById('fallback').style.display = 'block';
        frame.style.display = 'none';
      }
    }, 8000);
  });

  const openTab = () => chrome.tabs.create({ url });
  document.getElementById('tabBtn').addEventListener('click', openTab);
  document.getElementById('fallbackTab').addEventListener('click', openTab);
}

init();
