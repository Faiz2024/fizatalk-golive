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
  v_new_today BIGINT;
  v_active_today BIGINT;
  v_inactive30 BIGINT;
  v_churn BIGINT;
  v_activity JSON;
BEGIN
  SELECT COUNT(*) INTO v_new_today FROM telegram_users WHERE created_at >= v_today_start;
  SELECT COUNT(*) INTO v_active_today FROM telegram_users WHERE last_active >= v_today_start;
  SELECT COUNT(*) INTO v_inactive30 FROM telegram_users WHERE last_active < v_day30_start;
  SELECT COUNT(*) INTO v_churn FROM telegram_users
    WHERE last_active >= v_day31_start AND last_active < v_day30_start;

  WITH days AS (SELECT generate_series(0, 6) AS offset_back),
  day_buckets AS (
    SELECT
      (v_today_wib - offset_back) AS day_wib,
      (v_today_wib - offset_back - 30) AS day_30_ago_wib
    FROM days
  ),
  stats AS (
    SELECT
      db.day_wib,
      db.day_30_ago_wib,
      (SELECT COUNT(*) FROM telegram_users
        WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::DATE = db.day_wib) AS baru,
      (SELECT COUNT(*) FROM telegram_users
        WHERE (last_active AT TIME ZONE 'Asia/Jakarta')::DATE = db.day_wib) AS aktif,
      (SELECT COUNT(*) FROM telegram_users
        WHERE (last_active AT TIME ZONE 'Asia/Jakarta')::DATE = db.day_30_ago_wib) AS churn,
      (SELECT COUNT(*) FROM telegram_users
        WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::DATE = db.day_30_ago_wib) AS baru30harilalu
    FROM day_buckets db
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
  FROM stats;

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