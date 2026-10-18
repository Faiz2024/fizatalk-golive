import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createPakasirV2Invoice, equalSecret, expectedPakasirAmount, parsePakasirOrder, verifyPakasirPayment } from '../_shared/pakasir.ts';

const orderId = 'p_b6a1ea8f4b3c45f8b8e120bf88700228';
const invoice = {
  txn_id: 'txn_example', project: 'example', order_id: orderId, amount: 5000,
  total_payment: 5500, payment_method: 'qris', qr_string: '000201-test-qr',
  expired_at: '2026-10-18T12:00:00Z', is_sandbox: false,
};
function mockJson(body: unknown, status = 200): typeof fetch {
  return (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;
}

Deno.test('v2 creates QRIS with header auth, base amount and provider total', async () => {
  const fetcher: typeof fetch = (input, init) => {
    const options = init as { headers?: HeadersInit; body?: unknown } | undefined;
    assertEquals(input, `https://app.pakasir.com/api/v2/create-transaction/example/${orderId}`);
    assertEquals(new Headers(options?.headers).get('X-Api-Key'), 'test-key');
    assertEquals(JSON.parse(String(options?.body)), { method: 'qris', amount: 5000 });
    return mockJson(invoice)(input, init);
  };
  const result = await createPakasirV2Invoice(orderId, 5000, 'example', 'test-key', fetcher);
  assertEquals(result.success, true);
  assertEquals(result.txnId, 'txn_example');
  assertEquals(result.totalPayment, 5500);
  assertEquals(result.payUrl, 'https://app.pakasir.com/pay-v2/txn_example?qris_only=1');
  assertEquals(result.expiredAt, '2026-10-18T12:00:00Z');
});

Deno.test('v2 accepts the live expires_at field name and rejects a malformed one', async () => {
  const liveInvoice = { ...invoice, expired_at: undefined, expires_at: '2026-10-18T12:00:00Z' };
  const live = await createPakasirV2Invoice(orderId, 5000, 'example', 'test-key', mockJson(liveInvoice));
  assertEquals(live.success, true);
  assertEquals(live.expiredAt, '2026-10-18T12:00:00Z');
  const badExpiry = await createPakasirV2Invoice(orderId, 5000, 'example', 'test-key', mockJson({ ...liveInvoice, expires_at: 'soon' }));
  assertEquals(badExpiry.success, false);
});

Deno.test('v2 rejects provider mismatches, sandbox, and malformed invoices', async () => {
  for (const change of [{ amount: 1 }, { order_id: 'wrong' }, { project: 'wrong' },
    { is_sandbox: true }, { total_payment: 0 }, { qr_string: '' }, { expired_at: 'wrong' }]) {
    assertEquals((await createPakasirV2Invoice(orderId, 5000, 'example', 'test-key', mockJson({ ...invoice, ...change }))).success, false);
  }
  assertEquals((await createPakasirV2Invoice(orderId, 5000, 'example', 'test-key', mockJson({}, 500))).success, false);
  assertEquals((await createPakasirV2Invoice('wrong', 5000, 'example', 'test-key')).success, false);
});

Deno.test('all three order prefixes route to the original UUID', () => {
  for (const [prefix, table] of [['p_', 'premium_requests'], ['t_', 'topup_requests'], ['f_', 'pending_transactions']]) {
    assertEquals(parsePakasirOrder(prefix + orderId.slice(2)), {
      prefix, table, requestId: 'b6a1ea8f-4b3c-45f8-b8e1-20bf88700228',
    });
  }
  assertEquals(parsePakasirOrder('x_' + orderId.slice(2)), null);
});

Deno.test('premium verification uses package price', () => {
  assertEquals(expectedPakasirAmount('p_', { price: 5000 }), 5000);
});
Deno.test('topup verification uses ten rupiah per coin', () => {
  assertEquals(expectedPakasirAmount('t_', { amount: 100 }), 1000);
});
Deno.test('recovery verification uses base charge, not provider fees', () => {
  assertEquals(expectedPakasirAmount('f_', { amount: 10000 }), 10000);
});

Deno.test('webhook secrets reject missing or mismatched headers', () => {
  assertEquals(equalSecret(null, 'test-secret'), false);
  assertEquals(equalSecret('test-secrex', 'test-secret'), false);
  assertEquals(equalSecret('test-secret', 'test-secret'), true);
});

Deno.test('v2 status binds completed payment to txn, order, amount and live mode', async () => {
  const input = { orderId, txnId: 'txn_example', amount: 5000 };
  const completed = { txn_id: 'txn_example', order_id: orderId, amount: 5000, is_sandbox: false, status: 'completed' };
  const fetcher: typeof fetch = (url, init) => {
    const options = init as { headers?: HeadersInit } | undefined;
    assertEquals(url, 'https://app.pakasir.com/api/v2/transaction-status/example/txn_example');
    assertEquals(new Headers(options?.headers).get('X-Api-Key'), 'test-key');
    return mockJson(completed)(url, init);
  };
  assertEquals(await verifyPakasirPayment(input, 'example', 'test-key', fetcher), 'verified');
  for (const change of [{ amount: 5500 }, { order_id: 'other' }, { txn_id: 'other' }, { status: 'pending' }, { is_sandbox: true }]) {
    assertEquals(await verifyPakasirPayment(input, 'example', 'test-key', mockJson({ ...completed, ...change })), 'rejected');
  }
  assertEquals(await verifyPakasirPayment(input, 'example', 'test-key', mockJson({}, 429)), 'retry');
  assertEquals(await verifyPakasirPayment(input, 'example', 'test-key', mockJson({}, 503)), 'retry');
});

Deno.test('legacy invoices remain verifiable during transition', async () => {
  assertEquals(await verifyPakasirPayment({ orderId, amount: 5000 }, 'example', 'test-key', mockJson({
    transaction: { order_id: orderId, amount: 5000, project: 'example', status: 'completed' },
  })), 'verified');
});