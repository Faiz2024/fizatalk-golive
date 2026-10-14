CREATE OR REPLACE FUNCTION public.record_chat_response(p_sender_id bigint, p_partner_id bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Rolling window 50 balasan terakhir: saat count=50, rata-rata lama dikurangi 1 porsi lalu ditambah jeda baru
  UPDATE telegram_users u SET
    total_response_time_seconds = CASE WHEN g.gap BETWEEN 1 AND 600 THEN
        CASE WHEN u.total_response_count >= 50
             THEN u.total_response_time_seconds - (u.total_response_time_seconds / u.total_response_count) + g.gap::bigint
             ELSE u.total_response_time_seconds + g.gap::bigint END
      ELSE u.total_response_time_seconds END,
    total_response_count = CASE WHEN g.gap BETWEEN 1 AND 600 THEN LEAST(u.total_response_count + 1, 50) ELSE u.total_response_count END,
    last_incoming_msg_at = NULL
  FROM (SELECT id, CASE WHEN matched_at IS NULL OR last_incoming_msg_at >= matched_at
                        THEN EXTRACT(EPOCH FROM (now() - last_incoming_msg_at)) ELSE -1 END AS gap
        FROM telegram_users WHERE id = p_sender_id AND last_incoming_msg_at IS NOT NULL) g
  WHERE u.id = g.id;

  UPDATE telegram_users SET last_incoming_msg_at = now()
  WHERE id = p_partner_id
    AND (last_incoming_msg_at IS NULL OR (matched_at IS NOT NULL AND last_incoming_msg_at < matched_at));
END $function$;

UPDATE public.telegram_users
SET total_response_time_seconds = (total_response_time_seconds * 50) / total_response_count,
    total_response_count = 50
WHERE total_response_count > 50;