-- Schedule daily penalty decay at midnight WIB (17:00 UTC)
SELECT cron.schedule(
  'daily-penalty-decay',
  '0 17 * * *',  -- 00:00 WIB = 17:00 UTC (previous day)
  $$SELECT public.apply_daily_penalty_decay()$$
);