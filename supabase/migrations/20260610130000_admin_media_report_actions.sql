-- =============================================================================
-- Migration: Admin Media Report Actions
-- Description: RPC for processing admin actions (warn/block) on reported media
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_process_media_report(p_sender_id bigint, p_action text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_penalty INTEGER;
BEGIN
  IF p_action = 'warn' THEN
    UPDATE telegram_users 
    SET penalty_points = COALESCE(penalty_points, 0) + 15
    WHERE id = p_sender_id
    RETURNING penalty_points INTO v_new_penalty;
    
    RETURN json_build_object('success', true, 'action', 'warned', 'new_penalty', v_new_penalty);
    
  ELSIF p_action = 'block' THEN
    INSERT INTO blocked_users (user_id, reason, blocked_message, is_active)
    VALUES (p_sender_id, 'admin_media_block', 'Akun diblokir oleh Admin karena mengirim media terlarang.', true)
    ON CONFLICT DO NOTHING;
    
    UPDATE telegram_users SET penalty_points = 100 WHERE id = p_sender_id;
    
    RETURN json_build_object('success', true, 'action', 'blocked');
  END IF;
  
  RETURN json_build_object('success', false, 'error', 'invalid_action');
END;
$function$;
