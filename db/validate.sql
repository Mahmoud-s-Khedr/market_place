-- Validation script for db/schema.sql
-- Run against a clean database after applying schema.sql.

BEGIN;

-- 1) Seed minimal data
INSERT INTO users (name, ssn, phone, password_hash, avatar_object_key)
VALUES
  ('أحمد محمد', '11111111111111', '+201000000001', 'hash_1', 'avatars/1/profile.jpg'),
  ('Sara Ali', '22222222222222', '+201000000002', 'hash_2', NULL),
  ('مشرف النظام', '33333333333333', '+201000000003', 'hash_3', NULL);

INSERT INTO user_contacts (user_id, contact_type, value, is_primary)
VALUES
  (1, 'email', 'ahmed@example.com', TRUE),
  (1, 'address', 'شارع النصر، مدينة نصر', TRUE);

INSERT INTO auth_otps (user_id, phone, code_hash, purpose, expires_at)
VALUES
  (1, '+201000000001', 'otp_hash_1', 'registration', NOW() + INTERVAL '10 minutes'),
  (NULL, '+201000000009', 'otp_hash_2', 'password_reset', NOW() + INTERVAL '10 minutes');

-- Category tree (multi-level):
-- 1 Electronics
--   2 Mobiles
--     4 Android Phones (leaf)
-- 3 Home
INSERT INTO categories (name, parent_id)
VALUES
  ('Electronics', NULL),
  ('Mobiles', 1),
  ('Home', NULL),
  ('Android Phones', 2);

INSERT INTO products (owner_id, category_id, name, description, price, city, address_text, details, status)
VALUES
  (1, 4, 'هاتف سامسونج', 'مستعمل بحالة جيدة جدا', 8500.00, 'القاهرة', 'شارع عباس العقاد', '{"condition":"used"}', 'available'),
  (2, 3, 'Wooden Desk', 'Office desk in good condition', 3200.00, 'Giza', 'Dokki', '{"material":"wood"}', 'available');

-- Canonical files rows (source of truth).
INSERT INTO files (
  uploader_user_id, owner_type, owner_id, purpose, storage_provider, bucket,
  object_key, original_filename, mime_type, file_size_bytes, checksum_sha256,
  status, uploaded_at
)
VALUES
  (1, 'user', 1, 'avatar', 'r2', 'market-media', 'avatars/1/profile.jpg', 'profile.jpg', 'image/jpeg', 102400, NULL, 'uploaded', NOW()),
  (1, 'product', 1, 'product_image', 'r2', 'market-media', 'products/1/0.jpg', 'p1-0.jpg', 'image/jpeg', 121231, NULL, 'uploaded', NOW()),
  (1, 'product', 1, 'product_image', 'r2', 'market-media', 'products/1/1.jpg', 'p1-1.jpg', 'image/jpeg', 142500, NULL, 'uploaded', NOW()),
  (2, 'product', 2, 'product_image', 'r2', 'market-media', 'products/2/0.jpg', 'p2-0.jpg', 'image/jpeg', 110020, NULL, 'uploaded', NOW());

-- Link users to canonical avatar file.
UPDATE users
SET avatar_file_id = 1
WHERE id = 1;

-- Keep legacy object_key while linking to canonical file rows.
INSERT INTO product_images (product_id, file_id, object_key, mime_type, file_size_bytes, sort_order)
VALUES
  (1, 2, 'products/1/0.jpg', 'image/jpeg', 121231, 0),
  (1, 3, 'products/1/1.jpg', 'image/jpeg', 142500, 1),
  (2, 4, 'products/2/0.jpg', 'image/jpeg', 110020, 0);

INSERT INTO conversations (user_a_id, user_b_id)
VALUES (1, 2);

INSERT INTO messages (conversation_id, sender_id, message_text)
VALUES
  (1, 1, 'مرحبا، هل المنتج متاح؟'),
  (1, 2, 'نعم متاح حاليا');

INSERT INTO user_ratings (rater_id, rated_user_id, rating_value, comment)
VALUES
  (2, 1, 5, 'بائع ممتاز'),
  (1, 2, 4, 'مشتري ملتزم');

INSERT INTO user_reports (reporter_id, reported_user_id, reason, status)
VALUES
  (1, 2, 'رسائل مزعجة', 'open');

INSERT INTO admin_warnings (admin_id, target_user_id, message)
VALUES
  (3, 2, 'الرجاء الالتزام بسياسة المنصة');

-- 2) Constraint tests that should fail (caught and logged)
DO $$
DECLARE
  tmp_category_id BIGINT;
