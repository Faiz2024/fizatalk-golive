# Tombol Call Acak pada Pesan Akhir Chat

## Hasil yang diinginkan
- Pada pesan **Partner mengakhiri chat** dan **Anda mengakhiri chat**, tampilkan tombol **🎙️ Call Acak** tepat di sebelah **🔍 Cari Partner Baru** dalam satu baris.
- Tombol membuka bot voice untuk memulai pencarian panggilan acak; tombol penilaian dan Hubungi Kembali tetap berfungsi seperti sekarang.

## Langkah
1. Perbarui susunan tombol bersama yang dipakai oleh kedua pesan akhir chat, termasuk pesan akhir chat pada kondisi pasangan sudah lebih dahulu terputus.
2. Gunakan username bot voice yang sudah dikonfigurasi sebagai tujuan tautan Telegram. Jika username belum tersedia atau tidak valid, jangan tampilkan tautan yang rusak; biarkan tombol pencarian partner tetap dapat dipakai.
3. Periksa tampilan tombol dan tautan pada kedua pesan, lalu deploy ulang fungsi bot dan pastikan webhook tetap aktif.

## Detail teknis
- Ubah hanya bot Telegram lama, terutama pembuat keyboard `buildEndChatKeyboard`; gunakan `getVoiceBotUsername()` dan URL `https://t.me/<username>` tanpa token undangan `/call`, karena ini antrean voice acak, bukan panggilan ke partner lama.
- Tidak perlu perubahan database atau panggilan RPC tambahan; tidak mengubah alur penilaian dan pencarian chat teks.
