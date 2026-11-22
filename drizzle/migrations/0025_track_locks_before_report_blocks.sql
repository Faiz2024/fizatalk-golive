ALTER TABLE public.telegram_users ADD COLUMN IF NOT EXISTS sanction_lock_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.telegram_users.sanction_lock_count IS 'Jumlah pemicu kunci untuk jalur sexual/harassment/frekuensi campuran; blokir pada pemicu setelah dua kunci';
UPDATE public.telegram_users SET sanction_lock_count=1 WHERE sanction_level=1 AND sanction_lock_count=0;

DROP FUNCTION public.report_sanction_stage(integer,text);
CREATE FUNCTION public.report_sanction_stage(p_current_level integer,p_trigger_code text,p_lock_count integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_trigger_code IN ('critical','spam') THEN
      CASE WHEN COALESCE(p_current_level,0)>=2 THEN 3 ELSE 2 END
    WHEN p_trigger_code IN ('medium','burst','aggregate') THEN
      CASE
        WHEN COALESCE(p_current_level,0)<=0 THEN 1
        WHEN p_current_level=1 AND COALESCE(p_lock_count,0)<2 THEN 1
        WHEN p_current_level=1 THEN 2
        ELSE 3
      END
    ELSE NULL
  END
$function$;
REVOKE ALL ON FUNCTION public.report_sanction_stage(integer,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.report_sanction_stage(integer,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_context_report(
  p_reporter_id bigint,
  p_reported_id bigint,
  p_context text,
  p_category text,
  p_explanation text DEFAULT NULL,
  p_evidence text DEFAULT NULL,
  p_source_id bigint DEFAULT NULL,
  p_detail text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  u telegram_users;
  t telegram_users;
  rid uuid;
  partner bigint;
  critical_n integer;
  medium_n integer;
  spam_n integer;
  burst_n integer;
  total_n integer;
  lvl integer := 0;
  lock_count integer := 0;
  legacy text;
  vlabel text;
  trigger_code text;
  trigger_label text;
  card jsonb;
  review_created boolean := false;
BEGIN
  PERFORM id FROM telegram_users WHERE id IN (p_reporter_id,p_reported_id) ORDER BY id FOR UPDATE;
  SELECT * INTO u FROM telegram_users WHERE id=p_reporter_id;
  IF u.id IS NULL OR p_reporter_id=p_reported_id OR (u.partner_id IS DISTINCT FROM p_reported_id AND NOT p_reported_id=ANY(COALESCE(u.last_partners[1:2],'{}'::bigint[]))) THEN
    RETURN jsonb_build_object('success',false,'error','partner_not_recent');
  END IF;
  SELECT * INTO t FROM telegram_users WHERE id=p_reported_id;
  IF t.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','user_not_found'); END IF;

  IF p_category='danger' AND p_context IN ('partner','media') THEN
    IF u.report_draft IS NULL OR (u.report_draft->>'target')::bigint<>p_reported_id OR u.report_draft->>'context'<>p_context OR (u.report_draft->>'expires_at')::timestamptz<now() OR length(trim(COALESCE(p_explanation,'')))<10 OR length(p_explanation)>1000 OR (p_context='partner' AND NULLIF(trim(p_evidence),'') IS NULL) THEN
      RETURN jsonb_build_object('success',false,'error','evidence_required');
    END IF;
    SELECT id INTO rid FROM moderation_reviews WHERE reporter_id=p_reporter_id AND reported_id=p_reported_id AND status='pending' LIMIT 1;
    IF rid IS NULL THEN
      INSERT INTO moderation_reviews(reporter_id,reported_id,context,explanation,evidence_file_id,source_message_id)
      VALUES(p_reporter_id,p_reported_id,p_context,p_explanation,p_evidence,p_source_id) RETURNING id INTO rid;
      review_created:=true;
    END IF;
    IF review_created THEN
      card:=append_admin_report_card(p_reported_id,p_context,p_category,
        CASE WHEN p_context='partner' THEN '🚸 Asusila Anak / Bahaya Berat' ELSE '🚸 Dugaan Eksploitasi Seksual Anak' END,
        COALESCE(p_detail,'Penjelasan dan referensi bukti aman telah dikirim untuk peninjauan.'),p_source_id);
    ELSE
      card:=current_admin_report_card(p_reported_id);
    END IF;
    RETURN jsonb_build_object('success',true,'review_id',rid,'pending_review',true,
      'is_premium',COALESCE(t.premium_until>now(),false),'premium_until',t.premium_until,
      'username',t.username,'report_card',card);
  END IF;

  IF public.report_category_threshold(p_context,p_category) IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','invalid_report_type');
  END IF;
  IF EXISTS(
    SELECT 1 FROM partner_reports
    WHERE reporter_id=p_reporter_id AND reported_id=p_reported_id AND report_context IS NOT NULL
      AND created_at>LEAST(COALESCE(u.matched_at,now()),now()-interval '1 hour')-interval '5 seconds'
  ) THEN
    RETURN jsonb_build_object('success',true,'silent',true,'report_card',current_admin_report_card(p_reported_id));
  END IF;

  legacy:=CASE WHEN p_context='link' THEN 'link_spam' WHEN p_context='media' AND p_category='sexual' THEN 'media_sange' WHEN p_context='media' THEN 'media_spam' WHEN p_category='harassment' THEN 'sange' ELSE 'spam' END;
  INSERT INTO partner_reports(reporter_id,reported_id,report_type,penalty_change,report_context,report_category,created_at)
  VALUES(p_reporter_id,p_reported_id,legacy,0,p_context,p_category,clock_timestamp());

  WITH windowed AS (
    SELECT reporter_id,report_category,created_at
    FROM partner_reports
    WHERE reported_id=p_reported_id AND report_context IS NOT NULL AND report_category IS NOT NULL
      AND created_at>GREATEST(now()-interval '12 hours',COALESCE(t.sanction_counted_since,'-infinity'::timestamptz))
  ), aggregated AS (
    SELECT
      count(DISTINCT reporter_id) FILTER(WHERE report_category IN ('fraud','doxxing'))::integer AS critical_count,
      count(DISTINCT reporter_id) FILTER(WHERE report_category IN ('sexual','harassment'))::integer AS medium_count,
      count(DISTINCT reporter_id) FILTER(WHERE report_category IN ('spam','promotion'))::integer AS spam_count,
      count(DISTINCT reporter_id) FILTER(WHERE created_at>now()-interval '30 minutes')::integer AS burst_count,
      count(DISTINCT reporter_id)::integer AS total_count
    FROM windowed
  )
  SELECT critical_count,medium_count,spam_count,burst_count,total_count
  INTO critical_n,medium_n,spam_n,burst_n,total_n
  FROM aggregated;

  IF critical_n>=2 THEN
    trigger_code:='critical';
    trigger_label:='Kategori kritis (fraud/doxxing) • '||critical_n||' pelapor dalam 12 jam • langsung blokir';
    vlabel:='Penipuan / penyebaran data pribadi';
  ELSIF spam_n>=3 THEN
    trigger_code:='spam';
    trigger_label:='Spam/promosi • '||spam_n||' pelapor dalam 12 jam • langsung blokir';
    vlabel:='Spam / promosi';
  ELSIF medium_n>=3 THEN
    trigger_code:='medium';
    trigger_label:='Pelecehan/konten seksual • '||medium_n||' pelapor dalam 12 jam • dua kunci sebelum blokir';
    vlabel:='Pelecehan / konten seksual';
  ELSIF burst_n>=3 THEN
    trigger_code:='burst';
    trigger_label:='Lonjakan cepat • '||burst_n||' pelapor dalam 30 menit • dua kunci sebelum blokir';
    vlabel:='Lonjakan laporan dari beberapa pengguna';
  ELSIF total_n>=4 THEN
    trigger_code:='aggregate';
    trigger_label:='Akumulasi lintas kategori • '||total_n||' pelapor dalam 12 jam • dua kunci sebelum blokir';
    vlabel:='Beberapa jenis pelanggaran';
  ELSE
    vlabel:=report_violation_label(p_context,p_category);
    card:=append_admin_report_card(p_reported_id,p_context,p_category,vlabel,COALESCE(p_detail,''),p_source_id);
    RETURN jsonb_build_object('success',true,'silent',false,'sanction_stage',0,'reached_threshold',false,
      'critical_reporters',critical_n,'medium_reporters',medium_n,'spam_reporters',spam_n,'light_reporters',spam_n,
      'burst_reporters',burst_n,'distinct_reporters',total_n,'report_card',card);
  END IF;

  lvl:=public.report_sanction_stage(t.sanction_level,trigger_code,t.sanction_lock_count);
  lock_count:=CASE
    WHEN lvl<>1 THEN 0
    WHEN COALESCE(t.sanction_level,0)<=0 THEN 1
    ELSE LEAST(COALESCE(t.sanction_lock_count,0)+1,2)
  END;
  partner:=t.partner_id;
  UPDATE telegram_users SET sanction_level=lvl,sanction_lock_count=lock_count,sanction_counted_since=clock_timestamp(),sanction_violation=vlabel,state='idle',partner_id=NULL,
    conduct_agreement_pending=(lvl=1),report_lock_until=CASE WHEN lvl=1 THEN clock_timestamp()+interval '3 days' ELSE report_lock_until END
  WHERE id=p_reported_id;
  UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_reported_id;
  DELETE FROM waiting_queue WHERE user_id=p_reported_id;
  IF lvl>=2 THEN
    INSERT INTO blocked_users(user_id,reason,blocked_message,is_active,blocked_at,is_unblockable)
    VALUES(p_reported_id,'report_stage'||lvl,'Akun diblokir 14 hari karena pelanggaran: '||vlabel,true,clock_timestamp(),lvl=2)
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=clock_timestamp(),unblocked_by=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=EXCLUDED.is_unblockable;
  END IF;
  card:=append_admin_report_card(p_reported_id,p_context,p_category,vlabel,COALESCE(p_detail,''),p_source_id);
  UPDATE public.admin_report_cards AS c SET sanction_trigger=trigger_label
  WHERE c.target_user_id=p_reported_id
  RETURNING to_jsonb(c) INTO card;
  RETURN jsonb_build_object('success',true,'silent',false,'sanction_stage',lvl,'sanction_lock_count',lock_count,'reached_threshold',true,'is_banned',lvl>=2,'partner_id',partner,
    'violation',vlabel,'report_count',total_n,'sanction_trigger',trigger_code,'sanction_trigger_label',trigger_label,
    'critical_reporters',critical_n,'medium_reporters',medium_n,'spam_reporters',spam_n,'light_reporters',spam_n,'burst_reporters',burst_n,'distinct_reporters',total_n,
    'is_premium',COALESCE(t.premium_until>now(),false),'premium_until',t.premium_until,
    'username',t.username,'first_name',t.first_name,'report_card',card);
END
$function$;
REVOKE ALL ON FUNCTION public.submit_context_report(bigint,bigint,text,text,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_context_report(bigint,bigint,text,text,text,text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_report_action(p_user_id bigint,p_action text,p_admin_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  u telegram_users;
  partner bigint;
  v text;
  card jsonb;
BEGIN
  IF p_action NOT IN ('restore','lock','block14','perm') THEN RETURN jsonb_build_object('success',false,'error','invalid_action'); END IF;
  SELECT * INTO u FROM telegram_users WHERE id=p_user_id FOR UPDATE;
  IF u.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','user_not_found'); END IF;
  v:=COALESCE(u.sanction_violation,'Pelanggaran ketentuan layanan');
  PERFORM set_config('fiza.admin_override','on',true);
  UPDATE blocked_users SET is_active=false,unblocked_at=clock_timestamp(),unblocked_by=p_admin_id WHERE user_id=p_user_id AND is_active;
  partner:=CASE WHEN u.state='chatting' THEN u.partner_id END;
  IF p_action='restore' THEN
    UPDATE telegram_users SET moderation_state=CASE WHEN moderation_state='permanent' THEN 'normal' ELSE moderation_state END,
      sanction_level=GREATEST(sanction_level-1,0),sanction_lock_count=CASE WHEN sanction_level>1 THEN 1 ELSE 0 END,
      conduct_agreement_pending=false,report_lock_until=NULL,sanction_counted_since=clock_timestamp()
    WHERE id=p_user_id;
    card:=resolve_admin_report_card(p_user_id,p_action,p_admin_id);
    RETURN jsonb_build_object('success',true,'action',p_action,'violation',v,'report_card',card);
  END IF;
  IF p_action='lock' THEN
    UPDATE telegram_users SET moderation_state='normal',sanction_level=1,sanction_lock_count=1,conduct_agreement_pending=true,report_lock_until=clock_timestamp()+interval '3 days',
      sanction_counted_since=clock_timestamp(),state='idle',partner_id=NULL WHERE id=p_user_id;
  ELSIF p_action='block14' THEN
    UPDATE telegram_users SET moderation_state='normal',sanction_level=3,sanction_lock_count=0,conduct_agreement_pending=false,state='idle',partner_id=NULL WHERE id=p_user_id;
    INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,blocked_at,is_unblockable)
    VALUES(u.id,u.username,u.first_name,'report_stage3','Akun diblokir 14 hari karena pelanggaran: '||v,true,clock_timestamp(),false)
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=NULL,unblocked_by=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=false;
  ELSE
    UPDATE telegram_users SET moderation_state='permanent',sanction_lock_count=0,state='idle',partner_id=NULL WHERE id=p_user_id;
    INSERT INTO blocked_users(user_id,username,first_name,reason,blocked_message,is_active,blocked_at,is_unblockable)
    VALUES(u.id,u.username,u.first_name,'admin_command','Akun diblokir permanen karena pelanggaran: '||v,true,clock_timestamp(),false)
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),unblocked_at=NULL,unblocked_by=NULL,reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message,is_unblockable=false;
  END IF;
  IF partner IS NOT NULL THEN UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_user_id; END IF;
  DELETE FROM waiting_queue WHERE user_id=p_user_id;
  card:=resolve_admin_report_card(p_user_id,p_action,p_admin_id);
  RETURN jsonb_build_object('success',true,'action',p_action,'violation',v,'partner_id',partner,
    'blocked_until',clock_timestamp()+interval '14 days','report_card',card);
END
$function$;
REVOKE ALL ON FUNCTION public.admin_report_action(bigint,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_action(bigint,text,bigint) TO service_role;