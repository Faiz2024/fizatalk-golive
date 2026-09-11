# Perbaikan Dashboard Web yang Gagal Mengambil Data

## Apa yang terjadi

Saya menguji langsung sumber data dashboard: permintaannya gagal dengan pesan
"canceling statement due to statement timeout" — jadi bukan salah tampilan web,
melainkan perhitungan statistik di database yang terlalu lama dan dihentikan paksa.

Penyebab yang sudah terkonfirmasi:

- Tabel pengguna sekarang berisi ~151.000 baris dan berukuran ~206 MB.
- Perhitungan dashboard melakukan sekitar tujuh kali penelusuran seluruh tabel itu
  (pengguna baru hari ini, aktif hari ini, tidak aktif 30 hari, churn, pengguna
  30 hari lalu, promo terkirim, promo dibeli, promo eligible).
- Tabel itu tidak punya indeks pada kolom waktu `created_at` maupun `last_active`,
  sehingga setiap hitungan membaca seluruh 206 MB dari awal.

Total waktunya melewati batas waktu database, jadi dashboard selalu gagal memuat.

## Rencana perbaikan

### 1. Tambah indeks pada kolom waktu (satu migrasi)

Dibuat dengan `CREATE INDEX CONCURRENTLY` agar bot tetap jalan saat indeks dibangun:

- `telegram_users (created_at)`
- `telegram_users (last_active)`
- indeks parsial `telegram_users (special_promo_sent_at) WHERE special_promo_sent_at IS NOT NULL`
- indeks parsial `telegram_users (special_promo_purchased_at) WHERE special_promo_purchased_at IS NOT NULL`

Lalu `ANALYZE telegram_users` supaya perencana query memakai indeks baru.

### 2. Rapikan query di dalam fungsi statistik

- Ganti `(created_at AT TIME ZONE 'Asia/Jakarta')::DATE = tanggal` menjadi
  perbandingan rentang (`>= awal AND < akhir`) agar indeks terpakai.
- Gabungkan hitungan yang menyaring tabel yang sama menjadi satu query dengan
  `COUNT(*) FILTER (...)`, sehingga tabel dibaca jauh lebih sedikit.

### 3. Simpan hasil sebentar (cache 5 menit)

Hasil statistik disimpan di `bot_settings` dengan penanda waktu. Bila dashboard
dibuka lagi dalam 5 menit, data diambil dari simpanan itu tanpa menghitung ulang.
Tombol muat ulang tetap bisa memaksa hitung ulang. Ini menekan biaya cloud dan
membuat dashboard terasa instan.

### 4. Tampilan web lebih jelas saat gagal

Bila pengambilan data tetap gagal, dashboard menampilkan pesan singkat berbahasa
Indonesia beserta tombol "Coba lagi", bukan sekadar berputar tanpa akhir.

## Detail teknis

- Migrasi indeks harus dijalankan di luar blok transaksi (CONCURRENTLY).
- Perubahan pada `public.get_admin_dashboard_stats()`: gabungkan tujuh scan
  `telegram_users` menjadi satu-dua query beragregat `FILTER`, gunakan batas
  `TIMESTAMPTZ` WIB yang sudah dihitung di awal fungsi.
- Cache: key `admin_dashboard_stats_cache` + `admin_dashboard_stats_cached_at`
  di `bot_settings`; fungsi mengembalikan cache bila umurnya < 5 menit,
  parameter opsional `p_force boolean default false` untuk melewati cache.
- `supabase/functions/admin-stats/index.ts` tetap sama, hanya meneruskan hasil.
- `src/pages/Dashboard.tsx`: tambah state error + tombol coba lagi pada query
  `admin-stats`.

## Verifikasi

- Jalankan migrasi, lalu panggil ulang `admin-stats` dan pastikan status 200
  serta waktu respons di bawah 2 detik.
- Bandingkan beberapa angka KPI dengan query manual agar hasilnya sama persis.
- Buka dashboard di browser dan pastikan semua kartu dan grafik terisi.
