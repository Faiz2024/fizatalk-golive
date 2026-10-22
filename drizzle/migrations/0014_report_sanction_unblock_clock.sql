CREATE OR REPLACE FUNCTION public.clear_sanctions_on_unblock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE THEN
    UPDATE telegram_users SET penalty_points=0, spam_warnings=0, spam_warning_until=NULL,
      unacknowledged_reports_count=0, negative_reports_count=0, shadowban_until=NULL,
      conduct_agreement_pending=false, sanction_counted_since=clock_timestamp()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $function$;