CREATE TABLE public.referral_reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  reward_type text NOT NULL CHECK (reward_type IN ('hour', 'day')),
  referrals_consumed integer NOT NULL CHECK (referrals_consumed IN (3, 10)),
  premium_seconds integer NOT NULL CHECK (premium_seconds IN (3600, 86400)),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.referral_reward_claims TO service_role;

ALTER TABLE public.referral_reward_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access referral reward claims"
ON public.referral_reward_claims
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_referral_reward_claims_user_created
ON public.referral_reward_claims (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_referral_status(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending integer := 0;
  v_total integer := 0;
  v_legacy_days integer := 0;
  v_new_days integer := 0;
  v_new_hours integer := 0;
  v_premium_until timestamptz;
  v_cashout_status text := 'none';
  v_draft jsonb;
BEGIN
  SELECT COALESCE(referral_qualified_count, 0), COALESCE(referral_rewards_claimed, 0), premium_until, cashout_draft
    INTO v_total, v_legacy_days, v_premium_until, v_draft
    FROM telegram_users WHERE id = p_user_id;

  SELECT COUNT(*) INTO v_pending
    FROM referrals
   WHERE referrer_id = p_user_id
     AND qualified_at IS NOT NULL
     AND consumed_at IS NULL;

  SELECT COUNT(*) FILTER (WHERE reward_type = 'day'),
         COUNT(*) FILTER (WHERE reward_type = 'hour')
    INTO v_new_days, v_new_hours
    FROM referral_reward_claims
   WHERE user_id = p_user_id;

  SELECT status INTO v_cashout_status
    FROM referral_cashouts
   WHERE user_id = p_user_id AND status IN ('pending', 'paid')
   LIMIT 1;

  RETURN json_build_object(
    'total_qualified', COALESCE(v_total, 0),
    'pending', COALESCE(v_pending, 0),
    'hour_progress', LEAST(COALESCE(v_pending, 0), 3),
    'hour_claimable', FLOOR(COALESCE(v_pending, 0) / 3.0)::int,
    'day_progress', LEAST(COALESCE(v_pending, 0), 10),
    'day_claimable', FLOOR(COALESCE(v_pending, 0) / 10.0)::int,
    'legacy_claimed_days', COALESCE(v_legacy_days, 0),
    'claimed_days', COALESCE(v_new_days, 0),
    'claimed_hours', COALESCE(v_new_hours, 0),
    'premium_until', v_premium_until,
    'cashout_status', COALESCE(v_cashout_status, 'none'),
    'cashout_target', 100,
    'cashout_amount', get_referral_cashout_amount(),
    'cashout_eligible', (COALESCE(v_total, 0) >= 100 AND v_cashout_status IS NULL),
    'cashout_draft', v_draft
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.claim_referral_reward(bigint);

CREATE FUNCTION public.claim_referral_reward(p_user_id bigint, p_reward_type text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending integer := 0;
  v_required integer;
  v_duration interval;
  v_seconds integer;
  v_new_until timestamptz;
  v_consumed integer := 0;
BEGIN
  IF p_reward_type = 'hour' THEN
    v_required := 3;
    v_duration := interval '1 hour';
    v_seconds := 3600;
  ELSIF p_reward_type = 'day' THEN
    v_required := 10;
    v_duration := interval '1 day';
    v_seconds := 86400;
  ELSE
    RETURN json_build_object('success', false, 'error', 'invalid_reward_type');
  END IF;

  IF NOT pg_try_advisory_xact_lock(p_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'concurrent_request');
  END IF;

  PERFORM 1 FROM telegram_users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  SELECT COUNT(*) INTO v_pending
    FROM referrals
   WHERE referrer_id = p_user_id
     AND qualified_at IS NOT NULL
     AND consumed_at IS NULL;

  IF v_pending < v_required THEN
    RETURN json_build_object(
      'success', false,
      'error', 'not_enough',
      'pending', v_pending,
      'needed', v_required - v_pending,
      'reward_type', p_reward_type
    );
  END IF;

  WITH picked AS (
    SELECT id
      FROM referrals
     WHERE referrer_id = p_user_id
       AND qualified_at IS NOT NULL
       AND consumed_at IS NULL
     ORDER BY qualified_at ASC, id ASC
     LIMIT v_required
     FOR UPDATE
  ), consumed AS (
    UPDATE referrals r
       SET consumed_at = now()
      FROM picked
     WHERE r.id = picked.id
     RETURNING r.id
  )
  SELECT COUNT(*) INTO v_consumed FROM consumed;

  IF v_consumed <> v_required THEN
    RAISE EXCEPTION 'referral_consume_mismatch';
  END IF;

  UPDATE telegram_users
     SET premium_until = GREATEST(COALESCE(premium_until, now()), now()) + v_duration
   WHERE id = p_user_id
   RETURNING premium_until INTO v_new_until;

  INSERT INTO referral_reward_claims (user_id, reward_type, referrals_consumed, premium_seconds)
  VALUES (p_user_id, p_reward_type, v_required, v_seconds);

  RETURN json_build_object(
    'success', true,
    'reward_type', p_reward_type,
    'premium_until', v_new_until,
    'pending', v_pending - v_required,
    'hour_claimable', FLOOR((v_pending - v_required) / 3.0)::int,
    'day_claimable', FLOOR((v_pending - v_required) / 10.0)::int
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_referral_reward(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral_reward(bigint, text) TO service_role;

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
         COUNT(*) FILTER (WHERE (qualified_at AT TIME ZONE 'Asia/Jakarta')::date = v_today)
    INTO v_new_today, v_qualified_today
    FROM referrals;

  SELECT GREATEST(
           0,
           (SELECT COUNT(*) FROM referrals WHERE (consumed_at AT TIME ZONE 'Asia/Jakarta')::date = v_today)
           - COALESCE((SELECT SUM(referrals_consumed) FROM referral_reward_claims WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_today), 0)
         ) / 3
         + (SELECT COUNT(*) FROM referral_reward_claims WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_today)
    INTO v_rewards_today;

  SELECT json_agg(row_to_json(t) ORDER BY t.date)
    INTO v_daily
    FROM (
      SELECT d::date AS date,
             COALESCE(r.baru, 0) AS baru,
             COALESCE(r.sah, 0) AS sah,
             ((GREATEST(0, COALESCE(r.consumed_count, 0) - COALESCE(c.consumed_logged, 0)) / 3) + COALESCE(c.claim_count, 0))::int AS hadiah
        FROM generate_series(v_today - 29, v_today, interval '1 day') d
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
                 COUNT(*) AS baru,
                 COUNT(*) FILTER (WHERE qualified_at IS NOT NULL) AS sah,
                 COUNT(*) FILTER (WHERE consumed_at IS NOT NULL) AS consumed_count
            FROM referrals
           WHERE created_at >= (v_today - 29)::timestamp AT TIME ZONE 'Asia/Jakarta'
           GROUP BY 1
        ) r ON r.tgl = d::date
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
                 COUNT(*) AS claim_count,
                 SUM(referrals_consumed) AS consumed_logged
            FROM referral_reward_claims
           WHERE created_at >= (v_today - 29)::timestamp AT TIME ZONE 'Asia/Jakarta'
           GROUP BY 1
        ) c ON c.tgl = d::date
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