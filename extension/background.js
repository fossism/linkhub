/* MV3 service worker: context-menu single-save ("Save this tab / link").
 * Popup handles bulk saves; this covers right-click without opening the popup.
 */
importScripts('crypto.js', 'common.js');

const DEFAULT_BASE = 'http://localhost:5000';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'linkhub-save-page',
    title: 'Save page to LinkHub',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'linkhub-save-link',
    title: 'Save link to LinkHub',
    contexts: ['link'],
  });
});

async function quickSave(url) {
  const { apiBase, token, encryptionKey } = await chrome.storage.local.get([
    'apiBase',
    'token',
    'encryptionKey',
  ]);
  if (!token || !encryptionKey) {
    throw new Error('Not signed in. Open the LinkHub popup and sign in first.');
  }
  const base = lhApi.normalizeBase(apiBase || DEFAULT_BASE);
  await lhApi.ingestOne(base, token, encryptionKey, url);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const url =
      info.menuItemId === 'linkhub-save-link' && info.linkUrl
        ? info.linkUrl
        : tab && tab.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('Only http(s) pages can be saved.');
    }
    await quickSave(url.split('#')[0]);
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: '#22d3ee' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
  } catch (err) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
  }
});
