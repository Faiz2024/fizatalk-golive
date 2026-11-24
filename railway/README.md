# Runtime bot FizaTalk di Railway

Satu proses Deno melayani endpoint berikut. Handler yang sama tetap dipakai oleh
fungsi backend saat ini, sehingga tidak ada dua implementasi logika bot.

- `/telegram-webhook`
- `/pakasir-callback`
- `/sakurupiah-callback`
- `/reengage-users`
- `/call-invite-exchange`
- `/health`

Agen channel berjalan sebagai fungsi `channel-agent` di Supabase agar kredit AI
server tetap terpisah dari Railway. Railway memanggil fungsi itu secara asinkron
untuk pemolesan admin; pekerjaan harian dipicu oleh pg_cron langsung ke Supabase.
Draf tidak pernah otomatis masuk channel. Admin memakai tombol persetujuan,
`/feedback` untuk masukan pengguna, dan `/giveaway https://link.dana.id/...`
untuk draf giveaway dengan tautan buatan admin. Posting di luar jadwal dibuat
dengan `/channel_post jawab teks` (tombol Jawab) atau `/channel_post polos teks`
(tanpa tombol). Keduanya dipoles AI dan tetap memerlukan persetujuan admin.
Tombol Jawab membuka `/start feedback`, lalu pengguna mengirim `/feedback jawaban`.

Prefix lama `/functions/v1/...` juga diterima. Health check hanya memeriksa
konfigurasi proses dan tidak membaca database.

## 1. Deploy

1. Hubungkan repository ini melalui **Railway → New Project → Deploy from GitHub
   Repo**.
2. `railway.json` otomatis memilih `railway/Dockerfile` dan health check
   `/health`.
3. Isi variabel berikut pada service Railway **sebelum deploy**. Jangan menulis
   nilai rahasia di repository atau chat.

### Wajib untuk bot

| Nama                        | Isi                                         |
| --------------------------- | ------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | Token bot dari BotFather                    |
| `SUPABASE_URL`              | URL HTTPS proyek database mandiri           |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role secret proyek database mandiri |
| `TELEGRAM_CS_CHAT_ID`       | ID chat admin CS                            |
| `BOT_USERNAME`              | Username bot tanpa `@`                      |

`PORT` diisi otomatis oleh Railway. Secret webhook Telegram tidak perlu disimpan
terpisah: handler dan skrip setup sama-sama menurunkannya dari token bot.

### Sesuai fitur yang aktif

| Nama                                                        | Kegunaan                                     |
| ----------------------------------------------------------- | -------------------------------------------- |
| `VOICE_BOT_USERNAME`                                        | Tautan bot voice                             |
| `STICKER_OWNER_ID`                                          | Alur review stiker                           |
| `LEGACY_CALL_SECRET`                                        | Pertukaran undangan call                     |
| `PAKASIR_SLUG`, `PAKASIR_API_KEY`, `PAKASIR_WEBHOOK_SECRET` | Callback Pakasir lama                        |
| `SAKURUPIAH_API_ID`, `SAKURUPIAH_API_KEY`                   | Invoice/callback Sakurupiah lama             |
| `SAKURUPIAH_CALLBACK_URL`                                   | `https://DOMAIN_RAILWAY/sakurupiah-callback` |
| `REENGAGE_FUNCTION_URL`                                     | `https://DOMAIN_RAILWAY/reengage-users`      |

Pembayaran Stars hanya membutuhkan token bot dan database. Variabel gateway lama
dapat dikosongkan bila seluruh invoice lama sudah selesai dan fitur tersebut
tetap dinonaktifkan.

## 2. Uji sebelum cutover

Setelah Railway memberi domain publik:

```bash
curl --fail https://DOMAIN_RAILWAY/health
```

Hasil yang diharapkan:

```json
{ "status": "ok", "service": "fizatalk-bot" }
```

Jangan mengalihkan webhook sebelum sinkronisasi delta selesai dan uji endpoint
berhasil.

## 3. Cutover webhook

Jalankan skrip ini hanya saat cutover. Nilai token dibaca dari environment dan
tidak ditulis ke file.

