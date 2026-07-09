-- =====================================================
-- Migration: Add TikTok Live Mode toggle support
-- Adds is_tiktok_mode column and toggle RPC function
-- =====================================================

-- 1. Add column for tracking TikTok Live Mode status
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS is_tiktok_mode BOOLEAN DEFAULT FALSE;

-- 2. Create toggle function
CREATE OR REPLACE FUNCTION public.toggle_tiktok_mode(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_state BOOLEAN;
BEGIN
  UPDATE telegram_users
  SET is_tiktok_mode = NOT COALESCE(is_tiktok_mode, FALSE)
  WHERE id = p_user_id
  RETURNING is_tiktok_mode INTO v_new_state;

  IF v_new_state IS NULL THEN
    RETURN json_build_object('is_active', FALSE);
  END IF;

  RETURN json_build_object('is_active', v_new_state);
END;
$function$;

-- Grant execute on function to authenticated and service role
GRANT EXECUTE ON FUNCTION public.toggle_tiktok_mode(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_tiktok_mode(BIGINT) TO service_role;