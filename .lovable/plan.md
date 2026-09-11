# Dashboard Masih Gagal: Penyebab Sebenarnya Ada di Beban Database

## Apa yang saya ukur barusan

- Memuat data dashboard: gagal lagi, HTTP 500 "statement timeout", baik dengan
  maupun tanpa hitung ulang paksa (±57–59 detik).
- Menghitung dua angka sederhana dari tabel pengguna butuh **34 detik**, padahal
  seluruh datanya (±70 MB) sudah berada di memori. Artinya bukan indeks yang
  kurang — mesin databasenya yang kehabisan tenaga.
- Ukuran mesin saat ini: **Mini**. Memori terpakai 81%.
- Beban terbesar yang sedang menekan mesin:
  - Pengecekan pengguna untuk pesan re-engagement: 674 panggilan, rata-rata
    686 ms, puncak 7,7 detik per panggilan (jalan tiap 5 menit).
  - Bot melakukan ±1,6 juta + 560 ribu + 346 ribu pembacaan kecil ke tabel
    pengguna — masing-masing cepat, tapi jumlahnya menghabiskan CPU.

Jadi perbaikan sebelumnya (indeks + cache) benar arahnya, tapi tidak cukup:
selama CPU habis, hitungan apa pun ikut melambat sampai kena batas waktu.

## Rencana perbaikan

### 1. Naikkan ukuran mesin database (langkah pertama, langsung terasa)

Naik dari Mini ke ukuran berikutnya. Ini menghentikan pembatasan CPU yang
membuat semuanya melambat, termasuk bot yang kadang berhenti merespons.
Biaya bulanan naik — saya minta persetujuan sebelum menerapkannya.

### 2. Dashboard tidak lagi menghitung saat halaman dibuka

- Halaman hanya membaca hasil yang sudah tersimpan, jadi selalu tampil cepat
  dan tidak pernah kena batas waktu.
- Hitungan dilakukan otomatis di latar belakang setiap 15 menit lewat penjadwal.
- Tombol "Segarkan Data" memicu hitung ulang latar belakang, lalu halaman
  menampilkan hasilnya begitu siap, dengan keterangan "diperbarui pukul ... WIB".

### 3. Ringankan pengecekan re-engagement

Query pencarian pengguna untuk pesan re-engagement dirapikan dan dibatasi agar
tidak memindai seluruh tabel tiap 5 menit, plus indeks pendukung sesuai
kondisi yang dipakai view-nya.

### 4. Kurangi pembacaan kecil dari bot

Beberapa titik di bot membaca kolom pengguna dua–tiga kali dalam satu kejadian.
Digabung jadi satu pembacaan per kejadian, sehingga jutaan panggilan berkurang
signifikan dan biaya cloud ikut turun.

## Detail teknis

- `get_admin_dashboard_stats`: pisah jadi `refresh_admin_dashboard_stats()`
  (menulis cache ke `bot_settings`) dan pembacaan cache murni untuk edge
  function; tambahkan `cached_at` di payload.
- Jadwalkan `refresh_admin_dashboard_stats()` via `pg_cron` tiap 15 menit.
- `admin-stats`: hanya membaca cache; `force` memicu refresh async, bukan
  menunggu hitungan selesai. `get_referral_stats` ikut masuk cache yang sama.
- `v_eligible_reengagement_users`: periksa definisinya, ganti filter berbasis
  ekspresi waktu dengan perbandingan rentang, tambahkan indeks parsial yang
  cocok, dan pastikan pemanggilnya memakai `LIMIT` kecil.
- `src/pages/Dashboard.tsx`: tampilkan waktu data terakhir dihitung; tombol
  segarkan memakai polling singkat.
- Resize compute lewat tool Cloud setelah Anda setuju.

## Verifikasi

- Muat dashboard: HTTP 200 di bawah 1 detik, semua kartu terisi.
- Ulangi pengukuran "hitung dua angka" tadi: harus turun dari 34 detik ke
  hitungan milidetik.
- Pantau bot beberapa jam, terutama sekitar pukul 02.00 WIB, memastikan tidak
  ada lagi jeda berhenti merespons.
