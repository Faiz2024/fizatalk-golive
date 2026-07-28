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
AS $$
DECLARE
    v_user RECORD;
BEGIN
    -- Get user data with FOR UPDATE to prevent race conditions
    SELECT * INTO v_user
    FROM public.telegram_users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- 1. Check if never premium
    IF v_user.premium_until IS NOT NULL THEN
        RETURN FALSE;
    END IF;

    -- 2. Check if already received promo
    IF v_user.has_received_special_promo = TRUE THEN
        RETURN FALSE;
    END IF;

    -- 3. Check created_at (must be >= 7 days ago)
    IF v_user.created_at > (NOW() - INTERVAL '7 days') THEN
        RETURN FALSE;
    END IF;

    -- 4. Validasi Waktu Aktif (3 Jam): last_active >= CURRENT_DATE AND <= NOW() - 3 hours
    IF v_user.last_active < CURRENT_DATE OR v_user.last_active > (NOW() - INTERVAL '3 hours') THEN
        RETURN FALSE;
    END IF;

    -- 5. Re-engagement Check
    IF v_user.last_reengagement_sent_at IS NOT NULL THEN
        IF v_user.last_reengagement_sent_at > (NOW() - INTERVAL '7 days') THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- 6. Block Check (if they were blocked in blocked_users, unblocked_at must be <= NOW() - 7 days)
    IF EXISTS (
        SELECT 1 FROM public.blocked_users 
        WHERE user_id = p_user_id 
        AND (is_active = true OR unblocked_at > (NOW() - INTERVAL '7 days'))
    ) THEN
        RETURN FALSE;
    END IF;

    -- 7. Regular Promo Check (last_promo_sent_at > 1 hour ago)
    IF v_user.last_promo_sent_at IS NOT NULL THEN
        IF v_user.last_promo_sent_at > (NOW() - INTERVAL '1 hour') THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- If all checks passed, we claim it
    UPDATE public.telegram_users
    SET has_received_special_promo = true,
        special_promo_sent_at = NOW(),
        last_promo_sent_at = NOW() -- prevent regular promo collision
    WHERE id = p_user_id;

    RETURN TRUE;
END;
$$;
