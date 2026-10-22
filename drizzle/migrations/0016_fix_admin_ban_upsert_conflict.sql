-- Perbaikan: perintah blokir admin gagal (duplikat) bila pengguna sudah punya riwayat blokir
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
   INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,blocked_at,is_unblockable)
    VALUES(u.id,u.username,u.first_name,'admin_temp',left(COALESCE(NULLIF(trim(p_reason),''),'Pelanggaran ketentuan layanan'),500),true,clock_timestamp(),false)
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=NULL,unblocked_by=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=EXCLUDED.is_unblockable,username=EXCLUDED.username,first_name=EXCLUDED.first_name;
   RETURN jsonb_build_object('success',true,'user_id',u.id,'username',u.username,'first_name',u.first_name,'partner_id',partner,'duration','temp','blocked_until',clock_timestamp()+interval '14 days');
  END IF;
  UPDATE telegram_users SET moderation_state='permanent', state='idle', partner_id=NULL WHERE id=u.id;
  IF partner IS NOT NULL THEN UPDATE telegram_users SET state='idle', partner_id=NULL WHERE id=partner AND partner_id=u.id; END IF;
  DELETE FROM waiting_queue WHERE user_id=u.id;
  INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,blocked_at,is_unblockable)
   VALUES(u.id,u.username,u.first_name,'admin_command',left(COALESCE(NULLIF(trim(p_reason),''),'Pelanggaran ketentuan layanan'),500),true,clock_timestamp(),false)
   ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=NULL,unblocked_by=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=EXCLUDED.is_unblockable,username=EXCLUDED.username,first_name=EXCLUDED.first_name;
  RETURN jsonb_build_object('success',true,'user_id',u.id,'username',u.username,'first_name',u.first_name,'partner_id',partner,'duration','perm');
 END IF;
 UPDATE blocked_users SET is_active=false, unblocked_at=now(), unblocked_by=p_admin_id WHERE user_id=u.id AND is_active;
 UPDATE moderation_reviews SET status='rejected', resolved_at=now(), resolved_by=p_admin_id WHERE reported_id=u.id AND status='pending';
 UPDATE telegram_users SET moderation_state='normal', penalty_points=0, spam_warnings=0, spam_warning_until=NULL, shadowban_until=NULL, negative_reports_count=0 WHERE id=u.id;
 RETURN jsonb_build_object('success',true,'user_id',u.id,'username',u.username,'first_name',u.first_name);
END $function$;
REVOKE ALL ON FUNCTION public.admin_set_user_block(text,text,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_block(text,text,bigint,text,text) TO service_role;