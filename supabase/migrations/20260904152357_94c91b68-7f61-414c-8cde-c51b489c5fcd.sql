CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id bigint NOT NULL,
  referred_id bigint NOT NULL UNIQUE,
  qualified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access referrals" ON public.referrals FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_pending_claim ON public.referrals (referrer_id) WHERE qualified_at IS NOT NULL AND consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON public.referrals (created_at);

ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS referred_by bigint,
  ADD COLUMN IF NOT EXISTS referral_qualified_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_rewards_claimed integer NOT NULL DEFAULT 0;

-- Catat undangan (hanya untuk user baru)
CREATE OR REPLACE FUNCTION public.register_referral(p_new_user_id bigint, p_referrer_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_exists boolean;
BEGIN
  IF p_new_user_id IS NULL OR p_referrer_id IS NULL OR p_new_user_id = p_referrer_id THEN
    RETURN json_build_object('success', false, 'error', 'invalid');
  END IF;

  SELECT TRUE INTO v_exists FROM telegram_users WHERE id = p_referrer_id;
  IF v_exists IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'referrer_not_found');
  END IF;

  IF EXISTS (SELECT 1 FROM telegram_users WHERE id = p_new_user_id AND (referred_by IS NOT NULL OR created_at < now() - interval '1 hour')) THEN
    RETURN json_build_object('success', false, 'error', 'not_eligible');
  END IF;

  INSERT INTO referrals (referrer_id, referred_id)
  VALUES (p_referrer_id, p_new_user_id)
  ON CONFLICT (referred_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'already_referred');
  END IF;

  UPDATE telegram_users SET referred_by = p_referrer_id WHERE id = p_new_user_id;
  RETURN json_build_object('success', true);
END;
$fn$;

-- Undangan menjadi sah saat teman mendapatkan chat pertama
CREATE OR REPLACE FUNCTION public.qualify_referral_on_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  UPDATE referrals
     SET qualified_at = now()
   WHERE referred_id = NEW.id AND qualified_at IS NULL;

  IF FOUND THEN
    UPDATE telegram_users
       SET referral_qualified_count = COALESCE(referral_qualified_count, 0) + 1
     WHERE id = NEW.referred_by;
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_qualify_referral_on_chat ON public.telegram_users;
CREATE TRIGGER trg_qualify_referral_on_chat
AFTER UPDATE OF state ON public.telegram_users
FOR EACH ROW
WHEN (NEW.state = 'chatting' AND OLD.state IS DISTINCT FROM 'chatting' AND NEW.referred_by IS NOT NULL)
EXECUTE FUNCTION public.qualify_referral_on_chat();

-- Status referal untuk menu bot
CREATE OR REPLACE FUNCTION public.get_referral_status(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pending integer := 0;
  v_total integer := 0;
  v_claimed integer := 0;
  v_premium_until timestamptz;
BEGIN
  SELECT COALESCE(referral_qualified_count, 0), COALESCE(referral_rewards_claimed, 0), premium_until
    INTO v_total, v_claimed, v_premium_until
    FROM telegram_users WHERE id = p_user_id;

  SELECT COUNT(*) INTO v_pending
    FROM referrals WHERE referrer_id = p_user_id AND qualified_at IS NOT NULL AND consumed_at IS NULL;

  RETURN json_build_object(
    'total_qualified', COALESCE(v_total, 0),
    'pending', COALESCE(v_pending, 0),
    'progress', COALESCE(v_pending, 0) % 3,
    'claimable', FLOOR(COALESCE(v_pending, 0) / 3.0)::int,
    'rewards_claimed', COALESCE(v_claimed, 0),
    'premium_until', v_premium_until
  );
END;
$fn$;

-- Klaim hadiah 1 hari premium per 3 teman sah (atomik, anti klik ganda)
CREATE OR REPLACE FUNCTION public.claim_referral_reward(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pending integer := 0;
  v_new_until timestamptz;
BEGIN
  IF NOT pg_try_advisory_xact_lock(p_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'concurrent_request');
  END IF;

  PERFORM 1 FROM telegram_users WHERE id = p_user_id FOR UPDATE;

  SELECT COUNT(*) INTO v_pending
    FROM referrals WHERE referrer_id = p_user_id AND qualified_at IS NOT NULL AND consumed_at IS NULL;

  IF v_pending < 3 THEN
    RETURN json_build_object('success', false, 'error', 'not_enough', 'pending', v_pending, 'needed', 3 - v_pending);
  END IF;

  UPDATE referrals SET consumed_at = now()
   WHERE id IN (
     SELECT id FROM referrals
      WHERE referrer_id = p_user_id AND qualified_at IS NOT NULL AND consumed_at IS NULL
      ORDER BY qualified_at ASC
      LIMIT 3
   );

  UPDATE telegram_users
     SET premium_until = GREATEST(COALESCE(premium_until, now()), now()) + interval '1 day',
         referral_rewards_claimed = COALESCE(referral_rewards_claimed, 0) + 1
   WHERE id = p_user_id
   RETURNING premium_until INTO v_new_until;

  RETURN json_build_object('success', true, 'premium_until', v_new_until, 'pending', v_pending - 3, 'claimable', FLOOR((v_pending - 3) / 3.0)::int);
END;
$fn$;

-- Statistik referal untuk dashboard admin (30 hari terakhir, WIB)
CREATE OR REPLACE FUNCTION public.get_referral_stats()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_daily json;
  v_new_today integer := 0;
  v_qualified_today integer := 0;
  v_rewards_today integer := 0;
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

  RETURN json_build_object(
    'newToday', v_new_today,
    'qualifiedToday', v_qualified_today,
    'rewardsToday', v_rewards_today,
    'daily', COALESCE(v_daily, '[]'::json)
  );
END;
$fn$;