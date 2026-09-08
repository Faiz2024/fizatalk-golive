# Command /referral untuk Membuka Menu Referal

## Yang diubah

1. Tambah command **`/referral`** (plus alias **`/referal`**) di bot Telegram yang langsung membuka menu referal — sama seperti menekan tombol "🎁 Premium Gratis 1 Hari (Ajak 3 Teman)".
2. Command bekerja **di dua kondisi**:
   - **Sedang tidak chatting** → menu referal dikirim sebagai pesan baru.
   - **Sedang chatting** → menu referal tetap bisa dibuka (pesan tidak diteruskan ke partner, sama seperti `/coins` dan `/gift`).

## Langkah pengerjaan

Semua perubahan hanya di `supabase/functions/telegram-webhook/index.ts`, tanpa migrasi database.

### 1. Cabang "sedang chatting" (sekitar baris 6505–6700)

- Tambahkan `else if (text === '/referral' || text === '/referal')` yang memanggil `sendReferralMenu(supabase, botToken, userId)` dan set `isCommand = true`, diletakkan berdampingan dengan handler `/coins`.

### 2. Cabang "tidak chatting" (sekitar baris 6959–7100)

- Tambahkan handler serupa di blok command utama, memanggil `sendReferralMenu(supabase, botToken, userId)`.

### 3. Deploy dan verifikasi

- Deploy ulang `telegram-webhook` dan setup ulang webhook.
- Uji: kirim `/referral` saat tidak chatting → menu referal muncul (link undangan, progres teman sah, progres bonus Rp50.000, tombol klaim/tarik bonus). Kirim `/referral` saat chatting → menu muncul dan pesan tidak bocor ke partner.

## Catatan

- Tidak ada query tambahan: `sendReferralMenu` sudah memakai RPC `get_referral_status` yang ada.
- Tanpa perubahan website/dashboard.
