CREATE INDEX IF NOT EXISTS idx_blocked_users_active_user ON public.blocked_users (user_id, blocked_at) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tu_reengage_idle ON public.telegram_users (last_active DESC) WHERE state = 'idle';
SELECT cron.alter_job(9, schedule := '0 2-14/2 * * *');