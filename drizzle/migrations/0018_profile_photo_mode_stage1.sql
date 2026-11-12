ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS profile_photo_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_match_daily_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS photo_match_daily_date date;

CREATE OR REPLACE FUNCTION public.toggle_profile_photo_mode(p_user_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE u RECORD; v_today date := (NOW() AT TIME ZONE 'Asia/Jakarta')::date; v_prem boolean;
BEGIN
  SELECT profile_photo_file_id, is_face_verified, verification_status, profile_photo_enabled,
         premium_until, photo_match_daily_count, photo_match_daily_date
    INTO u FROM telegram_users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF u.profile_photo_enabled THEN
    UPDATE telegram_users SET profile_photo_enabled=false WHERE id=p_user_id;
    RETURN jsonb_build_object('success',true,'action','disabled','enabled',false);
  END IF;
  IF u.profile_photo_file_id IS NULL THEN
    RETURN jsonb_build_object('success',true,'action','need_photo','enabled',false);
  END IF;
  IF NOT u.is_face_verified THEN
    RETURN jsonb_build_object('success',true,'action',
      CASE WHEN u.verification_status='pending' THEN 'pending_review'
           WHEN u.verification_status='rejected' THEN 'rejected'
           ELSE 'need_video' END,'enabled',false);
  END IF;
  v_prem := u.premium_until IS NOT NULL AND u.premium_until > NOW();
  IF NOT v_prem AND u.photo_match_daily_date = v_today AND u.photo_match_daily_count >= 50 THEN
    RETURN jsonb_build_object('success',true,'action','quota_exceeded','enabled',false);
  END IF;
  UPDATE telegram_users SET profile_photo_enabled=true WHERE id=p_user_id;
  RETURN jsonb_build_object('success',true,'action','enabled','enabled',true);
END $fn$;
REVOKE ALL ON FUNCTION public.toggle_profile_photo_mode(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_profile_photo_mode(bigint) TO service_role;

DO $do$
DECLARE d text; n int;
BEGIN
  d := pg_get_functiondef('public.comprehensive_search_action(bigint,text,text,boolean,bigint)'::regprocedure);
  IF position('v_photo_on' in d) > 0 THEN RETURN; END IF;
  d := replace(d, E'  v_show_tos_notice BOOLEAN := FALSE;\nBEGIN',
    E'  v_show_tos_notice BOOLEAN := FALSE;\n  v_photo_on BOOLEAN := FALSE;\n  v_photo_count INT := 0;\n  v_today DATE := (NOW() AT TIME ZONE ''Asia/Jakarta'')::date;\nBEGIN');
  d := replace(d, '  -- 8. CARI PARTNER (LOGIKA MATCHING)', $b$  -- 7b. MODE FOTO PROFIL (batas harian WIB untuk non-Premium)
  SELECT COALESCE(profile_photo_enabled,false) AND is_face_verified AND profile_photo_file_id IS NOT NULL,
         CASE WHEN photo_match_daily_date = v_today THEN photo_match_daily_count ELSE 0 END
    INTO v_photo_on, v_photo_count FROM telegram_users WHERE id = p_user_id;
  IF NOT v_photo_on THEN
    UPDATE telegram_users SET profile_photo_enabled=false WHERE id=p_user_id AND profile_photo_enabled;
  END IF;
  IF v_photo_on AND NOT v_is_premium AND v_photo_count >= 50 THEN
    UPDATE telegram_users SET profile_photo_enabled=false, state='idle' WHERE id=p_user_id;
    DELETE FROM waiting_queue WHERE user_id=p_user_id;
    RETURN json_build_object('success',true,'matched',false,'action','photo_quota_exceeded',
      'chat_ended',v_chat_ended,'old_partner_id',v_old_partner_id,'old_partner_promo',v_old_partner_promo,
      'should_check_channel',v_should_check_channel,'show_tos_notice',v_show_tos_notice,
      'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;

  -- 8. CARI PARTNER (LOGIKA MATCHING)$b$);
  d := replace(d, E'      tu.last_partners as candidate_last_partners\n',
    E'      tu.last_partners as candidate_last_partners,\n      (COALESCE(tu.profile_photo_enabled,false) AND tu.is_face_verified AND tu.profile_photo_file_id IS NOT NULL) as candidate_photo_on\n');
  d := replace(d, E'    v_candidate_is_premium := v_candidate.candidate_premium_until',
    E'    IF v_candidate.candidate_photo_on IS DISTINCT FROM v_photo_on THEN\n        CONTINUE;\n    END IF;\n\n    v_candidate_is_premium := v_candidate.candidate_premium_until');
  d := replace(d, E'    DELETE FROM waiting_queue WHERE user_id = v_partner_id;\n', $b$    DELETE FROM waiting_queue WHERE user_id = v_partner_id;

    IF v_photo_on THEN
      UPDATE telegram_users
      SET photo_match_daily_count = CASE WHEN photo_match_daily_date = v_today THEN photo_match_daily_count + 1 ELSE 1 END,
          photo_match_daily_date = v_today
      WHERE id IN (p_user_id, v_partner_id) AND (premium_until IS NULL OR premium_until <= NOW());
    END IF;
$b$);
  SELECT count(*) INTO n FROM regexp_matches(d, 'v_photo_on|candidate_photo_on|photo_match_daily_count \+ 1', 'g');
  IF n < 7 THEN RAISE EXCEPTION 'comprehensive_search_action patch incomplete (%)', n; END IF;
  EXECUTE d;
END $do$;