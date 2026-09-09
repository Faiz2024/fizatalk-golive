CREATE OR REPLACE FUNCTION public.process_referral_cashout(p_request_id uuid, p_action text, p_admin_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row referral_cashouts%ROWTYPE;
  v_username text;
  v_first_name text;
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

  SELECT u.username, u.first_name
    INTO v_username, v_first_name
    FROM telegram_users u
   WHERE u.id = v_row.user_id;

  RETURN json_build_object(
    'success', true,
    'user_id', v_row.user_id,
    'amount', v_row.amount,
    'type', v_row.ewallet_type,
    'number', v_row.ewallet_number,
    'name', v_row.ewallet_name,
    'status', v_row.status,
    'username', v_username,
    'first_name', v_first_name,
    'qualified_at_request', v_row.qualified_at_request
  );
END;
$function$;