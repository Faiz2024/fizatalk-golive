ALTER TABLE public.call_invitations
  ADD COLUMN requester_redeemed_at timestamptz,
  ADD COLUMN recipient_redeemed_at timestamptz;

CREATE OR REPLACE FUNCTION public.exchange_chat_call_invite(
  p_join_token uuid,
  p_user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.call_invitations%ROWTYPE;
  v_peer_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_join_token::text), (p_user_id % 2147483647)::integer);

  SELECT * INTO v_invite
  FROM public.call_invitations
  WHERE join_token = p_join_token
  FOR UPDATE;

  IF NOT FOUND OR v_invite.status <> 'accepted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_invite.expires_at <= now() THEN
    UPDATE public.call_invitations SET status = 'expired' WHERE id = v_invite.id;
    RETURN jsonb_build_object('success', false, 'error', 'expired');
  END IF;

  IF p_user_id NOT IN (v_invite.requester_id, v_invite.recipient_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_member');
  END IF;

  IF p_user_id = v_invite.requester_id THEN
    IF v_invite.requester_redeemed_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_redeemed');
    END IF;
    UPDATE public.call_invitations SET requester_redeemed_at = now() WHERE id = v_invite.id;
    v_peer_id := v_invite.recipient_id;
  ELSE
    IF v_invite.recipient_redeemed_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_redeemed');
    END IF;
    UPDATE public.call_invitations SET recipient_redeemed_at = now() WHERE id = v_invite.id;
    v_peer_id := v_invite.requester_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'invite_id', v_invite.id,
    'user_id', p_user_id,
    'peer_id', v_peer_id,
    'expires_at', v_invite.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.exchange_chat_call_invite(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_chat_call_invite(uuid, bigint) TO service_role;