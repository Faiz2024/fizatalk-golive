CREATE INDEX IF NOT EXISTS idx_tu_reengage_claim_covering
  ON public.telegram_users (last_active DESC)
  INCLUDE (id, last_reengagement_sent_at)
  WHERE state = 'idle';