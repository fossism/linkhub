const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3';

/**
 * Checks if Ollama is up and running.
 * @returns {Promise<boolean>}
 */
export const checkOllamaStatus = async () => {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { method: 'GET' });
    return res.status === 200;
  } catch (error) {
    return false;
  }
};

/**
 * Uses Ollama to generate a 2-sentence summary of the page text.
 * Falls back to extracting sentences from text if Ollama is offline.
 * @param {string} text - Scraped readable text
 * @param {string} title - Page title
 * @param {string} metaDescription - Optional meta description
 * @returns {Promise<string>}
 */
export const generateSummary = async (text, title, metaDescription = '') => {
  const isOnline = await checkOllamaStatus();
  
  if (isOnline) {
    try {
      const prompt = `You are a summarization assistant. Read this web page text and write a clean, 2-sentence executive summary.
Title: ${title}
Content snippet: ${text.slice(0, 3000)}

Summary:`;

      const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          prompt,
          stream: false
        })
      });

      if (response.ok) {
        const json = await response.json();
        return json.response.trim();
      }
    } catch (err) {
      console.warn('Ollama summary generation failed. Falling back to local NLP extraction...', err.message);
    }
  }

  // Fallback Rule-Based Extraction
  if (metaDescription && metaDescription.trim().length > 10) {
    return metaDescription.trim();
  }

  // Clean and split text to grab first few sentences
  const cleanSnippet = text.replace(/\s+/g, ' ').trim();
  const sentences = cleanSnippet.split(/(?<=[.!?])\s+/);
  const summarySentences = [];
  
  for (let i = 0; i < sentences.length && summarySentences.join(' ').length < 200; i++) {
    if (sentences[i].length > 15) {
      summarySentences.push(sentences[i]);
    }
  }

  return summarySentences.join(' ') || `A link to ${title} (${new URL(text.includes('http') ? text : 'https://linkhub.dev').hostname}).`;
};

/**
 * Uses Ollama to generate 3-5 tags based on the content.
 * Falls back to keyword frequency extraction if Ollama is offline.
 * @param {string} text - Scraped text
 * @param {string} title - Page title
 * @returns {Promise<string[]>} List of tags
 */
export const generateTags = async (text, title) => {
  const isOnline = await checkOllamaStatus();

  if (isOnline) {
    try {
      const prompt = `You are a taxonomy expert. Output up to 5 precise keywords or tags for this web page.
Respond ONLY with a comma-separated list of lowercase tags. Example: react, javascript, frontend, hooks.
Title: ${title}
Content snippet: ${text.slice(0, 1500)}

Tags:`;

      const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          prompt,
          stream: false
        })
      });

      if (response.ok) {
        const json = await response.json();
        const tagText = json.response.trim();
        return tagText
          .split(',')
          .map(t => t.replace(/[^a-zA-Z0-9-]/g, '').trim().toLowerCase())
          .filter(t => t.length > 1 && t.length < 20);
      }
    } catch (err) {
      console.warn('Ollama tag generation failed. Falling back to local NLP extraction...', err.message);
    }
  }

  // Fallback tag extractor (word frequency)
  const blacklist = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'your', 'from', 'have', 'were',
    'about', 'should', 'would', 'could', 'their', 'there', 'these', 'those',
    'home', 'page', 'site', 'website', 'login', 'signup', 'main', 'navigation'
  ]);

  const cleanWords = `${title} ${text.slice(0, 1000)}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !blacklist.has(word) && isNaN(word));

  const frequencies = {};
  for (const word of cleanWords) {
    frequencies[word] = (frequencies[word] || 0) + 1;
  }

  // Sort by frequency
  const sorted = Object.entries(frequencies)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(entry => entry[0]);

  // If nothing extracted, use generic tags
  return sorted.length > 0 ? sorted : ['web', 'bookmark'];
};

export default {
  checkOllamaStatus,
  generateSummary,
  generateTags
};
