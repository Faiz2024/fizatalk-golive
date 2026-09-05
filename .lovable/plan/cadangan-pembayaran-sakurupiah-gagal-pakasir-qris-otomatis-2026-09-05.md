# Cadangan Pembayaran: Sakurupiah Gagal → Pakasir (QRIS Otomatis)

## Ringkasan

Saat ini, jika Sakurupiah gagal membuat tagihan, bot langsung jatuh ke QRIS manual (pengguna kirim bukti transfer, admin verifikasi). Setelah perubahan ini, urutannya menjadi:

1. Sakurupiah (seperti sekarang)
2. **Pakasir** — QRIS otomatis, pembayaran terverifikasi sendiri
3. QRIS manual (hanya jika Pakasir juga gagal)

Berlaku untuk tiga jenis pembayaran: Premium, Top-up koin, dan pembayaran denda buka blokir.

## Pengalaman pengguna

- Bot mengirim **gambar QR langsung di chat** (dibuat dari kode QRIS Pakasir) dengan nominal, cara bayar, dan batas waktu — mirip tampilan QRIS Sakurupiah sekarang.
- Di bawah gambar ada tombol **Buka Halaman Pembayaran** (cadangan bila gambar gagal terkirim) dan tombol **Kembali**.
- Jika pengguna memilih DANA atau GoPay tapi gateway utama gagal, mereka tetap diarahkan ke QRIS Pakasir (bisa dibayar dari aplikasi DANA/GoPay dengan scan QR), disertai keterangan singkat.
- Begitu pembayaran masuk, premium/koin/pembukaan blokir aktif **otomatis** tanpa admin, dan pengguna langsung dapat pesan konfirmasi — sama seperti alur otomatis yang sudah ada.
- Admin tetap mendapat notifikasi mulai dan selesainya transaksi.

## Rincian teknis

### Kunci akses
API key dan slug disimpan sebagai rahasia backend (`PAKASIR_API_KEY`, `PAKASIR_SLUG`), tidak ditulis di dalam kode.

### Pembuatan tagihan (di dalam bot)
Fungsi baru `createPakasirInvoice()`:
- `POST https://app.pakasir.com/api/transactioncreate/qris` dengan `{ project, order_id, amount, api_key }`.
- Balasan berisi `payment_number` (string QRIS), `total_payment`, dan `expired_at`.
- QR dirender jadi gambar lewat layanan QR publik dan dikirim via `sendPhoto`; bila gagal, kirim teks + tombol ke `https://app.pakasir.com/pay/{slug}/{amount}?order_id={order_id}&qris_only=1`.
- `order_id` memakai pola yang sudah ada agar routing sama: `p_<id>` (premium), `t_<id>` (top-up), `f_<id>` (denda), dengan tanda hubung UUID dibuang agar pendek.
- Nomor transaksi Pakasir disimpan di kolom `sakurupiah_trx_id` yang sudah ada (dipakai sebagai penanda "transaksi gateway otomatis"), dan `payment_method` diisi `PAKASIR_QRIS` — tanpa perubahan struktur database.

### Penerimaan pembayaran
Fungsi baru `pakasir-callback` (webhook, `verify_jwt = false`):
- Menerima `{ amount, order_id, project, status, payment_method, completed_at }`.
- Pakasir tidak mengirim tanda tangan, jadi keamanan diverifikasi dengan **memanggil balik** `GET /api/transactiondetail?project&amount&order_id&api_key` dan hanya memproses jika statusnya `completed` serta `project` cocok dengan slug. Ini mencegah pemalsuan webhook.
- Setelah valid, logika sukses dipakai ulang dari `sakurupiah-callback` (aktivasi premium termasuk validasi promo spesial, penambahan koin, pembukaan blokir denda, catatan transaksi, notifikasi pengguna dan admin) — dipindah ke berkas bersama `_shared/` agar tidak ada duplikasi aturan.
- Idempoten: transaksi yang sudah `approved` diabaikan, jadi webhook ganda aman.

### Perubahan pada tiga alur pembayaran
Pada `processSakurupiahPremiumPayment`, `processSakurupiahTopupPayment`, `processSakurupiahFinePayment`: blok "fallback ke QRIS Manual" diganti menjadi coba Pakasir dulu; hanya bila Pakasir gagal, panggil `sendManualQRISPayment` seperti sekarang.

### Biaya cloud & performa
Tidak ada tabel, kolom, atau cron baru. Satu panggilan HTTP tambahan saat gateway utama gagal, dan satu panggilan verifikasi per webhook. Tidak ada polling status.

## Verifikasi setelah implementasi

- Uji buat transaksi premium kecil → pastikan QR Pakasir muncul di chat dan nominal benar.
- Uji webhook (mode simulasi pembayaran Pakasir) → premium/koin aktif otomatis dan pesan konfirmasi terkirim.
- Uji webhook palsu tanpa transaksi valid → ditolak.
- Pastikan alur Sakurupiah normal, Telegram Stars, QRIS manual, dan tombol Kembali tetap berfungsi seperti sebelumnya.
- Deploy ulang `telegram-webhook` + `pakasir-callback`, lalu setup webhook bot.

## Yang perlu Anda lakukan

Setelah fitur aktif, isi **URL Webhook** pada proyek Pakasir (slug `fizatalk`) dengan alamat yang saya berikan setelah fungsi ter-deploy, agar pembayaran terverifikasi otomatis.
