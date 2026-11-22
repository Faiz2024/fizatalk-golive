# Roadmap

## Runtime hybrid Railway + Supabase mandiri (22 Nov 2026)
- [x] Pisahkan handler HTTP dari titik masuk Supabase tanpa mengubah logika bot, pembayaran, call, atau re-engagement.
- [x] Siapkan satu server Railway, Dockerfile, health check, konfigurasi callback, dan panduan environment tanpa memindahkan webhook aktif.
- [x] Uji routing, autentikasi webhook, 86 regresi bot, dan server lokal dengan kredensial dummy; health 200, webhook palsu 403, path asing 404.
- [x] Deploy Railway di `fizatalk-golive-production.up.railway.app`; health 200, path asing 404, webhook palsu 403, dan autentikasi webhook sah 200.
- [ ] Sambungkan Lovable ke Supabase mandiri — menunggu koneksi proyek eksternal.
- [x] Jalankan delta awal 22 Nov 2026 pukul 19.32 WIB: 4.754 upsert dan 8 penghapusan; 22 tabel serta 254.540 baris tercakup terverifikasi identik dengan snapshot sumber.
- [ ] Jalankan sinkronisasi delta terakhir tepat sebelum cutover — menunggu jadwal cutover.
- [ ] Alihkan webhook dan verifikasi Telegram nyata — menunggu jadwal cutover dan delta final.

## Skrip migrasi ke Supabase mandiri (22 Nov 2026)
- [x] Buat satu DDL ringkas langsung dari katalog aktif dan validasi seluruh objek pada PostgreSQL terisolasi: 22 tabel, 274 kolom termasuk view, 60 constraint, 79 indeks, 85 fungsi, 18 policy, 7 trigger, dan 760 grant identik; impor serta pengaman eksekusi ulang lulus.
- [x] Bagi skema menjadi dua berkas di bawah batas SQL Editor dan validasi eksekusi berurutan tanpa mengubah database aktif.
- [x] Ekspor skema publik aktif: 22 tabel, 274 kolom, 85 RPC/fungsi, 79 indeks, 7 trigger, view, relasi, dan RLS.
- [x] Susun satu berkas SQL untuk proyek Supabase kosong dengan pengaman transaksi, WIB, pembatasan akses, dan petunjuk penggunaan.
- [x] Validasi impor PostgreSQL terisolasi, eksekusi ulang aman, checksum katalog, 85 fungsi identik, dan pemindaian kredensial tanpa mengubah database aktif.
- [x] Ekspor snapshot data inti per tabel tanpa mengubah database aktif; kecualikan riwayat laporan, log bot, dan klik re-engagement sesuai pilihan pengguna.
- [x] Siapkan impor transaksional dengan urutan relasi, pengaman target kosong, pemulihan sequence, dan validasi jumlah baris.
- [x] Uji ekspor-impor pada PostgreSQL terisolasi serta siapkan panduan sinkronisasi akhir sebelum webhook dipindahkan; 254.379 baris dan seluruh nilai 22 tabel terverifikasi identik.
- [x] Jalankan impor nyata pada Supabase mandiri: 254.379 baris dalam 22 tabel; jumlah dan sidik seluruh tabel identik dengan snapshot, 2.775 blokir aktif, sequence dan trigger moderasi terverifikasi.

## Pembersihan database hemat biaya (22 Nov 2026)
- [x] Audit satu kueri untuk indeks dan riwayat lama.
- [x] Hapus tiga indeks telegram_users yang tidak terpakai dan tumpang tindih; indeks re-engagement aktif tetap ada.
- [x] Hapus 653.520 laporan, 48.615 log, dan 89.487 klik berusia lebih dari 30 hari tanpa menyentuh pengguna atau sanksi aktif.
- [x] Verifikasi seluruh riwayat lama bersih dan ukuran database turun dari 866 MB menjadi 577 MB; tanpa VACUUM FULL.

## Pesan kunci dan pemulihan 99 Stars (22 Nov 2026)
- [x] Tambahkan `⚠️ Hindari pelanggaran berulang untuk mencegah pemblokiran akun.` tepat di atas instruksi “Tekan” pada tiga pesan kunci, tanpa mengubah teks lain.
- [x] Ganti seluruh keterangan dan tombol pemulihan Rp10.000 menjadi ⭐ 99 serta tetapkan invoice pemulihan 99 Stars.
- [x] Tolak pembayaran pemulihan dengan nominal atau pemilik payload yang tidak sesuai.
- [x] Tambahkan dan jalankan 81 tes aturan/regresi, deploy bot, dan pastikan 71 tes fungsi aktif lulus.
- [ ] Verifikasi tampilan dan pembayaran melalui Telegram nyata — menunggu interaksi akun Telegram.

