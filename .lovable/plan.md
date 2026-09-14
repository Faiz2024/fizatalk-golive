# Perlindungan Hukum, Privasi, dan Keselamatan FizaTalk

## Sasaran dan batasan

- Berlaku untuk **seluruh bot Telegram FizaTalk**, bukan fitur voice call.
- Layanan dibatasi untuk pengguna **berusia 18 tahun ke atas** dan berada di **Indonesia**.
- Tidak ada implementasi yang dapat menjamin bebas tuntutan, sanksi, atau denda. Tujuannya adalah mengurangi risiko secara nyata, membangun bukti kepatuhan, dan menghentikan penggunaan berisiko sedini mungkin.
- Teks hukum final, status badan usaha, pendaftaran PSE, perpajakan, dan model pembayaran tetap harus diperiksa advokat Indonesia serta konsultan terkait sebelum peluncuran.

## Temuan yang harus ditutup

- Alur `/start` saat ini belum meminta deklarasi usia 18+ atau persetujuan Ketentuan dan Kebijakan Privasi.
- Bot belum menyediakan penghapusan akun/data secara mandiri.
- Webhook saat ini belum memakai secret token Telegram untuk membuktikan update benar-benar berasal dari Telegram.
- Foto, video, dokumen, dan media lain dapat diteruskan ke orang asing tanpa pemeriksaan media otomatis.
- Retensi beberapa log, laporan, bukti pembayaran, dan draft e-wallet belum dibatasi secara menyeluruh.
- Pembayaran denda saat ini dapat membuka blokir; pelanggaran keselamatan serius tidak boleh dipulihkan hanya dengan pembayaran.
- Bukti cashout dipublikasikan ke channel dalam bentuk tersamarkan, tetapi belum ada persetujuan publikasi yang eksplisit.
- RPC `bridge_exec_sql` dapat menjalankan SQL dinamis dengan hak tinggi dan memperbesar dampak bila kredensial server disalahgunakan.

## Contoh risiko nyata yang menjadi dasar perbaikan

- Pengguna di bawah 18 tahun menerima atau mengirim konten seksual melalui bot.
- Laporan tentang konten anak, ancaman, atau pemerasan tidak segera menghentikan akses pelaku.
- Nomor e-wallet, bukti pembayaran, identitas, atau isi laporan bocor atau dipublikasikan tanpa persetujuan khusus.
- Data dikumpulkan tanpa persetujuan yang jelas, disimpan tanpa batas, atau tidak dihapus setelah permintaan pengguna.
- Pembayaran berhasil tetapi Premium/saldo tidak aktif, transaksi tergandakan, atau promo ditolak tanpa mekanisme refund dan sengketa.
- Orang yang bukan admin dapat menyetujui bukti pembayaran atau tindakan finansial.
- Klaim referral, harga coret, atau batas waktu promo memberi kesan penghasilan/keterbatasan yang tidak sesuai keadaan sebenarnya.
- Akun undangan yang sah terhapus karena keputusan referral tidak organik tanpa pemberitahuan, bukti memadai, atau jalur banding.
- Pelanggaran keselamatan serius dapat dipulihkan hanya dengan membayar denda atau membeli Premium.
- Request palsu ke webhook memicu pesan, laporan, saldo, atau tindakan admin akibat autentikasi yang lemah.
- Layanan publik tidak memenuhi kewajiban PSE/takedown yang berlaku atau model dananya masuk kegiatan pembayaran berizin.

Setiap kasus dapat memicu kombinasi sengketa konsumen, tuntutan ganti rugi, pemeriksaan pidana, sanksi administratif, atau pemutusan akses bergantung pada fakta. Untuk pelanggaran tertentu, UU PDP memungkinkan denda administratif hingga 2% pendapatan tahunan; angka dan penerapannya harus dikonfirmasi advokat berdasarkan kasus nyata.

## 1. Gerbang 18+, wilayah, dan persetujuan wajib

- Sebelum fitur apa pun dapat dipakai, tampilkan ringkasan yang jelas: khusus 18+, Indonesia, anonymous chat memiliki risiko, larangan konten, pemrosesan data, mekanisme laporan, serta tautan/perintah untuk dokumen lengkap.
- Minta empat persetujuan eksplisit melalui tombol terpisah atau konfirmasi berurutan:
  1. berusia minimal 18 tahun;
  2. berada di Indonesia;
  3. menyetujui Ketentuan Penggunaan dan Kebijakan Privasi;
  4. memahami bahwa pengguna lain tetap dapat menyalahgunakan atau merekam percakapan di perangkatnya.
