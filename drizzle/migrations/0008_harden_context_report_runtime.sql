ALTER TABLE public.partner_reports ADD COLUMN IF NOT EXISTS report_context text;
ALTER TABLE public.partner_reports ADD COLUMN IF NOT EXISTS report_category text;
CREATE OR REPLACE FUNCTION public.restoration_payment_allowed(p_user_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET timezone='Asia/Jakarta' AS $$ SELECT EXISTS(SELECT 1 FROM telegram_users WHERE id=p_user_id AND moderation_state='normal') AND NOT EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND (NOT is_unblockable OR reason IN ('context_report','admin_media_block','confirmed_severe_violation'))) $$;
REVOKE ALL ON FUNCTION public.restoration_payment_allowed(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restoration_payment_allowed(bigint) TO service_role;
CREATE OR REPLACE FUNCTION public.guard_protected_block() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF OLD.is_active AND NOT OLD.is_unblockable THEN NEW.is_active:=true; NEW.is_unblockable:=false; NEW.unblocked_at:=OLD.unblocked_at; END IF; IF OLD.is_active AND NEW.is_active=false AND EXISTS(SELECT 1 FROM telegram_users WHERE id=OLD.user_id AND moderation_state<>'normal') THEN NEW.is_active:=true; NEW.unblocked_at:=OLD.unblocked_at; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.guard_moderation_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NEW.state IN ('chatting','waiting') AND (NEW.moderation_state<>'normal' OR EXISTS(SELECT 1 FROM blocked_users WHERE user_id=NEW.id AND is_active AND (NOT is_unblockable OR blocked_at>now()-interval '3 days'))) THEN RAISE EXCEPTION 'Account under moderation'; END IF; IF NEW.state='chatting' AND EXISTS(SELECT 1 FROM telegram_users WHERE id=NEW.partner_id AND moderation_state<>'normal') THEN RAISE EXCEPTION 'Partner under moderation'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.submit_context_report(p_reporter_id bigint,p_reported_id bigint,p_context text,p_category text,p_explanation text DEFAULT NULL,p_evidence text DEFAULT NULL,p_source_id bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET timezone='Asia/Jakarta' AS $$
DECLARE u telegram_users; prior integer; points integer; rid uuid; partner bigint; serious integer; n integer; banned boolean; legacy text;
BEGIN
 PERFORM id FROM telegram_users WHERE id IN (p_reporter_id,p_reported_id) ORDER BY id FOR UPDATE;
 SELECT * INTO u FROM telegram_users WHERE id=p_reporter_id;
 IF u.id IS NULL OR p_reporter_id=p_reported_id OR (u.partner_id IS DISTINCT FROM p_reported_id AND NOT p_reported_id=ANY(COALESCE(u.last_partners[1:2],'{}'::bigint[]))) THEN RETURN jsonb_build_object('success',false,'error','partner_not_recent'); END IF;
 IF NOT EXISTS(SELECT 1 FROM telegram_users WHERE id=p_reported_id) THEN RETURN jsonb_build_object('success',false,'error','user_not_found'); END IF;
 IF p_category='danger' AND p_context IN ('partner','media') THEN
  IF u.report_draft IS NULL OR (u.report_draft->>'target')::bigint<>p_reported_id OR u.report_draft->>'context'<>p_context OR (u.report_draft->>'expires_at')::timestamptz<now() OR length(trim(COALESCE(p_explanation,'')))<10 OR length(p_explanation)>1000 OR (p_context='partner' AND NULLIF(trim(p_evidence),'') IS NULL) THEN RETURN jsonb_build_object('success',false,'error','evidence_required'); END IF;
  SELECT id INTO rid FROM moderation_reviews WHERE reporter_id=p_reporter_id AND reported_id=p_reported_id AND status='pending' LIMIT 1;
  IF rid IS NULL THEN INSERT INTO moderation_reviews(reporter_id,reported_id,context,explanation,evidence_file_id,source_message_id) VALUES(p_reporter_id,p_reported_id,p_context,p_explanation,p_evidence,p_source_id) RETURNING id INTO rid; END IF;
  SELECT partner_id INTO partner FROM telegram_users WHERE id=p_reported_id;
  UPDATE telegram_users SET moderation_state=CASE WHEN moderation_state='permanent' THEN moderation_state ELSE 'pending' END,state='idle',partner_id=NULL WHERE id=p_reported_id;
  UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_reported_id;
  DELETE FROM waiting_queue WHERE user_id=p_reported_id;
  RETURN jsonb_build_object('success',true,'review_id',rid,'partner_id',partner,'pending_review',true);
 END IF;
 points:=report_weight(p_context,p_category);
 IF points IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_report_type'); END IF;
 IF COALESCE(u.penalty_points,0)>40 THEN RETURN jsonb_build_object('success',false,'error','reputation_too_low'); END IF;
 IF EXISTS(SELECT 1 FROM partner_reports WHERE reporter_id=p_reporter_id AND reported_id=p_reported_id AND penalty_change>0 AND created_at>LEAST(COALESCE(u.matched_at,now()),now()-interval '1 hour')-interval '5 seconds') THEN RETURN jsonb_build_object('success',true,'silent',true); END IF;
 PERFORM decay_negative_reports(p_reported_id);
 SELECT COALESCE(penalty_points,0) INTO prior FROM telegram_users WHERE id=p_reported_id;
 legacy:=CASE WHEN p_context='link' THEN 'link_spam' WHEN p_context='media' AND p_category='sexual' THEN 'media_sange' WHEN p_context='media' THEN 'media_spam' WHEN p_category='harassment' THEN 'sange' ELSE 'spam' END;
 INSERT INTO partner_reports(reporter_id,reported_id,report_type,penalty_change,report_context,report_category) VALUES(p_reporter_id,p_reported_id,legacy,points,p_context,p_category);
 UPDATE telegram_users SET penalty_points=prior+points,negative_reports_count=COALESCE(negative_reports_count,0)+1,last_negative_report_at=now(),reports_decay_at=NULL,clean_days_streak=0,unacknowledged_reports_count=COALESCE(unacknowledged_reports_count,0)+1 WHERE id=p_reported_id RETURNING negative_reports_count INTO n;
 UPDATE telegram_users SET shadowban_until=now()+interval '3 days' WHERE id=p_reported_id AND n>=4 AND (shadowban_until IS NULL OR shadowban_until<=now());
 SELECT count(DISTINCT reporter_id) INTO serious FROM partner_reports WHERE reported_id=p_reported_id AND report_context IN ('partner','link') AND report_category IN ('fraud','doxxing') AND created_at>=now()-interval '7 days';
 banned:=prior+points>=100 OR (p_context IN ('partner','link') AND p_category IN ('fraud','doxxing') AND serious>=2);
 IF banned THEN
  INSERT INTO blocked_users(user_id,reason,blocked_message,is_active,blocked_at) VALUES(p_reported_id,'context_report','Akun dibatasi sementara karena laporan pelanggaran. Hubungi @FizaTalkCS untuk sanggahan.',true,now()) ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=now(),reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message;
  SELECT partner_id INTO partner FROM telegram_users WHERE id=p_reported_id;
  UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=p_reported_id;
  UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_reported_id;
  DELETE FROM waiting_queue WHERE user_id=p_reported_id;
 END IF;
 RETURN jsonb_build_object('success',true,'penalty_change',points,'new_penalty',prior+points,'warning',NOT banned,'is_banned',banned,'negative_reports_count',n,'partner_id',partner);
END $$;
CREATE OR REPLACE FUNCTION public.admin_process_media_report(p_sender_id bigint,p_action text) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET timezone='Asia/Jakarta' AS $$ DECLARE partner bigint; BEGIN IF p_action NOT IN ('warn','block') THEN RETURN json_build_object('success',false); END IF; PERFORM id FROM telegram_users WHERE id=p_sender_id FOR UPDATE; IF NOT FOUND THEN RETURN json_build_object('success',false); END IF; IF p_action='block' THEN INSERT INTO blocked_users(user_id,reason,blocked_message,is_active,blocked_at) VALUES(p_sender_id,'admin_media_block','Akun dibatasi sementara oleh admin. Sanggahan: @FizaTalkCS.',true,now()) ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=now(),reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message; SELECT partner_id INTO partner FROM telegram_users WHERE id=p_sender_id; UPDATE telegram_users SET penalty_points=100,state='idle',partner_id=NULL WHERE id=p_sender_id; UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_sender_id; DELETE FROM waiting_queue WHERE user_id=p_sender_id; END IF; RETURN json_build_object('success',true,'action',CASE WHEN p_action='block' THEN 'blocked' ELSE 'warned' END); END $$;