CREATE OR REPLACE FUNCTION public.comprehensive_search_action(
    p_user_id bigint, 
    p_username text DEFAULT NULL::text, 
    p_first_name text DEFAULT NULL::text, 
    p_is_next boolean DEFAULT false,
    p_target_partner_id bigint DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_partner_id BIGINT := NULL;
  v_old_partner_id BIGINT := NULL;
  v_is_premium BOOLEAN;
  v_my_gender TEXT;
  v_my_target_gender TEXT;
  v_my_target_location TEXT;
  v_my_location TEXT;
  v_candidate RECORD;
  v_candidate_is_premium BOOLEAN;
  v_candidate_target_gender TEXT;
  v_candidate_target_location TEXT;
  v_i_satisfied_gender BOOLEAN;
  v_candidate_satisfied_gender BOOLEAN;
  v_i_satisfied_location BOOLEAN;
  v_candidate_satisfied_location BOOLEAN;
  v_penalty_points INTEGER;
  v_reputation_status TEXT;
  v_reputation_message TEXT;
  v_old_partner_promo JSON;
  v_chat_ended BOOLEAN := FALSE;
  v_should_check_channel BOOLEAN := FALSE;
  v_should_send_channel_invite BOOLEAN := FALSE;
  v_needs_gender BOOLEAN := FALSE;
  v_is_new_user BOOLEAN := FALSE;
  v_last_active_updated BOOLEAN := FALSE;
  v_is_blocked BOOLEAN := FALSE;
  v_blocked_message TEXT := NULL;
  v_max_history INT := 50;
  v_partner_premium_until TIMESTAMPTZ;
  v_blocked_until TIMESTAMPTZ;
  v_blocked_at TIMESTAMPTZ;
  v_unacknowledged_reports_count INT := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(p_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'concurrent_request');
  END IF;

  SELECT id, username, first_name, last_active, gender, state, partner_id,
         premium_until, target_gender, location, target_location,
         COALESCE(penalty_points, 0) as penalty_points, created_at, last_partners, is_channel_member,
         COALESCE(unacknowledged_reports_count, 0) as unacknowledged_reports_count
  INTO v_user FROM telegram_users WHERE id = p_user_id;

  IF v_user IS NULL THEN
    INSERT INTO telegram_users (id, username, first_name, last_active, state)
    VALUES (p_user_id, p_username, p_first_name, NOW(), 'idle');
    v_is_new_user := TRUE; v_last_active_updated := TRUE; v_needs_gender := TRUE;
    SELECT id, username, first_name, last_active, gender, state, partner_id,
           premium_until, target_gender, location, target_location,
           COALESCE(penalty_points, 0) as penalty_points, created_at, last_partners, is_channel_member,
           COALESCE(unacknowledged_reports_count, 0) as unacknowledged_reports_count
    INTO v_user FROM telegram_users WHERE id = p_user_id;
  ELSE
    DECLARE v_needs_update BOOLEAN := FALSE;
    BEGIN
      IF (v_user.username IS DISTINCT FROM p_username) OR (v_user.first_name IS DISTINCT FROM p_first_name) THEN v_needs_update := TRUE; END IF;
      IF v_user.last_active::DATE < CURRENT_DATE THEN v_last_active_updated := TRUE; v_needs_update := TRUE; END IF;
      IF v_needs_update THEN
        IF v_last_active_updated THEN
          UPDATE telegram_users SET username = p_username, first_name = p_first_name, last_active = NOW() WHERE id = p_user_id;
        ELSE
          UPDATE telegram_users SET username = p_username, first_name = p_first_name WHERE id = p_user_id;
        END IF;
      END IF;
    END;
  END IF;

  IF v_user.penalty_points >= 100 THEN
    DECLARE v_is_prem BOOLEAN;
            v_already_blocked BOOLEAN;
    BEGIN
       SELECT (premium_until IS NOT NULL AND premium_until > NOW()) INTO v_is_prem FROM telegram_users WHERE id = p_user_id;
       IF NOT v_is_prem THEN
         SELECT EXISTS(SELECT 1 FROM blocked_users WHERE user_id = p_user_id AND is_active = true) INTO v_already_blocked;
         IF NOT v_already_blocked THEN
           INSERT INTO blocked_users (user_id, reason, blocked_message, is_active, blocked_at)
           VALUES (p_user_id, 'auto_penalty_100', 'Akun diblokir karena terlalu banyak laporan negatif dari pengguna lain.', true, NOW())
           ON CONFLICT (user_id) DO UPDATE SET is_active = true, blocked_at = NOW(), unblocked_at = NULL, reason = EXCLUDED.reason, blocked_message = EXCLUDED.blocked_message;
         END IF;
       ELSE
         UPDATE telegram_users SET penalty_points = 0 WHERE id = p_user_id;
         v_user.penalty_points := 0;
       END IF;
    END;
  END IF;

  SELECT blocked_at INTO v_blocked_at FROM blocked_users WHERE user_id = p_user_id AND is_active = TRUE ORDER BY blocked_at DESC LIMIT 1;
  IF v_blocked_at IS NOT NULL THEN
    IF v_blocked_at + INTERVAL '15 days' > NOW() THEN
      SELECT blocked_message INTO v_blocked_message FROM blocked_users WHERE user_id = p_user_id AND is_active = TRUE LIMIT 1;
      v_is_blocked := TRUE; v_blocked_until := v_blocked_at + INTERVAL '15 days';
    ELSE
      UPDATE blocked_users SET is_active = FALSE, unblocked_at = NOW() WHERE user_id = p_user_id AND is_active = TRUE;
      UPDATE telegram_users SET penalty_points = 0, spam_warnings = 0, spam_warning_until = NULL, unacknowledged_reports_count = 0 WHERE id = p_user_id;
      v_is_blocked := FALSE; v_user.penalty_points := 0; v_user.unacknowledged_reports_count := 0;
    END IF;
  END IF;

  IF v_is_blocked THEN
    RETURN json_build_object('success', false, 'action', 'show_blocked', 'error', 'user_blocked', 'blocked_message', v_blocked_message, 'blocked_until', v_blocked_until);
  END IF;

  v_should_check_channel := FALSE;

  IF v_user.gender IS NULL AND NOT p_is_next THEN
    v_needs_gender := TRUE;
    RETURN json_build_object('success', true, 'action', 'needs_gender', 'should_check_channel', v_should_check_channel, 'is_new_user', v_is_new_user);
  END IF;

  IF v_user.state = 'chatting' AND NOT p_is_next THEN
    RETURN json_build_object('success', true, 'action', 'already_chatting', 'partner_id', v_user.partner_id, 'should_check_channel', v_should_check_channel);
  END IF;

  IF v_user.state = 'waiting' AND NOT p_is_next THEN
    IF EXISTS (SELECT 1 FROM waiting_queue WHERE user_id = p_user_id) THEN
      RETURN json_build_object('success', true, 'action', 'already_in_queue', 'should_check_channel', v_should_check_channel);
    ELSE
      UPDATE telegram_users SET state = 'idle' WHERE id = p_user_id;
    END IF;
  END IF;

  v_penalty_points := v_user.penalty_points;
  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW();
  v_unacknowledged_reports_count := v_user.unacknowledged_reports_count;
  IF v_unacknowledged_reports_count > 0 THEN
    UPDATE telegram_users SET unacknowledged_reports_count = 0 WHERE id = p_user_id;
  END IF;

  IF v_penalty_points >= 100 AND NOT v_is_premium THEN
    v_reputation_status := 'banned'; v_reputation_message := 'Akun Anda telah diblokir karena terlalu banyak laporan negatif.';
  ELSIF v_penalty_points >= 70 AND NOT v_is_premium THEN
    v_reputation_status := 'critical'; v_reputation_message := 'Akun Anda di ambang pemblokiran permanen.';
  ELSIF v_penalty_points >= 40 AND NOT v_is_premium THEN
    v_reputation_status := 'warning'; v_reputation_message := 'Kami menerima beberapa laporan negatif tentang Anda.';
  ELSE
    v_reputation_status := 'good'; v_reputation_message := NULL;
  END IF;

  IF v_reputation_status = 'banned' THEN
    RETURN json_build_object('success', false, 'error', 'user_banned', 'action', 'show_banned', 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;

  IF p_is_next AND v_user.state = 'chatting' AND v_user.partner_id IS NOT NULL THEN
    IF p_target_partner_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'action_expired', 'message', 'Aksi diabaikan karena Anda baru saja mendapatkan partner.');
    END IF;
    IF p_target_partner_id IS NOT NULL AND v_user.partner_id != p_target_partner_id THEN
        RETURN json_build_object('success', false, 'error', 'action_expired', 'message', 'Aksi diabaikan karena partner sudah berganti.');
    END IF;
    v_old_partner_id := v_user.partner_id;
    UPDATE telegram_users SET state = 'idle', partner_id = NULL, chat_end_count = COALESCE(chat_end_count, 0) + 1 WHERE id = p_user_id;
    IF FOUND THEN
      UPDATE telegram_users SET state = 'idle', partner_id = NULL, chat_end_count = COALESCE(chat_end_count, 0) + 1 WHERE id = v_old_partner_id;
      DELETE FROM waiting_queue WHERE user_id IN (p_user_id, v_old_partner_id);
      v_chat_ended := TRUE;
      SELECT public.handle_end_chat_promo_logic(v_old_partner_id) INTO v_old_partner_promo;
    END IF;
  END IF;

  IF p_is_next AND v_chat_ended THEN
    DECLARE v_my_promo JSON;
    BEGIN
       SELECT public.handle_end_chat_promo_logic(p_user_id) INTO v_my_promo;
       IF v_my_promo->>'should_send' = 'true' THEN
          RETURN json_build_object('success', true, 'action', 'show_promo', 'chat_ended', true, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
       END IF;
    END;
  END IF;

  IF NOT v_is_premium THEN
    SELECT public.check_channel_invite_eligibility(p_user_id) INTO v_should_send_channel_invite;
    IF v_should_send_channel_invite THEN
      RETURN json_build_object('success', true, 'action', 'show_channel_invite', 'should_send_channel_invite', true, 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
    END IF;
  END IF;

  IF v_should_check_channel THEN
    RETURN json_build_object('success', true, 'action', 'needs_channel_check', 'should_check_channel', true, 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;

  IF public.check_and_claim_special_promo(p_user_id) THEN
    RETURN json_build_object('success', true, 'action', 'show_special_promo', 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;

  v_my_gender := v_user.gender;
  IF v_is_premium THEN
    v_my_target_gender := v_user.target_gender; v_my_target_location := v_user.target_location;
  ELSE
    v_my_target_gender := 'semua'; v_my_target_location := 'semua';
  END IF;
  v_my_location := v_user.location;

  FOR v_candidate IN
    SELECT wq.user_id as candidate_id, tu.gender as candidate_gender, tu.target_gender as candidate_target_gender,
           tu.location as candidate_location, tu.target_location as candidate_target_location,
           tu.premium_until as candidate_premium_until, tu.state as candidate_state,
           tu.partner_id as candidate_partner_id, tu.last_partners as candidate_last_partners
    FROM waiting_queue wq JOIN telegram_users tu ON tu.id = wq.user_id
    WHERE wq.user_id != p_user_id AND tu.state = 'waiting'
    ORDER BY wq.joined_at ASC 
    FOR UPDATE OF wq, tu SKIP LOCKED
  LOOP
    IF v_candidate.candidate_state != 'waiting' OR v_candidate.candidate_partner_id IS NOT NULL THEN
      DELETE FROM waiting_queue WHERE user_id = v_candidate.candidate_id; CONTINUE;
    END IF;
    IF v_user.last_partners IS NOT NULL AND v_candidate.candidate_id = ANY(v_user.last_partners) THEN CONTINUE; END IF;
    IF v_candidate.candidate_last_partners IS NOT NULL AND p_user_id = ANY(v_candidate.candidate_last_partners) THEN CONTINUE; END IF;
    v_candidate_is_premium := v_candidate.candidate_premium_until IS NOT NULL AND v_candidate.candidate_premium_until > NOW();
    IF v_candidate_is_premium THEN
      v_candidate_target_gender := v_candidate.candidate_target_gender; v_candidate_target_location := v_candidate.candidate_target_location;
    ELSE
      v_candidate_target_gender := 'semua'; v_candidate_target_location := 'semua';
    END IF;
    v_i_satisfied_gender := TRUE;
    IF v_my_target_gender IS NOT NULL AND v_my_target_gender != 'semua' THEN
      IF v_candidate.candidate_gender IS NULL OR v_candidate.candidate_gender != v_my_target_gender THEN v_i_satisfied_gender := FALSE; END IF;
    END IF;
    v_candidate_satisfied_gender := TRUE;
    IF v_candidate_target_gender IS NOT NULL AND v_candidate_target_gender != 'semua' THEN
      IF v_my_gender IS NULL OR v_my_gender != v_candidate_target_gender THEN v_candidate_satisfied_gender := FALSE; END IF;
    END IF;
    v_i_satisfied_location := TRUE;
    IF v_my_target_location IS NOT NULL AND v_my_target_location != 'semua' THEN
      IF v_candidate.candidate_location IS NULL OR v_candidate.candidate_location != v_my_target_location THEN v_i_satisfied_location := FALSE; END IF;
    END IF;
    v_candidate_satisfied_location := TRUE;
    IF v_candidate_target_location IS NOT NULL AND v_candidate_target_location != 'semua' THEN
      IF v_my_location IS NULL OR v_my_location != v_candidate_target_location THEN v_candidate_satisfied_location := FALSE; END IF;
    END IF;
    IF v_i_satisfied_gender AND v_candidate_satisfied_gender AND v_i_satisfied_location AND v_candidate_satisfied_location THEN
      IF pg_try_advisory_xact_lock(v_candidate.candidate_id) THEN
          v_partner_id := v_candidate.candidate_id; 
          v_partner_premium_until := v_candidate.candidate_premium_until; 
          EXIT;
      ELSE
          CONTINUE;
      END IF;
    END IF;
  END LOOP;

  IF v_partner_id IS NOT NULL THEN
    UPDATE telegram_users SET state = 'chatting', partner_id = v_partner_id,
      last_partners = CASE WHEN v_partner_id IN (5920746214, 7168897972) THEN last_partners ELSE (ARRAY[v_partner_id] || COALESCE(last_partners, ARRAY[]::bigint[]))[1:v_max_history] END
    WHERE id = p_user_id;
    UPDATE telegram_users SET state = 'chatting', partner_id = p_user_id,
      last_partners = CASE WHEN p_user_id IN (5920746214, 7168897972) THEN last_partners ELSE (ARRAY[p_user_id] || COALESCE(last_partners, ARRAY[]::bigint[]))[1:v_max_history] END
    WHERE id = v_partner_id;
    DELETE FROM waiting_queue WHERE user_id = v_partner_id;
    RETURN json_build_object('success', true, 'matched', true, 'partner_id', v_partner_id, 'partner_premium_until', v_partner_premium_until, 'action', 'notify_both', 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'should_check_channel', v_should_check_channel, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  ELSE
    INSERT INTO waiting_queue (user_id, joined_at) VALUES (p_user_id, NOW()) ON CONFLICT (user_id) DO UPDATE SET joined_at = NOW();
    UPDATE telegram_users SET state = 'waiting' WHERE id = p_user_id;
    RETURN json_build_object('success', true, 'matched', false, 'partner_id', NULL, 'action', 'wait_in_queue', 'chat_ended', v_chat_ended, 'old_partner_id', v_old_partner_id, 'old_partner_promo', v_old_partner_promo, 'should_check_channel', v_should_check_channel, 'reputation', json_build_object('status', v_reputation_status, 'message', v_reputation_message, 'penalty_points', v_penalty_points, 'report_warnings_to_show', v_unacknowledged_reports_count));
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today_wib DATE := (NOW() AT TIME ZONE 'Asia/Jakarta')::DATE;
  v_today_start TIMESTAMPTZ := (v_today_wib::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');
  v_day30_start TIMESTAMPTZ := ((v_today_wib - 30)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');
  v_day31_start TIMESTAMPTZ := ((v_today_wib - 31)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');
  v_today_30_ago DATE := v_today_wib - 30;
  v_new_today BIGINT;
  v_active_today BIGINT;
  v_inactive30 BIGINT;
  v_churn BIGINT;
  v_today_baru30 BIGINT;
  v_revenue_premium BIGINT;
  v_revenue_topup BIGINT;
  v_revenue_fine BIGINT;
  v_revenue_today BIGINT;
  v_activity JSON;
  v_reengage_returns BIGINT;
  v_reengage_activity JSON;
  v_reengage_daily_stats JSON;
  v_transactions JSON;
  v_special_promo_eligible_today BIGINT;
  v_special_promo_sent_today BIGINT;
  v_special_promo_purchased_today BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_new_today FROM telegram_users WHERE created_at >= v_today_start;
  SELECT COUNT(*) INTO v_active_today FROM telegram_users WHERE last_active >= v_today_start;
  SELECT COUNT(*) INTO v_inactive30 FROM telegram_users WHERE last_active < v_day30_start;
  SELECT COUNT(*) INTO v_churn FROM telegram_users WHERE last_active >= v_day31_start AND last_active < v_day30_start;
  SELECT COUNT(*) INTO v_today_baru30 FROM telegram_users WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::DATE = v_today_30_ago;

  SELECT COALESCE(SUM(price), 0) INTO v_revenue_premium FROM premium_requests WHERE status = 'approved' AND processed_at >= v_today_start;
  SELECT COALESCE(SUM(amount * 10), 0) INTO v_revenue_topup FROM topup_requests WHERE status = 'approved' AND processed_at >= v_today_start;
  SELECT COALESCE(SUM(amount), 0) INTO v_revenue_fine FROM pending_transactions WHERE status = 'approved' AND admin_notes = 'FINE_PAYMENT' AND approved_at >= v_today_start;
  v_revenue_today := v_revenue_premium + v_revenue_topup + v_revenue_fine;

  SELECT COUNT(*) INTO v_reengage_returns FROM reengagement_clicks WHERE clicked_at >= NOW() - INTERVAL '30 days';

  WITH all_days AS (
    SELECT d.date AS day_wib, COALESCE(s.baru, 0) AS baru, COALESCE(s.aktif, 0) AS aktif, COALESCE(s.churn, 0) AS churn, COALESCE(s.baru30harilalu, 0) AS baru30harilalu
    FROM (SELECT (v_today_wib - generate_series(1, 29)) AS date) d
    LEFT JOIN daily_user_stats s ON s.date = d.date
    UNION ALL
    SELECT v_today_wib AS day_wib, v_new_today AS baru, v_active_today AS aktif, v_churn AS churn, v_today_baru30 AS baru30harilalu
  )
  SELECT json_agg(json_build_object('date', to_char(day_wib, 'YYYY-MM-DD'), 'baru', baru, 'aktif', aktif, 'churn', churn, 'baru30hariLalu', baru30harilalu) ORDER BY day_wib ASC)
  INTO v_activity FROM all_days;

  WITH date_series AS (SELECT (v_today_wib - i)::DATE AS day_wib FROM generate_series(0, 29) i),
  daily_clicks AS (
    SELECT d.day_wib,
      COALESCE(SUM(CASE WHEN c.template_key = 'cute_pleading_cat' THEN 1 ELSE 0 END), 0) AS cute_pleading_cat,
      COALESCE(SUM(CASE WHEN c.template_key = 'mysterious_gift_box' THEN 1 ELSE 0 END), 0) AS mysterious_gift_box,
      COALESCE(SUM(CASE WHEN c.template_key = 'grumpy_cute_cat' THEN 1 ELSE 0 END), 0) AS grumpy_cute_cat,
      COALESCE(SUM(CASE WHEN c.template_key = 'social_match_hearts' THEN 1 ELSE 0 END), 0) AS social_match_hearts,
      COUNT(c.id) AS total
    FROM date_series d LEFT JOIN reengagement_clicks c ON (c.clicked_at AT TIME ZONE 'Asia/Jakarta')::DATE = d.day_wib
    GROUP BY d.day_wib
  )
  SELECT json_agg(json_build_object('date', to_char(day_wib, 'YYYY-MM-DD'), 'label', to_char(day_wib, 'DD MMM'), 'cute_pleading_cat', cute_pleading_cat, 'mysterious_gift_box', mysterious_gift_box, 'grumpy_cute_cat', grumpy_cute_cat, 'social_match_hearts', social_match_hearts, 'total', total) ORDER BY day_wib ASC)
  INTO v_reengage_activity FROM daily_clicks;

  WITH date_series AS (SELECT (v_today_wib - i)::DATE AS day_wib FROM generate_series(0, 29) i)
  SELECT json_agg(json_build_object('date', to_char(ds.day_wib, 'YYYY-MM-DD'), 'eligible', COALESCE(rds.eligible_count, 0), 'sent', COALESCE(rds.sent_count, 0)) ORDER BY ds.day_wib ASC)
  INTO v_reengage_daily_stats FROM date_series ds LEFT JOIN reengagement_daily_stats rds ON rds.date = ds.day_wib;

  WITH date_series AS (SELECT (v_today_wib - i)::DATE AS day_wib FROM generate_series(0, 29) i),
  daily_premium AS (SELECT (processed_at AT TIME ZONE 'Asia/Jakarta')::DATE AS day_wib, COALESCE(SUM(price), 0) AS val FROM premium_requests WHERE status = 'approved' AND processed_at >= v_day30_start GROUP BY 1),
  daily_topup AS (SELECT (processed_at AT TIME ZONE 'Asia/Jakarta')::DATE AS day_wib, COALESCE(SUM(amount * 10), 0) AS val FROM topup_requests WHERE status = 'approved' AND processed_at >= v_day30_start GROUP BY 1),
  daily_fine AS (SELECT (approved_at AT TIME ZONE 'Asia/Jakarta')::DATE AS day_wib, COALESCE(SUM(amount), 0) AS val FROM pending_transactions WHERE status = 'approved' AND admin_notes = 'FINE_PAYMENT' AND approved_at >= v_day30_start GROUP BY 1)
  SELECT json_agg(json_build_object('date', to_char(d.day_wib, 'YYYY-MM-DD'), 'label', to_char(d.day_wib, 'DD MMM'), 'premium', COALESCE(dp.val, 0), 'topup', COALESCE(dt.val, 0), 'fine', COALESCE(df.val, 0), 'total', COALESCE(dp.val, 0) + COALESCE(dt.val, 0) + COALESCE(df.val, 0)) ORDER BY d.day_wib ASC)
  INTO v_transactions FROM date_series d LEFT JOIN daily_premium dp ON dp.day_wib = d.day_wib LEFT JOIN daily_topup dt ON dt.day_wib = d.day_wib LEFT JOIN daily_fine df ON df.day_wib = d.day_wib;

  SELECT COUNT(*) INTO v_special_promo_sent_today FROM telegram_users WHERE special_promo_sent_at >= v_today_start;
  SELECT COUNT(*) INTO v_special_promo_purchased_today FROM telegram_users WHERE special_promo_purchased_at >= v_today_start;
  SELECT COUNT(*) INTO v_special_promo_eligible_today FROM telegram_users
    WHERE premium_until IS NULL
      AND has_received_special_promo = false
      AND created_at <= NOW() - INTERVAL '7 days'
      AND last_active >= CURRENT_DATE
      AND last_active <= NOW() - INTERVAL '3 hours'
      AND (last_reengagement_sent_at IS NULL OR last_reengagement_sent_at <= NOW() - INTERVAL '7 days')
      AND NOT EXISTS (SELECT 1 FROM blocked_users WHERE blocked_users.user_id = telegram_users.id AND blocked_users.unblocked_at > NOW() - INTERVAL '7 days');

  RETURN json_build_object(
    'kpis', json_build_object('newToday', v_new_today, 'activeToday', v_active_today, 'inactive30', v_inactive30, 'churn', v_churn, 'reengageReturns', v_reengage_returns, 'revenueToday', v_revenue_today),
    'activity', v_activity,
    'reengage_activity', COALESCE(v_reengage_activity, '[]'::json),
    'reengage_daily_stats', COALESCE(v_reengage_daily_stats, '[]'::json),
    'transactions', COALESCE(v_transactions, '[]'::json),
    'special_promo', json_build_object('eligibleToday', v_special_promo_eligible_today, 'sentToday', v_special_promo_sent_today, 'purchasedToday', v_special_promo_purchased_today)
  );
END;
$$;