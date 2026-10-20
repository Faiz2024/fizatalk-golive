export type ReportContext = 'partner' | 'link' | 'media';
export const REPORT_POLICY = {
  partner: {
    danger: { label: '🚸 Asusila Anak / Bahaya Berat', points: 0, review: true },
    fraud: { label: '💳 Penipuan / Pemerasan / VCS', points: 25, review: false },
    harassment: { label: '🔞 Pelecehan / Vulgar', points: 15, review: false },
    spam: { label: '📢 Spam / Iklan Berulang', points: 10, review: false },
  },
  link: {
    fraud: { label: '💳 Penipuan / Phishing / Judi', points: 25, review: false },
    sexual: { label: '🔞 Grup Porno / VCS', points: 20, review: false },
    promotion: { label: '📢 Promosi Toko / Channel', points: 10, review: false },
    doxxing: { label: '🆔 Penyebaran Data Pribadi', points: 20, review: false },
  },
  media: {
    danger: { label: '🚸 Dugaan Eksploitasi Seksual Anak', points: 0, review: true },
    sexual: { label: '🔞 Pornografi / Pap Tanpa Izin', points: 20, review: false },
    fraud: { label: '💳 Penipuan / QRIS Palsu', points: 15, review: false },
  },
} as const;

export function reportRule(context: string, category: string): { label: string; points: number; review: boolean } | undefined {
  const rules = REPORT_POLICY[context as ReportContext];
  return rules ? (rules as Record<string, { label: string; points: number; review: boolean }>)[category] : undefined;
}

export function reportKeyboard(context: ReportContext, targetId: number) {
  const buttons = Object.entries(REPORT_POLICY[context]).map(([category, rule]) => ({
    text: rule.label, callback_data: `rc_${context}_${category}_${targetId}`,
  }));
  const rows = context === 'partner' ? [buttons.slice(0, 2), buttons.slice(2)] : buttons.map(button => [button]);
  if (context === 'media') rows.push([{ text: '🗑️ Hapus Media dari Chat Saya', callback_data: 'rmdel' }]);
  rows.push(context === 'partner'
    ? [{ text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }, { text: '⬅️ Kembali', callback_data: `rcback_partner_${targetId}` }]
    : [{ text: '⬅️ Kembali', callback_data: `rcback_${context}_${targetId}` }]);
  return { inline_keyboard: rows };
}

export function reportableMedia(_premium: boolean): boolean { return true; }

export function evidenceValid(context: string, explanation: string, screenshotId: string | null): boolean {
  return explanation.trim().length >= 10 && explanation.length <= 1000 && (context === 'media' || !!screenshotId);
}