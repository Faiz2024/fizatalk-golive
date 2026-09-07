-- 1) Ubah default nominal bonus
ALTER TABLE public.referral_cashouts ALTER COLUMN amount SET DEFAULT 50000;

-- 2) Perbarui nilai cashout_amount yang dikembalikan ke bot
CREATE OR REPLACE FUNCTION public.get_referral_status(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    'cashout_amount', 50000,
    'cashout_eligible', (COALESCE(v_total, 0) >= 100 AND v_cashout_status IS NULL),
    'cashout_draft', v_draft
  );
END;
$$;

-- 3) Perbarui nominal amount yang dikembalikan saat membuat permintaan
CREATE OR REPLACE FUNCTION public.request_referral_cashout(p_user_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_draft jsonb;
  v_existing text;
  v_id uuid;
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

  INSERT INTO referral_cashouts (user_id, ewallet_type, ewallet_number, ewallet_name, qualified_at_request)
  VALUES (p_user_id, v_draft->>'type', v_draft->>'number', v_draft->>'name', v_total)
  RETURNING id INTO v_id;

  UPDATE telegram_users SET cashout_draft = NULL WHERE id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'id', v_id,
    'amount', 50000,
    'type', v_draft->>'type',
    'number', v_draft->>'number',
    'name', v_draft->>'name',
    'total_qualified', v_total
  );
EXCEPTION WHEN unique_violation THEN
  UPDATE telegram_users SET cashout_draft = NULL WHERE id = p_user_id;
  RETURN json_build_object('success', false, 'error', 'already_requested');
END;
$$;