ALTER TABLE public.admin_report_cards ADD COLUMN IF NOT EXISTS sanction_trigger text;
COMMENT ON COLUMN public.admin_report_cards.sanction_trigger IS 'Alasan pemicu sanksi otomatis untuk transparansi admin';
COMMENT ON COLUMN public.telegram_users.penalty_points IS 'DEPRECATED: poin penalti tidak digunakan; sanksi berdasarkan jenis dan frekuensi laporan';
COMMENT ON COLUMN public.partner_reports.penalty_change IS 'DEPRECATED: selalu 0 untuk laporan baru; gunakan report_context, report_category, reporter_id, created_at';

CREATE OR REPLACE FUNCTION public.report_category_threshold(p_context text,p_category text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE p_context||':'||p_category
    WHEN 'partner:fraud' THEN 2 WHEN 'partner:harassment' THEN 3 WHEN 'partner:spam' THEN 4
    WHEN 'link:fraud' THEN 2 WHEN 'link:sexual' THEN 3 WHEN 'link:promotion' THEN 4 WHEN 'link:doxxing' THEN 2
    WHEN 'media:sexual' THEN 3 WHEN 'media:fraud' THEN 2
    ELSE NULL
  END
$function$;
REVOKE ALL ON FUNCTION public.report_category_threshold(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.report_category_threshold(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.append_admin_report_card(
  p_target_user_id bigint,
  p_context text,
  p_category text,
  p_label text,
  p_detail text,
  p_source_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  c public.admin_report_cards;
  items jsonb;
  entry jsonb;
  normalized text;
  duplicate_link boolean;
BEGIN
  SELECT * INTO c FROM public.admin_report_cards WHERE target_user_id=p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.admin_report_cards(target_user_id) VALUES(p_target_user_id)
    ON CONFLICT(target_user_id) DO NOTHING;
    SELECT * INTO c FROM public.admin_report_cards WHERE target_user_id=p_target_user_id FOR UPDATE;
  END IF;
  IF c.status<>'pending' THEN
    UPDATE public.admin_report_cards SET
      admin_message_id=NULL,report_count=0,snippets='[]'::jsonb,status='pending',
      last_action=NULL,resolved_by=NULL,resolved_at=NULL,sanction_trigger=NULL,
      created_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE target_user_id=p_target_user_id
    RETURNING * INTO c;
  END IF;

  normalized:=lower(regexp_replace(trim(COALESCE(p_detail,'')),'[[:space:]]+',' ','g'));
  duplicate_link:=p_context='link' AND normalized<>'' AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(c.snippets) AS item
    WHERE lower(regexp_replace(trim(COALESCE(item->>'detail','')),'[[:space:]]+',' ','g'))=normalized
  );
  items:=c.snippets;
  IF NOT duplicate_link THEN
    entry:=jsonb_build_object(
      'context',p_context,
      'category',p_category,
      'label',left(COALESCE(p_label,'Pelanggaran ketentuan layanan'),160),
      'detail',left(COALESCE(p_detail,''),160),
      'source_id',p_source_id,
      'at',clock_timestamp()
    );
    items:=items||jsonb_build_array(entry);
    WHILE jsonb_array_length(items)>7 LOOP items:=items-0; END LOOP;
  END IF;

  UPDATE public.admin_report_cards AS card
  SET report_count=card.report_count+1,
      snippets=items,
      username=u.username,
      first_name=u.first_name,
      is_premium=COALESCE(u.premium_until>now(),false),
      premium_until=u.premium_until,
      sanction_stage=u.sanction_level,
      sanction_violation=u.sanction_violation,
      updated_at=clock_timestamp()
  FROM public.telegram_users AS u
  WHERE card.target_user_id=p_target_user_id AND u.id=p_target_user_id
  RETURNING card.* INTO c;
  RETURN to_jsonb(c);
END
$function$;

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
  light_n integer;
  burst_n integer;
  total_n integer;
  lvl integer := 0;
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
      count(DISTINCT reporter_id) FILTER(WHERE report_category IN ('spam','promotion'))::integer AS light_count,
      count(DISTINCT reporter_id) FILTER(WHERE created_at>now()-interval '30 minutes')::integer AS burst_count,
      count(DISTINCT reporter_id)::integer AS total_count
    FROM windowed
  )
  SELECT critical_count,medium_count,light_count,burst_count,total_count
  INTO critical_n,medium_n,light_n,burst_n,total_n
  FROM aggregated;

  IF critical_n>=2 THEN
    trigger_code:='critical';
    trigger_label:='Kategori kritis (fraud/doxxing) • '||critical_n||' pelapor dalam 12 jam';
    vlabel:='Penipuan / penyebaran data pribadi';
  ELSIF medium_n>=3 THEN
    trigger_code:='medium';
    trigger_label:='Kategori sedang (sexual/harassment) • '||medium_n||' pelapor dalam 12 jam';
    vlabel:='Pelecehan / konten seksual';
  ELSIF light_n>=4 THEN
    trigger_code:='light';
    trigger_label:='Kategori ringan (spam/promotion) • '||light_n||' pelapor dalam 12 jam';
    vlabel:='Spam / promosi';
  ELSIF burst_n>=3 THEN
    trigger_code:='burst';
    trigger_label:='Lonjakan cepat • '||burst_n||' pelapor dalam 30 menit';
    vlabel:='Lonjakan laporan dari beberapa pengguna';
  ELSIF total_n>=4 THEN
    trigger_code:='aggregate';
    trigger_label:='Akumulasi lintas kategori • '||total_n||' pelapor dalam 12 jam';
    vlabel:='Beberapa jenis pelanggaran';
  ELSE
    vlabel:=report_violation_label(p_context,p_category);
    card:=append_admin_report_card(p_reported_id,p_context,p_category,vlabel,COALESCE(p_detail,''),p_source_id);
    RETURN jsonb_build_object('success',true,'silent',false,'sanction_stage',0,'reached_threshold',false,
      'critical_reporters',critical_n,'medium_reporters',medium_n,'light_reporters',light_n,
      'burst_reporters',burst_n,'distinct_reporters',total_n,'report_card',card);
  END IF;

  lvl:=LEAST(t.sanction_level+1,3);
  partner:=t.partner_id;
  UPDATE telegram_users SET sanction_level=lvl,sanction_counted_since=clock_timestamp(),sanction_violation=vlabel,state='idle',partner_id=NULL,
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
  RETURN jsonb_build_object('success',true,'silent',false,'sanction_stage',lvl,'reached_threshold',true,'is_banned',lvl>=2,'partner_id',partner,
    'violation',vlabel,'report_count',total_n,'sanction_trigger',trigger_code,'sanction_trigger_label',trigger_label,
    'critical_reporters',critical_n,'medium_reporters',medium_n,'light_reporters',light_n,'burst_reporters',burst_n,'distinct_reporters',total_n,
    'is_premium',COALESCE(t.premium_until>now(),false),'premium_until',t.premium_until,
    'username',t.username,'first_name',t.first_name,'report_card',card);
END
$function$;

CREATE OR REPLACE FUNCTION public.submit_partner_report(p_reporter_id bigint,p_reported_id bigint,p_report_type text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE
  mapped_context text;
  mapped_category text;
BEGIN
  mapped_context:=CASE p_report_type
    WHEN 'spam' THEN 'partner' WHEN 'sange' THEN 'partner' WHEN 'link_spam' THEN 'link'
    WHEN 'media_sange' THEN 'media' WHEN 'media_spam' THEN 'media' ELSE NULL END;
  mapped_category:=CASE p_report_type
    WHEN 'spam' THEN 'spam' WHEN 'sange' THEN 'harassment' WHEN 'link_spam' THEN 'promotion'
    WHEN 'media_sange' THEN 'sexual' WHEN 'media_spam' THEN 'fraud' ELSE NULL END;
  IF mapped_context IS NOT NULL THEN
    RETURN public.submit_context_report(p_reporter_id,p_reported_id,mapped_context,mapped_category)::json;
  END IF;
  IF p_report_type NOT IN ('baik','asik') THEN
    RETURN json_build_object('success',false,'error','invalid_report_type');
  END IF;
  IF EXISTS(
    SELECT 1 FROM partner_reports
    WHERE reporter_id=p_reporter_id AND reported_id=p_reported_id AND created_at>now()-interval '1 hour'
  ) THEN
    RETURN json_build_object('success',false,'error','already_reported');
  END IF;
  INSERT INTO partner_reports(reporter_id,reported_id,report_type,penalty_change)
  VALUES(p_reporter_id,p_reported_id,p_report_type,0);
  RETURN json_build_object('success',true,'is_banned',false,'is_temp_banned',false,'is_shadowbanned',false);
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_process_media_report(p_sender_id bigint,p_action text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'Asia/Jakarta'
AS $function$
DECLARE partner bigint;
BEGIN
  IF p_action NOT IN ('warn','block') THEN RETURN json_build_object('success',false); END IF;
  PERFORM id FROM telegram_users WHERE id=p_sender_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success',false); END IF;
  IF p_action='block' THEN
    INSERT INTO blocked_users(user_id,reason,blocked_message,is_active,blocked_at)
    VALUES(p_sender_id,'admin_media_block','Akun dibatasi sementara oleh admin. Sanggahan: @FizaTalkCS.',true,clock_timestamp())
    ON CONFLICT(user_id) DO UPDATE SET is_active=true,blocked_at=clock_timestamp(),reason=EXCLUDED.reason,blocked_message=EXCLUDED.blocked_message;
    SELECT partner_id INTO partner FROM telegram_users WHERE id=p_sender_id;
    UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=p_sender_id;
    UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=partner AND partner_id=p_sender_id;
    DELETE FROM waiting_queue WHERE user_id=p_sender_id;
  END IF;
  RETURN json_build_object('success',true,'action',CASE WHEN p_action='block' THEN 'blocked' ELSE 'warned' END);
END
$function$;

DROP FUNCTION public.report_weight(text,text);
