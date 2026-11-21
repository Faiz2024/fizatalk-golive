import type { ReportContext } from './report-policy.ts';

type Call = (method: string, body: any) => Promise<any>;
type Dependencies = { db: any; call: Call; adminChat: string | undefined; now?: () => Date };

const ACTION_LABEL: Record<string, string> = {
  restore: '🟢 Dipulihkan',
  lock: '🔒 Dikunci',
  block14: '🚫 Diblokir 14 hari tanpa tebus',
  perm: '⛔ Diblokir permanen',
};
const CONTEXT_LABEL: Record<string, string> = {
  partner: 'Akhir Sesi',
  link: 'Link/Username',
  media: 'Media',
};

export const escapeReportHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function reportWib(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return valid.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
}

export function reportSnippet(message: any, context: ReportContext): string {
  if (context === 'partner') return 'Dilaporkan saat sesi chat berakhir';
  if (context === 'link') return String(message?.text || message?.caption || 'Pesan link/username').trim().slice(0, 100);
  const media = message?.photo ? '📷 Foto'
    : message?.video ? '🎥 Video'
      : message?.animation ? '🎬 GIF'
        : message?.video_note ? '⭕ Video Note' : 'Media';
  const caption = String(message?.caption || '').trim().slice(0, 100);
  return `Media: ${media}${caption ? ` • Caption: ${caption}` : ' (tanpa caption)'}`;
}

export function adminReportKeyboard(target: number) {
  return { inline_keyboard: [
    [{ text: '🟢 Pulihkan', callback_data: `rpa_restore_${target}` }, { text: '🔒 Kunci Saja', callback_data: `rpa_lock_${target}` }],
    [{ text: '🚫 Blokir 14 Hari (Tanpa Tebus)', callback_data: `rpa_block14_${target}` }],
    [{ text: '⛔ Blokir Permanen', callback_data: `rpa_perm_${target}` }],
    [{ text: '🗑️ Abaikan', callback_data: `rpa_ignore_${target}` }],
  ] };
}

export function renderAdminReportCard(card: any): string {
  const target = Number(card.target_user_id);
  const premium = card.is_premium
    ? `🌟 PREMIUM (s/d ${reportWib(card.premium_until)})`
    : '⚪ Reguler';
  const resolved = card.status === 'resolved';
  const lines = [
    '🚨 <b>LAPORAN AKTIF TERLAPOR</b>',
    `👤 Terlapor: <code>${target}</code>${card.username ? ` (@${escapeReportHtml(card.username)})` : ''}`,
    `🌟 Status: ${premium}`,
    `📊 Total Laporan: <b>${Number(card.report_count || 0)}x</b> (${resolved ? 'Sudah ditindak' : 'Belum ditindak'})`,
    `⏰ Update Terakhir: ${reportWib(card.updated_at)}`,
  ];
  if (Number(card.sanction_stage) > 0) {
    lines.push(`⚡ Tahap sanksi saat ini: <b>${Number(card.sanction_stage)}</b>${card.sanction_violation ? ` • ${escapeReportHtml(card.sanction_violation)}` : ''}`);
  }
  lines.push('', '📋 <b>Riwayat Laporan Masuk:</b>');
  const snippets = Array.isArray(card.snippets) ? card.snippets : [];
  snippets.forEach((snippet: any, index: number) => {
    lines.push(`${index + 1}. [${reportWib(snippet.at)}] ${escapeReportHtml(snippet.label)} (Konteks: ${CONTEXT_LABEL[snippet.context] || escapeReportHtml(snippet.context)})`);
    if (snippet.detail) lines.push(`   └ ${escapeReportHtml(snippet.detail)}`);
  });
  const hidden = Math.max(0, Number(card.report_count || 0) - snippets.length);
  if (hidden > 0) lines.push(`… dan ${hidden} laporan lainnya.`);
  if (resolved) {
    lines.push('', `✅ <b>SELESAI:</b> ${ACTION_LABEL[card.last_action] || 'Ditindak admin'} • ${reportWib(card.resolved_at)}`);
  }
  return lines.join('\n').slice(0, 4096);
}

export async function syncAdminReportCard(card: any, d: Dependencies): Promise<{ ok: boolean; dbError?: boolean }> {
  if (!card || !d.adminChat) return { ok: true };
  const target = Number(card.target_user_id);
  if (!Number.isSafeInteger(target)) return { ok: false };
  const text = renderAdminReportCard(card);
  const keyboard = card.status === 'resolved' ? { inline_keyboard: [] } : adminReportKeyboard(target);
  let messageId = Number(card.admin_message_id) || null;

  if (messageId) {
    const edited = await d.call('editMessageText', {
      chat_id: d.adminChat, message_id: messageId, parse_mode: 'HTML', text, reply_markup: keyboard,
    });
    if (edited?.ok || String(edited?.description || '').includes('message is not modified')) {
      if (card.status !== 'resolved') {
        await d.call('pinChatMessage', { chat_id: d.adminChat, message_id: messageId, disable_notification: true });
      }
      return { ok: true };
    }
  }

  const sent = await d.call('sendMessage', {
    chat_id: d.adminChat, parse_mode: 'HTML', text, reply_markup: keyboard,
  });
  messageId = Number(sent?.result?.message_id) || null;
  if (!sent?.ok || !messageId) return { ok: false };
  const { data: saved, error } = await d.db.rpc('set_admin_report_card_message', {
    p_target_user_id: target,
    p_expected_message_id: Number(card.admin_message_id) || null,
    p_new_message_id: messageId,
  });
  if (error) return { ok: false, dbError: true };
  if (!saved) {
    await d.call('deleteMessage', { chat_id: d.adminChat, message_id: messageId });
    return { ok: true };
  }
  if (card.status !== 'resolved') {
    await d.call('pinChatMessage', { chat_id: d.adminChat, message_id: messageId, disable_notification: true });
  }
  return { ok: true };
}
