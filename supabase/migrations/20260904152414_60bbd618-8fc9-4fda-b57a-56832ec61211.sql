REVOKE EXECUTE ON FUNCTION public.register_referral(bigint, bigint) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.get_referral_status(bigint) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.claim_referral_reward(bigint) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.get_referral_stats() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.qualify_referral_on_chat() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.register_referral(bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_referral_status(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_referral_reward(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_referral_stats() TO service_role;