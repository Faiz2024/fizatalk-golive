import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createWebhookQueueMonitor,
  QUEUE_ALERT_COOLDOWN_MS,
  QUEUE_ALERT_THRESHOLD,
  QUEUE_MONITOR_INTERVAL_MS,
  shouldAlertWebhookQueue,
} from "./webhook-queue-monitor.ts";

Deno.test("peringatan hanya di atas 300 dan maksimal sekali per 30 menit", () => {
  assertEquals(QUEUE_MONITOR_INTERVAL_MS, 600_000);
  assertEquals(QUEUE_ALERT_THRESHOLD, 300);
  assertEquals(QUEUE_ALERT_COOLDOWN_MS, 1_800_000);
  assertEquals(shouldAlertWebhookQueue(300, null, 10_000), false);
  assertEquals(shouldAlertWebhookQueue(301, null, 10_000), true);
  assertEquals(shouldAlertWebhookQueue(900, 10_000, 1_809_999), false);
  assertEquals(shouldAlertWebhookQueue(900, 10_000, 1_810_000), true);
});

Deno.test("monitor mengirim satu peringatan WIB dan tidak menumpuk pemeriksaan", async () => {
  const requests: Array<{ url: string; body?: string }> = [];
  const fetcher = ((input: Request | URL | string, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.endsWith("/getWebhookInfo")) {
      return Promise.resolve(Response.json({ ok: true, result: { pending_update_count: 301 } }));
    }
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;
  const monitor = createWebhookQueueMonitor({
    botToken: "test-token",
    adminChatId: "7567529103",
    fetcher,
    now: () => Date.parse("2026-11-23T17:00:00Z"),
  });
  await Promise.all([monitor.checkOnce(), monitor.checkOnce()]);
  await monitor.checkOnce();
  const alerts = requests.filter((request) => request.url.endsWith("/sendMessage"));
  assertEquals(alerts.length, 1);
  assert(alerts[0].body?.includes('"pending') === false);
  assert(alerts[0].body?.includes("301"));
  assert(alerts[0].body?.includes("WIB"));
  monitor.stop();
});
