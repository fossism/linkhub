import { Worker } from 'bullmq';
import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import crypto from 'crypto';
import { connection } from './queue.js';
import { query } from './db.js';
import { getEmbedding } from './embeddings.js';
import { encryptBuffer } from './crypto.js';
import { uploadAsset } from './s3.js';
import { checkOllamaStatus, generateSummary, generateTags } from './ollama.js';

let browser = null;

// Initialize Playwright Browser
const getBrowser = async () => {
  if (!browser) {
    console.log('Launching headless Playwright Chromium instance...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ]
    });
  }
  return browser;
};

// Predict Category Name via LLM or fallback
const predictCategory = async (text, title, url) => {
  const isOnline = await checkOllamaStatus();
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3';

  if (isOnline) {
    try {
      const prompt = `You are a categorization assistant. Given the title, URL, and content snippet of a web page, predict a single, broad category name (e.g., "Technology", "Cooking", "Finance", "Science", "Education", "Lifestyle", "Design", "News").
Respond ONLY with the category name (1-2 words). Do not include any punctuation, quotes, or extra text.
Title: ${title}
URL: ${url}
Snippet: ${text.slice(0, 1000)}

Category:`;

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
        const categoryName = json.response.trim().replace(/[^a-zA-Z0-9\s/]/g, '');
        if (categoryName && categoryName.length < 30) {
          return categoryName;
        }
      }
    } catch (err) {
      console.warn('Ollama category prediction failed, using fallback.');
    }
  }

  // Fallback Rule-Based Categorization
  const lowerText = `${title} ${url} ${text.slice(0, 1000)}`.toLowerCase();
  
  if (lowerText.includes('github') || lowerText.includes('code') || lowerText.includes('npm') || lowerText.includes('developer') || lowerText.includes('react') || lowerText.includes('api')) {
    return 'Development';
  }
  if (lowerText.includes('recipe') || lowerText.includes('cook') || lowerText.includes('food') || lowerText.includes('kitchen') || lowerText.includes('bake')) {
    return 'Cooking';
  }
  if (lowerText.includes('stock') || lowerText.includes('crypto') || lowerText.includes('finance') || lowerText.includes('investing') || lowerText.includes('money')) {
    return 'Finance';
  }
  if (lowerText.includes('design') || lowerText.includes('css') || lowerText.includes('ui/ux') || lowerText.includes('vector') || lowerText.includes('color')) {
    return 'Design';
  }
  if (lowerText.includes('science') || lowerText.includes('physics') || lowerText.includes('research') || lowerText.includes('nature') || lowerText.includes('space')) {
    return 'Science';
  }

  return 'General';
};

