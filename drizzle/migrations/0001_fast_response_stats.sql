ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS total_response_time_seconds bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_response_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.add_response_stats(p_user_id bigint, p_seconds bigint, p_count integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.telegram_users
     SET total_response_time_seconds = total_response_time_seconds + GREATEST(p_seconds,0),
         total_response_count = total_response_count + GREATEST(p_count,0)
   WHERE id = p_user_id AND p_count > 0;
$$;
REVOKE ALL ON FUNCTION public.add_response_stats(bigint,bigint,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_response_stats(bigint,bigint,integer) TO service_role;