# Cloud Cost Optimization Guide

## Changelog
- **2026-02-08**: Perbaikan debounce - dipindahkan ke PALING AWAL sebelum operasi DB apapun
- **2026-02-08**: Cooldown diperbesar (5 detik untuk search/next) dan logging ditambahkan
- **2026-02-08**: Acknowledge callback segera untuk operasi berat (fire-and-forget)

## Overview
This document describes the cost optimization strategies implemented in the Telegram bot to minimize Supabase cloud costs.

## 1. Last Active Update Optimization

### Before
- `last_active` was updated on every user interaction
- High database write operations

### After  
- `last_active` is updated **only once per day**
- Update occurs when user presses: **Stop**, **Next**, or **Cari Partner** buttons
- Uses RPC `update_last_active_daily(p_user_id)` to check if update is needed

### RPC Functions
```sql
-- Check if update needed (returns false if already updated today)
SELECT update_last_active_daily(user_id);

-- Optimized upsert with conditional last_active update
SELECT upsert_user_optimized(
  p_user_id := user_id,
  p_username := 'username',
  p_first_name := 'First',
  p_update_last_active := true  -- Only updates if not today
);
```

## 2. Channel Join Check Optimization

### Before
- Channel membership checked on every search/next action
- Extra API call to Telegram for every user

### After
- Channel check **only for users registered > 1 week**
- New users (< 1 week) skip channel verification
- Uses RPC `should_show_channel_join(p_user_id)` for efficient check

### RPC Function
```sql
-- Returns TRUE if user should see channel join message (registered > 7 days)
SELECT should_show_channel_join(user_id);
```

## 3. Promo System Optimization

### Before
- Fetched all users and filtered in code
- Multiple database queries per user

### After
- Uses RPC `get_promo_eligible_users()` to filter in database
- Only returns:
  - Users in `chatting` state (regardless of last_active)
  - Users in `idle` state with `last_active` within 5 hours
  - Excludes premium users (no need to send promo)
- Status set at queue insertion time (not at send time)

### Promo Flow
1. `/promo` command calls RPC `get_promo_eligible_users()`
2. Queue entries created with correct status:
   - `idle` users → status: `pending` (immediate send)
   - `chatting` users → status: `waiting_idle` (send when exit chat)
3. `promo_job` processes only `pending` items
4. When user exits chat (stop/next), `sendPendingPromoToUser()` sends `waiting_idle` promos

### RPC Functions
```sql
-- Get eligible users (excludes premium, filters by activity)
SELECT * FROM get_promo_eligible_users();

-- Get waiting promos for user
SELECT * FROM get_waiting_idle_promos(user_id);

-- Mark promo as sent
SELECT mark_promo_sent(promo_id, message_id);
```

## 4. User Upsert Optimization

### Before
```typescript
// Always updated database
await supabase.from('telegram_users').upsert({...});
```

### After
```typescript
// Only updates if data changed
await supabase.rpc('upsert_user_optimized', {
  p_user_id: userId,
  p_username: username,
  p_first_name: firstName,
  p_update_last_active: false  // or true for stop/next/search
});
```

### Benefits
- Skips update if username/first_name unchanged
- Conditional last_active update
- Single database call instead of read + write

## 5. Auto-Block System Toggle

### Command
```
/autoblock on   - Enable spam detection (uses more DB operations)
/autoblock off  - Disable spam detection (saves cloud costs)
/autoblock      - Show current status
```

### When disabled:
- No read/insert to `spam_detection` table
- No automatic user blocking
- Significant cloud cost savings

## Cost Comparison

| Operation | Before | After | Savings |
|-----------|--------|-------|---------|
| last_active update | Every message | Once/day | ~95% |
| Channel check API | Every search | Users > 1 week | ~70% |
| Promo user filter | In-memory | Database RPC | ~80% |
| User upsert | Always write | Conditional | ~60% |
| Message handling | DB query every msg | Cache-first | ~80% |

## 6. In-Memory Cache System (NEW!)

