
-- =============================================
-- FIX CONSTRAINT DATABASE UNTUK SAKURUPIAH FLOW
-- =============================================

-- 1. Fix unique_code: allow 0 (Sakurupiah tidak pakai unique_code)
ALTER TABLE public.premium_requests DROP CONSTRAINT IF EXISTS premium_requests_unique_code_check;
ALTER TABLE public.premium_requests ADD CONSTRAINT premium_requests_unique_code_check CHECK (unique_code >= 0 AND unique_code <= 999);

ALTER TABLE public.pending_transactions DROP CONSTRAINT IF EXISTS pending_transactions_unique_code_check;
ALTER TABLE public.pending_transactions ADD CONSTRAINT pending_transactions_unique_code_check CHECK (unique_code >= 0 AND unique_code <= 999);

-- 2. Fix topup_requests.amount: allow small coin amounts (min 1 instead of 1000)
ALTER TABLE public.topup_requests DROP CONSTRAINT IF EXISTS topup_requests_amount_check;
ALTER TABLE public.topup_requests ADD CONSTRAINT topup_requests_amount_check CHECK (amount >= 1);

-- 3. Fix status constraints: add 'cancelled' and 'expired' states
ALTER TABLE public.premium_requests DROP CONSTRAINT IF EXISTS premium_requests_status_check;
ALTER TABLE public.premium_requests ADD CONSTRAINT premium_requests_status_check CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'cancelled', 'expired']));

ALTER TABLE public.topup_requests DROP CONSTRAINT IF EXISTS topup_requests_status_check;
ALTER TABLE public.topup_requests ADD CONSTRAINT topup_requests_status_check CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'cancelled', 'expired']));

ALTER TABLE public.pending_transactions DROP CONSTRAINT IF EXISTS pending_transactions_status_check;
ALTER TABLE public.pending_transactions ADD CONSTRAINT pending_transactions_status_check CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'cancelled', 'expired']));
