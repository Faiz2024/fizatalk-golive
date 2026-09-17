# Bot Voice Call Terpisah dan Integrasi `/call`

## Hasil akhir

Membuat ekosistem voice call yang terpisah dari FizaTalk lama:

```text
Bot FizaTalk lama                      Proyek Voice Call baru
/chat partner aktif                   Bot Telegram baru
        |                              Database baru
        +-- /call --> undangan ------> Mini App panggilan suara
                                       Antrean voice terpisah
                                       Premium terpisah
```

Panggilan berlangsung sebagai audio WebRTC di Mini App yang dibuka dari Telegram, bukan panggilan suara native Telegram. Koneksi memakai P2P sebagai jalur utama dan TURN hanya ketika koneksi langsung gagal.

## 1. Proyek, bot, dan database baru

- Buat proyek Lovable Cloud baru khusus voice call, tanpa berbagi tabel atau kredensial dengan proyek lama.
- Hubungkan bot Telegram baru menggunakan token bot baru dan webhook dengan secret token Telegram.
- Buat Mini App audio untuk ruang tunggu, izin mikrofon, status koneksi, durasi, mute, keluar, lapor, dan blokir.
- Semua waktu aplikasi, audit, masa berlaku, dan tampilan menggunakan `Asia/Jakarta` (WIB).
- Siapkan konfigurasi TURN melalui secret; kredensial TURN bersifat singkat dan diterbitkan server hanya saat dibutuhkan.

## 2. Identitas dan pendaftaran

- Identitas utama adalah Telegram user ID yang diverifikasi dari data autentik Mini App; klien tidak boleh mengaku sebagai user ID lain.
- Pengguna baru wajib menyatakan usia 18+, berada di Indonesia, serta menyetujui Ketentuan dan Kebijakan Privasi versi aktif sebelum masuk antrean atau panggilan.
- Profil voice menyimpan data minimum: Telegram ID, nama tampilan minimum, gender, lokasi pilihan, status Premium voice, status moderasi, dan waktu WIB.
- Status Premium bot lama tidak disalin. Pembelian, masa aktif, dan manfaat Premium voice dikelola hanya di proyek baru.

## 3. Antrean voice terpisah

- Pengguna gratis dapat mencari partner acak tanpa filter gender/lokasi.
- Pengguna Premium voice dapat memilih filter gender dan/atau lokasi seperti bot lama.
- Satu RPC atomik menangani masuk antrean, keluar antrean, pencarian, pencocokan, timeout, anti-double-click, blokir, anti-repeat, dan pembatasan satu sesi aktif per pengguna.
- Kehadiran memakai masa berlaku singkat, bukan heartbeat database yang sering; pembaruan hanya saat ada perubahan penting.
- Jika belum mendapat pasangan, bot memperbarui pesan pencarian yang sama agar chat tidak dipenuhi pesan baru.

## 4. Undangan `/call` dari bot lama

- Tambahkan `/call` pada bot lama hanya ketika pengguna sedang memiliki partner chat aktif.
- Bot lama meminta persetujuan partner melalui tombol **Terima** dan **Tolak**; command dan callback tidak pernah diteruskan sebagai isi chat biasa.
- Saat diterima, server lama membuat satu token undangan acak, sekali pakai, berumur singkat, dan terikat pada kedua Telegram user ID.
- Kedua pengguna menerima tombol **Gabung Panggilan** yang membuka bot baru melalui deep-link unik.
- Bot baru memvalidasi token melalui pertukaran antarfungsi yang ditandatangani. Data database lama tidak disalin dan database baru tidak diberi akses umum ke database lama.
- Token kedaluwarsa setelah dipakai, ditolak, partner chat berubah/berakhir, atau batas waktunya habis. Menekan tautan orang lain tidak dapat masuk ke ruang tersebut.
- Undangan dari bot lama tidak mensyaratkan Premium voice; Premium hanya mengatur filter pada antrean terpisah.

## 5. Sesi panggilan WebRTC

- Signaling menawarkan jawaban WebRTC dan kandidat ICE hanya kepada dua anggota sesi yang tervalidasi.
- Gunakan audio-only Opus dengan bitrate adaptif; tidak ada video, rekaman, transkripsi, atau penyimpanan isi suara.
- Coba P2P terlebih dahulu. Jika gagal, gunakan TURN relay sebagai cadangan dan catat hanya metrik teknis minimum tanpa isi audio.
- Mini App menampilkan status menghubungkan, tersambung, mencoba relay, koneksi terputus, dan berakhir.
- Tangani pengguna menolak mikrofon, berpindah jaringan, menutup Mini App, putus sepihak, membuka beberapa tab, serta mencoba bergabung ulang.
- Sesi dan kredensial signaling memiliki TTL; proses pembersihan batch menutup sesi yatim secara otomatis.

## 6. Moderasi dan keselamatan

