export const RECOVERY_STARS = 99;
export const RECOVERY_PRICE_LABEL = '⭐ 99';
export const REPEAT_VIOLATION_WARNING = '⚠️ Hindari pelanggaran berulang untuk mencegah pemblokiran akun.';

const withBlankLineBeforeViolation = (violation: string) => violation.replace(/^\n(?!\n)/, '\n\n');

export function automaticReportLockMessage(violation: string): string {
  return `🔒 <b>Akun Anda dibatasi</b> karena laporan dari pengguna lain.${withBlankLineBeforeViolation(violation)}\n\n${REPEAT_VIOLATION_WARNING}\n\nTekan Cari Partner lalu Setuju untuk berjanji tidak mengulangi pelanggaran dan langsung melanjutkan penggunaan. Baca /rules.`;
}

export function searchReportLockMessage(violationLine: string): string {
  return `🔒 <b>AKUN DIBATASI</b>\n\nAkun Anda dibatasi karena laporan dari pengguna lain terhadap aktivitas Anda.${violationLine}\n\n${REPEAT_VIOLATION_WARNING}\n\nTekan <b>Setuju</b> untuk berjanji tidak mengulangi pelanggaran dan langsung melanjutkan penggunaan.\n\n📖 Baca ketentuan layanan: /rules`;
}

export function adminReportLockMessage(violation: string): string {
  return `🔒 <b>Akun Anda dibatasi oleh admin.</b>${withBlankLineBeforeViolation(violation)}\n\n${REPEAT_VIOLATION_WARNING}\n\nTekan Cari Partner lalu Setuju untuk berjanji tidak mengulangi dan langsung melanjutkan penggunaan. Baca /rules.`;
}

export function validRecoveryPayment(payloadUserId: unknown, userId: number, starsAmount: number): boolean {
  return Number(payloadUserId) === userId && starsAmount === RECOVERY_STARS;
}
