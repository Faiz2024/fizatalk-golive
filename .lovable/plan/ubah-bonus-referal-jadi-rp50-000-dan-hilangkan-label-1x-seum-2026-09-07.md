# Ubah Bonus Referal Jadi Rp50.000 dan Hilangkan Label 1x Seumur Hidup

## Yang diubah

1. Bonus tarik tunai referal naik dari **Rp20.000** menjadi **Rp50.000**.
2. Hapus keterangan "(1x seumur akun)" dari tampilan menu referal dan pesan konfirmasi penarikan.
3. Logika internal tetap: masih **satu kali per pengguna**, tetap butuh **100 teman sah**, admin tetap memproses manual, dan aturan anti-double-request tetap aktif lewat unique index + RPC.

## Langkah pengerjaan

### 1. Database (satu migrasi kecil)

- `ALTER TABLE public.referral_cashouts ALTER COLUMN amount SET DEFAULT 50000;`
- Perbarui baris `pending` yang sudah ada (jika ada) menjadi `amount = 50000` supaya tidak tersisa nilai lama.
- Ganti nilai `20000` jadi `50000` di:
  - `public.get_referral_status` pada field `cashout_amount`.
  - `public.request_referral_cashout` pada nilai `amount` yang dikembalikan.
- Fungsi `process_referral_cashout` tidak perlu diubah karena sudah membaca `amount` dari baris tabel.

### 2. Bot Telegram (`supabase/functions/telegram-webhook/index.ts`)

Ubah semua teks yang menyebut **Rp20.000** menjadi **Rp50.000**, dan hapus kalimat "(1x seumur akun)" / "1x seumur akun":

- `sendReferralMenu`:
  - `cashoutButtonText` dari `💵 Tarik Bonus Rp20.000` jadi `💵 Tarik Bonus Rp50.000`.
  - Baris bonus: `💵 <b>Bonus Saldo E-Wallet Rp20.000</b> (1x seumur akun)` jadi `💵 <b>Bonus Saldo E-Wallet Rp50.000</b>`.
- Callback `cashout_start`:
  - Pesan "Bonus Saldo Rp20.000" dan "Tarik Bonus Rp20.000" jadi Rp50.000.
  - Pesan "Bonus Rp20.000 kamu sudah pernah dikirim..." jadi Rp50.000.
- Callback `cashout_confirm`:
  - Pesan sukses ke user: `💵 Rp20.000 ke <b>${reqRes.type}</b>` jadi Rp50.000.
  - Pesan ke admin: `💰 Jumlah: <b>Rp20.000</b>` jadi Rp50.000.
- Callback admin `admin_cashout_paid_`:
  - Notifikasi ke user: `💵 Rp20.000 sudah dikirim ke ...` jadi Rp50.000.
- Handler pesan teks saat mengisi data e-wallet:
  - `💰 Jumlah: <b>Rp20.000</b>` jadi Rp50.000.
  - Hapus kalimat `Bonus ini hanya bisa ditarik <b>1x seumur akun</b>.`

### 3. Deploy dan verifikasi

- Jalankan migrasi.
- Deploy ulang function `telegram-webhook`.
- Setup ulang webhook.
- Cek cepat:
  - User dengan teman sah kurang dari 100 tetap melihat sisa teman dan nominal baru Rp50.000.
  - User dengan >= 100 teman sah bisa mengajukan, admin menerima pesan Rp50.000, dan notifikasi sukses ke user menunjuk Rp50.000.

## Catatan

- Tidak ada perubahan di website.
- Logika pembatasan sekali seumur akun tetap dijaga oleh partial unique index `uniq_referral_cashout_active` dan pengecekan `status IN ('pending', 'paid')` di RPC, meskipun teks keterangan dihapus.
