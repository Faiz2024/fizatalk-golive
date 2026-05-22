# Plan: Antigravity Bridge — Full DB Access + Bot Logs

Antigravity dapat mengelola database sepenuhnya (CRUD + DDL) dan membaca log error bot via tabel `bot_logs` yang kita instrumentasi sendiri. **Tidak butuh SUPABASE_ACCESS_TOKEN.**

## Arsitektur

```text
Antigravity (MCP client)
   ↓ stdio
~/.antigravity/lovable-mcp-bridge.mjs
   ↓ HTTPS + X-API-Key
db-bridge edge function (verify_jwt=false)
   ↓ service_role
bridge_exec_sql RPC → Postgres (public schema, bypass RLS)
                       └─ termasuk tabel bot_logs
```

## Yang akan dibuat

### 1. Migration (1x approve)
- **Tabel `public.bot_logs`** — kolom: `id`, `created_at` (default WIB), `level` (debug/info/warn/error/fatal), `source`, `event`, `user_id`, `message`, `context jsonb`. Index `created_at desc`, `level`, `source`, `user_id`. RLS service_role only.
- **RPC `log_bot_event(...)`** — SECURITY DEFINER, fire-and-forget friendly
- **RPC `prune_bot_logs()`** — hapus error/fatal >30 hari, level lain >7 hari
- **RPC `bridge_exec_sql(p_sql, p_params)`** — SECURITY DEFINER, return jsonb `{kind, data, row_count}`, guard regex untuk block schema `auth/storage/vault/realtime`, REVOKE ALL FROM public/anon/authenticated, GRANT EXECUTE TO service_role

### 2. Secret baru (1)
- `DB_BRIDGE_API_KEY` — token random hex 64 char (Anda generate sendiri)

### 3. Edge Function `supabase/functions/db-bridge/index.ts`
- `verify_jwt = false`, auth via X-API-Key (timing-safe compare)
- Rate limit 120 req/menit per IP
- Validasi Zod
- Actions: `sql_query` (SELECT/WITH only), `sql_execute` (full CRUD+DDL), `list_tables`, `describe_table`, `list_policies`, `recent_logs`, `log_summary`

### 4. Instrumentasi log (perubahan minimal)
Helper `logEvent()` fire-and-forget di 3 edge function:
- **`telegram-webhook`** — error sendMessage/editMessageText, exception top-level
- **`sakurupiah-callback`** — invalid signature, transaction not found
- **`admin-stats`** — exception catch

Hanya error/warning bermakna (bukan setiap event) → hemat biaya & storage.

### 5. MCP Wrapper `lovable-mcp-bridge.mjs` (~150 baris Node)
8 tools untuk Antigravity:

| Tool | Tipe |
|---|---|
| `sql_query` | read (SELECT) |
| `sql_execute` | write (CRUD/DDL) |
| `list_tables`, `describe_table`, `list_policies` | read helper |
| `bot_recent_logs`, `bot_user_logs`, `bot_log_summary` | read log |

### 6. Config Antigravity (snippet JSON)
```json
{
  "mcpServers": {
    "lovable-cloud": {
      "command": "node",
      "args": ["~/.antigravity/lovable-mcp-bridge.mjs"],
      "env": {
        "BRIDGE_URL": "https://chwopnsmykwzqflqozvf.functions.supabase.co/db-bridge",
        "BRIDGE_API_KEY": "<token Anda>"
      }
    }
  }
}
```

## Urutan Eksekusi

1. **Minta secret** `DB_BRIDGE_API_KEY` — Anda generate token random (mis. dari https://generate-secret.vercel.app/32 atau `openssl rand -hex 32`) dan paste di form aman
2. **Migration** — saya tulis, Anda approve
3. **Tulis & deploy** edge function `db-bridge`
4. **Instrumentasi** 3 edge function dengan helper `logEvent()`
5. **Test** dari sandbox via `curl_edge_functions`: list_tables, sql_query SELECT, sql_execute create+drop temp, recent_logs, 401 tanpa API key
6. **Kirim file** `lovable-mcp-bridge.mjs` + config Antigravity ke Anda

## Keamanan

- `DB_BRIDGE_API_KEY` = akses root DB → simpan di password manager, jangan commit, jangan share
- Bocor → `update_secret` rotasi instan
- Tidak menyentuh schema `auth/storage/vault/realtime`
- Tidak ada perubahan UI website atau business logic bot

## Yang TIDAK termasuk

- ❌ Deploy edge function dari Antigravity
- ❌ Log native Supabase (boot/shutdown)
- ❌ Realtime log streaming

Setujui plan ini → saya mulai dari minta `DB_BRIDGE_API_KEY`.
