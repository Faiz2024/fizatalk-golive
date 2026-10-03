
-- 1. Kolom baru
ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS clean_days_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_penalty_decay_at timestamptz;

ALTER TABLE public.partner_reports DROP CONSTRAINT IF EXISTS partner_reports_report_type_check;
ALTER TABLE public.partner_reports ADD CONSTRAINT partner_reports_report_type_check
  CHECK (report_type = ANY (ARRAY['spam','sange','baik','asik','link_spam','media_sange','media_spam']));

-- 2. Catat waktu match otomatis (semua jalur pairing, termasuk reconnect)
CREATE OR REPLACE FUNCTION public.set_matched_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.partner_id IS NOT NULL AND NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
    NEW.matched_at := NOW();
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_set_matched_at ON public.telegram_users;
CREATE TRIGGER trg_set_matched_at BEFORE UPDATE OF partner_id ON public.telegram_users
FOR EACH ROW EXECUTE FUNCTION public.set_matched_at();

-- 3. Pembersihan total saat blokir dicabut (otomatis 15 hari, denda, premium, CS)
CREATE OR REPLACE FUNCTION public.clear_sanctions_on_unblock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE THEN
    UPDATE telegram_users SET
      penalty_points = 0, spam_warnings = 0, spam_warning_until = NULL,
      unacknowledged_reports_count = 0, negative_reports_count = 0,
      last_negative_report_at = NULL, reports_decay_at = NULL,
      shadowban_until = NULL, clean_days_streak = 0
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_clear_sanctions_on_unblock ON public.blocked_users;
CREATE TRIGGER trg_clear_sanctions_on_unblock AFTER UPDATE OF is_active ON public.blocked_users
FOR EACH ROW EXECUTE FUNCTION public.clear_sanctions_on_unblock();
REVOKE EXECUTE ON FUNCTION public.clear_sanctions_on_unblock() FROM PUBLIC, anon, authenticated;

-- Variabel lokal shadowban ikut bersih pada pencarian yang membuka blokir
DO $do$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.comprehensive_search_action'::regproc);
  v_def := replace(v_def,
    'v_is_blocked := FALSE; v_user.penalty_points := 0; v_user.unacknowledged_reports_count := 0;',
    'v_is_blocked := FALSE; v_user.penalty_points := 0; v_user.unacknowledged_reports_count := 0; v_am_shadowbanned := FALSE; v_shadowban_until := NULL;');
  EXECUTE v_def;
END $do$;

