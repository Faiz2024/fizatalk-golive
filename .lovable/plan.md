# Voice Call FizaTalk di Dalam Telegram

## Ringkasan keputusan

- Bot Telegram resmi tidak dapat memulai panggilan suara native antar-user melalui Bot API.
- Solusi yang layak adalah tombol di bot yang membuka ruang panggilan suara di dalam Telegram Mini App. Ini tetap menjadi pengalaman bot Telegram, bukan dashboard web terpisah.
- Voice call tersedia untuk partner chat yang sudah cocok dan melalui antrean voice khusus.
- Semua pengguna mendapat kuota gratis terbatas; Premium mendapat kuota lebih besar.
- Tidak ada rekaman audio. Moderasi memakai laporan, blokir, metadata sesi, dan sistem reputasi yang sudah ada.

## Pengalaman pengguna

### Panggilan dengan partner chat
1. Setelah partner ditemukan, bot menampilkan tombol `Mulai Voice Call`.
2. Satu pengguna mengundang dan partner harus menyetujui.
3. Kedua pengguna membuka ruang suara yang sama di dalam Telegram.
4. Layar panggilan menyediakan mute, speaker, durasi, akhiri, laporkan, dan blokir.
5. Jika salah satu keluar, bot mengabarkan panggilan berakhir dan menampilkan penilaian partner.

### Antrean voice khusus
1. Menu utama mendapat tombol `Cari Partner Voice`.
2. Bot mencocokkan pengguna melalui antrean khusus tanpa mengganggu antrean chat teks.
3. Setelah cocok, kedua pengguna mendapat undangan masuk ruang suara dengan batas waktu singkat.
4. Undangan kedaluwarsa atau ditolak akan mengembalikan pengguna ke status semula tanpa ruang berbayar yang tertinggal.

## Kuota dan biaya

- Kuota dan durasi dibuat sebagai pengaturan admin agar dapat diubah tanpa deploy.
- Nilai awal yang disarankan: pengguna gratis 5 menit per hari dan maksimal 5 menit per sesi; Premium 30 menit per hari dan maksimal 15 menit per sesi.
- Ruang media hanya dibuat setelah kedua pengguna menyetujui, sehingga antrean dan undangan tidak menimbulkan biaya menit panggilan.
- Tidak memakai heartbeat database berulang. Durasi akhir dihitung dari event penyedia panggilan dan diselesaikan dengan satu RPC atomik.
- Tambahkan batas pembuatan ruang dan cooldown di database untuk mencegah spam lintas instance.
- Biaya baru utama berasal dari penyedia WebRTC/TURN berdasarkan menit peserta dan bandwidth; biaya database bertambah kecil jika sesi disimpan secara ringkas.

## Moderasi, privasi, dan keamanan

- Tampilkan persetujuan bahwa suara asli akan terdengar dan audio tidak direkam sebelum penggunaan pertama.
- Validasi identitas Telegram Mini App di server; jangan mempercayai ID pengguna dari browser.
- Token ruang berumur pendek, hanya berlaku untuk satu pengguna dan satu ruang, serta tidak mengungkap identitas partner.
- Tombol `Laporkan` dan `Blokir` tersedia selama dan sesudah panggilan.
- Laporan voice masuk ke sistem laporan, penalti, shadowban, dan pemblokiran yang sama untuk Premium maupun non-Premium sesuai aturan yang sudah berlaku.
- Pemblokiran pasangan mencegah pertemuan ulang di chat teks maupun voice.
- Simpan hanya metadata minimum: pasangan, waktu mulai/selesai WIB, durasi, status, alasan selesai, dan laporan. Jangan simpan audio, transkrip, alamat IP, atau data perangkat yang tidak diperlukan.
- Endpoint event penyedia wajib memverifikasi tanda tangan dan menangani event berulang secara idempoten.

## Perubahan bot dan database

