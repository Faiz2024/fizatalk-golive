# Pengumuman Otomatis Penarikan Bonus ke Channel @FizaTalkCh

## Yang dibangun

Setiap kali admin menekan tombol **✅ Sudah Dikirim** pada permintaan tarik bonus, bot otomatis memposting pengumuman ke channel **@FizaTalkCh** sebagai bukti sosial agar pengguna lain tertarik mengajak teman.

## Tampilan postingan di channel

```text
💸 BONUS REFERAL CAIR!

👤 Penerima : @fiz***a
💰 Nominal  : Rp50.000
🏦 Metode   : DANA (0812****789)
👥 Teman sah: 103 orang
🕒 09 Sep 2026, 09.15 WIB

Ajak temanmu ke FizaTalk, kumpulkan 100 teman sah,
dan tarik bonus Rp50.000 ke e-wallet-mu!
```

Tombol di bawah postingan: **🚀 Mulai Ajak Teman** → membuka bot langsung ke menu referal (`https://t.me/FizaTalkBot?start=referral`).

## Aturan privasi (disamarkan)

- Username: 3 karakter pertama + `***` + 1 karakter terakhir (contoh `@fiz***a`). Jika tidak punya username, pakai nama depan yang disamarkan dengan pola sama; jika tetap kosong, tampilkan `Pengguna FizaTalk`.
- Nomor e-wallet: 4 digit awal + `****` + 3 digit akhir.
- Nama pemilik e-wallet **tidak** ditampilkan sama sekali.
- Tidak ada foto/bukti transfer yang diposting (teks otomatis saja).

## Detail teknis

**Database (satu migrasi kecil)**
- Perbarui `public.process_referral_cashout` agar hasilnya juga mengembalikan `amount`, `username`, `first_name`, dan `qualified_at_request` (diambil dari baris cashout + join `telegram_users`). Tanpa ini bot harus query tambahan — menambah biaya cloud.
- Tidak ada tabel/kolom baru.

**Bot (`supabase/functions/telegram-webhook/index.ts`)**
- Tambah helper `maskIdentity()` dan `maskNumber()` di dekat helper teks yang sudah ada.
- Tambah fungsi `postCashoutToChannel(botToken, data)` mengikuti pola `postStickerToChannel`: `sendMessage` ke `@FizaTalkCh` dengan `parse_mode: 'HTML'`, `disable_web_page_preview: true`, dan inline button ajakan. Semua error hanya di-`console.error` (fire-and-forget) supaya kegagalan posting channel tidak pernah menggagalkan proses pembayaran atau notifikasi ke pengguna.
- Panggil fungsi ini di cabang `isPaid` pada handler `admin_cashout_paid_`, setelah notifikasi ke pengguna, tanpa `await` yang memblokir (pakai `.catch(() => {})`).
- Nominal diambil dari `amount` hasil RPC, bukan angka hardcode, agar aman jika nominal berubah lagi.
- Waktu memakai `formatDateTimeWIB` yang sudah ada.

**Prasyarat operasional**
- Bot harus jadi admin di @FizaTalkCh dengan izin kirim pesan. Jika belum, postingan gagal senyap dan hanya tercatat di log — proses lain tetap normal.

## Verifikasi
- Jalankan migrasi, deploy ulang `telegram-webhook`, setup ulang webhook.
- Uji: tandai satu permintaan sebagai Sudah Dikirim → cek pengguna menerima notifikasi, pesan admin ter-update, dan postingan muncul di channel dengan identitas tersamar.
- Uji tombol **❌ Tolak** → tidak ada postingan channel.
- Tekan tombol dua kali → tetap hanya satu postingan (dilindungi cek `already_processed` di RPC).
