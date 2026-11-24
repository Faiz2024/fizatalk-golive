CREATE OR REPLACE FUNCTION public.resume_channel_agent()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE channel_agent_state SET status = 'active', pause_reason = NULL, resume_at = NULL,
    lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE job_key = 'scheduler';
END;
$$;

REVOKE ALL ON FUNCTION public.resume_channel_agent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_channel_agent() TO service_role;