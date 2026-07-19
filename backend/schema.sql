-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    master_key_salt VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Categories Table (Centroid-based dynamic system)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    centroid_vector vector(384),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

-- Bookmarks / Content Ingestions
CREATE TABLE IF NOT EXISTS bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    url TEXT NOT NULL,
    title VARCHAR(512) NOT NULL,
    summary TEXT,
    is_favorite BOOLEAN DEFAULT FALSE,
    raw_text_vector vector(384), -- Nullable initially while worker processes link
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tags Table
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    UNIQUE(user_id, name)
);

-- Bookmark Tags Junction
CREATE TABLE IF NOT EXISTS bookmark_tags (
    bookmark_id UUID REFERENCES bookmarks(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (bookmark_id, tag_id)
);

-- Encrypted Assets Table (PDFs, HTML dumps, screenshots)
CREATE TABLE IF NOT EXISTS encrypted_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bookmark_id UUID REFERENCES bookmarks(id) ON DELETE CASCADE,
    asset_type VARCHAR(50) NOT NULL, -- 'screenshot', 'pdf', 'html_dump'
    storage_path TEXT NOT NULL,
    initialization_vector VARCHAR(64) NOT NULL,
    sha256_checksum VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Centroid Recalculation Trigger Function
CREATE OR REPLACE FUNCTION recalculate_category_centroid()
RETURNS TRIGGER AS $$
DECLARE
    target_category_id UUID;
BEGIN
    -- Determine which category needs updating
    IF TG_OP = 'DELETE' THEN
        target_category_id := OLD.category_id;
    ELSE
        target_category_id := NEW.category_id;
    END IF;

    -- Recalculate centroid for the target category
    IF target_category_id IS NOT NULL THEN
        UPDATE categories
        SET centroid_vector = (
            SELECT avg(raw_text_vector)::vector
            FROM bookmarks
            WHERE category_id = target_category_id AND raw_text_vector IS NOT NULL
        )
        WHERE id = target_category_id;
    END IF;

    -- If the category changed during an update, recalculate the old category centroid as well
    IF TG_OP = 'UPDATE' AND OLD.category_id IS NOT NULL AND OLD.category_id != NEW.category_id THEN
        UPDATE categories
        SET centroid_vector = (
            SELECT avg(raw_text_vector)::vector
            FROM bookmarks
            WHERE category_id = OLD.category_id AND raw_text_vector IS NOT NULL
        )
        WHERE id = OLD.category_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Triggers for Recalculation
DROP TRIGGER IF EXISTS trg_recalculate_centroid_insert ON bookmarks;
CREATE TRIGGER trg_recalculate_centroid_insert
AFTER INSERT OR UPDATE OF category_id, raw_text_vector ON bookmarks
FOR EACH ROW
EXECUTE FUNCTION recalculate_category_centroid();

DROP TRIGGER IF EXISTS trg_recalculate_centroid_delete ON bookmarks;
CREATE TRIGGER trg_recalculate_centroid_delete
AFTER DELETE ON bookmarks
FOR EACH ROW
EXECUTE FUNCTION recalculate_category_centroid();
