# Karantina Pelapor Negatif + Perbaikan Alur Tombol Laporkan

## Ringkasan

Tiga perubahan pada bot Telegram:

1. User yang menerima **4 laporan negatif (spam/sange) dalam 12 jam** masuk **karantina 3 hari** — hanya dicocokkan dengan sesama user karantina.
2. Saat menekan **Cari Partner** atau **Next**, user karantina melihat keterangan bahwa pencocokan mungkin lama karena terlalu sering dilaporkan.
3. Saat menekan tombol **🚩 Laporkan**, pesan berubah jadi himbauan memilih jenis laporan, dengan tambahan tombol **🔍 Cari Partner Baru**.

Aturan peluruhan: hitungan laporan berkurang **1 setiap 3 jam**, hanya berjalan bila **tidak ada laporan baru selama 12 jam** terakhir.

## Perubahan Database (migrasi)

Kolom baru di `telegram_users` (semua ringan, tanpa tabel baru):

- `negative_reports_count` (integer, default 0) — hitungan laporan negatif berjalan
- `last_negative_report_at` (timestamptz) — waktu laporan negatif terakhir
- `reports_decay_at` (timestamptz) — penanda kapan peluruhan terakhir dihitung
- `match_quarantine_until` (timestamptz) — akhir masa karantina 3 hari

Indeks parsial `WHERE match_quarantine_until IS NOT NULL` agar pencocokan tetap murah.

### Fungsi bantu `public.decay_negative_reports(p_user_id)`
Peluruhan **lazy** (tanpa cron, hemat biaya): dipanggil hanya saat user melapor / dilaporkan / mencari partner. Logika:
- Jika `now() - last_negative_report_at >= 12 jam`, kurangi hitungan sebanyak `floor(jam sejak awal peluruhan / 3)`, minimum 0.
- Hanya menulis ke DB bila nilainya benar-benar berubah.

### `submit_partner_report` (diubah)
Setelah laporan spam/sange tercatat:
1. Jalankan peluruhan lazy untuk user yang dilaporkan.
2. Naikkan `negative_reports_count`, set `last_negative_report_at = now()`.
3. Jika hitungan mencapai **>= 4** dan laporan pertama dalam jendela masih di dalam 12 jam → set `match_quarantine_until = now() + 3 hari` (tidak diperpanjang berulang jika karantina masih aktif; diperpanjang hanya bila sudah kedaluwarsa).
4. User premium dikecualikan dari karantina, konsisten dengan aturan penalti yang ada.

Semua tetap dalam satu RPC — tidak ada tambahan round-trip dari Edge Function.

### `comprehensive_search_action` (diubah)
- Ambil `match_quarantine_until` user saat mengambil baris user (tanpa query tambahan).
- Jalankan peluruhan lazy untuk user pencari.
- Di loop kandidat, ambil `match_quarantine_until` kandidat dari join `waiting_queue` yang sudah ada, lalu **lewati kandidat jika status karantina keduanya tidak sama** (karantina hanya cocok dengan karantina; normal hanya dengan normal).
- Tambahkan ke objek `reputation` pada hasil JSON: `quarantined` (boolean) dan `quarantine_until`.

`find_and_pair_partner` diberi aturan pencocokan yang sama agar konsisten bila jalur itu terpakai.

## Perubahan Edge Function `telegram-webhook`

- **Pesan pencarian** (`sendSearchingMessage`): bila `reputation.quarantined` true, tambahkan baris keterangan, misalnya:
  "⏳ Pencocokan mungkin memakan waktu lebih lama karena akun Anda terlalu sering menerima laporan negatif. Status ini berakhir otomatis pada <tanggal WIB>."
  Berlaku untuk tombol Cari Partner maupun Next (keduanya lewat fungsi yang sama).
- **Tombol 🚩 Laporkan** (`report_user_*`): ganti `editMessageReplyMarkup` menjadi `editMessageText` dengan teks himbauan, contoh:
  "🚩 Pilih jenis laporan yang sesuai. Laporan palsu dapat menurunkan reputasi Anda sendiri."
  Keyboard: baris 1 → 🚨 Spam / 🔞 Sange, baris 2 → 🔍 Cari Partner Baru (`search_partner`).
  Sertakan fallback ke `editMessageReplyMarkup` bila editText gagal (pesan media/terlalu lama), agar tidak ada regresi.

## Pertimbangan

- **Biaya cloud**: tanpa tabel/cron baru; peluruhan lazy dan hanya menulis saat nilai berubah; filter karantina memakai kolom yang sudah ikut dalam join kandidat.
- **Performa**: indeks parsial + tidak ada query tambahan per pencarian.
- **Keamanan**: seluruh logika di RPC `SECURITY DEFINER`; klien Telegram tidak bisa memanipulasi status karantina; validasi partner terakhir & rate limit laporan yang ada tetap dipertahankan.
- **Kompatibilitas**: alur rating (asik/baik), penalti, blokir 100 poin, promo, dan channel invite tidak diubah.

## Verifikasi setelah implementasi

- Simulasi 4 laporan dalam 12 jam pada user uji → cek `match_quarantine_until` terisi 3 hari.
- Cek user karantina hanya berpasangan dengan sesama karantina.
- Cek teks keterangan muncul pada Cari Partner dan Next.
- Cek tombol Laporkan menampilkan teks himbauan + tombol Cari Partner Baru.
- Deploy ulang `telegram-webhook` dan pantau log untuk error.
