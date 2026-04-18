-- 1. Tabel snapshot harian
CREATE TABLE IF NOT EXISTS public.daily_user_stats (
  date DATE PRIMARY KEY,
  baru BIGINT NOT NULL DEFAULT 0,
  aktif BIGINT NOT NULL DEFAULT 0,
  churn BIGINT NOT NULL DEFAULT 0,
  baru30harilalu BIGINT NOT NULL DEFAULT 0,
  inactive30 BIGINT NOT NULL DEFAULT 0,
  snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.daily_user_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to daily_user_stats" ON public.daily_user_stats;
CREATE POLICY "Service role has full access to daily_user_stats"
  ON public.daily_user_stats
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Function snapshot - idempotent
CREATE OR REPLACE FUNCTION public.snapshot_daily_stats(p_target_date DATE DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_date DATE;
  v_target_30_ago DATE;
  v_day_end TIMESTAMPTZ;
  v_baru BIGINT;
  v_aktif BIGINT;
  v_churn BIGINT;
  v_baru30 BIGINT;
  v_inactive30 BIGINT;
  v_row_count INTEGER := 0;
BEGIN
  v_target_date := COALESCE(p_target_date, ((NOW() AT TIME ZONE 'Asia/Jakarta')::DATE - 1));
  v_target_30_ago := v_target_date - 30;
  v_day_end := ((v_target_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');

  SELECT COUNT(*) INTO v_baru FROM telegram_users
    WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::DATE = v_target_date;

  SELECT COUNT(*) INTO v_aktif FROM telegram_users
    WHERE (last_active AT TIME ZONE 'Asia/Jakarta')::DATE = v_target_date;

  SELECT COUNT(*) INTO v_churn FROM telegram_users
    WHERE (last_active AT TIME ZONE 'Asia/Jakarta')::DATE = v_target_30_ago;

  SELECT COUNT(*) INTO v_baru30 FROM telegram_users
    WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::DATE = v_target_30_ago;

  SELECT COUNT(*) INTO v_inactive30 FROM telegram_users
    WHERE last_active < v_day_end - INTERVAL '30 days';

  INSERT INTO daily_user_stats (date, baru, aktif, churn, baru30harilalu, inactive30, snapshotted_at)
  VALUES (v_target_date, v_baru, v_aktif, v_churn, v_baru30, v_inactive30, NOW())
  ON CONFLICT (date) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  RETURN json_build_object(
    'success', TRUE,
    'date', v_target_date,
    'inserted', (v_row_count > 0),
    'baru', v_baru,
    'aktif', v_aktif,
    'churn', v_churn,
    'baru30harilalu', v_baru30,
    'inactive30', v_inactive30
  );
END;
$$;

-- 3. Backfill 7 hari terakhir
DO $$
DECLARE
  v_today_wib DATE := (NOW() AT TIME ZONE 'Asia/Jakarta')::DATE;
  v_offset INT;
BEGIN
  FOR v_offset IN 1..6 LOOP
    PERFORM public.snapshot_daily_stats(v_today_wib - v_offset);
  END LOOP;
END $$;

-- 4. Cron job: setiap hari 00:05 WIB (17:05 UTC)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('snapshot_daily_user_stats');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'snapshot_daily_user_stats',
  '5 17 * * *',
  $$SELECT public.snapshot_daily_stats();$$
);

-- 5. Update RPC dashboard
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
BEGIN
  SELECT COUNT(*) INTO v_new_today FROM telegram_users WHERE created_at >= v_today_start;
  SELECT COUNT(*) INTO v_active_today FROM telegram_users WHERE last_active >= v_today_start;
  SELECT COUNT(*) INTO v_inactive30 FROM telegram_users WHERE last_active < v_day30_start;
  SELECT COUNT(*) INTO v_churn FROM telegram_users
    WHERE last_active >= v_day31_start AND last_active < v_day30_start;
  SELECT COUNT(*) INTO v_today_baru30 FROM telegram_users
    WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::DATE = v_today_30_ago;

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

  RETURN json_build_object(
    'kpis', json_build_object(
      'newToday', v_new_today,
      'activeToday', v_active_today,
      'inactive30', v_inactive30,
      'churn', v_churn
    ),
    'activity', v_activity
  );
END;
$$;