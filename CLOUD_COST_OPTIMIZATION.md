# Cloud Cost Optimization Guide

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
