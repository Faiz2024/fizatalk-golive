-- Setup Re-engagement Clicks Table and Database Analytics RPC

-- 1. Buat Tabel Re-engagement Clicks
CREATE TABLE IF NOT EXISTS public.reengagement_clicks (
  id SERIAL PRIMARY KEY,
  user_id bigint REFERENCES public.telegram_users(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

-- Aktifkan RLS
ALTER TABLE public.reengagement_clicks ENABLE ROW LEVEL SECURITY;

-- Kebijakan RLS (hanya service_role yang memiliki akses penuh)
DROP POLICY IF EXISTS "Service role has full access to reengagement_clicks" ON public.reengagement_clicks;
CREATE POLICY "Service role has full access to reengagement_clicks"
  ON public.reengagement_clicks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Buat Ulang RPC get_admin_dashboard_stats untuk Menyertakan Analitik Re-engagement
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
  
  -- Variabel KPI Bawaan
  v_new_today BIGINT;
  v_active_today BIGINT;
  v_inactive30 BIGINT;
  v_churn BIGINT;
  v_today_baru30 BIGINT;
  v_activity JSON;
  
  -- Variabel Re-engagement Baru
  v_reengage_returns BIGINT;
  v_reengage_activity JSON;
BEGIN
  -- A. Ambil KPI Bawaan
  SELECT COUNT(*) INTO v_new_today FROM telegram_users WHERE created_at >= v_today_start;
  SELECT COUNT(*) INTO v_active_today FROM telegram_users WHERE last_active >= v_today_start;
  SELECT COUNT(*) INTO v_inactive30 FROM telegram_users WHERE last_active < v_day30_start;
  SELECT COUNT(*) INTO v_churn FROM telegram_users
    WHERE last_active >= v_day31_start AND last_active < v_day30_start;
  SELECT COUNT(*) INTO v_today_baru30 FROM telegram_users
    WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::DATE = v_today_30_ago;

  -- B. Ambil KPI Re-engagement Baru (Klik dalam 30 hari terakhir)
  SELECT COUNT(*) INTO v_reengage_returns 
    FROM reengagement_clicks 
    WHERE clicked_at >= NOW() - INTERVAL '30 days';

  -- C. Agregasi Aktivitas Bawaan (30 Hari Terakhir)
  WITH all_days AS (
    SELECT
      d.date AS day_wib,
      COALESCE(s.baru, 0) AS baru,
      COALESCE(s.aktif, 0) AS aktif,
      COALESCE(s.churn, 0) AS churn,
      COALESCE(s.baru30harilalu, 0) AS baru30harilalu
    FROM (
      SELECT (v_today_wib - generate_series(1, 6)) AS date
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

  -- D. FIX: Agregasi Aktivitas Re-engagement Baru (30 Hari Terakhir untuk Stacked BarChart)
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

  -- E. Gabungkan & Kembalikan Respons JSON Lengkap
  RETURN json_build_object(
    'kpis', json_build_object(
      'newToday', v_new_today,
      'activeToday', v_active_today,
      'inactive30', v_inactive30,
      'churn', v_churn,
      'reengageReturns', v_reengage_returns
    ),
    'activity', v_activity,
    'reengage_activity', COALESCE(v_reengage_activity, '[]'::json)
  );
END;
$$;
