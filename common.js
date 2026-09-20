/* Shared LinkHub API + save logic for popup.html and background.js.
 * Depends on crypto.js (lhDeriveKeys, lhRandomSaltHex).
 */
'use strict';

const lhApi = {
  normalizeBase(input) {
    const v = (input || '').trim().replace(/\/+$/, '');
    return v || 'http://localhost:5000';
  },

  async getSalt(apiBase, email) {
    const res = await fetch(
      `${apiBase}/api/auth/salt?email=${encodeURIComponent(email)}`
    );
    if (!res.ok) throw new Error(`Salt request failed (HTTP ${res.status}).`);
    const data = await res.json();
    if (!data.salt) throw new Error('Server did not return a salt.');
    return data.salt;
  },

  async login(apiBase, email, password) {
    const salt = await this.getSalt(apiBase, email);
    const { encryptionKey, authKey } = await lhDeriveKeys(password, salt);
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, passwordHash: authKey }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    return { token: data.token, encryptionKey, user: data.user };
  },

  async register(apiBase, email, password) {
    const newSalt = lhRandomSaltHex();
    const { encryptionKey, authKey } = await lhDeriveKeys(password, newSalt);
    const res = await fetch(`${apiBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        passwordHash: authKey,
        masterKeySalt: newSalt,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Registration failed.');
    return { token: data.token, encryptionKey, user: data.user };
  },

  // Keep only real web pages: skip chrome://, edge://, about:, extension pages.
  // Dedupe by normalized URL (strip hash).
  cleanTabs(tabs) {
    const seen = new Set();
    const out = [];
    for (const t of tabs || []) {
      if (!t.url || !/^https?:\/\//i.test(t.url)) continue;
      const key = t.url.split('#')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: key, title: t.title || key });
    }
    return out;
  },

  async ingestOne(apiBase, token, encryptionKey, url) {
    const res = await fetch(`${apiBase}/api/bookmarks/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Encryption-Key': encryptionKey,
      },
      body: JSON.stringify({ url }),
    });
    if (res.status === 202 || res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      const err = new Error(data.error || 'Session expired. Please sign in again.');
      err.code = 'AUTH';
      throw err;
    }
    throw new Error(data.error || `Ingest failed (HTTP ${res.status}).`);
  },

  // Save many URLs with bounded concurrency (default 5) so a 70-tab dump
  // doesn't hammer the API. onProgress(done, total, item, ok) after each.
  async saveUrls(apiBase, token, encryptionKey, items, onProgress, concurrency = 5) {
    let done = 0;
    let failed = 0;
    const queue = items.slice();
    const workers = Array.from(
      { length: Math.min(concurrency, queue.length) },
      async () => {
        while (queue.length) {
          const item = queue.shift();
          try {
            await this.ingestOne(apiBase, token, encryptionKey, item.url);
            if (onProgress) onProgress(++done, items.length, item, true);
          } catch (err) {
            failed++;
            if (onProgress) onProgress(++done, items.length, item, false, err);
            if (err && err.code === 'AUTH') throw err; // stop everything
          }
        }
      }
    );
    try {
      await Promise.all(workers);
    } catch (err) {
      if (err && err.code === 'AUTH') throw err;
    }
    return { total: items.length, failed, saved: items.length - failed };
  },

  async listCategories(apiBase, token) {
    const res = await fetch(`${apiBase}/api/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Could not load folders.');
    return res.json();
  },

  async listBookmarks(apiBase, token, categoryId) {
    const params = new URLSearchParams();
    if (categoryId) params.append('categoryId', String(categoryId));
    const res = await fetch(`${apiBase}/api/bookmarks?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Could not load bookmarks.');
    return res.json();
  },
};

if (typeof self !== 'undefined') {
  self.lhApi = lhApi;
}
