CREATE OR REPLACE FUNCTION public.create_channel_feedback_summary(
  p_lease_token uuid,
  p_limit integer DEFAULT 100,
  p_admin_id bigint DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state channel_agent_state%ROWTYPE;
  v_question channel_agent_posts%ROWTYPE;
  v_post channel_agent_posts%ROWTYPE;
  v_items jsonb;
  v_count integer;
  v_has_posted_summary boolean;
BEGIN
  SELECT * INTO v_state
  FROM channel_agent_state
  WHERE job_key = 'scheduler'
  FOR UPDATE;

  IF v_state.job_key IS NULL THEN
    RETURN jsonb_build_object('created', false, 'error', 'state_missing');
  END IF;

  IF v_state.status = 'paused' AND (v_state.resume_at IS NULL OR v_state.resume_at > now()) THEN
    RETURN jsonb_build_object('created', false, 'error', 'paused', 'reason', v_state.pause_reason);
  END IF;

  IF p_force THEN
    IF p_admin_id IS NULL OR p_lease_token IS NOT NULL THEN
      RETURN jsonb_build_object('created', false, 'error', 'invalid_manual_request');
    END IF;
  ELSIF v_state.lease_token IS DISTINCT FROM p_lease_token
    OR v_state.lease_expires_at IS NULL
    OR v_state.lease_expires_at <= now() THEN
    RETURN jsonb_build_object('created', false, 'error', 'lease_lost');
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

  SELECT * INTO v_post
  FROM channel_agent_posts
  WHERE kind = 'feedback_summary'
    AND metadata->>'source_question_id' = v_question.id::text
    AND status IN ('generating', 'queued', 'pending_review', 'awaiting_admin_input', 'approved')
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_post.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'summary_pending',
      'post', to_jsonb(v_post),
      'question_id', v_question.id
    );
  END IF;

  SELECT count(*) INTO v_count
  FROM channel_feedback
  WHERE post_id IS NULL
    AND created_at >= v_question.posted_at;

  SELECT EXISTS (
    SELECT 1
    FROM channel_agent_posts
    WHERE kind = 'feedback_summary'
      AND metadata->>'source_question_id' = v_question.id::text
      AND status = 'posted'
  ) INTO v_has_posted_summary;

  IF v_count = 0 AND v_has_posted_summary THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'already_posted',
      'count', 0,
      'question_id', v_question.id
    );
  END IF;

  IF v_count < (CASE WHEN p_force THEN 1 ELSE 5 END) THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'not_enough',
      'count', v_count,
      'question_id', v_question.id
    );
  END IF;

  IF NOT p_force
    AND v_state.last_summary_at IS NOT NULL
    AND v_state.last_summary_at > now() - interval '3 days' THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'cooldown',
      'count', v_count,
      'question_id', v_question.id
    );
  END IF;

  INSERT INTO channel_agent_posts (kind, dedupe_key, status, admin_id, metadata)
  VALUES (
    'feedback_summary',
    'feedback:' || gen_random_uuid()::text,
    CASE WHEN p_force THEN 'queued' ELSE 'generating' END,
    CASE WHEN p_force THEN p_admin_id ELSE NULL END,
    jsonb_build_object(
      'source_question_id', v_question.id,
      'source_question', v_question.content,
      'source_posted_at', v_question.posted_at,
      'requested_by_admin', p_force
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
    'count', jsonb_array_length(v_items),
    'question_id', v_question.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_channel_feedback_post(p_lease_token uuid, p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.create_channel_feedback_summary(p_lease_token, p_limit, NULL, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_channel_daily_post(p_lease_token uuid, p_dedupe_key text, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state channel_agent_state%ROWTYPE;
  v_post channel_agent_posts%ROWTYPE;
  v_question channel_agent_posts%ROWTYPE;
BEGIN
  SELECT * INTO v_state
  FROM channel_agent_state
  WHERE job_key = 'scheduler'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
  FOR UPDATE;

  IF v_state.job_key IS NULL THEN
    RETURN jsonb_build_object('created', false, 'error', 'lease_lost');
  END IF;

  IF p_kind NOT IN ('greeting', 'question', 'feedback_request') THEN
    RETURN jsonb_build_object('created', false, 'error', 'invalid_kind');
  END IF;

  SELECT * INTO v_post FROM channel_agent_posts WHERE dedupe_key = p_dedupe_key;
  IF v_post.id IS NOT NULL THEN
    RETURN jsonb_build_object('created', false, 'reason', 'already_exists', 'post', to_jsonb(v_post));
  END IF;

  SELECT * INTO v_post
  FROM channel_agent_posts
  WHERE kind IN ('greeting', 'question', 'feedback_request')
    AND status IN ('generating', 'queued', 'pending_review', 'awaiting_admin_input', 'approved')
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_post.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'automatic_post_pending',
      'post', to_jsonb(v_post)
    );
  END IF;

  SELECT * INTO v_question
  FROM channel_agent_posts
  WHERE kind IN ('question', 'feedback_request')
    AND status = 'posted'
    AND posted_at IS NOT NULL
  ORDER BY posted_at DESC, id DESC
  LIMIT 1;

  IF v_question.id IS NOT NULL THEN
    SELECT * INTO v_post
    FROM channel_agent_posts
    WHERE kind = 'feedback_summary'
      AND metadata->>'source_question_id' = v_question.id::text
      AND status IN ('generating', 'queued', 'pending_review', 'awaiting_admin_input', 'approved')
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF v_post.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'summary_pending',
        'post', to_jsonb(v_post),
        'question_id', v_question.id
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM channel_agent_posts
      WHERE kind = 'feedback_summary'
        AND metadata->>'source_question_id' = v_question.id::text
        AND status = 'posted'
    ) THEN
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'summary_required',
        'question_id', v_question.id
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM channel_feedback
      WHERE post_id IS NULL
        AND created_at >= v_question.posted_at
    ) THEN
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'pending_feedback',
        'question_id', v_question.id
      );
    END IF;
  END IF;

  INSERT INTO channel_agent_posts (kind, dedupe_key, metadata)
  VALUES (
    p_kind,
    p_dedupe_key,
    jsonb_build_object('answer_button', p_kind IN ('question', 'feedback_request'))
  )
  RETURNING * INTO v_post;

  RETURN jsonb_build_object('created', true, 'post', to_jsonb(v_post));
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_channel_post_generation(p_post_id uuid, p_content text, p_summary jsonb DEFAULT '[]'::jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
BEGIN
  UPDATE channel_agent_posts
  SET content = p_content,
    summary = coalesce(p_summary, '[]'::jsonb),
    status = 'pending_review',
    error = NULL,
    updated_at = now()
  WHERE id = p_post_id AND status = 'generating'
  RETURNING kind INTO v_kind;

  IF v_kind IS NULL THEN RETURN false; END IF;
  UPDATE channel_feedback SET summarized_at = now() WHERE post_id = p_post_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_channel_post_posted(p_post_id uuid, p_channel_message_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post channel_agent_posts%ROWTYPE;
BEGIN
  UPDATE channel_agent_posts
  SET status = 'posted',
    channel_message_id = p_channel_message_id,
    posted_at = now(),
    updated_at = now()
  WHERE id = p_post_id AND status = 'approved'
  RETURNING * INTO v_post;

  IF v_post.id IS NOT NULL AND v_post.kind = 'feedback_summary' THEN
    UPDATE channel_agent_state
    SET last_summary_at = v_post.posted_at, updated_at = now()
    WHERE job_key = 'scheduler';
  END IF;

  RETURN v_post.id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.channel_post_action(p_post_id uuid, p_admin_id bigint, p_action text, p_rough_text text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post channel_agent_posts%ROWTYPE;
  v_question channel_agent_posts%ROWTYPE;
  v_state channel_agent_state%ROWTYPE;
  v_updated uuid;
BEGIN
  SELECT * INTO v_post FROM channel_agent_posts WHERE id = p_post_id FOR UPDATE;
  IF v_post.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_post.admin_id IS NOT NULL AND v_post.admin_id <> p_admin_id AND p_action NOT IN ('approve', 'mark_posted', 'release_approval') THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_admin');
  END IF;

  SELECT * INTO v_state FROM channel_agent_state WHERE job_key = 'scheduler';
  IF p_action IN ('queue_polish', 'queue_regenerate') AND v_state.status = 'paused'
    AND (v_state.resume_at IS NULL OR v_state.resume_at > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'paused', 'reason', v_state.pause_reason);
  END IF;

  CASE p_action
    WHEN 'begin_polish' THEN
      UPDATE channel_agent_posts SET status = 'awaiting_admin_input', admin_id = p_admin_id, updated_at = now()
      WHERE id = p_post_id AND status IN ('pending_review', 'failed') RETURNING id INTO v_updated;
    WHEN 'cancel_polish' THEN
      UPDATE channel_agent_posts SET status = 'pending_review', updated_at = now()
      WHERE id = p_post_id AND status = 'awaiting_admin_input' AND admin_id = p_admin_id RETURNING id INTO v_updated;
    WHEN 'queue_polish' THEN
      IF char_length(btrim(coalesce(p_rough_text, ''))) < 1 OR char_length(p_rough_text) > 2000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
      END IF;
      UPDATE channel_agent_posts SET status = 'queued', admin_rough_text = p_rough_text, updated_at = now()
      WHERE id = p_post_id AND status = 'awaiting_admin_input' AND admin_id = p_admin_id RETURNING id INTO v_updated;
    WHEN 'queue_regenerate' THEN
      UPDATE channel_agent_posts SET status = 'queued', admin_id = p_admin_id, error = NULL, updated_at = now()
      WHERE id = p_post_id AND status IN ('pending_review', 'failed') RETURNING id INTO v_updated;
    WHEN 'reject' THEN
      UPDATE channel_agent_posts SET status = 'rejected', admin_id = p_admin_id, updated_at = now()
      WHERE id = p_post_id AND status IN ('pending_review', 'awaiting_admin_input', 'failed') RETURNING id INTO v_updated;
      IF v_updated IS NOT NULL AND v_post.kind = 'feedback_summary' THEN
        UPDATE channel_feedback SET post_id = NULL, summarized_at = NULL WHERE post_id = p_post_id;
      END IF;
    WHEN 'approve' THEN
      IF v_post.kind IN ('greeting', 'question', 'feedback_request') THEN
        SELECT * INTO v_question
        FROM channel_agent_posts
        WHERE kind IN ('question', 'feedback_request')
          AND status = 'posted'
          AND posted_at IS NOT NULL
        ORDER BY posted_at DESC, id DESC
        LIMIT 1;

        IF v_question.id IS NOT NULL THEN
          IF EXISTS (
            SELECT 1 FROM channel_agent_posts
            WHERE kind = 'feedback_summary'
              AND metadata->>'source_question_id' = v_question.id::text
              AND status IN ('generating', 'queued', 'pending_review', 'awaiting_admin_input', 'approved')
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'summary_pending');
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM channel_agent_posts
            WHERE kind = 'feedback_summary'
              AND metadata->>'source_question_id' = v_question.id::text
              AND status = 'posted'
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'summary_required');
          END IF;
          IF EXISTS (
            SELECT 1 FROM channel_feedback
            WHERE post_id IS NULL AND created_at >= v_question.posted_at
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'pending_feedback');
          END IF;
        END IF;
      END IF;

      UPDATE channel_agent_posts SET status = 'approved', admin_id = p_admin_id, updated_at = now()
      WHERE id = p_post_id AND status = 'pending_review' AND char_length(content) BETWEEN 1 AND 3500 RETURNING id INTO v_updated;
    WHEN 'release_approval' THEN
      UPDATE channel_agent_posts SET status = 'pending_review', updated_at = now()
      WHERE id = p_post_id AND status = 'approved' RETURNING id INTO v_updated;
    WHEN 'mark_posted' THEN
      UPDATE channel_agent_posts SET status = 'posted', posted_at = now(), updated_at = now()
      WHERE id = p_post_id AND status = 'approved' RETURNING id INTO v_updated;
      IF v_updated IS NOT NULL AND v_post.kind = 'feedback_summary' THEN
        UPDATE channel_agent_state SET last_summary_at = now(), updated_at = now() WHERE job_key = 'scheduler';
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END CASE;

  IF v_updated IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_state'); END IF;
  RETURN jsonb_build_object('success', true, 'post', (SELECT to_jsonb(p) FROM channel_agent_posts p WHERE id = p_post_id));
END;
$$;

REVOKE ALL ON FUNCTION public.create_channel_feedback_summary(uuid, integer, bigint, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_channel_feedback_post(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_channel_daily_post(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_channel_post_generation(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_channel_post_posted(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.channel_post_action(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_channel_feedback_summary(uuid, integer, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_channel_feedback_post(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_channel_daily_post(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_channel_post_generation(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_channel_post_posted(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.channel_post_action(uuid, bigint, text, text) TO service_role;