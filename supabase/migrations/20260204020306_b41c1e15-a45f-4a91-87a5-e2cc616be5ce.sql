-- =====================================================
-- CONSOLIDATED RPC: end_chat_comprehensive
-- Menggabungkan semua operasi end chat dalam 1 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.end_chat_comprehensive(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user RECORD;
  v_partner_id BIGINT;
  v_partner_reset BOOLEAN := FALSE;
  v_user_promo JSON;
  v_partner_promo JSON;
BEGIN
  -- 1. Ambil data user dengan lock
  SELECT state, partner_id INTO v_user
  FROM telegram_users
  WHERE id = p_user_id
  FOR UPDATE;
  
  -- Validasi: user harus dalam state chatting dengan partner
  IF v_user IS NULL OR v_user.state != 'chatting' OR v_user.partner_id IS NULL THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'not_in_chat',
      'partner_id', NULL
    );
  END IF;
  
  v_partner_id := v_user.partner_id;
  
  -- 2. ATOMIC RESET: Reset user HANYA jika masih punya partner yang sama
  UPDATE telegram_users
  SET state = 'idle', partner_id = NULL
  WHERE id = p_user_id AND partner_id = v_partner_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'already_reset',
      'partner_id', v_partner_id
    );
  END IF;
  
  -- 3. Cek promo untuk user utama
  SELECT public.handle_end_chat_promo_logic(p_user_id) INTO v_user_promo;
  
  -- 4. Cek promo untuk partner
  SELECT public.handle_end_chat_promo_logic(v_partner_id) INTO v_partner_promo;
  
  -- 5. Reset partner HANYA jika masih connected ke kita
  UPDATE telegram_users
  SET state = 'idle', partner_id = NULL
  WHERE id = v_partner_id AND partner_id = p_user_id;
  
  IF FOUND THEN
    v_partner_reset := TRUE;
  END IF;
  
  -- 6. Hapus dari waiting queue
  DELETE FROM waiting_queue WHERE user_id IN (p_user_id, v_partner_id);
  
  -- 7. Return hasil lengkap
  RETURN json_build_object(
    'success', TRUE,
    'partner_id', v_partner_id,
    'partner_reset', v_partner_reset,
    'user_promo', v_user_promo,
    'partner_promo', v_partner_promo
  );
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: update_user_gender
-- Update gender dalam 1 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_user_gender(p_user_id BIGINT, p_gender TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_location TEXT;
BEGIN
  -- Update gender dan ambil location dalam satu operasi
  UPDATE telegram_users
  SET gender = p_gender
  WHERE id = p_user_id
  RETURNING location INTO v_location;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'user_not_found', 'needs_location', FALSE);
  END IF;
  
  RETURN json_build_object(
    'success', TRUE,
    'needs_location', (v_location IS NULL)
  );
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: update_user_location
-- Update location dalam 1 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_user_location(p_user_id BIGINT, p_location TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE telegram_users
  SET location = p_location
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;
  
  RETURN json_build_object('success', TRUE);
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: update_target_gender
-- Update target_gender dalam 1 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_target_gender(p_user_id BIGINT, p_target_gender TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE telegram_users
  SET target_gender = p_target_gender
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;
  
  RETURN json_build_object('success', TRUE);
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: update_target_location
-- Update target_location dalam 1 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_target_location(p_user_id BIGINT, p_target_location TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE telegram_users
  SET target_location = p_target_location
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;
  
  RETURN json_build_object('success', TRUE);
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: set_user_payment_state
-- Set state ke awaiting_payment dan return info
-- =====================================================

CREATE OR REPLACE FUNCTION public.set_user_payment_state(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id BIGINT;
BEGIN
  -- Update state dan ambil partner_id
  UPDATE telegram_users
  SET state = 'awaiting_payment'
  WHERE id = p_user_id
  RETURNING partner_id INTO v_partner_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;
  
  RETURN json_build_object(
    'success', TRUE,
    'partner_id', v_partner_id
  );
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: reset_payment_state
-- Reset state dari awaiting_payment ke idle/chatting
-- =====================================================

CREATE OR REPLACE FUNCTION public.reset_payment_state(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id BIGINT;
  v_new_state TEXT;
BEGIN
  -- Ambil partner_id untuk menentukan state baru
  SELECT partner_id INTO v_partner_id
  FROM telegram_users
  WHERE id = p_user_id;
  
  IF v_partner_id IS NOT NULL THEN
    v_new_state := 'chatting';
  ELSE
    v_new_state := 'idle';
  END IF;
  
  -- Update state
  UPDATE telegram_users
  SET state = v_new_state
  WHERE id = p_user_id;
  
  RETURN json_build_object(
    'success', TRUE,
    'new_state', v_new_state,
    'partner_id', v_partner_id
  );
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: cancel_topup_transaction
-- Batalkan topup dan reset state dalam 1 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.cancel_topup_transaction(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id BIGINT;
  v_new_state TEXT;
BEGIN
  -- 1. Batalkan semua topup request pending
  UPDATE topup_requests
  SET status = 'cancelled'
  WHERE user_id = p_user_id AND status = 'pending';
  
  -- 2. Ambil partner_id untuk menentukan state baru
  SELECT partner_id INTO v_partner_id
  FROM telegram_users
  WHERE id = p_user_id;
  
  v_new_state := CASE WHEN v_partner_id IS NOT NULL THEN 'chatting' ELSE 'idle' END;
  
  -- 3. Update state user
  UPDATE telegram_users
  SET state = v_new_state
  WHERE id = p_user_id;
  
  RETURN json_build_object(
    'success', TRUE,
    'new_state', v_new_state,
    'partner_id', v_partner_id
  );
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: cancel_premium_transaction
-- Batalkan premium dan reset state dalam 1 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.cancel_premium_transaction(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id BIGINT;
  v_new_state TEXT;
BEGIN
  -- 1. Batalkan semua premium request pending
  UPDATE premium_requests
  SET status = 'cancelled'
  WHERE user_id = p_user_id AND status = 'pending';
  
  -- 2. Ambil partner_id untuk menentukan state baru
  SELECT partner_id INTO v_partner_id
  FROM telegram_users
  WHERE id = p_user_id;
  
  v_new_state := CASE WHEN v_partner_id IS NOT NULL THEN 'chatting' ELSE 'idle' END;
  
  -- 3. Update state user
  UPDATE telegram_users
  SET state = v_new_state
  WHERE id = p_user_id;
  
  RETURN json_build_object(
    'success', TRUE,
    'new_state', v_new_state,
    'partner_id', v_partner_id
  );
END;
$function$;

-- =====================================================
-- CONSOLIDATED RPC: cancel_fine_transaction
-- Batalkan fine dan reset state dalam 1 RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.cancel_fine_transaction(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 1. Batalkan pending transaction dengan FINE_PAYMENT
  UPDATE pending_transactions
  SET status = 'cancelled'
  WHERE user_id = p_user_id 
    AND status = 'pending' 
    AND admin_notes = 'FINE_PAYMENT';
  
  -- 2. Reset state user ke idle (tetap blocked sampai bayar)
  UPDATE telegram_users
  SET state = 'idle'
  WHERE id = p_user_id;
  
  RETURN json_build_object('success', TRUE);
END;
$function$;