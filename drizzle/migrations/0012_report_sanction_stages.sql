ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS sanction_level integer NOT NULL DEFAULT 0;
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS sanction_counted_since timestamptz;
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS report_lock_until timestamptz;
ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS conduct_agreement_pending boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.telegram_users.penalty_points IS 'DEPRECATED: replaced by sanction_level (4 reports/12h stages)';
COMMENT ON COLUMN public.telegram_users.shadowban_until IS 'DEPRECATED: shadowban removed';
CREATE INDEX IF NOT EXISTS idx_partner_reports_reported_created ON public.partner_reports(reported_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.submit_context_report(p_reporter_id bigint, p_reported_id bigint, p_context text, p_category text, p_explanation text DEFAULT NULL::text, p_evidence text DEFAULT NULL::text, p_source_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE u telegram_users; t telegram_users; rid uuid; partner bigint; n integer; lvl integer := 0; legacy text;
BEGIN
 PERFORM id FROM telegram_users WHERE id IN (p_reporter_id,p_reported_id) ORDER BY id FOR UPDATE;
 SELECT * INTO u FROM telegram_users WHERE id=p_reporter_id;
 IF u.id IS NULL OR p_reporter_id=p_reported_id OR (u.partner_id IS DISTINCT FROM p_reported_id AND NOT p_reported_id=ANY(COALESCE(u.last_partners[1:2],'{}'::bigint[]))) THEN RETURN jsonb_build_object('success',false,'error','partner_not_recent'); END IF;
 SELECT * INTO t FROM telegram_users WHERE id=p_reported_id;
 IF t.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','user_not_found'); END IF;
 IF p_category='danger' AND p_context IN ('partner','media') THEN
  IF u.report_draft IS NULL OR (u.report_draft->>'target')::bigint<>p_reported_id OR u.report_draft->>'context'<>p_context OR (u.report_draft->>'expires_at')::timestamptz<now() OR length(trim(COALESCE(p_explanation,'')))<10 OR length(p_explanation)>1000 OR (p_context='partner' AND NULLIF(trim(p_evidence),'') IS NULL) THEN RETURN jsonb_build_object('success',false,'error','evidence_required'); END IF;
  SELECT id INTO rid FROM moderation_reviews WHERE reporter_id=p_reporter_id AND reported_id=p_reported_id AND status='pending' LIMIT 1;
  IF rid IS NULL THEN INSERT INTO moderation_reviews(reporter_id,reported_id,context,explanation,evidence_file_id,source_message_id) VALUES(p_reporter_id,p_reported_id,p_context,p_explanation,p_evidence,p_source_id) RETURNING id INTO rid; END IF;
  partner:=t.partner_id;
  UPDATE telegram_users SET moderation_state=CASE WHEN moderation_state='permanent' THEN moderation_state ELSE 'pending' END,state='idle',partner_id=NULL WHERE id=p_reported_id;
  UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_reported_id;
  DELETE FROM waiting_queue WHERE user_id=p_reported_id;
  RETURN jsonb_build_object('success',true,'review_id',rid,'partner_id',partner,'pending_review',true);
 END IF;
 IF report_weight(p_context,p_category) IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_report_type'); END IF;
 IF EXISTS(SELECT 1 FROM partner_reports WHERE reporter_id=p_reporter_id AND reported_id=p_reported_id AND penalty_change>0 AND created_at>LEAST(COALESCE(u.matched_at,now()),now()-interval '1 hour')-interval '5 seconds') THEN RETURN jsonb_build_object('success',true,'silent',true); END IF;
 legacy:=CASE WHEN p_context='link' THEN 'link_spam' WHEN p_context='media' AND p_category='sexual' THEN 'media_sange' WHEN p_context='media' THEN 'media_spam' WHEN p_category='harassment' THEN 'sange' ELSE 'spam' END;
 INSERT INTO partner_reports(reporter_id,reported_id,report_type,penalty_change,report_context,report_category,created_at) VALUES(p_reporter_id,p_reported_id,legacy,1,p_context,p_category,now());
 SELECT count(*) INTO n FROM partner_reports WHERE reported_id=p_reported_id AND penalty_change>0 AND created_at>GREATEST(now()-interval '12 hours',COALESCE(t.sanction_counted_since,'-infinity'::timestamptz));
 IF n>=4 AND t.sanction_level<3 THEN
  lvl:=t.sanction_level+1; partner:=t.partner_id;
  UPDATE telegram_users SET sanction_level=lvl,sanction_counted_since=now(),state='idle',partner_id=NULL,
    conduct_agreement_pending=(lvl=1),report_lock_until=CASE WHEN lvl=1 THEN now()+interval '3 days' ELSE report_lock_until END
  WHERE id=p_reported_id;
  UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_reported_id;
  DELETE FROM waiting_queue WHERE user_id=p_reported_id;
  IF lvl>=2 THEN
   INSERT INTO blocked_users(user_id,reason,blocked_message,is_active,blocked_at,is_unblockable)
   VALUES(p_reported_id,'report_stage'||lvl,CASE WHEN lvl=2 THEN 'Akun diblokir karena kembali menerima 4 laporan dalam 12 jam.' ELSE 'Akun diblokir permanen karena pelanggaran berulang.' END,true,now(),lvl=2)
   ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=now(),unblocked_at=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=EXCLUDED.is_unblockable;
  END IF;
 END IF;
 RETURN jsonb_build_object('success',true,'silent',false,'sanction_stage',lvl,'is_banned',lvl>=2,'partner_id',partner);
END $function$;

CREATE OR REPLACE FUNCTION public.accept_conduct_agreement(p_user_id bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE v_until timestamptz; v_pending boolean;
BEGIN
 SELECT report_lock_until, conduct_agreement_pending INTO v_until, v_pending FROM telegram_users WHERE id=p_user_id FOR UPDATE;
 IF NOT COALESCE(v_pending,false) THEN RETURN jsonb_build_object('success',true,'already',true); END IF;
 IF v_until IS NOT NULL AND v_until>now() THEN RETURN jsonb_build_object('success',false,'error','lock_active','lock_until',v_until); END IF;
 UPDATE telegram_users SET conduct_agreement_pending=false WHERE id=p_user_id;
 RETURN jsonb_build_object('success',true);
END $function$;
REVOKE ALL ON FUNCTION public.accept_conduct_agreement(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_conduct_agreement(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.premium_purchase_allowed(p_user_id bigint)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
 SELECT EXISTS(SELECT 1 FROM telegram_users WHERE id=p_user_id AND moderation_state='normal' AND NOT conduct_agreement_pending)
   AND NOT EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND (NOT is_unblockable OR reason LIKE 'report_stage%' OR blocked_at>now()-interval '3 days'));
$function$;

CREATE OR REPLACE FUNCTION public.clear_sanctions_on_unblock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE THEN
    UPDATE telegram_users SET penalty_points=0, spam_warnings=0, spam_warning_until=NULL,
      unacknowledged_reports_count=0, negative_reports_count=0, shadowban_until=NULL,
      conduct_agreement_pending=false, sanction_counted_since=now()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $function$;

DO $do$
DECLARE s text;
BEGIN
 s := pg_get_functiondef('public.comprehensive_search_action(bigint,text,text,boolean,bigint)'::regprocedure);
 IF position('-- 2. CEK BLOKIR PERMANEN' in s)=0 OR position('v_penalty_points := v_user.penalty_points;' in s)=0 THEN RAISE EXCEPTION 'search markers missing'; END IF;
 s := replace(s, '-- 2. CEK BLOKIR PERMANEN', $ins$-- 1b. SANKSI LAPORAN BERTINGKAT
  IF EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='report_stage3') THEN
    RETURN json_build_object('success',false,'error','report_permanent');
  END IF;
  IF EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='report_stage2') THEN
    RETURN json_build_object('success',false,'error','report_stage2');
  END IF;
  IF EXISTS(SELECT 1 FROM telegram_users WHERE id=p_user_id AND conduct_agreement_pending) THEN
    RETURN json_build_object('success',false,'error','report_lock','lock_until',(SELECT report_lock_until FROM telegram_users WHERE id=p_user_id));
  END IF;
  -- 2. CEK BLOKIR PERMANEN$ins$);
 s := replace(s, 'v_penalty_points := v_user.penalty_points;', 'v_penalty_points := 0;');
 EXECUTE s;
END $do$;