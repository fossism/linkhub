/* Popup logic: auth, bulk tab save with progress, folder restore. */
'use strict';

const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = 'http://localhost:5000';

let state = { apiBase: DEFAULT_BASE, token: null, encryptionKey: null, email: null };
let isLoginMode = true;

function msg(el, text, kind = '') {
  el.textContent = text;
  el.className = 'msg ' + kind;
}

function friendlyError(err) {
  if (err instanceof TypeError) {
    return 'Cannot reach the server. Is the backend running? Check the server URL below.';
  }
  return err.message || 'Something went wrong.';
}

async function loadState() {
  const stored = await chrome.storage.local.get([
    'apiBase',
    'token',
    'encryptionKey',
    'email',
  ]);
  state = {
    apiBase: lhApi.normalizeBase(stored.apiBase || DEFAULT_BASE),
    token: stored.token || null,
    encryptionKey: stored.encryptionKey || null,
    email: stored.email || null,
  };
  $('apiBase').value = state.apiBase === DEFAULT_BASE ? '' : state.apiBase;
  render();
}

function render() {
  const signedIn = !!(state.token && state.encryptionKey);
  $('authView').classList.toggle('hidden', signedIn);
  $('mainView').classList.toggle('hidden', !signedIn);
  if (signedIn) $('whoLabel').textContent = state.email || 'Signed in';
}

function setMode(login) {
  isLoginMode = login;
  $('tabLogin').style.cssText = login ? 'border-color:#22d3ee;color:#22d3ee' : '';
  $('tabRegister').style.cssText = login ? '' : 'border-color:#22d3ee;color:#22d3ee';
  $('authGo').textContent = login ? 'Sign In' : 'Create Account';
  msg($('authMsg'), '');
}

// --- auth ---
$('tabLogin').addEventListener('click', () => setMode(true));
$('tabRegister').addEventListener('click', () => setMode(false));

$('authGo').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) {
    msg($('authMsg'), 'Enter email and master password.', 'err');
    return;
  }
  $('authGo').disabled = true;
  msg($('authMsg'), isLoginMode ? 'Signing in…' : 'Creating account…', 'info');
  try {
    const base = state.apiBase;
    const session = isLoginMode
      ? await lhApi.login(base, email, password)
      : await lhApi.register(base, email, password);
    await chrome.storage.local.set({
      token: session.token,
      encryptionKey: session.encryptionKey,
      email,
      apiBase: base,
    });
    $('password').value = '';
    await loadState();
    msg($('authMsg'), '');
  } catch (err) {
    if (err.message && /already exists/i.test(err.message)) {
      msg($('authMsg'), 'Account exists — hit Sign In instead.', 'err');
    } else {
      msg($('authMsg'), friendlyError(err), 'err');
    }
  } finally {
    $('authGo').disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['token', 'encryptionKey', 'email']);
  await loadState();
});

// --- bulk save ---
async function collectTabs(allWindows) {
  const query = allWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(query);
  return lhApi.cleanTabs(tabs);
}

async function runSave(allWindows) {
  const items = await collectTabs(allWindows);
  if (!items.length) {
    msg($('saveMsg'), 'No savable web pages in scope (system pages are skipped).', 'err');
    return;
  }
  $('saveWindow').disabled = true;
  $('saveAll').disabled = true;
  const bar = $('saveBar');
  bar.style.display = 'block';
  const fill = bar.firstElementChild;
  msg($('saveMsg'), `Saving 0/${items.length}…`, 'info');
  try {
    const result = await lhApi.saveUrls(
      state.apiBase,
      state.token,
      state.encryptionKey,
      items,
      (done, total) => {
        fill.style.width = `${Math.round((done / total) * 100)}%`;
        msg($('saveMsg'), `Saving ${done}/${total}…`, 'info');
      }
    );
    if (result.failed === 0) {
      msg($('saveMsg'), `Saved ${result.saved} tab(s). The server files them into folders automatically.`, 'ok');
    } else {
      msg($('saveMsg'), `Saved ${result.saved}/${result.total}. ${result.failed} failed — retry from dashboard.`, 'err');
    }
  } catch (err) {
    if (err.code === 'AUTH') {
      await chrome.storage.local.remove(['token', 'encryptionKey']);
      await loadState();
      msg($('authMsg'), 'Session expired. Please sign in again.', 'err');
    } else {
      msg($('saveMsg'), friendlyError(err), 'err');
    }
  } finally {
    $('saveWindow').disabled = false;
    $('saveAll').disabled = false;
    setTimeout(() => {
      bar.style.display = 'none';
      fill.style.width = '0';
    }, 4000);
  }
}

$('saveWindow').addEventListener('click', () => runSave(false));
$('saveAll').addEventListener('click', () => runSave(true));

// --- restore ---
$('loadFolders').addEventListener('click', async () => {
  try {
    msg($('restoreMsg'), 'Loading folders…', 'info');
    const cats = await lhApi.listCategories(state.apiBase, state.token);
    const sel = $('folderSel');
    sel.innerHTML = '';
    if (!cats.length) {
      sel.innerHTML = '<option value="">(no folders yet)</option>';
      msg($('restoreMsg'), 'No folders yet — save some tabs first.', '');
      return;
    }
    for (const c of cats) {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = `${c.name} (${c.bookmark_count})`;
      sel.appendChild(opt);
    }
    msg($('restoreMsg'), `${cats.length} folder(s) loaded.`, 'ok');
  } catch (err) {
    msg($('restoreMsg'), friendlyError(err), 'err');
  }
});

$('restoreBtn').addEventListener('click', async () => {
  const categoryId = $('folderSel').value;
  if (!categoryId) {
    msg($('restoreMsg'), 'Load folders and pick one first.', 'err');
    return;
  }
  $('restoreBtn').disabled = true;
  try {
    const bookmarks = await lhApi.listBookmarks(state.apiBase, state.token, categoryId);
    if (!bookmarks.length) {
      msg($('restoreMsg'), 'Folder is empty.', 'err');
      return;
    }
    const limited = bookmarks.slice(0, 30);
    if (bookmarks.length > 30 && !confirm(`Open ${bookmarks.length} tabs? Capped at 30 for safety. Proceed?`)) {
      return;
    }
    for (const b of limited) {
      await chrome.tabs.create({ url: b.url, active: false });
      await new Promise((r) => setTimeout(r, 150)); // don't burst the browser
    }
    msg($('restoreMsg'), `Opened ${limited.length} tab(s).`, 'ok');
  } catch (err) {
    msg($('restoreMsg'), friendlyError(err), 'err');
  } finally {
    $('restoreBtn').disabled = false;
  }
});

// --- settings / dashboard ---
$('saveSettings').addEventListener('click', async () => {
  const base = lhApi.normalizeBase($('apiBase').value || DEFAULT_BASE);
  await chrome.storage.local.set({ apiBase: base });
  state.apiBase = base;
  $('apiBase').value = base === DEFAULT_BASE ? '' : base;
});

$('openDash').addEventListener('click', async (e) => {
  e.preventDefault();
  const url = state.apiBase.replace(/:5000\/?$/, ':5173');
  await chrome.tabs.create({ url: url === state.apiBase ? state.apiBase : url });
});

$('openPanel').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  } catch (err) {
    const target = $('mainView').classList.contains('hidden') ? $('authMsg') : $('saveMsg');
    msg(target, 'Side panel not available in this browser version.', 'err');
  }
});

setMode(true);
loadState();
