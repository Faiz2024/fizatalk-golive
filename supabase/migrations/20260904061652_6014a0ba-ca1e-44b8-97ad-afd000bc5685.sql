-- 1. Kolom baru untuk sistem shadowban
ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS negative_reports_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_negative_report_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reports_decay_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shadowban_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_telegram_users_shadowban
  ON public.telegram_users (shadowban_until)
  WHERE shadowban_until IS NOT NULL;

-- 2. Peluruhan lazy: -1 tiap 3 jam, hanya jika 12 jam tanpa laporan baru
CREATE OR REPLACE FUNCTION public.decay_negative_reports(p_user_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
  v_last TIMESTAMPTZ;
  v_decay_from TIMESTAMPTZ;
  v_steps INTEGER;
  v_new_count INTEGER;
BEGIN
  SELECT COALESCE(negative_reports_count, 0), last_negative_report_at, reports_decay_at
  INTO v_count, v_last, v_decay_from
  FROM telegram_users WHERE id = p_user_id;

  IF v_count IS NULL OR v_count <= 0 OR v_last IS NULL THEN
    RETURN COALESCE(v_count, 0);
  END IF;

  -- Peluruhan hanya berjalan setelah 12 jam tanpa laporan baru
  IF NOW() - v_last < INTERVAL '12 hours' THEN
    RETURN v_count;
  END IF;

  v_decay_from := GREATEST(COALESCE(v_decay_from, v_last), v_last + INTERVAL '12 hours');
  v_steps := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_decay_from)) / 10800)::INTEGER;

  IF v_steps <= 0 THEN
    RETURN v_count;
  END IF;

  v_new_count := GREATEST(0, v_count - v_steps);

  IF v_new_count = v_count THEN
    RETURN v_count;
  END IF;

  UPDATE telegram_users
  SET negative_reports_count = v_new_count,
      reports_decay_at = v_decay_from + (v_steps * INTERVAL '3 hours')
  WHERE id = p_user_id;

  RETURN v_new_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.decay_negative_reports(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decay_negative_reports(BIGINT) TO service_role;

-- 3. submit_partner_report: tambah hitungan laporan negatif + shadowban 3 hari
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
  v_neg_count INTEGER := 0;
  v_shadowban_until TIMESTAMPTZ;
  v_is_shadowbanned BOOLEAN := FALSE;
BEGIN
  SELECT (premium_until IS NOT NULL AND premium_until > NOW()) INTO v_is_reported_premium
  FROM telegram_users WHERE id = p_reported_id;

  SELECT COALESCE(penalty_points, 0), last_partners INTO v_reporter_penalty, v_last_partners
  FROM telegram_users WHERE id = p_reporter_id;

  IF p_report_type IN ('spam', 'sange') THEN
    IF v_last_partners IS NULL OR NOT (p_reported_id = ANY(v_last_partners[1:2])) THEN
      RETURN json_build_object('success', false, 'error', 'partner_not_recent');
    END IF;
  END IF;

  IF v_reporter_penalty > 40 AND p_report_type IN ('spam', 'sange') THEN
    RETURN json_build_object('success', false, 'error', 'reputation_too_low');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM partner_reports
    WHERE reporter_id = p_reporter_id AND reported_id = p_reported_id
      AND created_at > NOW() - INTERVAL '1 hour'
  ) INTO v_already_reported;

  IF v_already_reported THEN
    RETURN json_build_object('success', false, 'error', 'already_reported');
  END IF;

  CASE p_report_type
    WHEN 'spam' THEN v_penalty_change := 10;
    WHEN 'sange' THEN v_penalty_change := 15;
    WHEN 'baik' THEN v_penalty_change := -3;
    WHEN 'asik' THEN v_penalty_change := -5;
    ELSE RETURN json_build_object('success', false, 'error', 'invalid_report_type');
  END CASE;

  INSERT INTO partner_reports (reporter_id, reported_id, report_type, penalty_change)
  VALUES (p_reporter_id, p_reported_id, p_report_type, v_penalty_change);

  SELECT COALESCE(penalty_points, 0) INTO v_old_penalty FROM telegram_users WHERE id = p_reported_id;

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

  -- === SHADOWBAN: berlaku untuk SEMUA user (premium & non-premium) ===
  IF p_report_type IN ('spam', 'sange') THEN
    -- Peluruhan lazy dulu, lalu tambah 1
    PERFORM public.decay_negative_reports(p_reported_id);

    UPDATE telegram_users
    SET negative_reports_count = COALESCE(negative_reports_count, 0) + 1,
        last_negative_report_at = NOW(),
        reports_decay_at = NULL
    WHERE id = p_reported_id
    RETURNING COALESCE(negative_reports_count, 0), shadowban_until
    INTO v_neg_count, v_shadowban_until;

    IF v_neg_count >= 4 AND (v_shadowban_until IS NULL OR v_shadowban_until <= NOW()) THEN
      UPDATE telegram_users
      SET shadowban_until = NOW() + INTERVAL '3 days'
      WHERE id = p_reported_id;
      v_is_shadowbanned := TRUE;
    ELSIF v_shadowban_until IS NOT NULL AND v_shadowban_until > NOW() THEN
      v_is_shadowbanned := TRUE;
    END IF;
  END IF;

  IF v_new_penalty >= 100 THEN
    IF v_is_reported_premium THEN
      UPDATE telegram_users SET penalty_points = 0 WHERE id = p_reported_id;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', 0, 'is_banned', false, 'is_temp_banned', false, 'is_shadowbanned', v_is_shadowbanned, 'negative_reports_count', v_neg_count);
    ELSE
      INSERT INTO blocked_users (user_id, reason, blocked_message, is_active)
      VALUES (p_reported_id, 'auto_penalty_100', 'Akun diblokir karena terlalu banyak laporan negatif dari pengguna lain.', true)
      ON CONFLICT DO NOTHING;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', true, 'is_temp_banned', false, 'is_shadowbanned', v_is_shadowbanned, 'negative_reports_count', v_neg_count);
    END IF;
  END IF;

  RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', false, 'is_temp_banned', false, 'is_shadowbanned', v_is_shadowbanned, 'negative_reports_count', v_neg_count);
END;
$function$;