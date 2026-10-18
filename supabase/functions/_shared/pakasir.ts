// Pakasir v2 contracts: https://pakasir.com/p/create-transaction,
// /p/transaction-status and /p/webhook. No polling or new database columns.
export const PAKASIR_BASE = 'https://app.pakasir.com';

export interface PakasirInvoiceResult {
  success: boolean;
  orderId?: string;
  txnId?: string;
  qrString?: string;
  totalPayment?: number;
  expiredAt?: string;
  payUrl?: string;
  error?: string;
}

export function parsePakasirOrder(orderId: unknown) {
  if (typeof orderId !== 'string') return null;
  const match = /^(p_|t_|f_)([0-9a-fA-F]{32})$/.exec(orderId);
  if (!match) return null;
  const compact = match[2];
  return {
    prefix: match[1],
    requestId: `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`,
    table: match[1] === 'p_' ? 'premium_requests' : match[1] === 't_' ? 'topup_requests' : 'pending_transactions',
  };
}

export async function createPakasirV2Invoice(
  orderId: string, amount: number, slug: string, apiKey: string, fetcher: typeof fetch = fetch,
): Promise<PakasirInvoiceResult> {
  if (!slug || !apiKey) return { success: false, error: 'not_configured' };
  if (!parsePakasirOrder(orderId) || !Number.isSafeInteger(amount) || amount <= 0) {
    return { success: false, error: 'invalid_invoice' };
  }
  try {
    const response = await fetcher(`${PAKASIR_BASE}/api/v2/create-transaction/${encodeURIComponent(slug)}/${encodeURIComponent(orderId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ method: 'qris', amount }),
    });
    const payment = await response.json().catch(() => null);
    if (!response.ok) return { success: false, error: `create_failed_${response.status}` };
    if (!payment || typeof payment.txn_id !== 'string' || !payment.txn_id ||
      payment.order_id !== orderId || payment.project !== slug || payment.amount !== amount ||
      payment.payment_method !== 'qris' || typeof payment.qr_string !== 'string' || !payment.qr_string ||
      !Number.isSafeInteger(payment.total_payment) || payment.total_payment < amount ||
      typeof payment.expired_at !== 'string' || !Number.isFinite(Date.parse(payment.expired_at)) ||
      payment.is_sandbox !== false) {
      return { success: false, error: 'invalid_create_response' };
    }
    return {
      success: true, orderId, txnId: payment.txn_id, qrString: payment.qr_string,
      totalPayment: payment.total_payment, expiredAt: payment.expired_at,
      payUrl: `${PAKASIR_BASE}/pay-v2/${encodeURIComponent(payment.txn_id)}?qris_only=1`,
    };
  } catch {
    // Never log a fetch error containing credentials/URLs from provider requests.
    return { success: false, error: 'network_error' };
  }
}

export function expectedPakasirAmount(prefix: string, request: { price?: number; amount?: number }): number {
  return prefix === 'p_' ? Number(request.price) : prefix === 't_' ? Number(request.amount) * 10 : Number(request.amount);
}

export function equalSecret(actual: string | null, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

export async function verifyPakasirPayment(
  input: { orderId: string; txnId?: string; amount: number },
  slug: string, apiKey: string, fetcher: typeof fetch = fetch,
): Promise<'verified' | 'rejected' | 'retry'> {
  const isV2 = Boolean(input.txnId);
  const url = isV2
    ? `${PAKASIR_BASE}/api/v2/transaction-status/${encodeURIComponent(slug)}/${encodeURIComponent(input.txnId || '')}`
    // Only callbacks tied to pre-migration invoices may use v1 during transition.
    : `${PAKASIR_BASE}/api/transactiondetail?project=${encodeURIComponent(slug)}&amount=${input.amount}&order_id=${encodeURIComponent(input.orderId)}&api_key=${encodeURIComponent(apiKey)}`;
  try {
    const response = await fetcher(url, isV2 ? { headers: { 'X-Api-Key': apiKey } } : undefined);
    const json = await response.json().catch(() => null);
    if (response.status === 429 || response.status >= 500) return 'retry';
    if (!response.ok || !json) return 'rejected';
    const transaction = isV2 ? json : json.transaction;
    if (!transaction || transaction.status !== 'completed' || transaction.order_id !== input.orderId ||
      transaction.amount !== input.amount || (isV2
        ? transaction.txn_id !== input.txnId || transaction.is_sandbox !== false
        : transaction.project !== slug)) return 'rejected';
    return 'verified';
  } catch {
    return 'retry';
  }
}