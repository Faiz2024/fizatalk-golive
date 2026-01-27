-- Tambahkan kolom message_id untuk menyimpan ID pesan QRIS yang dikirim
-- Diperlukan untuk menghapus pesan QRIS saat transaksi dibatalkan

-- Tambah kolom message_id di premium_requests
ALTER TABLE public.premium_requests 
ADD COLUMN IF NOT EXISTS message_id INTEGER;

-- Tambah kolom message_id di topup_requests
ALTER TABLE public.topup_requests 
ADD COLUMN IF NOT EXISTS message_id INTEGER;

-- Index untuk performa (opsional, berguna jika sering query by message_id)
CREATE INDEX IF NOT EXISTS idx_premium_requests_message_id ON public.premium_requests(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_topup_requests_message_id ON public.topup_requests(message_id) WHERE message_id IS NOT NULL;