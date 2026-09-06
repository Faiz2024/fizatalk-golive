# Bonus Saldo E-Wallet Rp20.000 untuk 100 Teman Sah

## Yang dibangun

1. Selain hadiah Premium gratis (tetap seperti sekarang), pengguna yang sudah mengajak **100 teman sah** bisa menarik **bonus saldo e-wallet Rp20.000**, **satu kali seumur akun**.
2. Hitungan bonus **terpisah** dari klaim Premium: memakai total teman sah sepanjang waktu, jadi klaim Premium tidak mengurangi jatah bonus.
3. Pengiriman uang dilakukan **manual oleh admin**, lalu admin menandai permintaan sebagai terkirim langsung dari Telegram.

## Alur pengguna di bot

- Di menu referal muncul baris progres baru: "Bonus Rp20.000: 37/100 teman sah".
- Setelah mencapai 100, tombol **"💵 Tarik Bonus Rp20.000"** aktif. Sebelum 100, tombol menjawab berapa teman lagi yang dibutuhkan.
- Menekan tombol → bot menampilkan pilihan e-wallet: DANA, OVO, GoPay, ShopeePay (plus tombol "Kembali").
- Setelah memilih, bot meminta satu pesan berisi **nomor e-wallet dan nama pemilik**. Bot memvalidasi nomor (angka, 9–15 digit) dan nama (minimal 3 karakter), lalu menampilkan ringkasan dengan tombol **Kirim Permintaan** / **Kembali**.
- Setelah dikirim, pengguna menerima konfirmasi bahwa permintaan diproses admin maksimal 1x24 jam, dan tombol tarik bonus berubah jadi status "⏳ Menunggu proses admin".
- Saat admin menandai sudah dikirim, pengguna menerima notifikasi "Bonus Rp20.000 sudah dikirim ke <e-wallet> <nomor>". Bila admin menolak, pengguna diberi tahu alasannya singkat dan jatah penarikan dikembalikan.

## Alur admin

- Permintaan baru dikirim ke chat CS/admin: user id, username, jumlah teman sah, e-wallet, nomor, nama, waktu WIB.
- Tombol **"✅ Sudah Dikirim"** dan **"❌ Tolak"**. Tombol hanya berfungsi bila ditekan dari chat admin (dicek dengan id chat admin yang sudah dipakai fitur lain), dan pesan admin diperbarui dengan status + siapa yang memproses.

## Detail teknis

**Database (satu migrasi)**
- Tabel baru `public.referral_cashouts`: `user_id bigint`, `amount int default 20000`, `ewallet_type text`, `ewallet_number text`, `ewallet_name text`, `status text default 'pending'` (pending/paid/rejected), `qualified_at_request int`, `admin_message_id int`, `processed_by bigint`, `processed_at timestamptz`, `created_at`/`updated_at` (WIB via `now() AT TIME ZONE 'Asia/Jakarta'` mengikuti pola tabel lain). Indeks unik parsial agar satu pengguna hanya punya satu baris `pending`/`paid`.
- GRANT hanya ke `service_role` (data diakses bot/edge function), RLS aktif dengan kebijakan service role penuh — pola sama seperti `referrals`.
- Kolom baru di `telegram_users`: `cashout_draft jsonb` (menyimpan e-wallet yang dipilih + tahap pengisian). Dipakai agar handler pesan teks tahu pengguna sedang mengisi data tanpa query tambahan — kolom ikut terbawa di `upsert_user_optimized` yang sudah dipanggil tiap pesan.
- RPC `get_referral_status` diperluas: kembalikan `cashout_eligible`, `cashout_status`, dan `total_qualified` untuk progres 100 teman (tanpa query tambahan dari bot).
- RPC baru `request_referral_cashout(p_user_id, p_type, p_number, p_name)` — atomik: kunci baris pengguna, verifikasi `referral_qualified_count >= 100`, verifikasi belum pernah ada cashout `pending`/`paid`, buat baris, bersihkan `cashout_draft`, kembalikan id permintaan. Aman dari klik/kirim ganda.
- RPC baru `process_referral_cashout(p_request_id, p_action, p_admin_id)` — tandai `paid` atau `rejected` sekali saja (menolak pemrosesan ganda) dan kembalikan data untuk notifikasi.

**Bot (`telegram-webhook`)**
- `sendReferralMenu`: tambah baris progres bonus dan tombol tarik bonus dengan label dinamis sesuai status.
- Callback baru: `cashout_start`, `cashout_type_<dana|ovo|gopay|shopeepay>`, `cashout_confirm`, `cashout_cancel`, `admin_cashout_paid_<id>`, `admin_cashout_reject_<id>` — mengikuti pola debounce + `answerCallbackQuery` fire-and-forget yang sudah dipakai.
- Handler pesan teks: bila `cashout_draft` terisi, pesan diperlakukan sebagai isian nomor+nama (tidak diteruskan ke partner chat), dengan validasi dan pesan error singkat.
- Teks Indonesia, waktu WIB, tombol "Kembali" bukan "Batal", `editMessageText` dipakai untuk memperbarui pesan yang sama.

**Web dashboard**
- Tidak ada perubahan (semua di bot, sesuai preferensi).

## Verifikasi
- Jalankan migrasi, deploy ulang `telegram-webhook`, setup webhook.
- Uji: akun dengan <100 teman → tombol menolak dengan sisa yang dibutuhkan; akun ≥100 → alur pilih e-wallet, isi data, kirim; pesan masuk ke chat admin; tombol "Sudah Dikirim" mengubah status dan mengirim notifikasi ke pengguna; penekanan tombol kedua kali ditolak; penarikan kedua ditolak karena sekali seumur akun.
