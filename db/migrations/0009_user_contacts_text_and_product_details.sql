-- Migration: user_contacts type->contact_type TEXT, drop city; add products.details JSONB

-- user_contacts index dependencies on type
DROP INDEX IF EXISTS user_contacts_unique_email;
DROP INDEX IF EXISTS user_contacts_user_type_idx;
DROP INDEX IF EXISTS user_contacts_primary_per_type_idx;

-- Align column naming and datatype
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_contacts'
      AND column_name = 'type'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_contacts'
      AND column_name = 'contact_type'
  ) THEN
    EXECUTE 'ALTER TABLE user_contacts RENAME COLUMN type TO contact_type';
  END IF;
END
$$;

DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT c.data_type
    INTO current_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'user_contacts'
    AND c.column_name = 'contact_type';

  IF current_type = 'USER-DEFINED' THEN
    EXECUTE 'ALTER TABLE user_contacts ALTER COLUMN contact_type TYPE TEXT USING contact_type::text';
  END IF;
END
$$;

ALTER TABLE user_contacts
  DROP COLUMN IF EXISTS city;

-- Recreate indexes with new column
CREATE UNIQUE INDEX IF NOT EXISTS user_contacts_unique_email
  ON user_contacts (LOWER(value))
  WHERE contact_type = 'email';

CREATE INDEX IF NOT EXISTS user_contacts_user_type_idx ON user_contacts (user_id, contact_type);

CREATE UNIQUE INDEX IF NOT EXISTS user_contacts_primary_per_type_idx
  ON user_contacts (user_id, contact_type)
  WHERE is_primary = TRUE;

-- contact_type enum no longer used
DROP TYPE IF EXISTS contact_type;

-- Add flexible product details payload
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS details JSONB;

-- Keep listing view aligned with products shape
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
    p.created_at,
    p.updated_at,
    COALESCE(ROUND(AVG(ur.rating_value)::NUMERIC, 2), 0.00) AS seller_rate
FROM products p
LEFT JOIN user_ratings ur ON ur.rated_user_id = p.owner_id
WHERE p.deleted_at IS NULL
GROUP BY p.id;
