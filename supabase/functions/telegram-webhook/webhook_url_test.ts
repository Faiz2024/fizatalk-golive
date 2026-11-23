import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { railwayTelegramWebhookUrl } from "../_shared/telegram-webhook-url.ts";

Deno.test("seluruh setup webhook memakai endpoint Railway yang sama", () => {
  assertEquals(
    railwayTelegramWebhookUrl("fizatalk-golive-production.up.railway.app"),
    "https://fizatalk-golive-production.up.railway.app/telegram-webhook",
  );
  assertEquals(
    railwayTelegramWebhookUrl("https://fizatalk-golive-production.up.railway.app/"),
    "https://fizatalk-golive-production.up.railway.app/telegram-webhook",
  );
  assertThrows(() => railwayTelegramWebhookUrl("  "));
});
