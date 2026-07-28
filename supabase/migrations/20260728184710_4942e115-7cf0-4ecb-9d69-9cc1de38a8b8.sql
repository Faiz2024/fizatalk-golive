-- 1. Add columns to telegram_users
ALTER TABLE public.telegram_users
ADD COLUMN IF NOT EXISTS has_received_special_promo BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS special_promo_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS special_promo_purchased_at TIMESTAMPTZ;

-- 2. Create the RPC function
CREATE OR REPLACE FUNCTION check_and_claim_special_promo(p_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user RECORD;
BEGIN
    SELECT * INTO v_user FROM public.telegram_users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    IF v_user.premium_until IS NOT NULL THEN RETURN FALSE; END IF;
    IF v_user.has_received_special_promo = TRUE THEN RETURN FALSE; END IF;
    IF v_user.created_at > (NOW() - INTERVAL '7 days') THEN RETURN FALSE; END IF;
    IF v_user.last_active < CURRENT_DATE OR v_user.last_active > (NOW() - INTERVAL '3 hours') THEN RETURN FALSE; END IF;
    IF v_user.last_reengagement_sent_at IS NOT NULL THEN
        IF v_user.last_reengagement_sent_at > (NOW() - INTERVAL '7 days') THEN RETURN FALSE; END IF;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.blocked_users
        WHERE user_id = p_user_id
        AND (is_active = true OR unblocked_at > (NOW() - INTERVAL '7 days'))
    ) THEN RETURN FALSE; END IF;
    IF v_user.last_promo_sent_at IS NOT NULL THEN
        IF v_user.last_promo_sent_at > (NOW() - INTERVAL '1 hour') THEN RETURN FALSE; END IF;
    END IF;
    UPDATE public.telegram_users
    SET has_received_special_promo = true,
        special_promo_sent_at = NOW(),
        last_promo_sent_at = NOW()
    WHERE id = p_user_id;
    RETURN TRUE;
END;
$$;

-- 3. Update comprehensive_search_action and get_admin_dashboard_stats from the versioned migration files
-- (loaded from combined SQL below)