CREATE OR REPLACE FUNCTION public.create_channel_admin_post(p_admin_id bigint, p_kind text, p_rough_text text, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_state channel_agent_state%ROWTYPE;
  v_post channel_agent_posts%ROWTYPE;
BEGIN
  SELECT * INTO v_state FROM channel_agent_state WHERE job_key = 'scheduler';
  IF v_state.status = 'paused' AND (v_state.resume_at IS NULL OR v_state.resume_at > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'paused', 'reason', v_state.pause_reason);
  END IF;
  IF p_kind NOT IN ('giveaway', 'admin')
    OR char_length(btrim(coalesce(p_rough_text, ''))) < 1
    OR char_length(p_rough_text) > 2000
    OR jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;
  IF p_kind = 'admin' AND (
    NOT (p_metadata ? 'answer_button')
    OR jsonb_typeof(p_metadata->'answer_button') <> 'boolean'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;
  INSERT INTO channel_agent_posts (kind, dedupe_key, status, admin_id, admin_rough_text, metadata)
  VALUES (p_kind, 'admin:' || gen_random_uuid()::text, 'queued', p_admin_id, p_rough_text, coalesce(p_metadata, '{}'::jsonb))
  RETURNING * INTO v_post;
  RETURN jsonb_build_object('success', true, 'post', to_jsonb(v_post));
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_channel_daily_post(p_lease_token uuid, p_dedupe_key text, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_post channel_agent_posts%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM channel_agent_state WHERE job_key = 'scheduler'
    AND lease_token = p_lease_token AND lease_expires_at > now()) THEN
    RETURN jsonb_build_object('created', false, 'error', 'lease_lost');
  END IF;
  INSERT INTO channel_agent_posts (kind, dedupe_key, metadata)
  VALUES (
    p_kind,
    p_dedupe_key,
    jsonb_build_object('answer_button', p_kind IN ('question', 'feedback_request'))
  )
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING * INTO v_post;
  IF v_post.id IS NULL THEN
    SELECT * INTO v_post FROM channel_agent_posts WHERE dedupe_key = p_dedupe_key;
    RETURN jsonb_build_object('created', false, 'post', to_jsonb(v_post));
  END IF;
  RETURN jsonb_build_object('created', true, 'post', to_jsonb(v_post));
END;
$function$;