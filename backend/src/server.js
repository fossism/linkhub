import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { initDb, query } from './db.js';
import { initS3, downloadAsset, deleteAsset } from './s3.js';
import { getEmbedding } from './embeddings.js';
import { ingestionQueue } from './queue.js';
import { startWorker } from './worker.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'linkhub_jwt_super_secret_key';

app.use(cors({
  origin: '*', // Allow all origins for dev simplicity, can restrict in production
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Encryption-Key']
}));
app.use(express.json({ limit: '10mb' }));

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
};

// ==========================================
// USER ROUTES
// ==========================================

// Get User Salt for Master Password Key Derivation
app.get('/api/auth/salt', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const result = await query('SELECT master_key_salt FROM users WHERE email = $1', [email]);
    if (result.rows.length > 0) {
      return res.json({ salt: result.rows[0].master_key_salt });
    }
    
    // Fallback: Generate a deterministic fake salt to prevent user enumeration attacks
    const fakeSalt = crypto.createHash('sha256').update(email + 'linkhub_auth_determinism_secret_key').digest('hex').slice(0, 32);
    res.json({ salt: fakeSalt });
  } catch (error) {
    console.error('Salt retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve authentication settings.' });
  }
});

// Register User
app.post('/api/auth/register', async (req, res) => {
  const { email, passwordHash, masterKeySalt } = req.body;

  if (!email || !passwordHash || !masterKeySalt) {
    return res.status(400).json({ error: 'Missing required registration parameters.' });
  }

  try {
    // Check if user already exists
    const userCheck = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(409).json({ error: 'User with this email already exists.' });
    }

    // Salt and hash the client-side stretched password on the server for security depth
    const serverPasswordHash = await bcrypt.hash(passwordHash, 10);

    const result = await query(
      'INSERT INTO users (email, password_hash, master_key_salt) VALUES ($1, $2, $3) RETURNING id, email',
      [email, serverPasswordHash, masterKeySalt]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user: { id: user.id, email: user.email, masterKeySalt } });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server registration error.' });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  const { email, passwordHash } = req.body;

  if (!email || !passwordHash) {
    return res.status(400).json({ error: 'Missing login credentials.' });
  }

  try {
    const result = await query('SELECT id, email, password_hash, master_key_salt FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(passwordHash, user.password_hash);
    
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        masterKeySalt: user.master_key_salt
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server login error.' });
  }
});

// Get User Profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT id, email, master_key_salt FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found.' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
});

// ==========================================
// CATEGORY ROUTES
// ==========================================

