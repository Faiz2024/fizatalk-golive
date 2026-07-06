## Analisis

Tombol Stop masih gagal saat sedang chatting karena RPC `end_chat_comprehensive` error sebelum selesai. Log backend terbaru menunjukkan:

```text
[END_CHAT_FAIL] rpc_error: column "message_id" does not exist
```

Penyebabnya ada di migration ajakan channel yang mengubah `end_chat_comprehensive`: RPC membaca `reconnect_requests.message_id`, padahal tabel yang aktif punya kolom `requester_message_id`. Saat user sedang chatting dan klik Stop, RPC masuk ke blok reconnect notification, query kolom salah itu melempar error, sehingga reset chat tidak tuntas. Saat user tidak chatting, alurnya tidak memanggil RPC ini, jadi tombol Stop tetap terlihat berfungsi.

## Rencana Perbaikan Minimal

1. Buat migration kecil untuk memperbaiki RPC `end_chat_comprehensive` saja:
   - Ganti referensi `message_id` menjadi `requester_message_id` pada query `reconnect_requests`.
   - Pertahankan output JSON tetap bernama `requester_message_id` agar kode Edge Function tidak perlu berubah.
   - Tidak mengubah logika promo, ajakan channel, rating, waiting queue, reconnect status, atau alur Stop/Next lainnya.

2. Deploy ulang komponen yang terdampak:
   - Jalankan migration database.
   - Deploy ulang function `telegram-webhook` jika diperlukan agar webhook memakai kode terbaru yang sudah ada.
   - Setup ulang webhook setelah deploy.

3. Verifikasi:
   - Cek log `[END_CHAT_FAIL]` setelah perbaikan untuk memastikan error kolom hilang.
   - Uji jalur RPC secara aman dengan data non-destruktif/terbatas bila memungkinkan, tanpa mengubah state user aktif sembarangan.
   - Pastikan Stop saat tidak chatting tetap tidak berubah.

## Dampak dan Batasan

- Perubahan hanya menyasar bug kolom salah di RPC.
- Tidak ada table baru, tidak ada policy/RLS baru, dan tidak ada perubahan UI website.
- Biaya cloud tetap hemat: tidak menambah query baru; hanya memperbaiki query yang sudah ada agar tidak error.