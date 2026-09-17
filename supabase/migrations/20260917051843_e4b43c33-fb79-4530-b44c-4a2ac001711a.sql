CREATE TABLE public.call_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id bigint NOT NULL REFERENCES public.telegram_users(id) ON DELETE CASCADE,
  recipient_id bigint NOT NULL REFERENCES public.telegram_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  join_token uuid UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_invitations_distinct_users CHECK (requester_id <> recipient_id),
  CONSTRAINT call_invitations_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  CONSTRAINT call_invitations_token_state_check CHECK (
    (status = 'accepted' AND join_token IS NOT NULL) OR
    (status <> 'accepted' AND join_token IS NULL)
  )
);

GRANT ALL ON public.call_invitations TO service_role;

ALTER TABLE public.call_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages call invitations"
ON public.call_invitations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX call_invitations_requester_recent_idx
ON public.call_invitations (requester_id, created_at DESC);

CREATE INDEX call_invitations_recipient_pending_idx
ON public.call_invitations (recipient_id, expires_at)
WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.create_chat_call_invite(p_requester_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id bigint;
  v_partner_state public.user_state;
  v_partner_partner_id bigint;
  v_existing public.call_invitations%ROWTYPE;
  v_invite public.call_invitations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(91301, (p_requester_id % 2147483647)::integer);

  SELECT partner_id
  INTO v_partner_id
  FROM public.telegram_users
  WHERE id = p_requester_id
    AND state = 'chatting'
    AND partner_id IS NOT NULL
  FOR UPDATE;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_chatting');
  END IF;

  SELECT state, partner_id
  INTO v_partner_state, v_partner_partner_id
  FROM public.telegram_users
  WHERE id = v_partner_id
  FOR UPDATE;

  IF v_partner_state IS DISTINCT FROM 'chatting'::public.user_state
     OR v_partner_partner_id IS DISTINCT FROM p_requester_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'partner_changed');
  END IF;

  UPDATE public.call_invitations
  SET status = 'expired', resolved_at = now()
  WHERE status = 'pending'
    AND expires_at <= now()
    AND (requester_id = p_requester_id OR recipient_id = p_requester_id);

  SELECT *
  INTO v_existing
  FROM public.call_invitations
  WHERE requester_id = p_requester_id
    AND recipient_id = v_partner_id
    AND status = 'pending'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'reused', true,
      'invite_id', v_existing.id,
      'recipient_id', v_existing.recipient_id,
      'expires_at', v_existing.expires_at
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.call_invitations
    WHERE requester_id = p_requester_id
      AND created_at > now() - interval '30 seconds'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rate_limited');
  END IF;

  UPDATE public.call_invitations
  SET status = 'cancelled', resolved_at = now()
  WHERE status = 'pending'
    AND (requester_id = p_requester_id OR recipient_id = p_requester_id);

  INSERT INTO public.call_invitations (requester_id, recipient_id)
  VALUES (p_requester_id, v_partner_id)
  RETURNING * INTO v_invite;

  RETURN jsonb_build_object(
    'success', true,
    'reused', false,
    'invite_id', v_invite.id,
    'recipient_id', v_invite.recipient_id,
    'expires_at', v_invite.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_chat_call_invite(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_chat_call_invite(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_chat_call_invite(
  p_invite_id uuid,
  p_actor_id bigint,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.call_invitations%ROWTYPE;
  v_requester public.telegram_users%ROWTYPE;
  v_recipient public.telegram_users%ROWTYPE;
  v_token uuid;
BEGIN
  IF p_action NOT IN ('accept', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_invite_id::text));

  SELECT *
  INTO v_invite
  FROM public.call_invitations
  WHERE id = p_invite_id
  FOR UPDATE;

  IF NOT FOUND OR v_invite.recipient_id <> p_actor_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_invite.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_resolved', 'status', v_invite.status);
  END IF;

  IF v_invite.expires_at <= now() THEN
    UPDATE public.call_invitations
    SET status = 'expired', resolved_at = now()
    WHERE id = v_invite.id;
    RETURN jsonb_build_object('success', false, 'error', 'expired');
  END IF;

  SELECT * INTO v_requester FROM public.telegram_users WHERE id = v_invite.requester_id;
  SELECT * INTO v_recipient FROM public.telegram_users WHERE id = v_invite.recipient_id;

  IF v_requester.state IS DISTINCT FROM 'chatting'::public.user_state
     OR v_recipient.state IS DISTINCT FROM 'chatting'::public.user_state
     OR v_requester.partner_id IS DISTINCT FROM v_invite.recipient_id
     OR v_recipient.partner_id IS DISTINCT FROM v_invite.requester_id THEN
    UPDATE public.call_invitations
    SET status = 'cancelled', resolved_at = now()
    WHERE id = v_invite.id;
    RETURN jsonb_build_object('success', false, 'error', 'partner_changed');
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.call_invitations
    SET status = 'rejected', resolved_at = now()
    WHERE id = v_invite.id;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'rejected',
      'requester_id', v_invite.requester_id,
      'recipient_id', v_invite.recipient_id
    );
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.call_invitations
  SET status = 'accepted', join_token = v_token, resolved_at = now(), expires_at = now() + interval '5 minutes'
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'accepted',
    'requester_id', v_invite.requester_id,
    'recipient_id', v_invite.recipient_id,
    'join_token', v_token,
    'expires_at', now() + interval '5 minutes'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_chat_call_invite(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_chat_call_invite(uuid, bigint, text) TO service_role;