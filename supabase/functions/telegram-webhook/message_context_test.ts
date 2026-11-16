import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { getMessageContext } from '../_shared/message-context.ts';

Deno.test('chat message loads user and validated partner in one database call', async () => {
  const calls: any[] = [];
  const user = { state: 'chatting', partner_id: 200, premium_until: null };
  const envelope = { ok: true, partner_id: 200, partner_tiktok_mode: false, user };
  const db = {
    rpc: (name: string, params: any) => {
      calls.push({ name, params });
      return Promise.resolve({ data: envelope, error: null });
    },
  };

  const result = await getMessageContext(db, 100);

  assertEquals(calls, [{ name: 'get_chat_envelope', params: { p_user_id: 100 } }]);
  assertEquals(result.user, user);
  assertEquals(result.envelope, envelope);
  assertEquals(result.error, null);
});

Deno.test('non-chat message still gets its user data from the same single call', async () => {
  const user = { state: 'idle', partner_id: null, coins: 12 };
  const db = {
    rpc: () => Promise.resolve({
      data: { ok: false, reason: 'not_chatting', user },
      error: null,
    }),
  };

  const result = await getMessageContext(db, 100);

  assertEquals(result.user, user);
  assertEquals(result.envelope?.reason, 'not_chatting');
});

Deno.test('message context propagates database errors for webhook retry', async () => {
  const error = { message: 'database unavailable' };
  const db = { rpc: () => Promise.resolve({ data: null, error }) };

  const result = await getMessageContext(db, 100);

  assertEquals(result.error, error);
  assertEquals(result.user, null);
  assertEquals(result.envelope, null);
});
