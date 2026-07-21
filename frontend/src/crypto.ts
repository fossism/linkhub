// Helper to convert array buffer to hex string
export const bufferToHex = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

// Helper to convert hex string to Uint8Array
export const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

// Helper to convert base64 string to ArrayBuffer
export const base64ToBuffer = (base64: string): ArrayBuffer => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Derives a 512-bit key from a password and salt using PBKDF2.
 * Splits it into:
 *  - First 256 bits: Encryption Key (hex)
 *  - Second 256 bits: Authentication Key (hex)
 */
export const deriveKeys = async (
  password: string,
  email: string
): Promise<{ encryptionKey: string; authKey: string }> => {
  const passwordBuffer = new TextEncoder().encode(password);
  const saltBuffer = new TextEncoder().encode(email.toLowerCase().trim());

  // Import password as raw key material
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Stretches password using PBKDF2 with 100k iterations
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    512 // 512 bits = 64 bytes
  );

  const encryptionKeyBuffer = derivedBits.slice(0, 32); // first 32 bytes
  const authKeyBuffer = derivedBits.slice(32, 64);       // last 32 bytes

  return {
    encryptionKey: bufferToHex(encryptionKeyBuffer),
    authKey: bufferToHex(authKeyBuffer)
  };
};

/**
 * Decrypts an asset (base64 payload with appended tag) using the client encryption key.
 */
export const decryptAsset = async (
  base64Data: string,
  keyHex: string,
  ivHex: string
): Promise<ArrayBuffer> => {
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);
  const encryptedCombinedBuffer = base64ToBuffer(base64Data);

  // Import key into Web Crypto API
  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes as any,
    'AES-GCM',
    false,
    ['decrypt']
  );

  // Decrypt combined buffer (Web Crypto expects the 16-byte auth tag at the end)
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes as any,
      tagLength: 128 // 128 bits = 16 bytes tag
    },
    aesKey,
    encryptedCombinedBuffer
  );

  return decryptedBuffer;
};

/**
 * Converts decrypted ArrayBuffer to an object URL for rendering
 */
export const bufferToObjectURL = (buffer: ArrayBuffer, mimeType: string): string => {
  const blob = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
};

export default {
  deriveKeys,
  decryptAsset,
  bufferToHex,
  hexToBytes,
  base64ToBuffer,
  bufferToObjectURL
};
