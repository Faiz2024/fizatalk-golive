

## Rencana: Fallback QRIS Manual Jika Sakurupiah Gagal

### Ringkasan
Ketika `createSakurupiahInvoice()` gagal (return `!invoice.success`), alih-alih hanya menampilkan pesan error, sistem akan **otomatis fallback** ke alur pembayaran QRIS Manual: tampilkan gambar QRIS statis, user upload bukti transfer, bukti diteruskan ke CS chat untuk di-approve/reject manual via tombol interaktif.

### Perubahan yang Akan Dilakukan

#### 1. Buat Helper Function `sendManualQRISPayment()`
Fungsi baru yang menangani alur QRIS manual:
- Kirim gambar QRIS statis (dari `src/assets/qris-payment.jpg`, akan disimpan `file_id`-nya di `bot_settings` dengan key `qris_file_id`)
- Tampilkan instruksi: total bayar + kode unik 3 digit (dari `generate_unique_payment_code()` RPC) untuk identifikasi
- Tampilkan tombol "Batalkan"
- Update state user ke `awaiting_payment_proof` agar bot tahu user sedang menunggu upload bukti

#### 2. Buat Handler Upload Bukti Pembayaran
Di bagian message handler, ketika user mengirim **foto** dan state-nya `awaiting_payment_proof`:
- Simpan `file_id` foto sebagai `payment_proof` di tabel terkait (premium_requests / topup_requests / pending_transactions)
- Forward foto + detail transaksi ke CS chat (via `TELEGRAM_CS_CHAT_ID`)
- Tambahkan tombol inline `Approve` dan `Reject` di pesan CS
- Kirim konfirmasi ke user bahwa bukti sudah diterima dan sedang diverifikasi

#### 3. Buat Handler Callback CS Approve/Reject
Callback data format: `cs_approve_{type}_{id}` dan `cs_reject_{type}_{id}`
- **type**: `prem`, `topup`, `fine`
- **Approve**: Jalankan logika yang sama seperti callback Sakurupiah success (activate premium / add coins / unblock)
- **Reject**: Update status jadi `rejected`, kirim notifikasi ke user
- Setelah aksi, edit pesan CS: hapus keyboard, tambahkan status DIAPPROVE/DITOLAK

#### 4. Modifikasi 3 Fungsi Payment (Titik Fallback)

**`processSakurupiahPremiumPayment()`** (baris ~630-633):
- Saat `!invoice.success`: alih-alih cancel + kirim error, panggil `sendManualQRISPayment()` dengan context `prem` dan `premReq.id`
- Update `payment_method` menjadi `QRIS_MANUAL`

**`processSakurupiahTopupPayment()`** (baris ~1116-1119):
- Saat `!invoice.success`: panggil `sendManualQRISPayment()` dengan context `topup` dan `topupReq.id`
- Update `payment_method` menjadi `QRIS_MANUAL`

**`processSakurupiahFinePayment()`** (baris ~1243-1246):
- Saat `!invoice.success`: panggil `sendManualQRISPayment()` dengan context `fine` dan `fineReq.id`
- Update `payment_method` menjadi `QRIS_MANUAL`

#### 5. Tambah State Baru
Tambahkan `awaiting_payment_proof` ke enum `user_state` di database via migration, agar user dalam state ini bisa dikenali saat mengirim foto bukti. Simpan juga context transaksi aktif (type + id) di kolom baru atau di `bot_settings` per user untuk mapping bukti ke transaksi yang benar.

**Alternatif tanpa state baru** (lebih hemat): Simpan info transaksi pending di memory/session sementara, atau cukup query `pending` transaction terbaru milik user saat foto diterima.

### Detail Teknis

#### Alur QRIS Manual:
```text
User pilih metode → Sakurupiah gagal → Fallback QRIS Manual
  → Kirim gambar QRIS + total + kode unik
  → User bayar & kirim foto bukti
  → Bot forward ke CS dengan tombol Approve/Reject
  → CS klik Approve → Bot proses (aktifkan premium/tambah koin/unblock)
  → CS klik Reject → Bot kirim notif ke user
```

#### Database Migration:
- Tidak perlu tabel baru. Gunakan kolom yang sudah ada (`payment_proof`, `status`, `unique_code`, `payment_method`)
- Kolom `payment_method` di-update ke `QRIS_MANUAL` untuk membedakan dari Sakurupiah QRIS otomatis
- Generate `unique_code` via existing `generate_unique_payment_code()` RPC

#### File yang Diubah:
- `supabase/functions/telegram-webhook/index.ts` (tambah helper + modifikasi 3 fungsi payment + handler bukti + handler CS)

### Yang TIDAK Berubah
- Alur Sakurupiah tetap dicoba terlebih dahulu (fallback hanya jika gagal)
- Telegram Stars payment tidak terpengaruh
- UI/UX tombol pemilihan metode pembayaran tetap sama
- Semua fitur lain tidak terpengaruh

