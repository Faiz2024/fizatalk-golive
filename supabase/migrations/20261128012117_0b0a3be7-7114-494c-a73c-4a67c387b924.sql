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
   SELECT NULLIF(value::jsonb,'null'::jsonb) INTO v_cursor FROM bot_settings WHERE key=v_key;
   v_count:=0; v_scanned:=0;
   FOR r IN
     SELECT t.id,t.last_active,t.last_reengagement_sent_at FROM telegram_users t
     WHERE t.state='idle'
       AND (t.last_reengagement_sent_at IS NULL OR t.last_reengagement_sent_at<'2099-01-01T00:00:00+07'::timestamptz)
       AND t.last_active <= CASE WHEN v_warm THEN v_now-interval '3 days' ELSE v_now-interval '21 days'-interval '1 microsecond' END
       AND t.last_active >= CASE WHEN v_warm THEN v_now-interval '21 days' ELSE '-infinity'::timestamptz END
       AND (t.last_active,t.id) < (COALESCE((v_cursor->>'at')::timestamptz,'infinity'::timestamptz),COALESCE((v_cursor->>'id')::bigint,9223372036854775807))
     ORDER BY t.last_active DESC,t.id DESC LIMIT 1000
   LOOP
     v_scanned:=v_scanned+1;
     v_cursor:=jsonb_build_object('at',r.last_active,'id',r.id);
     IF r.last_reengagement_sent_at IS NULL OR r.last_reengagement_sent_at <= v_now-(CASE WHEN v_warm THEN interval '7 days' ELSE interval '14 days' END) THEN
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