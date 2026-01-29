-- =====================================================
-- RPC: Update last_active only once per day
-- This is the most cost-effective way to track user activity
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_last_active_daily(p_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last_active TIMESTAMP WITH TIME ZONE;
  v_today DATE;
BEGIN
  -- Get user's current last_active
  SELECT last_active INTO v_last_active
  FROM telegram_users
  WHERE id = p_user_id;
  
  -- If user doesn't exist, return false
  IF v_last_active IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Get today's date
  v_today := CURRENT_DATE;
  
  -- Only update if last_active is not today (saves write operations)
  IF v_last_active::DATE < v_today THEN
    UPDATE telegram_users
    SET last_active = NOW()
    WHERE id = p_user_id;
    RETURN TRUE; -- Updated
  END IF;
  
  RETURN FALSE; -- Not updated (already active today)
END;
$function$;

-- =====================================================
-- RPC: Check if user should see channel join message
-- Returns TRUE if user needs to join channel (registered > 1 week)
-- Returns FALSE if user is new (< 1 week) - skip channel check
-- =====================================================
CREATE OR REPLACE FUNCTION public.should_show_channel_join(p_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_created_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Get user's registration date
  SELECT created_at INTO v_created_at
  FROM telegram_users
  WHERE id = p_user_id;
  
  -- If user doesn't exist, return false (skip channel check)
  IF v_created_at IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Only show channel join message if user registered more than 1 week ago
  IF v_created_at < NOW() - INTERVAL '7 days' THEN
    RETURN TRUE; -- User should see channel join message
  END IF;
  
  RETURN FALSE; -- User is new, skip channel check
END;
$function$;

-- =====================================================
-- RPC: Batch upsert user (optimized for cloud cost)
-- Only updates username/first_name if changed, and 
-- conditionally updates last_active (once per day)
-- =====================================================
CREATE OR REPLACE FUNCTION public.upsert_user_optimized(
  p_user_id BIGINT,
  p_username TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_update_last_active BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing RECORD;
  v_needs_update BOOLEAN := FALSE;
  v_last_active_updated BOOLEAN := FALSE;
  v_is_new_user BOOLEAN := FALSE;
BEGIN
  -- Check if user exists and get current data
  SELECT id, username, first_name, last_active
  INTO v_existing
  FROM telegram_users
  WHERE id = p_user_id;
  
  IF v_existing IS NULL THEN
    -- New user - insert
    INSERT INTO telegram_users (id, username, first_name, last_active)
    VALUES (p_user_id, p_username, p_first_name, NOW());
    v_is_new_user := TRUE;
    v_last_active_updated := TRUE;
  ELSE
    -- Existing user - check if update needed
    IF (v_existing.username IS DISTINCT FROM p_username) OR 
       (v_existing.first_name IS DISTINCT FROM p_first_name) THEN
      v_needs_update := TRUE;
    END IF;
    
    -- Check if last_active needs update (only once per day)
    IF p_update_last_active AND v_existing.last_active::DATE < CURRENT_DATE THEN
      v_last_active_updated := TRUE;
      v_needs_update := TRUE;
    END IF;
    
    -- Only update if something changed
    IF v_needs_update THEN
      IF v_last_active_updated THEN
        UPDATE telegram_users
        SET username = p_username,
            first_name = p_first_name,
            last_active = NOW()
        WHERE id = p_user_id;
      ELSE
        UPDATE telegram_users
        SET username = p_username,
            first_name = p_first_name
        WHERE id = p_user_id;
      END IF;
    END IF;
  END IF;
  
  RETURN jsonb_build_object(
    'is_new_user', v_is_new_user,
    'last_active_updated', v_last_active_updated,
    'updated', v_needs_update OR v_is_new_user
  );
END;
$function$;