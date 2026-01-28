-- RPC untuk mendapatkan user yang eligible untuk promo
-- User chatting (apapun last_active) + User idle yang aktif dalam 5 jam terakhir
CREATE OR REPLACE FUNCTION public.get_promo_eligible_users()
RETURNS TABLE (
  user_id BIGINT,
  current_state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tu.id as user_id,
    tu.state::TEXT as current_state
  FROM telegram_users tu
  WHERE 
    -- User sedang chatting (apapun last_active nya)
    tu.state = 'chatting'
    OR 
    -- User idle yang aktif dalam 5 jam terakhir
    (tu.state = 'idle' AND tu.last_active > NOW() - INTERVAL '5 hours')
  ORDER BY tu.last_active DESC;
END;
$$;

-- RPC untuk mendapatkan promo yang waiting_idle untuk user tertentu
CREATE OR REPLACE FUNCTION public.get_waiting_idle_promos(p_user_id BIGINT)
RETURNS TABLE (
  id UUID,
  message_text TEXT,
  photo_url TEXT,
  promo_buttons JSONB,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pq.id,
    pq.message_text,
    pq.photo_url,
    pq.promo_buttons,
    pq.expires_at
  FROM promo_queue pq
  WHERE pq.user_id = p_user_id
    AND pq.status = 'waiting_idle'
    AND pq.expires_at > NOW()
  ORDER BY pq.created_at ASC;
END;
$$;

-- RPC untuk update status promo ke sent setelah dikirim
CREATE OR REPLACE FUNCTION public.mark_promo_sent(p_promo_id UUID, p_message_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE promo_queue
  SET status = 'sent', sent_message_id = p_message_id
  WHERE id = p_promo_id;
END;
$$;