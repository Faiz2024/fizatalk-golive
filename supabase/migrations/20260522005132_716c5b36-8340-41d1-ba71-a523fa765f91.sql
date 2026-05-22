
-- ============ bot_logs table ============
CREATE TABLE IF NOT EXISTS public.bot_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta'),
  level text NOT NULL CHECK (level IN ('debug','info','warn','error','fatal')),
  source text NOT NULL,
  event text NOT NULL,
  user_id bigint,
  message text,
  context jsonb
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON public.bot_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON public.bot_logs (level);
CREATE INDEX IF NOT EXISTS idx_bot_logs_source ON public.bot_logs (source);
CREATE INDEX IF NOT EXISTS idx_bot_logs_user_id ON public.bot_logs (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access bot_logs" ON public.bot_logs;
CREATE POLICY "Service role full access bot_logs"
  ON public.bot_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============ log_bot_event RPC ============
CREATE OR REPLACE FUNCTION public.log_bot_event(
  p_level text,
  p_source text,
  p_event text,
  p_user_id bigint DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_context jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.bot_logs (level, source, event, user_id, message, context)
  VALUES (p_level, p_source, p_event, p_user_id, p_message, p_context);
EXCEPTION WHEN OTHERS THEN
  -- never fail caller
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_bot_event(text,text,text,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_bot_event(text,text,text,bigint,text,jsonb) TO service_role;

-- ============ prune_bot_logs RPC ============
CREATE OR REPLACE FUNCTION public.prune_bot_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_err integer;
  v_other integer;
BEGIN
  DELETE FROM public.bot_logs
    WHERE level IN ('error','fatal') AND created_at < (now() - interval '30 days');
  GET DIAGNOSTICS v_err = ROW_COUNT;

  DELETE FROM public.bot_logs
    WHERE level NOT IN ('error','fatal') AND created_at < (now() - interval '7 days');
  GET DIAGNOSTICS v_other = ROW_COUNT;

  RETURN jsonb_build_object('deleted_error_fatal', v_err, 'deleted_other', v_other);
END;
$$;

REVOKE ALL ON FUNCTION public.prune_bot_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_bot_logs() TO service_role;

-- ============ bridge_exec_sql RPC ============
CREATE OR REPLACE FUNCTION public.bridge_exec_sql(
  p_sql text,
  p_params jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql text := btrim(p_sql);
  v_lower text;
  v_rows jsonb;
  v_count integer;
BEGIN
  IF v_sql IS NULL OR v_sql = '' THEN
    RETURN jsonb_build_object('kind','error','message','empty sql');
  END IF;

  v_lower := lower(v_sql);

  -- Block reserved schemas
  IF v_lower ~ '(^|[^a-z_])(auth|storage|vault|realtime|supabase_functions)\.' THEN
    RETURN jsonb_build_object('kind','error','message','access to reserved schema is blocked');
  END IF;

  BEGIN
    IF v_lower ~ '^(select|with|table|values|show|explain)\y' THEN
      EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', v_sql)
        INTO v_rows;
      RETURN jsonb_build_object('kind','rows','data', v_rows, 'row_count', jsonb_array_length(v_rows));
    ELSE
      EXECUTE v_sql;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      RETURN jsonb_build_object('kind','exec','row_count', v_count);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'kind','error',
      'message', SQLERRM,
      'sqlstate', SQLSTATE
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.bridge_exec_sql(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_exec_sql(text,jsonb) TO service_role;
