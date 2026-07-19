import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectionString = process.env.DATABASE_URL || 'postgres://linkhub:linkhub_password@localhost:5432/linkhub';

const pool = new pg.Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

export const query = (text, params) => pool.query(text, params);

export const initDb = async () => {
  let client;
  try {
    client = await pool.connect();
    console.log('Successfully connected to database. Running migrations...');
    
    const schemaPath = path.join(__dirname, '../schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query(schemaSql);
    console.log('Database schema migration completed successfully.');
  } catch (err) {
    console.error('Error running migrations on database:', err);
    throw err;
  } finally {
    if (client) client.release();
  }
};

export default {
  query,
  initDb
};