// Process Bookmark Ingestion Job
const processIngestion = async (job) => {
  const { bookmarkId, userId, url, encryptionKeyHex } = job.data;
  console.log(`[Job ${job.id}] Starting ingestion for Bookmark ${bookmarkId} (URL: ${url})`);

  let pageContext;
  try {
    const playwrightBrowser = await getBrowser();
    pageContext = await playwrightBrowser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });

    const page = await pageContext.newPage();
    
    // Set 30s timeout
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    
    // Wait an extra second for layout
    await page.waitForTimeout(1000);

    const title = (await page.title()) || new URL(url).hostname;
    const htmlDump = await page.content();
    
    // Capture screenshot (PNG)
    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
    
    // Capture PDF (Print format) - wrapped in try-catch as PDF printing is only supported in headless Chromium
    let pdfBuffer = Buffer.alloc(0);
    try {
      pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    } catch (pdfErr) {
      console.warn('PDF printing not supported or failed:', pdfErr.message);
    }

    // Extract page metadata and main text with Readability
    const dom = new JSDOM(htmlDump, { url });
    const doc = dom.window.document;
    const metaDescription = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    
    const reader = new Readability(doc);
    const parsedArticle = reader.parse();
    const readableText = parsedArticle ? parsedArticle.textContent : doc.body.innerText || '';

    // Generate local vector embedding (384 Dimensions)
    const textEmbedding = await getEmbedding(readableText || title);

    // Retrieve categories and match centroid using pgvector cosine distance
    const catMatchRes = await query(
      `SELECT id, name, (centroid_vector <=> $1::vector) AS distance 
       FROM categories 
       WHERE user_id = $2 AND centroid_vector IS NOT NULL 
       ORDER BY distance ASC 
       LIMIT 1`,
      [JSON.stringify(textEmbedding), userId]
    );

    let finalCategoryId = null;

    if (catMatchRes.rows.length > 0 && catMatchRes.rows[0].distance < 0.25) {
      // High-confidence match: assign to existing category
      finalCategoryId = catMatchRes.rows[0].id;
      console.log(`Auto-assigned to existing category: "${catMatchRes.rows[0].name}" (Distance: ${catMatchRes.rows[0].distance})`);
    } else {
      // No close centroid match. Let's predict a category
      const categoryName = await predictCategory(readableText, title, url);
      
      // Check if user already has a category with this name
      const checkCatRes = await query(
        'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
        [userId, categoryName]
      );

      if (checkCatRes.rows.length > 0) {
        finalCategoryId = checkCatRes.rows[0].id;
        console.log(`Matched predicted category with existing: "${categoryName}"`);
      } else {
        // Create new category
        const createCatRes = await query(
          'INSERT INTO categories (user_id, name, description) VALUES ($1, $2, $3) RETURNING id',
          [userId, categoryName, `Auto-generated category for ${categoryName}-related content.`]
        );
        finalCategoryId = createCatRes.rows[0].id;
        console.log(`Created new category: "${categoryName}"`);
      }
    }

    // Generate summary and tags via Ollama or fallbacks
    const summary = await generateSummary(readableText, title, metaDescription);
    const tags = await generateTags(readableText, title);

    // Update bookmark metadata & vector
    await query(
      `UPDATE bookmarks 
       SET title = $1, summary = $2, category_id = $3, raw_text_vector = $4::vector 
       WHERE id = $5`,
      [title, summary, finalCategoryId, JSON.stringify(textEmbedding), bookmarkId]
    );

    // Associate Tags
    for (const tagName of tags) {
      // Insert tag if it doesn't exist
      const tagInsert = await query(
        `INSERT INTO tags (user_id, name) 
         VALUES ($1, $2) 
         ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name 
         RETURNING id`,
        [userId, tagName]
      );
      const tagId = tagInsert.rows[0].id;

      // Associate with bookmark
      await query(
        `INSERT INTO bookmark_tags (bookmark_id, tag_id) 
         VALUES ($1, $2) 
         ON CONFLICT DO NOTHING`,
        [bookmarkId, tagId]
      );
    }

    // Encrypt and Upload Assets if encryption key is supplied
    if (encryptionKeyHex) {
      const assets = [
        { type: 'html_dump', buffer: Buffer.from(htmlDump), mime: 'text/html' },
        { type: 'screenshot', buffer: screenshotBuffer, mime: 'image/png' }
      ];

      if (pdfBuffer && pdfBuffer.length > 0) {
        assets.push({ type: 'pdf', buffer: pdfBuffer, mime: 'application/pdf' });
      }

      for (const asset of assets) {
        // Perform server-side symmetric encryption
        const { encrypted, ivHex } = encryptBuffer(asset.buffer, encryptionKeyHex);
        const sha256 = crypto.createHash('sha256').update(asset.buffer).digest('hex');

        // Path structure: user_id/bookmark_id/asset_type
        const storagePath = `${userId}/${bookmarkId}/${asset.type}.enc`;

        // Upload to S3/MinIO
        await uploadAsset(storagePath, encrypted, asset.mime);

        // Store encrypted asset record in DB
        await query(
          `INSERT INTO encrypted_assets (bookmark_id, asset_type, storage_path, initialization_vector, sha256_checksum)
           VALUES ($1, $2, $3, $4, $5)`,
          [bookmarkId, asset.type, storagePath, ivHex, sha256]
        );
      }
      console.log(`Scraped and encrypted all assets for Bookmark ${bookmarkId}`);
    } else {
      console.warn(`No encryption key provided for Bookmark ${bookmarkId}. Assets skipped.`);
    }

    console.log(`[Job ${job.id}] Finished processing successfully.`);
  } catch (error) {
    console.error(`[Job ${job.id}] Failed to process bookmark ingestion:`, error);
    
    // Safe fallback: Update bookmark status to let user know scraping failed
    await query(
      `UPDATE bookmarks 
       SET title = COALESCE(title, $1), summary = $2 
       WHERE id = $3`,
      [new URL(url).hostname, `Failed to scrape page content. Error: ${error.message}`, bookmarkId]
    );
    throw error;
  } finally {
    if (pageContext) {
      await pageContext.close();
    }
  }
};

// Start BullMQ Worker
export const startWorker = () => {
  const worker = new Worker('ingestionQueue', processIngestion, {
    connection,
    concurrency: 2 // run up to 2 scraper jobs in parallel
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} has completed!`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed with error: ${err.message}`);
  });

  console.log('BullMQ Ingestion Worker started successfully.');
  return worker;
};

// If worker script is run directly, execute startWorker
if (process.argv[1] && process.argv[1].endsWith('worker.js')) {
  startWorker();
}
