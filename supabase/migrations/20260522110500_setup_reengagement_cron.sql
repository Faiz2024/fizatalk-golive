-- Setup Re-engagement Cron Job
-- Jalankan setiap 15 menit menggunakan pg_cron dan pg_net

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Tambah kolom untuk menyimpan ID pesan promosi terakhir (idempotent, tapi sudah ditambahkan via bridge)
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS last_promo_message_id bigint;

-- Hapus schedule lama jika ada untuk menghindari duplicate
DO $$
BEGIN
  PERFORM cron.unschedule('reengage-inactive-users');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Menjadwalkan reengage-users Edge Function setiap 15 menit
-- Menggunakan x-cron-secret header untuk otentikasi aman tanpa hardcode service role key
SELECT cron.schedule(
  'reengage-inactive-users',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://chwopnsmykwzqflqozvf.functions.supabase.co/reengage-users',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "fizatalk_reengage_cron_secret_2026_xyz"}'::jsonb
  )
  $$
);