- Tombol lapor/blokir dapat mengakhiri panggilan seketika dan mencegah pencocokan ulang.
- Laporan memiliki kategori terpisah, termasuk seksual tanpa persetujuan, dugaan melibatkan anak, ancaman, pemerasan/penipuan, penyebaran data pribadi, spam, dan lainnya.
- Laporan kritis membekukan akses voice untuk pemeriksaan; Premium tidak mengecualikan pengguna dari moderasi.
- Karena tidak ada rekaman, jelaskan bahwa pemeriksaan laporan mengandalkan metadata minimum dan keterangan pelapor; jangan menjanjikan pembuktian isi percakapan.
- Batasi spam undangan `/call`, percobaan bergabung, dan pergantian antrean melalui RPC serta rate limit server.

## 7. Premium voice dan pembayaran

- Buat produk Premium terpisah untuk membuka filter gender/lokasi; pengguna gratis tetap dapat menelepon tanpa filter.
- Gunakan Telegram Stars dan QRIS manual sesuai standar proyek, dengan transaksi idempoten dan audit WIB.
- Status Premium selalu diverifikasi di server/database, bukan dari tombol, payload deep-link, atau penyimpanan perangkat.
- Tampilkan harga, durasi, manfaat, dan aturan refund sebelum pembayaran; callback ganda tidak boleh menggandakan masa Premium.

## 8. Database dan keamanan teknis

- Buat tabel minimum untuk profil voice, persetujuan, antrean, sesi, anggota sesi, token undangan, blokir, laporan, Premium, transaksi, dan audit teknis.
- Setiap tabel publik mendapat GRANT yang tepat, RLS aktif, dan akses pengguna dibatasi pada datanya sendiri; fungsi bot memakai service role.
- Gunakan RPC `SECURITY DEFINER` yang sempit dan tervalidasi untuk matchmaking, penerimaan undangan, pembuatan/penutupan sesi, laporan/blokir, dan pembayaran.
- Tidak membuat SQL bridge atau endpoint SQL dinamis pada proyek baru.
- Deduplikasi Telegram `update_id`, validasi seluruh callback/deep-link, advisory lock untuk tindakan bersamaan, dan respons HTTP 500 pada kegagalan database agar webhook dapat dicoba ulang.
- Log tidak menyimpan token, payload Telegram mentah, SDP penuh, kandidat ICE, alamat IP, atau isi audio.

## 9. Penghematan biaya cloud dan TURN

- P2P menjadi jalur utama sehingga mayoritas menit panggilan tidak melewati server media.
- TURN hanya cadangan; tidak ada SFU, mixer, rekaman, transkripsi, atau polling database per detik.
- Gunakan TTL, indeks antrean/sesi aktif, RPC gabungan, perubahan pesan Telegram, serta housekeeping batch harian WIB.
- Catat durasi dan byte relay secara agregat untuk memantau biaya, lalu tetapkan plafon bulanan dan peringatan sebelum batas tercapai.
- Sediakan adapter konfigurasi TURN agar penyedia dapat diganti tanpa mengubah alur bot dan database.

## 10. Implementasi bertahap

1. Buat proyek/database baru, skema dasar, RPC, RLS, webhook, dan bot Telegram baru.
2. Bangun Mini App audio dan signaling dengan validasi Telegram serta P2P/TURN fallback.
3. Bangun antrean acak gratis dan filter Premium gender/lokasi.
4. Tambahkan Premium voice dan transaksi terpisah.
5. Tambahkan `/call`, Terima/Tolak, dan token lintas proyek pada bot lama.
6. Tambahkan blokir, laporan, retensi, penghapusan akun, serta kontrol biaya.
7. Uji dengan dua akun Telegram pada jaringan berbeda sebelum peluncuran bertahap.

## Verifikasi penerimaan

- Data, transaksi, Premium, antrean, dan sesi voice tidak masuk ke database bot lama.
- `/call` hanya bekerja saat partner chat aktif; Terima/Tolak dan tautan kedaluwarsa bekerja tanpa kebocoran sesi.
- Antrean voice baru dapat dipakai gratis tanpa filter; filter gender/lokasi hanya aktif untuk Premium voice.
- Dua pengguna dapat tersambung P2P, beralih ke TURN saat P2P gagal, mute, keluar, melapor, dan memblokir.
- Tidak ada audio yang direkam atau disimpan, dan log tidak mengekspos data koneksi sensitif.
- Retry webhook, double-click, dua tab, callback ganda, reconnect, serta sesi yatim tidak membuat pasangan atau transaksi ganda.
- Penggunaan relay dan biaya dapat dipantau serta dibatasi tanpa mematikan fungsi bot chat lama.

## Kebutuhan sebelum aktivasi produksi

- Token bot Telegram baru dan username bot baru.
- Username Mini App serta domain proyek voice yang diizinkan melalui BotFather.
- Kredensial penyedia TURN yang dipilih.
- Nama produk, harga, dan durasi Premium voice.
- Dokumen Ketentuan, Privasi, serta identitas/kontak operator yang telah diperiksa untuk layanan Indonesia 18+.
