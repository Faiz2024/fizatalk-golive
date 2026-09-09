# Statistik Sebaran Referal + Nominal Bonus yang Bisa Diubah Admin

## Yang dibangun

1. **Kartu statistik baru di dashboard web**: jumlah pengguna dikelompokkan berdasarkan total teman sah:
   - 1–50 teman
   - 51–80 teman
   - 81–99 teman
   - 100+ belum tarik bonus
   - 100+ sudah tarik bonus (status terkirim atau sedang diproses)
2. **Command admin di bot** untuk mengubah nominal tarik bonus tanpa perlu ubah kode, misalnya `/setbonus 75000`. Tanpa angka, bot menampilkan nominal yang berlaku sekarang.

## Tampilan dashboard

Satu kartu berisi grafik batang horizontal (atau daftar angka) dengan lima kelompok di atas, plus label total pengguna yang punya minimal 1 teman sah. Gaya kartu mengikuti kartu referal yang sudah ada, di bawah grafik "User Baru dari Referal (30 Hari Terakhir)".

## Alur command admin

- Hanya berfungsi bila dikirim dari chat admin (id chat admin yang sudah dipakai fitur lain). Dari pengguna biasa, command diabaikan seperti teks biasa.
- `/setbonus` → balas: "Nominal bonus saat ini: Rp50.000. Ubah dengan /setbonus 75000".
- `/setbonus 75000` → validasi angka (10.000–1.000.000, kelipatan 1.000), simpan, balas konfirmasi dengan nominal baru dan waktu WIB.
- Nominal baru langsung dipakai di menu referal, pesan konfirmasi penarikan, pesan ke admin, notifikasi ke pengguna, dan pengumuman channel. Permintaan yang sudah masuk tetap memakai nominal saat diajukan (tersimpan di barisnya).

## Detail teknis

**Database (satu migrasi)**
- Simpan nominal di `bot_settings` dengan key `referral_cashout_amount` (nilai awal `50000`), sehingga tidak perlu kolom baru dan tidak menambah query berat.
- Helper `public.get_referral_cashout_amount()` (stable) membaca key tersebut dengan fallback 50000.
- `get_referral_status` dan `request_referral_cashout`: ganti angka 50000 yang di-hardcode dengan helper tersebut. `request_referral_cashout` menulis nominal ke kolom `amount` baris baru, jadi riwayat tetap akurat.
- RPC baru `set_referral_cashout_amount(p_amount int, p_admin_id bigint)`: validasi rentang, upsert ke `bot_settings` (`updated_by`, `updated_at`), kembalikan nominal lama dan baru.
- Perluas `get_referral_stats` dengan objek `distribution`: satu query agregat atas `telegram_users` (`referral_qualified_count > 0`) memakai `FILTER` untuk lima bucket; bucket 100+ dipisah dengan `EXISTS` ke `referral_cashouts` berstatus `pending`/`paid`. Agregasi tetap di DB agar hemat biaya.
- Tambah indeks parsial `telegram_users (referral_qualified_count)` untuk baris `referral_qualified_count > 0` agar agregasi murah.

**Edge function `admin-stats`**
- Teruskan `referral.distribution` ke web tanpa query tambahan.

**Bot (`supabase/functions/telegram-webhook/index.ts`)**
- Tangani `/setbonus` (dan alias `/setnominal`) di cabang non-chatting dan chatting, dicek terhadap `TELEGRAM_CS_CHAT_ID`, tidak diteruskan ke partner.
- Ganti semua teks nominal yang masih hardcode `Rp50.000` agar memakai nilai dari `get_referral_status` / hasil RPC, diformat `Rp{n}` gaya Indonesia.

**Web (`src/pages/Dashboard.tsx`)**
- Tambah satu kartu distribusi referal memakai komponen chart yang sudah dipakai.

## Verifikasi
- Jalankan migrasi, deploy ulang `telegram-webhook` dan `admin-stats`, setup webhook.
- Cek dashboard menampilkan lima kelompok dengan angka yang cocok dengan query manual.
- Uji `/setbonus 75000` dari chat admin: menu referal langsung menampilkan Rp75.000; dari akun non-admin command diabaikan.
