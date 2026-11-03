import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildPremiumNormalKeyboard,
  buildPremiumPromoKeyboard,
  PREMIUM_NORMAL_PACKAGES,
} from '../_shared/premium-packages.ts';

const referralRow = [{ text: '🎁 Premium Gratis dari Ajak Teman', callback_data: 'referral_menu' }];

Deno.test('normal premium menu sells only 1 Minggu Rp25.000 and 1 Bulan Rp60.000', () => {
  const keyboard = buildPremiumNormalKeyboard(referralRow);
  assertEquals(keyboard.inline_keyboard.length, 3);
  assertEquals(keyboard.inline_keyboard[0], [
    { text: '📦 1 Minggu - Rp 25.000', callback_data: 'buy_premium_normal_7' },
  ]);
  assertEquals(keyboard.inline_keyboard[1], [
    { text: '📦 1 Bulan - Rp 60.000', callback_data: 'buy_premium_normal_30' },
  ]);
  assertEquals(keyboard.inline_keyboard[2], referralRow);
});

Deno.test('normal premium menu no longer offers 1 Hari or 1 Tahun', () => {
  const keyboard = buildPremiumNormalKeyboard(referralRow);
  const callbacks = keyboard.inline_keyboard.flat().map((button: any) => button.callback_data);
  assertEquals(callbacks.includes('buy_premium_normal_1'), false);
  assertEquals(callbacks.includes('buy_premium_normal_365'), false);
  assertEquals(Object.keys(PREMIUM_NORMAL_PACKAGES), ['7', '30']);
});

Deno.test('promo premium menu keeps current prices in the agreed order', () => {
  const keyboard = buildPremiumPromoKeyboard();
  assertEquals(keyboard.inline_keyboard.map((row: any[]) => row[0].callback_data), [
    'buy_premium_35',
    'buy_premium_30',
    'buy_premium_7',
    'buy_premium_3',
    'buy_premium_1',
    'dismiss_promo_search',
  ]);
  assertEquals(keyboard.inline_keyboard[0][0].text, '💎 35 Hari / Rp 30.000');
  assertEquals(keyboard.inline_keyboard[1][0].text.includes('Rp 28.000'), true);
  assertEquals(keyboard.inline_keyboard[2][0].text.includes('Rp 19.000'), true);
  assertEquals(keyboard.inline_keyboard[3][0].text, '📦 3 Hari / Rp 12.000');
  assertEquals(keyboard.inline_keyboard[4][0].text, '⚡ 1 Hari / Rp 7.000');
});

Deno.test('promo premium menu has no referral button and no 1 Tahun package', () => {
  const keyboard = buildPremiumPromoKeyboard();
  const buttons = keyboard.inline_keyboard.flat();
  const callbacks = buttons.map((button: any) => button.callback_data);
  assertEquals(callbacks.includes('referral_menu'), false);
  assertEquals(callbacks.includes('buy_premium_365'), false);
  assertEquals(buttons.some((button: any) => button.text.includes('1 Tahun')), false);
});

Deno.test('promo 1 Hari button shows the plain price without strikethrough', () => {
  const oneDay = buildPremiumPromoKeyboard().inline_keyboard[4][0];
  assertEquals(oneDay.text.includes('\u0336'), false);
  assertEquals(oneDay.text, '⚡ 1 Hari / Rp 7.000');
});
