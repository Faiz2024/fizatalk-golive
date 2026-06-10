CREATE OR REPLACE FUNCTION public.admin_process_media_report(p_sender_id bigint, p_action text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_premium BOOLEAN;
  v_warnings INTEGER;
  v_warning_until TIMESTAMP WITH TIME ZONE;
  v_new_warning_until TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Cek apakah pengirim adalah Premium dan ambil status spam_warnings
  SELECT 
    (premium_until IS NOT NULL AND premium_until > NOW()),
    spam_warnings,
    spam_warning_until
  INTO 
    v_is_premium,
    v_warnings,
    v_warning_until
  FROM telegram_users 
  WHERE id = p_sender_id;
  
  IF v_is_premium THEN
    RETURN json_build_object('success', false, 'error', 'user_is_premium');
  END IF;

  -- Reset peringatan jika sudah melewati masa 30 hari
  IF v_warning_until IS NOT NULL AND NOW() > v_warning_until THEN
    v_warnings := 0;
  END IF;
  
  v_warnings := COALESCE(v_warnings, 0);

  IF p_action = 'warn' THEN
    v_warnings := v_warnings + 1;
  ELSIF p_action = 'block' THEN
    v_warnings := 4;
  END IF;

  v_new_warning_until := NOW() + INTERVAL '30 days';

  IF v_warnings >= 4 THEN
    -- Blokir
    INSERT INTO blocked_users (user_id, reason, blocked_message, is_active)
    VALUES (p_sender_id, 'admin_media_block', 'Akun diblokir oleh Admin karena pelanggaran peringatan (4/4) akibat mengirim media terlarang.', true)
    ON CONFLICT DO NOTHING;
    
    UPDATE telegram_users 
    SET 
        spam_warnings = 4,
        spam_warning_until = v_new_warning_until,
        penalty_points = 100 
    WHERE id = p_sender_id;
    
    RETURN json_build_object('success', true, 'action', 'blocked', 'warnings', 4);
  ELSE
    -- Peringatan
    UPDATE telegram_users 
    SET 
        spam_warnings = v_warnings,
        spam_warning_until = v_new_warning_until,
        penalty_points = COALESCE(penalty_points, 0) + 15
    WHERE id = p_sender_id;
    
    RETURN json_build_object('success', true, 'action', 'warned', 'warnings', v_warnings);
  END IF;
  
  RETURN json_build_object('success', false, 'error', 'invalid_action');
END;
$function$;
