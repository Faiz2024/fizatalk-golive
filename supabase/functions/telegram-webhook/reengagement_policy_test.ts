import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { privateBotMembership, reengagementWindow, runReengagementDrip } from '../_shared/reengagement-policy.ts';
import { handleBotMembership } from '../_shared/bot-membership.ts';

const event = (status: string) => ({ my_chat_member: {
  from: { id: 123 }, chat: { id: 5435916992, type: 'private' },
  new_chat_member: { status },
} });
const noon = Date.parse('2026-11-28T12:00:00+07:00');

Deno.test('blokir menargetkan pemilik private chat, bukan pelaku event', () => {
  assertEquals(privateBotMembership(event('kicked')), { userId: 5435916992, blocked: true });
});
Deno.test('buka blokir kembali menjadi membership normal', () => {
  assertEquals(privateBotMembership(event('member')), { userId: 5435916992, blocked: false });
});
Deno.test('membership grup tidak memblokir akun pengguna', () => {
  const update = event('kicked'); update.my_chat_member.chat.type = 'group';
  assertEquals(privateBotMembership(update), null);
});
Deno.test('jadwal dimulai tepat 11 WIB', () => {
  assertEquals(reengagementWindow(Date.parse('2026-11-28T10:59:59+07:00')), false);
  assertEquals(reengagementWindow(Date.parse('2026-11-28T11:00:00+07:00')), true);
});
Deno.test('jadwal berakhir tepat 22 WIB', () => {
  assertEquals(reengagementWindow(Date.parse('2026-11-28T21:59:59+07:00')), true);
  assertEquals(reengagementWindow(Date.parse('2026-11-28T22:00:00+07:00')), false);
});
Deno.test('maksimal 50 penerima per putaran', async () => {
  let count = 0;
  const processed = await runReengagementDrip(Array.from({ length: 60 }), async () => { count++; return true; }, async () => {}, () => noon);
  assertEquals(count, 50); assertEquals(processed, 50);
});
Deno.test('pengiriman tunggal berjeda 1,5 detik', async () => {
  const waits: number[] = []; const sent: number[] = [];
  await runReengagementDrip([1,2,3], async (id) => { sent.push(id); return true; }, async (ms) => { waits.push(ms); }, () => noon);
  assertEquals(sent, [1,2,3]); assertEquals(waits, [1500,1500]);
});
Deno.test('rate limit menghentikan sisa batch tanpa burst ulang', async () => {
  const sent: number[] = [];
  const processed = await runReengagementDrip([1,2,3], async id => { sent.push(id); return false; }, async () => {}, () => noon);
  assertEquals(processed, 1); assertEquals(sent, [1]);
});
Deno.test('batas waktu 100 detik menghentikan batch', async () => {
  let time = noon; let sent = 0;
  await runReengagementDrip([1,2], async () => { sent++; time += 100_000; return true; }, async () => {}, () => time);
  assertEquals(sent, 1);
});
Deno.test('membership memakai satu RPC dan hanya memberi tahu partner yang dilepas', async () => {
  const calls: unknown[] = []; const notified: number[] = [];
  await handleBotMembership(event('kicked'), { rpc: (name: string, args: unknown) => {
    calls.push([name,args]); return Promise.resolve({ data: { changed: true, partner_id: 42 }, error: null });
  } }, async id => { notified.push(id); });
  assertEquals(calls, [['set_bot_membership', { p_user_id: 5435916992, p_blocked: true }]]);
  assertEquals(notified, [42]);
});
Deno.test('event duplikat tidak mengirim pemberitahuan partner lagi', async () => {
  let sent = 0;
  await handleBotMembership(event('kicked'), { rpc: () => Promise.resolve({ data: { changed: false }, error: null }) }, async () => { sent++; });
  assertEquals(sent, 0);
});
Deno.test('kegagalan membership tidak mengirim notifikasi seolah berhasil', async () => {
  let sent = 0;
  await assertRejects(() => handleBotMembership(event('kicked'), { rpc: () => Promise.resolve({ error: new Error('busy') }) }, async () => { sent++; }));
  assertEquals(sent, 0);
});