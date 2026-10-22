CREATE OR REPLACE FUNCTION public.guard_protected_block() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF current_setting('fiza.admin_override',true)='on' THEN RETURN NEW; END IF; IF OLD.is_active AND NOT OLD.is_unblockable THEN NEW.is_active:=true; NEW.is_unblockable:=false; NEW.unblocked_at:=OLD.unblocked_at; END IF; IF OLD.is_active AND NEW.is_active=false AND EXISTS(SELECT 1 FROM telegram_users WHERE id=OLD.user_id AND moderation_state<>'normal') THEN NEW.is_active:=true; NEW.unblocked_at:=OLD.unblocked_at; END IF; RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.premium_purchase_allowed(p_user_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM telegram_users WHERE id=p_user_id AND moderation_state='normal')
   AND NOT EXISTS(SELECT 1 FROM blocked_users WHERE user_id=p_user_id AND is_active AND (NOT is_unblockable OR blocked_at>now()-interval '3 days'));
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_block(p_target text, p_action text, p_admin_id bigint, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET timezone='Asia/Jakarta' AS $$
DECLARE u telegram_users; t text := trim(COALESCE(p_target,'')); partner bigint;
BEGIN
 IF p_action NOT IN ('ban','unban') OR t='' THEN RETURN jsonb_build_object('success',false,'error','invalid_input'); END IF;
 IF t ~ '^-?[0-9]+$' THEN SELECT * INTO u FROM telegram_users WHERE id=t::bigint FOR UPDATE;
 ELSE SELECT * INTO u FROM telegram_users WHERE lower(username)=lower(ltrim(t,'@')) ORDER BY last_active DESC LIMIT 1 FOR UPDATE; END IF;
 IF u.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','user_not_found'); END IF;
 PERFORM set_config('fiza.admin_override','on',true);
 IF p_action='ban' THEN
  partner := CASE WHEN u.state='chatting' THEN u.partner_id END;
  UPDATE telegram_users SET moderation_state='permanent', state='idle', partner_id=NULL WHERE id=u.id;
  IF partner IS NOT NULL THEN UPDATE telegram_users SET state='idle', partner_id=NULL WHERE id=partner AND partner_id=u.id; END IF;
  DELETE FROM waiting_queue WHERE user_id=u.id;
  UPDATE blocked_users SET is_active=false, unblocked_at=now(), unblocked_by=p_admin_id WHERE user_id=u.id AND is_active;
  INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,is_unblockable)
   VALUES(u.id,u.username,u.first_name,'admin_command',left(COALESCE(NULLIF(trim(p_reason),''),'Pelanggaran ketentuan layanan'),500),true,false);
  RETURN jsonb_build_object('success',true,'user_id',u.id,'username',u.username,'first_name',u.first_name,'partner_id',partner);
 END IF;
 UPDATE blocked_users SET is_active=false, unblocked_at=now(), unblocked_by=p_admin_id WHERE user_id=u.id AND is_active;
 UPDATE moderation_reviews SET status='rejected', resolved_at=now(), resolved_by=p_admin_id WHERE reported_id=u.id AND status='pending';
 UPDATE telegram_users SET moderation_state='normal', penalty_points=0, spam_warnings=0, spam_warning_until=NULL, blocked_until_dummy_noop=NULL WHERE false;
 UPDATE telegram_users SET moderation_state='normal', penalty_points=0, spam_warnings=0, spam_warning_until=NULL, shadowban_until=NULL, negative_reports_count=0 WHERE id=u.id;
 RETURN jsonb_build_object('success',true,'user_id',u.id,'username',u.username,'first_name',u.first_name);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_user_block(text,text,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_purchase_allowed(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_block(text,text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.premium_purchase_allowed(bigint) TO service_role;