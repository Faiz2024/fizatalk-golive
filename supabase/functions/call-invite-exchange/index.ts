import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';

const RequestSchema = z.object({
  join_token: z.string().uuid(),
  telegram_user_id: z.number().int().positive().safe(),
}).strict();

const encoder = new TextEncoder();

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

async function createSignature(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = Deno.env.get('LEGACY_CALL_SECRET') ?? '';
  const timestamp = req.headers.get('x-call-timestamp') ?? '';
  const providedSignature = (req.headers.get('x-call-signature') ?? '').toLowerCase();

  if (!secret) return json({ error: 'not_configured' }, 503);
  if (!/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(providedSignature)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const requestTime = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(requestTime) || Math.abs(Date.now() - requestTime) > 60_000) {
    return json({ error: 'request_expired' }, 401);
  }

  const rawBody = await req.text();
  const expectedSignature = await createSignature(secret, `${timestamp}.${rawBody}`);
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) return json({ error: 'invalid_input' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'server_configuration' }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc('exchange_chat_call_invite', {
    p_join_token: parsed.data.join_token,
    p_user_id: parsed.data.telegram_user_id,
  });

  if (error) {
    console.error('[CALL_EXCHANGE] database operation failed');
    return json({ error: 'database_error' }, 500);
  }
  if (!data?.success) {
    const status = data?.error === 'not_member' ? 403 : 409;
    return json({ error: data?.error ?? 'exchange_failed' }, status);
  }

  return json({
    success: true,
    invite_id: data.invite_id,
    user_id: data.user_id,
    peer_id: data.peer_id,
    expires_at: data.expires_at,
  }, 200);
});