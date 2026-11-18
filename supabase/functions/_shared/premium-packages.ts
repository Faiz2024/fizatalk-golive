// Kontrak penawaran paket Premium bot Telegram.
// Dipisah dari index.ts supaya susunan paket bisa diuji tanpa menjalankan webhook.
// Harga di sini adalah harga tampil; pembayaran tetap memakai PREMIUM_PAY_CONFIG.

export interface PremiumPackage {
  days: number;
  price: number;
  stars: number;
  label: string;
}


// Paket normal yang dijual (1 Hari dan 1 Tahun normal sudah dihentikan).
export const PREMIUM_NORMAL_PACKAGES: Record<'7' | '30', PremiumPackage> = {
  '7': { days: 7, price: 25000, stars: 99, label: '1 Minggu' },
  '30': { days: 30, price: 60000, stars: 249, label: '1 Bulan' },
};

export function buildPremiumNormalKeyboard(referralRow: any[]): any {
  const week = PREMIUM_NORMAL_PACKAGES['7'];
  const month = PREMIUM_NORMAL_PACKAGES['30'];
  return {
    inline_keyboard: [
      [{ text: `📦 ${week.label} - ${week.stars} ⭐`, callback_data: 'buy_premium_normal_7' }],
      [{ text: `📦 ${month.label} - ${month.stars} ⭐`, callback_data: 'buy_premium_normal_30' }],
      referralRow,
    ],
  };
}

// Susunan tombol promo terbatas 1 jam, berurutan dari paling menguntungkan.
// Semua tombol paket berwarna hijau (style: 'success'); tombol Abaikan tetap biasa.
export const PREMIUM_PROMO_ROWS: Array<{ text: string; callback_data: string; style: string }> = [
  { text: '💎 35 Hari / 129 ⭐', callback_data: 'buy_premium_35', style: 'success' },
  { text: '🔥 30 Hari / 119 ⭐', callback_data: 'buy_premium_30', style: 'success' },
  { text: '📦 7 Hari / 79 ⭐', callback_data: 'buy_premium_7', style: 'success' },
  { text: '📦 3 Hari / 49 ⭐', callback_data: 'buy_premium_3', style: 'success' },
  { text: '⚡ 1 Hari / 29 ⭐', callback_data: 'buy_premium_1', style: 'success' },
];

export const PROMO_DISMISS_ROW = [{ text: '⏭️ Abaikan & Lanjut Cari Partner', callback_data: 'dismiss_promo_search' }];

export function buildPremiumPromoKeyboard(): any {
  return {
    inline_keyboard: [...PREMIUM_PROMO_ROWS.map((row) => [row]), PROMO_DISMISS_ROW],
  };
}
