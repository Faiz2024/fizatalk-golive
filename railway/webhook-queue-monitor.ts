export const QUEUE_MONITOR_INTERVAL_MS = 10 * 60 * 1000;
export const QUEUE_ALERT_THRESHOLD = 300;
export const QUEUE_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

interface QueueMonitorOptions {
  botToken: string;
  adminChatId: string;
  fetcher?: typeof fetch;
  now?: () => number;
  intervalMs?: number;
  alertCooldownMs?: number;
}

export function shouldAlertWebhookQueue(
  pendingUpdates: number,
  lastAlertAt: number | null,
  now: number,
  cooldownMs = QUEUE_ALERT_COOLDOWN_MS,
): boolean {
  return pendingUpdates > QUEUE_ALERT_THRESHOLD &&
    (lastAlertAt === null || now - lastAlertAt >= cooldownMs);
}

export function createWebhookQueueMonitor(options: QueueMonitorOptions) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? QUEUE_MONITOR_INTERVAL_MS;
  const alertCooldownMs = options.alertCooldownMs ?? QUEUE_ALERT_COOLDOWN_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastAlertAt: number | null = null;
  let checking = false;

  const checkOnce = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const response = await fetcher(
        `https://api.telegram.org/bot${options.botToken}/getWebhookInfo`,
      );
      if (!response.ok) return;
      const payload = await response.json();
      const pendingUpdates = Number(payload?.result?.pending_update_count ?? 0);
      const checkedAt = now();
      if (!shouldAlertWebhookQueue(pendingUpdates, lastAlertAt, checkedAt, alertCooldownMs)) return;

      const wibTime = new Date(checkedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const alertResponse = await fetcher(
        `https://api.telegram.org/bot${options.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: options.adminChatId,
            text: `🚨 <b>Antrean Telegram Meningkat</b>\n\nPesan tertahan: <b>${pendingUpdates}</b>\nAmbang peringatan: ${QUEUE_ALERT_THRESHOLD}\n🕒 ${wibTime} WIB\n\nBot tetap berjalan; periksa latensi database dan Railway.`,
            parse_mode: "HTML",
          }),
        },
      );
      if (alertResponse.ok) lastAlertAt = checkedAt;
    } catch (error) {
      console.error("[QUEUE_MONITOR]", (error as Error).message);
    } finally {
      checking = false;
    }
  };

  return {
    checkOnce,
    start(): void {
      if (timer !== undefined) return;
      void checkOnce();
      timer = setInterval(() => void checkOnce(), intervalMs);
    },
    stop(): void {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}
