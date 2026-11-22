export type ReportContext = 'partner' | 'link' | 'media';
export type ReportSanction = 'review' | 'lock_twice' | 'block14';
export type ReportRule = { label: string; review: boolean; threshold: 2 | 3 | null; sanction: ReportSanction };

export const REPORT_FREQUENCY_POLICY = {
  windowHours: 12,
  burstCount: 3,
  burstMinutes: 30,
  aggregateCount: 4,
} as const;

export const REPORT_POLICY = {
  partner: {
    danger: { label: '🚸 Asusila Anak / Bahaya Berat', review: true, threshold: null, sanction: 'review' },
    fraud: { label: '💳 Penipuan / Pemerasan / VCS', review: false, threshold: 2, sanction: 'block14' },
    harassment: { label: '🔞 Pelecehan / Vulgar', review: false, threshold: 3, sanction: 'lock_twice' },
    spam: { label: '📢 Spam / Iklan Berulang', review: false, threshold: 3, sanction: 'block14' },
  },
  link: {
    fraud: { label: '💳 Penipuan / Phishing / Judi', review: false, threshold: 2, sanction: 'block14' },
    sexual: { label: '🔞 Grup Porno / VCS', review: false, threshold: 2, sanction: 'block14' },
    promotion: { label: '📢 Promosi Toko / Channel', review: false, threshold: 3, sanction: 'block14' },
    doxxing: { label: '🆔 Penyebaran Data Pribadi', review: false, threshold: 3, sanction: 'block14' },
  },
  media: {
    danger: { label: '🚸 Dugaan Eksploitasi Seksual Anak', review: true, threshold: null, sanction: 'review' },
    sexual: { label: '🔞 Pornografi / Pap Tanpa Izin', review: false, threshold: 3, sanction: 'lock_twice' },
    fraud: { label: '💳 Penipuan / QRIS Palsu', review: false, threshold: 2, sanction: 'block14' },
  },
} as const;

export function reportRule(context: string, category: string): ReportRule | undefined {
  const rules = REPORT_POLICY[context as ReportContext];
  return rules ? (rules as Record<string, ReportRule>)[category] : undefined;
}

export function reportKeyboard(context: ReportContext, targetId: number) {
  const buttons = Object.entries(REPORT_POLICY[context]).map(([category, rule]) => ({
    text: rule.label, callback_data: `rc_${context}_${category}_${targetId}`,
  }));
  const rows: Array<Array<{ text: string; callback_data: string; style?: string }>> = context === 'partner' ? [buttons.slice(0, 2), buttons.slice(2)] : buttons.map(button => [button]);
  if (context === 'media') rows.push([{ text: '🗑️ Hapus Media dari Chat Saya', callback_data: 'rmdel' }]);
  rows.push(context === 'partner'
    ? [{ text: '🔍 Cari Partner Baru', style: 'primary', callback_data: 'search_partner' }, { text: '⬅️ Kembali', callback_data: `rcback_partner_${targetId}` }]
    : [{ text: '⬅️ Kembali', callback_data: `rcback_${context}_${targetId}` }]);
  return { inline_keyboard: rows };
}

export function reportableMedia(_premium: boolean): boolean { return true; }

export function evidenceValid(context: string, explanation: string, screenshotId: string | null): boolean {
  return explanation.trim().length >= 10 && explanation.length <= 1000 && (context === 'media' || !!screenshotId);
}
