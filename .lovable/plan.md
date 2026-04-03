
Masalah utama yang terlihat saat ini bukan lagi dari webhook Telegram, melainkan dari alur pembayaran Sakurupiah yang belum memberi bukti runtime yang cukup dan kemungkinan masih gagal di salah satu dari dua titik berikut:

1. Pembuatan invoice gagal di `telegram-webhook`
2. Callback pembayaran tidak pernah masuk atau tidak lolos validasi di `sakurupiah-callback`

Temuan dari kode dan log:
- Di kode terbaru, request invoice memang sudah dikirim sebagai `application/x-www-form-urlencoded` memakai `URLSearchParams`, jadi mismatch format request sebelumnya sudah diperbaiki.
- Fungsi `setup-telegram-webhook` sehat; log menunjukkan webhook Telegram berhasil di-set ulang.
- Log `telegram-webhook` yang tersedia hanya berisi boot/shutdown dan debounce cleanup, tidak ada log `"[SAKURUPIAH] STATUS"` atau `"[SAKURUPIAH] RAW RESPONSE"`. Artinya:
  - belum ada percobaan transaksi yang benar-benar menembus jalur invoice setelah deploy terakhir, atau
  - log penting tidak muncul karena request pembayaran berhenti sebelum `createSakurupiahInvoice`, atau
  - deployment aktif belum sama dengan kode yang sedang kita baca.
- Tidak ada log sama sekali di `sakurupiah-callback`, jadi callback pembayaran belum pernah diterima, belum pernah dipanggil, atau dipanggil tapi tidak sampai ke function yang aktif.

Analisis penyebab paling mungkin:
- Request invoice ke Sakurupiah masih ditolak karena detail payload belum sesuai spesifikasi mereka, walau content-type sudah benar.
  - kandidat masalah: `merchant_fee='2'`, `phone='6280000000000'`, nama field `produk[0] / qty[0] / harga[0]`, atau signature HMAC yang tidak sesuai versi API mereka.
- Callback URL belum benar-benar dipakai atau belum terdaftar/diizinkan oleh pihak Sakurupiah.
- Validasi callback terlalu ketat atau tidak cocok dengan format callback aktual:
  - kode sekarang hanya menerima header `x-callback-event === 'payment_status'`
  - kode hanya memproses `status === 'berhasil'` atau `status === 'expired'`
  - bila provider mengirim nilai lain seperti `paid`, `success`, `settlement`, atau header berbeda, pembayaran tetap tidak diproses walaupun callback masuk.
- Callback handler lookup berdasarkan `merchant_ref`, bukan `trx_id`. Ini aman jika `merchant_ref` selalu dipantulkan kembali, tetapi bila callback aktual tidak mengirim field itu secara konsisten, proses approval akan gagal.
- Ada kemungkinan log yang Anda butuhkan belum tersedia karena belum ada transaksi uji baru sesudah perubahan terakhir.

Rencana solusi yang saya sarankan:
1. Perkuat logging di `telegram-webhook`
- Log metode pembayaran, merchant ref, body request final, status HTTP, raw response, dan parsed JSON/error secara konsisten.
- Bedakan error:
  - response non-JSON
  - JSON tapi status gagal
  - network error
  - insert/update database gagal

2. Perkuat logging di `sakurupiah-callback`
- Log semua header penting:
  - `x-callback-signature`
  - `x-callback-event`
  - content-type
- Log raw body dan hasil parsing.
- Log hasil verifikasi signature: valid/tidak valid.
- Log jalur keputusan:
  - premium/topup/fine
  - request ditemukan/tidak
  - update database berhasil/gagal

3. Longgarkan kompatibilitas callback
- Terima beberapa kemungkinan nilai status sukses/expired yang umum.
- Jangan langsung abaikan jika `x-callback-event` kosong; log dulu dan fallback ke isi body bila memungkinkan.
- Tambahkan fallback lookup berdasarkan `sakurupiah_trx_id` jika `merchant_ref` tidak dapat dipakai.

4. Validasi payload invoice dengan data provider
- Cocokkan persis format signature dan field request dengan dokumentasi atau contoh resmi provider.
- Jika perlu, siapkan dua mode parser:
  - form-encoded versi saat ini
  - alternatif jika provider minta JSON di environment tertentu
- Pastikan `callback_url` mengarah ke function aktif yang sama dengan deployment saat ini.

5. Uji end-to-end setelah deploy
- Buat satu transaksi uji baru setelah perubahan logging.
- Ambil:
  - log request invoice terakhir
  - raw response dari provider
  - apakah callback masuk
  - payload callback mentah
- Dari situ baru bisa dipastikan apakah gagal di pembuatan invoice atau di pemrosesan callback.

Detail teknis perubahan yang layak diimplementasikan:
- `supabase/functions/telegram-webhook/index.ts`
  - pertahankan format form-urlencoded
  - tambah structured logs sebelum dan sesudah fetch ke Sakurupiah
  - log `invoice.success` false dengan penyebab yang lebih spesifik
- `supabase/functions/sakurupiah-callback/index.ts`
  - tambah log headers + raw body + branch processing
  - tambah fallback mapping status
  - tambah fallback pencarian transaksi via `sakurupiah_trx_id`
- Tidak perlu perubahan website.
- Tidak perlu perubahan database wajib untuk tahap investigasi, kecuali nanti ingin menyimpan audit log callback secara permanen untuk hemat debugging jangka panjang.

Prioritas implementasi:
1. Tambah logging lengkap di kedua edge function
2. Tambah kompatibilitas callback
3. Deploy ulang function pembayaran
4. Jalankan 1 transaksi uji baru
5. Evaluasi raw response provider dan raw callback aktual

Hasil yang diharapkan setelah itu:
- Kita bisa memastikan apakah kegagalan terjadi saat create invoice atau saat callback.
- Anda akan punya log mentah yang cukup untuk dikirim ke dukungan Sakurupiah.
- Proses approval otomatis menjadi lebih tahan terhadap variasi format callback dari provider.
