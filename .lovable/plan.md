# Shadowban Khusus Premium: Pencocokan Campuran + Tanpa Keterangan

## Ringkasan perubahan

1. Pengguna **premium** yang sedang shadowban **tidak lagi melihat** keterangan "Pencocokan mungkin memakan waktu lebih lama".
2. Premium yang shadowban bisa dicocokkan dengan:
   - sesama pengguna shadowban (seperti sekarang), **atau**
   - pengguna normal (tidak shadowban) yang **sudah melewati 10 obrolan**.
3. Hitungan 10 obrolan itu **direset ke 0** setiap kali pengguna normal tersebut dipertemukan dengan pengguna premium yang shadowban.
4. Pengguna **non-premium** yang shadowban: aturan tetap seperti sebelumnya (hanya bertemu sesama shadowban) dan tetap melihat keterangan.
5. Begitu masa shadowban berakhir, semua pencocokan kembali normal (status sudah dibersihkan otomatis saat pencarian berikutnya — mekanisme ini sudah ada).

## Perubahan database (migrasi)

Kolom baru di `telegram_users`:

- `chats_since_premium_shadow` (integer, default 0, not null) — jumlah obrolan pengguna normal sejak terakhir bertemu premium-shadowban.

Aturan penghitungan (dilakukan di dalam RPC pencocokan, tanpa query tambahan):

- Setiap kali seorang pengguna **tidak shadowban** berhasil dipasangkan, nilainya +1.
- Jika pasangannya adalah **premium yang shadowban**, nilainya di-set 0.
- Pengguna yang sedang shadowban tidak menaikkan hitungan.

### `comprehensive_search_action` (diubah)

- Ambil `chats_since_premium_shadow` bersama data pengguna dan kolom yang sama untuk kandidat (join `waiting_queue` yang sudah ada — tidak ada query tambahan).
- Ganti aturan filter kandidat saat ini (`kandidat_shadow <> saya_shadow → lewati`) menjadi:

```text
saya shadowban + premium   -> boleh: kandidat shadowban (apa pun),
                              atau kandidat normal dengan hitungan >= 10
saya shadowban + non-prem  -> boleh: kandidat shadowban saja
saya normal                -> boleh: kandidat normal,
                              atau kandidat shadowban-premium bila hitungan saya >= 10
```

- Pada langkah pemasangan, perbarui `chats_since_premium_shadow` sesuai aturan penghitungan di atas untuk kedua belah pihak, di dalam UPDATE yang sudah ada.
- Tambahkan field `shadowban_notice` pada objek `reputation`: bernilai benar hanya bila sedang shadowban **dan bukan premium**. Field `shadowbanned` tetap ada agar tidak merusak pemakaian lain.

### `find_and_pair_partner` (diubah)

Aturan pencocokan dan penghitungan yang sama diterapkan agar konsisten bila jalur ini terpakai.

## Perubahan bot Telegram (`telegram-webhook`)

- Pada pesan pencarian, keterangan "Pencocokan mungkin memakan waktu lebih lama" hanya tampil bila `reputation.shadowban_notice` benar (jadi premium tidak melihatnya).
- Kondisi "tetap kirim pesan walau penalti rendah" juga ikut memakai `shadowban_notice`, sehingga pengguna premium yang shadowban tidak menerima pesan tambahan apa pun.
- Tidak ada perubahan alur lain: rating, penalti, promo, undangan channel, referal tetap sama.

## Pertimbangan

- **Biaya cloud**: tidak ada tabel baru, tidak ada cron, tidak ada query tambahan; kolom baru ikut dalam join kandidat yang sudah berjalan dan diperbarui di UPDATE pemasangan yang sudah ada.
- **Keamanan**: seluruh logika di RPC `SECURITY DEFINER`; klien Telegram tidak dapat memanipulasi hitungan atau status shadowban.
- **UX**: premium tidak merasa "dihukum" secara terlihat, tetapi tetap terisolasi sebagian; pengguna normal hanya sesekali (setiap 10 obrolan) terpapar akun premium bermasalah.

## Verifikasi setelah implementasi

- Premium shadowban → pesan pencarian tanpa keterangan tambahan; non-premium shadowban → keterangan tetap muncul.
- Premium shadowban berpasangan dengan pengguna normal hanya ketika hitungan pengguna itu sudah mencapai 10, lalu hitungannya kembali 0.
- Non-premium shadowban tetap hanya bertemu sesama shadowban.
- Setelah `shadowban_until` lewat, pencocokan kembali normal.
- Deploy ulang `telegram-webhook`, setup webhook, dan pantau log.
