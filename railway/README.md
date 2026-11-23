# Runtime bot FizaTalk di Railway

Satu proses Deno melayani endpoint berikut. Handler yang sama tetap dipakai oleh
fungsi backend saat ini, sehingga tidak ada dua implementasi logika bot.

- `/telegram-webhook`
- `/pakasir-callback`
- `/sakurupiah-callback`
- `/reengage-users`
- `/call-invite-exchange`
- `/health`

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
  gunakan header autentikasi cron yang sama.
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
