# Penyesuaian sanksi per jenis laporan

## Aturan yang diterapkan
- Penipuan/doxxing: 2 pelapor berbeda dalam 12 jam → langsung blokir 14 hari bisa tebus.
- Spam/promosi: 3 pelapor berbeda dalam 12 jam → langsung blokir 14 hari bisa tebus.
- Pelecehan/konten seksual: 3 pelapor berbeda dalam 12 jam → kunci pada pelanggaran pertama dan kedua; blokir 14 hari bisa tebus pada ketiga; blokir 14 hari tanpa tebus pada keempat dan berikutnya.
- Pengulangan kategori blokir langsung setelah pemulihan meningkat ke blokir 14 hari tanpa tebus.
- Lonjakan 30 menit dan akumulasi lintas kategori tetap memakai jalur bertahap, kecuali ambang kategori blokir langsung juga tercapai.
- Danger tetap memerlukan bukti aman dan peninjauan admin; tidak ada sanksi otomatis.

## Teknis
- Ganti RPC pelaporan atomik melalui migrasi tambahan; tidak menambah pembacaan atau penulisan database per laporan.
- Pertahankan deduplikasi, pelapor unik, zona wib, kartu admin, dan perlakuan sama untuk Premium.
- Perbarui konfigurasi ambang bot serta tes untuk setiap ambang dan tahapan.
- Jalankan regresi Deno, simulasi database dengan akun sementara lalu bersihkan data uji, deploy webhook, dan periksa hasil build.
- Verifikasi klik nyata di Telegram tetap memerlukan interaksi akun Telegram.
