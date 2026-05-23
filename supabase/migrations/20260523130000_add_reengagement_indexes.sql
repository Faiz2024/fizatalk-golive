-- Migration: Add performance indexes for re-engagement queries
-- Optimizes the reengage-users cron job and admin dashboard stats

-- 1. Partial composite index for re-engagement user selection query
-- Covers: WHERE state = 'idle' AND last_active < ? AND (last_reengagement_sent_at IS NULL OR last_reengagement_sent_at < ?)
-- ORDER BY last_active DESC LIMIT 300
-- Only indexes idle users, keeping the index small and fast
CREATE INDEX IF NOT EXISTS idx_telegram_users_reengage_partial
ON public.telegram_users (last_active DESC, last_reengagement_sent_at)
WHERE state = 'idle';

-- 2. Index for reengagement_clicks.clicked_at used by dashboard aggregation
-- Covers: WHERE clicked_at >= NOW() - INTERVAL '30 days' and daily GROUP BY
CREATE INDEX IF NOT EXISTS idx_reengagement_clicks_clicked_at
ON public.reengagement_clicks (clicked_at);
