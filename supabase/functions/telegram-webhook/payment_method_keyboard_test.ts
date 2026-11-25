import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildPaymentMethodKeyboard,
  isAllowedPaymentMethod,
} from '../_shared/payment-method-keyboard.ts';

Deno.test('payment keyboard places QRIS and GoPay side-by-side on row 1 without DANA', () => {
  const kb = buildPaymentMethodKeyboard({
    baseCallback: 'prem_pay_30',
    cancelCallback: 'change_premium_promo',
    backLabel: '🔙 Ganti Paket',
    starsPrice: 139,
    starsInvoiceUrl: 'https://t.me/$invoice123',
  });

  assertEquals(kb.inline_keyboard.length, 3);
  assertEquals(kb.inline_keyboard[0], [
    { text: '📱 QRIS', callback_data: 'prem_pay_30_QRIS' },
    { text: '🟢 GoPay', callback_data: 'prem_pay_30_GOPAY' },
  ]);
  assertEquals(kb.inline_keyboard[1], [
    { text: '⭐ Telegram Stars (139 ⭐)', url: 'https://t.me/$invoice123' },
  ]);
  assertEquals(kb.inline_keyboard[2], [
    { text: '🔙 Ganti Paket', callback_data: 'change_premium_promo' },
  ]);

  const allButtons = kb.inline_keyboard.flat();
  assertEquals(allButtons.some((b) => b.text.toUpperCase().includes('DANA')), false);
  assertEquals(allButtons.some((b) => (b.callback_data || '').includes('DANA')), false);
});

Deno.test('payment keyboard falls back to Stars callback and default Back label', () => {
  const kb = buildPaymentMethodKeyboard({
    baseCallback: 'topup_pay_100',
    cancelCallback: 'cancel_topup',
    starsPrice: 8,
  });

  assertEquals(kb.inline_keyboard[0], [
    { text: '📱 QRIS', callback_data: 'topup_pay_100_QRIS' },
    { text: '🟢 GoPay', callback_data: 'topup_pay_100_GOPAY' },
  ]);
  assertEquals(kb.inline_keyboard[1], [
    { text: '⭐ Telegram Stars (8 ⭐)', callback_data: 'topup_pay_100_STARS' },
  ]);
  assertEquals(kb.inline_keyboard[2], [
    { text: '🔙 Kembali', callback_data: 'cancel_topup' },
  ]);
});

Deno.test('only QRIS, GoPay, and Telegram Stars are allowed payment methods', () => {
  assertEquals(isAllowedPaymentMethod('QRIS'), true);
  assertEquals(isAllowedPaymentMethod('GOPAY'), true);
  assertEquals(isAllowedPaymentMethod('STARS'), true);
  assertEquals(isAllowedPaymentMethod('DANA'), false);
  assertEquals(isAllowedPaymentMethod('OVO'), false);
  assertEquals(isAllowedPaymentMethod('SHOPEEPAY'), false);
  assertEquals(isAllowedPaymentMethod(''), false);
});