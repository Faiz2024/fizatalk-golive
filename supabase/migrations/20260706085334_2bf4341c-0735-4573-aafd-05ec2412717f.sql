CREATE OR REPLACE FUNCTION public.end_chat_comprehensive(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_partner_id BIGINT;
  v_partner_reset BOOLEAN := FALSE;
  v_user_promo JSON;
  v_partner_promo JSON;
  v_should_send_channel_invite BOOLEAN := FALSE;
  v_partner_should_send_channel_invite BOOLEAN := FALSE;
  v_reconnect_notification JSON := NULL;
BEGIN
  -- 1. Ambil data user dengan lock
  SELECT state, partner_id INTO v_user
  FROM telegram_users
  WHERE id = p_user_id
  FOR UPDATE;
  
  -- Validasi: user harus dalam state chatting dengan partner
  IF v_user IS NULL OR v_user.state != 'chatting' OR v_user.partner_id IS NULL THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'not_in_chat',
      'partner_id', NULL
    );
  END IF;
  
  v_partner_id := v_user.partner_id;
  
  -- 2. ATOMIC RESET: Reset user HANYA jika masih punya partner yang sama
  UPDATE telegram_users
  SET state = 'idle', partner_id = NULL
  WHERE id = p_user_id AND partner_id = v_partner_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'already_reset',
      'partner_id', v_partner_id
    );
  END IF;
  
  -- 3. Cek promo untuk user utama
  SELECT public.handle_end_chat_promo_logic(p_user_id) INTO v_user_promo;
  
  -- 4. Cek promo untuk partner
  SELECT public.handle_end_chat_promo_logic(v_partner_id) INTO v_partner_promo;
  
  -- 5. Reset partner HANYA jika masih connected ke kita
  UPDATE telegram_users
  SET state = 'idle', partner_id = NULL
  WHERE id = v_partner_id AND partner_id = p_user_id;
  
  IF FOUND THEN
    v_partner_reset := TRUE;
  END IF;
  
  -- 6. Hapus dari waiting queue
  DELETE FROM waiting_queue WHERE user_id IN (p_user_id, v_partner_id);

  -- 7. Cek channel invite eligibility untuk user (HANYA jika promo TIDAK dikirim)
  IF v_user_promo IS NULL OR (v_user_promo->>'should_send')::boolean IS NOT TRUE THEN
    SELECT public.check_channel_invite_eligibility(p_user_id) INTO v_should_send_channel_invite;
  END IF;

  -- 8. Cek channel invite eligibility untuk partner (HANYA jika promo TIDAK dikirim)
  IF v_partner_promo IS NULL OR (v_partner_promo->>'should_send')::boolean IS NOT TRUE THEN
    SELECT public.check_channel_invite_eligibility(v_partner_id) INTO v_partner_should_send_channel_invite;
  END IF;

  -- 9. Cek pending reconnect notification
  DECLARE
    v_pending_reconnect RECORD;
  BEGIN
    SELECT id, requester_id, requester_message_id
    INTO v_pending_reconnect
    FROM reconnect_requests
    WHERE target_id = p_user_id
      AND status = 'pending'
      AND created_at > NOW() - INTERVAL '10 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      UPDATE reconnect_requests SET status = 'notified' WHERE id = v_pending_reconnect.id;
      v_reconnect_notification := json_build_object(
        'request_id', v_pending_reconnect.id,
        'requester_id', v_pending_reconnect.requester_id,
        'requester_message_id', v_pending_reconnect.requester_message_id
      );
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL; -- Table doesn't exist yet, skip
  END;
  
  -- 10. Return hasil lengkap
  RETURN json_build_object(
    'success', TRUE,
    'partner_id', v_partner_id,
    'partner_reset', v_partner_reset,
    'user_promo', v_user_promo,
    'partner_promo', v_partner_promo,
    'should_send_channel_invite', v_should_send_channel_invite,
    'partner_should_send_channel_invite', v_partner_should_send_channel_invite,
    'reconnect_notification', v_reconnect_notification
  );
END;
$function$;