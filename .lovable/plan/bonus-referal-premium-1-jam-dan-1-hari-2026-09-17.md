# Bonus Referal Premium 1 Jam dan 1 Hari

## Hasil yang dibangun

1. Aturan hadiah Premium berubah menjadi:
   - **3 teman sah → 1 jam Premium**
   - **10 teman sah → 1 hari Premium**
2. Pengguna memilih salah satu hadiah. Teman sah yang sudah dipakai untuk satu hadiah tidak dapat dipakai lagi untuk hadiah lainnya.
3. Teman sah lama yang belum pernah ditukar tetap dihitung sebagai saldo progres setelah aturan baru aktif.
4. Bonus saldo e-wallet untuk 100 teman sah tetap memakai total teman sah sepanjang waktu dan tidak terpengaruh penukaran Premium.

## Alur di bot

- Tombol penawaran diubah agar menyebut dua pilihan bonus referal.
- Menu referal menampilkan:
  - jumlah teman sah yang belum ditukar;
  - progres menuju 3 teman untuk 1 jam;
  - progres menuju 10 teman untuk 1 hari;
  - total teman sah sepanjang waktu;
  - riwayat hadiah Premium dalam satuan hari dan jam.
- Tambahkan dua tombol klaim:
  - **Klaim 1 Jam Premium** — aktif bila saldo minimal 3 teman sah;
  - **Klaim 1 Hari Premium** — aktif bila saldo minimal 10 teman sah.
- Jika saldo belum cukup, bot menampilkan jumlah teman tambahan yang dibutuhkan untuk hadiah yang dipilih.
- Setelah berhasil, pesan yang sama diperbarui dan masa Premium terbaru ditampilkan dalam waktu WIB.

## Detail teknis

### Database

- Perbarui `get_referral_status` agar sekali baca mengembalikan progres dan kelayakan kedua hadiah dari kumpulan referal sah yang `consumed_at IS NULL`.
- Perbarui `claim_referral_reward` dengan parameter jenis hadiah (`hour` atau `day`):
  - validasi jenis hadiah;
  - pertahankan advisory lock dan row lock untuk mencegah klaim ganda;
  - konsumsi 3 referal tertua untuk 1 jam atau 10 referal tertua untuk 1 hari;
  - tambahkan `interval '1 hour'` atau `interval '1 day'` ke `premium_until` secara atomik.
- Tambahkan catatan klaim referal yang menyimpan jenis hadiah, jumlah teman yang dipakai, dan waktu klaim. Tabel hanya dapat diakses `service_role`, dilengkapi GRANT, RLS, dan kebijakan yang sesuai.
- Pertahankan `referral_rewards_claimed` sebagai riwayat hadiah harian lama agar data pengguna yang sudah pernah klaim tidak hilang; status baru memisahkan riwayat lama dan klaim baru.
- Perbarui statistik referal agar klaim baru 1 jam dan 1 hari tercatat akurat, tanpa lagi mengasumsikan setiap tiga baris yang dikonsumsi selalu berarti satu hari.
- Semua perubahan dilakukan dalam satu migrasi, semua waktu mengikuti WIB untuk tampilan/agregasi harian.

### Bot Telegram

- Ubah teks menu, tombol penawaran, tombol klaim, callback, dan notifikasi sukses/gagal.
- Gunakan callback terpisah untuk klaim 1 jam dan 1 hari, tetapi tetap memanggil satu RPC atomik agar hemat biaya cloud.
- Pertahankan debounce callback dan pola `answerCallbackQuery` yang sudah digunakan.
- Tidak ada perubahan website selain data statistik referal tetap kompatibel dengan format yang sudah dipakai dashboard.

## Perlakuan data lama

- Semua referal lama yang sudah sah tetapi belum memiliki `consumed_at` langsung menjadi saldo bersama pada aturan baru.
- Referal lama yang sudah diklaim tetap dianggap selesai dan tidak dapat digunakan kembali.
- Masa Premium serta jumlah klaim harian lama tetap dipertahankan.

## Verifikasi

- Saldo 2 teman: kedua klaim ditolak dengan kebutuhan yang benar.
- Saldo 3 teman: klaim 1 jam berhasil, klaim 1 hari ditolak.
- Saldo 10 teman: pengguna dapat memilih 1 hari atau 1 jam; hanya pilihan yang ditekan yang mengonsumsi saldo.
- Setelah klaim 1 jam dari saldo 10, tersisa 7; referal yang sama tidak dapat dipakai ulang.
- Klik ganda hanya menghasilkan satu hadiah.
- Penambahan Premium memperpanjang masa aktif yang masih berjalan atau dimulai dari waktu sekarang bila sudah berakhir.
- Progres bonus e-wallet 100 teman tidak berkurang setelah klaim Premium.
- Deploy ulang bot dan pasang ulang webhook setelah migrasi berhasil.