-- 4. Laporan partner: silent lock 1x per partner per sesi, penalti cerdas link_spam
CREATE OR REPLACE FUNCTION public.submit_partner_report(p_reporter_id bigint, p_reported_id bigint, p_report_type text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_penalty_change INTEGER;
  v_new_penalty INTEGER;
  v_reporter_penalty INTEGER;
  v_is_reported_premium BOOLEAN;
  v_last_partners BIGINT[];
  v_reporter_partner BIGINT;
  v_matched_at TIMESTAMPTZ;
  v_old_penalty INTEGER;
  v_neg_count INTEGER := 0;
  v_shadowban_until TIMESTAMPTZ;
  v_is_shadowbanned BOOLEAN := FALSE;
  v_is_negative BOOLEAN := p_report_type IN ('spam','sange','link_spam','media_sange','media_spam');
BEGIN
  IF p_report_type NOT IN ('spam','sange','link_spam','media_sange','media_spam','baik','asik') THEN
    RETURN json_build_object('success', false, 'error', 'invalid_report_type');
  END IF;

  SELECT (premium_until IS NOT NULL AND premium_until > NOW()) INTO v_is_reported_premium
  FROM telegram_users WHERE id = p_reported_id;

  SELECT COALESCE(penalty_points, 0), last_partners, partner_id, matched_at
  INTO v_reporter_penalty, v_last_partners, v_reporter_partner, v_matched_at
  FROM telegram_users WHERE id = p_reporter_id;

  IF v_is_negative THEN
    IF v_reporter_partner IS DISTINCT FROM p_reported_id
       AND (v_last_partners IS NULL OR NOT (p_reported_id = ANY(v_last_partners[1:2]))) THEN
      RETURN json_build_object('success', false, 'error', 'partner_not_recent');
    END IF;
    IF v_reporter_penalty > 40 THEN
      RETURN json_build_object('success', false, 'error', 'reputation_too_low');
    END IF;
    -- Silent lock: 1 laporan negatif efektif per partner per sesi (penalti & hitungan 12 jam)
    IF EXISTS (
      SELECT 1 FROM partner_reports
      WHERE reporter_id = p_reporter_id AND reported_id = p_reported_id
        AND report_type IN ('spam','sange','link_spam','media_sange','media_spam')
        AND created_at > LEAST(COALESCE(v_matched_at, NOW()), NOW() - INTERVAL '1 hour') - INTERVAL '5 seconds'
    ) THEN
      RETURN json_build_object('success', true, 'silent', true, 'penalty_change', 0, 'is_banned', false);
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM partner_reports
      WHERE reporter_id = p_reporter_id AND reported_id = p_reported_id
        AND created_at > NOW() - INTERVAL '1 hour'
    ) THEN
      RETURN json_build_object('success', false, 'error', 'already_reported');
    END IF;
  END IF;

  -- Hitungan 12 jam (semua jenis laporan negatif)
  IF v_is_negative THEN
    PERFORM public.decay_negative_reports(p_reported_id);
    UPDATE telegram_users
    SET negative_reports_count = COALESCE(negative_reports_count, 0) + 1,
        last_negative_report_at = NOW(), reports_decay_at = NULL, clean_days_streak = 0
    WHERE id = p_reported_id
    RETURNING COALESCE(negative_reports_count, 0), shadowban_until INTO v_neg_count, v_shadowban_until;

    IF v_neg_count >= 4 AND (v_shadowban_until IS NULL OR v_shadowban_until <= NOW()) THEN
      UPDATE telegram_users SET shadowban_until = NOW() + INTERVAL '3 days' WHERE id = p_reported_id;
      v_is_shadowbanned := TRUE;
    ELSIF v_shadowban_until IS NOT NULL AND v_shadowban_until > NOW() THEN
      v_is_shadowbanned := TRUE;
    END IF;
  END IF;

  v_penalty_change := CASE p_report_type
    WHEN 'spam' THEN 10
    WHEN 'sange' THEN 15
    WHEN 'media_spam' THEN 10
    WHEN 'media_sange' THEN 15
    WHEN 'link_spam' THEN CASE WHEN v_neg_count <= 1 THEN 10 WHEN v_neg_count = 2 THEN 15 WHEN v_neg_count = 3 THEN 20 ELSE 25 END
    WHEN 'baik' THEN -3
    WHEN 'asik' THEN -5
  END;

  INSERT INTO partner_reports (reporter_id, reported_id, report_type, penalty_change)
  VALUES (p_reporter_id, p_reported_id, p_report_type, v_penalty_change);

  SELECT COALESCE(penalty_points, 0) INTO v_old_penalty FROM telegram_users WHERE id = p_reported_id;

  UPDATE telegram_users
  SET penalty_points = CASE
        WHEN v_is_reported_premium AND v_penalty_change > 0 THEN COALESCE(penalty_points, 0)
        ELSE GREATEST(0, COALESCE(penalty_points, 0) + v_penalty_change) END,
      unacknowledged_reports_count = CASE
        WHEN v_is_reported_premium THEN unacknowledged_reports_count
        WHEN v_old_penalty < 40 AND v_penalty_change > 0 THEN COALESCE(unacknowledged_reports_count, 0) + 1
        ELSE unacknowledged_reports_count END
  WHERE id = p_reported_id
  RETURNING penalty_points INTO v_new_penalty;

  IF v_new_penalty >= 100 THEN
    IF v_is_reported_premium THEN
      UPDATE telegram_users SET penalty_points = 0 WHERE id = p_reported_id;
      v_new_penalty := 0;
    ELSE
      INSERT INTO blocked_users (user_id, reason, blocked_message, is_active, blocked_at)
      VALUES (p_reported_id, 'auto_penalty_100', 'Akun diblokir karena terlalu banyak laporan negatif dari pengguna lain.', true, NOW())
      ON CONFLICT (user_id) DO UPDATE SET is_active = true, blocked_at = NOW(), unblocked_at = NULL,
        reason = EXCLUDED.reason, blocked_message = EXCLUDED.blocked_message;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', true, 'is_temp_banned', false, 'is_shadowbanned', v_is_shadowbanned, 'negative_reports_count', v_neg_count);
    END IF;
  END IF;

  RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', false, 'is_temp_banned', false, 'is_shadowbanned', v_is_shadowbanned, 'negative_reports_count', v_neg_count);
END;
$function$;

-- 5. Peringatan admin media: tanpa poin
CREATE OR REPLACE FUNCTION public.admin_process_media_report(p_sender_id bigint, p_action text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_is_premium BOOLEAN;
BEGIN
  SELECT (premium_until IS NOT NULL AND premium_until > NOW()) INTO v_is_premium
  FROM telegram_users WHERE id = p_sender_id;
  IF v_is_premium THEN
    RETURN json_build_object('success', false, 'error', 'user_is_premium');
  END IF;
  IF p_action = 'warn' THEN
    RETURN json_build_object('success', true, 'action', 'warned');
  ELSIF p_action = 'block' THEN
    INSERT INTO blocked_users (user_id, reason, blocked_message, is_active, blocked_at)
    VALUES (p_sender_id, 'admin_media_block', 'Akun diblokir oleh Admin karena mengirim media terlarang.', true, NOW())
    ON CONFLICT (user_id) DO UPDATE SET is_active = true, blocked_at = NOW(), unblocked_at = NULL, reason = EXCLUDED.reason, blocked_message = EXCLUDED.blocked_message;
    UPDATE telegram_users SET penalty_points = 100 WHERE id = p_sender_id;
    RETURN json_build_object('success', true, 'action', 'blocked');
  END IF;
  RETURN json_build_object('success', false, 'error', 'invalid_action');
END;
$function$;

-- 6. Pengurangan penalti harian progresif (10, 20, 30, ...)
CREATE OR REPLACE FUNCTION public.apply_daily_penalty_decay()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_updated_count INTEGER;
BEGIN
  UPDATE telegram_users SET
    clean_days_streak = CASE
      WHEN last_negative_report_at IS NOT NULL AND last_negative_report_at > NOW() - INTERVAL '24 hours' THEN 0
      ELSE COALESCE(clean_days_streak, 0) + 1 END,
    penalty_points = CASE
      WHEN last_negative_report_at IS NOT NULL AND last_negative_report_at > NOW() - INTERVAL '24 hours' THEN penalty_points
      ELSE GREATEST(0, penalty_points - 10 * (COALESCE(clean_days_streak, 0) + 1)) END,
    last_penalty_decay_at = NOW()
  WHERE penalty_points > 0;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  UPDATE telegram_users SET clean_days_streak = 0
  WHERE penalty_points = 0 AND clean_days_streak <> 0;

  RETURN v_updated_count;
END;
$function$;
