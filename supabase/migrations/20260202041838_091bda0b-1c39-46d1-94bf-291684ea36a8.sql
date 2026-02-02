-- =====================================================
-- COMPREHENSIVE RPC: comprehensive_search_action
-- Menggabungkan SEMUA operasi dalam SATU PANGGILAN:
-- 1. Upsert user dengan daily last_active check
-- 2. Cek apakah harus tampilkan channel join (> 1 minggu)
-- 3. Cek state user, gender, partner_id
-- 4. Cek reputasi/penalty points
-- 5. Handle end chat jika next
-- 6. Search/match partner
-- =====================================================

CREATE OR REPLACE FUNCTION public.comprehensive_search_action(
  p_user_id BIGINT,
  p_username TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_is_next BOOLEAN DEFAULT FALSE  -- TRUE jika dari tombol Next, FALSE jika dari Search Partner
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_partner_id BIGINT := NULL;
  v_old_partner_id BIGINT := NULL;
  v_is_premium BOOLEAN;
  v_my_gender TEXT;
  v_my_target_gender TEXT;
  v_my_location TEXT;
  v_my_target_location TEXT;
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
BEGIN
  -- =========================================
  -- 1. UPSERT USER (Optimized - only update if changed)
  -- =========================================
  SELECT id, username, first_name, last_active, gender, state, partner_id,
         premium_until, target_gender, location, target_location,
         COALESCE(penalty_points, 0) as penalty_points, created_at
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id;
  
  IF v_user IS NULL THEN
    -- New user - insert
    INSERT INTO telegram_users (id, username, first_name, last_active, state)
    VALUES (p_user_id, p_username, p_first_name, NOW(), 'idle');
    v_is_new_user := TRUE;
    v_last_active_updated := TRUE;
    v_needs_gender := TRUE; -- New user needs to set gender
    
    -- Reload user data
    SELECT id, username, first_name, last_active, gender, state, partner_id,
           premium_until, target_gender, location, target_location,
           COALESCE(penalty_points, 0) as penalty_points, created_at
    INTO v_user
    FROM telegram_users
    WHERE id = p_user_id;
  ELSE
    -- Existing user - check if update needed
    DECLARE
      v_needs_update BOOLEAN := FALSE;
    BEGIN
      IF (v_user.username IS DISTINCT FROM p_username) OR 
         (v_user.first_name IS DISTINCT FROM p_first_name) THEN
        v_needs_update := TRUE;
      END IF;
      
      -- Check if last_active needs update (only once per day)
      IF v_user.last_active::DATE < CURRENT_DATE THEN
        v_last_active_updated := TRUE;
        v_needs_update := TRUE;
      END IF;
      
      -- Only update if something changed
      IF v_needs_update THEN
        IF v_last_active_updated THEN
          UPDATE telegram_users
          SET username = p_username,
              first_name = p_first_name,
              last_active = NOW()
          WHERE id = p_user_id;
        ELSE
          UPDATE telegram_users
          SET username = p_username,
              first_name = p_first_name
          WHERE id = p_user_id;
        END IF;
      END IF;
    END;
  END IF;
  
  -- =========================================
  -- 2. CEK APAKAH USER DIBLOKIR
  -- =========================================
  SELECT EXISTS(
    SELECT 1 FROM blocked_users
    WHERE user_id = p_user_id AND is_active = TRUE
  ) INTO v_is_blocked;
  
  IF v_is_blocked THEN
    SELECT blocked_message INTO v_blocked_message
    FROM blocked_users
    WHERE user_id = p_user_id AND is_active = TRUE
    LIMIT 1;
    
    RETURN json_build_object(
      'success', false,
      'action', 'show_blocked',
      'error', 'user_blocked',
      'blocked_message', v_blocked_message
    );
  END IF;
  
  -- =========================================
  -- 3. CEK APAKAH HARUS TAMPILKAN CHANNEL JOIN
  -- (Hanya untuk user yang terdaftar > 1 minggu)
  -- =========================================
  IF v_user.created_at < NOW() - INTERVAL '7 days' THEN
    v_should_check_channel := TRUE;
  ELSE
    v_should_check_channel := FALSE;
  END IF;
  
  -- =========================================
  -- 4. CEK GENDER (Return early jika belum set dan bukan next)
  -- =========================================
  IF v_user.gender IS NULL AND NOT p_is_next THEN
    v_needs_gender := TRUE;
    RETURN json_build_object(
      'success', true,
      'action', 'needs_gender',
      'should_check_channel', v_should_check_channel,
      'is_new_user', v_is_new_user
    );
  END IF;
  
  -- =========================================
  -- 5. CEK STATE USER
  -- =========================================
  -- Jika sedang chatting dan ini BUKAN next, return early
  IF v_user.state = 'chatting' AND NOT p_is_next THEN
    RETURN json_build_object(
      'success', true,
      'action', 'already_chatting',
      'partner_id', v_user.partner_id,
      'should_check_channel', v_should_check_channel
    );
  END IF;
  
  -- Jika sedang dalam antrian dan ini BUKAN next
  IF v_user.state = 'waiting' AND NOT p_is_next THEN
    -- Cek apakah user benar ada di queue (anti zombie)
    IF EXISTS (SELECT 1 FROM waiting_queue WHERE user_id = p_user_id) THEN
      RETURN json_build_object(
        'success', true,
        'action', 'already_in_queue',
        'should_check_channel', v_should_check_channel
      );
    ELSE
      -- Zombie state: user dalam state waiting tapi tidak ada di queue
      UPDATE telegram_users SET state = 'idle' WHERE id = p_user_id;
      -- Continue to search
    END IF;
  END IF;
  
  -- =========================================
  -- 6. CEK REPUTASI / PENALTY POINTS
  -- =========================================
  v_penalty_points := v_user.penalty_points;
  
  IF v_penalty_points >= 100 THEN
    v_reputation_status := 'banned';
    v_reputation_message := 'Akun Anda telah diblokir karena terlalu banyak laporan negatif.';
  ELSIF v_penalty_points >= 70 THEN
    v_reputation_status := 'critical';
    v_reputation_message := 'Akun Anda di ambang pemblokiran permanen. Satu laporan lagi dan Anda akan dibanned.';
  ELSIF v_penalty_points >= 40 THEN
    v_reputation_status := 'warning';
    v_reputation_message := 'Kami menerima beberapa laporan negatif tentang Anda. Harap perbaiki sikap atau akun berisiko dibatasi.';
  ELSE
    v_reputation_status := 'good';
    v_reputation_message := NULL;
  END IF;
  
  -- Jika user banned via penalty, return langsung
  IF v_reputation_status = 'banned' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'user_banned',
      'action', 'show_banned',
      'reputation', json_build_object(
        'status', v_reputation_status,
        'message', v_reputation_message,
        'penalty_points', v_penalty_points
      )
    );
  END IF;
  
  -- =========================================
  -- 7. HANDLE NEXT: AKHIRI CHAT JIKA SEDANG CHATTING
  -- =========================================
  IF p_is_next AND v_user.state = 'chatting' AND v_user.partner_id IS NOT NULL THEN
    v_old_partner_id := v_user.partner_id;
    
    -- Reset user state
    UPDATE telegram_users
    SET state = 'idle', partner_id = NULL
    WHERE id = p_user_id AND partner_id = v_old_partner_id;
    
    IF FOUND THEN
      -- Reset partner state juga
      UPDATE telegram_users
      SET state = 'idle', partner_id = NULL
      WHERE id = v_old_partner_id AND partner_id = p_user_id;
      
      -- Hapus dari waiting queue jika ada
      DELETE FROM waiting_queue WHERE user_id = p_user_id;
      DELETE FROM waiting_queue WHERE user_id = v_old_partner_id;
      
      -- Increment chat_end_count untuk kedua user
      UPDATE telegram_users
      SET chat_end_count = COALESCE(chat_end_count, 0) + 1
      WHERE id IN (p_user_id, v_old_partner_id);
      
      v_chat_ended := TRUE;
      
      -- Cek apakah partner perlu dapat promo (handle_end_chat_promo_logic)
      SELECT public.handle_end_chat_promo_logic(v_old_partner_id) INTO v_old_partner_promo;
    END IF;
  END IF;
  
  -- =========================================
  -- 8. CARI PARTNER DARI ANTRIAN
  -- =========================================
  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW();
  v_my_gender := v_user.gender;
  v_my_target_gender := CASE WHEN v_is_premium THEN v_user.target_gender ELSE NULL END;
  v_my_location := v_user.location;
  v_my_target_location := CASE WHEN v_is_premium THEN v_user.target_location ELSE NULL END;
  
  FOR v_candidate IN
    SELECT 
      wq.user_id as candidate_id,
      tu.gender as candidate_gender,
      tu.target_gender as candidate_target_gender,
      tu.location as candidate_location,
      tu.target_location as candidate_target_location,
      tu.premium_until as candidate_premium_until,
      tu.state as candidate_state,
      tu.partner_id as candidate_partner_id
    FROM waiting_queue wq
    JOIN telegram_users tu ON tu.id = wq.user_id
    WHERE wq.user_id != p_user_id
    ORDER BY wq.joined_at ASC
    FOR UPDATE OF wq SKIP LOCKED
  LOOP
    -- Validasi kandidat
    IF v_candidate.candidate_state != 'waiting' OR v_candidate.candidate_partner_id IS NOT NULL THEN
      DELETE FROM waiting_queue WHERE user_id = v_candidate.candidate_id;
      CONTINUE;
    END IF;
    
    -- Cek apakah kandidat premium
    v_candidate_is_premium := v_candidate.candidate_premium_until IS NOT NULL AND v_candidate.candidate_premium_until > NOW();
    v_candidate_target_gender := CASE WHEN v_candidate_is_premium THEN v_candidate.candidate_target_gender ELSE NULL END;
    v_candidate_target_location := CASE WHEN v_candidate_is_premium THEN v_candidate.candidate_target_location ELSE NULL END;
    
    -- CEK KOMPATIBILITAS GENDER
    v_i_satisfied_gender := TRUE;
    IF v_my_target_gender IS NOT NULL AND v_my_target_gender != 'semua' THEN
      IF v_candidate.candidate_gender IS NULL OR v_candidate.candidate_gender != v_my_target_gender THEN
        v_i_satisfied_gender := FALSE;
      END IF;
    END IF;
    
    v_candidate_satisfied_gender := TRUE;
    IF v_candidate_target_gender IS NOT NULL AND v_candidate_target_gender != 'semua' THEN
      IF v_my_gender IS NULL OR v_my_gender != v_candidate_target_gender THEN
        v_candidate_satisfied_gender := FALSE;
      END IF;
    END IF;
    
    -- CEK KOMPATIBILITAS LOKASI
    v_i_satisfied_location := TRUE;
    IF v_my_target_location IS NOT NULL AND v_my_target_location != 'semua' THEN
      IF v_candidate.candidate_location IS NULL OR v_candidate.candidate_location != v_my_target_location THEN
        v_i_satisfied_location := FALSE;
      END IF;
    END IF;
    
    v_candidate_satisfied_location := TRUE;
    IF v_candidate_target_location IS NOT NULL AND v_candidate_target_location != 'semua' THEN
      IF v_my_location IS NULL OR v_my_location != v_candidate_target_location THEN
        v_candidate_satisfied_location := FALSE;
      END IF;
    END IF;
    
    -- KEDUA PIHAK HARUS PUAS
    IF v_i_satisfied_gender AND v_candidate_satisfied_gender AND v_i_satisfied_location AND v_candidate_satisfied_location THEN
      v_partner_id := v_candidate.candidate_id;
      EXIT;
    END IF;
  END LOOP;
  
  -- =========================================
  -- 9. PROSES HASIL PENCARIAN
  -- =========================================
  IF v_partner_id IS NOT NULL THEN
    -- Partner ditemukan - update state kedua user
    UPDATE telegram_users
    SET state = 'chatting', partner_id = v_partner_id
    WHERE id = p_user_id;
    
    UPDATE telegram_users
    SET state = 'chatting', partner_id = p_user_id
    WHERE id = v_partner_id;
    
    -- Hapus partner dari waiting queue
    DELETE FROM waiting_queue WHERE user_id = v_partner_id;
    
    RETURN json_build_object(
      'success', true,
      'matched', true,
      'partner_id', v_partner_id,
      'action', 'notify_both',
      'chat_ended', v_chat_ended,
      'old_partner_id', v_old_partner_id,
      'old_partner_promo', v_old_partner_promo,
      'should_check_channel', v_should_check_channel,
      'reputation', json_build_object(
        'status', v_reputation_status,
        'message', v_reputation_message,
        'penalty_points', v_penalty_points
      )
    );
  ELSE
    -- Tidak ada partner cocok - masukkan ke antrian
    INSERT INTO waiting_queue (user_id, joined_at)
    VALUES (p_user_id, NOW())
    ON CONFLICT (user_id) DO UPDATE SET joined_at = NOW();
    
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
      'reputation', json_build_object(
        'status', v_reputation_status,
        'message', v_reputation_message,
        'penalty_points', v_penalty_points
      )
    );
  END IF;
END;
$$;