### Overview
Sistem cache in-memory untuk menyimpan data user yang sedang chatting, mengurangi panggilan database saat mengirim pesan.

### How It Works
```typescript
// Cache key: userId
// Cache value: { partnerId, state, cachedAt }
// TTL: 5 menit

// 1. Saat user mengirim pesan dalam chat:
const cached = getCachedUserData(userId);
if (cached && cached.state === 'chatting') {
  // Gunakan data dari cache - TIDAK ADA DB CALL
  const partnerId = cached.partnerId;
}

// 2. Saat pairing berhasil:
setCachedUserData(user1Id, user2Id, 'chatting');
setCachedUserData(user2Id, user1Id, 'chatting');

// 3. Saat chat berakhir:
invalidatePairCache(userId, partnerId);
```

### Cache Invalidation Points
- `endChat()` - Invalidate kedua user saat chat berakhir
- `chat_next` - Invalidate sebelum mencari partner baru
- `chat_stop` - Invalidate saat user stop
- Automatic expiry setelah 5 menit (TTL)

### Cost Savings
**Sebelum:** Setiap pesan chat = 1 database SELECT query
**Sesudah:** Pesan chat selama 5 menit = 1 database SELECT (di awal)

**Contoh:**
- User A dan B chatting 10 menit, kirim 50 pesan
- **Sebelum:** 50 SELECT queries = ~Rp 50
- **Sesudah:** 2 SELECT queries = ~Rp 2
- **Savings: 96%**

## 7. Consolidated RPC Functions (NEW!)

### Overview
Semua operasi state change dikonsolidasi ke dalam RPC functions untuk mengurangi round-trip database.

### New RPC Functions
| RPC Function | Purpose | Replaces |
|--------------|---------|----------|
| `end_chat_comprehensive` | End chat + promo check + queue cleanup | 6 separate queries |
| `update_user_gender` | Update gender + check location | 2 queries |
| `update_user_location` | Update location | 1 query |
| `update_target_gender` | Update target gender (premium) | 1 query |
| `update_target_location` | Update target location (premium) | 1 query |
| `set_user_payment_state` | Set awaiting_payment state | 1 query |
| `reset_payment_state` | Reset from payment to idle/chatting | 2 queries |
| `cancel_topup_transaction` | Cancel topup + reset state | 3 queries |
| `cancel_premium_transaction` | Cancel premium + reset state | 3 queries |
| `cancel_fine_transaction` | Cancel fine + reset state | 2 queries |

### Cost Savings
**Sebelum:** End chat operation = 6+ database calls
**Sesudah:** End chat operation = 1 RPC call

**Contoh:**
- User menekan Stop → endChat()
- **Sebelum:** SELECT user, UPDATE user, SELECT promo, SELECT promo partner, UPDATE partner, DELETE queue = 6 calls
- **Sesudah:** RPC end_chat_comprehensive() = 1 call
- **Savings: 83%**

## Best Practices

1. **Minimize Database Writes**
   - Use RPC functions that check before writing
   - Batch operations when possible

2. **Use Selective Queries**
   - Let database filter data
   - Avoid fetching all rows and filtering in code

3. **Conditional Operations**
   - Check if operation needed before executing
   - Use IS DISTINCT FROM for change detection

4. **Background Jobs**
   - Process in batches with limits
   - Use pg_cron for scheduled tasks

5. **In-Memory Caching**
   - Cache data untuk operasi frekuensi tinggi (chat messages)
   - Invalidate cache saat state berubah
   - Gunakan TTL untuk mencegah stale data

6. **Consolidated Updates (NEW!)**
   - Semua perubahan state dalam satu RPC call
   - Hindari await supabase.from(...).update(...) setelah RPC
   - Gunakan RPC yang return informasi yang diperlukan

## 8. Gift Transaction Consolidation (NEW!)

### Overview
Transaksi gift dikonsolidasi ke dalam satu RPC atomik untuk mengurangi round-trip dan memastikan konsistensi data.

