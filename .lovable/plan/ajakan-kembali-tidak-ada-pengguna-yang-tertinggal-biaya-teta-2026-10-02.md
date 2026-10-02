# Ajakan kembali: tidak ada pengguna yang tertinggal, biaya tetap hemat

## Kondisi saat ini (data 2 Okt 2026)
- Pengguna yang memenuhi syarat dalam siklus 7 hari: sekitar 81 ribu. Agar semuanya dikirimi seminggu sekali, dibutuhkan sekitar **11.600 pesan/hari**.
- Pesan terkirim kemarin hanya **6.945**. Antrean yang sudah jatuh tempo tapi belum dikirimi saat ini **6.871** (turun dari 10.724, tapi belum habis).
- **Penyebab utama:** setiap putaran hanya mengirim 1.000 pesan (catatan putaran: "Processing batch of 1000"), sedangkan syarat untuk lanjut otomatis adalah 1.500. Akibatnya putaran **tidak pernah lanjut sendiri**, jadi kapasitasnya hanya 7 x 1.000 = 7.000/hari.
- **Masalah kedua:** pengguna yang namanya mengandung tanda seperti `<` gagal dikirimi ("can't parse entities") dan dicoba lagi setiap putaran tanpa pernah berhasil.

## Opsi strategi

**Opsi A — Perbaiki saja agar putaran lanjut otomatis (direkomendasikan)**
- Samakan ukuran kelompok dengan syarat lanjut, supaya setiap putaran terus berjalan sampai antrean habis (paling lambat sampai 21.00 WIB).
- Jumlah pesan per hari mengikuti kebutuhan (sekitar 11–12 ribu). Biaya bertambah sedikit karena ada beberapa lanjutan otomatis per hari, tanpa menambah jadwal rutin.

**Opsi B — Paling hemat: lebih sedikit putaran, kelompok lebih besar**
- Jadwal dikurangi menjadi 4x sehari (09.00, 12.00, 15.00, 18.00 WIB). Setiap putaran berjalan sampai antrean habis.
- Total fungsi yang berjalan lebih sedikit, tapi pesan menumpuk di jam-jam tertentu (tetap sekitar 15 pesan/detik, aman dari batas Telegram).

**Opsi C — Prioritas cerdas + jeda lebih panjang untuk pengguna yang sudah lama tidak aktif**
- Pengguna yang tidak aktif 7–30 hari tetap dikirimi setiap 7 hari. Pengguna yang tidak aktif lebih dari 30 hari dikirimi setiap 14 hari, karena peluang mereka kembali jauh lebih kecil.
- Kebutuhan pesan turun menjadi sekitar 7–8 ribu/hari, sehingga pengiriman ke Telegram dan biaya berkurang, dan risiko diblokir juga lebih rendah. Semua pengguna yang layak tetap dikirimi, hanya jedanya yang berbeda.

Semua opsi juga mencakup:
- Nama pengguna diamankan sebelum dikirim, sehingga error "can't parse entities" hilang.
- Pengguna yang gagal 3 kali berturut-turut karena error permanen tidak dicoba lagi setiap putaran.
- Ringkasan harian berisi jumlah antrean tersisa, supaya bisa dicek dengan mudah apakah ada yang tertinggal.

## Detail teknis
- `reengage-users/index.ts`: syarat lanjut memakai jumlah dari RPC (`users.length >= p_limit` yang benar-benar dikembalikan) atau periksa `remaining` dari RPC; samakan BATCH dengan batas di dalam `claim_reengagement_batch` (saat ini 1.000). Escape `& < >` pada `first_name` (atau kirim tanpa `parse_mode`).
- Batas aman lanjutan: maksimal ~8 lanjutan per jadwal, dan berhenti jika jam WIB >= 21.
- Opsi B: cron `0 2,5,8,11 * * *` (UTC).
- Opsi C: ubah syarat di `claim_reengagement_batch`: interval 7 hari jika `last_active > now()-30d`, 14 hari jika lebih lama; urutan tetap `last_active DESC`.
- `finish_reengagement_batch`: hitung kegagalan berturut-turut; ditandai lewati 30 hari setelah 3 kali gagal permanen. Jumlah antrean tersisa ditulis ke `reengagement_daily_stats.eligible_count` (WIB).
- Verifikasi: uji dengan `test_user_id`, lalu cek setelah satu hari bahwa antrean sudah mendekati 0.
