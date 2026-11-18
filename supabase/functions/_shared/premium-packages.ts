// Kontrak penawaran dan tagihan paket Premium bot Telegram.
// Dipisah dari index.ts supaya harga tombol dan invoice dapat diuji tanpa menjalankan webhook.

export interface PremiumPackage {
  days: number;
  price: number;
  stars: number;
  label: string;
}

export interface PremiumPayConfig {
  days: number;
  price: number;
  label: string;
  stars?: number;
}

// Satu sumber harga untuk tombol, invoice Stars, dan pencatatan pembayaran.
export const PREMIUM_PAY_CONFIG: Record<string, PremiumPayConfig> = {
  '30': { days: 30, price: 28000, label: 'PREMIUM 30 HARI (PROMO SPESIAL)', stars: 139 },
  '365': { days: 365, price: 199000, label: 'PREMIUM 1 TAHUN (PROMO SPESIAL)' },
  '7': { days: 7, price: 19000, label: 'PREMIUM 7 HARI', stars: 99 },
  '3': { days: 3, price: 12000, label: 'PREMIUM 3 HARI', stars: 59 },
  '1': { days: 1, price: 7000, label: 'PREMIUM 1 HARI', stars: 29 },
  '35': { days: 35, price: 30000, label: 'PREMIUM 35 HARI', stars: 149 },
  'n1': { days: 1, price: 10000, label: 'PREMIUM 1 HARI' },
  'n7': { days: 7, price: 25000, label: 'PREMIUM 7 HARI', stars: 149 },
  'n30': { days: 30, price: 60000, label: 'PREMIUM 30 HARI', stars: 249 },
  'n365': { days: 365, price: 499000, label: 'PREMIUM 1 TAHUN' },
  'sp30': { days: 30, price: 15000, label: 'PREMIUM 30 HARI (PROMO HARI INI)', stars: 99 },
  'sp7': { days: 7, price: 10000, label: 'PREMIUM 7 HARI (PROMO HARI INI)', stars: 74 },
  'sp365': { days: 365, price: 99000, label: 'PREMIUM 1 TAHUN (PROMO HARI INI)', stars: 749 },
};

// Paket normal yang dijual (1 Hari dan 1 Tahun normal sudah dihentikan).
export const PREMIUM_NORMAL_PACKAGES: Record<'7' | '30', PremiumPackage> = {
  '7': { days: 7, price: 25000, stars: 149, label: '1 Minggu' },
  '30': { days: 30, price: 60000, stars: 249, label: '1 Bulan' },
};

export function buildPremiumNormalKeyboard(referralRow: any[]): any {
  const week = PREMIUM_NORMAL_PACKAGES['7'];
  const month = PREMIUM_NORMAL_PACKAGES['30'];
  return {
    inline_keyboard: [
      [{ text: `📦 ${week.label} - ⭐ ${week.stars}`, callback_data: 'buy_premium_normal_7' }],
      [{ text: `📦 ${month.label} - ⭐ ${month.stars}`, callback_data: 'buy_premium_normal_30' }],
      referralRow,
    ],
  };
}

// Susunan tombol promo terbatas 1 jam, berurutan dari paling menguntungkan.
// Telegram tidak mendukung HTML pada teks tombol; label Hemat memakai Unicode miring.
// Semua tombol paket berwarna hijau (style: 'success'); tombol Abaikan tetap biasa.
export const PREMIUM_PROMO_ROWS: Array<{ text: string; callback_data: string; style: string }> = [
  { text: '🔥 35 Hari / ⭐ 149 • (𝘏𝘦𝘮𝘢𝘵)🔥', callback_data: 'buy_premium_35', style: 'success' },
  { text: '💎 30 Hari / ⭐ 2̶4̶9̶ ➡️ ⭐ 139', callback_data: 'buy_premium_30', style: 'success' },
  { text: '🔥 7 Hari / ⭐ 1̶4̶9̶ ➡️ ⭐ 99', callback_data: 'buy_premium_7', style: 'success' },
  { text: '📦 3 Hari / ⭐ 59', callback_data: 'buy_premium_3', style: 'success' },
  { text: '⚡ 1 Hari / ⭐ 29', callback_data: 'buy_premium_1', style: 'success' },
];

export const PROMO_DISMISS_ROW = [{ text: '⏭️ Abaikan & Lanjut Cari Partner', callback_data: 'dismiss_promo_search' }];

export function buildPremiumPromoKeyboard(): any {
  return {
    inline_keyboard: [...PREMIUM_PROMO_ROWS.map((row) => [row]), PROMO_DISMISS_ROW],
  };
}

export const PREMIUM_PROMO_DURATION_MS = 60 * 60 * 1000;

// Dipakai oleh promo awal dan tombol Ganti Paket; timestamp promo tidak diperbarui saat kembali.
export const PREMIUM_PROMO_MESSAGE = `🚨 <b>PROMO TERBATAS! HANYA 1 JAM!</b> 🚨

⏰ <b>Berlaku 1 jam sejak pesan promo pertama dikirim!</b> - Jangan sampai kelewatan!

🎁 <b>PENAWARAN EKSKLUSIF:</b>
━━━━━━━━━━━━━━━━━━━━
🔥 <b>PREMIUM 35 HARI</b>
<b>HANYA ⭐ 149!</b>
<i>(Hemat)🔥</i>
━━━━━━━━━━━━━━━━━━━━
💥 <b>HARGA SPESIAL!</b>`;

export function premiumChangePackageCallback(configKey: string): string {
  return configKey.startsWith('n') || configKey.startsWith('sp')
    ? 'cancel_premium'
    : 'change_premium_promo';
}

export function isPremiumPromoExpired(sentAtMs: number, nowMs: number): boolean {
  if (!Number.isFinite(sentAtMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - sentAtMs > PREMIUM_PROMO_DURATION_MS;
}
