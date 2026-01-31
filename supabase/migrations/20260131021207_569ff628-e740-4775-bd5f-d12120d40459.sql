-- Add penalty_points column to telegram_users
ALTER TABLE public.telegram_users 
ADD COLUMN IF NOT EXISTS penalty_points INTEGER DEFAULT 0;

-- Create partner_reports table for tracking reports
CREATE TABLE IF NOT EXISTS public.partner_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id BIGINT NOT NULL,
  reported_id BIGINT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('spam', 'sange', 'asik')),
  penalty_change INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'Asia/Jakarta')
);

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_partner_reports_reporter ON public.partner_reports(reporter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_partner_reports_reported ON public.partner_reports(reported_id, created_at);

-- Enable RLS
ALTER TABLE public.partner_reports ENABLE ROW LEVEL SECURITY;

-- RPC: Submit partner report with rate limiting (max 3 reports per hour)
CREATE OR REPLACE FUNCTION public.submit_partner_report(
  p_reporter_id BIGINT,
  p_reported_id BIGINT,
  p_report_type TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_report_count INTEGER;
  v_penalty_change INTEGER;
  v_new_penalty INTEGER;
  v_already_reported BOOLEAN;
BEGIN
  -- Check if already reported this partner in last hour
  SELECT EXISTS(
    SELECT 1 FROM partner_reports
    WHERE reporter_id = p_reporter_id
      AND reported_id = p_reported_id
      AND created_at > NOW() - INTERVAL '1 hour'
  ) INTO v_already_reported;
  
  IF v_already_reported THEN
    RETURN json_build_object('success', false, 'error', 'already_reported');
  END IF;
  
  -- Check rate limit: max 3 reports per hour
  SELECT COUNT(*) INTO v_report_count
  FROM partner_reports
  WHERE reporter_id = p_reporter_id
    AND created_at > NOW() - INTERVAL '1 hour';
  
  IF v_report_count >= 3 THEN
    RETURN json_build_object('success', false, 'error', 'rate_limit_exceeded');
  END IF;
  
  -- Determine penalty change based on report type
  CASE p_report_type
    WHEN 'spam' THEN v_penalty_change := 10;
    WHEN 'sange' THEN v_penalty_change := 15;
    WHEN 'asik' THEN v_penalty_change := -3;
    ELSE RETURN json_build_object('success', false, 'error', 'invalid_report_type');
  END CASE;
  
  -- Insert report
  INSERT INTO partner_reports (reporter_id, reported_id, report_type, penalty_change)
  VALUES (p_reporter_id, p_reported_id, p_report_type, v_penalty_change);
  
  -- Update reported user's penalty points (minimum 0)
  UPDATE telegram_users
  SET penalty_points = GREATEST(0, COALESCE(penalty_points, 0) + v_penalty_change)
  WHERE id = p_reported_id
  RETURNING penalty_points INTO v_new_penalty;
  
  -- Check if user should be banned (>=100 penalty points)
  IF v_new_penalty >= 100 THEN
    -- Insert into blocked_users
    INSERT INTO blocked_users (user_id, reason, blocked_message, is_active)
    VALUES (p_reported_id, 'auto_penalty_100', 'Akun diblokir karena terlalu banyak laporan negatif dari pengguna lain.', true)
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN json_build_object(
    'success', true, 
    'penalty_change', v_penalty_change,
    'new_penalty', v_new_penalty,
    'is_banned', v_new_penalty >= 100
  );
END;
$$;

-- RPC: Get user reputation status for search warning
CREATE OR REPLACE FUNCTION public.get_user_reputation(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_penalty INTEGER;
  v_status TEXT;
  v_message TEXT;
BEGIN
  SELECT COALESCE(penalty_points, 0) INTO v_penalty
  FROM telegram_users
  WHERE id = p_user_id;
  
  IF v_penalty IS NULL THEN
    RETURN json_build_object('penalty_points', 0, 'status', 'good', 'message', NULL);
  END IF;
  
  IF v_penalty >= 100 THEN
    v_status := 'banned';
    v_message := 'Akun Anda telah diblokir karena terlalu banyak laporan negatif.';
  ELSIF v_penalty >= 70 THEN
    v_status := 'critical';
    v_message := 'Akun Anda di ambang pemblokiran permanen. Satu laporan lagi dan Anda akan dibanned.';
  ELSIF v_penalty >= 40 THEN
    v_status := 'warning';
    v_message := 'Kami menerima beberapa laporan negatif tentang Anda. Harap perbaiki sikap atau akun berisiko dibatasi.';
  ELSE
    v_status := 'good';
    v_message := NULL;
  END IF;
  
  RETURN json_build_object(
    'penalty_points', v_penalty,
    'status', v_status,
    'message', v_message
  );
END;
$$;

-- RPC: Daily penalty decay (-5 for users without reports in 24h)
-- This should be called by pg_cron daily
CREATE OR REPLACE FUNCTION public.apply_daily_penalty_decay()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- Reduce penalty by 5 for users who:
  -- 1. Have penalty_points > 0
  -- 2. Have no reports received in last 24 hours
  UPDATE telegram_users tu
  SET penalty_points = GREATEST(0, penalty_points - 5)
  WHERE penalty_points > 0
    AND NOT EXISTS (
      SELECT 1 FROM partner_reports pr
      WHERE pr.reported_id = tu.id
        AND pr.created_at > NOW() - INTERVAL '24 hours'
    );
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;