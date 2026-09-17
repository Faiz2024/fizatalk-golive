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

  SELECT ((GREATEST(0, COALESCE(x.consumed_count, 0) - COALESCE(x.consumed_logged, 0)) / 3) + COALESCE(x.claim_count, 0))::int
    INTO v_rewards_today
    FROM (
      SELECT
        (SELECT COUNT(*) FROM referrals WHERE (consumed_at AT TIME ZONE 'Asia/Jakarta')::date = v_today) AS consumed_count,
        (SELECT COALESCE(SUM(referrals_consumed), 0) FROM referral_reward_claims WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_today) AS consumed_logged,
        (SELECT COUNT(*) FROM referral_reward_claims WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date = v_today) AS claim_count
    ) x;

  SELECT json_agg(row_to_json(t) ORDER BY t.date)
    INTO v_daily
    FROM (
      SELECT d::date AS date,
             COALESCE(created_stats.baru, 0) AS baru,
             COALESCE(qualified_stats.sah, 0) AS sah,
             ((GREATEST(0, COALESCE(consumed_stats.consumed_count, 0) - COALESCE(claim_stats.consumed_logged, 0)) / 3) + COALESCE(claim_stats.claim_count, 0))::int AS hadiah
        FROM generate_series(v_today - 29, v_today, interval '1 day') d
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl, COUNT(*) AS baru
            FROM referrals
           WHERE created_at >= (v_today - 29)::timestamp AT TIME ZONE 'Asia/Jakarta'
           GROUP BY 1
        ) created_stats ON created_stats.tgl = d::date
        LEFT JOIN (
          SELECT (qualified_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl, COUNT(*) AS sah
            FROM referrals
           WHERE qualified_at >= (v_today - 29)::timestamp AT TIME ZONE 'Asia/Jakarta'
           GROUP BY 1
        ) qualified_stats ON qualified_stats.tgl = d::date
        LEFT JOIN (
          SELECT (consumed_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl, COUNT(*) AS consumed_count
            FROM referrals
           WHERE consumed_at >= (v_today - 29)::timestamp AT TIME ZONE 'Asia/Jakarta'
           GROUP BY 1
        ) consumed_stats ON consumed_stats.tgl = d::date
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
                 COUNT(*) AS claim_count,
                 SUM(referrals_consumed) AS consumed_logged
            FROM referral_reward_claims
           WHERE created_at >= (v_today - 29)::timestamp AT TIME ZONE 'Asia/Jakarta'
           GROUP BY 1
        ) claim_stats ON claim_stats.tgl = d::date
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