- Jangan cukup mengandalkan tanggal lahir yang diketik. Simpan deklarasi usia, versi dokumen, waktu persetujuan WIB, Telegram user ID, dan sumber alur persetujuan.
- Semua pengguna lama wajib menyetujui versi aktif sebelum dapat mencari partner, mengirim pesan/media, membeli, menerima hadiah, atau memakai referral.
- Bila dokumen berubah secara material, paksa persetujuan ulang. Perubahan minor dicatat tanpa mengganggu pengguna.
- Tambahkan `/ketentuan`, `/privasi`, `/keamanan`, `/bantuan`, dan `/hapusakun`, tersedia baik saat idle maupun chatting dan tidak pernah diteruskan ke partner.

## 2. Dokumen dan informasi yang tampil di bot

- Sediakan Ketentuan Penggunaan berbahasa Indonesia yang mencakup: kelayakan 18+, wilayah Indonesia, aturan anonymous chat, konten terlarang, sanksi, penghentian akun, laporan/banding, transaksi, referral, hak kekayaan intelektual, batas tanggung jawab yang wajar, perubahan layanan, hukum Indonesia, dan saluran pengaduan.
- Sediakan Kebijakan Privasi yang menyebut data yang dikumpulkan, tujuan dan dasar pemrosesan, penerima data, lokasi/pihak pemroses, retensi, keamanan, hak pengguna, penghapusan, insiden data, serta kontak operator.
- Sediakan Kebijakan Transaksi dan Pengembalian Dana: harga/biaya total sebelum bayar, isi Premium/top-up, masa berlaku, kondisi gagal bayar/duplikat, kanal komplain, waktu respons, serta evaluasi refund yang tidak menghapus hak konsumen menurut hukum.
- Tampilkan identitas operator, alamat/kedudukan usaha, dan kontak pengaduan yang nyata. Nilai ini menjadi pengaturan admin dan tidak boleh diisi dengan identitas rekaan.
- Disclaimer tidak boleh menyatakan FizaTalk bebas dari seluruh tanggung jawab atau menghilangkan hak konsumen yang diwajibkan hukum.

## 3. Keselamatan chat dan moderasi

- Pisahkan kategori laporan: seksual tanpa persetujuan, dugaan melibatkan anak, ancaman/kekerasan, pemerasan/penipuan, penyebaran data pribadi, narkoba/judi, spam, dan lainnya.
- Kategori kritis langsung menghentikan chat, membekukan akun untuk pemeriksaan, mencegah pencocokan ulang, dan memberi petunjuk bantuan/darurat yang sesuai. Jangan menunggu empat laporan untuk dugaan konten anak, ancaman nyata, atau pemerasan.
- Terapkan pemeriksaan media sebelum diteruskan. Sampai layanan pemeriksaan media yang memenuhi kebutuhan privasi dan penanganan konten ilegal tersedia, **nonaktifkan pengiriman foto, video, animasi, video note, dan dokumen antarpartner**; voice note dapat dipertahankan hanya setelah evaluasi risiko khusus.
- Jangan menyimpan atau mengunduh materi yang diduga ilegal lebih lama dari kebutuhan penanganan. Simpan ID pesan/file Telegram dan jejak tindakan minimum; prosedur eskalasi serta preservasi bukti harus disahkan penasihat hukum.
- Berikan proses banding gratis. Pelanggaran serius tidak dapat dihapus hanya dengan membayar denda atau membeli Premium.
- Premium tidak mendapat pengecualian dari aturan keselamatan, laporan, shadowban, blokir, atau pemeriksaan konten.
- Revisi bahasa filter agar istilah identitas/disabilitas tidak diperlakukan sebagai hinaan secara otomatis tanpa konteks.
- Tambahkan tombol blokir permanen pasangan dan pastikan pasangan yang saling memblokir tidak pernah dicocokkan lagi di semua mode.

## 4. Privasi, hak pengguna, dan penghapusan otomatis

