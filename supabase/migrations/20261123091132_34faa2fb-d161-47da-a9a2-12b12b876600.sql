ALTER FUNCTION public.get_admin_dashboard_stats(boolean) RENAME TO refresh_admin_dashboard_stats_uncached;
ALTER FUNCTION public.refresh_admin_dashboard_stats_uncached(boolean) SET statement_timeout = '8s';

CREATE FUNCTION public.get_admin_dashboard_stats(p_force boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_cached text;
  v_cached_at timestamptz;
  v_result json;
BEGIN
  SELECT
    MAX(value) FILTER (WHERE key = 'admin_dashboard_stats_cache'),
    MAX(value) FILTER (WHERE key = 'admin_dashboard_stats_cached_at')::timestamptz
  INTO v_cached, v_cached_at
  FROM bot_settings
  WHERE key IN ('admin_dashboard_stats_cache', 'admin_dashboard_stats_cached_at');

  IF NOT p_force AND v_cached IS NOT NULL
    AND v_cached_at IS NOT NULL AND v_cached_at > NOW() - INTERVAL '5 minutes' THEN
    RETURN v_cached::json;
  END IF;

  -- Satu penghitungan saja; permintaan lain langsung memakai hasil terakhir.
  IF NOT pg_try_advisory_xact_lock(86215001) THEN
    IF v_cached IS NOT NULL THEN
      RETURN v_cached::json;
    END IF;
    PERFORM pg_advisory_xact_lock(86215001);

    SELECT
      MAX(value) FILTER (WHERE key = 'admin_dashboard_stats_cache'),
      MAX(value) FILTER (WHERE key = 'admin_dashboard_stats_cached_at')::timestamptz
    INTO v_cached, v_cached_at
    FROM bot_settings
    WHERE key IN ('admin_dashboard_stats_cache', 'admin_dashboard_stats_cached_at');
    IF v_cached IS NOT NULL AND v_cached_at IS NOT NULL
      AND v_cached_at > NOW() - INTERVAL '5 minutes' THEN
      RETURN v_cached::json;
    END IF;
  END IF;

  v_result := refresh_admin_dashboard_stats_uncached(p_force);
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  -- Timeout atau gangguan database tidak boleh mengosongkan dashboard.
  IF v_cached IS NOT NULL THEN
    RETURN v_cached::json;
  END IF;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_admin_dashboard_stats_uncached(boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_dashboard_stats(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats(boolean) TO service_role;

ALTER FUNCTION public.get_referral_stats() RENAME TO refresh_referral_stats_uncached;
ALTER FUNCTION public.refresh_referral_stats_uncached() SET statement_timeout = '8s';

CREATE FUNCTION public.get_referral_stats()
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_cached text;
  v_cached_at timestamptz;
  v_result json;
BEGIN
  SELECT
    MAX(value) FILTER (WHERE key = 'referral_stats_cache'),
    MAX(value) FILTER (WHERE key = 'referral_stats_cached_at')::timestamptz
  INTO v_cached, v_cached_at
  FROM bot_settings
  WHERE key IN ('referral_stats_cache', 'referral_stats_cached_at');

  IF v_cached IS NOT NULL AND v_cached_at IS NOT NULL
    AND v_cached_at > NOW() - INTERVAL '5 minutes' THEN
    RETURN v_cached::json;
  END IF;

  IF NOT pg_try_advisory_xact_lock(86215002) THEN
    IF v_cached IS NOT NULL THEN
      RETURN v_cached::json;
    END IF;
    PERFORM pg_advisory_xact_lock(86215002);

    SELECT
      MAX(value) FILTER (WHERE key = 'referral_stats_cache'),
      MAX(value) FILTER (WHERE key = 'referral_stats_cached_at')::timestamptz
    INTO v_cached, v_cached_at
    FROM bot_settings
    WHERE key IN ('referral_stats_cache', 'referral_stats_cached_at');
    IF v_cached IS NOT NULL AND v_cached_at IS NOT NULL
      AND v_cached_at > NOW() - INTERVAL '5 minutes' THEN
      RETURN v_cached::json;
    END IF;
  END IF;

  v_result := refresh_referral_stats_uncached();
  INSERT INTO bot_settings (key, value, updated_at)
  VALUES ('referral_stats_cache', v_result::text, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  INSERT INTO bot_settings (key, value, updated_at)
  VALUES ('referral_stats_cached_at', NOW()::text, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  IF v_cached IS NOT NULL THEN
    RETURN v_cached::json;
  END IF;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_referral_stats_uncached() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_referral_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_referral_stats() TO service_role;