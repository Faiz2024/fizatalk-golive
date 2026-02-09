
-- =====================================================
-- RECENT PARTNERS TABLE (Anti-Repeat Partner Matching)
-- Menyimpan history pasangan dalam interval waktu tertentu
-- untuk mencegah user bertemu partner yang sama berulang kali
-- =====================================================

-- 1. Buat tabel recent_partners
CREATE TABLE public.recent_partners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id BIGINT NOT NULL,
  partner_id BIGINT NOT NULL,
  paired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Jakarta'),
  UNIQUE(user_id, partner_id)  -- Satu entry per pasangan
);

-- 2. Index untuk query cepat
CREATE INDEX idx_recent_partners_user_id ON public.recent_partners(user_id);
CREATE INDEX idx_recent_partners_paired_at ON public.recent_partners(paired_at);

-- 3. Enable RLS
ALTER TABLE public.recent_partners ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy (service role only)
CREATE POLICY "Service role can manage recent_partners" 
ON public.recent_partners 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- 5. Function untuk record pasangan baru
CREATE OR REPLACE FUNCTION record_partner_pairing(
  p_user_id BIGINT,
  p_partner_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert atau update untuk kedua arah
  INSERT INTO recent_partners (user_id, partner_id, paired_at)
  VALUES (p_user_id, p_partner_id, NOW() AT TIME ZONE 'Asia/Jakarta')
  ON CONFLICT (user_id, partner_id) 
  DO UPDATE SET paired_at = NOW() AT TIME ZONE 'Asia/Jakarta';
  
  INSERT INTO recent_partners (user_id, partner_id, paired_at)
  VALUES (p_partner_id, p_user_id, NOW() AT TIME ZONE 'Asia/Jakarta')
  ON CONFLICT (user_id, partner_id) 
  DO UPDATE SET paired_at = NOW() AT TIME ZONE 'Asia/Jakarta';
END;
$$;

-- 6. Function untuk cek apakah pasangan baru-baru ini (dalam interval)
CREATE OR REPLACE FUNCTION is_recent_partner(
  p_user_id BIGINT,
  p_partner_id BIGINT,
  p_interval_minutes INTEGER DEFAULT 30
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM recent_partners
    WHERE user_id = p_user_id 
    AND partner_id = p_partner_id
    AND paired_at > (NOW() AT TIME ZONE 'Asia/Jakarta') - (p_interval_minutes || ' minutes')::INTERVAL
  ) INTO v_recent;
  
  RETURN v_recent;
END;
$$;

-- 7. Function untuk cleanup old records (dipanggil via pg_cron)
CREATE OR REPLACE FUNCTION cleanup_recent_partners()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- Hapus record yang lebih dari 1 jam
  DELETE FROM recent_partners
  WHERE paired_at < (NOW() AT TIME ZONE 'Asia/Jakarta') - INTERVAL '1 hour';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 8. Update comprehensive_search_action untuk mengecek recent partners
CREATE OR REPLACE FUNCTION public.comprehensive_search_action(
  p_user_id bigint, 
  p_username text DEFAULT NULL::text, 
  p_first_name text DEFAULT NULL::text, 
  p_is_next boolean DEFAULT false
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
  v_is_recent_partner BOOLEAN := FALSE;  -- NEW: untuk cek recent partner
  v_anti_repeat_interval INTEGER := 30;   -- NEW: interval dalam menit (default 30)
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
    v_needs_gender := TRUE;
    
    SELECT id, username, first_name, last_active, gender, state, partner_id,
           premium_until, target_gender, location, target_location,
           COALESCE(penalty_points, 0) as penalty_points, created_at
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
  -- =========================================
  IF v_user.created_at < NOW() - INTERVAL '7 days' THEN
    v_should_check_channel := TRUE;
  ELSE
    v_should_check_channel := FALSE;
  END IF;
  
  -- =========================================
  -- 4. CEK GENDER
  -- =========================================
  IF v_user.gender IS NULL AND NOT p_is_next THEN
    v_needs_gender := TRUE;
    RETURN json_build_object(
      'success', true,
      'action', 'show_gender_selection',
      'matched', false,
      'should_check_channel', v_should_check_channel,
      'is_new_user', v_is_new_user
    );
  END IF;
  
  -- =========================================
  -- 5. CEK REPUTASI
  -- =========================================
  v_penalty_points := COALESCE(v_user.penalty_points, 0);
  
  IF v_penalty_points >= 100 THEN
    v_reputation_status := 'banned';
    v_reputation_message := 'Akun Anda telah diblokir karena terlalu banyak laporan negatif. Bayar denda Rp10.000 untuk membuka blokir.';
    RETURN json_build_object(
      'success', false,
      'action', 'show_banned',
      'error', 'user_banned',
      'reputation', json_build_object(
        'status', v_reputation_status,
        'message', v_reputation_message,
        'penalty_points', v_penalty_points
      )
    );
  ELSIF v_penalty_points >= 70 THEN
    v_reputation_status := 'critical';
    v_reputation_message := 'Akun Anda dalam kondisi KRITIS. Satu laporan lagi bisa menyebabkan blokir permanen.';
  ELSIF v_penalty_points >= 40 THEN
    v_reputation_status := 'warning';
    v_reputation_message := 'Anda mendapat beberapa laporan negatif dari pengguna lain. Perbaiki perilaku Anda.';
  ELSE
    v_reputation_status := 'good';
    v_reputation_message := NULL;
  END IF;
  
  -- =========================================
  -- 6. HANDLE NEXT (End current chat first)
  -- =========================================
  IF p_is_next AND v_user.state = 'chatting' AND v_user.partner_id IS NOT NULL THEN
    v_old_partner_id := v_user.partner_id;
    v_chat_ended := TRUE;
    
    -- Update partner lama ke idle
    UPDATE telegram_users
    SET state = 'idle', partner_id = NULL
    WHERE id = v_old_partner_id;
    
    -- Cek promo untuk partner lama
    SELECT handle_end_chat_promo_logic(v_old_partner_id) INTO v_old_partner_promo;
    
    -- Reset user
    UPDATE telegram_users
    SET state = 'idle', partner_id = NULL
    WHERE id = p_user_id;
    
    -- Reload user data
    SELECT id, username, first_name, last_active, gender, state, partner_id,
           premium_until, target_gender, location, target_location,
           COALESCE(penalty_points, 0) as penalty_points, created_at
    INTO v_user
    FROM telegram_users
    WHERE id = p_user_id;
  END IF;
  
  -- =========================================
  -- 7. CEK STATE - Jangan search jika sedang chatting
  -- =========================================
  IF v_user.state = 'chatting' AND v_user.partner_id IS NOT NULL THEN
    RETURN json_build_object(
      'success', false,
      'action', 'already_chatting',
      'error', 'user_already_chatting',
      'partner_id', v_user.partner_id
    );
  END IF;
  
  -- =========================================
  -- 8. PERSIAPAN MATCHING
  -- =========================================
  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW();
  v_my_gender := v_user.gender;
  v_my_target_gender := CASE WHEN v_is_premium THEN v_user.target_gender ELSE NULL END;
  v_my_location := v_user.location;
  v_my_target_location := CASE WHEN v_is_premium THEN v_user.target_location ELSE NULL END;
  
  -- =========================================
  -- 9. LOOP MENCARI PARTNER DARI ANTRIAN
  -- DENGAN CEK RECENT PARTNERS (Anti-Repeat)
  -- =========================================
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
    
    -- =========================================
    -- NEW: CEK APAKAH RECENT PARTNER (Anti-Repeat)
    -- Skip kandidat jika baru dipasangkan dalam 30 menit terakhir
    -- =========================================
    SELECT EXISTS(
      SELECT 1 FROM recent_partners
      WHERE user_id = p_user_id 
      AND partner_id = v_candidate.candidate_id
      AND paired_at > (NOW() AT TIME ZONE 'Asia/Jakarta') - (v_anti_repeat_interval || ' minutes')::INTERVAL
    ) INTO v_is_recent_partner;
    
    IF v_is_recent_partner THEN
      -- Skip partner ini, lanjut ke kandidat berikutnya
      CONTINUE;
    END IF;
    
    -- Cek premium kandidat
    v_candidate_is_premium := v_candidate.candidate_premium_until IS NOT NULL AND v_candidate.candidate_premium_until > NOW();
    v_candidate_target_gender := CASE WHEN v_candidate_is_premium THEN v_candidate.candidate_target_gender ELSE NULL END;
    v_candidate_target_location := CASE WHEN v_candidate_is_premium THEN v_candidate.candidate_target_location ELSE NULL END;
    
    -- CEK GENDER COMPATIBILITY
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
    
    -- CEK LOCATION COMPATIBILITY
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
    
    -- MATCH JIKA KEDUA PIHAK PUAS
    IF v_i_satisfied_gender AND v_candidate_satisfied_gender AND 
       v_i_satisfied_location AND v_candidate_satisfied_location THEN
      v_partner_id := v_candidate.candidate_id;
      EXIT;
    END IF;
  END LOOP;
  
  -- =========================================
  -- 10. PROSES HASIL MATCHING
  -- =========================================
  IF v_partner_id IS NOT NULL THEN
    -- MATCH FOUND!
    -- Hapus dari antrian
    DELETE FROM waiting_queue WHERE user_id = v_partner_id;
    DELETE FROM waiting_queue WHERE user_id = p_user_id;
    
    -- Update kedua user ke chatting
    UPDATE telegram_users
    SET state = 'chatting', partner_id = v_partner_id
    WHERE id = p_user_id;
    
    UPDATE telegram_users
    SET state = 'chatting', partner_id = p_user_id
    WHERE id = v_partner_id;
    
    -- =========================================
    -- NEW: RECORD PARTNER PAIRING (Anti-Repeat)
    -- =========================================
    PERFORM record_partner_pairing(p_user_id, v_partner_id);
    
    RETURN json_build_object(
      'success', true,
      'matched', true,
      'partner_id', v_partner_id,
      'chat_ended', v_chat_ended,
      'old_partner_id', v_old_partner_id,
      'old_partner_promo', v_old_partner_promo,
      'should_check_channel', v_should_check_channel,
      'is_new_user', v_is_new_user,
      'reputation', json_build_object(
        'status', v_reputation_status,
        'message', v_reputation_message,
        'penalty_points', v_penalty_points
      )
    );
  ELSE
    -- NO MATCH - masukkan ke antrian
    INSERT INTO waiting_queue (user_id, joined_at)
    VALUES (p_user_id, NOW())
    ON CONFLICT (user_id) DO UPDATE SET joined_at = NOW();
    
    UPDATE telegram_users SET state = 'waiting' WHERE id = p_user_id;
    
    RETURN json_build_object(
      'success', true,
      'matched', false,
      'partner_id', NULL,
      'chat_ended', v_chat_ended,
      'old_partner_id', v_old_partner_id,
      'old_partner_promo', v_old_partner_promo,
      'should_check_channel', v_should_check_channel,
      'is_new_user', v_is_new_user,
      'reputation', json_build_object(
        'status', v_reputation_status,
        'message', v_reputation_message,
        'penalty_points', v_penalty_points
      )
    );
  END IF;
END;
$function$;

-- 9. Update find_and_pair_partner untuk konsistensi
CREATE OR REPLACE FUNCTION public.find_and_pair_partner(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_candidate RECORD;
  v_partner_id BIGINT := NULL;
  v_is_premium BOOLEAN;
  v_my_gender TEXT;
  v_my_target_gender TEXT;
  v_my_location TEXT;
  v_my_target_location TEXT;
  v_candidate_is_premium BOOLEAN;
  v_candidate_target_gender TEXT;
  v_candidate_target_location TEXT;
  v_i_satisfied_gender BOOLEAN;
  v_candidate_satisfied_gender BOOLEAN;
  v_i_satisfied_location BOOLEAN;
  v_candidate_satisfied_location BOOLEAN;
  v_is_recent_partner BOOLEAN := FALSE;
  v_anti_repeat_interval INTEGER := 30;
  v_result JSON;
BEGIN
  -- 1. Ambil data user
  SELECT 
    gender, target_gender, location, target_location, 
    premium_until, state, partner_id
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id;
  
  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found', 'partner_id', NULL);
  END IF;
  
  IF v_user.state = 'chatting' OR v_user.partner_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_already_chatting', 'partner_id', NULL);
  END IF;
  
  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW();
  v_my_gender := v_user.gender;
  v_my_target_gender := CASE WHEN v_is_premium THEN v_user.target_gender ELSE NULL END;
  v_my_location := v_user.location;
  v_my_target_location := CASE WHEN v_is_premium THEN v_user.target_location ELSE NULL END;
  
  -- 2. Loop antrian dengan anti-repeat check
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
    IF v_candidate.candidate_state != 'waiting' OR v_candidate.candidate_partner_id IS NOT NULL THEN
      DELETE FROM waiting_queue WHERE user_id = v_candidate.candidate_id;
      CONTINUE;
    END IF;
    
    -- CEK RECENT PARTNER (Anti-Repeat)
    SELECT EXISTS(
      SELECT 1 FROM recent_partners
      WHERE user_id = p_user_id 
      AND partner_id = v_candidate.candidate_id
      AND paired_at > (NOW() AT TIME ZONE 'Asia/Jakarta') - (v_anti_repeat_interval || ' minutes')::INTERVAL
    ) INTO v_is_recent_partner;
    
    IF v_is_recent_partner THEN
      CONTINUE;
    END IF;
    
    v_candidate_is_premium := v_candidate.candidate_premium_until IS NOT NULL AND v_candidate.candidate_premium_until > NOW();
    v_candidate_target_gender := CASE WHEN v_candidate_is_premium THEN v_candidate.candidate_target_gender ELSE NULL END;
    v_candidate_target_location := CASE WHEN v_candidate_is_premium THEN v_candidate.candidate_target_location ELSE NULL END;
    
    -- CEK GENDER
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
    
    -- CEK LOCATION
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
    
    IF v_i_satisfied_gender AND v_candidate_satisfied_gender AND 
       v_i_satisfied_location AND v_candidate_satisfied_location THEN
      v_partner_id := v_candidate.candidate_id;
      EXIT;
    END IF;
  END LOOP;
  
  -- 3. Proses hasil
  IF v_partner_id IS NOT NULL THEN
    DELETE FROM waiting_queue WHERE user_id = v_partner_id;
    DELETE FROM waiting_queue WHERE user_id = p_user_id;
    
    UPDATE telegram_users
    SET state = 'chatting', partner_id = v_partner_id
    WHERE id = p_user_id;
    
    UPDATE telegram_users
    SET state = 'chatting', partner_id = p_user_id
    WHERE id = v_partner_id;
    
    -- Record partner pairing
    PERFORM record_partner_pairing(p_user_id, v_partner_id);
    
    RETURN json_build_object('success', true, 'partner_id', v_partner_id);
  ELSE
    RETURN json_build_object('success', true, 'partner_id', NULL);
  END IF;
END;
$function$;
