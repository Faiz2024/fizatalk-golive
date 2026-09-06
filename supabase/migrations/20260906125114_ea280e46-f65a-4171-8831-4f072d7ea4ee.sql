-- 1) Kolom draft pengisian e-wallet
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS cashout_draft jsonb;

-- 2) Tabel permintaan penarikan bonus referal
CREATE TABLE IF NOT EXISTS public.referral_cashouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  amount integer NOT NULL DEFAULT 20000,
  ewallet_type text NOT NULL,
  ewallet_number text NOT NULL,
  ewallet_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  qualified_at_request integer NOT NULL DEFAULT 0,
  admin_message_id integer,
  admin_notes text,
  processed_by bigint,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')
);

GRANT ALL ON public.referral_cashouts TO service_role;

ALTER TABLE public.referral_cashouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access referral_cashouts" ON public.referral_cashouts;
CREATE POLICY "Service role full access referral_cashouts"
  ON public.referral_cashouts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_referral_cashout_active
  ON public.referral_cashouts (user_id)
  WHERE status IN ('pending', 'paid');

CREATE INDEX IF NOT EXISTS idx_referral_cashouts_status ON public.referral_cashouts (status, created_at DESC);

-- 3) Status referal + info bonus
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
    'cashout_amount', 20000,
    'cashout_eligible', (COALESCE(v_total, 0) >= 100 AND v_cashout_status IS NULL),
    'cashout_draft', v_draft
  );
END;
$$;

-- 4) Mulai / simpan draft pengisian data e-wallet
CREATE OR REPLACE FUNCTION public.set_referral_cashout_draft(p_user_id bigint, p_draft jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_existing text;
BEGIN
  SELECT COALESCE(referral_qualified_count, 0) INTO v_total
    FROM telegram_users WHERE id = p_user_id FOR UPDATE;

  IF v_total IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  SELECT status INTO v_existing FROM referral_cashouts
    WHERE user_id = p_user_id AND status IN ('pending', 'paid') LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'already_requested', 'status', v_existing);
  END IF;

  IF v_total < 100 THEN
    RETURN json_build_object('success', false, 'error', 'not_enough', 'needed', 100 - v_total, 'total_qualified', v_total);
  END IF;

  UPDATE telegram_users SET cashout_draft = p_draft WHERE id = p_user_id;

  RETURN json_build_object('success', true, 'draft', p_draft, 'total_qualified', v_total);
END;
$$;

-- 5) Kirim permintaan penarikan (atomik, dari draft)
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
    'amount', 20000,
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

-- 6) Admin: tandai sudah dikirim / tolak (sekali saja)
CREATE OR REPLACE FUNCTION public.process_referral_cashout(p_request_id uuid, p_action text, p_admin_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row referral_cashouts%ROWTYPE;
BEGIN
  IF p_action NOT IN ('paid', 'rejected') THEN
    RETURN json_build_object('success', false, 'error', 'invalid_action');
  END IF;

  UPDATE referral_cashouts
     SET status = p_action,
         processed_by = p_admin_id,
         processed_at = (now() AT TIME ZONE 'Asia/Jakarta'),
         updated_at = (now() AT TIME ZONE 'Asia/Jakarta')
   WHERE id = p_request_id AND status = 'pending'
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'already_processed');
  END IF;

  RETURN json_build_object(
    'success', true,
    'user_id', v_row.user_id,
    'amount', v_row.amount,
    'type', v_row.ewallet_type,
    'number', v_row.ewallet_number,
    'name', v_row.ewallet_name,
    'status', v_row.status
  );
END;
$$;

-- 7) Simpan id pesan admin untuk pembaruan status
CREATE OR REPLACE FUNCTION public.set_referral_cashout_admin_message(p_request_id uuid, p_message_id integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE referral_cashouts SET admin_message_id = p_message_id, updated_at = (now() AT TIME ZONE 'Asia/Jakarta')
  WHERE id = p_request_id;
$$;