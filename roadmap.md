# Roadmap

## Migrasi Pakasir API v2
- [x] Verifikasi kontrak API v2 dan kebutuhan kredensial.
- [x] Migrasikan pembuatan tagihan dan verifikasi callback tanpa mengubah aturan produk.
- [x] Jalankan pengujian kontrak API dan deploy.
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