- Tambahkan status voice terpisah agar state `idle`, `waiting`, `chatting`, dan pembayaran yang ada tidak rusak.
- Tambahkan tabel sesi voice, antrean voice, undangan, kuota harian, dan daftar blokir pasangan dengan RLS serta grant yang tepat.
- Gunakan RPC atomik untuk:
  - masuk/keluar antrean voice;
  - mencocokkan partner dengan lock aman;
  - membuat dan menerima undangan;
  - memulai serta mengakhiri sesi;
  - mengurangi kuota berdasarkan durasi aktual;
  - melaporkan dan memblokir partner;
  - membersihkan sesi atau undangan kedaluwarsa.
- Gunakan waktu WIB pada pesan dan tampilan; timestamp database tetap konsisten dan diformat ke `Asia/Jakarta` saat dipakai.
- Pertahankan filter Premium, anti-repeat, shadowban, status blokir, serta aturan Stop/Next pada masing-masing mode.

## Infrastruktur panggilan

- Gunakan penyedia WebRTC terkelola dengan dukungan audio 1:1, token server-side, webhook sesi, TURN, dan batas durasi. LiveKit Cloud menjadi kandidat awal karena cocok untuk ruang 1:1 dan dapat dibungkus agar mudah diganti.
- Rahasia penyedia hanya berada di server.
- Mini App hanya menangani izin mikrofon dan aliran audio; pencocokan, hak akses, kuota, dan keputusan moderasi tetap berada pada bot/RPC.
- Sediakan pesan fallback jika mikrofon ditolak atau WebView Telegram pada perangkat tidak mendukung panggilan. Voice note Telegram tetap dapat dipakai seperti sekarang, tetapi tidak dianggap voice call real-time.

## Dampak terhadap sistem saat ini

- **Biaya:** naik berdasarkan menit panggilan; perlu batas harian, batas sesi, dan pemantauan pemakaian.
- **Performa:** database tetap ringan jika semua perubahan sesi dikonsolidasikan ke RPC dan tidak ada polling/heartbeat DB.
- **Keamanan:** permukaan serangan bertambah melalui Mini App, token ruang, dan webhook penyedia; seluruhnya perlu validasi dan idempotensi.
- **Moderasi:** tanpa rekaman, admin tidak memiliki bukti audio; keputusan hanya berdasarkan laporan, pola laporan, dan metadata sesi.
- **Privasi:** suara dapat mengungkap umur, gender, dialek, atau identitas; persetujuan eksplisit wajib.
- **Pengalaman:** izin mikrofon dapat berbeda di Android, iOS, dan Desktop; perlu pengujian nyata serta fallback yang jelas.
- **Operasional:** perlu akun penyedia panggilan, pemantauan biaya, alarm kuota, dan prosedur saat layanan media terganggu.

## Tahapan pelaksanaan

1. Pilih penyedia berdasarkan harga aktual, lokasi server terdekat Indonesia, webhook, TURN, dan batas pemakaian.
2. Tambahkan skema dan RPC voice secara terpisah dari chat teks, lengkap dengan tes concurrency dan pengulangan event.
3. Tambahkan endpoint server untuk validasi Telegram, penerbitan token ruang, dan event selesai dari penyedia.
4. Bangun layar panggilan di dalam Telegram dengan persetujuan mikrofon, kontrol panggilan, laporan, dan blokir.
5. Hubungkan tombol partner chat dan antrean voice khusus ke alur bot.
6. Uji dua pengguna secara bersamaan pada Android, iOS, dan Desktop: menerima/menolak undangan, izin ditolak, putus jaringan, Stop/Next, kuota habis, report, block, Premium, shadowban, serta event ganda.
7. Rilis bertahap dengan kuota rendah, ukur biaya per menit dan kegagalan koneksi, lalu sesuaikan batas melalui pengaturan admin.

## Di luar MVP

- Perekaman atau transkripsi panggilan.
- Panggilan grup, video call, voice changer, dan moderasi audio otomatis.
- Native Telegram call atau userbot, karena tidak didukung Bot API resmi dan berisiko terhadap akun.
