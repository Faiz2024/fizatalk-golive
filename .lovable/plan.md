# Secret Aman antara FizaTalk dan FizaVoice

## Hasil akhir

Satu shared secret bernama `LEGACY_CALL_SECRET` akan dipakai oleh kedua proyek untuk memverifikasi pertukaran undangan `/call`. Secret tidak ditampilkan di kode, pesan Telegram, URL, atau log.

## Perubahan

1. **Bot lama FizaTalk**
   - Tambahkan fungsi pertukaran undangan khusus server-ke-server.
   - Validasi header bertanda tangan dengan `LEGACY_CALL_SECRET`, timestamp WIB, masa berlaku singkat, dan perlindungan replay.
   - Tukarkan token undangan sekali pakai hanya jika kedua pengguna masih menjadi partner aktif.
   - Batasi akses database melalui RPC sempit; tidak membuka akses database lama ke proyek voice.

2. **Proyek FizaVoice**
   - Pasang pemanggil endpoint FizaTalk dengan signature yang sama.
   - Simpan `LEGACY_CALL_SECRET` sebagai runtime secret di proyek FizaVoice.
   - Tolak signature salah, request kedaluwarsa, token pernah dipakai, atau pasangan sudah berubah.

3. **Pemasangan secret**
   - Karena nilainya harus identik di dua proyek, Anda membuat satu nilai acak kuat, misalnya dengan password manager atau `openssl rand -hex 32`.
   - Saya membuka formulir rahasia di masing-masing proyek untuk menyimpan nilai yang sama sebagai `LEGACY_CALL_SECRET`; nilainya tidak dikirim melalui chat.
   - Secret tidak boleh memakai token bot Telegram dan tidak perlu dimasukkan ke database.

4. **Verifikasi**
   - Uji signature valid dan tidak valid, request kedaluwarsa, replay, token sekali pakai, dan perubahan partner.
   - Deploy fungsi yang berubah dan uji alur `/call` sampai tombol bergabung diterima FizaVoice.

## Prasyarat

Proyek FizaVoice harus dapat ditemukan atau disebutkan dengan tautan/ID proyeknya. Setelah endpoint FizaTalk siap, formulir secret dibuka terlebih dahulu pada FizaTalk, kemudian pada FizaVoice dengan nilai yang sama.
