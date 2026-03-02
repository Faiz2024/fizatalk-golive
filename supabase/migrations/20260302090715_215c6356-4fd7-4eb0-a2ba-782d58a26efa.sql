
-- Tambah kolom untuk melacak penggunaan filter harian (gratis 10x/hari)
ALTER TABLE public.telegram_users
ADD COLUMN IF NOT EXISTS filter_uses_today integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS filter_uses_date date NOT NULL DEFAULT CURRENT_DATE;

-- RPC untuk cek dan increment filter usage (reset otomatis jika hari baru berdasarkan WIB)
CREATE OR REPLACE FUNCTION public.check_and_use_filter(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_premium_until TIMESTAMPTZ;
  v_filter_uses INTEGER;
  v_filter_date DATE;
  v_today_wib DATE;
  v_target_gender TEXT;
  v_target_location TEXT;
BEGIN
  -- Hitung tanggal hari ini di WIB (UTC+7)
  v_today_wib := (NOW() AT TIME ZONE 'Asia/Jakarta')::DATE;

  SELECT premium_until, filter_uses_today, filter_uses_date, target_gender, target_location
  INTO v_premium_until, v_filter_uses, v_filter_date, v_target_gender, v_target_location
  FROM telegram_users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;

  -- Premium user = unlimited
  IF v_premium_until IS NOT NULL AND v_premium_until > NOW() THEN
    RETURN json_build_object('success', TRUE, 'allowed', TRUE, 'is_premium', TRUE, 'remaining', -1,
      'target_gender', v_target_gender, 'target_location', v_target_location);
  END IF;

  -- Reset jika hari baru (WIB)
  IF v_filter_date < v_today_wib THEN
    v_filter_uses := 0;
    UPDATE telegram_users SET filter_uses_today = 0, filter_uses_date = v_today_wib WHERE id = p_user_id;
  END IF;

  -- Cek limit
  IF v_filter_uses >= 10 THEN
    RETURN json_build_object('success', TRUE, 'allowed', FALSE, 'is_premium', FALSE, 'remaining', 0,
      'target_gender', v_target_gender, 'target_location', v_target_location);
  END IF;

  -- Increment usage
  UPDATE telegram_users 
  SET filter_uses_today = v_filter_uses + 1,
      filter_uses_date = v_today_wib
  WHERE id = p_user_id;

  RETURN json_build_object('success', TRUE, 'allowed', TRUE, 'is_premium', FALSE, 'remaining', 9 - v_filter_uses,
    'target_gender', v_target_gender, 'target_location', v_target_location);
END;
$function$;
