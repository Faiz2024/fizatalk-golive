

## Perbaikan Error Pembayaran Sakurupiah

### Masalah

Ada **mismatch antara Content-Type header dan format body** pada fungsi `createSakurupiahInvoice`:

- **Header**: `Content-Type: application/json` (diubah pada edit terakhir)
- **Body**: `formData.toString()` yang menghasilkan format `key=value&key2=value2` (URL-encoded)

Server Sakurupiah menerima header JSON tapi body bukan JSON, sehingga mengembalikan **HTTP 415 Unsupported Media Type**.

### Solusi

Ubah body request menjadi format JSON agar sesuai dengan header `Content-Type: application/json`:

**File**: `supabase/functions/telegram-webhook/index.ts`

1. Ganti `URLSearchParams` (baris 195-209) menjadi object JSON
2. Kirim body sebagai `JSON.stringify(jsonBody)` (baris 218)

Perubahan spesifik:
```typescript
// SEBELUM (URLSearchParams)
const formData = new URLSearchParams();
formData.append('api_id', apiId);
...
body: formData.toString()

// SESUDAH (JSON)
const jsonBody = {
  api_id: apiId,
  method: params.method,
  name: params.customerName || 'FizaTalk User',
  phone: '6280000000000',
  amount: params.amount,
  merchant_fee: 2,
  merchant_ref: params.merchantRef,
  expired: params.expired || 60,
  'produk[0]': params.productName,
  'qty[0]': 1,
  'harga[0]': params.amount,
  callback_url: SAKURUPIAH_CALLBACK_URL,
  return_url: 'https://t.me/FizaTalkBot',
  signature: signature,
};
...
body: JSON.stringify(jsonBody)
```

3. Deploy ulang edge function dan setup webhook

