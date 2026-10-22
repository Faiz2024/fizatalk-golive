DO $do$
DECLARE s text;
BEGIN
 s := pg_get_functiondef('public.submit_context_report(bigint,bigint,text,text,text,text,bigint)'::regprocedure);
 s := replace(s, 'report_category,created_at) VALUES(p_reporter_id,p_reported_id,legacy,1,p_context,p_category,now())', 'report_category,created_at) VALUES(p_reporter_id,p_reported_id,legacy,1,p_context,p_category,clock_timestamp())');
 s := replace(s, 'sanction_counted_since=now()', 'sanction_counted_since=clock_timestamp()');
 IF position('clock_timestamp())' in s)=0 THEN RAISE EXCEPTION 'marker missing'; END IF;
 EXECUTE s;
END $do$;