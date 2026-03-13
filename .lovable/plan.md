

## Rencana: Hapus Sistem Filter Gratis, Filter Hanya untuk Premium

### Ringkasan
Menghapus seluruh logika "10x kesempatan filter gratis per hari" untuk non-premium. Filter gender/lokasi hanya bisa digunakan oleh user Premium. Non-premium selalu menggunakan pencarian default (semua gender, semua lokasi).

### Daftar Perubahan

#### 1. Edge Function `telegram-webhook/index.ts`

**A. Handler `change_location` (~baris 3815-3838)**
- Ganti panggilan `check_and_use_filter` RPC dengan pengecekan premium sederhana (query `premium_until` dari `telegram_users`)
- Jika non-premium: tampilkan pesan "Fitur ini khusus Premium" dengan keyboard beli premium (bukan pesan "kesempatan habis")
- Jika premium: langsung tampilkan pilihan lokasi tanpa info "sisa kesempatan"
- Hapus teks `remainingText` (baris ~3858)

**B. Handler `change_target` (~baris 4226-4248)**
- Sama seperti di atas: ganti `check_and_use_filter` dengan cek premium langsung
- Jika non-premium: tampilkan pesan premium-only
- Hapus teks `remainingText` (baris ~4266)

**C. `handleComprehensiveSearchResult` (~baris 2618-2642)**
- Sederhanakan: hapus logika `filterUsesToday`/`filterAllowed`
- `filterInfo` ditampilkan HANYA jika user premium, non-premium → `filterInfo = undefined`

**D. `autoSearchPartner` (~baris 2694-2714)**
- Sama: hapus logika `filter_uses_today`/`filter_uses_date`, cek hanya `isPremium`
- Non-premium → `filterInfo = undefined`

**E. Hapus fungsi `buildFilterExhaustedMessage` (~baris 1597-1612)**
- Ganti dengan pesan baru "Filter adalah fitur Premium" yang lebih singkat
- Update `buildPremiumOfferMessage` agar tidak mereferensikan fungsi yang dihapus

#### 2. Database RPC `comprehensive_search_action`
- Hapus semua logika `filter_uses_today`, `filter_uses_date`, `v_today_wib` terkait penghitungan kuota filter
- Hapus increment `filter_uses_today` untuk non-premium
- Sederhanakan: jika premium → gunakan filter, jika non-premium → paksa `target_gender = 'semua'`, `target_location = 'semua'`
- Logika yang sama untuk kandidat

#### 3. Database RPC `check_and_use_filter`
- Sederhanakan: hapus logika kuota harian
- Return `allowed = true` hanya jika premium, `allowed = false` jika non-premium
- Atau alternatif: hapus RPC ini sepenuhnya dan cek premium langsung di edge function (lebih hemat 1 RPC call)

#### 4. Kolom Database (Opsional - bisa dilakukan nanti)
- Kolom `filter_uses_today` dan `filter_uses_date` di tabel `telegram_users` menjadi tidak terpakai
- Bisa dihapus via migration, tapi tidak urgent karena tidak mengganggu fungsionalitas

### Yang TIDAK Berubah
- Fitur filter itu sendiri tetap ada untuk Premium
- Logika matching di RPC tetap menghormati filter Premium
- Pesan pencarian Premium tetap menampilkan target gender/lokasi
- Semua fitur lain (reputasi, reconnect, gift, dll) tidak terpengaruh

