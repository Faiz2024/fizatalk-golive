-- ============================================
-- MIGRATION: Add Premium & Gender Columns + Premium Requests Table
-- ============================================

-- Tambah kolom gender, target_gender, dan premium_until ke telegram_users
ALTER TABLE public.telegram_users 
ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('cowok', 'cewek'));

ALTER TABLE public.telegram_users 
ADD COLUMN IF NOT EXISTS target_gender TEXT DEFAULT 'semua' CHECK (target_gender IN ('cowok', 'cewek', 'semua'));

ALTER TABLE public.telegram_users 
ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;

-- Tabel untuk premium requests
CREATE TABLE IF NOT EXISTS public.premium_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.telegram_users(id) ON DELETE CASCADE,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price INTEGER NOT NULL CHECK (price > 0),
  unique_code INTEGER NOT NULL CHECK (unique_code BETWEEN 1 AND 999),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  payment_proof TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.premium_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policy untuk premium_requests (service role only)
CREATE POLICY "Service role has full access to premium_requests"
  ON public.premium_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_premium_requests_user_id ON public.premium_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_premium_requests_status ON public.premium_requests(status);
CREATE INDEX IF NOT EXISTS idx_premium_requests_created_at ON public.premium_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_users_gender ON public.telegram_users(gender);
CREATE INDEX IF NOT EXISTS idx_telegram_users_premium_until ON public.telegram_users(premium_until);