-- Migration: correct files.storage_provider default from 'r2' to 'cloudinary'
ALTER TABLE files ALTER COLUMN storage_provider SET DEFAULT 'cloudinary';

-- Backfill any rows inserted with the old default
UPDATE files SET storage_provider = 'cloudinary' WHERE storage_provider = 'r2';
