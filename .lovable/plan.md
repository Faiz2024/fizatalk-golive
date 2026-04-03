

## Perbaikan Error 415 - Sakurupiah API

### Masalah

API Sakurupiah mengembalikan **HTTP 415 Unsupported Media Type** karena API mereka mengharapkan format `application/x-www-form-urlencoded`, bukan `application/json`.

Log terakhir membuktikan ini:
- Request body dikirim sebagai JSON
- Response: `415 Unsupported Media Type` dari openresty server

### Solusi

Ubah kembali format request ke `application/x-www-form-urlencoded` menggunakan `URLSearchParams`, dan ubah Content-Type header agar sesuai.

**File**: `supabase/functions/telegram-webhook/index.ts` (baris 195-222)

```typescript
// SEBELUM (JSON - GAGAL)
const jsonBody = { api_id: apiId, ... };
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(jsonBody),

// SESUDAH (Form URL-encoded - SESUAI API)
const formData = new URLSearchParams();
formData.append('api_id', apiId);
formData.append('method', params.method);
formData.append('name', params.customerName || 'FizaTalk User');
formData.append('phone', '6280000000000');
formData.append('amount', String(params.amount));
formData.append('merchant_fee', '2');
formData.append('merchant_ref', params.merchantRef);
formData.append('expired', String(params.expired || 60));
formData.append('produk[0]', params.productName);
formData.append('qty[0]', '1');
formData.append('harga[0]', String(params.amount));
formData.append('callback_url', SAKURUPIAH_CALLBACK_URL);
formData.append('return_url', 'https://t.me/FizaTalkBot');
formData.append('signature', signature);

// Headers dan body:
headers: {
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/x-www-form-urlencoded',
},
body: formData.toString(),
```

### Langkah
1. Ubah body request dari JSON ke URLSearchParams
2. Ubah Content-Type header ke `application/x-www-form-urlencoded`
3. Deploy ulang edge function dan setup webhook

