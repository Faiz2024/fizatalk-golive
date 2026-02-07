-- Fix: Tambahkan gift_sent dan gift_received ke constraint type check
ALTER TABLE public.coin_transactions DROP CONSTRAINT coin_transactions_type_check;

ALTER TABLE public.coin_transactions ADD CONSTRAINT coin_transactions_type_check 
CHECK (type = ANY (ARRAY['topup'::text, 'purchase'::text, 'reward'::text, 'deduction'::text, 'gift_sent'::text, 'gift_received'::text]));