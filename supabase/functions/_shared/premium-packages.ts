// Kontrak penawaran paket Premium bot Telegram.
// Dipisah dari index.ts supaya susunan paket bisa diuji tanpa menjalankan webhook.
// Harga di sini adalah harga tampil; pembayaran tetap memakai PREMIUM_PAY_CONFIG.

export interface PremiumPackage {
  days: number;
  price: number;
  label: string;
}

function rupiah(price: number): string {
  return `Rp ${price.toLocaleString('id-ID')}`;
}

// Meniru coretan harga Telegram: setiap karakter dibungkus combining stroke U+0336.
function strike(value: string): string {
  return [...value]
    .map((char) => {
      const base = char === 'R' ? '\u{1D445}' : char === 'p' ? '\u{1D45D}' : char;
      return `${base}\u0336`;
    })
    .join('');
}

// Paket normal yang dijual (1 Hari dan 1 Tahun normal sudah dihentikan).
export const PREMIUM_NORMAL_PACKAGES: Record<'7' | '30', PremiumPackage> = {
  '7': { days: 7, price: 25000, label: '1 Minggu' },
  '30': { days: 30, price: 60000, label: '1 Bulan' },
};

export function buildPremiumNormalKeyboard(referralRow: any[]): any {
  const week = PREMIUM_NORMAL_PACKAGES['7'];
  const month = PREMIUM_NORMAL_PACKAGES['30'];
  return {
    inline_keyboard: [
      [{ text: `📦 ${week.label} - ${rupiah(week.price)}`, callback_data: 'buy_premium_normal_7' }],
      [{ text: `📦 ${month.label} - ${rupiah(month.price)}`, callback_data: 'buy_premium_normal_30' }],
      referralRow,
    ],
  };
}

// Susunan tombol promo terbatas 1 jam, berurutan dari paling menguntungkan.
// Semua tombol paket berwarna hijau (style: 'success'); tombol Abaikan tetap biasa.
export const PREMIUM_PROMO_ROWS: Array<{ text: string; callback_data: string; style: string }> = [
  { text: '💎 35 Hari / Rp 30.000', callback_data: 'buy_premium_35', style: 'success' },
  { text: `🔥 30 Hari / ${strike('Rp60.000')} ➡️ Rp 28.000`, callback_data: 'buy_premium_30', style: 'success' },
  { text: `📦 7 Hari / ${strike('Rp25.000')} ➡️ Rp 19.000`, callback_data: 'buy_premium_7', style: 'success' },
  { text: '📦 3 Hari / Rp 12.000', callback_data: 'buy_premium_3', style: 'success' },
  { text: '⚡ 1 Hari / Rp 7.000', callback_data: 'buy_premium_1', style: 'success' },
];

export const PROMO_DISMISS_ROW = [{ text: '⏭️ Abaikan & Lanjut Cari Partner', callback_data: 'dismiss_promo_search' }];

export function buildPremiumPromoKeyboard(): any {
  return {
    inline_keyboard: [...PREMIUM_PROMO_ROWS.map((row) => [row]), PROMO_DISMISS_ROW],
  };
}
