
-- Tambah kolom tracking Sakurupiah ke premium_requests
ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS sakurupiah_trx_id TEXT;
ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Tambah kolom tracking Sakurupiah ke topup_requests
ALTER TABLE topup_requests ADD COLUMN IF NOT EXISTS sakurupiah_trx_id TEXT;
ALTER TABLE topup_requests ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Tambah kolom tracking Sakurupiah ke pending_transactions (fine)
ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS sakurupiah_trx_id TEXT;

-- Index untuk lookup cepat di callback
CREATE INDEX IF NOT EXISTS idx_premium_requests_sakurupiah_trx ON premium_requests(sakurupiah_trx_id) WHERE sakurupiah_trx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_topup_requests_sakurupiah_trx ON topup_requests(sakurupiah_trx_id) WHERE sakurupiah_trx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_transactions_sakurupiah_trx ON pending_transactions(sakurupiah_trx_id) WHERE sakurupiah_trx_id IS NOT NULL;