// Get All Categories
app.get('/api/categories', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, COUNT(b.id) as bookmark_count 
       FROM categories c 
       LEFT JOIN bookmarks b ON c.id = b.category_id 
       WHERE c.user_id = $1 
       GROUP BY c.id 
       ORDER BY c.name ASC`, 
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories.' });
  }
});

// Create Category
app.post('/api/categories', authenticateToken, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name is required.' });

  try {
    const result = await query(
      'INSERT INTO categories (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, name, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({ error: 'A category with this name already exists.' });
    }
    res.status(500).json({ error: 'Failed to create category.' });
  }
});

// ==========================================
// TAG ROUTES
// ==========================================

// Get All Tags
app.get('/api/tags', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name FROM tags WHERE user_id = $1 ORDER BY name ASC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tags.' });
  }
});

// ==========================================
// BOOKMARK ROUTES
// ==========================================

// Get Bookmarks (with Search, Tag, Favorite, and Category filters)
app.get('/api/bookmarks', authenticateToken, async (req, res) => {
  const { categoryId, tagId, isFavorite, q, semantic } = req.query;

  try {
    let result;

    if (q && semantic === 'true') {
      // Vector semantic search using pgvector
      const queryVector = await getEmbedding(q);
      
      let sql = `
        SELECT b.*, c.name as category_name,
               (b.raw_text_vector <=> $1::vector) AS distance
        FROM bookmarks b
        LEFT JOIN categories c ON b.category_id = c.id
        WHERE b.user_id = $2 AND b.raw_text_vector IS NOT NULL
      `;
      const params = [JSON.stringify(queryVector), req.user.id];

      if (categoryId) {
        sql += ` AND b.category_id = $3`;
        params.push(categoryId);
      }

      sql += ` ORDER BY distance ASC LIMIT 50`;
      result = await query(sql, params);
      
      // Inject tags and assets for the resulting bookmarks
      for (const row of result.rows) {
        const tagRes = await query(
          'SELECT t.id, t.name FROM tags t JOIN bookmark_tags bt ON t.id = bt.tag_id WHERE bt.bookmark_id = $1',
          [row.id]
        );
        row.tags = tagRes.rows;

        const assetRes = await query(
          'SELECT asset_type FROM encrypted_assets WHERE bookmark_id = $1',
          [row.id]
        );
        row.assets = assetRes.rows.map(a => a.asset_type);
      }
      return res.json(result.rows);
    }

    // Standard Keyword Search & Filtering
    let sql = `
      SELECT DISTINCT b.*, c.name as category_name 
      FROM bookmarks b
      LEFT JOIN categories c ON b.category_id = c.id
      LEFT JOIN bookmark_tags bt ON b.id = bt.bookmark_id
      WHERE b.user_id = $1
    `;
    const params = [req.user.id];
    let paramCount = 1;

    if (categoryId) {
      paramCount++;
      sql += ` AND b.category_id = $${paramCount}`;
      params.push(categoryId);
    }

    if (tagId) {
      paramCount++;
      sql += ` AND bt.tag_id = $${paramCount}`;
      params.push(tagId);
    }

    if (isFavorite === 'true') {
      sql += ` AND b.is_favorite = TRUE`;
    }

    if (q) {
      paramCount++;
      sql += ` AND (b.title ILIKE $${paramCount} OR b.summary ILIKE $${paramCount} OR b.url ILIKE $${paramCount})`;
      params.push(`%${q}%`);
    }

    sql += ` ORDER BY b.created_at DESC`;
    result = await query(sql, params);

    // Fetch and bind tags and assets for each bookmark
    for (const row of result.rows) {
      const tagRes = await query(
        'SELECT t.id, t.name FROM tags t JOIN bookmark_tags bt ON t.id = bt.tag_id WHERE bt.bookmark_id = $1',
        [row.id]
      );
      row.tags = tagRes.rows;

      const assetRes = await query(
        'SELECT asset_type FROM encrypted_assets WHERE bookmark_id = $1',
        [row.id]
      );
      row.assets = assetRes.rows.map(a => a.asset_type);
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Failed to query bookmarks:', error);
    res.status(500).json({ error: 'Failed to fetch bookmarks.' });
  }
});

// Ingest Link (creates placeholder bookmark and queues Playwright scraping)
app.post('/api/bookmarks/ingest', authenticateToken, async (req, res) => {
  const { url } = req.body;
  const encryptionKeyHex = req.headers['x-encryption-key'];

  if (!url) {
    return res.status(400).json({ error: 'URL is required for ingestion.' });
  }
  if (!encryptionKeyHex) {
    return res.status(400).json({ error: 'Missing ephemeral X-Encryption-Key header for zero-knowledge storage.' });
  }

  try {
    const domain = new URL(url).hostname;
    
    // Create initial pending bookmark record
    const bookmarkRes = await query(
      `INSERT INTO bookmarks (user_id, url, title, summary) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [req.user.id, url, domain, 'Ingesting content, scraping metadata and running local embeddings pipeline...']
    );

    const bookmark = bookmarkRes.rows[0];

    // Push ingestion task onto BullMQ Redis queue
    await ingestionQueue.add('scrape-url', {
      bookmarkId: bookmark.id,
      userId: req.user.id,
      url,
      encryptionKeyHex
    });

    res.status(202).json({
      message: 'Ingestion enqueued successfully.',
      bookmark
    });
  } catch (error) {
    console.error('Ingestion enqueue error:', error);
    res.status(500).json({ error: 'Failed to enqueue link for scraping.' });
  }
});