- Tambahkan `/datasaya` untuk menampilkan ringkasan data dan menyediakan ekspor yang aman melalui chat privat pengguna, bukan grup/channel.
- Tambahkan `/hapusakun` dengan dua kali konfirmasi, pemberitahuan akibat penghapusan, dan masa tunggu singkat untuk pembatalan. Selama masa tunggu, akun tidak dapat mencari partner.
- Jalankan penghapusan melalui satu RPC atomik dan idempoten. Hapus profil, antrean, pasangan, referral yang dapat dihapus, draft e-wallet, log yang tidak wajib disimpan, serta media/bukti terkait.
- Data yang masih wajib dipertahankan untuk sengketa transaksi, pencegahan penipuan, atau kewajiban hukum dipisahkan, diminimalkan, dikunci dari penggunaan produk, diberi alasan serta tanggal hapus otomatis. Jangan menjanjikan penghapusan absolut bila ada kewajiban penyimpanan yang sah.
- Retensi awal yang diusulkan untuk ditinjau advokat:
  - log operasional biasa: 7 hari;
  - log error/keamanan: 30 hari;
  - laporan dan bukti moderasi minimum: 90 hari;
  - draft e-wallet yang tidak selesai: 7 hari;
  - bukti pembayaran: masa sengketa yang diwajibkan hukum/penyedia pembayaran, lalu dihapus atau dianonimkan;
  - statistik: agregat tanpa identitas, dapat disimpan lebih lama.
- Jadwalkan pembersihan melalui satu job harian WIB yang memanggil RPC housekeeping agar hemat biaya; tidak menggunakan polling per pengguna.
- Redaksi isi `bot_logs.context`; jangan simpan teks chat penuh, nomor pembayaran penuh, token, URL bukti, atau payload Telegram mentah.
- Hentikan publikasi bukti cashout ke channel secara default. Tambahkan persetujuan terpisah dan opsional; tanpa persetujuan, hanya publikasikan statistik agregat tanpa identitas atau potongan nomor.

## 5. Keamanan teknis

- Buat secret token acak khusus webhook, pasang melalui `setWebhook`, dan tolak setiap request yang header Telegram-nya tidak cocok sebelum membaca atau menulis database.
- Terapkan deduplikasi `update_id` agar retry Telegram tidak menggandakan transaksi, laporan, hadiah, atau tindakan admin.
- Validasi bentuk dan batas panjang seluruh input callback, command, caption, data referral, data e-wallet, dan ID transaksi.
- Pertahankan keputusan sensitif di RPC atomik dengan advisory/row lock: pembayaran, saldo koin, Premium, denda, referral, laporan, blokir, dan penghapusan akun.
- Ganti pemrosesan pembayaran bersama yang masih terdiri dari beberapa read/update/insert menjadi RPC idempoten berdasarkan ID transaksi penyedia; callback ganda harus mengembalikan hasil lama tanpa kredit ganda.
- Nonaktifkan Sakurupiah tetap dipertahankan. Gunakan hanya Telegram Stars dan QRIS manual sesuai keputusan proyek, dengan rekonsiliasi dan audit.
- Hapus `bridge_exec_sql` dari produksi bila tidak mutlak diperlukan. Jika sementara masih diperlukan, batasi ke mode pemeliharaan, whitelist operasi, secret terpisah, audit setiap panggilan, dan jangan menerima SQL bebas dari klien.
- Hapus endpoint pihak ketiga yang tidak dipakai dari kode. Setiap pihak pemroses data yang dipakai harus tercantum dalam Kebijakan Privasi dan perjanjian pemrosesan data.
- Seluruh timestamp disimpan konsisten dan waktu yang ditampilkan/audit menggunakan `Asia/Jakarta` (WIB).

## 6. Perlindungan transaksi dan referral

- Sebelum invoice dibuat, tampilkan produk, manfaat, durasi, harga, biaya tambahan, metode bayar, masa berlaku invoice, kebijakan pembatalan/refund, dan tombol persetujuan bayar.
- Kirim tanda terima setelah pembayaran dengan ID referensi, jumlah, waktu WIB, produk, dan kanal komplain tanpa menampilkan rahasia pembayaran.
- Tambahkan alur sengketa pembayaran, transaksi duplikat, saldo tidak masuk, dan Premium gagal aktif; admin dapat menelusuri audit tanpa melihat data berlebih.
- Denda hanya boleh tersedia untuk pelanggaran ringan yang terdefinisi. Dugaan konten anak, eksploitasi, ancaman, pemerasan, penipuan, atau pelanggaran berulang tidak dapat dibuka melalui pembayaran.
- Jelaskan bahwa referral bukan investasi, tidak memerlukan pembelian, bukan pendapatan pasti, hanya satu tingkat, serta hadiah bergantung pada validasi pengguna sah. Dilarang membuat klaim penghasilan yang menyesatkan.
- Penolakan referral tetap memiliki alasan dan banding. Penghapusan akun undangan karena dugaan tidak organik harus didahului bukti/audit dan tidak boleh hanya berdasarkan keputusan otomatis yang tidak dapat ditinjau.

