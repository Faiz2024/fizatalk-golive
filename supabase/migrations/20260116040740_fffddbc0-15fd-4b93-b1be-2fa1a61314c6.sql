-- ============================================
-- MIGRATION: Add Payment Methods & Pending Transactions
-- Untuk sistem pembayaran QRIS di Telegram Bot
-- ============================================

-- Tabel untuk metode pembayaran
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  account_name TEXT,
  account_number TEXT,
  qr_code_url TEXT,
  instructions TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabel untuk transaksi pending (disesuaikan untuk telegram_users dengan BIGINT id)
CREATE TABLE IF NOT EXISTS public.pending_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.telegram_users(id) ON DELETE CASCADE,
  payment_method_id UUID REFERENCES public.payment_methods(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  unique_code INTEGER NOT NULL CHECK (unique_code BETWEEN 1 AND 999),
  total_amount INTEGER NOT NULL,
  payment_proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes TEXT,
  telegram_notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES public.telegram_users(id)
);

-- Enable RLS
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies untuk payment_methods (service role only karena digunakan oleh edge function)
CREATE POLICY "Service role has full access to payment_methods"
  ON public.payment_methods
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies untuk pending_transactions (service role only)
CREATE POLICY "Service role has full access to pending_transactions"
  ON public.pending_transactions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes untuk performance
CREATE INDEX IF NOT EXISTS idx_pending_transactions_user_id ON public.pending_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_status ON public.pending_transactions(status);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_created_at ON public.pending_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_methods_is_active ON public.payment_methods(is_active);

-- Function untuk generate unique code
CREATE OR REPLACE FUNCTION public.generate_unique_payment_code()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_code INTEGER;
  v_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate random 3 digit code (1-999)
    v_code := floor(random() * 999 + 1)::INTEGER;
    
    -- Check if code exists in recent pending transactions (last 24 hours)
    SELECT EXISTS(
      SELECT 1 FROM pending_transactions 
      WHERE unique_code = v_code 
      AND status = 'pending'
      AND created_at > now() - interval '24 hours'
    ) INTO v_exists;
    
    EXIT WHEN NOT v_exists;
  END LOOP;
  
  RETURN v_code;
END;
$$;

-- Trigger untuk auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_payment_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_payment_updated_at_column();

CREATE TRIGGER update_pending_transactions_updated_at
  BEFORE UPDATE ON public.pending_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_payment_updated_at_column();

-- Insert QRIS payment method
INSERT INTO public.payment_methods (
  method_name,
  display_name,
  account_name,
  instructions,
  is_active
) VALUES (
  'qris',
  'QRIS (Semua E-Wallet & Bank)',
  'JASA CODING FIZA',
  'Scan QR Code untuk membayar. Setelah transfer, upload bukti pembayaran.',
  true
) ON CONFLICT (method_name) DO NOTHING;