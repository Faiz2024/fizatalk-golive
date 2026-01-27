-- ============================================
-- MIGRATION: Add QRIS Payment System
-- Deskripsi: Menambahkan sistem pembayaran QRIS untuk top-up koin
-- INSTRUKSI: Copy paste SQL ini ke Supabase SQL Editor dan Run
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

-- Tabel untuk transaksi pending
CREATE TABLE IF NOT EXISTS public.pending_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  approved_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies untuk payment_methods
CREATE POLICY "Anyone can view active payment methods"
  ON public.payment_methods
  FOR SELECT
  TO authenticated, anon
  USING (is_active = true);

CREATE POLICY "Admins can manage payment methods"
  ON public.payment_methods
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies untuk pending_transactions
CREATE POLICY "Users can view their own transactions"
  ON public.pending_transactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own transactions"
  ON public.pending_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all transactions"
  ON public.pending_transactions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update transactions"
  ON public.pending_transactions
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Storage bucket untuk payment proofs
INSERT INTO storage.buckets (id, name, public) 
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS untuk payment proofs
CREATE POLICY "Users can upload their payment proofs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their own payment proofs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Admins can view all payment proofs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs' 
    AND public.has_role(auth.uid(), 'admin')
  );

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
);

-- Indexes untuk performance
CREATE INDEX idx_pending_transactions_user_id ON public.pending_transactions(user_id);
CREATE INDEX idx_pending_transactions_status ON public.pending_transactions(status);
CREATE INDEX idx_pending_transactions_created_at ON public.pending_transactions(created_at DESC);

-- Function untuk generate unique code
CREATE OR REPLACE FUNCTION generate_unique_payment_code()
RETURNS INTEGER
LANGUAGE plpgsql
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
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pending_transactions_updated_at
  BEFORE UPDATE ON public.pending_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
