import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildEndChatKeyboard,
  buildNextRatingRows,
  WOLA_BOT_URL,
  wolaChatButton
} from '../_shared/end-chat-keyboard.ts';

const WOLA_TEXT = '🚀Coba Wola - Chat Bot!';

Deno.test('end chat keyboard puts the green Wola button under Call Acak and Cari Partner Baru', () => {
  const keyboard = buildEndChatKeyboard(101, 'FizaVoiceBot');
  const rows = keyboard.inline_keyboard;

  assertEquals(rows[0].map((b: any) => b.text), ['🚩 Laporkan', '😎 Asik', '👍 Baik']);
  assertEquals(rows[1].map((b: any) => b.text), ['🎙️ Call Acak', '🔍 Cari Partner Baru']);
  assertEquals(rows[2], [{ text: WOLA_TEXT, style: 'success', url: WOLA_BOT_URL }]);
  assertEquals(rows[3], [{ text: '🔄 Hubungi Kembali', callback_data: 'reconnect_101' }]);
  assertEquals(rows.length, 4);
});

Deno.test('Wola button opens @WolaChatBot in green without needing a voice bot', () => {
  const keyboard = buildEndChatKeyboard(202, null);
  const rows = keyboard.inline_keyboard;

  assertEquals(rows[1].map((b: any) => b.text), ['🔍 Cari Partner Baru']);
  assertEquals(rows[2], [{ text: WOLA_TEXT, style: 'success', url: 'https://t.me/WolaChatBot' }]);
  assertEquals(wolaChatButton().url, WOLA_BOT_URL);
  assertEquals(rows.length, 4);
});

Deno.test('next search keyboard shows the Wola button under the partner rating row', () => {
  const rows = buildNextRatingRows(303);

  assertEquals(rows.length, 2);
  assertEquals(rows[0].map((b: any) => b.callback_data), ['report_user_303', 'rate_asik_303', 'rate_baik_303']);
  assertEquals(rows[1], [{ text: WOLA_TEXT, style: 'success', url: WOLA_BOT_URL }]);
});
