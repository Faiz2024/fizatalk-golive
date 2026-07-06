-- =====================================================
-- Migration: Update Premium Report and Promo
-- 1. Mencegah user premium mendapat penalti dan warning dari report.
-- 2. Mengubah batas chat end untuk promo menjadi 6 kali.
-- =====================================================

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
    penalty_points = CASE 
      WHEN v_is_reported_premium AND v_penalty_change > 0 THEN COALESCE(penalty_points, 0)
      ELSE GREATEST(0, COALESCE(penalty_points, 0) + v_penalty_change)
    END,
    unacknowledged_reports_count = CASE 
      WHEN v_is_reported_premium THEN unacknowledged_reports_count
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

-- =====================================================
-- UPDATE: handle_end_chat_promo_logic
-- Pembatasan frekuensi promo premium:
-- 1. Promo hanya dikirim maksimal 1x setiap 24 jam untuk user non-premium
-- 2. chat_end_count HANYA mulai bertambah setelah cooldown 24 jam terlewati
-- 3. Setelah cooldown selesai, user harus mengakhiri minimal 6 chat baru
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
  
  -- Cek apakah masa premium baru saja berakhir (kurang dari 24 jam yang lalu)
  IF v_user.premium_until IS NOT NULL THEN
    IF (NOW() AT TIME ZONE 'Asia/Jakarta') > v_user.premium_until AND 
       EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'Asia/Jakarta') - v_user.premium_until)) / 3600 < 24 THEN
      
      -- Reset chat_end_count ke 0 jika belum 0
      IF COALESCE(v_user.chat_end_count, 0) != 0 THEN
        UPDATE telegram_users SET chat_end_count = 0 WHERE id = p_user_id;
      END IF;
      
      RETURN json_build_object(
        'should_send', false, 
        'reason', 'premium_recently_expired_cooldown_24h',
        'chat_end_count', 0
      );
    END IF;
  END IF;

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
  
  -- Cek apakah sudah mencapai threshold (minimal 6 chat end setelah cooldown)
  IF v_current_count >= 6 THEN
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
