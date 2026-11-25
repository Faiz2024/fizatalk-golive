import { getServiceClient } from '../_shared/service-client.ts';
import {
  handlePremiumSuccess,
  handleTopupSuccess,
  handleFineSuccess,
  handleExpired,
} from '../_shared/payment-success.ts';

export type SakurupiahPrefix = 'p_' | 't_' | 'f_';

export interface SakurupiahCallbackDeps {
  getClient?: () => any;
  getApiKey?: () => string;
  getBotToken?: () => string;
  onPremiumSuccess?: typeof handlePremiumSuccess;
  onTopupSuccess?: typeof handleTopupSuccess;
  onFineSuccess?: typeof handleFineSuccess;
  onExpired?: typeof handleExpired;
}

const SUCCESS_STATUSES = new Set(['berhasil', 'paid', 'success', 'sukses', 'settlement']);
const EXPIRED_STATUSES = new Set(['expired', 'kadaluarsa', 'kedaluwarsa']);
const FAILED_STATUSES = new Set(['expired', 'kadaluarsa', 'kedaluwarsa', 'failed', 'gagal', 'cancelled', 'canceled']);

export function classifySakurupiahStatus(
  status: unknown,
  statusKode: unknown,
): 'success' | 'expired' | 'other' {
  const normalized = String(status ?? '').trim().toLowerCase();
  const code = statusKode !== undefined && statusKode !== null && String(statusKode).trim() !== ''
    ? Number(statusKode)
    : NaN;

  if (SUCCESS_STATUSES.has(normalized) || (code === 1 && !FAILED_STATUSES.has(normalized))) {
    return 'success';
  }
  if (EXPIRED_STATUSES.has(normalized) || code === 2) {
    return 'expired';
  }
  return 'other';
}

export function parseMerchantRef(merchantRef: unknown): { prefix: SakurupiahPrefix; requestId: string } | null {
  if (typeof merchantRef !== 'string') return null;
  const trimmed = merchantRef.trim();
  const prefix = trimmed.slice(0, 2);
  const requestId = trimmed.slice(2).trim();
  if ((prefix === 'p_' || prefix === 't_' || prefix === 'f_') && requestId.length > 0) {
    return { prefix, requestId };
  }
  return null;
}

export async function findPendingByTrxId(
  supabase: any,
  trxId: unknown,
): Promise<{ prefix: SakurupiahPrefix; requestId: string } | null> {
  if (typeof trxId !== 'string' || !trxId.trim()) return null;
  const cleanTrxId = trxId.trim();

  const { data: prem } = await supabase
    .from('premium_requests')
    .select('id')
    .eq('sakurupiah_trx_id', cleanTrxId)
    .eq('status', 'pending')
    .maybeSingle();
  if (prem?.id) return { prefix: 'p_', requestId: prem.id };

  const { data: topup } = await supabase
    .from('topup_requests')
    .select('id')
    .eq('sakurupiah_trx_id', cleanTrxId)
    .eq('status', 'pending')
    .maybeSingle();
  if (topup?.id) return { prefix: 't_', requestId: topup.id };

  const { data: fine } = await supabase
    .from('pending_transactions')
    .select('id')
    .eq('sakurupiah_trx_id', cleanTrxId)
    .eq('status', 'pending')
    .eq('admin_notes', 'FINE_PAYMENT')
    .maybeSingle();
  if (fine?.id) return { prefix: 'f_', requestId: fine.id };

  return null;
}

async function dispatchSuccess(
  target: { prefix: SakurupiahPrefix; requestId: string },
  supabase: any,
  botToken: string,
  deps: Required<Pick<SakurupiahCallbackDeps, 'onPremiumSuccess' | 'onTopupSuccess' | 'onFineSuccess'>>,
): Promise<boolean> {
  if (target.prefix === 'p_') return await deps.onPremiumSuccess(supabase, botToken, target.requestId);
  if (target.prefix === 't_') return await deps.onTopupSuccess(supabase, botToken, target.requestId);
  return await deps.onFineSuccess(supabase, botToken, target.requestId);
}

export async function handleSakurupiahCallback(
  req: Request,
  deps: SakurupiahCallbackDeps = {},
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  console.log('[CALLBACK] Received:', rawBody);

  // Validate X-Callback-Signature
  const callbackSignature = (req.headers.get('x-callback-signature') || '').trim().toLowerCase();
  const apiKey = deps.getApiKey ? deps.getApiKey() : (Deno.env.get('SAKURUPIAH_API_KEY') || '');

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
    return new Response(JSON.stringify({ success: false, message: 'Invalid signature' }), { status: 403 });
  }

  const callbackEvent = (req.headers.get('x-callback-event') || '').trim().toLowerCase();
  if (callbackEvent && callbackEvent !== 'payment_status') {
    return new Response(JSON.stringify({ success: true, message: 'Ignored event' }));
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ success: false, message: 'Invalid JSON' }), { status: 400 });
  }

  const { trx_id, merchant_ref, status, status_kode } = data;
  console.log(`[CALLBACK] trx_id=${trx_id} ref=${merchant_ref} status=${status} code=${status_kode}`);

  const supabase = deps.getClient
    ? deps.getClient()
    : getServiceClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const botToken = deps.getBotToken ? deps.getBotToken() : Deno.env.get('TELEGRAM_BOT_TOKEN')!;

  const handlers = {
    onPremiumSuccess: deps.onPremiumSuccess ?? handlePremiumSuccess,
    onTopupSuccess: deps.onTopupSuccess ?? handleTopupSuccess,
    onFineSuccess: deps.onFineSuccess ?? handleFineSuccess,
  };
  const onExpired = deps.onExpired ?? handleExpired;

  const outcome = classifySakurupiahStatus(status, status_kode);
  const parsedRef = parseMerchantRef(merchant_ref);

  if (outcome === 'success') {
    let handled = false;
    if (parsedRef) {
      handled = await dispatchSuccess(parsedRef, supabase, botToken, handlers);
    }
    if (!handled && trx_id) {
      const fallbackTarget = await findPendingByTrxId(supabase, trx_id);
      if (fallbackTarget) {
        console.log(`[CALLBACK] Fallback matched via trx_id=${trx_id} -> ${fallbackTarget.prefix}${fallbackTarget.requestId}`);
        await dispatchSuccess(fallbackTarget, supabase, botToken, handlers);
      }
    }
  } else if (outcome === 'expired') {
    const target = parsedRef ?? (trx_id ? await findPendingByTrxId(supabase, trx_id) : null);
    if (target) {
      await onExpired(supabase, botToken, target.prefix, target.requestId);
    }
  }

  return new Response(JSON.stringify({ success: true, message: `Status ${status}` }));
}
