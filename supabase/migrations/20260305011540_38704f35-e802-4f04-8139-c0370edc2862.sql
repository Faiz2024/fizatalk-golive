
-- Add blocked_until column for temporary bans
ALTER TABLE public.telegram_users 
ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ DEFAULT NULL;

-- Update submit_partner_report: premium users now accumulate penalty, temp ban at 100
CREATE OR REPLACE FUNCTION public.submit_partner_report(
  p_reporter_id BIGINT,
  p_reported_id BIGINT,
  p_report_type TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_penalty_change INTEGER;
  v_new_penalty INTEGER;
  v_already_reported BOOLEAN;
  v_reporter_penalty INTEGER;
  v_is_reported_premium BOOLEAN;
  v_last_partners BIGINT[];
  v_blocked_until TIMESTAMPTZ;
BEGIN
  -- 1. Cek apakah pengguna yang dilaporkan adalah user premium
  SELECT (premium_until IS NOT NULL AND premium_until > NOW()) INTO v_is_reported_premium
  FROM telegram_users
  WHERE id = p_reported_id;
  
  -- 2. Ambil poin penalti pelapor dan riwayat partner
  SELECT COALESCE(penalty_points, 0), last_partners INTO v_reporter_penalty, v_last_partners
  FROM telegram_users
  WHERE id = p_reporter_id;

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
  
  -- 6. Tentukan perubahan penalti - PREMIUM JUGA KENA PENALTI SEKARANG
  CASE p_report_type
    WHEN 'spam' THEN v_penalty_change := 10;
    WHEN 'sange' THEN v_penalty_change := 15;
    WHEN 'asik' THEN v_penalty_change := -3;
    ELSE RETURN json_build_object('success', false, 'error', 'invalid_report_type');
  END CASE;
  
  -- 7. Insert report
  INSERT INTO partner_reports (reporter_id, reported_id, report_type, penalty_change)
  VALUES (p_reporter_id, p_reported_id, p_report_type, v_penalty_change);
  
  -- 8. Update penalti
  UPDATE telegram_users
  SET penalty_points = GREATEST(0, COALESCE(penalty_points, 0) + v_penalty_change)
  WHERE id = p_reported_id
  RETURNING penalty_points INTO v_new_penalty;
  
  -- 9. Handle penalti >= 100
  IF v_new_penalty >= 100 THEN
    IF v_is_reported_premium THEN
      -- PREMIUM: Temp ban sampai 00:00 WIB berikutnya, reset poin
      v_blocked_until := ((NOW() AT TIME ZONE 'Asia/Jakarta')::DATE + INTERVAL '1 day') AT TIME ZONE 'Asia/Jakarta';
      
      UPDATE telegram_users
      SET penalty_points = 0,
          blocked_until = v_blocked_until
      WHERE id = p_reported_id;
      
      v_new_penalty := 0;
      
      RETURN json_build_object(
        'success', true,
        'penalty_change', v_penalty_change,
        'new_penalty', 0,
        'is_banned', false,
        'is_temp_banned', true,
        'blocked_until', v_blocked_until
      );
    ELSE
      -- NON-PREMIUM: Permanent block
      INSERT INTO blocked_users (user_id, reason, blocked_message, is_active)
      VALUES (p_reported_id, 'auto_penalty_100', 'Akun diblokir karena terlalu banyak laporan negatif dari pengguna lain.', true)
      ON CONFLICT DO NOTHING;
      
      RETURN json_build_object(
        'success', true,
        'penalty_change', v_penalty_change,
        'new_penalty', v_new_penalty,
        'is_banned', true,
        'is_temp_banned', false
      );
    END IF;
  END IF;
  
  RETURN json_build_object(
    'success', true, 
    'penalty_change', v_penalty_change,
    'new_penalty', v_new_penalty,
    'is_banned', false,
    'is_temp_banned', false
  );
END;
$$;

-- Update comprehensive_search_action to check blocked_until for premium users
-- We need to add a check at the beginning after blocked_users check
