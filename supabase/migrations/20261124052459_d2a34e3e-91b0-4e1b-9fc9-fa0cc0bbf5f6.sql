CREATE OR REPLACE FUNCTION public.create_channel_feedback_post(p_lease_token uuid, p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_state channel_agent_state%ROWTYPE;
  v_question channel_agent_posts%ROWTYPE;
  v_post channel_agent_posts%ROWTYPE;
  v_items jsonb;
  v_count integer;
BEGIN
  SELECT * INTO v_state FROM channel_agent_state WHERE job_key = 'scheduler'
    AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF v_state.job_key IS NULL THEN
    RETURN jsonb_build_object('created', false, 'error', 'lease_lost');
  END IF;

  IF v_state.last_summary_at IS NOT NULL AND v_state.last_summary_at > now() - interval '3 days' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'cooldown');
  END IF;

  SELECT * INTO v_question
  FROM channel_agent_posts
  WHERE kind IN ('question', 'feedback_request')
    AND status = 'posted'
    AND posted_at IS NOT NULL
  ORDER BY posted_at DESC, id DESC
  LIMIT 1;

  IF v_question.id IS NULL THEN
    RETURN jsonb_build_object('created', false, 'reason', 'no_posted_question');
  END IF;

  SELECT count(*) INTO v_count
  FROM channel_feedback
  WHERE post_id IS NULL
    AND created_at >= v_question.posted_at;

  IF v_count < 5 THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'not_enough',
      'count', v_count,
      'question_id', v_question.id
    );
  END IF;

  INSERT INTO channel_agent_posts (kind, dedupe_key, metadata)
  VALUES (
    'feedback_summary',
    'feedback:' || gen_random_uuid()::text,
    jsonb_build_object(
      'source_question_id', v_question.id,
      'source_question', v_question.content,
      'source_posted_at', v_question.posted_at
    )
  )
  RETURNING * INTO v_post;

  WITH claimed AS (
    SELECT id
    FROM channel_feedback
    WHERE post_id IS NULL
      AND created_at >= v_question.posted_at
    ORDER BY created_at, id
    LIMIT greatest(1, least(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE channel_feedback f
    SET post_id = v_post.id
    FROM claimed c
    WHERE f.id = c.id
    RETURNING f.id, f.content, f.created_at
  )
  SELECT coalesce(jsonb_agg(to_jsonb(updated) ORDER BY updated.created_at), '[]'::jsonb)
  INTO v_items
  FROM updated;

  RETURN jsonb_build_object(
    'created', true,
    'post', to_jsonb(v_post),
    'feedback', v_items,
    'question_id', v_question.id
  );
END;
$function$;