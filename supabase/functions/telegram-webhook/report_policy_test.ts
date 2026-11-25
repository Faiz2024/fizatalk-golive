import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { evidenceValid, REPORT_FREQUENCY_POLICY, reportRule, reportableMedia } from '../_shared/report-policy.ts';
import { telegramWebhookSecret, validWebhookSecret } from '../_shared/telegram-webhook-auth.ts';
import { handleReportCallback, handleReportEvidence } from '../_shared/report-handlers.ts';

const activeCard = (overrides: any = {}) => ({
  target_user_id: 200,
  admin_message_id: 777,
  report_count: 1,
  snippets: [{ context: 'partner', category: 'spam', label: 'Spam / Iklan Berulang', detail: 'Dilaporkan saat sesi chat berakhir', at: new Date().toISOString() }],
  status: 'pending', username: 'target', is_premium: false, updated_at: new Date().toISOString(), sanction_stage: 0,
  ...overrides,
});
const telegramCall = (actions: any[] = []) => (method: string, body: any) => {
  actions.push({ method, body });
  return Promise.resolve(method === 'sendMessage' ? { ok: true, result: { message_id: 888 } } : { ok: true });
};

Deno.test('partner report callback submits selected context and safe excerpt to the authoritative RPC', async () => {
  const calls: any[] = [];
  const response = await handleReportCallback({ data: 'rc_partner_spam_200', from: { id: 100 }, message: { message_id: 5, chat: { id: 100 } } }, {
    adminChat: undefined,
    db: { rpc: (name: string, params: any) => { calls.push({ name, params }); return Promise.resolve({ data: { success: true, silent: true } }); } },
    call: telegramCall(),
  });
  assertEquals(response?.status, 200);
  assertEquals(calls[0], { name: 'submit_context_report', params: {
    p_reporter_id: 100, p_reported_id: 200, p_context: 'partner', p_category: 'spam', p_source_id: 5,
    p_detail: 'Dilaporkan saat sesi chat berakhir',
  } });
});

Deno.test('database failure returns HTTP 500 so Telegram retries', async () => {
  const response = await handleReportCallback({ data: 'rc_media_sexual_200', from: { id: 100 }, message: { message_id: 5, chat: { id: 100 } } }, {
    adminChat: undefined, db: { rpc: () => Promise.resolve({ error: { message: 'unavailable' } }) }, call: telegramCall(),
  });
  assertEquals(response?.status, 500);
});

Deno.test('ordinary user cannot approve a permanent moderation decision', async () => {
  let writes = 0;
  const response = await handleReportCallback({ data: 'mod_ban_12345678-1234-1234-1234-123456789012', from: { id: 100 }, message: { message_id: 5, chat: { id: 999 } } }, {
    adminChat: '999', db: { rpc: () => { writes++; return Promise.resolve({ data: { success: true } }); } }, call: telegramCall(),
  });
  assertEquals(response?.status, 200);
  assertEquals(writes, 0);
});

Deno.test('serious media evidence is reviewed without copying illegal material', async () => {
  const actions: any[] = [];
  const response = await handleReportEvidence({ from: { id: 100 }, text: 'Penjelasan kejadian lengkap' }, { target: 200, context: 'media', source_id: 5, expires_at: new Date(Date.now() + 60000).toISOString() }, {
    adminChat: '999',
    db: { rpc: (name: string) => Promise.resolve({ data: name === 'set_admin_report_card_message' ? true : { success: true, review_id: 'review', report_card: activeCard({ admin_message_id: null, snippets: [] }) } }) },
    call: telegramCall(actions),
  });
  assertEquals(response.status, 200);
  assertEquals(actions.some(action => action.method === 'copyMessage'), false);
  assertEquals(actions.some(action => action.method === 'sendPhoto'), false);
  assertEquals(actions.some(action => action.method === 'pinChatMessage'), false);
  // Kartu gabungan + peninjauan prioritas untuk admin + konfirmasi pelapor.
  assertEquals(actions.filter(action => action.method === 'sendMessage').length, 3);
});

Deno.test('first ordinary report is aggregated to admin even below sanction threshold', async () => {
  const actions: any[] = [];
  await handleReportCallback({ data: 'rc_partner_spam_200', from: { id: 100 }, message: { message_id: 5, chat: { id: 100 } } }, {
    adminChat: '999',
    db: { rpc: () => Promise.resolve({ data: { success: true, silent: false, reached_threshold: false, sanction_stage: 0, report_card: activeCard() } }) },
    call: telegramCall(actions),
  });
  const adminEdit = actions.find(action => action.method === 'editMessageText' && action.body.chat_id === '999');
  assert(adminEdit.body.text.includes('Total Laporan: <b>1x</b>'));
  assertEquals(adminEdit.body.reply_markup.inline_keyboard.flat().map((button: any) => button.callback_data), [
    'rpa_restore_200', 'rpa_lock_200', 'rpa_block14_200', 'rpa_perm_200', 'rpa_ignore_200',
  ]);
  assertEquals(actions.some(action => action.method === 'pinChatMessage'), false);
  assertEquals(actions.some(action => action.method === 'sendMessage' && action.body.chat_id === 200), false);
});

