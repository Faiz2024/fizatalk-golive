CREATE OR REPLACE FUNCTION public.get_chat_envelope(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_partner RECORD;
BEGIN
  SELECT state, partner_id INTO v_user FROM telegram_users WHERE id = p_user_id;
  IF NOT FOUND OR v_user.state <> 'chatting' OR v_user.partner_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_chatting');
  END IF;

  SELECT state, partner_id, is_tiktok_mode INTO v_partner FROM telegram_users WHERE id = v_user.partner_id;
  IF NOT FOUND OR v_partner.state <> 'chatting' OR v_partner.partner_id IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('ok', false, 'reason', 'partner_disconnected', 'partner_id', v_user.partner_id);
  END IF;

  RETURN json_build_object(
    'ok', true,
    'partner_id', v_user.partner_id,
    'partner_tiktok_mode', COALESCE(v_partner.is_tiktok_mode, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_envelope(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_envelope(BIGINT) TO service_role;