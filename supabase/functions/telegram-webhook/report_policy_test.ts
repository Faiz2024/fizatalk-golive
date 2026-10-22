import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { evidenceValid, reportRule, reportableMedia } from '../_shared/report-policy.ts';
import { telegramWebhookSecret, validWebhookSecret } from '../_shared/telegram-webhook-auth.ts';
import { handleReportCallback, handleReportEvidence } from '../_shared/report-handlers.ts';

Deno.test('partner report callback submits selected context to the authoritative RPC', async () => {
  const calls: any[] = [];
  const response = await handleReportCallback({ data: 'rc_partner_spam_200', from: { id: 100 }, message: { message_id: 5, chat: { id: 100 } } }, {
    adminChat: undefined,
    db: { rpc: (name: string, params: any) => { calls.push({ name, params }); return Promise.resolve({ data: { success: true, silent: true } }); } },
    call: () => Promise.resolve({ ok: true }),
  });
  assertEquals(response?.status, 200);
  assertEquals(calls[0], { name: 'submit_context_report', params: { p_reporter_id: 100, p_reported_id: 200, p_context: 'partner', p_category: 'spam' } });
});
Deno.test('database failure returns HTTP 500 so Telegram retries', async () => {
  const response = await handleReportCallback({ data: 'rc_media_sexual_200', from: { id: 100 }, message: { message_id: 5, chat: { id: 100 } } }, {
    adminChat: undefined, db: { rpc: () => Promise.resolve({ error: { message: 'unavailable' } }) }, call: () => Promise.resolve({ ok: true }),
  });
  assertEquals(response?.status, 500);
});
Deno.test('ordinary user cannot approve a permanent moderation decision', async () => {
  let writes = 0;
  const response = await handleReportCallback({ data: 'mod_ban_12345678-1234-1234-1234-123456789012', from: { id: 100 }, message: { message_id: 5, chat: { id: 999 } } }, {
    adminChat: '999', db: { rpc: () => { writes++; return Promise.resolve({ data: { success: true } }); } }, call: () => Promise.resolve({ ok: true }),
  });
  assertEquals(response?.status, 200);
  assertEquals(writes, 0);
});
Deno.test('serious media evidence is reviewed without copying illegal material', async () => {
  const actions: string[] = [];
  const response = await handleReportEvidence({ from: { id: 100 }, text: 'Penjelasan kejadian lengkap' }, { target: 200, context: 'media', source_id: 5, expires_at: new Date(Date.now() + 60000).toISOString() }, {
    adminChat: '999', db: { rpc: () => Promise.resolve({ data: { success: true, review_id: 'review' } }) },
    call: (method: string) => { actions.push(method); return Promise.resolve({ ok: true }); },
  });
  assertEquals(response.status, 200);
  assertEquals(actions.includes('copyMessage'), false);
  assertEquals(actions.includes('sendPhoto'), false);
  assertEquals(actions.filter(a => a === 'sendMessage').length, 3);
});

Deno.test('forged or missing Telegram webhook secrets cannot authorize updates', async () => {
  const expected = await telegramWebhookSecret('test-bot-token');
  assertEquals(validWebhookSecret(null, expected), false);
  assertEquals(validWebhookSecret('forged', expected), false);
  assertEquals(validWebhookSecret(await telegramWebhookSecret('other-token'), expected), false);
  assertEquals(validWebhookSecret(expected, expected), true);
});

Deno.test('reports are available for both Premium and regular users', () => {
  assertEquals(reportableMedia(true), true);
  assertEquals(reportableMedia(false), true);
});
Deno.test('silent partner and quick skip are not violations', () => {
  assertEquals(reportRule('partner', 'inactive'), undefined);
  assertEquals(reportRule('partner', 'skip'), undefined);
});
for (const [context, category, points] of [
  ['partner', 'fraud', 25], ['partner', 'harassment', 15], ['partner', 'spam', 10],
  ['link', 'fraud', 25], ['link', 'sexual', 20], ['link', 'promotion', 10], ['link', 'doxxing', 20],
  ['media', 'sexual', 20], ['media', 'fraud', 15],
] as const) {
  Deno.test(`${context}/${category} applies ${points} penalty points`, () => {
    assertEquals(reportRule(context, category)?.points, points);
  });
}
Deno.test('severe partner reports require explanation and safe screenshot', () => {
  assertEquals(evidenceValid('partner', 'Penjelasan kejadian lengkap', null), false);
  assertEquals(evidenceValid('partner', 'Penjelasan kejadian lengkap', 'safe-screenshot'), true);
});
Deno.test('severe media reports use explanation without requesting redistribution', () => {
  assertEquals(evidenceValid('media', 'Penjelasan kejadian lengkap', null), true);
  assertEquals(evidenceValid('media', '', null), false);
  assertEquals(reportRule('media', 'danger')?.review, true);
});