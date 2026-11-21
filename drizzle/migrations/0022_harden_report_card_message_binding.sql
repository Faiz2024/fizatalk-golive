CREATE OR REPLACE FUNCTION public.set_admin_report_card_message(
  p_target_user_id bigint,
  p_expected_message_id bigint,
  p_new_message_id bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE saved boolean;
BEGIN
  UPDATE public.admin_report_cards
  SET admin_message_id=p_new_message_id,updated_at=clock_timestamp()
  WHERE target_user_id=p_target_user_id
    AND status IN ('pending','resolved')
    AND admin_message_id IS NOT DISTINCT FROM p_expected_message_id
  RETURNING true INTO saved;
  RETURN COALESCE(saved,false);
END
$function$;