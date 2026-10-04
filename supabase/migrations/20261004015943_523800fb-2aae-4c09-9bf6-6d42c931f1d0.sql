CREATE OR REPLACE FUNCTION public.update_daily_eligible_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM telegram_users tu
  WHERE tu.state = 'idle'
    AND tu.last_active < now() - interval '7 days'
    AND (tu.last_reengagement_sent_at IS NULL OR tu.last_reengagement_sent_at < '2099-01-01')
    AND (
      tu.last_reengagement_sent_at IS NULL
      OR (
        CASE
          WHEN tu.last_active > now() - interval '30 days' THEN tu.last_reengagement_sent_at < now() - interval '7 days'
          ELSE tu.last_reengagement_sent_at < now() - interval '14 days'
        END
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM blocked_users bu
      WHERE bu.user_id = tu.id AND bu.is_active = true
    );

  INSERT INTO reengagement_daily_stats (date, eligible_count, updated_at)
  VALUES (v_today, v_count, now())
  ON CONFLICT (date)
  DO UPDATE SET eligible_count = EXCLUDED.eligible_count, updated_at = now();
END;
$$;