## Penyesuaian dua laporan tautan (22 Nov 2026)
- [x] Ubah Grup Porno/VCS menjadi 2 pelapor berbeda langsung blokir 14 hari bisa tebus.
- [x] Ubah Penyebaran Data Pribadi menjadi 3 pelapor berbeda langsung blokir 14 hari bisa tebus.
- [x] Pertahankan rentang 12 jam dan aturan kategori lain; 76 regresi dan simulasi database lulus, bot aktif, data uji sudah dibersihkan.
- [ ] Verifikasi melalui Telegram nyata — menunggu interaksi akun Telegram.

## Penyesuaian sanksi per jenis laporan (22 Nov 2026)
- [x] Terapkan blokir langsung untuk fraud/doxxing (2 pelapor) dan spam/promosi (3 pelapor).
- [x] Terapkan dua kunci sebelum blokir untuk sexual/harassment dan eskalasi tanpa tebus pada pengulangan berikutnya.
- [x] Perbarui pesan, konfigurasi, dan tes tanpa membocorkan ambang kepada terlapor.
- [x] Validasi RPC dengan data sementara, jalankan 76 regresi, deploy bot, dan bersihkan data uji.
- [ ] Verifikasi melalui Telegram nyata — menunggu interaksi akun Telegram.

## Sanksi otomatis berdasarkan jenis dan frekuensi laporan (22 Nov 2026)
- [x] Hapus logika poin penalti dari aturan pelaporan aktif dan tandai sisa kolom lama sebagai tidak digunakan.
- [x] Terapkan ambang kritis 2, sedang 3, ringan 4, lonjakan 3 pelapor berbeda/30 menit, dan total 4 pelapor berbeda/12 jam melalui RPC atomik.
- [x] Tampilkan alasan pemicu sanksi pada kartu admin tanpa membocorkan ambang kepada terlapor.
- [x] Uji setiap kategori, pelapor berbeda, deduplikasi, tahap sanksi, dan 76 regresi bot; validasi database serta deploy berhasil dan data uji sudah dihapus.
- [ ] Verifikasi sanksi dan kartu melalui Telegram nyata — menunggu interaksi akun Telegram.

## Kartu laporan gabungan di chat admin (21 Nov 2026)
- [x] Tambahkan penyimpanan ringkas kartu admin per terlapor dan cuplikan bukti yang aman melalui RPC atomik.
- [x] Kirim/edit satu pesan admin per terlapor dengan hitungan, jenis laporan, cuplikan, dan tindakan admin.
- [x] Sematkan ulang saat ada pembaruan; Abaikan hanya melepas sematan tanpa mengubah pesan.
- [x] Uji aturan agregasi, deduplikasi, tindakan admin, dan regresi bot; lalu deploy.
- [ ] Verifikasi laporan dan klik admin melalui Telegram nyata — menunggu interaksi akun Telegram.

## Label Hemat dan navigasi Ganti Paket promo (18 Nov 2026)
- [x] Ubah label 35 hari menjadi (Hemat) miring dan pindahkan ⭐ ke kiri nominal paket.
- [x] Arahkan Ganti Paket pada konfirmasi promo kembali ke menu promo tanpa mereset masa berlaku satu jam.
- [x] Jalankan 62 tes regresi termasuk batas tepat satu jam; seluruhnya lulus.
- [x] Deploy telegram-webhook dan jalankan ulang tes pada fungsi aktif.
- [ ] Verifikasi tampilan dan klik melalui Telegram nyata — menunggu interaksi akun Telegram.

## Revisi harga dan label paket Premium (18 Nov 2026)
- [x] Samakan harga Stars pada tombol dan invoice untuk seluruh paket normal/promo yang direvisi.
- [x] Tambahkan coretan harga normal pada promo 30/7 hari, api hanya pada 35/7 hari, serta label miring Rekomendasi🔥 pada 35 hari.
- [x] Jalankan 59 tes regresi dan deploy bot.
- [ ] Verifikasi tampilan melalui Telegram nyata — menunggu interaksi akun Telegram.

## Pemusatan notifikasi admin ke @FizaTalkCS (18 Nov 2026)
- [x] Alihkan tujuan notifikasi pembayaran, review stiker, moderasi, verifikasi, dan notifikasi admin lainnya ke akun @FizaTalkCS (Telegram ID 7567529103).
- [x] Deploy ulang telegram-webhook, pakasir-callback, dan sakurupiah-callback; build OK.
- [ ] Verifikasi penerimaan notifikasi nyata berikutnya di akun @FizaTalkCS.

## Tombol Coba Wola pada pesan akhir chat (18 Nov 2026)
- [x] Tambahkan tombol hijau "🚀Coba Wola - Chat Bot!" ke @WolaChatBot di bawah Call Acak dan Cari Partner Baru pada pesan mengakhiri chat.
- [x] Tampilkan tombol yang sama di bawah baris penilaian partner pada pesan mencari partner baru saat Next.
- [ ] Deploy fungsi bot dan verifikasi tampilan tombol melalui Telegram nyata.