## 7. Database hemat biaya

- Tambahkan tabel versi dokumen/persetujuan dan permintaan hak data dengan RLS, GRANT hanya `service_role`, serta indeks pada user, status, dan jatuh tempo.
- Tambahkan RPC untuk: memeriksa/mencatat persetujuan, meminta/membatalkan/menyelesaikan penghapusan, membuat ekspor, menjalankan retensi, serta memproses transaksi idempoten.
- Hindari duplikasi nama/username pada tabel blokir baru; simpan hanya data yang diperlukan untuk fungsi dan audit.
- Jalankan retensi secara batch dengan batas baris agar tidak memicu lonjakan beban sekitar jadwal malam. Catat hanya jumlah baris yang dibersihkan, bukan isi datanya.
- Tidak ada heartbeat, polling database, atau penulisan log untuk setiap pesan normal.

## 8. Kesiapan operasional di luar kode

- Verifikasi dan selesaikan pendaftaran PSE Lingkup Privat serta legalitas usaha yang relevan melalui jalur resmi.
- Minta advokat Indonesia meninjau dokumen, alur anonymous chat, penghapusan data, konten terlarang, penanganan laporan, referral, denda, dan pembatasan tanggung jawab.
- Pastikan model pembayaran tidak membuat FizaTalk bertindak sebagai penyedia jasa pembayaran tanpa izin; gunakan penyedia resmi dan jangan menampung dana pihak lain.
- Tetapkan petugas/kontak privasi, prosedur permintaan aparat, prosedur konten anak, register insiden, serta pemberitahuan insiden data sesuai tenggat hukum yang berlaku.
- Siapkan kanal pengaduan aktif dan target waktu respons; simpan jejak keputusan admin yang minimum tetapi dapat diaudit.
- Lakukan penilaian dampak perlindungan data sebelum peluncuran ulang karena pencocokan anonim, preferensi gender/lokasi, moderasi, dan pembayaran memiliki risiko tinggi.

## Tahapan implementasi

1. **Penguncian risiko langsung:** secret webhook, deduplikasi update, gate 18+/Indonesia/persetujuan, command hukum, dan pembatasan media berisiko.
2. **Hak pengguna dan retensi:** `/datasaya`, `/hapusakun`, RPC atomik, masa tunggu, job pembersihan WIB, redaksi log, dan consent publikasi cashout.
3. **Moderasi aman:** kategori kritis, pembekuan, banding, blokir pasangan, audit admin, dan pemisahan denda dari pelanggaran serius.
4. **Transaksi:** disclosure sebelum bayar, tanda terima, kebijakan sengketa/refund, serta RPC pembayaran idempoten.
5. **Hardening:** hapus SQL bridge bebas, endpoint tidak terpakai, audit akses, uji retry/concurrency, dan pemindaian keamanan.
6. **Peluncuran terkendali:** paksa persetujuan semua pengguna lama, uji dua akun dan callback ganda, verifikasi cron/retensi, lalu aktifkan bertahap setelah dokumen dan langkah operasional disetujui penasihat hukum.

## Verifikasi penerimaan

- Pengguna baru/lama tidak dapat memakai fitur sebelum menyatakan 18+, Indonesia, dan menyetujui versi dokumen aktif.
- Update webhook tanpa secret benar ditolak dan tidak menulis data.
- Percobaan callback/payment/update berulang tidak menggandakan hasil.
- Media berisiko tidak diteruskan sebelum pemeriksaan yang disetujui tersedia.
- Pengguna dapat melihat data dan meminta penghapusan otomatis; pembatalan, pengecualian retensi sah, serta penghapusan akhir bekerja atomik.
- Log, draft, laporan, dan bukti kedaluwarsa dibersihkan sesuai jadwal WIB tanpa lonjakan beban.
- Laporan kritis menghentikan chat dan tidak dapat dipulihkan dengan pembayaran/Premium.
- Harga, manfaat, biaya, masa berlaku, refund/sengketa, dan kontak pengaduan terlihat sebelum pembayaran.
- Tidak ada data cashout pengguna yang dipublikasikan tanpa persetujuan khusus.
- Seluruh jalur utama—start, search, next, stop, report, block, Premium, top-up, denda, referral, admin, edited message, dan retry Telegram—lulus pengujian regresi.