import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  classifySakurupiahStatus,
  handleSakurupiahCallback,
  parseMerchantRef,
} from './handler.ts';

const TEST_API_KEY = 'test-sakurupiah-secret-key';

async function signBody(body: string, secret = TEST_API_KEY): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function createMockSupabase(matches: Partial<Record<'premium_requests' | 'topup_requests' | 'pending_transactions', string>>) {
  return {
    from(table: 'premium_requests' | 'topup_requests' | 'pending_transactions') {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          const id = matches[table];
          return Promise.resolve({ data: id ? { id } : null, error: null });
        },
      };
    },
  };
}

Deno.test('classifySakurupiahStatus handles flexible success and expired formats', () => {
  assertEquals(classifySakurupiahStatus('berhasil', 1), 'success');
  assertEquals(classifySakurupiahStatus('BERHASIL', '1'), 'success');
  assertEquals(classifySakurupiahStatus('paid', undefined), 'success');
  assertEquals(classifySakurupiahStatus('', 1), 'success');
  assertEquals(classifySakurupiahStatus('expired', 2), 'expired');
  assertEquals(classifySakurupiahStatus('EXPIRED', '2'), 'expired');
  assertEquals(classifySakurupiahStatus('pending', 0), 'other');
});

Deno.test('parseMerchantRef validates prefix and id', () => {
  assertEquals(parseMerchantRef('p_abc-123'), { prefix: 'p_', requestId: 'abc-123' });
  assertEquals(parseMerchantRef('t_xyz'), { prefix: 't_', requestId: 'xyz' });
  assertEquals(parseMerchantRef('f_999'), { prefix: 'f_', requestId: '999' });
  assertEquals(parseMerchantRef('invalid'), null);
  assertEquals(parseMerchantRef('p_'), null);
});

Deno.test('handleSakurupiahCallback accepts missing x-callback-event and uppercase status', async () => {
  const payload = JSON.stringify({
    trx_id: 'TRX-001',
    merchant_ref: 'p_req-123',
    status: 'PAID',
    status_kode: '1',
  });
  const signature = await signBody(payload);
  const called: string[] = [];

  const req = new Request('https://example.com/sakurupiah-callback', {
    method: 'POST',
    headers: { 'x-callback-signature': signature.toUpperCase() },
    body: payload,
  });

  const res = await handleSakurupiahCallback(req, {
    getApiKey: () => TEST_API_KEY,
    getBotToken: () => 'bot-token',
    getClient: () => createMockSupabase({}),
    onPremiumSuccess: async (_sb, _tok, id) => {
      called.push(id);
      return true;
    },
  });

  assertEquals(res.status, 200);
  assertEquals(called, ['req-123']);
});

Deno.test('handleSakurupiahCallback falls back to sakurupiah_trx_id when merchant_ref does not match', async () => {
  const payload = JSON.stringify({
    trx_id: 'PDCCZwtcHVqF-T1dpyneB8-cYdW721',
    merchant_ref: 'unknown_ref',
    status: 'berhasil',
    status_kode: 1,
  });
  const signature = await signBody(payload);
  const called: string[] = [];

  const req = new Request('https://example.com/sakurupiah-callback', {
    method: 'POST',
    headers: {
      'x-callback-signature': signature,
      'x-callback-event': 'payment_status',
    },
    body: payload,
  });

  const res = await handleSakurupiahCallback(req, {
    getApiKey: () => TEST_API_KEY,
    getBotToken: () => 'bot-token',
    getClient: () => createMockSupabase({ premium_requests: '440d4def-85f7-4b39-8d5a-f55c2f481d57' }),
    onPremiumSuccess: async (_sb, _tok, id) => {
      called.push(id);
      return true;
    },
  });

  assertEquals(res.status, 200);
  assertEquals(called, ['440d4def-85f7-4b39-8d5a-f55c2f481d57']);
});

Deno.test('handleSakurupiahCallback rejects invalid signature with 403', async () => {
  const payload = JSON.stringify({ trx_id: 'TRX-BAD', merchant_ref: 'p_1', status: 'berhasil', status_kode: 1 });
  const req = new Request('https://example.com/sakurupiah-callback', {
    method: 'POST',
    headers: { 'x-callback-signature': 'deadbeef' },
    body: payload,
  });

  const res = await handleSakurupiahCallback(req, {
    getApiKey: () => TEST_API_KEY,
    getBotToken: () => 'bot-token',
    getClient: () => createMockSupabase({}),
  });

  assertEquals(res.status, 403);
});