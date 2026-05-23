-- Migration: Create reengagement_daily_stats table and update dashboard RPC
-- Tracks daily eligible vs sent metrics for re-engagement notifications

-- 1. Create table for daily re-engagement stats
CREATE TABLE IF NOT EXISTS public.reengagement_daily_stats (
  date DATE PRIMARY KEY,
  eligible_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.reengagement_daily_stats ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policy (service_role only)
DROP POLICY IF EXISTS "Service role full access reengagement_daily_stats" ON public.reengagement_daily_stats;
CREATE POLICY "Service role full access reengagement_daily_stats"
  ON public.reengagement_daily_stats FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Update RPC get_admin_dashboard_stats to include reengage_daily_stats
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today_wib DATE := (NOW() AT TIME ZONE 'Asia/Jakarta')::DATE;
  v_today_start TIMESTAMPTZ := (v_today_wib::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');
  v_day30_start TIMESTAMPTZ := ((v_today_wib - 30)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');
  v_day31_start TIMESTAMPTZ := ((v_today_wib - 31)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');
  v_today_30_ago DATE := v_today_wib - 30;
  
  v_new_today BIGINT;
  v_active_today BIGINT;
  v_inactive30 BIGINT;
  v_churn BIGINT;
  v_today_baru30 BIGINT;
  v_activity JSON;
  
  v_reengage_returns BIGINT;
  v_reengage_activity JSON;
  v_reengage_daily_stats JSON;
BEGIN
  -- A. KPIs
  SELECT COUNT(*) INTO v_new_today FROM telegram_users WHERE created_at >= v_today_start;
  SELECT COUNT(*) INTO v_active_today FROM telegram_users WHERE last_active >= v_today_start;
  SELECT COUNT(*) INTO v_inactive30 FROM telegram_users WHERE last_active < v_day30_start;
  SELECT COUNT(*) INTO v_churn FROM telegram_users
    WHERE last_active >= v_day31_start AND last_active < v_day30_start;
  SELECT COUNT(*) INTO v_today_baru30 FROM telegram_users
    WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::DATE = v_today_30_ago;

  -- B. Re-engagement returns (clicks last 30 days)
  SELECT COUNT(*) INTO v_reengage_returns 
    FROM reengagement_clicks 
    WHERE clicked_at >= NOW() - INTERVAL '30 days';

  -- C. Activity chart (30 days)
  WITH all_days AS (
    SELECT
      d.date AS day_wib,
      COALESCE(s.baru, 0) AS baru,
      COALESCE(s.aktif, 0) AS aktif,
      COALESCE(s.churn, 0) AS churn,
      COALESCE(s.baru30harilalu, 0) AS baru30harilalu
    FROM (
      SELECT (v_today_wib - generate_series(1, 29)) AS date
    ) d
    LEFT JOIN daily_user_stats s ON s.date = d.date

    UNION ALL

    SELECT
      v_today_wib AS day_wib,
      v_new_today AS baru,
      v_active_today AS aktif,
      v_churn AS churn,
      v_today_baru30 AS baru30harilalu
  )
  SELECT json_agg(
    json_build_object(
      'date', to_char(day_wib, 'YYYY-MM-DD'),
      'baru', baru,
      'aktif', aktif,
      'churn', churn,
      'baru30hariLalu', baru30harilalu
    ) ORDER BY day_wib ASC
  )
  INTO v_activity
  FROM all_days;

  -- D. Re-engagement conversion chart (30 days stacked bar)
  WITH date_series AS (
    SELECT (v_today_wib - i)::DATE AS day_wib
    FROM generate_series(0, 29) i
  ),
  daily_clicks AS (
    SELECT
      d.day_wib,
      COALESCE(SUM(CASE WHEN c.template_key = 'cute_pleading_cat' THEN 1 ELSE 0 END), 0) AS cute_pleading_cat,
      COALESCE(SUM(CASE WHEN c.template_key = 'mysterious_gift_box' THEN 1 ELSE 0 END), 0) AS mysterious_gift_box,
      COALESCE(SUM(CASE WHEN c.template_key = 'grumpy_cute_cat' THEN 1 ELSE 0 END), 0) AS grumpy_cute_cat,
      COALESCE(SUM(CASE WHEN c.template_key = 'social_match_hearts' THEN 1 ELSE 0 END), 0) AS social_match_hearts,
      COUNT(c.id) AS total
    FROM date_series d
    LEFT JOIN reengagement_clicks c 
      ON (c.clicked_at AT TIME ZONE 'Asia/Jakarta')::DATE = d.day_wib
    GROUP BY d.day_wib
  )
  SELECT json_agg(
    json_build_object(
      'date', to_char(day_wib, 'YYYY-MM-DD'),
      'label', to_char(day_wib, 'DD MMM'),
      'cute_pleading_cat', cute_pleading_cat,
      'mysterious_gift_box', mysterious_gift_box,
      'grumpy_cute_cat', grumpy_cute_cat,
      'social_match_hearts', social_match_hearts,
      'total', total
    ) ORDER BY day_wib ASC
  )
  INTO v_reengage_activity
  FROM daily_clicks;

  -- E. NEW: Re-engagement daily stats (eligible vs sent - 30 days)
  WITH date_series AS (
    SELECT (v_today_wib - i)::DATE AS day_wib
    FROM generate_series(0, 29) i
  )
  SELECT json_agg(
    json_build_object(
      'date', to_char(ds.day_wib, 'YYYY-MM-DD'),
      'eligible', COALESCE(rds.eligible_count, 0),
      'sent', COALESCE(rds.sent_count, 0)
    ) ORDER BY ds.day_wib ASC
  )
  INTO v_reengage_daily_stats
  FROM date_series ds
  LEFT JOIN reengagement_daily_stats rds ON rds.date = ds.day_wib;

  -- F. Return
  RETURN json_build_object(
    'kpis', json_build_object(
      'newToday', v_new_today,
      'activeToday', v_active_today,
      'inactive30', v_inactive30,
      'churn', v_churn,
      'reengageReturns', v_reengage_returns
    ),
    'activity', v_activity,
    'reengage_activity', COALESCE(v_reengage_activity, '[]'::json),
    'reengage_daily_stats', COALESCE(v_reengage_daily_stats, '[]'::json)
  );
END;
$$;
