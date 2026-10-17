CREATE OR REPLACE FUNCTION public.resolve_face_verification(p_user_id bigint, p_action text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- UU PDP: video note tidak disimpan di database; setelah keputusan admin hanya status final yang dicatat.
  IF p_action = 'approve' THEN
    UPDATE telegram_users SET is_face_verified = true, verification_status = 'approved',
      profile_photo_file_id = COALESCE(pending_profile_photo_file_id, profile_photo_file_id),
      pending_profile_photo_file_id = NULL, verification_admin_msg_id = NULL, verification_gesture = NULL
    WHERE id = p_user_id AND verification_status = 'pending';
  ELSE
    UPDATE telegram_users SET verification_status = 'rejected', pending_profile_photo_file_id = NULL,
      verification_admin_msg_id = NULL, verification_gesture = NULL
    WHERE id = p_user_id AND verification_status = 'pending';
  END IF;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'already_processed'); END IF;
  RETURN json_build_object('success', true);
END $function$;