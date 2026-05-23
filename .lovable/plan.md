## Rencana: Deploy ulang & setup webhook

1. **Cek perubahan terbaru** — review migration `find_and_pair_partner` (gating premium dipulihkan) sudah aktif di DB.
2. **Deploy ulang edge functions**:
   - `telegram-webhook` (konsumen RPC yang diubah)
   - `reengage-users` (komponen aktif untuk user re-engagement)
   - `setup-telegram-webhook`
   - `db-bridge` & `sakurupiah-callback` & `admin-stats` (sekalian sinkron versi terbaru)
3. **Setup webhook Telegram** — panggil `setup-telegram-webhook` untuk register ulang URL webhook + `drop_pending_updates`.
4. **Verifikasi** — cek log `telegram-webhook` pasca-setup untuk pastikan tidak ada error boot.