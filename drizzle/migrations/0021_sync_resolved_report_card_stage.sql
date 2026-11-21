CREATE OR REPLACE FUNCTION public.resolve_admin_report_card(
  p_target_user_id bigint,
  p_action text,
  p_admin_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE c public.admin_report_cards;
BEGIN
  UPDATE public.admin_report_cards AS card
  SET status='resolved',last_action=p_action,resolved_by=p_admin_id,resolved_at=clock_timestamp(),updated_at=clock_timestamp(),
      sanction_stage=u.sanction_level,sanction_violation=u.sanction_violation,
      username=u.username,first_name=u.first_name,is_premium=COALESCE(u.premium_until>now(),false),premium_until=u.premium_until
  FROM public.telegram_users AS u
  WHERE card.target_user_id=p_target_user_id AND card.status='pending' AND u.id=p_target_user_id
  RETURNING card.* INTO c;
  IF c.target_user_id IS NULL THEN RETURN NULL; END IF;
  RETURN to_jsonb(c);
END
$function$;