CREATE OR REPLACE FUNCTION public.find_and_pair_partner(p_user_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_candidate RECORD;
  v_partner_id BIGINT := NULL;

  v_is_premium BOOLEAN;
  v_candidate_is_premium BOOLEAN;

  v_my_gender TEXT;
  v_my_target_gender TEXT;
  v_my_location TEXT;
  v_my_target_location TEXT;

  v_candidate_target_gender TEXT;
  v_candidate_target_location TEXT;

  v_i_satisfied_gender BOOLEAN;
  v_candidate_satisfied_gender BOOLEAN;
  v_i_satisfied_location BOOLEAN;
  v_candidate_satisfied_location BOOLEAN;

  v_max_history INT := 25;
BEGIN
  -- 1. Ambil data user & lock row
  SELECT
    gender, target_gender, location, target_location,
    premium_until, state, partner_id, last_partners
  INTO v_user
  FROM telegram_users
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.state = 'chatting' OR v_user.partner_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'user_already_chatting', 'partner_id', v_user.partner_id);
  END IF;

  -- Filter HANYA aktif untuk user premium; non-premium dipaksa 'semua'
  v_is_premium := v_user.premium_until IS NOT NULL AND v_user.premium_until > NOW();
  v_my_gender := v_user.gender;
  v_my_location := v_user.location;

  IF v_is_premium THEN
    v_my_target_gender := v_user.target_gender;
    v_my_target_location := v_user.target_location;
  ELSE
    v_my_target_gender := 'semua';
    v_my_target_location := 'semua';
  END IF;

  -- 2. Loop Antrian
  FOR v_candidate IN
    SELECT
      wq.user_id as candidate_id,
      tu.gender as candidate_gender,
      tu.target_gender as candidate_target_gender,
      tu.location as candidate_location,
      tu.target_location as candidate_target_location,
      tu.premium_until as candidate_premium_until,
      tu.state as candidate_state,
      tu.partner_id as candidate_partner_id,
      tu.last_partners as candidate_last_partners
    FROM waiting_queue wq
    JOIN telegram_users tu ON tu.id = wq.user_id
    WHERE wq.user_id != p_user_id
    ORDER BY wq.joined_at ASC
    FOR UPDATE OF wq SKIP LOCKED
  LOOP
    IF v_candidate.candidate_state != 'waiting' OR v_candidate.candidate_partner_id IS NOT NULL THEN
      DELETE FROM waiting_queue WHERE user_id = v_candidate.candidate_id;
      CONTINUE;
    END IF;

    IF v_user.last_partners IS NOT NULL AND v_candidate.candidate_id = ANY(v_user.last_partners) THEN
        CONTINUE;
    END IF;
    IF v_candidate.candidate_last_partners IS NOT NULL AND p_user_id = ANY(v_candidate.candidate_last_partners) THEN
        CONTINUE;
    END IF;

    v_candidate_is_premium := v_candidate.candidate_premium_until IS NOT NULL AND v_candidate.candidate_premium_until > NOW();
    IF v_candidate_is_premium THEN
      v_candidate_target_gender := v_candidate.candidate_target_gender;
      v_candidate_target_location := v_candidate.candidate_target_location;
    ELSE
      v_candidate_target_gender := 'semua';
      v_candidate_target_location := 'semua';
    END IF;

    -- Gender Match
    v_i_satisfied_gender := (v_my_target_gender IS NULL OR v_my_target_gender = 'semua' OR v_candidate.candidate_gender = v_my_target_gender);
    v_candidate_satisfied_gender := (v_candidate_target_gender IS NULL OR v_candidate_target_gender = 'semua' OR v_my_gender = v_candidate_target_gender);

    -- Location Match
    v_i_satisfied_location := (v_my_target_location IS NULL OR v_my_target_location = 'semua' OR v_candidate.candidate_location = v_my_target_location);
    v_candidate_satisfied_location := (v_candidate_target_location IS NULL OR v_candidate_target_location = 'semua' OR v_my_location = v_candidate_target_location);

    IF v_i_satisfied_gender AND v_candidate_satisfied_gender AND
       v_i_satisfied_location AND v_candidate_satisfied_location THEN
      v_partner_id := v_candidate.candidate_id;
      EXIT;
    END IF;
  END LOOP;

  -- 3. Proses Hasil
  IF v_partner_id IS NOT NULL THEN
    UPDATE telegram_users
    SET state = 'chatting',
        partner_id = v_partner_id,
        last_partners = CASE
            WHEN v_partner_id IN (5920746214, 7168897972) THEN last_partners
            ELSE (ARRAY[v_partner_id] || COALESCE(last_partners, ARRAY[]::bigint[]))[1:v_max_history]
        END
    WHERE id = p_user_id;

    UPDATE telegram_users
    SET state = 'chatting',
        partner_id = p_user_id,
        last_partners = CASE
            WHEN p_user_id IN (5920746214, 7168897972) THEN last_partners
            ELSE (ARRAY[p_user_id] || COALESCE(last_partners, ARRAY[]::bigint[]))[1:v_max_history]
        END
    WHERE id = v_partner_id;

    DELETE FROM waiting_queue WHERE user_id = v_partner_id;

    RETURN json_build_object(
      'success', true,
      'status', 'matched',
      'partner_id', v_partner_id
    );
  ELSE
    INSERT INTO waiting_queue (user_id, joined_at) VALUES (p_user_id, NOW())
    ON CONFLICT (user_id) DO UPDATE SET joined_at = NOW();

    UPDATE telegram_users SET state = 'waiting' WHERE id = p_user_id;

    RETURN json_build_object(
      'success', true,
      'status', 'waiting',
      'partner_id', NULL
    );
  END IF;
END;
$function$;