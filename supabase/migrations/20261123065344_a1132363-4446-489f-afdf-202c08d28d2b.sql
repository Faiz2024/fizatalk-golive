ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS photo_auto_disabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.toggle_profile_photo_mode(p_user_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE u RECORD; v_today date := (NOW() AT TIME ZONE 'Asia/Jakarta')::date; v_prem boolean;
BEGIN
  SELECT profile_photo_file_id, is_face_verified, verification_status, profile_photo_enabled,
         premium_until, photo_match_daily_count, photo_match_daily_date
    INTO u FROM telegram_users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF u.profile_photo_enabled THEN
    UPDATE telegram_users SET profile_photo_enabled=false, photo_auto_disabled=false WHERE id=p_user_id;
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
  UPDATE telegram_users SET profile_photo_enabled=true, photo_auto_disabled=false WHERE id=p_user_id;
  RETURN jsonb_build_object('success',true,'action','enabled','enabled',true);
END $fn$;
REVOKE ALL ON FUNCTION public.toggle_profile_photo_mode(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_profile_photo_mode(bigint) TO service_role;

DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.comprehensive_search_action(bigint,text,text,boolean,bigint)'::regprocedure);
  d := regexp_replace(d, 'IF v_candidate\.candidate_photo_on IS DISTINCT FROM v_photo_on THEN\s*CONTINUE;\s*END IF;', '');
  d := replace(d, 'UPDATE telegram_users SET profile_photo_enabled=false, state=''idle'' WHERE id=p_user_id;',
    'UPDATE telegram_users SET profile_photo_enabled=false, photo_auto_disabled=true, state=''idle'' WHERE id=p_user_id;');
  d := replace(d, '  -- 7b. MODE FOTO PROFIL', '  -- 7a. Aktif kembali otomatis setelah reset harian WIB (hanya bila dinonaktifkan oleh batas 50)
  UPDATE telegram_users SET profile_photo_enabled=true, photo_auto_disabled=false
   WHERE id=p_user_id AND photo_auto_disabled AND NOT profile_photo_enabled
     AND (photo_match_daily_date IS NULL OR photo_match_daily_date < v_today);
  -- 7b. MODE FOTO PROFIL');
  IF position('candidate_photo_on IS DISTINCT' in d) > 0 OR position('photo_auto_disabled=true' in d) = 0 OR position('7a. Aktif kembali' in d) = 0 THEN
    RAISE EXCEPTION 'patch incomplete';
  END IF;
  EXECUTE d;
END $do$;