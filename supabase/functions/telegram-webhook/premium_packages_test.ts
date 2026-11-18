import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildPremiumNormalKeyboard,
  buildPremiumPromoKeyboard,
  PREMIUM_NORMAL_PACKAGES,
  PREMIUM_PAY_CONFIG,
} from '../_shared/premium-packages.ts';

const referralRow = [{ text: '🎁 Premium Gratis dari Ajak Teman', callback_data: 'referral_menu' }];

Deno.test('normal premium menu sells only 1 Minggu 149 Stars and 1 Bulan 249 Stars', () => {
  const keyboard = buildPremiumNormalKeyboard(referralRow);
  assertEquals(keyboard.inline_keyboard.length, 3);
  assertEquals(keyboard.inline_keyboard[0], [
    { text: '📦 1 Minggu - 149 ⭐', callback_data: 'buy_premium_normal_7' },
  ]);
  assertEquals(keyboard.inline_keyboard[1], [
    { text: '📦 1 Bulan - 249 ⭐', callback_data: 'buy_premium_normal_30' },
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

Deno.test('promo premium menu keeps revised prices in the agreed order', () => {
  const keyboard = buildPremiumPromoKeyboard();
  assertEquals(keyboard.inline_keyboard.map((row: any[]) => row[0].callback_data), [
    'buy_premium_35',
    'buy_premium_30',
    'buy_premium_7',
    'buy_premium_3',
    'buy_premium_1',
    'dismiss_promo_search',
  ]);
  assertEquals(keyboard.inline_keyboard[0][0].text, '🔥 35 Hari / 149 ⭐ • 𝘙𝘦𝘬𝘰𝘮𝘦𝘯𝘥𝘢𝘴𝘪🔥');
  assertEquals(keyboard.inline_keyboard[1][0].text, '💎 30 Hari / 2̶4̶9̶ ⭐ ➡️ 139 ⭐');
  assertEquals(keyboard.inline_keyboard[2][0].text, '🔥 7 Hari / 1̶4̶9̶ ⭐ ➡️ 99 ⭐');
  assertEquals(keyboard.inline_keyboard[3][0].text, '📦 3 Hari / 79 ⭐');
  assertEquals(keyboard.inline_keyboard[4][0].text, '⚡ 1 Hari / 49 ⭐');
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
  assertEquals(oneDay.text.includes('̶'), false);
  assertEquals(oneDay.text, '⚡ 1 Hari / 49 ⭐');
});

Deno.test('only promo 35 Hari and 7 Hari use fire emoji', () => {
  const fireCallbacks = buildPremiumPromoKeyboard().inline_keyboard
    .flat()
    .filter((button: any) => button.text.includes('🔥'))
    .map((button: any) => button.callback_data);
  assertEquals(fireCallbacks, ['buy_premium_35', 'buy_premium_7']);
});

Deno.test('35 Hari recommendation label is visibly italic without unsupported button HTML', () => {
  const bestPackage = buildPremiumPromoKeyboard().inline_keyboard[0][0];
  assertEquals(bestPackage.text.includes('𝘙𝘦𝘬𝘰𝘮𝘦𝘯𝘥𝘢𝘴𝘪🔥'), true);
  assertEquals(bestPackage.text.includes('<i>'), false);
});

Deno.test('every promo package button is green and the dismiss button is plain', () => {
  const keyboard = buildPremiumPromoKeyboard();
  const packageButtons = keyboard.inline_keyboard.slice(0, 5).flat();
  assertEquals(packageButtons.length, 5);
  assertEquals(packageButtons.map((button: any) => button.style), [
    'success',
    'success',
    'success',
    'success',
    'success',
  ]);
  assertEquals(keyboard.inline_keyboard[5][0].style, undefined);
});

Deno.test('normal Stars invoice amounts match the normal package buttons', () => {
  assertEquals(PREMIUM_PAY_CONFIG.n7.stars, 149);
  assertEquals(PREMIUM_PAY_CONFIG.n30.stars, 249);
});

Deno.test('promo Stars invoice amounts match every revised promo button', () => {
  assertEquals(PREMIUM_PAY_CONFIG['35'].stars, 149);
  assertEquals(PREMIUM_PAY_CONFIG['30'].stars, 139);
  assertEquals(PREMIUM_PAY_CONFIG['7'].stars, 99);
  assertEquals(PREMIUM_PAY_CONFIG['3'].stars, 79);
  assertEquals(PREMIUM_PAY_CONFIG['1'].stars, 49);
});

Deno.test('no premium package button shows Rupiah', () => {
  const buttons = [...buildPremiumPromoKeyboard().inline_keyboard, ...buildPremiumNormalKeyboard(referralRow).inline_keyboard].flat();
  assertEquals(buttons.some((b: any) => b.text.includes('Rp')), false);
});
