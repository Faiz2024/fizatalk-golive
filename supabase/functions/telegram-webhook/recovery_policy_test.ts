import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  adminReportLockMessage,
  automaticReportLockMessage,
  RECOVERY_PRICE_LABEL,
  RECOVERY_STARS,
  REPEAT_VIOLATION_WARNING,
  searchReportLockMessage,
  validRecoveryPayment,
} from '../_shared/recovery-policy.ts';

Deno.test('automatic report lock keeps its text and puts the warning above Tekan', () => {
  assertEquals(automaticReportLockMessage('\n📌 Jenis pelanggaran: <b>Pelecehan / Vulgar</b>'),
    '🔒 <b>Akun Anda dibatasi</b> karena laporan dari pengguna lain.\n\n📌 Jenis pelanggaran: <b>Pelecehan / Vulgar</b>\n\n⚠️ Hindari pelanggaran berulang untuk mencegah pemblokiran akun.\n\nTekan Cari Partner lalu Setuju untuk berjanji tidak mengulangi pelanggaran dan langsung melanjutkan penggunaan. Baca /rules.');
});

Deno.test('search report lock keeps its text and puts the warning above Tekan', () => {
  assertEquals(searchReportLockMessage('\n\n📌 Jenis pelanggaran: <b>Pelecehan / Vulgar</b>'),
    '🔒 <b>AKUN DIBATASI</b>\n\nAkun Anda dibatasi karena laporan dari pengguna lain terhadap aktivitas Anda.\n\n📌 Jenis pelanggaran: <b>Pelecehan / Vulgar</b>\n\n⚠️ Hindari pelanggaran berulang untuk mencegah pemblokiran akun.\n\nTekan <b>Setuju</b> untuk berjanji tidak mengulangi pelanggaran dan langsung melanjutkan penggunaan.\n\n📖 Baca ketentuan layanan: /rules');
});

Deno.test('admin lock keeps its text and puts the warning above Tekan', () => {
  assertEquals(adminReportLockMessage('\n📌 Jenis pelanggaran: <b>Pelecehan / Vulgar</b>'),
    '🔒 <b>Akun Anda dibatasi oleh admin.</b>\n\n📌 Jenis pelanggaran: <b>Pelecehan / Vulgar</b>\n\n⚠️ Hindari pelanggaran berulang untuk mencegah pemblokiran akun.\n\nTekan Cari Partner lalu Setuju untuk berjanji tidak mengulangi dan langsung melanjutkan penggunaan. Baca /rules.');
});

Deno.test('recovery costs exactly 99 Stars and no longer displays rupiah', () => {
  assertEquals(RECOVERY_STARS, 99);
  assertEquals(RECOVERY_PRICE_LABEL, '⭐ 99');
  assert(REPEAT_VIOLATION_WARNING.startsWith('⚠️ '));
});

Deno.test('recovery payment must match its user and exact Stars amount', () => {
  assertEquals(validRecoveryPayment(123, 123, 99), true);
  assertEquals(validRecoveryPayment(123, 123, 80), false);
  assertEquals(validRecoveryPayment(123, 123, 100), false);
  assertEquals(validRecoveryPayment(456, 123, 99), false);
});
