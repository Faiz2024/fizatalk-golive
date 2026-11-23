ALTER FUNCTION public.refresh_admin_dashboard_stats_uncached(boolean) SET statement_timeout = '3s';
ALTER FUNCTION public.get_admin_dashboard_stats(boolean) SET statement_timeout = '4s';
ALTER FUNCTION public.refresh_referral_stats_uncached() SET statement_timeout = '3s';
ALTER FUNCTION public.get_referral_stats() SET statement_timeout = '4s';