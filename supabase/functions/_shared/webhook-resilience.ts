export const STALE_MESSAGE_MAX_AGE_SECONDS = 90;

export interface WebhookResilienceUpdate {
  message?: {
    date?: number;
    successful_payment?: unknown;
  };
  edited_message?: {
    date?: number;
  };
  pre_checkout_query?: unknown;
  callback_query?: unknown;
}

// Hanya transaksi Stars yang boleh dicoba ulang Telegram saat database gagal.
export function isCriticalPaymentUpdate(
  update: WebhookResilienceUpdate | undefined,
): boolean {
  return Boolean(
    update?.pre_checkout_query || update?.message?.successful_payment,
  );
}

// Timestamp callback_query adalah umur tombol, bukan umur klik, sehingga tidak boleh difilter.
export function isStaleWebhookUpdate(
  update: WebhookResilienceUpdate,
  nowSeconds = Date.now() / 1000,
  maxAgeSeconds = STALE_MESSAGE_MAX_AGE_SECONDS,
): boolean {
  if (isCriticalPaymentUpdate(update)) return false;
  const message = update.message ?? update.edited_message;
  const sentAt = message?.date;
  return typeof sentAt === "number" && Number.isFinite(sentAt) &&
    nowSeconds - sentAt > maxAgeSeconds;
}

export function webhookDatabaseFailureStatus(
  update: WebhookResilienceUpdate | undefined,
): 200 | 500 {
  return isCriticalPaymentUpdate(update) ? 500 : 200;
}
