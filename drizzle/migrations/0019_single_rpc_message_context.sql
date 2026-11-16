CREATE OR REPLACE FUNCTION public.get_chat_envelope(p_user_id BIGINT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user RECORD;
  v_partner RECORD;
  v_user_json JSON;
BEGIN
  SELECT state, partner_id, matched_at, premium_until, cashout_draft,
    target_gender, gender, coins, location, target_location, profile_flow,
    is_face_verified, verification_status, profile_photo_file_id,
    report_draft, moderation_state, profile_photo_enabled
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_chatting', 'user', NULL);
  END IF;

  v_user_json := to_json(v_user);

  IF v_user.state <> 'chatting' OR v_user.partner_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_chatting', 'user', v_user_json);
  END IF;

  SELECT state, partner_id, is_tiktok_mode
  INTO v_partner
  FROM telegram_users
  WHERE id = v_user.partner_id;

  IF NOT FOUND OR v_partner.state <> 'chatting' OR v_partner.partner_id IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object(
      'ok', false,
      'reason', 'partner_disconnected',
      'partner_id', v_user.partner_id,
      'user', v_user_json
    );
  END IF;

  RETURN json_build_object(
    'ok', true,
    'partner_id', v_user.partner_id,
    'partner_tiktok_mode', COALESCE(v_partner.is_tiktok_mode, false),
    'chat_seconds', COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - v_user.matched_at))::int, 0),
    'user', v_user_json
  );
END $$;

REVOKE ALL ON FUNCTION public.get_chat_envelope(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_envelope(BIGINT) TO service_role;