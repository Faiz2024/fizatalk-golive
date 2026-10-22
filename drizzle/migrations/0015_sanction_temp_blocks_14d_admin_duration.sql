-- 1. Setuju langsung mengaktifkan akun (tanpa menunggu 3 hari)
CREATE OR REPLACE FUNCTION public.accept_conduct_agreement(p_user_id bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE v_pending boolean;
BEGIN
 SELECT conduct_agreement_pending INTO v_pending FROM telegram_users WHERE id=p_user_id FOR UPDATE;
 IF NOT COALESCE(v_pending,false) THEN RETURN jsonb_build_object('success',true,'already',true); END IF;
 UPDATE telegram_users SET conduct_agreement_pending=false WHERE id=p_user_id;
 RETURN jsonb_build_object('success',true);
END $function$;
REVOKE ALL ON FUNCTION public.accept_conduct_agreement(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_conduct_agreement(bigint) TO service_role;

-- 2. Sanksi laporan: tahap berulang di level 3, pesan blokir 14 hari tanpa menyebut ambang laporan
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
 INSERT INTO partner_reports(reporter_id,reported_id,report_type,penalty_change,report_context,report_category,created_at) VALUES(p_reporter_id,p_reported_id,legacy,1,p_context,p_category,clock_timestamp());
 SELECT count(*) INTO n FROM partner_reports WHERE reported_id=p_reported_id AND penalty_change>0 AND created_at>GREATEST(now()-interval '12 hours',COALESCE(t.sanction_counted_since,'-infinity'::timestamptz));
 IF n>=4 THEN
  lvl:=LEAST(t.sanction_level+1,3); partner:=t.partner_id;
  UPDATE telegram_users SET sanction_level=lvl,sanction_counted_since=clock_timestamp(),state='idle',partner_id=NULL,
    conduct_agreement_pending=(lvl=1),report_lock_until=CASE WHEN lvl=1 THEN clock_timestamp()+interval '3 days' ELSE report_lock_until END
  WHERE id=p_reported_id;
  UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_reported_id;
  DELETE FROM waiting_queue WHERE user_id=p_reported_id;
  IF lvl>=2 THEN
   INSERT INTO blocked_users(user_id,reason,blocked_message,is_active,blocked_at,is_unblockable)
   VALUES(p_reported_id,'report_stage'||lvl,CASE WHEN lvl=2 THEN 'Akun diblokir 14 hari karena pelanggaran berulang. Pemulihan berbayar tersedia.' ELSE 'Akun diblokir 14 hari karena pelanggaran berulang. Tidak ada opsi pemulihan berbayar.' END,true,clock_timestamp(),lvl=2)
   ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=EXCLUDED.is_unblockable;
  END IF;
 END IF;
 RETURN jsonb_build_object('success',true,'silent',false,'sanction_stage',lvl,'is_banned',lvl>=2,'partner_id',partner);
END $function$;

-- 3. Pembelian Premium: kunci tahap 1 berakhir otomatis setelah 3 hari; blokir temporer 14 hari
CREATE OR REPLACE FUNCTION public.premium_purchase_allowed(p_user_id bigint)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
 SELECT EXISTS(SELECT 1 FROM telegram_users WHERE id=p_user_id AND moderation_state='normal'
    AND NOT (conduct_agreement_pending AND COALESCE(report_lock_until,now())>now()))
   AND NOT EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND (
      (reason IN ('report_stage2','report_stage3','admin_temp') AND blocked_at>now()-interval '14 days')
      OR (reason NOT IN ('report_stage2','report_stage3','admin_temp') AND (NOT is_unblockable OR blocked_at>now()-interval '3 days'))));
$function$;
REVOKE ALL ON FUNCTION public.premium_purchase_allowed(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.premium_purchase_allowed(bigint) TO service_role;

-- 4. Perintah admin: opsi blokir permanen atau sementara (14 hari)
DROP FUNCTION IF EXISTS public.admin_set_user_block(text,text,bigint,text);
CREATE OR REPLACE FUNCTION public.admin_set_user_block(p_target text, p_action text, p_admin_id bigint, p_reason text DEFAULT NULL, p_duration text DEFAULT 'perm')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET timezone='Asia/Jakarta'
AS $function$
DECLARE u telegram_users; t text := trim(COALESCE(p_target,'')); partner bigint;
BEGIN
 IF p_action NOT IN ('ban','unban') OR t='' OR p_duration NOT IN ('perm','temp') THEN RETURN jsonb_build_object('success',false,'error','invalid_input'); END IF;
 IF t ~ '^-?[0-9]+$' THEN SELECT * INTO u FROM telegram_users WHERE id=t::bigint FOR UPDATE;
 ELSE SELECT * INTO u FROM telegram_users WHERE lower(username)=lower(ltrim(t,'@')) ORDER BY last_active DESC LIMIT 1 FOR UPDATE; END IF;
 IF u.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','user_not_found'); END IF;
 PERFORM set_config('fiza.admin_override','on',true);
 IF p_action='ban' THEN
  partner := CASE WHEN u.state='chatting' THEN u.partner_id END;
  IF p_duration='temp' THEN
   UPDATE telegram_users SET state='idle', partner_id=NULL WHERE id=u.id;
   IF partner IS NOT NULL THEN UPDATE telegram_users SET state='idle', partner_id=NULL WHERE id=partner AND partner_id=u.id; END IF;
   DELETE FROM waiting_queue WHERE user_id=u.id;
   UPDATE blocked_users SET is_active=false, unblocked_at=now(), unblocked_by=p_admin_id WHERE user_id=u.id AND is_active;
   INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,is_unblockable)
    VALUES(u.id,u.username,u.first_name,'admin_temp',left(COALESCE(NULLIF(trim(p_reason),''),'Pelanggaran ketentuan layanan'),500),true,false);
   RETURN jsonb_build_object('success',true,'user_id',u.id,'username',u.username,'first_name',u.first_name,'partner_id',partner,'duration','temp','blocked_until',clock_timestamp()+interval '14 days');
  END IF;
  UPDATE telegram_users SET moderation_state='permanent', state='idle', partner_id=NULL WHERE id=u.id;
  IF partner IS NOT NULL THEN UPDATE telegram_users SET state='idle', partner_id=NULL WHERE id=partner AND partner_id=u.id; END IF;
  DELETE FROM waiting_queue WHERE user_id=u.id;
  UPDATE blocked_users SET is_active=false, unblocked_at=now(), unblocked_by=p_admin_id WHERE user_id=u.id AND is_active;
  INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,is_unblockable)
   VALUES(u.id,u.username,u.first_name,'admin_command',left(COALESCE(NULLIF(trim(p_reason),''),'Pelanggaran ketentuan layanan'),500),true,false);
  RETURN jsonb_build_object('success',true,'user_id',u.id,'username',u.username,'first_name',u.first_name,'partner_id',partner,'duration','perm');
 END IF;
 UPDATE blocked_users SET is_active=false, unblocked_at=now(), unblocked_by=p_admin_id WHERE user_id=u.id AND is_active;
 UPDATE moderation_reviews SET status='rejected', resolved_at=now(), resolved_by=p_admin_id WHERE reported_id=u.id AND status='pending';
 UPDATE telegram_users SET moderation_state='normal', penalty_points=0, spam_warnings=0, spam_warning_until=NULL, shadowban_until=NULL, negative_reports_count=0 WHERE id=u.id;
 RETURN jsonb_build_object('success',true,'user_id',u.id,'username',u.username,'first_name',u.first_name);
