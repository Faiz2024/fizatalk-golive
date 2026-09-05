import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  handlePremiumSuccess,
  handleTopupSuccess,
  handleFineSuccess,
} from '../_shared/payment-success.ts';

const PAKASIR_BASE = 'https://app.pakasir.com';

// order_id memakai pola p_/t_/f_ + UUID tanpa tanda hubung -> kembalikan ke bentuk UUID
function toUuid(compact: string): string | null {
  const s = compact.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(s)) return null;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  console.log('[PAKASIR CB] Received:', rawBody);

  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch (_) {
    return new Response(JSON.stringify({ success: false, message: 'Invalid JSON' }), { status: 400 });
  }

  const { amount, order_id, project, status } = data || {};
  const slug = Deno.env.get('PAKASIR_SLUG') || '';
  const apiKey = Deno.env.get('PAKASIR_API_KEY') || '';

  if (!order_id || !amount || !slug || !apiKey || project !== slug) {
    console.warn('[PAKASIR CB] Rejected: payload/slug mismatch');
    return new Response(JSON.stringify({ success: false, message: 'Invalid payload' }), { status: 403 });
  }

  if (status !== 'completed') {
    return new Response(JSON.stringify({ success: true, message: 'Ignored status' }));
  }

  // Pakasir tidak mengirim signature -> verifikasi balik ke API resmi
  let verified = false;
  try {
    const url = `${PAKASIR_BASE}/api/transactiondetail?project=${encodeURIComponent(slug)}&amount=${encodeURIComponent(String(amount))}&order_id=${encodeURIComponent(order_id)}&api_key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    verified = resp.ok && json?.transaction?.status === 'completed' && json?.transaction?.project === slug;
    if (!verified) console.warn('[PAKASIR CB] Verification failed:', JSON.stringify(json).slice(0, 300));
  } catch (e) {
    console.error('[PAKASIR CB] Verification error:', e);
  }

  if (!verified) {
    return new Response(JSON.stringify({ success: false, message: 'Not verified' }), { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

  const prefix = String(order_id).substring(0, 2);
  const requestId = toUuid(String(order_id).substring(2));

  if (!requestId) {
    console.warn('[PAKASIR CB] Bad order_id:', order_id);
    return new Response(JSON.stringify({ success: true, message: 'Unknown order' }));
  }

  try {
    if (prefix === 'p_') {
      await handlePremiumSuccess(supabase, botToken, requestId, 'Pakasir');
    } else if (prefix === 't_') {
      await handleTopupSuccess(supabase, botToken, requestId, 'Pakasir');
    } else if (prefix === 'f_') {
      await handleFineSuccess(supabase, botToken, requestId, 'Pakasir');
    } else {
      console.warn('[PAKASIR CB] Unknown prefix:', prefix);
    }
  } catch (e) {
    console.error('[PAKASIR CB] Processing error:', e);
    return new Response(JSON.stringify({ success: false, message: 'Processing error' }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }));
});
