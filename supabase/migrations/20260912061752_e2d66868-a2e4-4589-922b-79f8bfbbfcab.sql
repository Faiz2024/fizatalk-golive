CREATE OR REPLACE FUNCTION public.reject_referral_cashout(
  p_request_id uuid,
  p_reason text,
  p_admin_id bigint
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.referral_cashouts%ROWTYPE;
  v_user public.telegram_users%ROWTYPE;
  v_invited_ids bigint[] := ARRAY[]::bigint[];
  v_affected_partner_ids bigint[] := ARRAY[]::bigint[];
  v_deleted_count integer := 0;
  v_is_premium boolean := false;
  v_now timestamptz := now();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  IF p_reason NOT IN ('invalid_input', 'non_organic') THEN
    RETURN json_build_object('success', false, 'error', 'invalid_reason');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  SELECT * INTO v_request
  FROM public.referral_cashouts
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'already_processed');
  END IF;

  SELECT * INTO v_user
  FROM public.telegram_users
  WHERE id = v_request.user_id
  FOR UPDATE;

  IF v_user.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > v_now;

  IF p_reason = 'invalid_input' THEN
    UPDATE public.referral_cashouts
    SET status = 'rejected',
        admin_notes = 'invalid_input',
        processed_by = p_admin_id,
        processed_at = v_now,
        updated_at = v_now
    WHERE id = p_request_id;

    RETURN json_build_object(
      'success', true,
      'reason', p_reason,
      'user_id', v_request.user_id,
      'amount', v_request.amount,
      'is_premium', v_is_premium,
      'deleted_count', 0,
      'affected_partner_ids', '[]'::json
    );
  END IF;

  SELECT COALESCE(array_agg(DISTINCT invited_id), ARRAY[]::bigint[])
  INTO v_invited_ids
  FROM (
    SELECT referred_id AS invited_id
    FROM public.referrals
    WHERE referrer_id = v_request.user_id
    UNION
    SELECT id AS invited_id
    FROM public.telegram_users
    WHERE referred_by = v_request.user_id
  ) invited
  WHERE invited_id IS NOT NULL AND invited_id <> v_request.user_id;

  IF COALESCE(array_length(v_invited_ids, 1), 0) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT partner_id), ARRAY[]::bigint[])
    INTO v_affected_partner_ids
    FROM public.telegram_users
    WHERE id = ANY(v_invited_ids)
      AND partner_id IS NOT NULL
      AND NOT (partner_id = ANY(v_invited_ids));

    UPDATE public.telegram_users
    SET partner_id = NULL, state = 'idle'
    WHERE partner_id = ANY(v_invited_ids)
       OR id = ANY(v_invited_ids);

    DELETE FROM public.waiting_queue WHERE user_id = ANY(v_invited_ids);
    DELETE FROM public.reconnect_requests WHERE requester_id = ANY(v_invited_ids) OR target_id = ANY(v_invited_ids);
    DELETE FROM public.partner_reports WHERE reporter_id = ANY(v_invited_ids) OR reported_id = ANY(v_invited_ids);
    DELETE FROM public.bot_logs WHERE user_id = ANY(v_invited_ids);
    DELETE FROM public.coin_transactions WHERE user_id = ANY(v_invited_ids);
    DELETE FROM public.reengagement_clicks WHERE user_id = ANY(v_invited_ids);
    DELETE FROM public.premium_requests WHERE user_id = ANY(v_invited_ids);
    DELETE FROM public.topup_requests WHERE user_id = ANY(v_invited_ids);
    DELETE FROM public.pending_transactions WHERE user_id = ANY(v_invited_ids);
    UPDATE public.pending_transactions SET approved_by = NULL WHERE approved_by = ANY(v_invited_ids);
    UPDATE public.referral_cashouts SET processed_by = NULL WHERE processed_by = ANY(v_invited_ids);
    DELETE FROM public.referral_cashouts WHERE user_id = ANY(v_invited_ids);
    DELETE FROM public.blocked_users WHERE user_id = ANY(v_invited_ids);
    UPDATE public.sticker_packs SET requester_id = NULL WHERE requester_id = ANY(v_invited_ids);
    UPDATE public.sticker_packs
      SET submitter_ids = ARRAY(
        SELECT x FROM unnest(COALESCE(submitter_ids, ARRAY[]::bigint[])) x
        WHERE NOT (x = ANY(v_invited_ids))
      )
      WHERE COALESCE(submitter_ids, ARRAY[]::bigint[]) && v_invited_ids;

    DELETE FROM public.referrals
    WHERE referrer_id = ANY(v_invited_ids)
       OR referred_id = ANY(v_invited_ids)
       OR (referrer_id = v_request.user_id AND referred_id = ANY(v_invited_ids));

    DELETE FROM public.telegram_users WHERE id = ANY(v_invited_ids);
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  END IF;

  UPDATE public.telegram_users
  SET referral_qualified_count = 0,
      referral_rewards_claimed = 0,
      cashout_draft = NULL,
      partner_id = NULL,
      state = 'idle'
  WHERE id = v_request.user_id;

  DELETE FROM public.waiting_queue WHERE user_id = v_request.user_id;

  IF NOT v_is_premium THEN
    INSERT INTO public.blocked_users (
      user_id, username, first_name, reason, blocked_message,
      blocked_at, unblocked_at, unblocked_by, is_active
    ) VALUES (
      v_request.user_id, v_user.username, v_user.first_name,
      'referral_fraud_non_organic',
      'Penarikan bonus ditolak karena referral tidak organik; seluruh akun undangan langsung telah dihapus.',
      v_now, NULL, NULL, true
    )
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      reason = EXCLUDED.reason,
      blocked_message = EXCLUDED.blocked_message,
      blocked_at = EXCLUDED.blocked_at,
      unblocked_at = NULL,
      unblocked_by = NULL,
      is_active = true;
  END IF;

  UPDATE public.referral_cashouts
  SET status = 'rejected',
      admin_notes = format('non_organic; deleted_invited_users=%s; premium=%s', v_deleted_count, v_is_premium),
      processed_by = p_admin_id,
      processed_at = v_now,
      updated_at = v_now
  WHERE id = p_request_id;

  RETURN json_build_object(
    'success', true,
    'reason', p_reason,
    'user_id', v_request.user_id,
    'amount', v_request.amount,
    'is_premium', v_is_premium,
    'deleted_count', v_deleted_count,
    'affected_partner_ids', to_json(v_affected_partner_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_referral_cashout(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_referral_cashout(uuid, text, bigint) TO service_role;