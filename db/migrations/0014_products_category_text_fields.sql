-- Migration: decouple products from categories by storing category labels directly.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- Backfill best-effort labels from current category hierarchy.
UPDATE products p
SET
  category = CASE
    WHEN parent.id IS NULL THEN c.name
    ELSE parent.name
  END,
  subcategory = CASE
    WHEN parent.id IS NULL THEN NULL
    ELSE c.name
  END
FROM categories c
LEFT JOIN categories parent ON parent.id = c.parent_id
WHERE p.category_id = c.id
  AND p.category IS NULL;

-- Ensure not-null category for any pre-existing rows.
UPDATE products
SET category = COALESCE(NULLIF(BTRIM(category), ''), 'Uncategorized')
WHERE category IS NULL OR BTRIM(category) = '';

ALTER TABLE products
  ALTER COLUMN category SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_category_not_blank_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_category_not_blank_check
      CHECK (LENGTH(BTRIM(category)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_subcategory_not_blank_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_subcategory_not_blank_check
      CHECK (subcategory IS NULL OR LENGTH(BTRIM(subcategory)) > 0);
  END IF;
END $$;

DROP INDEX IF EXISTS products_category_status_created_idx;
CREATE INDEX IF NOT EXISTS products_category_status_created_idx
  ON products (category, status, created_at DESC);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_category_id_fkey;

DROP VIEW IF EXISTS product_listing_view;

ALTER TABLE products
  DROP COLUMN IF EXISTS category_id;

CREATE VIEW product_listing_view AS
SELECT
    p.id,
    p.owner_id,
    p.category,
    p.subcategory,
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
