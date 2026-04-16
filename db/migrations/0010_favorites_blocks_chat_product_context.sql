-- Add favorites, user blocks, chat product context, and sell-form parity product fields.

-- Product parity fields
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_negotiable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_preferred_contact_method_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_preferred_contact_method_check
      CHECK (preferred_contact_method IN ('phone', 'chat', 'both'));
  END IF;
END $$;

-- Chat context: optional product pinned to conversation
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_product_id_idx ON conversations (product_id);

-- Favorites
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS user_favorites_product_created_idx
  ON user_favorites (product_id, created_at DESC);

-- Hard user blocks
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON user_blocks (blocked_id, created_at DESC);

-- Keep search/listing view aligned with products shape
DROP VIEW IF EXISTS product_listing_view;
CREATE VIEW product_listing_view AS
SELECT
    p.id,
    p.owner_id,
    p.category_id,
    p.name,
    p.description,
    p.price,
    p.city,
    p.address_text,
    p.details,
    p.status,
    p.is_negotiable,
    p.preferred_contact_method,
    p.created_at,
    p.updated_at,
    COALESCE(ROUND(AVG(ur.rating_value)::NUMERIC, 2), 0.00) AS seller_rate
FROM products p
LEFT JOIN user_ratings ur ON ur.rated_user_id = p.owner_id
WHERE p.deleted_at IS NULL
GROUP BY p.id;
