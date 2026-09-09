# Sematkan Otomatis Pesan Permintaan Penarikan di Chat Admin

## Yang dibangun

Bisa, dan mudah. Dua perilaku baru di chat admin:

1. Setiap permintaan tarik bonus yang masuk langsung **disematkan (pin)** otomatis, jadi admin tidak akan kelewatan meski chat ramai.
2. Begitu admin menekan **✅ Sudah Dikirim** atau **❌ Tolak**, sematannya **langsung dilepas** otomatis, dan pesan tetap diperbarui dengan status seperti sekarang.

**Catatan dari pertanyaan terbaru**: Sematan akan dilakukan di chat admin yang sama tempat pesan permintaan muncul. Jika admin chat adalah chat privat bot (bukan grup), pin tetap berfungsi; jika chatnya adalah grup, sematan muncul di grup. Pengaturan `TELEGRAM_CS_CHAT_ID` saat ini menentukan chat mana yang dipakai.

Efek sampingnya: yang tersemat di chat admin selalu hanya permintaan yang belum diproses.

## Detail teknis

Semua di `supabase/functions/telegram-webhook/index.ts`, tanpa perubahan database.

- Saat mengirim pesan permintaan ke `TELEGRAM_CS_CHAT_ID` (blok `cashout_confirm`), setelah `sendMessage` berhasil dan `message_id` didapat, panggil `pinChatMessage` dengan `disable_notification: false` agar admin dapat notifikasi sematan. Panggilan bersifat fire-and-forget (`.catch(() => {})`) supaya gagal pin tidak pernah menggagalkan permintaan pengguna.
- Di handler `admin_cashout_paid_` / `admin_cashout_reject_`, setelah RPC `process_referral_cashout` sukses, panggil `unpinChatMessage` untuk `chat_id` + `message_id` pesan admin tersebut — juga fire-and-forget, dijalankan bersamaan dengan `editMessageText` yang sudah ada. Karena RPC sudah menolak pemrosesan ganda (`already_processed`), unpin hanya terjadi sekali.
- Tidak ada penambahan query database, tidak ada RPC baru, tidak ada biaya cloud tambahan (hanya 2 panggilan Telegram API tambahan per permintaan).

**Prasyarat operasional**: bot harus punya izin **Pin Messages** di grup admin. Jika chat admin adalah chat privat (bukan grup), pin tetap bisa dilakukan bot. Bila izin belum ada, pin gagal senyap dan alur lain tetap normal.

## Verifikasi

- Deploy ulang `telegram-webhook`, setup ulang webhook.
- Uji: buat satu permintaan tarik bonus → cek pesan tersemat di chat admin.
- Tekan **✅ Sudah Dikirim** → sematan hilang, pesan berubah jadi status "SUDAH DIKIRIM", pengguna dapat notifikasi, dan postingan channel tetap terkirim.
- Uji juga **❌ Tolak** → sematan hilang tanpa postingan channel.
