
Masalah transaksi sekarang sudah terlihat jelas dari log terbaru: kegagalan terjadi di `telegram-webhook` saat membuat invoice, sebelum callback pembayaran sempat masuk.

### Temuan dari log terbaru
- Function aktif sudah memakai **`multipart/form-data`**, bukan versi lama.
- Log request terakhir:
  ```text
  [SAKURUPIAH] Request body (multipart/form-data): api_id=ID-13542277&method=QRIS&amount=25000&merchant_ref=p_810c181a-c9e6-4cb9-8675-bcee1206945a
  ```
- Response asli dari provider:
  ```html
  <html>
  <head><title>415 Unsupported Media Type</title></head>
  <body>
  <center><h1>415 Unsupported Media Type</h1></center>
  <hr><center>openresty/1.27.1.1</center>
  </body>
  </html>
  ```
- Log status:
  ```text
  [SAKURUPIAH] STATUS: 415
  ```
- Karena invoice gagal dibuat, `sakurupiah-callback` belum menjadi titik masalah utama.

### Diagnosis
Penyebab paling kuat saat ini adalah **format request salah**. Kode aktif di `createSakurupiahInvoice()` sekarang mengirim `FormData`, jadi request keluar sebagai **multipart/form-data**. Error `415 Unsupported Media Type` dari OpenResty menunjukkan server Sakurupiah menolak tipe body ini sebelum memproses signature atau parameter lain.

Artinya:
1. Deploy terbaru memang aktif
2. Masalah bukan webhook Telegram
3. Masalah utama sekarang adalah **Content-Type / media type request ke Sakurupiah**

### Solusi yang perlu diimplementasikan
1. Ubah request invoice dari `FormData` kembali ke `URLSearchParams`
2. Set header:
   ```ts
   'Content-Type': 'application/x-www-form-urlencoded'
   ```
3. Jangan kirim `multipart/form-data`
4. Pertahankan logging:
   - status HTTP
   - raw response
   - request body ringkas
5. Setelah itu baru uji transaksi baru lagi

### Detail teknis
File yang perlu diubah:
- `supabase/functions/telegram-webhook/index.ts`

Bagian yang perlu diganti:
```ts
const formData = new FormData();
...
body: formData,
```

Menjadi pola:
```ts
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

const resp = await fetch(SAKURUPIAH_API_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: formData.toString(),
});
```

### Prioritas
1. Perbaiki media type request
2. Deploy ulang `telegram-webhook`
3. Tes 1 transaksi baru
4. Cek apakah response berubah dari `415` menjadi JSON provider

### Hasil yang diharapkan
Jika analisis ini benar, setelah request dikirim sebagai `application/x-www-form-urlencoded`, error `415` akan hilang dan barulah kita bisa melihat apakah ada masalah lanjutan seperti signature atau parameter payload.
