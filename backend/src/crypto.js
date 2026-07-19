import crypto from 'crypto';

/**
 * Encrypts a buffer using AES-256-GCM.
 * The 16-byte authentication tag is appended to the end of the encrypted buffer.
 * @param {Buffer} buffer - Content to encrypt
 * @param {string} keyHex - 64-character hexadecimal key (256 bits)
 * @returns {{encrypted: Buffer, ivHex: string}}
 */
export const encryptBuffer = (buffer, keyHex) => {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid key length. Key must be a 32-byte (256-bit) hex string.');
  }

  // 12-byte IV is standard for GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(buffer),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag(); // 16 bytes
  
  // Combine encrypted data and authTag into a single buffer
  const combined = Buffer.concat([encrypted, authTag]);
  
  return {
    encrypted: combined,
    ivHex: iv.toString('hex')
  };
};

/**
 * Decrypts a buffer using AES-256-GCM.
 * The authentication tag is extracted from the last 16 bytes of the buffer.
 * @param {Buffer} encryptedBufferCombined - Ciphertext with appended 16-byte auth tag
 * @param {string} keyHex - 64-character hexadecimal key (256 bits)
 * @param {string} ivHex - Hexadecimal initialization vector
 * @returns {Buffer} decrypted buffer
 */
export const decryptBuffer = (encryptedBufferCombined, keyHex, ivHex) => {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');

  if (key.length !== 32) {
    throw new Error('Invalid key length. Key must be a 32-byte (256-bit) hex string.');
  }

  // Extract auth tag from the end of the buffer (last 16 bytes)
  const authTagLength = 16;
  const encryptedDataLength = encryptedBufferCombined.length - authTagLength;
  
  const encryptedData = encryptedBufferCombined.subarray(0, encryptedDataLength);
  const authTag = encryptedBufferCombined.subarray(encryptedDataLength);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encryptedData),
    decipher.final()
  ]);
};

export default {
  encryptBuffer,
  decryptBuffer
};
