CREATE TABLE public.channel_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL REFERENCES public.telegram_users(id) ON DELETE CASCADE,
  content text NOT NULL,
  post_id uuid,
  summarized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.channel_feedback TO service_role;
ALTER TABLE public.channel_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Server bot mengelola masukan channel" ON public.channel_feedback
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.channel_agent_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  content text NOT NULL DEFAULT '',
  summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'generating',
  admin_id bigint,
  admin_message_id bigint,
  admin_rough_text text,
  channel_message_id bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz
);
GRANT ALL ON public.channel_agent_posts TO service_role;
ALTER TABLE public.channel_agent_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Server bot mengelola draf channel" ON public.channel_agent_posts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.channel_agent_state (
  job_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  pause_reason text,
  resume_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_run_at timestamptz,
  last_summary_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.channel_agent_state TO service_role;
ALTER TABLE public.channel_agent_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Server bot mengelola status agen channel" ON public.channel_agent_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.channel_feedback
  ADD CONSTRAINT channel_feedback_post_fk FOREIGN KEY (post_id)
  REFERENCES public.channel_agent_posts(id) ON DELETE SET NULL;

CREATE INDEX channel_feedback_pending_idx ON public.channel_feedback (created_at, id)
  WHERE post_id IS NULL;
CREATE INDEX channel_feedback_user_created_idx ON public.channel_feedback (user_id, created_at DESC);
CREATE INDEX channel_agent_posts_status_idx ON public.channel_agent_posts (status, created_at);

INSERT INTO public.channel_agent_state (job_key) VALUES ('scheduler');

