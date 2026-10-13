ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS profile_photo_file_id text,
  ADD COLUMN IF NOT EXISTS pending_profile_photo_file_id text,
  ADD COLUMN IF NOT EXISTS is_face_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verification_gesture text,
  ADD COLUMN IF NOT EXISTS verification_admin_msg_id integer,
  ADD COLUMN IF NOT EXISTS profile_flow text;

-- Set langkah alur foto profil (null | await_photo | await_video)
CREATE OR REPLACE FUNCTION public.set_profile_flow(p_user_id bigint, p_flow text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  UPDATE telegram_users SET profile_flow = p_flow WHERE id = p_user_id
  RETURNING is_face_verified, verification_status, profile_photo_file_id, pending_profile_photo_file_id INTO r;
  IF NOT FOUND THEN RETURN json_build_object('success', false); END IF;
  RETURN json_build_object('success', true, 'verified', r.is_face_verified, 'status', r.verification_status,
    'has_photo', r.profile_photo_file_id IS NOT NULL, 'has_pending', r.pending_profile_photo_file_id IS NOT NULL);
END $$;

-- User mengirim foto: jika sudah verifikasi langsung aktif, jika belum simpan pending & minta video
CREATE OR REPLACE FUNCTION public.submit_profile_photo(p_user_id bigint, p_file_id text, p_gesture text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_verified boolean; v_status text;
BEGIN
  SELECT is_face_verified, verification_status INTO v_verified, v_status FROM telegram_users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_verified THEN
    UPDATE telegram_users SET profile_photo_file_id = p_file_id, pending_profile_photo_file_id = NULL, profile_flow = NULL WHERE id = p_user_id;
    RETURN json_build_object('success', true, 'verified', true);
  END IF;
  IF v_status = 'pending' THEN
    UPDATE telegram_users SET pending_profile_photo_file_id = p_file_id, profile_flow = NULL WHERE id = p_user_id;
    RETURN json_build_object('success', true, 'verified', false, 'pending', true);
  END IF;
  UPDATE telegram_users SET pending_profile_photo_file_id = p_file_id, profile_flow = 'await_video', verification_gesture = p_gesture WHERE id = p_user_id;
  RETURN json_build_object('success', true, 'verified', false, 'pending', false, 'gesture', p_gesture);
END $$;

-- User mengirim video note verifikasi
CREATE OR REPLACE FUNCTION public.submit_verification_video(p_user_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  UPDATE telegram_users SET verification_status = 'pending', profile_flow = NULL
  WHERE id = p_user_id AND profile_flow = 'await_video' AND pending_profile_photo_file_id IS NOT NULL AND verification_status <> 'pending'
  RETURNING pending_profile_photo_file_id, verification_gesture INTO r;
  IF NOT FOUND THEN RETURN json_build_object('success', false); END IF;
  RETURN json_build_object('success', true, 'photo', r.pending_profile_photo_file_id, 'gesture', r.verification_gesture);
END $$;

CREATE OR REPLACE FUNCTION public.set_verification_admin_message(p_user_id bigint, p_message_id integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE telegram_users SET verification_admin_msg_id = p_message_id WHERE id = p_user_id;
$$;

-- Admin approve/reject (atomik, tolak proses ganda)
CREATE OR REPLACE FUNCTION public.resolve_face_verification(p_user_id bigint, p_action text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_msg integer;
BEGIN
  IF p_action = 'approve' THEN
    UPDATE telegram_users SET is_face_verified = true, verification_status = 'approved',
      profile_photo_file_id = COALESCE(pending_profile_photo_file_id, profile_photo_file_id),
      pending_profile_photo_file_id = NULL, verification_admin_msg_id = NULL
    WHERE id = p_user_id AND verification_status = 'pending'
    RETURNING verification_admin_msg_id INTO v_msg;
  ELSE
    UPDATE telegram_users SET verification_status = 'rejected', pending_profile_photo_file_id = NULL, verification_admin_msg_id = NULL
    WHERE id = p_user_id AND verification_status = 'pending';
  END IF;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'already_processed'); END IF;
  RETURN json_build_object('success', true);
END $$;

CREATE OR REPLACE FUNCTION public.delete_profile_photo(p_user_id bigint)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE telegram_users SET profile_photo_file_id = NULL, profile_flow = NULL WHERE id = p_user_id;
  SELECT json_build_object('success', true);
$$;

REVOKE EXECUTE ON FUNCTION public.set_profile_flow(bigint,text), public.submit_profile_photo(bigint,text,text), public.submit_verification_video(bigint), public.set_verification_admin_message(bigint,integer), public.resolve_face_verification(bigint,text), public.delete_profile_photo(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_flow(bigint,text), public.submit_profile_photo(bigint,text,text), public.submit_verification_video(bigint), public.set_verification_admin_message(bigint,integer), public.resolve_face_verification(bigint,text), public.delete_profile_photo(bigint) TO service_role;