-- ============================================
-- TELEGRAM BOT TOPUP SYSTEM
-- Deskripsi: Schema database untuk sistem top-up koin via QRIS di Telegram Bot
-- ============================================

-- Pastikan kolom coins ada di telegram_users
ALTER TABLE telegram_users 
ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0;

-- Tabel untuk menyimpan request top-up dari bot telegram
CREATE TABLE IF NOT EXISTS topup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 50),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  payment_proof TEXT, -- file_id dari telegram photo
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  FOREIGN KEY (user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
);

-- Tabel untuk tracking semua transaksi koin
CREATE TABLE IF NOT EXISTS coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  amount INTEGER NOT NULL, -- positif untuk top-up, negatif untuk penggunaan
  type TEXT NOT NULL CHECK (type IN ('topup', 'rating', 'bonus', 'refund')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
);

-- Indexes untuk performa
CREATE INDEX IF NOT EXISTS idx_topup_requests_user_id ON topup_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_topup_requests_status ON topup_requests(status);
CREATE INDEX IF NOT EXISTS idx_topup_requests_created_at ON topup_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_id ON coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_created_at ON coin_transactions(created_at DESC);

-- Enable RLS
ALTER TABLE topup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own topup requests"
  ON topup_requests
  FOR SELECT
  TO authenticated
  USING (user_id::text = (SELECT id::text FROM telegram_users WHERE id = auth.uid()::text::bigint));

CREATE POLICY "Service role can manage all topup requests"
  ON topup_requests
  FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "Users can view their own transactions"
  ON coin_transactions
  FOR SELECT
  TO authenticated
  USING (user_id::text = (SELECT id::text FROM telegram_users WHERE id = auth.uid()::text::bigint));

CREATE POLICY "Service role can manage all transactions"
  ON coin_transactions
  FOR ALL
  TO service_role
  USING (true);

-- Function untuk trigger auto-update updated_at
CREATE OR REPLACE FUNCTION update_topup_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.processed_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger untuk auto-update processed_at saat status berubah
CREATE TRIGGER trigger_topup_request_processed
  BEFORE UPDATE OF status ON topup_requests
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
  EXECUTE FUNCTION update_topup_request_updated_at();