CREATE OR REPLACE FUNCTION public.submit_channel_feedback(p_user_id bigint, p_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_text text := regexp_replace(btrim(coalesce(p_text, '')), E'[\\r\\n\\t]+', ' ', 'g');
  v_id uuid;
BEGIN
  IF char_length(v_text) < 5 OR char_length(v_text) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_length');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM telegram_users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;
  IF (SELECT count(*) FROM channel_feedback
      WHERE user_id = p_user_id AND created_at >= now() - interval '24 hours') >= 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rate_limited');
  END IF;
  IF EXISTS (SELECT 1 FROM channel_feedback
      WHERE user_id = p_user_id AND content = v_text AND created_at >= now() - interval '7 days') THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate');
  END IF;
  INSERT INTO channel_feedback (user_id, content) VALUES (p_user_id, v_text) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_channel_agent_schedule(p_lease_seconds integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_state channel_agent_state%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  INSERT INTO channel_agent_state (job_key) VALUES ('scheduler') ON CONFLICT (job_key) DO NOTHING;
  SELECT * INTO v_state FROM channel_agent_state WHERE job_key = 'scheduler' FOR UPDATE;
  IF v_state.status = 'paused' AND (v_state.resume_at IS NULL OR v_state.resume_at > now()) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'paused', 'pause_reason', v_state.pause_reason);
  END IF;
  IF v_state.lease_expires_at IS NOT NULL AND v_state.lease_expires_at > now() THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'busy');
  END IF;
  UPDATE channel_agent_state SET status = 'active', pause_reason = NULL, resume_at = NULL,
    lease_token = v_token, lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300))),
    updated_at = now() WHERE job_key = 'scheduler';
  RETURN jsonb_build_object('claimed', true, 'lease_token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_channel_daily_post(p_lease_token uuid, p_dedupe_key text, p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post channel_agent_posts%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM channel_agent_state WHERE job_key = 'scheduler'
    AND lease_token = p_lease_token AND lease_expires_at > now()) THEN
    RETURN jsonb_build_object('created', false, 'error', 'lease_lost');
  END IF;
  INSERT INTO channel_agent_posts (kind, dedupe_key)
  VALUES (p_kind, p_dedupe_key) ON CONFLICT (dedupe_key) DO NOTHING RETURNING * INTO v_post;
  IF v_post.id IS NULL THEN
    SELECT * INTO v_post FROM channel_agent_posts WHERE dedupe_key = p_dedupe_key;
    RETURN jsonb_build_object('created', false, 'post', to_jsonb(v_post));
  END IF;
  RETURN jsonb_build_object('created', true, 'post', to_jsonb(v_post));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_channel_feedback_post(p_lease_token uuid, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_state channel_agent_state%ROWTYPE;
  v_post channel_agent_posts%ROWTYPE;
  v_items jsonb;
  v_count integer;
BEGIN
  SELECT * INTO v_state FROM channel_agent_state WHERE job_key = 'scheduler'
    AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF v_state.job_key IS NULL THEN RETURN jsonb_build_object('created', false, 'error', 'lease_lost'); END IF;
  IF v_state.last_summary_at IS NOT NULL AND v_state.last_summary_at > now() - interval '3 days' THEN
    RETURN jsonb_build_object('created', false, 'reason', 'cooldown');
  END IF;
  SELECT count(*) INTO v_count FROM channel_feedback WHERE post_id IS NULL;
  IF v_count < 5 THEN RETURN jsonb_build_object('created', false, 'reason', 'not_enough', 'count', v_count); END IF;
  INSERT INTO channel_agent_posts (kind, dedupe_key)
  VALUES ('feedback_summary', 'feedback:' || gen_random_uuid()::text) RETURNING * INTO v_post;
  WITH claimed AS (
    SELECT id FROM channel_feedback WHERE post_id IS NULL
    ORDER BY created_at, id LIMIT greatest(1, least(p_limit, 100)) FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE channel_feedback f SET post_id = v_post.id FROM claimed c WHERE f.id = c.id
    RETURNING f.id, f.content, f.created_at
  )
  SELECT coalesce(jsonb_agg(to_jsonb(updated) ORDER BY updated.created_at), '[]'::jsonb) INTO v_items FROM updated;
  RETURN jsonb_build_object('created', true, 'post', to_jsonb(v_post), 'feedback', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_channel_admin_post(p_admin_id bigint, p_kind text, p_rough_text text, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_state channel_agent_state%ROWTYPE;
  v_post channel_agent_posts%ROWTYPE;
BEGIN
  SELECT * INTO v_state FROM channel_agent_state WHERE job_key = 'scheduler';
  IF v_state.status = 'paused' AND (v_state.resume_at IS NULL OR v_state.resume_at > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'paused', 'reason', v_state.pause_reason);
  END IF;
  IF p_kind <> 'giveaway' OR char_length(btrim(coalesce(p_rough_text, ''))) < 1 OR char_length(p_rough_text) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;
  INSERT INTO channel_agent_posts (kind, dedupe_key, status, admin_id, admin_rough_text, metadata)
  VALUES (p_kind, 'admin:' || gen_random_uuid()::text, 'queued', p_admin_id, p_rough_text, coalesce(p_metadata, '{}'::jsonb))
  RETURNING * INTO v_post;
  RETURN jsonb_build_object('success', true, 'post', to_jsonb(v_post));
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_queued_channel_post(p_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_state channel_agent_state%ROWTYPE;
  v_post channel_agent_posts%ROWTYPE;
BEGIN
  SELECT * INTO v_state FROM channel_agent_state WHERE job_key = 'scheduler';
  IF v_state.status = 'paused' AND (v_state.resume_at IS NULL OR v_state.resume_at > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'paused', 'reason', v_state.pause_reason);
  END IF;
  UPDATE channel_agent_posts SET status = 'generating', error = NULL, updated_at = now()
  WHERE id = p_post_id AND status = 'queued' RETURNING * INTO v_post;
  IF v_post.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_queued'); END IF;
  RETURN jsonb_build_object('success', true, 'post', to_jsonb(v_post));
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_channel_post_generation(p_post_id uuid, p_content text, p_summary jsonb DEFAULT '[]'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind text;
BEGIN
  UPDATE channel_agent_posts SET content = p_content, summary = coalesce(p_summary, '[]'::jsonb),
    status = 'pending_review', error = NULL, updated_at = now()
  WHERE id = p_post_id AND status = 'generating' RETURNING kind INTO v_kind;
  IF v_kind IS NULL THEN RETURN false; END IF;
  UPDATE channel_feedback SET summarized_at = now() WHERE post_id = p_post_id;
  IF v_kind = 'feedback_summary' THEN
    UPDATE channel_agent_state SET last_summary_at = now(), updated_at = now() WHERE job_key = 'scheduler';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_channel_post_generation(p_post_id uuid, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE channel_feedback SET post_id = NULL, summarized_at = NULL WHERE post_id = p_post_id;
  UPDATE channel_agent_posts SET status = 'failed', error = left(coalesce(p_error, 'generation_failed'), 500), updated_at = now()
  WHERE id = p_post_id AND status IN ('generating', 'queued');
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_channel_agent_schedule(p_lease_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE channel_agent_state SET lease_token = NULL, lease_expires_at = NULL,
    last_run_at = now(), updated_at = now()
  WHERE job_key = 'scheduler' AND lease_token = p_lease_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_channel_agent(p_reason text, p_resume_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE channel_agent_state SET status = 'paused', pause_reason = left(p_reason, 500),
    resume_at = p_resume_at, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE job_key = 'scheduler';
END;
$$;

CREATE OR REPLACE FUNCTION public.channel_post_action(p_post_id uuid, p_admin_id bigint, p_action text, p_rough_text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post channel_agent_posts%ROWTYPE;
  v_state channel_agent_state%ROWTYPE;
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
      WHERE id = p_post_id AND status IN ('pending_review', 'failed') RETURNING * INTO v_post;
    WHEN 'cancel_polish' THEN
      UPDATE channel_agent_posts SET status = 'pending_review', updated_at = now()
      WHERE id = p_post_id AND status = 'awaiting_admin_input' AND admin_id = p_admin_id RETURNING * INTO v_post;
    WHEN 'queue_polish' THEN
      IF char_length(btrim(coalesce(p_rough_text, ''))) < 1 OR char_length(p_rough_text) > 2000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
      END IF;
      UPDATE channel_agent_posts SET status = 'queued', admin_rough_text = p_rough_text, updated_at = now()
      WHERE id = p_post_id AND status = 'awaiting_admin_input' AND admin_id = p_admin_id RETURNING * INTO v_post;
    WHEN 'queue_regenerate' THEN
      UPDATE channel_agent_posts SET status = 'queued', admin_id = p_admin_id, error = NULL, updated_at = now()
      WHERE id = p_post_id AND status IN ('pending_review', 'failed') RETURNING * INTO v_post;
    WHEN 'reject' THEN
      UPDATE channel_agent_posts SET status = 'rejected', admin_id = p_admin_id, updated_at = now()
      WHERE id = p_post_id AND status IN ('pending_review', 'awaiting_admin_input', 'failed') RETURNING * INTO v_post;
    WHEN 'approve' THEN
      UPDATE channel_agent_posts SET status = 'approved', admin_id = p_admin_id, updated_at = now()
      WHERE id = p_post_id AND status = 'pending_review' AND char_length(content) BETWEEN 1 AND 3500 RETURNING * INTO v_post;
    WHEN 'release_approval' THEN
      UPDATE channel_agent_posts SET status = 'pending_review', updated_at = now()
      WHERE id = p_post_id AND status = 'approved' RETURNING * INTO v_post;
    WHEN 'mark_posted' THEN
      UPDATE channel_agent_posts SET status = 'posted', posted_at = now(), updated_at = now()
      WHERE id = p_post_id AND status = 'approved' RETURNING * INTO v_post;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END CASE;
  IF v_post.id IS NULL OR v_post.status = (SELECT status FROM channel_agent_posts WHERE id = p_post_id) AND p_action NOT IN ('mark_posted') THEN
    IF NOT EXISTS (SELECT 1 FROM channel_agent_posts WHERE id = p_post_id AND status = CASE p_action
      WHEN 'begin_polish' THEN 'awaiting_admin_input' WHEN 'cancel_polish' THEN 'pending_review'
      WHEN 'queue_polish' THEN 'queued' WHEN 'queue_regenerate' THEN 'queued' WHEN 'reject' THEN 'rejected'
      WHEN 'approve' THEN 'approved' WHEN 'release_approval' THEN 'pending_review' WHEN 'mark_posted' THEN 'posted' ELSE '' END) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_state');
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'post', to_jsonb((SELECT row_to_json(p) FROM channel_agent_posts p WHERE id = p_post_id)));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_channel_post_admin_message(p_post_id uuid, p_message_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE channel_agent_posts SET admin_message_id = p_message_id, updated_at = now()
  WHERE id = p_post_id AND status = 'pending_review';
END;
$$;

REVOKE ALL ON FUNCTION public.submit_channel_feedback(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_channel_agent_schedule(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_channel_daily_post(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_channel_feedback_post(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_channel_admin_post(bigint, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_queued_channel_post(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_channel_post_generation(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_channel_post_generation(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_channel_agent_schedule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pause_channel_agent(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.channel_post_action(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_channel_post_admin_message(uuid, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_channel_feedback(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_channel_agent_schedule(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_channel_daily_post(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_channel_feedback_post(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_channel_admin_post(bigint, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_queued_channel_post(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_channel_post_generation(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_channel_post_generation(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_channel_agent_schedule(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pause_channel_agent(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.channel_post_action(uuid, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_channel_post_admin_message(uuid, bigint) TO service_role;