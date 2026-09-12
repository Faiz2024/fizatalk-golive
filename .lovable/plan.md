# Dua Alasan Penolakan Penarikan Bonus Referral

## Perubahan di bot admin

Saat admin menekan **❌ Tolak**, bot tidak langsung menolak. Pesan yang sama menampilkan dua pilihan:

1. **✏️ Salah Input Data**
   - Permintaan ditandai ditolak.
   - Pengguna menerima pesan seperti sekarang: data penerima tidak valid dan dapat mengajukan ulang dengan data yang benar.
   - Akun serta hasil referral pengguna tidak diubah.

2. **🚫 Teman Tidak Valid/Tidak Organik**
   - Permintaan ditandai ditolak karena referral tidak organik.
   - Pengguna yang mengajukan penarikan diblokir permanen dari bot.
   - Semua akun yang terdaftar sebagai hasil undangan langsung pengguna tersebut dihapus sepenuhnya dari `telegram_users`, sesuai pilihan Anda.
   - Pesan admin diperbarui dengan alasan penolakan, jumlah akun yang dihapus, admin pemroses, dan waktu WIB; sematan kemudian dilepas.

Tombol **Kembali** mengembalikan pesan ke tombol **Sudah Dikirim / Tolak** tanpa mengubah data.

## Keamanan dan konsistensi data

- Aksi “tidak organik” dijalankan melalui satu RPC atomik agar blokir, penolakan, dan penghapusan berhasil seluruhnya atau dibatalkan seluruhnya jika ada kegagalan.
- RPC mengunci permintaan dan pengguna untuk mencegah klik ganda atau bentrok dengan proses pembayaran/referral lain.
- Sebelum akun undangan dihapus, relasi chat aktif dan antrean mereka dibereskan agar partner tidak tertinggal dalam status chatting.
- Data yang merujuk akun undangan dibersihkan secara terkontrol, termasuk referral mereka, transaksi/permintaan terkait, laporan, klik re-engagement, dan referensi `approved_by` yang dapat menghalangi penghapusan.
- Hubungan referral turunan dari akun yang dihapus dibatalkan tanpa ikut menghapus akun generasi berikutnya; hanya akun undangan langsung milik pelaku yang dihapus.
- Catatan `blocked_users` untuk pelaku disimpan dengan alasan khusus `referral_fraud_non_organic`, sehingga blokir tetap dapat dikenali bot dan diaudit.
- Catatan penarikan pelaku tetap disimpan sebagai bukti, dengan status ditolak dan alasan penolakan pada `admin_notes`.
- RPC mengembalikan ringkasan jumlah akun dan data yang dibersihkan dalam satu respons, tanpa pembacaan berulang dari fungsi bot.

## Detail teknis

### Database

- Perluas pemrosesan penarikan dengan alasan `invalid_input` dan `non_organic`.
- Tambahkan RPC `reject_referral_cashout(p_request_id, p_reason, p_admin_id)` sebagai `SECURITY DEFINER` dengan validasi alasan, advisory lock, dan transaksi atomik.
- Untuk `invalid_input`, hanya ubah status permintaan serta simpan alasan.
- Untuk `non_organic`:
  - ambil dan kunci pemilik permintaan;
  - masukkan/aktifkan blokir permanen;
  - lepaskan chat aktif pelaku dan akun undangan;
  - kumpulkan akun undangan langsung dari `referrals.referrer_id` dan `telegram_users.referred_by`;
  - bersihkan referensi yang tidak memiliki cascade atau foreign key;
  - hapus akun undangan dari `telegram_users`;
  - nolkan hitungan referral pelaku agar tidak dapat dipakai kembali;
  - tandai permintaan sebagai ditolak dengan alasan audit.
- Pertahankan GRANT hanya untuk `service_role`; tidak ada akses publik baru.
- Semua waktu audit menggunakan WIB.

### Fungsi bot Telegram

- Tombol Tolak membuka submenu alasan memakai `editMessageText`.
- Tambahkan callback alasan dengan ID permintaan, tetap dibatasi hanya untuk chat admin yang terdaftar.
- Panggil satu RPC untuk setiap keputusan admin.
- Tampilkan hasil ringkas ke admin dan kirim notifikasi yang sesuai kepada pengguna.
- Bila akun undangan sedang memiliki partner aktif, kirim pemberitahuan singkat kepada partner yang terdampak setelah RPC sukses.
- Callback dijaga dari klik ganda; kegagalan database mengembalikan HTTP 500 agar webhook Telegram mencoba ulang.

## Verifikasi

- **Salah input:** status menjadi ditolak, pengguna dapat mengajukan ulang, tidak ada akun/referral terhapus.
- **Tidak organik:** pelaku masuk daftar blokir aktif, semua akun undangan langsung hilang dari `telegram_users`, dan tidak ada relasi yatim atau partner tersangkut.
- Akun generasi berikutnya tidak ikut terhapus, tetapi hubungan ke akun yang sudah dihapus dibersihkan.
- Klik alasan dua kali tidak menjalankan penghapusan ulang.
- Tombol Kembali tidak mengubah status.
- Pesan admin menampilkan alasan dan jumlah akun terhapus, sematan terlepas, dan seluruh cap waktu tampil dalam WIB.
