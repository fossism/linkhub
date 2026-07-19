import { pipeline, env } from '@xenova/transformers';

// Configure local cache directory for the HuggingFace models
env.cacheDir = './.model_cache';

let extractor = null;

/**
 * Generates a 384-dimensional vector embedding for the input text using all-MiniLM-L6-v2.
 * @param {string} text - The input text to embed.
 * @returns {Promise<number[]>} A 384-dimensional vector representing semantic features.
 */
export const getEmbedding = async (text) => {
  try {
    if (!extractor) {
      console.log('Initializing local HuggingFace embedding pipeline (Xenova/all-MiniLM-L6-v2)...');
      extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('Embedding pipeline initialized successfully.');
    }

    // Clean up text and truncate to avoid token exhaustion/slowdowns
    const cleanText = text
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000); // 2000 chars is plenty for semantic classification

    if (!cleanText) {
      // Return zero vector of 384 dimensions if input is empty
      return new Array(384).fill(0);
    }

    const output = await extractor(cleanText, { pooling: 'mean', normalize: true });
    
    // Convert Float32Array from model to a standard JS Array
    const embedding = Array.from(output.data);
    
    if (embedding.length !== 384) {
      throw new Error(`Expected 384 dimensions, got ${embedding.length}`);
    }

    return embedding;
  } catch (error) {
    console.error('Error generating vector embedding:', error);
    throw error;
  }
};

export default {
  getEmbedding
};
