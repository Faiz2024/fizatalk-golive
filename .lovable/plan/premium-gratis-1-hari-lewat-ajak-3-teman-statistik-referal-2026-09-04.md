# Premium Gratis 1 Hari lewat Ajak 3 Teman + Statistik Referal

## Yang dibangun

1. **Tombol "🎁 Premium Gratis 1 Hari (Ajak 3 Teman)"** muncul di bawah opsi pembelian 7 hari dan 30 hari pada penawaran premium.
2. **Link undangan pribadi** untuk tiap pengguna. Teman yang membuka bot lewat link itu tercatat sebagai undangan.
3. **Teman dihitung sah** hanya setelah teman tersebut benar-benar pernah dipasangkan chat minimal satu kali.
4. **Hadiah berulang**: setiap kelipatan 3 teman sah, pengguna bisa klaim tambahan 1 hari premium. Klaim dilakukan lewat tombol, dan sisa "kuota klaim" ditampilkan.
5. **Statistik di halaman web (dashboard)**: kartu jumlah pengguna baru dari referal hari ini, dan grafik pengguna baru dari referal per hari (30 hari terakhir) beserta jumlah hadiah premium yang dibagikan.

## Alur pengguna di bot

- Menekan tombol hadiah → bot mengirim pesan berisi link undangan pribadi, teks ajakan siap-bagikan, progres "2/3 teman", dan tombol "Bagikan ke teman" serta "Klaim 1 Hari Premium".
- Tombol klaim hanya berhasil jika ada minimal 3 teman sah yang belum ditukar; kalau belum cukup, bot menjawab dengan sisa yang dibutuhkan.
- Klaim menambah 1 hari ke masa premium (memperpanjang bila masih aktif), lalu memberi konfirmasi.
- Teman yang diundang mendapat sambutan normal; pengundang diberi tahu saat temannya jadi sah.

## Detail teknis

**Database (satu migrasi)**
- Tabel `referrals`: `referrer_id`, `referred_id` (unik), `qualified_at`, `consumed_at`, `created_at`. GRANT ke `service_role` saja, RLS aktif dengan kebijakan service role penuh (data hanya diakses bot dan fungsi admin).
- Kolom di `telegram_users`: `referred_by bigint`, `referral_qualified_count int default 0`, `referral_rewards_claimed int default 0`. Diisi sekali saat pendaftaran agar pencatatan murah.
- RPC `register_referral(p_new_user_id, p_referrer_id)` — dipanggil hanya saat user benar-benar baru; menolak referral diri sendiri dan duplikat.
- RPC `qualify_referral(p_user_id)` — dipanggil sekali di dalam RPC pencocokan yang sudah ada (`comprehensive_search_action`) saat status berubah jadi `matched`, dan hanya bila baris referral yang belum qualified ada. Tanpa query tambahan bila user tak punya pengundang (cek kolom `referred_by` yang sudah ikut ter-select).
- RPC `claim_referral_reward(p_user_id)` — atomik: kunci baris pengguna, hitung referral qualified yang belum dikonsumsi, jika >= 3 tandai 3 baris terkonsumsi, tambah 1 hari premium, kembalikan status + progres. Aman dari klik ganda.
- Statistik harian diambil lewat perluasan RPC `get_admin_dashboard_stats` (agregasi tetap di database, tidak ada query tambahan dari web).

**Bot (`telegram-webhook`)**
- Penanganan `/start <payload>`: saat ini hanya `text === '/start'` yang dikenali, jadi ditambah pengenalan awalan `/start ` dengan payload `ref_<id>`; alur sambutan lama tidak berubah.
- Link undangan dibentuk dari username bot (`getMe` di-cache di `bot_settings` agar hemat panggilan).
- `buildPremiumNormalKeyboard` dan keyboard promo mendapat baris tambahan tombol hadiah, sehingga letaknya persis di bawah opsi 7 hari dan 30 hari.
- Callback baru `referral_menu` dan `referral_claim`, mengikuti pola debounce dan `answerCallbackQuery` yang sudah dipakai callback lain.
- Waktu tampil memakai WIB, teks Indonesia, tombol "Kembali" bukan "Batal".

**Web dashboard**
- `admin-stats` meneruskan data referal baru; `Dashboard.tsx` menambah satu kartu KPI dan satu grafik harian dengan gaya kartu yang sudah ada.

## Verifikasi
- Deploy ulang `telegram-webhook` dan `admin-stats`, lalu setup webhook.
- Uji: buka link undangan dengan akun uji, pastikan tercatat; setelah akun uji dapat chat pertama, progres pengundang naik; klaim pada 3 teman menambah 1 hari premium; klaim kedua ditolak sampai 3 teman berikutnya.
