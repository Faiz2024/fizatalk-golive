-- =====================================================
-- UPDATE: handle_end_chat_promo_logic
-- Pembatasan frekuensi promo premium:
-- 1. Promo hanya dikirim maksimal 1x setiap 24 jam untuk user non-premium
-- 2. chat_end_count HANYA mulai bertambah setelah cooldown 24 jam terlewati
-- 3. Setelah cooldown selesai, user harus mengakhiri minimal 3 chat baru
--    sebelum mendapat promo berikutnya
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
  v_hours_since_last_promo NUMERIC;
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
  
  -- Cek apakah premium (user premium tidak mendapat promo)
  v_is_premium := v_user.premium_until IS NOT NULL 
                  AND v_user.premium_until > (NOW() AT TIME ZONE 'Asia/Jakarta');
  
  IF v_is_premium THEN
    RETURN json_build_object('should_send', false, 'reason', 'is_premium');
  END IF;
  
  -- Hitung jam sejak promo terakhir dikirim
  v_hours_since_last_promo := EXTRACT(EPOCH FROM (
    (NOW() AT TIME ZONE 'Asia/Jakarta') - COALESCE(v_user.last_promo_sent_at, '2000-01-01'::timestamptz)
  )) / 3600;
  
  -- ============================================
  -- ATURAN BARU: COOLDOWN 24 JAM
  -- ============================================
  -- Jika masih dalam cooldown 24 jam sejak promo terakhir:
  -- - chat_end_count dipaksa tetap 0 (tidak diakumulasikan)
  -- - Langsung return should_send = false
  IF v_hours_since_last_promo < 24 THEN
    -- Reset chat_end_count ke 0 jika belum 0 (membersihkan sisa dari sesi sebelumnya)
    IF COALESCE(v_user.chat_end_count, 0) != 0 THEN
      UPDATE telegram_users SET chat_end_count = 0 WHERE id = p_user_id;
    END IF;
    
    RETURN json_build_object(
      'should_send', false, 
      'reason', 'promo_cooldown_24h',
      'chat_end_count', 0,
      'hours_since_last', v_hours_since_last_promo
    );
  END IF;
  
  -- ============================================
  -- SETELAH COOLDOWN 24 JAM TERLEWATI
  -- ============================================
  -- Increment chat_end_count (akumulasi chat end baru setelah cooldown selesai)
  v_current_count := COALESCE(v_user.chat_end_count, 0) + 1;
  
  -- Update chat_end_count di database
  UPDATE telegram_users 
  SET chat_end_count = v_current_count
  WHERE id = p_user_id;
  
  -- Cek apakah sudah mencapai threshold (minimal 3 chat end setelah cooldown)
  IF v_current_count >= 3 THEN
    -- Reset count dan update last_promo_sent_at (memulai cooldown 24 jam baru)
    UPDATE telegram_users 
    SET 
      chat_end_count = 0,
      last_promo_sent_at = NOW() AT TIME ZONE 'Asia/Jakarta'
    WHERE id = p_user_id;
    
    v_should_send := true;
  END IF;
  
  RETURN json_build_object(
    'should_send', v_should_send,
    'chat_end_count', v_current_count,
    'hours_since_last', v_hours_since_last_promo
  );
END;
$$;