### RPC Function
```sql
SELECT process_gift_transaction(
  p_sender_id := sender_user_id,
  p_gift_id := 'gift_rose',
  p_gift_name := 'Bunga Mawar',
  p_gift_price := 1
);
```

### What It Does (Atomically)
1. Validasi user sedang chatting
2. Cek saldo cukup
3. Kurangi saldo pengirim
4. Tambah saldo partner (75% payout)
5. Insert 2 log transaksi (gift_sent + gift_received)
6. Return semua data yang diperlukan UI

### Cost Savings
**Sebelum:** Gift transaction = 5 database operations
- SELECT sender (coins, state, partner_id)
- UPDATE sender coins
- INSERT coin_transaction (sender)
- SELECT partner coins
- UPDATE partner coins  
- INSERT coin_transaction (partner)
= 6 queries

**Sesudah:** Gift transaction = 1 RPC call

**Savings: 83%**

## 9. Promo Logic Optimization (NEW!)

### Overview
`handle_end_chat_promo_logic` dioptimasi untuk mengurangi write operations.

### Before
- Update `chat_end_count` setiap kali chat berakhir
- High frequency writes

### After
- Hanya update jika > 30 menit sejak promo terakhir
- Skip unnecessary writes untuk user yang end chat berkali-kali dalam waktu singkat

### Cost Savings
**Sebelum:** End chat = always 1 UPDATE untuk chat_end_count
**Sesudah:** End chat = UPDATE hanya jika interval > 30 menit

**Savings: ~50-70%** (tergantung pola penggunaan)

## 10. Logging Cleanup (NEW!)

### Removed Logs
- Raw request body logging
- Parsed update JSON logging
- Cache hit/set verbose logs
- RPC result full object logging
- sendMessage success/failure detailed logs

### Benefits
- Reduced Deno Deploy logging costs
- Faster execution (less I/O)
- Cleaner production logs

## 11. Removed Features (Cost Savings)

### Message Reactions Handler
- **Removed:** Handler untuk forward reaksi emoji ke partner
- **Reason:** Setiap reaction = 2 database queries (blocked check + state check)
- **Impact:** Zero cost untuk fitur yang jarang digunakan

### isUserBlocked on Every Callback
- **Removed:** Pengecekan blocked status di setiap callback query
- **Reason:** Cek blokir hanya perlu di saat search/next (ada di RPC)
- **Impact:** -1 query per callback = significant savings

## 12. Button Debounce System (NEW!)

### Overview
Sistem anti double-click menggunakan in-memory cache untuk mencegah eksekusi tombol berulang dalam waktu singkat.

### How It Works
```typescript
// Cache key: `${userId}_${action}`
// Cache value: timestamp last click
// Cooldown: berbeda per action type

// Cek apakah tombol dalam cooldown
if (isButtonOnCooldown(userId, actionType)) {
  await answerCallbackQuery(botToken, query.id, '⏳ Mohon tunggu sebentar...');
  return; // Block execution
}
```

### Cooldown Configuration
| Action | Cooldown |
|--------|----------|
| search_partner | 3 detik |
| chat_next | 3 detik |
| chat_stop | 2 detik |
| send_gift | 1.5 detik |
| init_topup | 3 detik |
| buy_premium | 3 detik |
| report_user | 2 detik |
| rate_asik | 2 detik |
| reconnect | 3 detik |
| pay_fine | 3 detik |
| cancel_* | 2 detik |
| gender/target/location | 1.5 detik |
| default | 1 detik |

### Cost Savings
**Sebelum:** User double-click → 2x database operations
**Sesudah:** User double-click → 1x operation (second click blocked)

**Contoh:**
- User panic-click "Next" 3x dalam 2 detik
- **Sebelum:** 3x RPC call = 3x biaya
- **Sesudah:** 1x RPC call = 1x biaya
- **Savings: 66%**

### Memory Management
- Cache cleanup otomatis jika size > 1000 entries
- Entry > 1 menit otomatis dihapus
- Minimal memory overhead
