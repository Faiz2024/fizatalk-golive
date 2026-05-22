-- Migration: Restructure Re-engagement Columns
-- 1. Add new distinct columns for inactivity re-engagement tracking
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS last_reengagement_sent_at timestamptz;
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS last_reengagement_message_id bigint;

-- 2. Migrate existing data for continuity
UPDATE public.telegram_users 
SET 
  last_reengagement_sent_at = last_promo_sent_at,
  last_reengagement_message_id = last_promo_message_id
WHERE last_promo_sent_at IS NOT NULL OR last_promo_message_id IS NOT NULL;

-- 3. Drop redundant last_promo_message_id column (not used by premium promos)
ALTER TABLE public.telegram_users DROP COLUMN IF EXISTS last_promo_message_id;

-- 4. Set comments for database clarity
COMMENT ON COLUMN public.telegram_users.last_promo_sent_at IS 'Timestamp of the last end-chat premium promotion sent (active users)';
COMMENT ON COLUMN public.telegram_users.last_reengagement_sent_at IS 'Timestamp of the last 7-day inactivity re-engagement notification (inactive users)';
COMMENT ON COLUMN public.telegram_users.last_reengagement_message_id IS 'Message ID of the last sent re-engagement notification for message deletion/idempotency';
