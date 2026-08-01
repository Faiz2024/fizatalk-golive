# Diagnosis: Bot Sering Berhenti Merespon

## Temuan dari log & database (terverifikasi)

Bot tidak "crash" — database yang kehabisan nafas. Saat cek barusan:

- Log Edge Function `telegram-webhook` penuh dengan:
  `[CRITICAL] DB Error fetching user: canceling statement due to statement timeout`
  dan `upstream request timeout`.
- Log Postgres: ratusan `canceling statement due to statement timeout` beruntun.
- `pg_stat_activity` saat cek: query matchmaking (`comprehensive_search_action`) berjalan **45 detik**, menunggu lock `WALInsert`; autovacuum ANALYZE di `telegram_users` sudah jalan **17 menit**.
- Endpoint metrics/health database sendiri timeout (tidak merespon) — konsisten dengan overload.

## Penyebab utama (berdasar statistik query nyata)

| Query | Panggilan | Rata-rata | Total waktu DB |
|---|---|---|---|
| Scan `v_eligible_reengagement_users` (cron re-engage tiap 5 menit) | 4.371 | **5.081 ms** | ~6,2 jam |
| `get_admin_dashboard_stats` (dashboard) | 4.560 | **1.950 ms** | ~2,5 jam |
| Query kedua `v_eligible_reengagement_users` | 3.721 | 2.177 ms | ~2,3 jam |
| `comprehensive_search_action` (matchmaking) | 6,9 juta | 10,4 ms | ~20 jam |

1. **Cron re-engage tiap 5 menit** menjalankan query 2–5 detik yang men-scan seluruh `telegram_users` (130.822 baris, 118 MB) plus anti-join ke `blocked_users`. View `v_eligible_reengagement_users` tidak bisa memanfaatkan indeks parsial yang ada karena filternya diterapkan di atas view. Setiap eksekusi mengunci resource dan bentrok dengan traffic bot.
2. **Kontensi tulis (`WALInsert`)**: `telegram_users` di-update sangat sering (state, last_active, partner_id), 12.443 dead tuple, autovacuum berjalan lama dan memperparah I/O.
3. **Jam ~2 pagi WIB** = jam puncak bot anonim + tumpukan job terjadwal (`update_daily_eligible_count` tiap 6 jam, cron re-engage tiap 5 menit, autovacuum). Kombinasinya melewati kapasitas compute instance sehingga statement timeout massal → webhook gagal → bot terasa mati.
4. **Dashboard admin** memanggil `get_admin_dashboard_stats` (±2 detik/panggilan) berulang, menambah beban di saat yang sama.

## Rencana perbaikan

### A. Hentikan sumber beban terbesar (prioritas 1)
- Ubah cron `reengage-inactive-users` dari **tiap 5 menit → tiap 30 menit**, dan jadwalkan hanya di jam sepi (hindari 00:00–04:00 WIB).
- Ganti query view dengan **RPC khusus** `get_reengagement_batch(p_limit)` yang:
  - memfilter langsung di `telegram_users` (bukan lewat view) agar indeks parsial `idx_reengage_eligible` terpakai,
  - melakukan cek blokir per-baris hanya untuk kandidat yang lolos limit (bukan anti-join seluruh tabel),
  - mengembalikan maksimum N baris dengan `LIMIT` yang didorong ke dalam.
- Fungsi `reengage-users` dipakai untuk memanggil RPC ini, bukan `.from("v_eligible_reengagement_users")`.

### B. Kurangi biaya matchmaking & tulis
- Tambah indeks komposit untuk jalur pencarian partner (`state`, `gender`, `location`, `last_active`) agar `comprehensive_search_action` tidak melakukan scan berulang.
- Setel `autovacuum_vacuum_scale_factor` lebih agresif khusus `telegram_users` supaya vacuum berjalan singkat dan sering, bukan lama sekali dan menahan I/O.

### C. Dashboard admin
- Cache hasil `get_admin_dashboard_stats` (tabel snapshot yang di-refresh berkala) alih-alih menghitung ulang setiap kali dashboard dibuka.

### D. Ketahanan bot
- Perpendek timeout query di webhook dan kirim pesan "sistem sedang sibuk, coba lagi" ketika DB timeout, supaya user tidak merasa bot mati total.

### E. Verifikasi
Setelah perubahan: pantau ulang `pg_stat_statements` (rata-rata query re-engage harus turun dari ~5 detik ke <100 ms) dan pastikan tidak ada lagi `statement timeout` di log Postgres selama 24 jam, khususnya jam 01:00–03:00 WIB.

## Catatan
Jika setelah A–C beban masih menyentuh batas saat jam puncak, opsi berikutnya adalah menaikkan ukuran compute backend — tetapi optimasi di atas dikerjakan lebih dulu karena penyebab dominan jelas berasal dari query yang tidak efisien, bukan semata volume traffic.
