# 🤖 Setup Bot Telegram FizaTalk

## 📋 Checklist Setup

### 1. ✅ Environment Variables (WAJIB!)

Pastikan semua environment variables sudah di-set di Supabase Dashboard:

**Lokasi:** Supabase Dashboard → Settings → Edge Functions → Environment Variables

```bash
TELEGRAM_BOT_TOKEN=<bot_token_dari_botfather>
TELEGRAM_CS_CHAT_ID=<chat_id_admin_cs>
SUPABASE_URL=<auto_generated>
SUPABASE_SERVICE_ROLE_KEY=<auto_generated>
```

#### Cara Mendapatkan Bot Token:
1. Chat dengan [@BotFather](https://t.me/BotFather) di Telegram
2. Kirim command: `/newbot`
3. Ikuti instruksi (nama bot, username bot)
4. BotFather akan berikan token seperti: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`
5. Copy token tersebut ke `TELEGRAM_BOT_TOKEN`

#### Cara Mendapatkan CS Chat ID:
1. CS kirim pesan ke [@userinfobot](https://t.me/userinfobot)
2. Bot akan reply dengan info, cari angka di `Id: 123456789`
3. Copy angka tersebut ke `TELEGRAM_CS_CHAT_ID`

---

### 2. ✅ Setup Webhook

Setelah edge function deploy, hubungkan bot ke webhook:

**URL Webhook:**
```
https://jvmxnsqxxbezhipcxmva.supabase.co/functions/v1/telegram-webhook
```

#### Cara Set Webhook:

**Method 1: Via Browser (Paling Mudah)**

Buka URL ini di browser (ganti `<BOT_TOKEN>` dengan token bot kamu):

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://jvmxnsqxxbezhipcxmva.supabase.co/functions/v1/telegram-webhook
```

**Expected Response:**
```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

**Method 2: Via cURL (Alternative)**

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://jvmxnsqxxbezhipcxmva.supabase.co/functions/v1/telegram-webhook"}'
```

#### Verifikasi Webhook:

Cek apakah webhook sudah terhubung:

```
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

**Expected Response:**
```json
{
  "ok": true,
  "result": {
    "url": "https://jvmxnsqxxbezhipcxmva.supabase.co/functions/v1/telegram-webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

---

### 3. ✅ Database Migration

Jalankan SQL di Supabase SQL Editor:

**File:** `TELEGRAM_TOPUP_SYSTEM.sql`

```sql
-- Copy paste semua isi file TELEGRAM_TOPUP_SYSTEM.sql ke SQL Editor
-- Lalu klik "Run"
```

**Tables yang akan dibuat:**
- `topup_requests` - Payment requests
- `coin_transactions` - Transaction history
- `telegram_users.coins` - Saldo koin user

---

### 4. ✅ Upload QRIS Image

Pastikan file QRIS tersedia:

**Lokasi:** `public/qris-payment.jpg`

**URL yang digunakan bot:**
```
https://977e4c21-3d96-4468-9f61-f0ebe63c6c4e.lovableproject.com/qris-payment.jpg
```

**Verifikasi:** Buka URL di browser, pastikan gambar QRIS muncul.

---

## 🧪 Testing Bot

### Test 1: Bot Aktif

Kirim pesan apapun ke bot, harus dapat reply:

```
User → Hello
Bot  → Selamat datang! 👋

Gunakan /start untuk mencari partner chat acak.

Command yang tersedia:
/start - Cari partner
/next - Ganti partner
/stop - Akhiri chat
/coins - Cek saldo koin
/topup <jumlah> - Top-up koin (min. 50)
```

✅ **PASS** jika bot reply
❌ **FAIL** jika tidak ada response → Cek webhook setup

---

### Test 2: Cek Saldo Koin

```
User → /coins
Bot  → 💰 Saldo Koin Kamu: 0 koin
```

✅ **PASS** jika bot reply dengan saldo
❌ **FAIL** jika error → Cek database migration

---

### Test 3: Request Top-Up

```
User → /topup 100
Bot  → 💳 TOP-UP 100 KOIN
       
       📝 ID Transaksi: [uuid]
       
       💰 Total Bayar: Rp 10,000
       (1 koin = Rp 100)
       
       [Tampilkan QRIS Image]
       
       📸 Langkah selanjutnya:
       1. Scan QRIS di atas
       2. Transfer sesuai nominal
       3. Kirim foto bukti bayar ke chat ini
       4. Tunggu konfirmasi admin (1-5 menit)
       
       ⚠️ Jangan lupa kirim bukti bayar!
```

✅ **PASS** jika bot kirim QRIS image + instruksi
❌ **FAIL** jika error atau QRIS tidak muncul → Cek QRIS URL

---

### Test 4: Upload Bukti Bayar

```
User → [Upload foto apapun]
Bot  → ✅ Bukti pembayaran diterima!
       
       ⏳ Mohon tunggu, admin akan memverifikasi dalam 1-5 menit.
       
       Kamu akan mendapat notifikasi saat transaksi disetujui.
```

**Cek CS Chat:** CS harus terima notifikasi dengan foto bukti bayar

✅ **PASS** jika:
- User dapat konfirmasi
- CS terima notifikasi dengan foto
- Notifikasi berisi Request ID dan command approve/reject

❌ **FAIL** jika CS tidak terima notifikasi → Cek `TELEGRAM_CS_CHAT_ID`

---

### Test 5: CS Approve (CS Only)

```
CS   → /approve [request_id_dari_notifikasi]
Bot  → CS: ✅ Transaksi [uuid] telah diapprove.
           User menerima 100 koin.

Bot  → User: ✅ TOP-UP BERHASIL!
             
             💰 100 koin telah ditambahkan ke akun kamu.
             💳 Saldo baru: 100 koin
             
             Terima kasih! 🎉
```

✅ **PASS** jika:
- CS dapat konfirmasi approve
- User dapat notifikasi berhasil
- Saldo user bertambah (cek dengan `/coins`)

---

### Test 6: Verify Saldo Bertambah

```
User → /coins
Bot  → 💰 Saldo Koin Kamu: 100 koin
```

✅ **PASS** jika saldo sesuai dengan yang di-approve
❌ **FAIL** jika saldo tidak berubah → Cek logs edge function

---

### Test 7: Chat System

```
User1 → /start
Bot   → 🔍 Mencari partner untuk kamu...
        Mohon tunggu sebentar!

User2 → /start
Bot   → ✅ Partner ditemukan! Mulai ngobrol sekarang.
        
        📊 Rating Partner: 0 rating
        Belum ada rating
        
        Gunakan /next untuk cari partner baru atau /stop untuk berhenti.
```

✅ **PASS** jika kedua user terpasangkan
❌ **FAIL** jika tidak terpasangkan → Cek database `waiting_queue`

---

## 🐛 Troubleshooting

### Bot Tidak Merespon

**Kemungkinan Penyebab:**
1. Webhook belum di-set
2. Bot token salah
3. Edge function belum deploy

**Solusi:**
1. Verifikasi webhook dengan `/getWebhookInfo`
2. Cek environment variables di Supabase
3. Cek logs di Supabase Dashboard → Edge Functions → Logs

---

### CS Tidak Terima Notifikasi

**Kemungkinan Penyebab:**
1. `TELEGRAM_CS_CHAT_ID` salah atau belum di-set
2. CS belum pernah kirim pesan ke bot

**Solusi:**
1. Ambil ulang Chat ID via @userinfobot
2. Set ulang environment variable
3. Restart edge function (otomatis setelah update env)

---

### QRIS Image Tidak Muncul

**Kemungkinan Penyebab:**
1. File tidak ada di `public/qris-payment.jpg`
2. URL salah di edge function

**Solusi:**
1. Pastikan file ada
2. Test URL di browser
3. Update URL di `telegram-webhook/index.ts` line 553 jika perlu

---

### Database Error saat Top-Up

**Kemungkinan Penyebab:**
1. Migration belum dijalankan
2. RLS policies blocking

**Solusi:**
1. Jalankan ulang `TELEGRAM_TOPUP_SYSTEM.sql`
2. Cek logs untuk error detail
3. Verifikasi tables sudah ada di Supabase

---

## 📊 Monitoring

### Cek Logs Edge Function

**Lokasi:** Supabase Dashboard → Edge Functions → telegram-webhook → Logs

**Log yang Normal:**
```
Parsed update: {"message":{"from":{"id":123456},...}}
```

**Log Error yang Perlu Diperhatikan:**
```
Error: TELEGRAM_BOT_TOKEN not configured
Error parsing request
Error creating topup request
```

---

### Cek Database

**Pending Top-Up Requests:**
```sql
SELECT * FROM topup_requests 
WHERE status = 'pending' 
ORDER BY created_at DESC;
```

**User Coins Balance:**
```sql
SELECT id, username, coins 
FROM telegram_users 
ORDER BY coins DESC 
LIMIT 10;
```

**Recent Transactions:**
```sql
SELECT * FROM coin_transactions 
ORDER BY created_at DESC 
LIMIT 20;
```

---

## ✅ Final Checklist

Sebelum go-live, pastikan semua ini sudah:

- [ ] Environment variables sudah di-set
- [ ] Webhook sudah terhubung (`/getWebhookInfo` = OK)
- [ ] Database migration sudah dijalankan
- [ ] QRIS image bisa diakses
- [ ] Test /topup berhasil
- [ ] Test upload foto berhasil
- [ ] CS terima notifikasi
- [ ] Test approve/reject berhasil
- [ ] Saldo koin bertambah setelah approve
- [ ] Chat system berfungsi normal

---

## 🚀 Go Live!

Setelah semua checklist ✅, bot siap digunakan!

**Share bot ke user:**
1. Dapatkan username bot dari BotFather
2. Share link: `https://t.me/YourBotUsername`
3. Monitor logs dan database untuk activity

**Support:**
- Monitor CS notifications
- Respond cepat untuk approvals (target < 5 menit)
- Check logs regularly untuk errors

---

**Status:** Ready for Production
**Last Updated:** 30 Januari 2025
