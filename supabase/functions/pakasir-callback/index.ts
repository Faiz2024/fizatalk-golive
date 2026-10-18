import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { handlePremiumSuccess, handleTopupSuccess, handleFineSuccess } from '../_shared/payment-success.ts';
import { equalSecret, expectedPakasirAmount, parsePakasirOrder, verifyPakasirPayment } from '../_shared/pakasir.ts';

function reply(status: number, message: string) {
  return new Response(JSON.stringify({ success: status === 200, message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply(405, 'Method not allowed');

  const slug = Deno.env.get('PAKASIR_SLUG');
  const apiKey = Deno.env.get('PAKASIR_API_KEY');
  const webhookSecret = Deno.env.get('PAKASIR_WEBHOOK_SECRET');
  const dbUrl = Deno.env.get('SUPABASE_URL');
  const dbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!slug || !apiKey || !dbUrl || !dbKey || !botToken) return reply(500, 'Not configured');

  let data;
  try {
    data = await req.json();
  } catch {
    return reply(400, 'Invalid JSON');
  }
  const order = parsePakasirOrder(data?.order_id);
  if (!order || !Number.isSafeInteger(data.amount) || data.amount <= 0 || typeof data.status !== 'string') {
    return reply(400, 'Invalid payload');
  }
  const isV2 = data.txn_id !== undefined;
  if (isV2) {
    if (!webhookSecret) return reply(500, 'Webhook secret not configured');
    if (typeof data.txn_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.txn_id) ||
      typeof data.is_sandbox !== 'boolean') return reply(400, 'Invalid v2 payload');
    if (!equalSecret(req.headers.get('X-Secret'), webhookSecret)) {
      return reply(403, 'Invalid webhook secret');
    }
    if (data.is_sandbox) return reply(403, 'Sandbox payments not accepted');
  } else if (data.project !== slug) {
    return reply(403, 'Invalid project');
  }
  if (data.status !== 'completed') return reply(200, 'Ignored status');

  try {
    const supabase = createClient(dbUrl, dbKey);
    // One read binds the provider payment to the correct local order before fulfillment.
    const { data: payment, error } = await supabase.from(order.table)
      .select('*').eq('id', order.requestId).maybeSingle();
    if (error) throw new Error('Payment lookup failed');
    if (!payment) return reply(403, 'Unknown order');
    if (payment.sakurupiah_trx_id !== (isV2 ? data.txn_id : data.order_id) ||
      expectedPakasirAmount(order.prefix, payment) !== data.amount ||
      (order.prefix === 'f_' ? payment.admin_notes !== 'FINE_PAYMENT' : payment.payment_method !== 'PAKASIR_QRIS')) {
      return reply(403, 'Payment mismatch');
    }
    if (payment.status !== 'pending') return reply(200, 'Already settled or inactive');

    const verification = await verifyPakasirPayment({
      orderId: data.order_id, txnId: isV2 ? data.txn_id : undefined, amount: data.amount,
    }, slug, apiKey);
    if (verification === 'retry') return reply(500, 'Verification temporarily unavailable');
    if (verification !== 'verified') return reply(403, 'Not verified');

    if (order.prefix === 'p_') await handlePremiumSuccess(supabase, botToken, order.requestId, 'Pakasir');
    else if (order.prefix === 't_') await handleTopupSuccess(supabase, botToken, order.requestId, 'Pakasir');
    else await handleFineSuccess(supabase, botToken, order.requestId, 'Pakasir');
    return reply(200, 'Processed');
  } catch {
    console.error('[PAKASIR CB] Payment processing failed');
    return reply(500, 'Processing error');
  }
});