

User menanyakan: kenapa angka di chart untuk hari-hari yang lalu (history) kadang berubah, padahal data historis seharusnya tetap.

## Analisis Penyebab

Saya sudah review RPC `get_admin_dashboard_stats` dan struktur tabel `telegram_users`. Ada **3 alasan teknis** kenapa angka chart untuk hari kemarin/lusa terus berubah setiap kali user refresh:

### 1. `aktif` per hari dihitung dari kolom `last_active` yang TERUS DI-UPDATE

Logika RPC saat ini:
```sql
(SELECT COUNT(*) FROM telegram_users
  WHERE (last_active AT TIME ZONE 'Asia/Jakarta')::DATE = db.day_wib) AS aktif
```

`last_active` adalah **kolom yang di-overwrite** setiap kali user beraktivitas (lihat `update_last_active_daily` & `comprehensive_search_action`). Akibatnya:

- Angka "Aktif Senin" hari ini = jumlah user yang `last_active`-nya **masih** jatuh di hari Senin.
- Begitu salah satu user yang aktif Senin kembali aktif Selasa/Rabu, `last_active`-nya pindah → user itu **hilang dari count Senin**.
- Setiap detik berlalu, count "aktif Senin" hanya bisa **turun**, tidak pernah naik. Inilah yang user lihat sebagai "data berubah".

Hal yang sama berlaku untuk:
- `churn` (pakai `last_active` dengan offset 30 hari) → ikut turun seiring waktu.
- Tidak berlaku untuk `baru` & `baru30hariLalu` karena pakai `created_at` yang immutable.

### 2. User yang dihapus akan menghilang juga dari history

Function `cleanup_inactive_users()` menghapus user `state = 'idle'` yang `last_active < NOW() - 24 jam`. Setiap user yang dihapus akan **mengurangi count historis** untuk semua tanggal di mana mereka pernah `created_at` atau `last_active`. Jadi `baru` & `baru30hariLalu` pun bisa turun jika user lama dibersihkan.

### 3. Tidak ada snapshot harian

Sistem tidak menyimpan snapshot agregat per hari. Setiap kali dashboard dibuka, RPC menghitung ulang dari data live. Jadi "history" sebenarnya bukan history, melainkan **proyeksi data sekarang ke tanggal lampau** berdasarkan kolom yang mutable.

## Rekomendasi Solusi (pilih satu)

**Opsi A — Snapshot harian (paling akurat, sesuai prinsip "history harus tetap")**
- Buat tabel `daily_user_stats` (date PK, baru, aktif, churn, baru30hariLalu, inactive30, snapshotted_at).
- Buat RPC `snapshot_daily_stats()` yang dijalankan **sekali per hari setelah jam 00:00 WIB** via pg_cron — menulis baris untuk **kemarin** (hari yang sudah selesai).
- Ubah `get_admin_dashboard_stats` agar:
  - Untuk 6 hari sebelumnya → ambil dari `daily_user_stats` (immutable).
  - Untuk hari ini (yang masih berjalan) → tetap hitung live dari `telegram_users`.
- Hasil: angka 6 hari kemarin **tidak akan berubah lagi**. Hanya titik "hari ini" yang terus update sampai jam 00:00 WIB lalu di-snapshot.
- Hemat biaya cloud: cron 1x/hari + 6 row read vs 6×4 COUNT subquery setiap kali dashboard dibuka.

**Opsi B — Tambah kolom event-log (lebih berat)**
- Catat tiap `last_active` baru di tabel `user_activity_log (user_id, active_date)` dengan UNIQUE per (user_id, active_date).
- Hitung `aktif` per hari dari log ini → tidak terpengaruh `last_active` yang berubah.
- Lebih berat & memakan storage karena setiap user × setiap hari aktif = 1 row.
- Tidak direkomendasikan untuk bot dengan volume tinggi.

**Opsi C — Klarifikasi label saja, tanpa ubah logika**
- Tambahkan tooltip/footer kecil di chart: "Data hari lampau dihitung dari last_active terkini, dapat berubah".
- Murah & cepat tapi tidak menyelesaikan masalah inti.

### Rekomendasi: **Opsi A**

Sesuai prinsip user (history harus tetap) dan custom instruction (hemat cloud, gunakan RPC). Implementasi:

1. **Migration baru**: 
   - `CREATE TABLE public.daily_user_stats` dengan PK `date`.
   - `CREATE FUNCTION public.snapshot_daily_stats()` — `INSERT ... ON CONFLICT (date) DO NOTHING` agar idempotent dan tidak menimpa snapshot yang sudah ada.
   - Backfill: isi `daily_user_stats` untuk 7 hari terakhir dengan angka **saat ini** (admit: 6 hari sebelumnya tetap pakai data live awal, tapi dari sekarang akan di-freeze).
   - Schedule pg_cron: jalan setiap hari jam 00:05 WIB → snapshot tanggal kemarin.
   - `CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()` — gabungkan snapshot (hari -6 s/d -1) + live (hari ini).

2. **Tidak ada perubahan di edge function `admin-stats`** (sudah tipis).
3. **Tidak ada perubahan di `Dashboard.tsx`** (shape data sama).

### File yang Diubah

- `supabase/migrations/<new>.sql` — tabel snapshot, function snapshot, cron job, modifikasi RPC dashboard.

### Yang TIDAK Berubah

- KPI cards (tetap live untuk "hari ini").
- Edge function & frontend.
- Logika WIB.

