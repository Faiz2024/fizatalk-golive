CREATE OR REPLACE FUNCTION public.mark_channel_post_posted(p_post_id uuid, p_channel_message_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE channel_agent_posts SET status = 'posted', channel_message_id = p_channel_message_id,
    posted_at = now(), updated_at = now()
  WHERE id = p_post_id AND status = 'approved' RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_channel_post_generation(p_post_id uuid, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE channel_feedback SET post_id = NULL, summarized_at = NULL WHERE post_id = p_post_id;
  UPDATE channel_agent_posts SET status = 'failed', error = left(coalesce(p_error, 'generation_failed'), 500), updated_at = now()
  WHERE id = p_post_id AND status IN ('generating', 'queued', 'pending_review');
END;
$$;

REVOKE ALL ON FUNCTION public.mark_channel_post_posted(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_channel_post_generation(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_channel_post_posted(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_channel_post_generation(uuid, text) TO service_role;