ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS last_incoming_msg_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_chat_response(p_sender_id bigint, p_partner_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_gap numeric;
BEGIN
  -- Pengirim membalas: hitung jeda bila ada pesan partner (sesi ini) yang belum dibalas
  UPDATE telegram_users u SET
    total_response_time_seconds = u.total_response_time_seconds + CASE WHEN g.gap BETWEEN 1 AND 600 THEN g.gap::bigint ELSE 0 END,
    total_response_count = u.total_response_count + CASE WHEN g.gap BETWEEN 1 AND 600 THEN 1 ELSE 0 END,
    last_incoming_msg_at = NULL
  FROM (SELECT id, CASE WHEN matched_at IS NULL OR last_incoming_msg_at >= matched_at
                        THEN EXTRACT(EPOCH FROM (now() - last_incoming_msg_at)) ELSE -1 END AS gap
        FROM telegram_users WHERE id = p_sender_id AND last_incoming_msg_at IS NOT NULL) g
  WHERE u.id = g.id;

  -- Penerima: tandai pesan pertama yang belum dibalas (tidak ditimpa pesan beruntun)
  UPDATE telegram_users SET last_incoming_msg_at = now()
  WHERE id = p_partner_id
    AND (last_incoming_msg_at IS NULL OR (matched_at IS NOT NULL AND last_incoming_msg_at < matched_at));
END $$;

REVOKE ALL ON FUNCTION public.record_chat_response(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_chat_response(bigint, bigint) TO service_role;