Deno.test('automatic sanction explains its trigger to admin without exposing thresholds to the reported user', async () => {
  const actions: any[] = [];
  await handleReportCallback({ data: 'rc_partner_fraud_200', from: { id: 100 }, message: { message_id: 5, chat: { id: 100 } } }, {
    adminChat: '999',
    db: { rpc: () => Promise.resolve({ data: {
      success: true, reached_threshold: true, sanction_stage: 2, violation: 'Penipuan / penyebaran data pribadi', report_count: 2,
      report_card: activeCard({ report_count: 2, is_premium: true, premium_until: new Date().toISOString(), sanction_stage: 2, sanction_violation: 'Penipuan / penyebaran data pribadi', sanction_trigger: 'Kategori kritis • 2 pelapor dalam 12 jam' }),
    } }) },
    call: telegramCall(actions),
  });
  const admin = actions.find(action => action.method === 'editMessageText' && action.body.chat_id === '999');
  assert(admin.body.text.includes('PREMIUM'));
  assert(admin.body.text.includes('Tahap sanksi saat ini: <b>2</b>'));
  assert(admin.body.text.includes('Kategori kritis • 2 pelapor dalam 12 jam'));
  const user = actions.find(action => action.method === 'sendMessage' && action.body.chat_id === 200);
  assert(user.body.text.includes('Penipuan / penyebaran data pribadi'));
  assertEquals(user.body.text.includes('pelanggaran berulang'), false);
  assertEquals(user.body.text.includes('2 pelapor'), false);
  assertEquals(user.body.text.includes('12 jam'), false);
  assertEquals(actions.some(action => action.method === 'copyMessage'), false);
});

Deno.test('ignore only unpins the admin card and never edits its text or writes to the database', async () => {
  const actions: any[] = [];
  let writes = 0;
  const response = await handleReportCallback({ data: 'rpa_ignore_200', from: { id: 999 }, message: { message_id: 777, chat: { id: 999 } } }, {
    adminChat: '999',
    db: { rpc: () => { writes++; return Promise.resolve({ data: true }); } },
    call: telegramCall(actions),
  });
  assertEquals(response?.status, 200);
  assertEquals(writes, 0);
  assertEquals(actions.map(action => action.method), ['unpinChatMessage', 'answerCallbackQuery']);
  assertEquals(actions[0].body, { chat_id: 999, message_id: 777 });
});

Deno.test('non-admin cannot unpin another chat report', async () => {
  const actions: any[] = [];
  await handleReportCallback({ data: 'rpa_ignore_200', from: { id: 100 }, message: { message_id: 777, chat: { id: 999 } } }, {
    adminChat: '999', db: { rpc: () => Promise.resolve({ data: true }) }, call: telegramCall(actions),
  });
  assertEquals(actions.map(action => action.method), ['answerCallbackQuery']);
});

Deno.test('admin sanction closes and unpins the same aggregated card', async () => {
  const actions: any[] = [];
  const resolvedCard = activeCard({ status: 'resolved', last_action: 'block14', resolved_at: new Date().toISOString() });
  await handleReportCallback({ data: 'rpa_block14_200', from: { id: 999 }, message: { message_id: 777, chat: { id: 999 } } }, {
    adminChat: '999',
    db: { rpc: () => Promise.resolve({ data: { success: true, violation: 'Spam / Iklan Berulang', blocked_until: new Date().toISOString(), report_card: resolvedCard } }) },
    call: telegramCall(actions),
  });
  const adminEdit = actions.find(action => action.method === 'editMessageText' && action.body.chat_id === '999');
  assert(adminEdit.body.text.includes('SELESAI'));
  assertEquals(adminEdit.body.reply_markup, { inline_keyboard: [] });
  assertEquals(actions.some(action => action.method === 'unpinChatMessage' && action.body.message_id === 777), true);
  assertEquals(actions.some(action => action.method === 'pinChatMessage'), false);
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
for (const [context, category, threshold, sanction] of [
  ['partner', 'fraud', 2, 'block14'], ['partner', 'harassment', 3, 'lock_twice'], ['partner', 'spam', 3, 'block14'],
  ['link', 'fraud', 2, 'block14'], ['link', 'sexual', 2, 'block14'], ['link', 'promotion', 3, 'block14'], ['link', 'doxxing', 3, 'block14'],
  ['media', 'sexual', 3, 'lock_twice'], ['media', 'fraud', 2, 'block14'],
] as const) {
  Deno.test(`${context}/${category} requires ${threshold} distinct reporters and ${sanction}`, () => {
    assertEquals(reportRule(context, category)?.threshold, threshold);
    assertEquals(reportRule(context, category)?.sanction, sanction);
    assertEquals('points' in reportRule(context, category)!, false);
  });
}
Deno.test('frequency policy uses a 30-minute burst and 12-hour aggregate window', () => {
  assertEquals(REPORT_FREQUENCY_POLICY, { windowHours: 12, burstCount: 3, burstMinutes: 30, aggregateCount: 4 });
});
Deno.test('serious reports never receive an automatic threshold', () => {
  assertEquals(reportRule('partner', 'danger')?.threshold, null);
  assertEquals(reportRule('media', 'danger')?.threshold, null);
});
Deno.test('severe partner reports require explanation and safe screenshot', () => {
  assertEquals(evidenceValid('partner', 'Penjelasan kejadian lengkap', null), false);
  assertEquals(evidenceValid('partner', 'Penjelasan kejadian lengkap', 'safe-screenshot'), true);
});
Deno.test('severe media reports use explanation without requesting redistribution', () => {
  assertEquals(evidenceValid('media', 'Penjelasan kejadian lengkap', null), true);
  assertEquals(evidenceValid('media', '', null), false);
  assertEquals(reportRule('media', 'danger')?.review, true);
});