## Fallback pembayaran berurutan (17 Nov 2026)
- [ ] Alihkan DANA/GoPay gagal ke QRIS Sakurupiah pada transaksi yang sama.
- [ ] Pertahankan fallback berikutnya ke QRIS Pakasir lalu QRIS manual untuk Premium, top-up, dan pemulihan akun.
- [ ] Uji seluruh percabangan fallback, deploy bot, dan verifikasi transaksi nyata berikutnya.

## Tampilan foto partner (17 Nov 2026)
- [x] Batasi foto dan badge verifikasi berdasarkan mode kedua pengguna serta verifikasi partner, termasuk sambung ulang, tanpa query tambahan.
- [x] Jalankan 45 tes regresi (lulus) dan deploy aturan tampilan bot.
- [ ] Verifikasi tampilan melalui Telegram nyata — menunggu interaksi dua akun Telegram.

## Pelaporan kontekstual bot Telegram
- [x] Terapkan menu partner, link/username, dan media tanpa laporan diam/skip.
- [x] Terapkan kategori, bukti, peninjauan admin, dan sanksi setara Premium melalui RPC.
- [x] Lindungi penangguhan/permanen dari pembayaran pemulihan; uji aturan/RPC lalu deploy bot.
- [x] Ubah pesan setelah laporan partner biasa dipilih menjadi konfirmasi dengan tombol Cari Partner Baru.
- [ ] Verifikasi klik laporan → bukti → keputusan admin melalui Telegram nyata — menunggu interaksi akun Telegram pengguna/admin.

## Migrasi Pakasir API v2
- [x] Verifikasi kontrak API v2 dan kebutuhan kredensial.
- [x] Migrasikan pembuatan tagihan dan verifikasi callback tanpa mengubah aturan produk.
- [x] Jalankan pengujian kontrak API dan deploy.
- [x] Perbaiki pembacaan field kedaluwarsa respons v2 (`expires_at`, kompatibel `expired_at`) — penyebab tagihan Pakasir gagal dan jatuh ke QRIS manual. Deploy 18 Okt 2026.
- [ ] Verifikasi pembayaran nyata dari QR di Telegram hingga manfaat aktif — menunggu transaksi nyata pengguna; akses langsung dari sandbox mendapat HTTP 403 non-JSON.

- [x] Ubah bonus referal menjadi pilihan 3 teman untuk 1 jam atau 10 teman untuk 1 hari Premium.

- [x] Tambahkan RPC atomik untuk dua alasan penolakan cashout referral.
- [x] Tambahkan submenu alasan penolakan pada bot admin.
- [x] Terapkan blokir non-Premium dengan opsi denda/Premium dan pengecualian Premium.
- [x] Hapus akun undangan langsung beserta relasi terkait secara konsisten.
- [x] Terapkan migrasi, deploy fungsi bot, setup webhook, dan verifikasi.

## Bot Voice Call Terpisah

- [x] Tambahkan fondasi undangan `/call` atomik pada database bot lama.
- [x] Tambahkan alur Terima/Tolak dan tautan gabung bot voice baru.
- [x] Tambahkan endpoint pertukaran undangan yang ditandatangani untuk FizaVoice.
- [ ] Buat proyek Lovable Cloud dan database voice baru — menunggu proyek baru dibuat.
- [ ] Hubungkan bot Telegram voice baru — menunggu token dan username bot baru.
- [ ] Aktifkan Mini App WebRTC dan TURN cadangan — menunggu proyek baru dan kredensial TURN.

## Susunan paket Premium (2 Nov 2026)
- [x] Hapus 1 Hari dan 1 Tahun dari menu Premium normal; sisakan 1 Minggu Rp25.000, 1 Bulan Rp60.000, Ajak Teman.
- [x] Susun ulang promo 1 jam: 35 Hari Rp30.000, 30 Hari Rp28.000, 7 Hari Rp19.000, 3 Hari Rp12.000, 1 Hari Rp7.000, Abaikan; tanpa tombol referal dan tanpa 1 Tahun.
- [x] Pindahkan kontrak paket ke `_shared/premium-packages.ts`, uji susunan/tombol, lalu deploy telegram-webhook.

## Penghematan relay chat (16 Nov 2026)
- [x] Gabungkan pembacaan data pengguna dan validasi partner ke satu RPC `get_chat_envelope`.
- [x] Uji konteks idle, pasangan valid, pasangan terputus, dan regresi bot.
- [x] Deploy `telegram-webhook` dan verifikasi hasil aktif.

## Penonaktifan event log bot (16 Nov 2026)
- [x] Hapus seluruh pemanggilan `log_bot_event` dari fungsi bot tanpa mengubah alur utama atau respons error.
- [x] Jalankan 39 tes regresi, deploy empat fungsi terdampak, dan verifikasi tidak ada pemanggilan tersisa.