END $function$;
REVOKE ALL ON FUNCTION public.admin_set_user_block(text,text,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_block(text,text,bigint,text,text) TO service_role;

-- 5. Pencarian partner: pelepasan lazy blokir temporer 14 hari + kunci tahap 1, countdown, tanpa bocoran ambang
DO $do$
DECLARE s text; a int; b int;
BEGIN
 s := pg_get_functiondef('public.comprehensive_search_action(bigint,text,text,boolean,bigint)'::regprocedure);
 a := position('-- 1b. SANKSI LAPORAN BERTINGKAT' in s);
 b := position('-- 2. CEK BLOKIR PERMANEN' in s);
 IF a=0 OR b=0 OR b<=a THEN RAISE EXCEPTION 'search markers missing'; END IF;
 s := overlay(s placing $ins$-- 1b. SANKSI LAPORAN BERTINGKAT
  -- Pelepasan lazy blokir temporer 14 hari (tanpa cron): laporan tahap 2/3 & blokir admin sementara
  IF EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason IN ('report_stage2','report_stage3','admin_temp') AND blocked_at<=now()-interval '14 days') THEN
    PERFORM set_config('fiza.admin_override','on',true);
    UPDATE blocked_users SET is_active=false, unblocked_at=now() WHERE user_id=p_user_id AND is_active AND reason IN ('report_stage2','report_stage3','admin_temp') AND blocked_at<=now()-interval '14 days';
  END IF;
  -- Kunci tahap 1 terlepas otomatis setelah 3 hari tanpa perlu menekan Setuju
  UPDATE telegram_users SET conduct_agreement_pending=false WHERE id=p_user_id AND conduct_agreement_pending AND COALESCE(report_lock_until,now())<=now();
  IF EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='report_stage3') THEN
    RETURN json_build_object('success',false,'error','report_permanent','blocked_until',(SELECT blocked_at+interval '14 days' FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='report_stage3'));
  END IF;
  IF EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='report_stage2') THEN
    RETURN json_build_object('success',false,'error','report_stage2','blocked_until',(SELECT blocked_at+interval '14 days' FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='report_stage2'));
  END IF;
  IF EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='admin_temp') THEN
    RETURN json_build_object('success',false,'error','admin_temp_block','blocked_until',(SELECT blocked_at+interval '14 days' FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='admin_temp'),'blocked_message',(SELECT blocked_message FROM blocked_users WHERE user_id=p_user_id AND is_active AND reason='admin_temp'));
  END IF;
  IF EXISTS(SELECT 1 FROM telegram_users WHERE id=p_user_id AND conduct_agreement_pending) THEN
    RETURN json_build_object('success',false,'error','report_lock');
  END IF;
  $ins$ from a for b-a);
 EXECUTE s;
END $do$;