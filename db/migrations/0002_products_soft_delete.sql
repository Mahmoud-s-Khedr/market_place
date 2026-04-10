-- Migration: add soft-delete support to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE OR REPLACE VIEW product_listing_view AS
SELECT
    p.id,
    p.owner_id,
    p.category_id,
    p.name,
    p.description,
    p.price,
    p.city,
    p.address_text,
    p.status,
    p.created_at,
    p.updated_at,
    COALESCE(ROUND(AVG(ur.rating_value)::NUMERIC, 2), 0.00) AS seller_rate
FROM products p
LEFT JOIN user_ratings ur ON ur.rated_user_id = p.owner_id
WHERE p.deleted_at IS NULL
GROUP BY p.id;
