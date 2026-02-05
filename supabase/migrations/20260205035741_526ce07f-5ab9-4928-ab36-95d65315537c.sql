-- =====================================================
-- RPC: process_gift_transaction (Atomik Gift Processing)
-- Menggabungkan: cek saldo, kurangi pengirim, tambah partner 75%, log transaksi
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_gift_transaction(
  p_sender_id BIGINT,
  p_gift_id TEXT,
  p_gift_name TEXT,
  p_gift_price BIGINT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_coins BIGINT;
  v_partner_id BIGINT;
  v_partner_state TEXT;
  v_sender_state TEXT;
  v_payout_amount BIGINT;
  v_new_sender_balance BIGINT;
  v_new_partner_balance BIGINT;
BEGIN
  -- 1. Ambil data sender: coins, state, partner_id
  SELECT coins, state, partner_id INTO v_sender_coins, v_sender_state, v_partner_id
  FROM telegram_users
  WHERE id = p_sender_id
  FOR UPDATE;
  
  -- 2. Validasi: Harus sedang chatting
  IF v_sender_state != 'chatting' OR v_partner_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'not_chatting',
      'message', 'Kamu tidak dalam chat aktif'
    );
  END IF;
  
  -- 3. Validasi: Saldo cukup
  IF v_sender_coins < p_gift_price THEN
    RETURN json_build_object(
      'success', false,
      'error', 'insufficient_balance',
      'current_coins', v_sender_coins,
      'required', p_gift_price
    );
  END IF;
  
  -- 4. Hitung payout (75%)
  v_payout_amount := FLOOR(p_gift_price * 0.75);
  v_new_sender_balance := v_sender_coins - p_gift_price;
  
  -- 5. Kurangi saldo pengirim
  UPDATE telegram_users 
  SET coins = v_new_sender_balance 
  WHERE id = p_sender_id;
  
  -- 6. Tambah saldo partner dan ambil saldo baru
  UPDATE telegram_users 
  SET coins = coins + v_payout_amount 
  WHERE id = v_partner_id
  RETURNING coins INTO v_new_partner_balance;
  
  -- 7. Insert log transaksi pengirim (dalam 1 statement)
  INSERT INTO coin_transactions (user_id, amount, type, description)
  VALUES 
    (p_sender_id, -p_gift_price, 'gift_sent', 'Kirim gift ' || p_gift_name),
    (v_partner_id, v_payout_amount, 'gift_received', 'Terima gift ' || p_gift_name);
  
  -- 8. Return success dengan data lengkap
  RETURN json_build_object(
    'success', true,
    'partner_id', v_partner_id,
    'gift_price', p_gift_price,
    'payout_amount', v_payout_amount,
    'new_sender_balance', v_new_sender_balance,
    'new_partner_balance', v_new_partner_balance
  );
END;
$$;

