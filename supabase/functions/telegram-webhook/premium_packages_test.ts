import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildPremiumNormalKeyboard,
  buildPremiumPromoKeyboard,
  isPremiumPromoExpired,
  PREMIUM_NORMAL_PACKAGES,
  PREMIUM_PAY_CONFIG,
  PREMIUM_PROMO_DURATION_MS,
  PREMIUM_PROMO_MESSAGE,
  premiumChangePackageCallback,
} from '../_shared/premium-packages.ts';

const referralRow = [{ text: '🎁 Premium Gratis dari Ajak Teman', callback_data: 'referral_menu' }];

Deno.test('normal premium menu shows Rp 25.000 for 1 Minggu and Rp 60.000 for 1 Bulan', () => {
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

Deno.test('promo premium menu shows every Rupiah price in the agreed order', () => {
  const keyboard = buildPremiumPromoKeyboard();
  assertEquals(keyboard.inline_keyboard.map((row: any[]) => row[0].callback_data), [
    'buy_premium_35',
    'buy_premium_30',
    'buy_premium_7',
    'buy_premium_3',
    'buy_premium_1',
    'dismiss_promo_search',
  ]);
  assertEquals(keyboard.inline_keyboard[0][0].text, '🔥 35 Hari / Rp 30.000 • (𝘏𝘦𝘮𝘢𝘵)🔥');
  assertEquals(keyboard.inline_keyboard[1][0].text, '💎 30 Hari / 𝑅̶𝑝̶6̶0̶.̶0̶0̶0̶ ➡️ Rp 28.000');
  assertEquals(keyboard.inline_keyboard[2][0].text, '🔥 7 Hari / 𝑅̶𝑝̶2̶5̶.̶0̶0̶0̶ ➡️ Rp 19.000');
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

Deno.test('promo 1 Hari button shows the plain Rupiah price without strikethrough', () => {
  const oneDay = buildPremiumPromoKeyboard().inline_keyboard[4][0];
  assertEquals(oneDay.text.includes('̶'), false);
  assertEquals(oneDay.text, '⚡ 1 Hari / Rp 7.000');
});

Deno.test('only promo 35 Hari and 7 Hari use fire emoji', () => {
  const fireCallbacks = buildPremiumPromoKeyboard().inline_keyboard
    .flat()
    .filter((button: any) => button.text.includes('🔥'))
    .map((button: any) => button.callback_data);
  assertEquals(fireCallbacks, ['buy_premium_35', 'buy_premium_7']);
});

Deno.test('35 Hari Hemat label is visibly italic without unsupported button HTML', () => {
  const bestPackage = buildPremiumPromoKeyboard().inline_keyboard[0][0];
  assertEquals(bestPackage.text.includes('(𝘏𝘦𝘮𝘢𝘵)🔥'), true);
  assertEquals(bestPackage.text.includes('𝘙𝘦𝘬𝘰𝘮𝘦𝘯𝘥𝘢𝘴𝘪'), false);
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

Deno.test('normal Stars invoice amounts remain unchanged after Rupiah labels return', () => {
  assertEquals(PREMIUM_PAY_CONFIG.n7.stars, 149);
  assertEquals(PREMIUM_PAY_CONFIG.n30.stars, 249);
});

Deno.test('promo Stars invoice amounts remain unchanged after Rupiah labels return', () => {
  assertEquals(PREMIUM_PAY_CONFIG['35'].stars, 149);
  assertEquals(PREMIUM_PAY_CONFIG['30'].stars, 139);
  assertEquals(PREMIUM_PAY_CONFIG['7'].stars, 99);
  assertEquals(PREMIUM_PAY_CONFIG['3'].stars, 59);
  assertEquals(PREMIUM_PAY_CONFIG['1'].stars, 29);
});

Deno.test('every normal and promo package option displays Rupiah instead of Stars', () => {
  const buttons = [...buildPremiumPromoKeyboard().inline_keyboard, ...buildPremiumNormalKeyboard(referralRow).inline_keyboard]
    .flat()
    .filter((button: any) => button.callback_data?.startsWith('buy_premium_'));
  assertEquals(buttons.length, 7);
  assertEquals(buttons.every((button: any) => button.text.includes('Rp') || button.text.includes('𝑅̶𝑝̶')), true);
  assertEquals(buttons.some((button: any) => button.text.includes('⭐')), false);
});

Deno.test('Ganti Paket returns regular promo purchases to the promo menu only', () => {
  assertEquals(premiumChangePackageCallback('35'), 'change_premium_promo');
  assertEquals(premiumChangePackageCallback('30'), 'change_premium_promo');
  assertEquals(premiumChangePackageCallback('7'), 'change_premium_promo');
  assertEquals(premiumChangePackageCallback('3'), 'change_premium_promo');
  assertEquals(premiumChangePackageCallback('1'), 'change_premium_promo');
  assertEquals(premiumChangePackageCallback('n7'), 'cancel_premium');
  assertEquals(premiumChangePackageCallback('n30'), 'cancel_premium');
  assertEquals(premiumChangePackageCallback('sp30'), 'cancel_premium');
});

Deno.test('regular promo validity remains exactly one hour', () => {
  const sentAt = Date.UTC(2026, 10, 18, 4, 0, 0);
  assertEquals(PREMIUM_PROMO_DURATION_MS, 3_600_000);
  assertEquals(isPremiumPromoExpired(sentAt, sentAt + PREMIUM_PROMO_DURATION_MS), false);
  assertEquals(isPremiumPromoExpired(sentAt, sentAt + PREMIUM_PROMO_DURATION_MS + 1), true);
});

Deno.test('returning to the promo reuses the Hemat message without a new timestamp', () => {
  assertEquals(PREMIUM_PROMO_MESSAGE.includes('<i>(Hemat)🔥</i>'), true);
  assertEquals(PREMIUM_PROMO_MESSAGE.includes('HANYA Rp 30.000!'), true);
  assertEquals(PREMIUM_PROMO_MESSAGE.includes('1 jam sejak pesan promo pertama dikirim'), true);
});
