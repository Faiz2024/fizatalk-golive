CREATE OR REPLACE FUNCTION public.claim_reengagement_batch(p_limit integer)
 RETURNS TABLE(id bigint, first_name text, last_reengagement_message_id bigint, prev_sent_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Inaktif 7–30 hari: jeda 7 hari. Inaktif >30 hari: jeda 14 hari.
  RETURN QUERY
  WITH c AS (
    SELECT u.id, u.last_reengagement_sent_at AS prev
    FROM telegram_users u
    WHERE u.state='idle' AND u.last_active < now()-interval '7 days'
      AND (u.last_reengagement_sent_at IS NULL
           OR u.last_reengagement_sent_at < now() - CASE WHEN u.last_active > now()-interval '30 days'
                                                        THEN interval '7 days' ELSE interval '14 days' END)
      AND NOT EXISTS (SELECT 1 FROM blocked_users b WHERE b.user_id=u.id AND b.is_active)
    ORDER BY u.last_active DESC
    LIMIT LEAST(GREATEST(p_limit,1),3000)
    FOR UPDATE OF u SKIP LOCKED
  )
  UPDATE telegram_users t SET last_reengagement_sent_at = now()
  FROM c WHERE t.id=c.id
  RETURNING t.id, t.first_name, t.last_reengagement_message_id, c.prev;
END $function$;