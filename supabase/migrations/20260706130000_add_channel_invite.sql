-- =====================================================
-- Migration: Add Channel Invite Feature
-- Adds column, eligibility check function, and modifies
-- end_chat_comprehensive to include channel invite logic
-- =====================================================

-- 1. Add column for tracking last channel invite sent
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS last_channel_invite_sent_at TIMESTAMPTZ;

-- 2. Create eligibility check function
CREATE OR REPLACE FUNCTION public.check_channel_invite_eligibility(p_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_is_blocked_active BOOLEAN;
  v_last_reengagement_click TIMESTAMPTZ;
  v_last_unblocked_at TIMESTAMPTZ;
BEGIN
  -- Ambil data user
  SELECT
    is_channel_member,
    premium_until,
    created_at,
    last_channel_invite_sent_at
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id;

  -- User tidak ditemukan
  IF v_user IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Sudah bergabung channel -> skip
  IF v_user.is_channel_member = TRUE THEN
    RETURN FALSE;
  END IF;

  -- 2. User premium aktif -> skip
  IF v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW() THEN
    RETURN FALSE;
  END IF;

  -- 3. Premium baru expired kurang dari 1 hari -> skip
  IF v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW() - INTERVAL '1 day' THEN
    RETURN FALSE;
  END IF;

  -- 4. Umur akun kurang dari 1 hari -> skip
  IF v_user.created_at > NOW() - INTERVAL '1 day' THEN
    RETURN FALSE;
  END IF;

  -- 5. Cooldown pengiriman (1 hari sekali)
  IF v_user.last_channel_invite_sent_at IS NOT NULL AND v_user.last_channel_invite_sent_at > NOW() - INTERVAL '1 day' THEN
    RETURN FALSE;
  END IF;

  -- 6. Cek apakah user sedang diblokir aktif
  SELECT EXISTS(
    SELECT 1 FROM blocked_users WHERE user_id = p_user_id AND is_active = TRUE
  ) INTO v_is_blocked_active;

  IF v_is_blocked_active THEN
    RETURN FALSE;
  END IF;

  -- 7. Jeda pemulihan blokir (unblock) > 1 hari
  SELECT MAX(unblocked_at) INTO v_last_unblocked_at
  FROM blocked_users
  WHERE user_id = p_user_id AND unblocked_at IS NOT NULL;

  IF v_last_unblocked_at IS NOT NULL AND v_last_unblocked_at > NOW() - INTERVAL '1 day' THEN
    RETURN FALSE;
  END IF;

  -- 8. Jeda klik reengagement > 1 hari
  SELECT MAX(clicked_at) INTO v_last_reengagement_click
  FROM reengagement_clicks
  WHERE user_id = p_user_id;

  IF v_last_reengagement_click IS NOT NULL AND v_last_reengagement_click > NOW() - INTERVAL '1 day' THEN
    RETURN FALSE;
  END IF;

  -- Semua syarat terpenuhi -> update timestamp dan return true
  UPDATE telegram_users
  SET last_channel_invite_sent_at = NOW()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$function$;

-- 3. Modify end_chat_comprehensive to include channel invite check
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
    SELECT id, requester_id, message_id
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
        'requester_message_id', v_pending_reconnect.message_id
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

-- 4. Modify comprehensive_search_action to include channel invite check
CREATE OR REPLACE FUNCTION public.comprehensive_search_action(
    p_user_id bigint, 
    p_username text DEFAULT NULL::text, 
    p_first_name text DEFAULT NULL::text, 
    p_is_next boolean DEFAULT false,
    p_target_partner_id bigint DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_partner_id BIGINT := NULL;
  v_old_partner_id BIGINT := NULL;
  v_is_premium BOOLEAN;
  v_my_gender TEXT;
  v_my_target_gender TEXT;
  v_my_target_location TEXT;
  v_my_location TEXT;
  v_candidate RECORD;
  v_candidate_is_premium BOOLEAN;
  v_candidate_target_gender TEXT;
  v_candidate_target_location TEXT;
  v_i_satisfied_gender BOOLEAN;
  v_candidate_satisfied_gender BOOLEAN;
  v_i_satisfied_location BOOLEAN;
  v_candidate_satisfied_location BOOLEAN;
  v_penalty_points INTEGER;
  v_reputation_status TEXT;
  v_reputation_message TEXT;
  v_old_partner_promo JSON;
  v_chat_ended BOOLEAN := FALSE;
  v_should_check_channel BOOLEAN := FALSE;
  v_should_send_channel_invite BOOLEAN := FALSE;
  v_needs_gender BOOLEAN := FALSE;
  v_is_new_user BOOLEAN := FALSE;
  v_last_active_updated BOOLEAN := FALSE;
  v_is_blocked BOOLEAN := FALSE;
  v_blocked_message TEXT := NULL;
  v_max_history INT := 50;
  v_partner_premium_until TIMESTAMPTZ;
  v_blocked_until TIMESTAMPTZ;
  v_blocked_at TIMESTAMPTZ;
  v_unacknowledged_reports_count INT := 0;
BEGIN
  SELECT id, username, first_name, last_active, gender, state, partner_id,
         premium_until, target_gender, location, target_location,
         COALESCE(penalty_points, 0) as penalty_points, created_at, last_partners, is_channel_member,
         COALESCE(unacknowledged_reports_count, 0) as unacknowledged_reports_count
  INTO v_user FROM telegram_users WHERE id = p_user_id;

  IF v_user IS NULL THEN
    INSERT INTO telegram_users (id, username, first_name, last_active, state)
    VALUES (p_user_id, p_username, p_first_name, NOW(), 'idle');
    v_is_new_user := TRUE; v_last_active_updated := TRUE; v_needs_gender := TRUE;
    SELECT id, username, first_name, last_active, gender, state, partner_id,
           premium_until, target_gender, location, target_location,
           COALESCE(penalty_points, 0) as penalty_points, created_at, last_partners, is_channel_member,
           COALESCE(unacknowledged_reports_count, 0) as unacknowledged_reports_count
    INTO v_user FROM telegram_users WHERE id = p_user_id;
  ELSE
    DECLARE v_needs_update BOOLEAN := FALSE;
    BEGIN
      IF (v_user.username IS DISTINCT FROM p_username) OR (v_user.first_name IS DISTINCT FROM p_first_name) THEN v_needs_update := TRUE; END IF;
      IF v_user.last_active::DATE < CURRENT_DATE THEN v_last_active_updated := TRUE; v_needs_update := TRUE; END IF;
      IF v_needs_update THEN
        IF v_last_active_updated THEN
          UPDATE telegram_users SET username = p_username, first_name = p_first_name, last_active = NOW() WHERE id = p_user_id;
        ELSE
          UPDATE telegram_users SET username = p_username, first_name = p_first_name WHERE id = p_user_id;
        END IF;
      END IF;
    END;
  END IF;

  IF v_user.penalty_points >= 100 THEN
    DECLARE v_is_prem BOOLEAN;
            v_already_blocked BOOLEAN;
    BEGIN
       SELECT (premium_until IS NOT NULL AND premium_until > NOW()) INTO v_is_prem FROM telegram_users WHERE id = p_user_id;
       IF NOT v_is_prem THEN
         SELECT EXISTS(SELECT 1 FROM blocked_users WHERE user_id = p_user_id AND is_active = true) INTO v_already_blocked;
         IF NOT v_already_blocked THEN
           INSERT INTO blocked_users (user_id, reason, blocked_message, is_active, blocked_at)
           VALUES (p_user_id, 'auto_penalty_100', 'Akun diblokir karena terlalu banyak laporan negatif dari pengguna lain.', true, NOW())
           ON CONFLICT (user_id) DO UPDATE SET is_active = true, blocked_at = NOW(), unblocked_at = NULL, reason = EXCLUDED.reason, blocked_message = EXCLUDED.blocked_message;
         END IF;
       ELSE
         UPDATE telegram_users SET penalty_points = 0 WHERE id = p_user_id;
         v_user.penalty_points := 0;
       END IF;
    END;
  END IF;

  SELECT blocked_at INTO v_blocked_at FROM blocked_users WHERE user_id = p_user_id AND is_active = TRUE ORDER BY blocked_at DESC LIMIT 1;
  IF v_blocked_at IS NOT NULL THEN
    IF v_blocked_at + INTERVAL '15 days' > NOW() THEN
      SELECT blocked_message INTO v_blocked_message FROM blocked_users WHERE user_id = p_user_id AND is_active = TRUE LIMIT 1;
      v_is_blocked := TRUE; v_blocked_until := v_blocked_at + INTERVAL '15 days';
    ELSE
      UPDATE blocked_users SET is_active = FALSE, unblocked_at = NOW() WHERE user_id = p_user_id AND is_active = TRUE;
      UPDATE telegram_users SET penalty_points = 0, spam_warnings = 0, spam_warning_until = NULL, unacknowledged_reports_count = 0 WHERE id = p_user_id;
      v_is_blocked := FALSE; v_user.penalty_points := 0; v_user.unacknowledged_reports_count := 0;
    END IF;
  END IF;

  IF v_is_blocked THEN
    RETURN json_build_object('success', false, 'action', 'show_blocked', 'error', 'user_blocked', 'blocked_message', v_blocked_message, 'blocked_until', v_blocked_until);
  END IF;

  v_should_check_channel := FALSE;

  IF v_user.gender IS NULL AND NOT p_is_next THEN
    v_needs_gender := TRUE;
    RETURN json_build_object('success', true, 'action', 'needs_gender', 'should_check_channel', v_should_check_channel, 'is_new_user', v_is_new_user);
  END IF;

  IF v_user.state = 'chatting' AND NOT p_is_next THEN
    RETURN json_build_object('success', true, 'action', 'already_chatting', 'partner_id', v_user.partner_id, 'should_check_channel', v_should_check_channel);
  END IF;

  IF v_user.state = 'waiting' AND NOT p_is_next THEN
    IF EXISTS (SELECT 1 FROM waiting_queue WHERE user_id = p_user_id) THEN
      RETURN json_build_object('success', true, 'action', 'already_in_queue', 'should_check_channel', v_should_check_channel);
    ELSE
      UPDATE telegram_users SET state = 'idle' WHERE id = p_user_id;
    END IF;
  END IF;

  v_penalty_points := v_user.penalty_points;
  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW();
  v_unacknowledged_reports_count := v_user.unacknowledged_reports_count;
  IF v_unacknowledged_reports_count > 0 THEN
    UPDATE telegram_users SET unacknowledged_reports_count = 0 WHERE id = p_user_id;
  END IF;

  IF v_penalty_points >= 100 AND NOT v_is_premium THEN
    v_reputation_status := 'banned'; v_reputation_message := 'Akun Anda telah diblokir karena terlalu banyak laporan negatif.';
  ELSIF v_penalty_points >= 70 AND NOT v_is_premium THEN
    v_reputation_status := 'critical'; v_reputation_message := 'Akun Anda di ambang pemblokiran permanen.';
  ELSIF v_penalty_points >= 40 AND NOT v_is_premium THEN
    v_reputation_status := 'warning'; v_reputation_message := 'Kami menerima beberapa laporan negatif tentang Anda.';
  ELSE
    v_reputation_status := 'good'; v_reputation_message := NULL;
  END IF;

  IF v_reputation_status = 'banned' THEN
    RETURN json_build_object('success', false, 'error', 'user_banned', 'action', 'show_banned', 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;

  IF p_is_next AND v_user.state = 'chatting' AND v_user.partner_id IS NOT NULL THEN
    IF p_target_partner_id IS NOT NULL AND v_user.partner_id != p_target_partner_id THEN
        RETURN json_build_object('success', false, 'error', 'action_expired', 'message', 'Aksi diabaikan karena partner sudah berganti.');
    END IF;
    v_old_partner_id := v_user.partner_id;
    UPDATE telegram_users SET state = 'idle', partner_id = NULL, chat_end_count = COALESCE(chat_end_count, 0) + 1 WHERE id = p_user_id;
    IF FOUND THEN
      UPDATE telegram_users SET state = 'idle', partner_id = NULL, chat_end_count = COALESCE(chat_end_count, 0) + 1 WHERE id = v_old_partner_id;
      DELETE FROM waiting_queue WHERE user_id IN (p_user_id, v_old_partner_id);
      v_chat_ended := TRUE;
      SELECT public.handle_end_chat_promo_logic(v_old_partner_id) INTO v_old_partner_promo;
    END IF;
  END IF;

  IF p_is_next AND v_chat_ended THEN
    DECLARE v_my_promo JSON;
    BEGIN
       SELECT public.handle_end_chat_promo_logic(p_user_id) INTO v_my_promo;
       IF v_my_promo->>'should_send' = 'true' THEN
          RETURN json_build_object('success', true, 'action', 'show_promo', 'chat_ended', true, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
       END IF;
    END;
  END IF;

  -- Channel invite check (setelah promo check, sebelum channel membership check)
  -- Hanya cek jika BUKAN promo yang dikirim
  IF NOT v_is_premium THEN
    SELECT public.check_channel_invite_eligibility(p_user_id) INTO v_should_send_channel_invite;
    IF v_should_send_channel_invite THEN
      RETURN json_build_object('success', true, 'action', 'show_channel_invite', 'should_send_channel_invite', true, 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
    END IF;
  END IF;

  IF v_should_check_channel THEN
    RETURN json_build_object('success', true, 'action', 'needs_channel_check', 'should_check_channel', true, 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;

  v_my_gender := v_user.gender;
  IF v_is_premium THEN
    v_my_target_gender := v_user.target_gender; v_my_target_location := v_user.target_location;
  ELSE
    v_my_target_gender := 'semua'; v_my_target_location := 'semua';
  END IF;
  v_my_location := v_user.location;

  FOR v_candidate IN
    SELECT wq.user_id as candidate_id, tu.gender as candidate_gender, tu.target_gender as candidate_target_gender,
           tu.location as candidate_location, tu.target_location as candidate_target_location,
           tu.premium_until as candidate_premium_until, tu.state as candidate_state,
           tu.partner_id as candidate_partner_id, tu.last_partners as candidate_last_partners
    FROM waiting_queue wq JOIN telegram_users tu ON tu.id = wq.user_id
    WHERE wq.user_id != p_user_id ORDER BY wq.joined_at ASC FOR UPDATE OF wq SKIP LOCKED
  LOOP
    IF v_candidate.candidate_state != 'waiting' OR v_candidate.candidate_partner_id IS NOT NULL THEN
      DELETE FROM waiting_queue WHERE user_id = v_candidate.candidate_id; CONTINUE;
    END IF;
    IF v_user.last_partners IS NOT NULL AND v_candidate.candidate_id = ANY(v_user.last_partners) THEN CONTINUE; END IF;
    IF v_candidate.candidate_last_partners IS NOT NULL AND p_user_id = ANY(v_candidate.candidate_last_partners) THEN CONTINUE; END IF;
    v_candidate_is_premium := v_candidate.candidate_premium_until IS NOT NULL AND v_candidate.candidate_premium_until > NOW();
    IF v_candidate_is_premium THEN
      v_candidate_target_gender := v_candidate.candidate_target_gender; v_candidate_target_location := v_candidate.candidate_target_location;
    ELSE
      v_candidate_target_gender := 'semua'; v_candidate_target_location := 'semua';
    END IF;
    v_i_satisfied_gender := TRUE;
    IF v_my_target_gender IS NOT NULL AND v_my_target_gender != 'semua' THEN
      IF v_candidate.candidate_gender IS NULL OR v_candidate.candidate_gender != v_my_target_gender THEN v_i_satisfied_gender := FALSE; END IF;
    END IF;
    v_candidate_satisfied_gender := TRUE;
    IF v_candidate_target_gender IS NOT NULL AND v_candidate_target_gender != 'semua' THEN
      IF v_my_gender IS NULL OR v_my_gender != v_candidate_target_gender THEN v_candidate_satisfied_gender := FALSE; END IF;
    END IF;
    v_i_satisfied_location := TRUE;
    IF v_my_target_location IS NOT NULL AND v_my_target_location != 'semua' THEN
      IF v_candidate.candidate_location IS NULL OR v_candidate.candidate_location != v_my_target_location THEN v_i_satisfied_location := FALSE; END IF;
    END IF;
    v_candidate_satisfied_location := TRUE;
    IF v_candidate_target_location IS NOT NULL AND v_candidate_target_location != 'semua' THEN
      IF v_my_location IS NULL OR v_my_location != v_candidate_target_location THEN v_candidate_satisfied_location := FALSE; END IF;
    END IF;
    IF v_i_satisfied_gender AND v_candidate_satisfied_gender AND v_i_satisfied_location AND v_candidate_satisfied_location THEN
      v_partner_id := v_candidate.candidate_id; v_partner_premium_until := v_candidate.candidate_premium_until; EXIT;
    END IF;
  END LOOP;

  IF v_partner_id IS NOT NULL THEN
    UPDATE telegram_users SET state = 'chatting', partner_id = v_partner_id,
      last_partners = CASE WHEN v_partner_id IN (5920746214, 7168897972) THEN last_partners ELSE (ARRAY[v_partner_id] || COALESCE(last_partners, ARRAY[]::bigint[]))[1:v_max_history] END
    WHERE id = p_user_id;
    UPDATE telegram_users SET state = 'chatting', partner_id = p_user_id,
      last_partners = CASE WHEN p_user_id IN (5920746214, 7168897972) THEN last_partners ELSE (ARRAY[p_user_id] || COALESCE(last_partners, ARRAY[]::bigint[]))[1:v_max_history] END
    WHERE id = v_partner_id;
    DELETE FROM waiting_queue WHERE user_id = v_partner_id;
    RETURN json_build_object('success', true, 'matched', true, 'partner_id', v_partner_id, 'partner_premium_until', v_partner_premium_until, 'action', 'notify_both', 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'should_check_channel', v_should_check_channel, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  ELSE
    INSERT INTO waiting_queue (user_id, joined_at) VALUES (p_user_id, NOW()) ON CONFLICT (user_id) DO UPDATE SET joined_at = NOW();
    UPDATE telegram_users SET state = 'waiting' WHERE id = p_user_id;
    RETURN json_build_object('success', true, 'matched', false, 'partner_id', NULL, 'action', 'wait_in_queue', 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'should_check_channel', v_should_check_channel, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_or_next_partner(
    p_user_id bigint, 
    p_username text DEFAULT NULL::text, 
    p_first_name text DEFAULT NULL::text, 
    p_is_next boolean DEFAULT false,
    p_target_partner_id bigint DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN public.comprehensive_search_action(p_user_id, p_username, p_first_name, p_is_next, p_target_partner_id);
END;
$function$;
