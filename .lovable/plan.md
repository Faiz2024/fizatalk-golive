# Perbaiki Tombol "🚀 Mulai Ajak Teman" dari Channel

## Masalah

Tombol **🚀 Mulai Ajak Teman** di postingan channel mengirim `/start referral` ke bot. Saat ini:
- **Tidak sedang chatting** → menu referal terbuka dengan benar (handler di cabang utama sudah ada).
- **Sedang chatting** → handler hanya mengenali `/start` persis, sehingga `/start referral` tidak membuka menu referal (perilaku tidak konsisten).

## Perbaikan

Hanya di `supabase/functions/telegram-webhook/index.ts`, tanpa migrasi database.

### 1. Cabang "sedang chatting" (sekitar baris 6587)

- Ubah kondisi `else if (text === '/start')` agar mengenali payload deep-link:
  - Jika `text === '/start referral'` (atau payload `referral`) → panggil `sendReferralMenu(supabase, botToken, userId)`, set `isCommand = true` (pesan tidak diteruskan ke partner).
  - Jika `/start` biasa atau payload lain → tetap tampilkan keyboard "⚠️ Kamu sedang dalam chat" seperti sekarang.

### 2. Cabang "tidak chatting" (sekitar baris 7065)

- Sudah menangani `startPayload === 'referral'` untuk user lama → tidak diubah.
- Tambahan kecil: untuk **user baru** yang menekan tombol dari channel (belum terdaftar), alur tetap seperti sekarang (registrasi + pilih gender), karena menu referal belum relevan sebelum registrasi selesai. Tidak ada perubahan.

### 3. Deploy dan verifikasi

- Deploy ulang `telegram-webhook` dan setup ulang webhook.
- Uji:
  - Tekan tombol di channel saat **tidak chatting** → menu referal muncul.
  - Tekan tombol saat **sedang chatting** → menu referal muncul dan pesan tidak bocor ke partner.
  - `/start` biasa saat chatting → tetap keyboard "Kamu sedang dalam chat".

## Catatan

- Tidak ada query tambahan: `sendReferralMenu` memakai RPC `get_referral_status` yang sudah ada (hemat biaya cloud).
- Konsisten dengan pola command `/referral`, `/coins`, dan `/gift` yang sudah ada.
