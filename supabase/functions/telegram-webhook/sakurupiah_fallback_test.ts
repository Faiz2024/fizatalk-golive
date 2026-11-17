import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  createSakurupiahWithQrisFallback,
  isSakurupiahInvoiceUsable,
  type SakurupiahInvoiceLike,
  type SakurupiahInvoiceParamsLike,
  type SakurupiahMethod,
} from '../_shared/sakurupiah-fallback.ts';

const params: SakurupiahInvoiceParamsLike = {
  method: 'DANA', amount: 7000, merchantRef: 'p_test', productName: 'PREMIUM 1 HARI',
};

function invoice(method: SakurupiahMethod, overrides: Partial<SakurupiahInvoiceLike> = {}): SakurupiahInvoiceLike {
  return {
    success: true,
    trxId: `trx_${method}`,
    qrString: method === 'QRIS' ? '000201-qris' : undefined,
    paymentNo: method === 'DANA' ? 'https://link.dana.id/pay' : undefined,
    checkoutUrl: method === 'GOPAY' ? 'https://checkout.example/gopay' : undefined,
    ...overrides,
  };
}

Deno.test('failed DANA payment retries as Sakurupiah QRIS on the same transaction', async () => {
  const attempts: SakurupiahMethod[] = [];
  const result = await createSakurupiahWithQrisFallback(params, async (request) => {
    attempts.push(request.method);
    return request.method === 'DANA' ? { success: false, error: 'DANA unavailable' } : invoice('QRIS');
  });
  assertEquals(attempts, ['DANA', 'QRIS']);
  assertEquals(result.requestedMethod, 'DANA');
  assertEquals(result.method, 'QRIS');
  assertEquals(isSakurupiahInvoiceUsable(result.method, result.invoice), true);
});

Deno.test('failed GoPay payment retries as Sakurupiah QRIS on the same transaction', async () => {
  const attempts: SakurupiahMethod[] = [];
  const result = await createSakurupiahWithQrisFallback({ ...params, method: 'GOPAY' }, async (request) => {
    attempts.push(request.method);
    return request.method === 'GOPAY' ? { success: false, error: 'GoPay unavailable' } : invoice('QRIS');
  });
  assertEquals(attempts, ['GOPAY', 'QRIS']);
  assertEquals(result.method, 'QRIS');
});

Deno.test('DANA response without a payable link also retries as QRIS', async () => {
  const attempts: SakurupiahMethod[] = [];
  const result = await createSakurupiahWithQrisFallback(params, async (request) => {
    attempts.push(request.method);
    return request.method === 'DANA'
      ? invoice('DANA', { paymentNo: undefined, checkoutUrl: undefined })
      : invoice('QRIS');
  });
  assertEquals(attempts, ['DANA', 'QRIS']);
  assertEquals(result.method, 'QRIS');
});

Deno.test('usable DANA invoice does not create an unnecessary QRIS invoice', async () => {
  const attempts: SakurupiahMethod[] = [];
  const result = await createSakurupiahWithQrisFallback(params, async (request) => {
    attempts.push(request.method);
    return invoice(request.method);
  });
  assertEquals(attempts, ['DANA']);
  assertEquals(result.method, 'DANA');
});

Deno.test('failed Sakurupiah QRIS is returned unusable so caller falls to Pakasir', async () => {
  const attempts: SakurupiahMethod[] = [];
  const result = await createSakurupiahWithQrisFallback({ ...params, method: 'QRIS' }, async (request) => {
    attempts.push(request.method);
    return { success: false, error: 'QRIS unavailable' };
  });
  assertEquals(attempts, ['QRIS']);
  assertEquals(isSakurupiahInvoiceUsable(result.method, result.invoice), false);
});

Deno.test('QRIS success without transaction ID or QR payload remains unusable', () => {
  assertEquals(isSakurupiahInvoiceUsable('QRIS', invoice('QRIS', { trxId: undefined })), false);
  assertEquals(isSakurupiahInvoiceUsable('QRIS', invoice('QRIS', { qrString: '' })), false);
});
