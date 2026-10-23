ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS sanction_violation text;

CREATE OR REPLACE FUNCTION public.report_violation_label(p_context text,p_category text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
SELECT CASE p_context||':'||p_category
 WHEN 'partner:fraud' THEN 'Penipuan / Pemerasan / VCS' WHEN 'partner:harassment' THEN 'Pelecehan / Vulgar' WHEN 'partner:spam' THEN 'Spam / Iklan Berulang'
 WHEN 'link:fraud' THEN 'Link Penipuan / Phishing / Judi' WHEN 'link:sexual' THEN 'Link Grup Porno / VCS' WHEN 'link:promotion' THEN 'Promosi Toko / Channel' WHEN 'link:doxxing' THEN 'Penyebaran Data Pribadi'
 WHEN 'media:sexual' THEN 'Media Pornografi / Pap Tanpa Izin' WHEN 'media:fraud' THEN 'Media Penipuan / QRIS Palsu' ELSE 'Pelanggaran ketentuan layanan' END $$;

CREATE OR REPLACE FUNCTION public.get_chat_envelope(p_user_id BIGINT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user RECORD; v_partner RECORD;
BEGIN
  SELECT state, partner_id, matched_at INTO v_user FROM telegram_users WHERE id = p_user_id;
  IF NOT FOUND OR v_user.state <> 'chatting' OR v_user.partner_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_chatting');
  END IF;
  SELECT state, partner_id, is_tiktok_mode INTO v_partner FROM telegram_users WHERE id = v_user.partner_id;
  IF NOT FOUND OR v_partner.state <> 'chatting' OR v_partner.partner_id IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('ok', false, 'reason', 'partner_disconnected', 'partner_id', v_user.partner_id);
  END IF;
  RETURN json_build_object('ok', true, 'partner_id', v_user.partner_id,
    'partner_tiktok_mode', COALESCE(v_partner.is_tiktok_mode, false),
    'chat_seconds', COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - v_user.matched_at))::int, 0));
