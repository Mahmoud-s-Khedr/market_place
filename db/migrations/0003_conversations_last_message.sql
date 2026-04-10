-- Migration: denormalize last_message_id on conversations to avoid LATERAL join
ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS last_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL;

-- Backfill last_message_id for existing conversations
UPDATE conversations c
SET last_message_id = (
    SELECT id FROM messages m
    WHERE m.conversation_id = c.id
    ORDER BY sent_at DESC
    LIMIT 1
);