-- =====================================================
-- UPDATE: handle_end_chat_promo_logic 
-- Optimasi: Gunakan logika berbasis waktu untuk chat_end_count
-- Hanya update jika sudah > 2 jam sejak last update ATAU sudah dekati threshold
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_end_chat_promo_logic(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_is_premium BOOLEAN;
  v_should_send BOOLEAN := false;
  v_hours_since_last_active NUMERIC;
  v_current_count INT;
BEGIN
  -- Ambil data user
  SELECT premium_until, chat_end_count, last_active, last_promo_sent_at
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('should_send', false, 'reason', 'user_not_found');
  END IF;
  
  -- Cek apakah premium
  v_is_premium := v_user.premium_until IS NOT NULL 
                  AND v_user.premium_until > (NOW() AT TIME ZONE 'Asia/Jakarta');
  
  IF v_is_premium THEN
    RETURN json_build_object('should_send', false, 'reason', 'is_premium');
  END IF;
  
  -- Hitung jam sejak last_promo_sent
  v_hours_since_last_active := EXTRACT(EPOCH FROM (
    (NOW() AT TIME ZONE 'Asia/Jakarta') - COALESCE(v_user.last_promo_sent_at, '2000-01-01'::timestamptz)
  )) / 3600;
  
  -- OPTIMASI: Hanya increment chat_end_count jika sudah > 30 menit sejak promo terakhir
  -- Ini mengurangi write yang tidak perlu
  IF v_hours_since_last_active > 0.5 THEN
    v_current_count := COALESCE(v_user.chat_end_count, 0) + 1;
    
    -- Update count + last_promo_sent_at dalam 1 operasi
    UPDATE telegram_users 
    SET 
      chat_end_count = v_current_count,
      last_promo_sent_at = NOW() AT TIME ZONE 'Asia/Jakarta'
    WHERE id = p_user_id;
    
    -- Cek apakah harus kirim promo (setiap 3 chat end)
    IF v_current_count >= 3 THEN
      -- Reset count setelah kirim promo
      UPDATE telegram_users SET chat_end_count = 0 WHERE id = p_user_id;
      v_should_send := true;
    END IF;
  ELSE
    -- Tidak update, hanya cek kondisi promo
    v_current_count := COALESCE(v_user.chat_end_count, 0);
  END IF;
  
  RETURN json_build_object(
    'should_send', v_should_send,
    'chat_end_count', v_current_count,
    'hours_since_last', v_hours_since_last_active
  );
END;
$$;

-- =====================================================
-- UPDATE: comprehensive_search_action
-- Hapus duplikasi: sudah include upsert dan channel check di dalam RPC
-- Tambah optimasi untuk skip update jika data tidak berubah
-- =====================================================
CREATE OR REPLACE FUNCTION public.comprehensive_search_action(
  p_user_id BIGINT,
  p_username TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_is_next BOOLEAN DEFAULT false
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_blocked RECORD;
  v_old_partner_id BIGINT;
  v_partner RECORD;
  v_is_premium BOOLEAN;
  v_should_check_channel BOOLEAN := false;
  v_chat_ended BOOLEAN := false;
  v_old_partner_promo JSON := json_build_object('should_send', false);
  v_reputation JSON;
  v_penalty_points INT;
  v_rep_status TEXT := 'good';
  v_rep_message TEXT := NULL;
  v_is_new_user BOOLEAN := false;
  v_data_changed BOOLEAN := false;
BEGIN
  -- 1. UPSERT USER (OPTIMIZED - skip jika data sama)
  SELECT id, username, first_name, state, partner_id, gender, premium_until, penalty_points, created_at
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    -- User baru - insert
    INSERT INTO telegram_users (id, username, first_name, state, coins, penalty_points)
    VALUES (p_user_id, p_username, p_first_name, 'idle', 0, 0);
    v_is_new_user := true;
    v_should_check_channel := true;
    
    -- Re-fetch
    SELECT * INTO v_user FROM telegram_users WHERE id = p_user_id;
  ELSE
    -- User ada - cek apakah perlu update username/first_name
    -- OPTIMASI: Hanya update jika data berubah
    IF (v_user.username IS DISTINCT FROM p_username) OR (v_user.first_name IS DISTINCT FROM p_first_name) THEN
      UPDATE telegram_users 
      SET 
        username = COALESCE(p_username, username),
        first_name = COALESCE(p_first_name, first_name)
      WHERE id = p_user_id;
      v_data_changed := true;
    END IF;
    
    -- Cek apakah harus tampilkan channel join (registered > 7 hari)
    v_should_check_channel := (NOW() AT TIME ZONE 'Asia/Jakarta') - v_user.created_at > INTERVAL '7 days';
  END IF;
  
  -- 2. CEK BLOCKED (dari blocked_users table)
  SELECT blocked_message INTO v_blocked
  FROM blocked_users
  WHERE user_id = p_user_id AND is_active = true
  LIMIT 1;
  
  IF FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'user_blocked',
      'blocked_message', COALESCE(v_blocked.blocked_message, 'Akun Anda telah diblokir.')
    );
  END IF;
  
  -- 3. CEK REPUTASI (penalty points)
  v_penalty_points := COALESCE(v_user.penalty_points, 0);
  
  IF v_penalty_points >= 100 THEN
    -- BANNED
    RETURN json_build_object(
      'success', false,
      'error', 'user_banned',
      'reputation', json_build_object(
        'status', 'banned',
        'penalty_points', v_penalty_points,
        'message', 'Akun Anda telah diblokir karena terlalu banyak laporan negatif. Bayar denda Rp10.000 untuk membuka blokir.'
      )
    );
  ELSIF v_penalty_points >= 70 THEN
    v_rep_status := 'critical';
    v_rep_message := 'Akun Anda dalam kondisi KRITIS. Satu laporan lagi dapat mengakibatkan blokir permanen.';
  ELSIF v_penalty_points >= 40 THEN
    v_rep_status := 'warning';
    v_rep_message := 'Anda mendapat beberapa laporan negatif dari pengguna lain. Harap jaga etika dalam berinteraksi.';
  END IF;
  
  v_reputation := json_build_object(
    'status', v_rep_status,
    'penalty_points', v_penalty_points,
    'message', v_rep_message
  );
  
  -- 4. CEK GENDER
  IF v_user.gender IS NULL THEN
    RETURN json_build_object(
      'success', true,
      'action', 'needs_gender',
      'reputation', v_reputation
    );
  END IF;
  
  -- 5. HANDLE NEXT (akhiri chat lama dulu)
  IF p_is_next AND v_user.state = 'chatting' AND v_user.partner_id IS NOT NULL THEN
    v_old_partner_id := v_user.partner_id;
    v_chat_ended := true;
    
    -- Reset partner lama (hanya jika masih chatting dengan user ini)
    UPDATE telegram_users 
    SET state = 'idle', partner_id = NULL 
    WHERE id = v_old_partner_id AND partner_id = p_user_id;
    
    -- Hapus dari waiting queue (jika ada)
    DELETE FROM waiting_queue WHERE user_id = v_old_partner_id;
    
    -- Cek promo untuk partner lama (OPTIMIZED - inline)
    SELECT 
      CASE 
        WHEN premium_until IS NULL OR premium_until < (NOW() AT TIME ZONE 'Asia/Jakarta') THEN
          CASE WHEN COALESCE(chat_end_count, 0) >= 2 THEN true ELSE false END
        ELSE false
      END as should_send
    INTO v_old_partner_promo
    FROM telegram_users
    WHERE id = v_old_partner_id;
    
    v_old_partner_promo := json_build_object('should_send', COALESCE((v_old_partner_promo).should_send, false));
  END IF;
  
  -- 6. CEK STATE (setelah handle next)
  -- Re-fetch state terbaru
  SELECT state, partner_id INTO v_user.state, v_user.partner_id
  FROM telegram_users WHERE id = p_user_id;
  
  IF v_user.state = 'chatting' AND v_user.partner_id IS NOT NULL THEN
    RETURN json_build_object(
      'success', true,
      'action', 'already_chatting',
      'partner_id', v_user.partner_id,
      'reputation', v_reputation
    );
  END IF;
  
  IF v_user.state = 'waiting' THEN
    RETURN json_build_object(
      'success', true,
      'action', 'already_in_queue',
      'reputation', v_reputation
    );
  END IF;
  
  -- 7. CARI PARTNER (inline dari find_and_pair_partner)
  v_is_premium := v_user.premium_until IS NOT NULL 
                  AND v_user.premium_until > (NOW() AT TIME ZONE 'Asia/Jakarta');
  
  -- Cari partner yang cocok
  SELECT u.id, u.gender, u.location INTO v_partner
  FROM waiting_queue wq
  JOIN telegram_users u ON u.id = wq.user_id
  WHERE u.id != p_user_id
    AND u.gender IS NOT NULL
    -- Filter target gender (jika premium)
    AND (
      NOT v_is_premium 
      OR v_user.target_gender IS NULL 
      OR v_user.target_gender = 'semua' 
      OR u.gender = v_user.target_gender
    )
    -- Filter target location (jika premium)
    AND (
      NOT v_is_premium 
      OR v_user.target_location IS NULL 
      OR u.location = v_user.target_location
    )
  ORDER BY wq.joined_at ASC
  LIMIT 1
  FOR UPDATE OF wq SKIP LOCKED;
  
  IF FOUND THEN
    -- Partner ditemukan! Pair mereka
    -- Hapus partner dari queue
    DELETE FROM waiting_queue WHERE user_id = v_partner.id;
    
    -- Update kedua user
    UPDATE telegram_users 
    SET state = 'chatting', partner_id = v_partner.id 
    WHERE id = p_user_id;
    
    UPDATE telegram_users 
    SET state = 'chatting', partner_id = p_user_id 
    WHERE id = v_partner.id;
    
    RETURN json_build_object(
      'success', true,
      'matched', true,
      'partner_id', v_partner.id,
      'should_check_channel', v_should_check_channel,
      'is_new_user', v_is_new_user,
      'chat_ended', v_chat_ended,
      'old_partner_id', v_old_partner_id,
      'old_partner_promo', v_old_partner_promo,
      'reputation', v_reputation
    );
  ELSE
    -- Tidak ada partner, masukkan ke queue
    INSERT INTO waiting_queue (user_id, joined_at)
    VALUES (p_user_id, NOW() AT TIME ZONE 'Asia/Jakarta')
    ON CONFLICT (user_id) DO UPDATE SET joined_at = NOW() AT TIME ZONE 'Asia/Jakarta';
    
    UPDATE telegram_users SET state = 'waiting' WHERE id = p_user_id;
    
    RETURN json_build_object(
      'success', true,
      'matched', false,
      'should_check_channel', v_should_check_channel,
      'is_new_user', v_is_new_user,
      'chat_ended', v_chat_ended,
      'old_partner_id', v_old_partner_id,
      'old_partner_promo', v_old_partner_promo,
      'reputation', v_reputation
    );
  END IF;
END;
$$;