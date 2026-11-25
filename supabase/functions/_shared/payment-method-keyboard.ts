export type ActivePaymentMethod = 'QRIS' | 'GOPAY' | 'STARS';

export interface PaymentMethodKeyboardOptions {
  baseCallback: string;
  cancelCallback?: string;
  backLabel?: string;
  starsPrice?: number;
  starsInvoiceUrl?: string;
}

export function isAllowedPaymentMethod(method: string): method is ActivePaymentMethod {
  return method === 'QRIS' || method === 'GOPAY' || method === 'STARS';
}

// Susunan tombol metode pembayaran:
// Baris 1: QRIS dan GoPay berdampingan (tanpa DANA)
// Baris 2: Telegram Stars
// Baris 3: Kembali / Ganti Paket
export function buildPaymentMethodKeyboard(options: PaymentMethodKeyboardOptions) {
  const { baseCallback, cancelCallback, backLabel, starsPrice, starsInvoiceUrl } = options;
  const starsLabel = starsPrice !== undefined
    ? `⭐ Telegram Stars (${starsPrice} ⭐)`
    : '⭐ Telegram Stars';

  const kb: Array<Array<Record<string, string>>> = [
    [
      { text: '📱 QRIS', callback_data: `${baseCallback}_QRIS` },
      { text: '🟢 GoPay', callback_data: `${baseCallback}_GOPAY` },
    ],
    [
      starsInvoiceUrl
        ? { text: starsLabel, url: starsInvoiceUrl }
        : { text: starsLabel, callback_data: `${baseCallback}_STARS` },
    ],
  ];

  if (cancelCallback) {
    kb.push([{ text: backLabel || '🔙 Kembali', callback_data: cancelCallback }]);
  }

  return { inline_keyboard: kb };
}