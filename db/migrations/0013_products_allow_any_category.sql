-- Migration: allow products to reference any existing category (not leaf-only).
DROP TRIGGER IF EXISTS trg_products_leaf_category ON products;
DROP FUNCTION IF EXISTS enforce_leaf_category_for_product();
