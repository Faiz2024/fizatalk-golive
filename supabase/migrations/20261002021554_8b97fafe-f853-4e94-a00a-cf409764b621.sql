CREATE OR REPLACE FUNCTION public.finish_reengagement_batch(p_results jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sent int; v_blocked int; v_err int; v_date date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  -- status: sent | blocked | error (coba lagi) | permanent (lewati 30 hari)
  UPDATE telegram_users t SET
    last_reengagement_message_id = CASE r.status WHEN 'sent' THEN r.message_id ELSE NULL END,
    last_reengagement_sent_at = CASE r.status
      WHEN 'blocked' THEN '2099-12-31T00:00:00+00'::timestamptz
      WHEN 'error' THEN r.prev
      WHEN 'permanent' THEN now() + interval '23 days'
      ELSE t.last_reengagement_sent_at END
  FROM jsonb_to_recordset(p_results) AS r(id bigint, status text, message_id bigint, prev timestamptz)
  WHERE t.id=r.id;

  SELECT count(*) FILTER (WHERE x->>'status'='sent'), count(*) FILTER (WHERE x->>'status'='blocked'), count(*) FILTER (WHERE x->>'status' IN ('error','permanent'))
  INTO v_sent, v_blocked, v_err FROM jsonb_array_elements(p_results) x;

  INSERT INTO reengagement_daily_stats(date, sent_count, blocked_count, error_count, updated_at)
  VALUES (v_date, v_sent, v_blocked, v_err, now())
  ON CONFLICT (date) DO UPDATE SET
    sent_count = reengagement_daily_stats.sent_count + EXCLUDED.sent_count,
    blocked_count = reengagement_daily_stats.blocked_count + EXCLUDED.blocked_count,
    error_count = reengagement_daily_stats.error_count + EXCLUDED.error_count,
    updated_at = now();
END $function$;