```bash
TELEGRAM_BOT_TOKEN='ISI_DI_TERMINAL' \
RAILWAY_PUBLIC_DOMAIN='DOMAIN_RAILWAY' \
deno run --allow-env --allow-net=api.telegram.org railway/setup-webhook.ts
```

Skrip mempertahankan `drop_pending_updates: false`. Setelah berhasil, uji pesan
biasa, pencarian partner, callback tombol, pre-checkout Stars, dan pembayaran
Stars nyata.

## 4. Cron dan rollback

- Ubah job HTTP re-engagement ke `https://DOMAIN_RAILWAY/reengage-users`; tetap
  gunakan header autentikasi cron yang sama. Produksi berjalan setiap 2 jam pada
  09.00–21.00 WIB melalui `fizatalk-golive-production.up.railway.app`.
- Penghitung eligible enam jam memakai `idx_tu_reengage_claim_covering` agar
  statistik harian tidak melakukan full-table scan pada `telegram_users`.
- `waiting_queue` memakai autovacuum scale factor 0,05 dan cost limit 500 agar
  dead tuple pada antrean pencocokan dibersihkan lebih dini.
- Jangan menjalankan cron re-engagement lama dan baru bersamaan.
- Rollback webhook dilakukan dengan mengarahkan `setWebhook` kembali ke endpoint
  backend lama. Jangan menjalankan kedua webhook secara bersamaan.
- Snapshot awal bukan pengganti delta: pengguna dan transaksi baru setelah
  snapshot wajib disinkronkan sebelum cutover.

## 5. Optimasi runtime dan resource

- Seluruh handler berbagi satu service client per kredensial. Connection pool dan
  HTTP keep-alive bawaan Deno digunakan ulang tanpa membuat client per request.
- Pengaturan bot di-cache 60 detik, profil Premium/filter 20 detik, dan sticker
  pack 5 menit. Perubahan pengaturan/Premium membatalkan cache terkait.
- Seluruh tombol memakai debounce RAM 2 detik. ACK aksi berat dikirim sebelum
  query database; state chat, partner, dan sanksi tidak pernah di-cache.
- Webhook dibatasi 40 koneksi dan setiap panggilan database memiliki timeout 5
  detik agar gangguan database tidak memicu antrean retry Telegram berkepanjangan.
- Maksimal 20 panggilan database berjalan bersamaan per proses. Antrean RAM ikut
  dibatasi timeout 5 detik dan dapat dibatalkan tanpa membocorkan slot.
- Pesan/edited message dibatasi 3 pesan per detik bergulir per pengguna. Kelebihan
  diakhiri HTTP 200 tanpa database atau Telegram API; pembayaran dan tombol tidak
  ikut dibatasi. Cache limiter menyimpan maksimal 50.000 pengguna terbaru.
- Pesan biasa yang tertahan lebih dari 90 detik dibuang tanpa membaca database;
  callback dan pembayaran Stars tidak ikut dibuang. Error database pada interaksi
  biasa menghasilkan HTTP 200 dan pesan coba lagi, sedangkan pembayaran Stars
  tetap dapat dicoba ulang Telegram.
- Circuit breaker terbuka setelah 5 kegagalan database dalam 10 detik dan memberi
  jeda pemulihan 10 detik. `/stats` admin hanya membaca cache dashboard.
- Setiap 10 menit runtime memeriksa antrean webhook. Lebih dari 300 update memicu
  peringatan WIB ke `TELEGRAM_CS_CHAT_ID`, maksimal satu peringatan per 30 menit.
- `railway.json` menetapkan satu replika, maksimum 1 vCPU dan 512 MiB RAM.
  Heap V8 dibatasi 256 MiB agar tersedia ruang untuk runtime Deno.
- Deploy baru tumpang-tindih 3 detik. Saat `SIGTERM`, server berhenti menerima
  koneksi baru, menunggu request aktif maksimal 5 detik, dan Railway memberi
  waktu pengurasan 8 detik sebelum mematikan proses lama.

## Uji lokal tanpa layanan nyata

```bash
deno task test
```

Docker build memakai root repository sebagai context dan `railway/Dockerfile`;
jangan mengubah build context ke folder `railway` karena handler berada di
`supabase/functions`.
