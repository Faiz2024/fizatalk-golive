-- 1. Tambah kolom unacknowledged_reports_count
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS unacknowledged_reports_count INT DEFAULT 0;

-- 2. Update submit_partner_report untuk menambah konter peringatan
CREATE OR REPLACE FUNCTION public.submit_partner_report(p_reporter_id bigint, p_reported_id bigint, p_report_type text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_penalty_change INTEGER;
  v_new_penalty INTEGER;
  v_already_reported BOOLEAN;
  v_reporter_penalty INTEGER;
  v_is_reported_premium BOOLEAN;
  v_last_partners BIGINT[];
  v_old_penalty INTEGER;
BEGIN
  -- 1. Cek apakah pengguna yang dilaporkan adalah user premium
  SELECT (premium_until IS NOT NULL AND premium_until > NOW()) INTO v_is_reported_premium
  FROM telegram_users WHERE id = p_reported_id;
  
  -- 2. Ambil poin penalti pelapor dan riwayat partner
  SELECT COALESCE(penalty_points, 0), last_partners INTO v_reporter_penalty, v_last_partners
  FROM telegram_users WHERE id = p_reporter_id;

  -- 3. Validasi partner terakhir untuk laporan negatif
  IF p_report_type IN ('spam', 'sange') THEN
    IF v_last_partners IS NULL OR NOT (p_reported_id = ANY(v_last_partners[1:2])) THEN
      RETURN json_build_object('success', false, 'error', 'partner_not_recent');
    END IF;
  END IF;

  -- 4. User dengan penalti > 40 dilarang lapor negatif
  IF v_reporter_penalty > 40 AND p_report_type IN ('spam', 'sange') THEN
    RETURN json_build_object('success', false, 'error', 'reputation_too_low');
  END IF;

  -- 5. Cek duplikat laporan
  SELECT EXISTS(
    SELECT 1 FROM partner_reports
    WHERE reporter_id = p_reporter_id AND reported_id = p_reported_id
      AND created_at > NOW() - INTERVAL '1 hour'
  ) INTO v_already_reported;
  
  IF v_already_reported THEN
    RETURN json_build_object('success', false, 'error', 'already_reported');
  END IF;
  
  -- 6. Tentukan perubahan penalti
  CASE p_report_type
    WHEN 'spam' THEN v_penalty_change := 10;
    WHEN 'sange' THEN v_penalty_change := 15;
    WHEN 'baik' THEN v_penalty_change := -3;
    WHEN 'asik' THEN v_penalty_change := -5;
    ELSE RETURN json_build_object('success', false, 'error', 'invalid_report_type');
  END CASE;
  
  -- 7. Insert report
  INSERT INTO partner_reports (reporter_id, reported_id, report_type, penalty_change)
  VALUES (p_reporter_id, p_reported_id, p_report_type, v_penalty_change);
  
  -- Simpan penalty lama untuk cek warning
  SELECT COALESCE(penalty_points, 0) INTO v_old_penalty FROM telegram_users WHERE id = p_reported_id;

  -- 8. Update penalti & konter peringatan (jika penalty lama < 40 dan laporan negatif)
  UPDATE telegram_users
  SET 
    penalty_points = GREATEST(0, COALESCE(penalty_points, 0) + v_penalty_change),
    unacknowledged_reports_count = CASE 
      WHEN v_old_penalty < 40 AND v_penalty_change > 0 THEN COALESCE(unacknowledged_reports_count, 0) + 1
      ELSE unacknowledged_reports_count
    END
  WHERE id = p_reported_id
  RETURNING penalty_points INTO v_new_penalty;
  
  -- 9. Handle penalti >= 100
  IF v_new_penalty >= 100 THEN
    IF v_is_reported_premium THEN
      -- PREMIUM: Jangan diblokir/temp ban, cukup reset penalty_points ke 0 saja
      UPDATE telegram_users SET penalty_points = 0 WHERE id = p_reported_id;
      v_new_penalty := 0;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', 0, 'is_banned', false, 'is_temp_banned', false);
    ELSE
      -- NON-PREMIUM: Blokir permanen (3 hari via auto-expire)
      INSERT INTO blocked_users (user_id, reason, blocked_message, is_active)
      VALUES (p_reported_id, 'auto_penalty_100', 'Akun diblokir karena terlalu banyak laporan negatif dari pengguna lain.', true)
      ON CONFLICT DO NOTHING;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', true, 'is_temp_banned', false);
    END IF;
  END IF;
  
  RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', false, 'is_temp_banned', false);
END;
$function$;

-- 3. Update comprehensive_search_action untuk me-return jumlah peringatan & reset
CREATE OR REPLACE FUNCTION public.comprehensive_search_action(p_user_id bigint, p_username text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_is_next boolean DEFAULT false)
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
  -- 1. UPSERT USER
  SELECT id, username, first_name, last_active, gender, state, partner_id,
         premium_until, target_gender, location, target_location,
         COALESCE(penalty_points, 0) as penalty_points, created_at, last_partners, is_channel_member,
         COALESCE(unacknowledged_reports_count, 0) as unacknowledged_reports_count
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id;

  IF v_user IS NULL THEN
    INSERT INTO telegram_users (id, username, first_name, last_active, state)
    VALUES (p_user_id, p_username, p_first_name, NOW(), 'idle');
    v_is_new_user := TRUE;
    v_last_active_updated := TRUE;
    v_needs_gender := TRUE;
    
    SELECT id, username, first_name, last_active, gender, state, partner_id,
           premium_until, target_gender, location, target_location,
           COALESCE(penalty_points, 0) as penalty_points, created_at, last_partners, is_channel_member,
           COALESCE(unacknowledged_reports_count, 0) as unacknowledged_reports_count
    INTO v_user
    FROM telegram_users
    WHERE id = p_user_id;
  ELSE
    DECLARE
      v_needs_update BOOLEAN := FALSE;
    BEGIN
      IF (v_user.username IS DISTINCT FROM p_username) OR 
         (v_user.first_name IS DISTINCT FROM p_first_name) THEN
         v_needs_update := TRUE;
      END IF;
      IF v_user.last_active::DATE < CURRENT_DATE THEN
        v_last_active_updated := TRUE;
        v_needs_update := TRUE;
      END IF;
      IF v_needs_update THEN
        IF v_last_active_updated THEN
          UPDATE telegram_users SET username = p_username, first_name = p_first_name, last_active = NOW() WHERE id = p_user_id;
        ELSE
          UPDATE telegram_users SET username = p_username, first_name = p_first_name WHERE id = p_user_id;
        END IF;
      END IF;
    END;
  END IF;
  
  -- 2. CEK BLOKIR PERMANEN (dengan auto-expire 3 hari)
  SELECT blocked_at INTO v_blocked_at
  FROM blocked_users
  WHERE user_id = p_user_id AND is_active = TRUE
  ORDER BY blocked_at DESC
  LIMIT 1;

  IF v_blocked_at IS NOT NULL THEN
    IF v_blocked_at + INTERVAL '3 days' > NOW() THEN
      -- Masih dalam masa blokir 3 hari
      SELECT blocked_message INTO v_blocked_message FROM blocked_users WHERE user_id = p_user_id AND is_active = TRUE LIMIT 1;
      v_is_blocked := TRUE;
      v_blocked_until := v_blocked_at + INTERVAL '3 days';
    ELSE
      -- Sudah lewat 3 hari, auto-unblock dan reset penalty
      UPDATE blocked_users SET is_active = FALSE, unblocked_at = NOW() WHERE user_id = p_user_id AND is_active = TRUE;
      UPDATE telegram_users SET penalty_points = 0 WHERE id = p_user_id;
      v_is_blocked := FALSE;
      -- Update local variable
      v_user.penalty_points := 0;
    END IF;
  END IF;

  IF v_is_blocked THEN
    RETURN json_build_object(
      'success', false, 
      'action', 'show_blocked', 
      'error', 'user_blocked', 
      'blocked_message', v_blocked_message,
      'blocked_until', v_blocked_until
    );
  END IF;
  
  -- 3. CEK CHANNEL JOIN
  IF v_user.created_at < NOW() - INTERVAL '7 days' AND v_user.is_channel_member = FALSE THEN 
      v_should_check_channel := TRUE; 
  ELSE 
      v_should_check_channel := FALSE; 
  END IF;
  
  -- 4. CEK GENDER
  IF v_user.gender IS NULL AND NOT p_is_next THEN
    v_needs_gender := TRUE;
    RETURN json_build_object('success', true, 'action', 'needs_gender', 'should_check_channel', v_should_check_channel, 'is_new_user', v_is_new_user);
  END IF;
  
  -- 5. CEK STATE
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

  -- 6. CEK REPUTASI
  v_penalty_points := v_user.penalty_points;
  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW();
  v_unacknowledged_reports_count := v_user.unacknowledged_reports_count;
  
  -- Reset warning counter jika ada (supaya hanya ditampilkan 1x)
  IF v_unacknowledged_reports_count > 0 THEN
    UPDATE telegram_users SET unacknowledged_reports_count = 0 WHERE id = p_user_id;
  END IF;

  IF v_penalty_points >= 100 AND NOT v_is_premium THEN
    v_reputation_status := 'banned';
    v_reputation_message := 'Akun Anda telah diblokir karena terlalu banyak laporan negatif.';
  ELSIF v_penalty_points >= 70 AND NOT v_is_premium THEN
    v_reputation_status := 'critical';
    v_reputation_message := 'Akun Anda di ambang pemblokiran permanen.';
  ELSIF v_penalty_points >= 40 AND NOT v_is_premium THEN
    v_reputation_status := 'warning';
    v_reputation_message := 'Kami menerima beberapa laporan negatif tentang Anda.';
  ELSE
    v_reputation_status := 'good';
    v_reputation_message := NULL;
  END IF;

  IF v_reputation_status = 'banned' THEN
    RETURN json_build_object('success', false, 'error', 'user_banned', 'action', 'show_banned', 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;
  
  -- 7. HANDLE NEXT (END CHAT)
  IF p_is_next AND v_user.state = 'chatting' AND v_user.partner_id IS NOT NULL THEN
    v_old_partner_id := v_user.partner_id;
    UPDATE telegram_users 
    SET state = 'idle', 
        partner_id = NULL,
        chat_end_count = COALESCE(chat_end_count, 0) + 1
    WHERE id = p_user_id;

    IF FOUND THEN
      UPDATE telegram_users 
      SET state = 'idle', 
          partner_id = NULL,
          chat_end_count = COALESCE(chat_end_count, 0) + 1
      WHERE id = v_old_partner_id;
      
      DELETE FROM waiting_queue WHERE user_id IN (p_user_id, v_old_partner_id);
      v_chat_ended := TRUE;
      SELECT public.handle_end_chat_promo_logic(v_old_partner_id) INTO v_old_partner_promo;
    END IF;
  END IF;

  IF p_is_next AND v_chat_ended THEN
    DECLARE
       v_my_promo JSON;
    BEGIN
       SELECT public.handle_end_chat_promo_logic(p_user_id) INTO v_my_promo;
       IF v_my_promo->>'should_send' = 'true' THEN
          RETURN json_build_object(
             'success', true, 'action', 'show_promo', 'chat_ended', true,
             'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo,
             'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count)
          );
       END IF;
    END;
  END IF;

  IF v_should_check_channel THEN
      RETURN json_build_object(
         'success', true, 'action', 'needs_channel_check', 'should_check_channel', true,
         'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo,
         'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count)
      );
  END IF;
  
  -- 8. CARI PARTNER (LOGIKA MATCHING)
  v_my_gender := v_user.gender;
  IF v_is_premium THEN
    v_my_target_gender := v_user.target_gender;
    v_my_target_location := v_user.target_location;
  ELSE
    v_my_target_gender := 'semua';
    v_my_target_location := 'semua';
  END IF;
  v_my_location := v_user.location;
  
  FOR v_candidate IN
    SELECT 
      wq.user_id as candidate_id,
      tu.gender as candidate_gender,
      tu.target_gender as candidate_target_gender,
      tu.location as candidate_location,
      tu.target_location as candidate_target_location,
      tu.premium_until as candidate_premium_until,
      tu.state as candidate_state,
      tu.partner_id as candidate_partner_id,
      tu.last_partners as candidate_last_partners
    FROM waiting_queue wq
    JOIN telegram_users tu ON tu.id = wq.user_id
    WHERE wq.user_id != p_user_id
    ORDER BY wq.joined_at ASC
    FOR UPDATE OF wq SKIP LOCKED
  LOOP
    IF v_candidate.candidate_state != 'waiting' OR v_candidate.candidate_partner_id IS NOT NULL THEN
      DELETE FROM waiting_queue WHERE user_id = v_candidate.candidate_id;
      CONTINUE;
    END IF;

    IF v_user.last_partners IS NOT NULL AND v_candidate.candidate_id = ANY(v_user.last_partners) THEN
        CONTINUE;
    END IF;
    IF v_candidate.candidate_last_partners IS NOT NULL AND p_user_id = ANY(v_candidate.candidate_last_partners) THEN
        CONTINUE;
    END IF;
    
    v_candidate_is_premium := v_candidate.candidate_premium_until IS NOT NULL AND v_candidate.candidate_premium_until > NOW();
    
    IF v_candidate_is_premium THEN
      v_candidate_target_gender := v_candidate.candidate_target_gender;
      v_candidate_target_location := v_candidate.candidate_target_location;
    ELSE
      v_candidate_target_gender := 'semua';
      v_candidate_target_location := 'semua';
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
      v_partner_id := v_candidate.candidate_id;
      v_partner_premium_until := v_candidate.candidate_premium_until;
      EXIT;
    END IF;
  END LOOP;
  
  -- 9. PROSES HASIL
  IF v_partner_id IS NOT NULL THEN
    UPDATE telegram_users 
    SET state = 'chatting', 
        partner_id = v_partner_id,
        last_partners = CASE 
            WHEN v_partner_id IN (5920746214, 7168897972) THEN last_partners 
            ELSE (ARRAY[v_partner_id] || COALESCE(last_partners, ARRAY[]::bigint[]))[1:v_max_history] 
        END
    WHERE id = p_user_id;

    UPDATE telegram_users 
    SET state = 'chatting', 
        partner_id = p_user_id,
        last_partners = CASE 
            WHEN p_user_id IN (5920746214, 7168897972) THEN last_partners 
            ELSE (ARRAY[p_user_id] || COALESCE(last_partners, ARRAY[]::bigint[]))[1:v_max_history] 
        END
    WHERE id = v_partner_id;

    DELETE FROM waiting_queue WHERE user_id = v_partner_id;
  
    RETURN json_build_object(
      'success', true,
      'matched', true,
      'partner_id', v_partner_id,
      'partner_premium_until', v_partner_premium_until,
      'action', 'notify_both',
      'chat_ended', v_chat_ended,
      'old_partner_id', v_old_partner_id,
      'old_partner_promo', v_old_partner_promo,
      'should_check_channel', v_should_check_channel,
      'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count)
    );
  ELSE
    INSERT INTO waiting_queue (user_id, joined_at) VALUES (p_user_id, NOW()) ON CONFLICT (user_id) DO UPDATE SET joined_at = NOW();
    UPDATE telegram_users SET state = 'waiting' WHERE id = p_user_id;
    
    RETURN json_build_object(
      'success', true,
      'matched', false,
      'partner_id', NULL,
      'action', 'wait_in_queue',
      'chat_ended', v_chat_ended,
      'old_partner_id', v_old_partner_id,
      'old_partner_promo', v_old_partner_promo,
      'should_check_channel', v_should_check_channel,
      'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count)
    );
  END IF;
END;
$function$;