BEGIN
  BEGIN
    INSERT INTO users (name, ssn, phone, password_hash)
    VALUES ('Duplicate Phone', '44444444444444', '+201000000001', 'hash_dup');
    RAISE EXCEPTION 'Expected duplicate phone insert to fail, but it succeeded';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate phone rejected';
  END;

  BEGIN
    INSERT INTO user_ratings (rater_id, rated_user_id, rating_value)
    VALUES (1, 3, 6);
    RAISE EXCEPTION 'Expected invalid rating to fail, but it succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: rating out of range rejected';
  END;

  BEGIN
    INSERT INTO products (owner_id, category_id, name, description, price, city, address_text, details)
    VALUES (1, 4, 'Invalid Price', 'should fail', -10, 'Cairo', 'Any', '{"test":"invalid"}');
    RAISE EXCEPTION 'Expected negative price to fail, but it succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: negative price rejected';
  END;

  BEGIN
    INSERT INTO conversations (user_a_id, user_b_id)
    VALUES (2, 1);
    RAISE EXCEPTION 'Expected unordered conversation pair to fail, but it succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: conversation pair ordering enforced';
  END;

  BEGIN
    INSERT INTO categories (name, parent_id)
    VALUES ('mobiles', 1);
    RAISE EXCEPTION 'Expected duplicate sibling name to fail, but it succeeded';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: sibling name uniqueness enforced (case-insensitive)';
  END;

  BEGIN
    INSERT INTO categories (name, parent_id) VALUES ('Temp', NULL) RETURNING id INTO tmp_category_id;
    UPDATE categories SET parent_id = tmp_category_id WHERE id = tmp_category_id;
    RAISE EXCEPTION 'Expected self parent category update to fail, but it succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: self parent prevented';
  END;

  BEGIN
    INSERT INTO products (owner_id, category_id, name, description, price, city, address_text, details)
    VALUES (1, 1, 'Non-leaf category product', 'should fail', 1000, 'Cairo', 'Any', '{"test":"non_leaf"}');
    RAISE EXCEPTION 'Expected non-leaf category product insert to fail, but it succeeded';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS: non-leaf category assignment rejected';
  END;

  BEGIN
    INSERT INTO files (
      uploader_user_id, owner_type, owner_id, purpose, storage_provider, bucket,
      object_key, status, uploaded_at
    ) VALUES (
      1, 'product', 1, 'product_image', 'r2', 'market-media',
      'products/1/0.jpg', 'uploaded', NOW()
    );
    RAISE EXCEPTION 'Expected duplicate provider+bucket+object_key to fail, but it succeeded';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate object key scope rejected';
  END;

  BEGIN
    INSERT INTO files (
      uploader_user_id, owner_type, owner_id, purpose, storage_provider,
      object_key, status
    ) VALUES (
      1, 'user', 1, 'avatar', 'r2',
      'avatars/1/missing-uploaded-at.jpg', 'uploaded'
    );
    RAISE EXCEPTION 'Expected uploaded status without uploaded_at to fail, but it succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: uploaded status requires uploaded_at';
  END;

  BEGIN
    INSERT INTO files (
      uploader_user_id, owner_type, owner_id, purpose, storage_provider,
      object_key, file_size_bytes
    ) VALUES (
      1, 'user', 1, 'avatar', 'r2',
      'avatars/1/negative-size.jpg', -1
    );
    RAISE EXCEPTION 'Expected negative file size to fail, but it succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: negative file size rejected';
  END;
END $$;

-- 3) Query tests
-- Product filtering and sorting
SELECT id, name, price, city, status
FROM products
WHERE category_id = 4
  AND price BETWEEN 1000 AND 10000
  AND city = 'القاهرة'
  AND status = 'available'
ORDER BY price ASC;

-- Product listing with seller_rate sorting
SELECT id, name, seller_rate
FROM product_listing_view
ORDER BY seller_rate DESC, price ASC;

-- Chat pagination by sent_at
SELECT id, sender_id, message_text, sent_at
FROM messages
WHERE conversation_id = 1
ORDER BY sent_at DESC
LIMIT 20;

-- Admin reports query
SELECT id, reporter_id, reported_user_id, status, created_at
FROM user_reports
WHERE status IN ('open', 'reviewing')
ORDER BY created_at DESC;

-- 4) Arabic text tests
SELECT id, name, description, city, details
FROM products
WHERE name ILIKE '%هاتف%' OR description ILIKE '%جيدة%';

SELECT id, name
FROM users
WHERE name ILIKE '%أحمد%';

-- Optional full-text search check using simple dictionary.
SELECT id, name
FROM products
WHERE to_tsvector('simple', name || ' ' || description)
      @@ plainto_tsquery('simple', 'هاتف');

-- 5) File model checks
SELECT u.id AS user_id, u.avatar_file_id, f.object_key
FROM users u
LEFT JOIN files f ON f.id = u.avatar_file_id
WHERE u.id = 1;

SELECT pi.id, pi.product_id, pi.file_id, f.object_key, f.status
FROM product_images pi
JOIN files f ON f.id = pi.file_id
ORDER BY pi.product_id, pi.sort_order;

SELECT id, owner_type, owner_id, purpose, status
FROM files
WHERE owner_type = 'product' AND owner_id = 1
ORDER BY id;

SELECT id, status, created_at
FROM files
WHERE status IN ('pending', 'uploaded', 'failed', 'deleted')
ORDER BY created_at DESC;

ROLLBACK;
