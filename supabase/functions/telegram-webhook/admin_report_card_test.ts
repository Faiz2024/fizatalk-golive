import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { adminReportKeyboard, renderAdminReportCard, reportSnippet, syncAdminReportCard } from '../_shared/admin-report-card.ts';

const card = (overrides: any = {}) => ({
  target_user_id: 200,
  admin_message_id: null,
  report_count: 1,
  snippets: [{ context: 'link', category: 'sexual', label: 'Link Grup Porno / VCS', detail: 'join https://t.me/contoh', at: '2026-11-21T07:05:00+07:00' }],
  status: 'pending',
  username: 'terlapor',
  is_premium: false,
  updated_at: '2026-11-21T07:05:00+07:00',
  sanction_stage: 0,
  ...overrides,
});

Deno.test('link snippet keeps the reported text and limits it to 100 characters', () => {
  assertEquals(reportSnippet({ text: '  https://t.me/contoh  ' }, 'link'), 'https://t.me/contoh');
  assertEquals(reportSnippet({ text: 'x'.repeat(140) }, 'link').length, 100);
});

Deno.test('media snippet identifies visual type and caption without retaining a file', () => {
  assertEquals(reportSnippet({ photo: [{ file_id: 'secret-file' }], caption: 'cek foto' }, 'media'), 'Media: 📷 Foto • Caption: cek foto');
  assertEquals(reportSnippet({ video_note: { file_id: 'secret-file' } }, 'media'), 'Media: ⭕ Video Note (tanpa caption)');
});

Deno.test('partner snippet only references the ended session', () => {
  assertEquals(reportSnippet({ text: 'isi chat tidak disalin' }, 'partner'), 'Dilaporkan saat sesi chat berakhir');
});

Deno.test('card renders report type, context, count and escaped reported content', () => {
  const text = renderAdminReportCard(card({ snippets: [{ context: 'link', label: '<b>Penipuan</b>', detail: '<script>alert(1)</script>', at: '2026-11-21T07:05:00+07:00' }] }));
  assert(text.includes('<b>Penipuan</b>') === false);
  assert(text.includes('&lt;b&gt;Penipuan&lt;/b&gt;'));
  assert(text.includes('&lt;script&gt;'));
  assert(text.includes('Konteks: Link/Username'));
  assert(text.includes('Total Laporan: <b>1x</b>'));
  assert(text.includes('WIB'));
});

Deno.test('card hides overflow count and admin keyboard includes five actions', () => {
  const text = renderAdminReportCard(card({ report_count: 9 }));
  assert(text.includes('… dan 8 laporan lainnya.'));
  assertEquals(adminReportKeyboard(200).inline_keyboard.flat().map((button: any) => button.callback_data), [
    'rpa_restore_200', 'rpa_lock_200', 'rpa_block14_200', 'rpa_perm_200', 'rpa_ignore_200',
  ]);
});

Deno.test('resolved card states the admin action and removes report keyboard', () => {
  const resolved = card({ status: 'resolved', last_action: 'block14', resolved_at: '2026-11-21T08:00:00+07:00' });
  const text = renderAdminReportCard(resolved);
  assert(text.includes('Sudah ditindak'));
  assert(text.includes('Diblokir 14 hari tanpa tebus'));
});

Deno.test('first report sends one admin card without pinning then saves its message id', async () => {
  const actions: any[] = [];
  const rpcs: any[] = [];
  const result = await syncAdminReportCard(card(), {
    adminChat: '999',
    db: { rpc: (name: string, params: any) => { rpcs.push({ name, params }); return Promise.resolve({ data: true }); } },
    call: (method: string, body: any) => {
      actions.push({ method, body });
      return Promise.resolve(method === 'sendMessage' ? { ok: true, result: { message_id: 321 } } : { ok: true });
    },
  });
  assertEquals(result.ok, true);
  assertEquals(actions.map(action => action.method), ['sendMessage']);
  assertEquals(rpcs[0], { name: 'set_admin_report_card_message', params: { p_target_user_id: 200, p_expected_message_id: null, p_new_message_id: 321 } });
});

Deno.test('subsequent report edits the existing admin message without pinning or a database write', async () => {
  const actions: any[] = [];
  let writes = 0;
  const result = await syncAdminReportCard(card({ admin_message_id: 321, report_count: 2 }), {
    adminChat: '999',
    db: { rpc: () => { writes++; return Promise.resolve({ data: true }); } },
    call: (method: string, body: any) => { actions.push({ method, body }); return Promise.resolve({ ok: true }); },
  });
  assertEquals(result.ok, true);
  assertEquals(actions.map(action => action.method), ['editMessageText']);
  assertEquals(actions[0].body.message_id, 321);
  assertEquals(writes, 0);
});

Deno.test('deleted admin message falls back to a new card without pinning and replaces the saved id', async () => {
  const actions: any[] = [];
  const result = await syncAdminReportCard(card({ admin_message_id: 321 }), {
    adminChat: '999',
    db: { rpc: () => Promise.resolve({ data: true }) },
    call: (method: string) => {
      actions.push(method);
      if (method === 'editMessageText') return Promise.resolve({ ok: false, description: 'Bad Request: message to edit not found' });
      if (method === 'sendMessage') return Promise.resolve({ ok: true, result: { message_id: 654 } });
      return Promise.resolve({ ok: true });
    },
  });
  assertEquals(result.ok, true);
  assertEquals(actions, ['editMessageText', 'sendMessage']);
});
