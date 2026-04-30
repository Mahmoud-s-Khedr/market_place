-- Migration: replace user_contacts with users.contact_info
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS contact_info TEXT;

UPDATE users u
SET contact_info = uc.value
FROM (
  SELECT DISTINCT ON (user_id)
         user_id,
         value
  FROM user_contacts
  ORDER BY user_id, is_primary DESC, id DESC
) uc
WHERE u.id = uc.user_id
  AND u.contact_info IS NULL;

DROP INDEX IF EXISTS user_contacts_unique_email;
DROP INDEX IF EXISTS user_contacts_user_type_idx;
DROP INDEX IF EXISTS user_contacts_primary_per_type_idx;
DROP TABLE IF EXISTS user_contacts;
