-- =====================================================
-- Update RPC: get_promo_eligible_users to EXCLUDE premium users
-- This saves cloud costs by not sending promos to premium users
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_promo_eligible_users()
RETURNS TABLE(user_id BIGINT, current_state TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    tu.id as user_id,
    tu.state::TEXT as current_state
  FROM telegram_users tu
  WHERE 
    -- EXCLUDE premium users (no need to send promo to them)
    (tu.premium_until IS NULL OR tu.premium_until <= NOW())
    AND
    (
      -- User sedang chatting (apapun last_active nya)
      tu.state = 'chatting'
      OR 
      -- User idle yang aktif dalam 5 jam terakhir
      (tu.state = 'idle' AND tu.last_active > NOW() - INTERVAL '5 hours')
    )
  ORDER BY tu.last_active DESC;
END;
$function$;