## Analisis Bug Tombol Stop

### Perbedaan alur

**Tidak chatting** (`state != 'chatting'`):
- `executeChatStop` (baris 3555) → SELECT state → cabang `stop_userdata.state !== 'chatting'` → **kirim pesan "Kamu tidak dalam chat"** → user melihat respons ✅

**Sedang chatting** (`state = 'chatting'`):
- `executeChatStop` → SELECT state → langsung `await endChat(...)` (baris 3586)
- `endChat` (baris 3394) → panggil RPC `end_chat_comprehensive`
- **Jika RPC mengembalikan `success = false`** (baris 3408-3410):
  ```ts
  if (!result.success) { return false; }
  ```
  → **tidak ada pesan apapun ke user**. Spinner tombol sudah hilang (fire-and-forget ack di baris 3840), tapi tidak ada konfirmasi → user merasa tombol tidak berfungsi ❌

### Kenapa RPC bisa gagal saat state='chatting'

Berdasarkan `end_chat_comprehensive` di database:

1. **`already_reset`** — race condition paling umum: **partner klik Stop/Next sepersekian detik lebih dulu**. RPC partner sudah men-`UPDATE` user ini menjadi `idle`. Tapi SELECT di `executeChatStop` (baris 3560) yang berjalan sebelumnya masih melihat `state='chatting'` (snapshot lama), lalu masuk ke `endChat` dan RPC menolak dengan `already_reset` karena `WHERE ... AND partner_id = v_partner_id` sudah tidak match.
2. **`not_in_chat`** — state inkonsisten (`state='chatting'` tapi `partner_id=NULL`). Jarang, tapi kalau terjadi user terjebak selamanya karena tidak ada jalan keluar.

Kedua kasus ini yang menyebabkan "tombol Stop tidak berfungsi saat sedang chatting" — semakin sering dua orang sama-sama mau berhenti, semakin sering dialami.

## Solusi Perbaikan (Minimal & Aman)

**Prinsip:** hanya menambah jalur feedback yang hilang. Tidak mengubah alur sukses, tidak mengubah RPC, tidak mengubah `executeChatStop`, tidak mengubah keyboard/handler lain.

### Perubahan tunggal di `endChat` (`supabase/functions/telegram-webhook/index.ts`, baris 3394-3410)

Ganti dua early-return silent dengan feedback yang tepat:

**a. Saat `error` (RPC gagal / DB error):**
- `console.error('[END_CHAT_FAIL] rpc_error', error)` untuk visibilitas log
- Return `false` seperti sekarang (tidak kirim apa-apa — biar Telegram tidak dibanjiri saat outage)

**b. Saat `result.success === false`:**
- `console.warn('[END_CHAT_FAIL]', result.error, 'partner=', result.partner_id)` untuk visibilitas
- **Jika `result.error === 'already_reset'` dan `result.partner_id` tersedia** → kirim pesan penutup + rating keyboard yang SAMA persis dengan alur sukses (baris 3429-3435). User tetap dapat feedback dan bisa memberi rating partner. **Tidak** mengirim notif ke partner (partner sudah dinotifikasi oleh RPC-nya sendiri saat dia klik Stop lebih dulu — mencegah duplikasi).
- **Jika `result.error === 'not_in_chat'`** (state inkonsisten) → paksa `UPDATE telegram_users SET state='idle', partner_id=NULL WHERE id=userId AND state='chatting'` (guarded, tidak menyentuh user lain), lalu kirim pesan "Kamu tidak dalam chat" + start keyboard yang SAMA persis dengan cabang di `executeChatStop` baris 3572-3583. User keluar dari deadlock.
- Return `false` di kedua kasus (tidak melanjutkan ke logika promo/channel-invite/reconnect karena reset sudah dilakukan oleh partner atau tidak berlaku).

### Yang TIDAK diubah (mencegah regresi)

- `executeChatStop` — biarkan apa adanya (SELECT + cabang idle + panggil endChat).
- RPC `end_chat_comprehensive` — tidak diubah.
- Alur sukses `endChat` (baris 3412 ke bawah) — tidak diubah sedikit pun.
- `answerCallbackQuery`, debounce, heavyActions — tidak diubah.
- Semua callback handler lain, keyboard builder, migrasi DB — tidak diubah.

### Verifikasi setelah deploy

1. Deploy `telegram-webhook`.
2. Setup webhook.
3. Skenario uji manual di Telegram:
   - Anda + partner sedang chatting, keduanya klik Stop hampir bersamaan → keduanya harus melihat pesan penutup + rating keyboard (tidak ada yang "hilang responsnya").
   - Klik Stop saat tidak chatting → tetap muncul menu "Kamu tidak dalam chat" (perilaku lama).
   - Klik Stop saat chatting sendirian → tetap muncul pesan penutup + rating (perilaku lama).
4. Pantau log `[END_CHAT_FAIL]` selama beberapa menit untuk memastikan tidak ada error tak terduga.

### Biaya cloud
- 0 query DB tambahan pada alur sukses (paling sering).
- Pada alur `already_reset` (jarang): 0 query tambahan — hanya 1 `sendTelegramMessage` yang sebelumnya tidak dikirim.
- Pada alur `not_in_chat` (sangat jarang): +1 UPDATE guarded untuk recover state + 1 sendMessage.

Sejalan dengan prinsip hemat cloud dan WIB tidak terpengaruh (tidak ada operasi waktu di path ini).
