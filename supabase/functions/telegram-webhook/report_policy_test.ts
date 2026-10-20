import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { evidenceValid, reportRule, reportableMedia } from '../_shared/report-policy.ts';

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