// Toggle Favorite Status
app.patch('/api/bookmarks/:id/favorite', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const check = await query('SELECT is_favorite FROM bookmarks WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Bookmark not found.' });
    }

    const currentFavorite = check.rows[0].is_favorite;
    const updateRes = await query(
      'UPDATE bookmarks SET is_favorite = $1 WHERE id = $2 RETURNING *',
      [!currentFavorite, id]
    );

    res.json(updateRes.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update favorite status.' });
  }
});

// Delete Bookmark (Deletes database records and associated MinIO storage blocks)
app.delete('/api/bookmarks/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Check permissions and retrieve asset list
    const assets = await query(
      `SELECT ea.storage_path 
       FROM encrypted_assets ea
       JOIN bookmarks b ON ea.bookmark_id = b.id 
       WHERE b.id = $1 AND b.user_id = $2`,
      [id, req.user.id]
    );

    // 2. Remove encrypted storage files from S3/MinIO
    for (const asset of assets.rows) {
      try {
        await deleteAsset(asset.storage_path);
      } catch (s3Err) {
        console.warn(`Could not delete storage file ${asset.storage_path} from MinIO:`, s3Err.message);
      }
    }

    // 3. Delete bookmark row (Cascade triggers handle junction tables and encrypted_assets rows)
    const deleteRes = await query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
    
    if (deleteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Bookmark not found or unauthorized.' });
    }

    res.json({ message: 'Bookmark and related archives deleted successfully.', id });
  } catch (error) {
    console.error('Delete bookmark error:', error);
    res.status(500).json({ error: 'Failed to delete bookmark.' });
  }
});

// ==========================================
// ENCRYPTED ASSETS ROUTES
// ==========================================

// Get Bookmark Assets list
app.get('/api/bookmarks/:id/assets', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const check = await query('SELECT id FROM bookmarks WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Bookmark not found.' });
    }

    const result = await query(
      'SELECT id, asset_type, initialization_vector, sha256_checksum, created_at FROM encrypted_assets WHERE bookmark_id = $1',
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch assets index.' });
  }
});

// Download and Serve Encrypted Asset Payload
app.get('/api/bookmarks/:id/assets/:type', authenticateToken, async (req, res) => {
  const { id, type } = req.params;

  try {
    // Verify bookmark belongs to requesting user
    const assetQuery = await query(
      `SELECT ea.* 
       FROM encrypted_assets ea
       JOIN bookmarks b ON ea.bookmark_id = b.id 
       WHERE b.id = $1 AND b.user_id = $2 AND ea.asset_type = $3`,
      [id, req.user.id, type]
    );

    if (assetQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found or unauthorized.' });
    }

    const asset = assetQuery.rows[0];

    // Download the AES-GCM encrypted binary file from MinIO
    const encryptedBuffer = await downloadAsset(asset.storage_path);

    // Return JSON containing encrypted payload in Base64 alongside IV and Checksum
    res.json({
      encryptedData: encryptedBuffer.toString('base64'),
      initializationVector: asset.initialization_vector,
      checksum: asset.sha256_checksum,
      assetType: asset.asset_type
    });
  } catch (error) {
    console.error('Failed to download encrypted asset:', error);
    res.status(500).json({ error: 'Failed to retrieve asset data.' });
  }
});

// ==========================================
// STARTUP ENGINE
// ==========================================
const startServer = async () => {
  try {
    // 1. Initialize Postgres Schema
    await initDb();

    // 2. Initialize MinIO Connection & Bucket
    await initS3();

    // 3. Start BullMQ Queue Worker
    startWorker();

    // 4. Listen on Express port
    app.listen(PORT, () => {
      console.log(`LinkHub API Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Critical server failure during initialization:', error);
    process.exit(1);
  }
};

startServer();