END $$;
REVOKE ALL ON FUNCTION public.get_chat_envelope(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_envelope(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_context_report(p_reporter_id bigint, p_reported_id bigint, p_context text, p_category text, p_explanation text DEFAULT NULL::text, p_evidence text DEFAULT NULL::text, p_source_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE u telegram_users; t telegram_users; rid uuid; partner bigint; n integer; lvl integer := 0; legacy text; vlabel text;
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
  -- Tidak membekukan terlapor; hanya keputusan admin yang memberi sanksi.
  RETURN jsonb_build_object('success',true,'review_id',rid,'pending_review',true,'is_premium',COALESCE(t.premium_until>now(),false),'premium_until',t.premium_until,'username',t.username);
 END IF;
 IF report_weight(p_context,p_category) IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_report_type'); END IF;
 IF EXISTS(SELECT 1 FROM partner_reports WHERE reporter_id=p_reporter_id AND reported_id=p_reported_id AND penalty_change>0 AND created_at>LEAST(COALESCE(u.matched_at,now()),now()-interval '1 hour')-interval '5 seconds') THEN RETURN jsonb_build_object('success',true,'silent',true); END IF;
 legacy:=CASE WHEN p_context='link' THEN 'link_spam' WHEN p_context='media' AND p_category='sexual' THEN 'media_sange' WHEN p_context='media' THEN 'media_spam' WHEN p_category='harassment' THEN 'sange' ELSE 'spam' END;
 INSERT INTO partner_reports(reporter_id,reported_id,report_type,penalty_change,report_context,report_category,created_at) VALUES(p_reporter_id,p_reported_id,legacy,1,p_context,p_category,clock_timestamp());
 SELECT count(*) INTO n FROM partner_reports WHERE reported_id=p_reported_id AND penalty_change>0 AND report_context=p_context AND report_category=p_category
   AND created_at>GREATEST(now()-interval '12 hours',COALESCE(t.sanction_counted_since,'-infinity'::timestamptz));
 IF n<4 THEN RETURN jsonb_build_object('success',true,'silent',false,'sanction_stage',0,'reached_threshold',false); END IF;
 vlabel:=report_violation_label(p_context,p_category);
 lvl:=LEAST(t.sanction_level+1,3); partner:=t.partner_id;
 UPDATE telegram_users SET sanction_level=lvl,sanction_counted_since=clock_timestamp(),sanction_violation=vlabel,state='idle',partner_id=NULL,
   conduct_agreement_pending=(lvl=1),report_lock_until=CASE WHEN lvl=1 THEN clock_timestamp()+interval '3 days' ELSE report_lock_until END
 WHERE id=p_reported_id;
 UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_reported_id;
 DELETE FROM waiting_queue WHERE user_id=p_reported_id;
 IF lvl>=2 THEN
  INSERT INTO blocked_users(user_id,reason,blocked_message,is_active,blocked_at,is_unblockable)
  VALUES(p_reported_id,'report_stage'||lvl,'Akun diblokir 14 hari karena pelanggaran: '||vlabel,true,clock_timestamp(),lvl=2)
  ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=EXCLUDED.is_unblockable;
 END IF;
 RETURN jsonb_build_object('success',true,'silent',false,'sanction_stage',lvl,'reached_threshold',true,'is_banned',lvl>=2,'partner_id',partner,
   'violation',vlabel,'report_count',n,'is_premium',COALESCE(t.premium_until>now(),false),'premium_until',t.premium_until,'username',t.username,'first_name',t.first_name);
END $function$;

-- Tindakan admin atas eskalasi laporan: restore | lock | block14 | perm
CREATE OR REPLACE FUNCTION public.admin_report_action(p_user_id bigint, p_action text, p_admin_id bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE u telegram_users; partner bigint; v text;
BEGIN
 IF p_action NOT IN ('restore','lock','block14','perm') THEN RETURN jsonb_build_object('success',false,'error','invalid_action'); END IF;
 SELECT * INTO u FROM telegram_users WHERE id=p_user_id FOR UPDATE;
 IF u.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','user_not_found'); END IF;
 v:=COALESCE(u.sanction_violation,'Pelanggaran ketentuan layanan');
 PERFORM set_config('fiza.admin_override','on',true);
 -- Lepas blokir aktif terlebih dahulu (trigger membersihkan status kunci)
 UPDATE blocked_users SET is_active=false, unblocked_at=clock_timestamp(), unblocked_by=p_admin_id WHERE user_id=p_user_id AND is_active;
 partner:=CASE WHEN u.state='chatting' THEN u.partner_id END;
 IF p_action='restore' THEN
  UPDATE telegram_users SET moderation_state=CASE WHEN moderation_state='permanent' THEN 'normal' ELSE moderation_state END,
    sanction_level=GREATEST(sanction_level-1,0), conduct_agreement_pending=false, report_lock_until=NULL, sanction_counted_since=clock_timestamp()
  WHERE id=p_user_id;
  RETURN jsonb_build_object('success',true,'action',p_action,'violation',v);
 END IF;
 IF p_action='lock' THEN
  UPDATE telegram_users SET moderation_state='normal', sanction_level=1, conduct_agreement_pending=true, report_lock_until=clock_timestamp()+interval '3 days',
    sanction_counted_since=clock_timestamp(), state='idle', partner_id=NULL WHERE id=p_user_id;
 ELSIF p_action='block14' THEN
  UPDATE telegram_users SET moderation_state='normal', sanction_level=3, conduct_agreement_pending=false, state='idle', partner_id=NULL WHERE id=p_user_id;
  INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,blocked_at,is_unblockable)
  VALUES(u.id,u.username,u.first_name,'report_stage3','Akun diblokir 14 hari karena pelanggaran: '||v,true,clock_timestamp(),false)
  ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=NULL,unblocked_by=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=false;
 ELSE
  UPDATE telegram_users SET moderation_state='permanent', state='idle', partner_id=NULL WHERE id=p_user_id;
  INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,blocked_at,is_unblockable)
  VALUES(u.id,u.username,u.first_name,'admin_command','Akun diblokir permanen karena pelanggaran: '||v,true,clock_timestamp(),false)
  ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=NULL,unblocked_by=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=false;
 END IF;
 IF partner IS NOT NULL THEN UPDATE telegram_users SET state='idle', partner_id=NULL WHERE id=partner AND partner_id=p_user_id; END IF;
 DELETE FROM waiting_queue WHERE user_id=p_user_id;
 RETURN jsonb_build_object('success',true,'action',p_action,'violation',v,'partner_id',partner,'blocked_until',clock_timestamp()+interval '14 days');
END $function$;
REVOKE ALL ON FUNCTION public.admin_report_action(bigint,text,bigint), public.report_violation_label(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_action(bigint,text,bigint), public.report_violation_label(text,text) TO service_role;

-- Sertakan jenis pelanggaran pada respons kunci/blokir saat Cari Partner
DO $$ DECLARE s text; BEGIN
 SELECT pg_get_functiondef('public.comprehensive_search_action(bigint,text,text,boolean,bigint)'::regprocedure) INTO s;
 s:=regexp_replace(s,'''error'',(\s*)''report_lock''','''error'',\1''report_lock'',''violation'',(SELECT sanction_violation FROM public.telegram_users WHERE id=p_user_id)');
 s:=regexp_replace(s,'''error'',(\s*)''report_stage2''','''error'',\1''report_stage2'',''violation'',(SELECT sanction_violation FROM public.telegram_users WHERE id=p_user_id)');
 s:=regexp_replace(s,'''error'',(\s*)''report_permanent''','''error'',\1''report_permanent'',''violation'',(SELECT sanction_violation FROM public.telegram_users WHERE id=p_user_id)');
 EXECUTE s;
END $$;