# Hemat biaya cloud bot FizaTalk

## Tujuan
Mengurangi pemakaian kredit tanpa mengubah fitur bot yang dirasakan pengguna.

## Langkah
1. **Pesan ajakan kembali (re-engagement) lebih jarang**
   - Jadwal diubah dari setiap 5 menit menjadi setiap 2 jam, hanya pukul 09.00–21.00 WIB (7x sehari, sebelumnya 288x).
   - Pesan tetap terkirim ke pengguna yang sama; hanya dikirim bertahap lebih jarang.
2. **Kurangi pembacaan data berulang saat pengguna mengirim foto/video dan command profil**
   - Data pengguna (status, partner, premium, koin, gender) diambil sekali di awal lalu dipakai ulang.
3. **Percepat pencarian pengguna yang layak dikirimi ajakan**
   - Tambah indeks agar pengecekan pengguna terblokir dan waktu terakhir dikirimi tidak memindai seluruh 150 ribu pengguna.
4. **Verifikasi**
   - Cek ulang daftar query terberat setelah perubahan, deploy bot, pasang ulang webhook, pastikan /start dan kirim media tetap normal.

## Detail teknis
- Cron `reengage-users`: `0 2-14/2 * * *` (UTC) = 09.00–21.00 WIB tiap 2 jam; batas kirim per run dinaikkan proporsional di `reengage-users/index.ts` agar volume harian tidak drop drastis (tetap dibatasi rate limit Telegram).
- `telegram-webhook`: hapus `SELECT premium_until` ganda di jalur media; satukan SELECT profil di `/target`, `/gender`, `/coins`; pakai cache in-memory yang sudah ada.
- Migrasi: indeks parsial `blocked_users(user_id) WHERE is_active`, indeks `telegram_users(last_active, last_reengagement_sent_at)`; cek EXPLAIN view `v_eligible_reengagement_users` sebelum/sesudah.
- Tidak ada perubahan tabel atau data pengguna. Semua waktu WIB.
