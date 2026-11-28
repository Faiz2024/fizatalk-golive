ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '20s';
ALTER ROLE service_role SET idle_in_transaction_session_timeout = '20s';

CREATE INDEX IF NOT EXISTS idx_tu_reengage_rotation ON public.telegram_users (last_active DESC, id DESC) WHERE state='idle' AND (last_reengagement_sent_at IS NULL OR last_reengagement_sent_at < '2099-01-01T00:00:00+07'::timestamptz);

CREATE OR REPLACE FUNCTION public.set_bot_membership(p_user_id bigint, p_blocked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u record; v_partner bigint;
BEGIN
 SELECT * INTO u FROM telegram_users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('changed',false); END IF;
 IF p_blocked = (COALESCE(u.last_reengagement_sent_at >= '2099-01-01T00:00:00+07'::timestamptz,false)) THEN
   RETURN jsonb_build_object('changed',false);
 END IF;
 IF p_blocked THEN
   v_partner := u.partner_id;
   UPDATE telegram_users SET last_reengagement_sent_at='2099-12-31T00:00:00+07', state='idle', partner_id=NULL WHERE id=p_user_id;
   DELETE FROM waiting_queue WHERE user_id=p_user_id;
   UPDATE telegram_users SET state='idle',partner_id=NULL WHERE id=v_partner AND partner_id=p_user_id;
   IF NOT FOUND THEN v_partner := NULL; END IF;
 ELSE
   UPDATE telegram_users SET last_reengagement_sent_at=NULL, last_active=now(), state='idle',partner_id=NULL WHERE id=p_user_id;
   DELETE FROM waiting_queue WHERE user_id=p_user_id;
 END IF;
 RETURN jsonb_build_object('changed',true,'partner_id',v_partner);
END $$;
REVOKE ALL ON FUNCTION public.set_bot_membership(bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_bot_membership(bigint,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_reengagement_drip(p_limit integer DEFAULT 50)
RETURNS TABLE(id bigint,first_name text,last_reengagement_message_id bigint,prev_sent_at timestamptz,claimed_at timestamptz,last_active timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='5s' SET lock_timeout='500ms' AS $$
DECLARE v_now timestamptz:=now(); v_lease text; v_cursor jsonb; v_key text; v_warm boolean; v_cap integer; v_count integer; v_scanned integer; r record; v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,50),1),50);
BEGIN
 IF NOT pg_try_advisory_xact_lock(72811301) THEN RETURN; END IF;
 SELECT value INTO v_lease FROM bot_settings WHERE key='reengage_drip_lease';
 IF v_lease IS NOT NULL AND v_lease::timestamptz>v_now THEN RETURN; END IF;
 INSERT INTO bot_settings(key,value,updated_at) VALUES('reengage_drip_lease',(v_now+interval '5 minutes')::text,v_now)
 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at;
 FOREACH v_warm IN ARRAY ARRAY[true,false] LOOP
   v_cap:=CASE WHEN v_warm THEN CEIL(v_limit*0.8)::int ELSE v_limit-CEIL(v_limit*0.8)::int END;
   IF v_cap=0 THEN CONTINUE; END IF;
   v_key:=CASE WHEN v_warm THEN 'reengage_cursor_warm' ELSE 'reengage_cursor_cold' END;
   SELECT value::jsonb INTO v_cursor FROM bot_settings WHERE key=v_key;
   v_count:=0; v_scanned:=0;
   FOR r IN
     SELECT t.id,t.last_active,t.last_reengagement_sent_at FROM telegram_users t
     WHERE t.state='idle'
       AND (t.last_reengagement_sent_at IS NULL OR t.last_reengagement_sent_at<'2099-01-01T00:00:00+07'::timestamptz)
       AND t.last_active<=v_now-interval '3 days'
       AND ((v_warm AND t.last_active>=v_now-interval '21 days') OR (NOT v_warm AND t.last_active<v_now-interval '21 days'))
       AND (v_cursor IS NULL OR (t.last_active,t.id)<((v_cursor->>'at')::timestamptz,(v_cursor->>'id')::bigint))
     ORDER BY t.last_active DESC,t.id DESC LIMIT 1000
   LOOP
     v_scanned:=v_scanned+1;
     v_cursor:=jsonb_build_object('at',r.last_active,'id',r.id);
     IF r.last_reengagement_sent_at IS NULL OR r.last_reengagement_sent_at <= v_now - (CASE WHEN v_warm THEN interval '7 days' ELSE interval '14 days' END) THEN
       RETURN QUERY UPDATE telegram_users t SET last_reengagement_sent_at=v_now
       WHERE t.id=r.id AND t.state='idle' AND t.last_active=r.last_active
         AND t.last_reengagement_sent_at IS NOT DISTINCT FROM r.last_reengagement_sent_at
         AND t.moderation_state='normal'
         AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE b.user_id=t.id AND b.is_active)
       RETURNING t.id,t.first_name,t.last_reengagement_message_id,r.last_reengagement_sent_at,v_now,t.last_active;
       IF FOUND THEN v_count:=v_count+1; END IF;
       IF v_count>=v_cap THEN EXIT; END IF;
     END IF;
   END LOOP;
   IF v_scanned<1000 AND v_count<v_cap THEN v_cursor:=NULL; END IF;
   INSERT INTO bot_settings(key,value,updated_at) VALUES(v_key,COALESCE(v_cursor::text,'null'),v_now)
   ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_reengagement_drip(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reengagement_drip(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_reengagement_batch(p_limit integer)
RETURNS TABLE(id bigint,first_name text,last_reengagement_message_id bigint,prev_sent_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT d.id,d.first_name,d.last_reengagement_message_id,d.prev_sent_at FROM public.claim_reengagement_drip(p_limit) d;
$$;
REVOKE ALL ON FUNCTION public.claim_reengagement_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reengagement_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_reengagement_batch(p_results jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sent integer; v_blocked integer; v_err integer; v_warm integer; v_cold integer; v_date date:=(now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
 UPDATE telegram_users t SET
  last_reengagement_message_id=CASE WHEN r.status='sent' THEN r.message_id ELSE t.last_reengagement_message_id END,
  last_reengagement_sent_at=CASE r.status
    WHEN 'blocked' THEN '2099-12-31T00:00:00+07'::timestamptz
    WHEN 'error' THEN now()-CASE WHEN t.last_active>=now()-interval '21 days' THEN interval '6 days' ELSE interval '13 days' END
    WHEN 'permanent' THEN now()+interval '23 days'
    ELSE t.last_reengagement_sent_at END
 FROM jsonb_to_recordset(p_results) AS r(id bigint,status text,message_id bigint,prev timestamptz,claimed_at timestamptz)
 WHERE t.id=r.id
   AND (r.claimed_at IS NULL OR t.last_reengagement_sent_at=r.claimed_at)
   AND t.last_reengagement_sent_at<'2099-01-01T00:00:00+07'::timestamptz;
 SELECT count(*) FILTER(WHERE x->>'status'='sent'),count(*) FILTER(WHERE x->>'status'='blocked'),count(*) FILTER(WHERE x->>'status' IN ('error','permanent'))
 INTO v_sent,v_blocked,v_err FROM jsonb_array_elements(p_results) x;
 SELECT count(*) FILTER(WHERE COALESCE(r.last_active,t.last_active)>=now()-interval '21 days'),count(*) FILTER(WHERE COALESCE(r.last_active,t.last_active)<now()-interval '21 days')
 INTO v_warm,v_cold FROM jsonb_to_recordset(p_results) AS r(id bigint,status text,last_active timestamptz) JOIN telegram_users t ON t.id=r.id WHERE r.status='sent';
 IF COALESCE(jsonb_array_length(p_results),0)=0 THEN RETURN; END IF;
 INSERT INTO reengagement_daily_stats(date,sent_count,blocked_count,error_count,sent_7d,sent_30d,updated_at)
 VALUES(v_date,v_sent,v_blocked,v_err,v_warm,v_cold,now()) ON CONFLICT(date) DO UPDATE SET
 sent_count=reengagement_daily_stats.sent_count+EXCLUDED.sent_count,blocked_count=reengagement_daily_stats.blocked_count+EXCLUDED.blocked_count,error_count=reengagement_daily_stats.error_count+EXCLUDED.error_count,sent_7d=reengagement_daily_stats.sent_7d+EXCLUDED.sent_7d,sent_30d=reengagement_daily_stats.sent_30d+EXCLUDED.sent_30d,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.finish_reengagement_batch(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_reengagement_batch(jsonb) TO service_role;

DO $$ DECLARE v_job bigint; BEGIN
 SELECT jobid INTO v_job FROM cron.job WHERE jobname='reengage-inactive-users';
 IF v_job IS NOT NULL THEN PERFORM cron.alter_job(v_job,schedule:='*/10 4-14 * * *'); END IF;
END $$;
NOTIFY pgrst,'reload schema';