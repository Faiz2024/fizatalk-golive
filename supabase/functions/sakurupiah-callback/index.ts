import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  handlePremiumSuccess,
  handleTopupSuccess,
  handleFineSuccess,
  handleExpired,
} from '../_shared/payment-success.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  console.log('[CALLBACK] Received:', rawBody);

  // Validate X-Callback-Signature
  const callbackSignature = req.headers.get('x-callback-signature') || '';
  const apiKey = Deno.env.get('SAKURUPIAH_API_KEY') || '';

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedSignature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (callbackSignature !== expectedSignature) {
    console.error('[CALLBACK] Invalid signature');
    try {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      sb.rpc('log_bot_event', {
        p_level: 'warn', p_source: 'sakurupiah-callback', p_event: 'invalid_signature',
        p_user_id: null, p_message: 'Invalid X-Callback-Signature',
        p_context: { provided_len: callbackSignature.length, body_preview: rawBody.slice(0, 200) },
      }).then(() => {}, () => {});
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ success: false, message: 'Invalid signature' }), { status: 403 });
  }

  const callbackEvent = req.headers.get('x-callback-event');
  if (callbackEvent !== 'payment_status') {
    return new Response(JSON.stringify({ success: true, message: 'Ignored event' }));
  }

  const data = JSON.parse(rawBody);
  const { trx_id, merchant_ref, status, status_kode } = data;
  console.log(`[CALLBACK] trx_id=${trx_id} ref=${merchant_ref} status=${status} code=${status_kode}`);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

  const prefix = merchant_ref.substring(0, 2);
  const requestId = merchant_ref.substring(2);

  if (status === 'berhasil' && (status_kode === 1 || status_kode === '1')) {
    if (prefix === 'p_') {
      await handlePremiumSuccess(supabase, botToken, requestId);
    } else if (prefix === 't_') {
      await handleTopupSuccess(supabase, botToken, requestId);
    } else if (prefix === 'f_') {
      await handleFineSuccess(supabase, botToken, requestId);
    }
  } else if (status === 'expired' && (status_kode === 2 || status_kode === '2')) {
    await handleExpired(supabase, botToken, prefix, requestId);
  }

  return new Response(JSON.stringify({ success: true, message: `Status ${status}` }));
});
