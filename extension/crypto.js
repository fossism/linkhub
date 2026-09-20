/* LinkHub crypto helpers (plain-JS port of frontend/src/crypto.ts).
 * Must stay in sync with the web app: PBKDF2-SHA256, 100k iterations,
 * 512 bits split into encryptionKey (first 32 bytes) + authKey (last 32).
 * Loaded by both popup.html and the service worker (via importScripts).
 */
'use strict';

function lhBufferToHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function lhRandomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return lhBufferToHex(bytes);
}

async function lhDeriveKeys(password, salt) {
  const passwordBuffer = new TextEncoder().encode(password);
  const saltBuffer = new TextEncoder().encode(salt);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    512
  );

  return {
    encryptionKey: lhBufferToHex(derivedBits.slice(0, 32)),
    authKey: lhBufferToHex(derivedBits.slice(32, 64)),
  };
}

// Export for both worlds: service worker global + popup window.
if (typeof self !== 'undefined') {
  self.lhBufferToHex = lhBufferToHex;
  self.lhRandomSaltHex = lhRandomSaltHex;
  self.lhDeriveKeys = lhDeriveKeys;
}
