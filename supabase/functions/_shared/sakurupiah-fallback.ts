// Percobaan pembayaran Sakurupiah: DANA/GoPay -> QRIS pada transaksi yang sama.
// Pakasir dan QRIS manual tetap ditangani caller setelah hasil QRIS tidak dapat dipakai.
export type SakurupiahMethod = 'QRIS' | 'DANA' | 'GOPAY' | 'SHOPEEPAY' | 'OVO';

export interface SakurupiahInvoiceParamsLike {
  method: SakurupiahMethod;
  amount: number;
  merchantRef: string;
  productName: string;
  customerName?: string;
  expired?: number;
}

export interface SakurupiahInvoiceLike {
  success: boolean;
  trxId?: string;
  qrString?: string;
  checkoutUrl?: string;
  paymentNo?: string;
  error?: string;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSakurupiahInvoiceUsable(method: SakurupiahMethod, invoice: SakurupiahInvoiceLike): boolean {
  if (!invoice.success || !nonEmpty(invoice.trxId)) return false;
  if (method === 'QRIS') return nonEmpty(invoice.qrString);
  return nonEmpty(invoice.paymentNo) || nonEmpty(invoice.checkoutUrl);
}

export async function createSakurupiahWithQrisFallback<T extends SakurupiahInvoiceLike>(
  params: SakurupiahInvoiceParamsLike,
  createInvoice: (params: SakurupiahInvoiceParamsLike) => Promise<T>,
): Promise<{ invoice: T; method: SakurupiahMethod; requestedMethod: SakurupiahMethod }> {
  const requestedMethod = params.method;
  let invoice = await createInvoice(params);

  if ((requestedMethod === 'DANA' || requestedMethod === 'GOPAY') &&
    !isSakurupiahInvoiceUsable(requestedMethod, invoice)) {
    console.log(`[SAKURUPIAH] ${requestedMethod} unavailable, retrying as QRIS`);
    invoice = await createInvoice({ ...params, method: 'QRIS' });
    return { invoice, method: 'QRIS', requestedMethod };
  }

  return { invoice, method: requestedMethod, requestedMethod };
}
