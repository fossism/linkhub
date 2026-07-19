import { getEmbedding } from './src/embeddings.js';
import { encryptBuffer, decryptBuffer } from './src/crypto.js';
import crypto from 'crypto';

const runTests = async () => {
  console.log('=== starting linkhub backend pipeline tests ===\n');

  // Test 1: Cryptography
  console.log('Test 1: Symmetrical Encryption (AES-256-GCM)...');
  try {
    const rawData = 'Hello LinkHub secure asset encryption test!';
    const key = crypto.randomBytes(32).toString('hex'); // 256 bits key

    const { encrypted, ivHex } = encryptBuffer(Buffer.from(rawData), key);
    console.log(`- Encrypted length: ${encrypted.length} bytes`);
    console.log(`- IV: ${ivHex}`);

    const decrypted = decryptBuffer(encrypted, key, ivHex);
    const decryptedText = decrypted.toString();

    if (decryptedText === rawData) {
      console.log('✅ Cryptography decryption verification SUCCESS!\n');
    } else {
      throw new Error(`Decrypted text mismatch: "${decryptedText}" !== "${rawData}"`);
    }
  } catch (err) {
    console.error('❌ Cryptography test FAILED:', err.message);
  }

  // Test 2: Local ONNX Vector Embeddings
  console.log('Test 2: Offline Transformers.js Vector Generation...');
  try {
    const sampleText = 'React is a popular frontend UI development framework built in JavaScript.';
    console.log(`- Text snippet: "${sampleText}"`);
    console.log('- Generating vector embedding...');

    const startTime = Date.now();
    const vector = await getEmbedding(sampleText);
    const duration = Date.now() - startTime;

    console.log(`- Dimensions returned: ${vector.length}`);
    console.log(`- First 5 dimensions: ${vector.slice(0, 5).join(', ')}`);
    console.log(`- Execution duration: ${duration}ms`);

    if (vector.length === 384) {
      console.log('✅ Vector generation dimension verification SUCCESS!\n');
    } else {
      throw new Error(`Expected 384 dimensions, got ${vector.length}`);
    }
  } catch (err) {
    console.error('❌ Embedding pipeline test FAILED:', err.message);
  }

  console.log('=== pipeline verification finished ===');
};

runTests();
