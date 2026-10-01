CREATE INDEX IF NOT EXISTS idx_tu_reengage_claim ON public.telegram_users (last_active DESC) WHERE state='idle';

CREATE OR REPLACE FUNCTION public.claim_reengagement_batch(p_limit int)
RETURNS TABLE(id bigint, first_name text, last_reengagement_message_id bigint, prev_sent_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY
  WITH c AS (
    SELECT u.id, u.last_reengagement_sent_at AS prev
    FROM telegram_users u
    WHERE u.state='idle' AND u.last_active < now()-interval '7 days'
      AND (u.last_reengagement_sent_at IS NULL OR u.last_reengagement_sent_at < now()-interval '7 days')
      AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id AND b.is_active)
    ORDER BY u.last_active DESC
    LIMIT LEAST(GREATEST(p_limit,1),3000)
    FOR UPDATE OF u SKIP LOCKED
  )
  UPDATE telegram_users t SET last_reengagement_sent_at = now()
  FROM c WHERE t.id=c.id
  RETURNING t.id, t.first_name, t.last_reengagement_message_id, c.prev;
END $$;

CREATE OR REPLACE FUNCTION public.finish_reengagement_batch(p_results jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sent int; v_blocked int; v_err int; v_date date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  -- p_results: [{id, status: sent|blocked|error, message_id, prev}]
  UPDATE telegram_users t SET
    last_reengagement_message_id = CASE r.status WHEN 'sent' THEN r.message_id ELSE NULL END,
    last_reengagement_sent_at = CASE r.status
      WHEN 'blocked' THEN '2099-12-31T00:00:00+00'::timestamptz
      WHEN 'error' THEN r.prev
      ELSE t.last_reengagement_sent_at END
  FROM jsonb_to_recordset(p_results) AS r(id bigint, status text, message_id bigint, prev timestamptz)
  WHERE t.id=r.id;

  SELECT count(*) FILTER (WHERE x->>'status'='sent'), count(*) FILTER (WHERE x->>'status'='blocked'), count(*) FILTER (WHERE x->>'status'='error')
  INTO v_sent, v_blocked, v_err FROM jsonb_array_elements(p_results) x;

  INSERT INTO reengagement_daily_stats(date, sent_count, blocked_count, error_count, updated_at)
  VALUES (v_date, v_sent, v_blocked, v_err, now())
  ON CONFLICT (date) DO UPDATE SET
    sent_count = reengagement_daily_stats.sent_count + EXCLUDED.sent_count,
    blocked_count = reengagement_daily_stats.blocked_count + EXCLUDED.blocked_count,
    error_count = reengagement_daily_stats.error_count + EXCLUDED.error_count,
    updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.claim_reengagement_batch(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_reengagement_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reengagement_batch(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_reengagement_batch(jsonb) TO service_role;