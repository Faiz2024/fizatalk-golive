-- Add submitter_ids array to sticker_packs
ALTER TABLE public.sticker_packs 
ADD COLUMN IF NOT EXISTS submitter_ids BIGINT[] DEFAULT '{}'::BIGINT[];

UPDATE public.sticker_packs 
SET submitter_ids = ARRAY[requester_id] 
WHERE submitter_ids = '{}'::BIGINT[] AND requester_id IS NOT NULL;

-- Fix submit_partner_report UPSERT
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
    penalty_points = GREATEST(0, COALESCE(penalty_points, 0) + v_penalty_change),
    unacknowledged_reports_count = CASE 
      WHEN v_old_penalty < 40 AND v_penalty_change > 0 THEN COALESCE(unacknowledged_reports_count, 0) + 1
      ELSE unacknowledged_reports_count
    END
  WHERE id = p_reported_id
  RETURNING penalty_points INTO v_new_penalty;
  
  IF v_new_penalty >= 100 THEN
    IF v_is_reported_premium THEN
      UPDATE telegram_users SET penalty_points = 0 WHERE id = p_reported_id;
      v_new_penalty := 0;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', 0, 'is_banned', false, 'is_temp_banned', false);
    ELSE
      INSERT INTO blocked_users (user_id, reason, blocked_message, is_active)
      VALUES (p_reported_id, 'auto_penalty_100', 'Akun diblokir karena terlalu banyak laporan negatif dari pengguna lain.', true)
      ON CONFLICT (user_id) DO UPDATE SET is_active = true, blocked_at = NOW(), unblocked_at = NULL, reason = EXCLUDED.reason, blocked_message = EXCLUDED.blocked_message;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', true, 'is_temp_banned', false);
    END IF;
  END IF;
  
  RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', false, 'is_temp_banned', false);
END;
$function$;

-- Fix admin_process_media_report UPSERT
CREATE OR REPLACE FUNCTION public.admin_process_media_report(p_sender_id bigint, p_action text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_premium BOOLEAN;
  v_warnings INTEGER;
  v_warning_until TIMESTAMP WITH TIME ZONE;
  v_new_warning_until TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT 
    (premium_until IS NOT NULL AND premium_until > NOW()),
    spam_warnings,
    spam_warning_until
  INTO 
    v_is_premium,
    v_warnings,
    v_warning_until
  FROM telegram_users 
  WHERE id = p_sender_id;
  
  IF v_is_premium THEN
    RETURN json_build_object('success', false, 'error', 'user_is_premium');
  END IF;

  IF v_warning_until IS NOT NULL AND NOW() > v_warning_until THEN
    v_warnings := 0;
  END IF;
  
  v_warnings := COALESCE(v_warnings, 0);

  IF p_action = 'warn' THEN
    v_warnings := v_warnings + 1;
  ELSIF p_action = 'block' THEN
    v_warnings := 4;
  END IF;

  v_new_warning_until := NOW() + INTERVAL '30 days';

  IF v_warnings >= 4 THEN
    INSERT INTO blocked_users (user_id, reason, blocked_message, is_active)
    VALUES (p_sender_id, 'admin_media_block', 'Akun diblokir oleh Admin karena pelanggaran peringatan (4/4) akibat mengirim media terlarang.', true)
    ON CONFLICT (user_id) DO UPDATE SET is_active = true, blocked_at = NOW(), unblocked_at = NULL, reason = EXCLUDED.reason, blocked_message = EXCLUDED.blocked_message;
    
    UPDATE telegram_users 
    SET 
        spam_warnings = 4,
        spam_warning_until = v_new_warning_until,
        penalty_points = 100 
    WHERE id = p_sender_id;
    
    RETURN json_build_object('success', true, 'action', 'blocked', 'warnings', 4);
  ELSE
    UPDATE telegram_users 
    SET 
        spam_warnings = v_warnings,
        spam_warning_until = v_new_warning_until,
        penalty_points = COALESCE(penalty_points, 0) + 15
    WHERE id = p_sender_id;
    
    RETURN json_build_object('success', true, 'action', 'warned', 'warnings', v_warnings);
  END IF;
  
  RETURN json_build_object('success', false, 'error', 'invalid_action');
END;
$function$;