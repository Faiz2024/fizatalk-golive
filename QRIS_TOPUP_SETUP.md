# 🚀 Setup QRIS Top-Up System

## ✅ Yang Sudah Diimplementasikan

### 1. Database Schema ✓
- **Tabel `payment_methods`**: Menyimpan metode pembayaran (QRIS)
- **Tabel `pending_transactions`**: Menyimpan transaksi pending
- **Storage bucket `payment-proofs`**: Untuk bukti pembayaran
- **RLS Policies**: Keamanan akses data
- **Function `generate_unique_payment_code()`**: Generate kode unik 1-999

### 2. Edge Function ✓
- **`notify-telegram-cs`**: Kirim notifikasi otomatis ke Telegram CS

### 3. Frontend ✓
- **Halaman `/topup`**: UI lengkap untuk top-up koin
- **Fitur**:
  - Input jumlah koin
  - Generate kode unik otomatis
  - Tampilkan QRIS code
  - Upload bukti pembayaran
  - Auto-notify ke Telegram CS

---

## 🔧 Setup Required

### 1. Jalankan Database Migration

**PENTING:** Jalankan SQL ini terlebih dahulu di Supabase SQL Editor:

1. Buka Supabase Dashboard → SQL Editor
2. Copy paste isi file `SETUP_QRIS_DATABASE.sql`
3. Klik "Run"
4. Tunggu sampai selesai (akan create tables, RLS policies, functions, dll)

File SQL location: `SETUP_QRIS_DATABASE.sql` (di root project)

### 2. Setup Environment Variables

Tambahkan di Supabase → Settings → Edge Functions → Environment Variables:

```bash
TELEGRAM_CS_CHAT_ID=<chat_id_cs>
```

**Cara mendapatkan `TELEGRAM_CS_CHAT_ID`:**

1. **Via Bot @userinfobot:**
   - CS kirim pesan ke @userinfobot
   - Bot akan reply dengan chat ID
   - Salin angka chat ID tersebut

2. **Via Bot @FizaTalkCS:**
   - CS kirim pesan "/start" ke bot FizaTalk
   - Cek logs di Supabase → Edge Functions → telegram-webhook
   - Cari log yang menampilkan `from.id` dari CS
   - Itu adalah chat ID CS

3. **Simpan ke Environment Variable:**
   ```
   Key: TELEGRAM_CS_CHAT_ID
   Value: <chat_id_yang_didapat>
   ```

### 3. Verify QRIS Image

QRIS image sudah disimpan di:
```
src/assets/qris-payment.jpg
```

Pastikan file ini ada dan bisa diakses.

---

## 🧪 Testing Flow

### Test 1: Create Transaction
1. Login sebagai user
2. Buka `/topup`
3. Pilih jumlah koin (contoh: 100)
4. Perhatikan kode unik yang di-generate (contoh: 523)
5. Total bayar = (100 × 100) + 523 = Rp 10,523
6. Scan QRIS dan bayar sesuai total
7. Upload screenshot bukti pembayaran
8. Klik "Submit Pembayaran"

### Test 2: Verify Notification
1. Cek Telegram CS (@FizaTalkCS) harus menerima notifikasi:
   ```
   🔔 TOP-UP BARU!
   
   👤 User: @username
   💰 Jumlah: 100 koin
   🔢 Kode Unik: 523
   💳 Total Bayar: Rp 10,523
   📱 Metode: QRIS (Semua E-Wallet & Bank)
   🆔 Transaction ID: <uuid>
   
   ⏰ Waktu: 30/01/2025 18:45:00
   
   📸 Silakan cek bukti pembayaran di Admin Dashboard untuk approve transaksi ini.
   ```

### Test 3: Verify Database
Query di Supabase SQL Editor:
```sql
SELECT * FROM pending_transactions ORDER BY created_at DESC LIMIT 1;
```

Harus ada row baru dengan:
- `status = 'pending'`
- `telegram_notified = true`
- `payment_proof_url` ada isinya

---

## 🔐 Security Checklist

- ✅ RLS enabled di semua tables
- ✅ Storage RLS untuk payment proofs
- ✅ User hanya bisa lihat transaksi sendiri
- ✅ Admin bisa lihat semua (via `has_role()`)
- ✅ File upload max 5MB
- ✅ Hanya image yang bisa diupload
- ✅ Unique code collision prevention

---

## 📱 Integration dengan Telegram Bot

### Update telegram-webhook untuk menampilkan coins
Tambahkan command `/balance` di `telegram-webhook/index.ts` untuk cek saldo:

```typescript
else if (text === '/balance') {
  const { data: userData } = await supabase
    .from('telegram_users')
    .select('coins')
    .eq('id', userId)
    .single();

  const coins = userData?.coins || 0;
  await sendTelegramMessage(
    botToken, 
    userId, 
    `💰 Saldo Koin: ${coins} koin\n\n💎 Top-up koin di: https://fizatalk.lovable.app/topup`
  );
}
```

---

## 🎯 Next Steps

1. ✅ **Deploy Edge Function** (otomatis saat build)
2. ✅ **Test end-to-end** (create transaction → verify notif)
3. ⏳ **Buat Admin Dashboard** untuk approve/reject transactions
4. ⏳ **Add transaction history** di profile user
5. ⏳ **Add coin usage tracking** (untuk rating, dll)

---

## 🐛 Troubleshooting

### Notifikasi tidak terkirim ke Telegram CS
**Penyebab:** `TELEGRAM_CS_CHAT_ID` belum di-set atau salah

**Solusi:**
1. Cek environment variable di Supabase
2. Pastikan CS sudah kirim pesan ke bot
3. Ambil chat ID via @userinfobot
4. Update env variable

### Error "Transaction not found"
**Penyebab:** RLS policy blocking access

**Solusi:**
1. Pastikan user sudah login
2. Cek `auth.uid()` match dengan `user_id` di transaction

### Upload bukti pembayaran gagal
**Penyebab:** Storage bucket atau RLS policy belum setup

**Solusi:**
1. Jalankan migration SQL
2. Verify bucket `payment-proofs` exists
3. Cek RLS policies di storage.objects

---

## 💡 Tips

- Kode unik 3 digit (1-999) sesuai permintaan user
- Kode unik divalidasi unik dalam 24 jam terakhir
- Payment proof disimpan per user folder: `{user_id}/{timestamp}.ext`
- Notifikasi ke CS via Edge Function (reliable & traceable)

---

**Status:** ✅ Ready to Test
**Last Updated:** 30 Januari 2025
