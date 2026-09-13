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

### Arsitektur hemat untuk panggilan panjang

- Gunakan WebRTC P2P untuk panggilan 1:1 sebagai jalur utama. Audio mengalir langsung antarperangkat sehingga durasi panjang tidak memakai bandwidth server media.
- Gunakan TURN terkelola hanya sebagai cadangan saat koneksi langsung gagal karena jaringan seluler, NAT, firewall, atau VPN. Dengan demikian biaya hanya muncul pada sebagian panggilan.
- Untuk anonimitas paling kuat, admin dapat mengaktifkan mode `selalu relay`. Mode ini menyembunyikan alamat jaringan pengguna, tetapi semua menit panggilan menjadi berbayar.
- Gunakan audio-only Opus dengan bitrate adaptif rendah; jangan mengirim video, merekam, mentranskripsi, atau menyimpan audio.
- Tetapkan plafon biaya bulanan dan penghentian otomatis fitur gratis ketika plafon tercapai. Premium dapat tetap berjalan atau ikut dihentikan berdasarkan pengaturan admin.
- Kuota gratis sebaiknya dihitung berdasarkan menit relay yang benar-benar berbiaya, bukan sekadar lamanya koneksi P2P. Batas sesi tetap dipakai untuk mengurangi penyalahgunaan dan panggilan yang tertinggal.
- Hindari server SFU penuh untuk MVP 1:1. SFU baru diperlukan jika kelak ada panggilan grup, moderasi media real-time, atau keandalan yang tidak bisa dicapai dengan P2P/TURN.
- Alternatif paling murah tanpa risiko bandwidth adalah voice note dua arah melalui bot, tetapi sifatnya tidak real-time dan bukan panggilan langsung.

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

- Gunakan arsitektur hibrida WebRTC P2P + TURN terkelola untuk audio 1:1. Cloudflare Realtime TURN menjadi kandidat awal karena tarif berbasis data dan memiliki kuota gratis; pilihan akhir tetap dibandingkan berdasarkan harga aktual dan lokasi jaringan Indonesia.
- Sediakan adapter penyedia agar TURN dapat diganti tanpa mengubah RPC, alur bot, atau layar panggilan.
- Rahasia penyedia hanya berada di server.
- Mini App hanya menangani izin mikrofon dan aliran audio; pencocokan, hak akses, kuota, dan keputusan moderasi tetap berada pada bot/RPC.
- Sediakan pesan fallback jika mikrofon ditolak atau WebView Telegram pada perangkat tidak mendukung panggilan. Voice note Telegram tetap dapat dipakai seperti sekarang, tetapi tidak dianggap voice call real-time.

## Dampak terhadap sistem saat ini

- **Biaya:** panggilan P2P langsung hampir tidak menambah biaya media; panggilan yang memakai TURN tetap menambah biaya berdasarkan data. Perlu batas harian, batas sesi, plafon bulanan, dan pemantauan pemakaian.
- **Privasi jaringan:** P2P dapat mengekspos alamat IP antarpartner. Mode selalu-relay menghindarinya dengan konsekuensi biaya lebih tinggi; pilihan aman perlu dijelaskan sebelum peluncuran.
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
