

## Analisis Log Transaksi Sakurupiah

### Temuan

**Log telegram-webhook:**
- Timestamp: 2026-04-03 12:09:08 UTC
- Request body terkirim dalam format form-urlencoded (benar): `api_id=ID-13542277&method=QRIS&name=%40Aldn000&...`
- Response: **HTTP 415 Unsupported Media Type** dari `openresty/1.27.1.1`
- Error: "Response bukan JSON"

**Log sakurupiah-callback:**
- Tidak ada log sama sekali (callback belum pernah dipanggil karena invoice tidak pernah berhasil dibuat)

### Masalah

Kode di file sudah benar menggunakan `Content-Type: application/x-www-form-urlencoded`, namun server Sakurupiah tetap menolak dengan 415. Ada dua kemungkinan penyebab:

1. **Deploy belum aktif** - Function yang berjalan di runtime masih versi lama (yang pakai `application/json`). Ini paling mungkin karena log request body menunjukkan format URL-encoded yang benar, tapi server tetap menolak.

2. **Header `Authorization: Bearer` mengganggu** - Beberapa API berbasis PHP/openresty tidak mengharapkan header Authorization terpisah. `api_id` dan `signature` di body sudah cukup untuk autentikasi. Header `Authorization: Bearer` bisa menyebabkan openresty menolak request sebelum sampai ke PHP.

### Solusi

1. **Hapus header `Authorization: Bearer`** dari request — autentikasi sudah dijamin oleh `api_id` dan `signature` HMAC di body
2. **Deploy ulang** edge function telegram-webhook dengan force
3. **Setup webhook** ulang

### Perubahan Teknis

**File**: `supabase/functions/telegram-webhook/index.ts` (baris 216-219)

```typescript
// SEBELUM
headers: {
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/x-www-form-urlencoded',
},

// SESUDAH
headers: {
  'Content-Type': 'application/x-www-form-urlencoded',
},
```

Hanya satu perubahan kecil: hapus baris `Authorization` header, lalu deploy ulang dan setup webhook.

