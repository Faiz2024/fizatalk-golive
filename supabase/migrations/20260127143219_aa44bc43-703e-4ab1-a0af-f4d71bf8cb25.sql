-- ============================================
-- RPC FUNCTION: find_and_pair_partner
-- Menggabungkan pencocokan partner menjadi satu operasi atomik di database
-- Ini mengurangi round-trip ke edge function dan lebih hemat biaya
-- ============================================

CREATE OR REPLACE FUNCTION public.find_and_pair_partner(
  p_user_id BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_result JSON;
BEGIN
  -- 1. Ambil data user yang mencari
  SELECT 
    gender, 
    target_gender, 
    location, 
    target_location, 
    premium_until,
    state,
    partner_id
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id;
  
  -- Jika user tidak ditemukan
  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found', 'partner_id', NULL);
  END IF;
  
  -- Jika user sudah chatting atau punya partner
  IF v_user.state = 'chatting' OR v_user.partner_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_already_chatting', 'partner_id', NULL);
  END IF;
  
  -- Cek apakah user premium
  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW();
  v_my_gender := v_user.gender;
  v_my_target_gender := CASE WHEN v_is_premium THEN v_user.target_gender ELSE NULL END;
  v_my_location := v_user.location;
  v_my_target_location := CASE WHEN v_is_premium THEN v_user.target_location ELSE NULL END;
  
  -- 2. Loop melalui antrian untuk mencari partner yang kompatibel
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
    FOR UPDATE OF wq SKIP LOCKED  -- Row-level locking untuk mencegah race condition
  LOOP
    -- Validasi kandidat harus dalam state waiting dan belum punya partner
    IF v_candidate.candidate_state != 'waiting' OR v_candidate.candidate_partner_id IS NOT NULL THEN
      -- Hapus kandidat yang tidak valid dari antrian
      DELETE FROM waiting_queue WHERE user_id = v_candidate.candidate_id;
      CONTINUE;
    END IF;
    
    -- Cek apakah kandidat premium
    v_candidate_is_premium := v_candidate.candidate_premium_until IS NOT NULL AND v_candidate.candidate_premium_until > NOW();
    v_candidate_target_gender := CASE WHEN v_candidate_is_premium THEN v_candidate.candidate_target_gender ELSE NULL END;
    v_candidate_target_location := CASE WHEN v_candidate_is_premium THEN v_candidate.candidate_target_location ELSE NULL END;
    
    -- === CEK KOMPATIBILITAS DUA ARAH (GENDER) ===
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
    
    -- === CEK KOMPATIBILITAS DUA ARAH (LOKASI) ===
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
    
    -- KEDUA PIHAK HARUS PUAS untuk dipasangkan
    IF v_i_satisfied_gender AND v_candidate_satisfied_gender AND v_i_satisfied_location AND v_candidate_satisfied_location THEN
      v_partner_id := v_candidate.candidate_id;
      EXIT; -- Keluar dari loop, partner ditemukan
    END IF;
  END LOOP;
  
  -- 3. Jika tidak ada partner yang cocok
  IF v_partner_id IS NULL THEN
    -- Masukkan user ke antrian
    INSERT INTO waiting_queue (user_id, joined_at)
    VALUES (p_user_id, NOW())
    ON CONFLICT (user_id) DO UPDATE SET joined_at = NOW();
    
    -- Update state user ke waiting
    UPDATE telegram_users 
    SET state = 'waiting'
    WHERE id = p_user_id;
    
    RETURN json_build_object('success', true, 'matched', false, 'partner_id', NULL);
  END IF;
  
  -- 4. Partner ditemukan! Lakukan atomic pairing
  
  -- 4a. Update user 1 (pencari) ke chatting
  UPDATE telegram_users
  SET state = 'chatting', partner_id = v_partner_id
  WHERE id = p_user_id 
    AND (state = 'idle' OR state = 'waiting')
    AND partner_id IS NULL;
  
  IF NOT FOUND THEN
    -- Gagal lock user 1, kembalikan kandidat ke antrian
    INSERT INTO waiting_queue (user_id, joined_at)
    VALUES (v_partner_id, NOW())
    ON CONFLICT (user_id) DO NOTHING;
    
    RETURN json_build_object('success', false, 'error', 'failed_to_lock_user', 'partner_id', NULL);
  END IF;
  
  -- 4b. Update user 2 (kandidat) ke chatting
  UPDATE telegram_users
  SET state = 'chatting', partner_id = p_user_id
  WHERE id = v_partner_id 
    AND state = 'waiting'
    AND partner_id IS NULL;
  
  IF NOT FOUND THEN
    -- Gagal lock user 2, rollback user 1
    UPDATE telegram_users
    SET state = 'waiting', partner_id = NULL
    WHERE id = p_user_id;
    
    -- Kembalikan keduanya ke antrian
    INSERT INTO waiting_queue (user_id, joined_at)
    VALUES (p_user_id, NOW())
    ON CONFLICT (user_id) DO NOTHING;
    
    INSERT INTO waiting_queue (user_id, joined_at)
    VALUES (v_partner_id, NOW())
    ON CONFLICT (user_id) DO NOTHING;
    
    RETURN json_build_object('success', false, 'error', 'failed_to_lock_partner', 'partner_id', NULL);
  END IF;
  
  -- 4c. Hapus keduanya dari antrian
  DELETE FROM waiting_queue WHERE user_id IN (p_user_id, v_partner_id);
  
  -- 5. SUKSES!
  RETURN json_build_object(
    'success', true, 
    'matched', true, 
    'partner_id', v_partner_id
  );
END;
$$;

-- Grant akses ke service role
GRANT EXECUTE ON FUNCTION public.find_and_pair_partner(BIGINT) TO service_role;