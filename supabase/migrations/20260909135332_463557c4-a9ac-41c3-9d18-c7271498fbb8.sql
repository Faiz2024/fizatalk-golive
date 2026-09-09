INSERT INTO public.bot_settings (key, value) VALUES ('referral_cashout_amount', '50000')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_referral_cashout_amount()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT NULLIF(regexp_replace(value, '\D', '', 'g'), '')::int FROM bot_settings WHERE key = 'referral_cashout_amount'), 50000);
$$;

CREATE OR REPLACE FUNCTION public.set_referral_cashout_amount(p_amount integer, p_admin_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old integer;
BEGIN
  IF p_amount IS NULL OR p_amount < 10000 OR p_amount > 1000000 OR (p_amount % 1000) <> 0 THEN
    RETURN json_build_object('success', false, 'error', 'invalid_amount');
  END IF;

  v_old := get_referral_cashout_amount();

  INSERT INTO bot_settings (key, value, updated_at, updated_by)
  VALUES ('referral_cashout_amount', p_amount::text, now(), p_admin_id)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;

  RETURN json_build_object('success', true, 'old_amount', v_old, 'new_amount', p_amount, 'changed', v_old IS DISTINCT FROM p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_referral_status(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending integer := 0;
  v_total integer := 0;
  v_claimed integer := 0;
  v_premium_until timestamptz;
  v_cashout_status text := 'none';
  v_draft jsonb;
BEGIN
  SELECT COALESCE(referral_qualified_count, 0), COALESCE(referral_rewards_claimed, 0), premium_until, cashout_draft
    INTO v_total, v_claimed, v_premium_until, v_draft
    FROM telegram_users WHERE id = p_user_id;

  SELECT COUNT(*) INTO v_pending
    FROM referrals WHERE referrer_id = p_user_id AND qualified_at IS NOT NULL AND consumed_at IS NULL;

  SELECT status INTO v_cashout_status
    FROM referral_cashouts
    WHERE user_id = p_user_id AND status IN ('pending', 'paid')
    LIMIT 1;

  RETURN json_build_object(
    'total_qualified', COALESCE(v_total, 0),
    'pending', COALESCE(v_pending, 0),
    'progress', COALESCE(v_pending, 0) % 3,
    'claimable', FLOOR(COALESCE(v_pending, 0) / 3.0)::int,
    'rewards_claimed', COALESCE(v_claimed, 0),
    'premium_until', v_premium_until,
    'cashout_status', COALESCE(v_cashout_status, 'none'),
    'cashout_target', 100,
    'cashout_amount', get_referral_cashout_amount(),
    'cashout_eligible', (COALESCE(v_total, 0) >= 100 AND v_cashout_status IS NULL),
    'cashout_draft', v_draft
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_referral_cashout(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer := 0;
  v_draft jsonb;
  v_existing text;
  v_id uuid;
  v_amount integer;
BEGIN
  SELECT COALESCE(referral_qualified_count, 0), cashout_draft
    INTO v_total, v_draft
    FROM telegram_users WHERE id = p_user_id FOR UPDATE;

  IF v_draft IS NULL OR COALESCE(v_draft->>'type', '') = ''
     OR COALESCE(v_draft->>'number', '') = '' OR COALESCE(v_draft->>'name', '') = '' THEN
    RETURN json_build_object('success', false, 'error', 'incomplete_draft');
  END IF;

  SELECT status INTO v_existing FROM referral_cashouts
    WHERE user_id = p_user_id AND status IN ('pending', 'paid') LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE telegram_users SET cashout_draft = NULL WHERE id = p_user_id;
    RETURN json_build_object('success', false, 'error', 'already_requested', 'status', v_existing);
  END IF;

  IF v_total < 100 THEN
    RETURN json_build_object('success', false, 'error', 'not_enough', 'needed', 100 - v_total);
  END IF;

  v_amount := get_referral_cashout_amount();

  INSERT INTO referral_cashouts (user_id, amount, ewallet_type, ewallet_number, ewallet_name, qualified_at_request)
  VALUES (p_user_id, v_amount, v_draft->>'type', v_draft->>'number', v_draft->>'name', v_total)
  RETURNING id INTO v_id;

  UPDATE telegram_users SET cashout_draft = NULL WHERE id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'id', v_id,
    'amount', v_amount,
    'type', v_draft->>'type',
    'number', v_draft->>'number',
    'name', v_draft->>'name',
    'total_qualified', v_total
  );
EXCEPTION WHEN unique_violation THEN
  UPDATE telegram_users SET cashout_draft = NULL WHERE id = p_user_id;
  RETURN json_build_object('success', false, 'error', 'already_requested');
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_telegram_users_referral_qualified
  ON public.telegram_users (referral_qualified_count)
  WHERE referral_qualified_count > 0;

CREATE OR REPLACE FUNCTION public.get_referral_stats()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_daily json;
  v_new_today integer := 0;
  v_qualified_today integer := 0;
  v_rewards_today integer := 0;
  v_dist json;
BEGIN
  SELECT COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_today),
         COUNT(*) FILTER (WHERE (qualified_at AT TIME ZONE 'Asia/Jakarta')::date = v_today),
         (COUNT(*) FILTER (WHERE (consumed_at AT TIME ZONE 'Asia/Jakarta')::date = v_today) / 3)::int
    INTO v_new_today, v_qualified_today, v_rewards_today
    FROM referrals;

  SELECT json_agg(row_to_json(t) ORDER BY t.date)
    INTO v_daily
    FROM (
      SELECT d::date AS date,
             COALESCE(r.baru, 0) AS baru,
             COALESCE(r.sah, 0) AS sah,
             COALESCE(r.hadiah, 0) AS hadiah
        FROM generate_series(v_today - 29, v_today, interval '1 day') d
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
                 COUNT(*) AS baru,
                 COUNT(*) FILTER (WHERE qualified_at IS NOT NULL) AS sah,
                 (COUNT(*) FILTER (WHERE consumed_at IS NOT NULL) / 3)::int AS hadiah
            FROM referrals
           WHERE created_at >= (v_today - 29)::timestamp AT TIME ZONE 'Asia/Jakarta'
           GROUP BY 1
        ) r ON r.tgl = d::date
    ) t;

  SELECT json_build_object(
           'r1_50', COUNT(*) FILTER (WHERE q BETWEEN 1 AND 50),
           'r51_80', COUNT(*) FILTER (WHERE q BETWEEN 51 AND 80),
           'r81_99', COUNT(*) FILTER (WHERE q BETWEEN 81 AND 99),
           'r100_no_cashout', COUNT(*) FILTER (WHERE q >= 100 AND NOT has_cashout),
           'r100_cashout', COUNT(*) FILTER (WHERE q >= 100 AND has_cashout),
           'total', COUNT(*)
         )
    INTO v_dist
    FROM (
      SELECT u.referral_qualified_count AS q,
             EXISTS (SELECT 1 FROM referral_cashouts c WHERE c.user_id = u.id AND c.status IN ('pending','paid')) AS has_cashout
        FROM telegram_users u
       WHERE u.referral_qualified_count > 0
    ) s;

  RETURN json_build_object(
    'newToday', v_new_today,
    'qualifiedToday', v_qualified_today,
    'rewardsToday', v_rewards_today,
    'daily', COALESCE(v_daily, '[]'::json),
    'distribution', v_dist,
    'cashoutAmount', get_referral_cashout_amount()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_referral_cashout_amount() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_referral_cashout_amount(integer, bigint) FROM PUBLIC, anon, authenticated;