CREATE INDEX channel_feedback_post_id_idx ON public.channel_feedback (post_id) WHERE post_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.channel_post_action(p_post_id uuid, p_admin_id bigint, p_action text, p_rough_text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post channel_agent_posts%ROWTYPE;
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
    WHEN 'approve' THEN
      UPDATE channel_agent_posts SET status = 'approved', admin_id = p_admin_id, updated_at = now()
      WHERE id = p_post_id AND status = 'pending_review' AND char_length(content) BETWEEN 1 AND 3500 RETURNING id INTO v_updated;
    WHEN 'release_approval' THEN
      UPDATE channel_agent_posts SET status = 'pending_review', updated_at = now()
      WHERE id = p_post_id AND status = 'approved' RETURNING id INTO v_updated;
    WHEN 'mark_posted' THEN
      UPDATE channel_agent_posts SET status = 'posted', posted_at = now(), updated_at = now()
      WHERE id = p_post_id AND status = 'approved' RETURNING id INTO v_updated;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END CASE;
  IF v_updated IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_state'); END IF;
  RETURN jsonb_build_object('success', true, 'post', (SELECT to_jsonb(p) FROM channel_agent_posts p WHERE id = p_post_id));
END;
$$;

REVOKE ALL ON FUNCTION public.channel_post_action(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_post_action(uuid, bigint, text, text) TO service_role;