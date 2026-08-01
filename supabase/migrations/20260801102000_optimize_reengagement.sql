-- 1. Index to speed up the view (fetching eligible users)
CREATE INDEX IF NOT EXISTS idx_reengage_eligible ON telegram_users(state, last_active, last_reengagement_sent_at) WHERE state = 'idle';

-- 2. Update the cron schedule to every 5 minutes
DO $$
BEGIN
  PERFORM cron.unschedule('reengage-inactive-users');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'reengage-inactive-users',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://chwopnsmykwzqflqozvf.functions.supabase.co/reengage-users',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "fizatalk_reengage_cron_secret_2026_xyz"}'::jsonb
  )
  $$
);

-- 3. RPC to calculate daily eligible users without running it synchronously in edge function
CREATE OR REPLACE FUNCTION update_daily_eligible_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_eligible_count integer;
  v_today date;
  v_seven_days_ago timestamp with time zone;
BEGIN
  -- We use current_date at WIB timezone or just local db date.
  -- The edge function uses local date. Let's use timezone 'Asia/Jakarta' if possible.
  v_today := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_seven_days_ago := now() - interval '7 days';

  SELECT count(*)
  INTO v_eligible_count
  FROM public.v_eligible_reengagement_users
  WHERE state = 'idle'
    AND last_active < v_seven_days_ago
    AND (last_reengagement_sent_at IS NULL OR last_reengagement_sent_at < v_seven_days_ago);

  -- Upsert into reengagement_daily_stats
  INSERT INTO reengagement_daily_stats (date, eligible_count, updated_at)
  VALUES (v_today, v_eligible_count, now())
  ON CONFLICT (date) DO UPDATE
  SET eligible_count = EXCLUDED.eligible_count,
      updated_at = now();
END;
$$;

-- Schedule the RPC daily at 1:00 AM UTC (8:00 AM WIB) or similar.
-- Or just run it every 6 hours to have relatively fresh data without timeout risk
DO $$
BEGIN
  PERFORM cron.unschedule('daily-eligible-count');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'daily-eligible-count',
  '0 */6 * * *',
  $$
  SELECT update_daily_eligible_count();
  $$
);
