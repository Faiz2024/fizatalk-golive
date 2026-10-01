# Pesan ajakan kembali sampai ke semua pengguna yang layak, dengan biaya tetap hemat

## Kondisi saat ini (data hari ini)
- Total pengguna: 160.346. Yang ditandai sudah memblokir bot: 52.951 (tidak dikirimi lagi, sudah benar).
- Pengguna yang layak tapi **belum dikirimi**: 10.724. Jumlahnya terus naik (25 → 1.104 → 6.552 → 10.017 dalam 4 hari).
- Penyebabnya: sejak jadwal diubah ke 7x sehari dengan maksimal 800 pesan per putaran, kapasitas cuma ~5.600 pesan/hari. Pesan terkirim turun dari 11–22 ribu/hari menjadi 5.555 kemarin. Jadi antrean makin panjang dan sebagian pengguna tidak pernah kebagian.
- Biaya: jadwal 7x sehari sudah jauh lebih hemat dari 288x sehari. Yang paling mahal per putaran adalah pencarian daftar pengguna layak (memindai seluruh tabel), bukan pengiriman pesannya.

## Yang akan diubah
1. **Kirim sampai antrean habis di tiap putaran.** Satu putaran tetap 7x sehari (09.00–21.00 WIB), tapi kalau masih ada sisa, putaran itu lanjut sendiri ke kelompok berikutnya sampai antrean kosong atau melewati 21.00 WIB. Tidak menambah jadwal rutin.
2. **Kirim lebih cepat tapi tetap aman dari batas Telegram**: sekitar 25 pesan/detik (batas Telegram ~30/detik), sehingga 10 ribu pesan selesai dalam ~7 menit.
3. **Ambil daftar pengguna lewat satu fungsi database yang ringan**: langsung mengambil kelompok berikutnya berdasarkan indeks dan menandainya "sedang dikirimi" sekaligus, jadi tidak ada pengguna yang dikirimi dua kali dan tidak memindai seluruh tabel setiap kali.
4. **Pengguna yang gagal karena gangguan sementara** dicoba lagi pada putaran berikutnya (bukan menunggu 7 hari). Yang memblokir bot tetap dilewati permanen.
5. **Statistik harian** dicatat lewat satu panggilan database yang menambah angka langsung (tanpa baca-lalu-tulis).

## Perkiraan biaya
- Jumlah putaran terjadwal tetap 7x/hari. Tambahan hanya lanjutan saat antrean besar (biasanya 1–3 lanjutan per hari saat ini, lalu hampir nol setelah antrean lama habis).
- Pencarian daftar pengguna jauh lebih ringan, jadi beban database per putaran turun.

## Detail teknis
- RPC baru `claim_reengagement_batch(p_limit int)` SECURITY DEFINER, hanya service_role: pilih `telegram_users` state='idle', last_active < now()-7d, (last_reengagement_sent_at null atau < now()-7d), tidak ada di `blocked_users` aktif; `FOR UPDATE SKIP LOCKED`, set `last_reengagement_sent_at = now()` saat diklaim; kembalikan id, first_name, last_reengagement_message_id. Indeks pendukung pada (last_reengagement_sent_at, last_active) WHERE state='idle' bila EXPLAIN menunjukkan perlu.
- RPC `finish_reengagement_batch(p_results jsonb)`: update message_id massal, tandai 2099 untuk yang blokir, kembalikan `last_reengagement_sent_at` ke nilai lama (atau null) untuk error sementara; sekaligus increment `reengagement_daily_stats` (tanggal WIB).
- `reengage-users/index.ts`: batch 1.500, 25 worker dengan jeda ~1 detik per worker; berhenti sebelum ~120 detik; jika batch penuh dan jam WIB < 21, panggil dirinya sendiri sekali (fire-and-forget, header x-cron-secret). Hapus pemakaian view `v_eligible_reengagement_users`.
- Cron tetap `0 2-14/2 * * *` (UTC). Deploy `reengage-users`, uji dengan `test_user_id`, cek angka antrean turun ke ~0 setelah satu hari.
