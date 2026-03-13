
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
  v_blocked_until TIMESTAMPTZ;
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
  
  UPDATE telegram_users
  SET penalty_points = GREATEST(0, COALESCE(penalty_points, 0) + v_penalty_change)
  WHERE id = p_reported_id
  RETURNING penalty_points INTO v_new_penalty;
  
  IF v_new_penalty >= 100 THEN
    IF v_is_reported_premium THEN
      -- Premium: temp ban until midnight WIB
      v_blocked_until := ((NOW() AT TIME ZONE 'Asia/Jakarta')::DATE + INTERVAL '1 day') AT TIME ZONE 'Asia/Jakarta';
      UPDATE telegram_users SET penalty_points = 0, blocked_until = v_blocked_until WHERE id = p_reported_id;
      v_new_penalty := 0;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', 0, 'is_banned', false, 'is_temp_banned', true, 'is_premium_ban', true, 'blocked_until', v_blocked_until);
    ELSE
      -- Non-premium: temp ban 1 month via blocked_until (no more permanent block)
      v_blocked_until := NOW() + INTERVAL '30 days';
      UPDATE telegram_users SET penalty_points = 0, blocked_until = v_blocked_until WHERE id = p_reported_id;
      v_new_penalty := 0;
      RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', 0, 'is_banned', false, 'is_temp_banned', true, 'is_premium_ban', false, 'blocked_until', v_blocked_until);
    END IF;
  END IF;
  
  RETURN json_build_object('success', true, 'penalty_change', v_penalty_change, 'new_penalty', v_new_penalty, 'is_banned', false, 'is_temp_banned', false);
END;
$function$;
