CREATE OR REPLACE FUNCTION public.set_referral_cashout_draft(p_user_id bigint, p_draft jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  RETURN json_build_object('success', true, 'draft', p_draft, 'total_qualified', v_total,
                           'cashout_amount', get_referral_cashout_amount());
END;
$function$;