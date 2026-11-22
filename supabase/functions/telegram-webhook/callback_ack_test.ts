import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clearButtonClicksForTests } from "../_shared/button-debounce.ts";
import { clearServiceClientsForTests } from "../_shared/service-client.ts";
import { telegramWebhookSecret } from "../_shared/telegram-webhook-auth.ts";

Deno.test("Cari Partner mengirim ACK Telegram sebelum query database pertama", async () => {
  const previous = {
    token: Deno.env.get("TELEGRAM_BOT_TOKEN"),
    url: Deno.env.get("SUPABASE_URL"),
    key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    fetch: globalThis.fetch,
  };
  const calls: string[] = [];
  clearButtonClicksForTests();
  clearServiceClientsForTests();
  Deno.env.set("TELEGRAM_BOT_TOKEN", "local-callback-test-token");
  Deno.env.set("SUPABASE_URL", "https://database.example.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local-test-service-key");

  globalThis.fetch = (input: Request | URL | string): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/rest/v1/rpc/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ message: "Berhenti setelah pembuktian urutan ACK" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  try {
    const { handleTelegramWebhook } = await import("./handler.ts");
    const token = "local-callback-test-token";
    const response = await handleTelegramWebhook(
      new Request("http://localhost/telegram-webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": await telegramWebhookSecret(token),
        },
        body: JSON.stringify({
          update_id: 1,
          callback_query: {
            id: "callback-ack-proof",
            from: { id: 987654321, first_name: "Pengujian" },
            data: "search_partner",
            message: {
              message_id: 10,
              from: { id: 987654321, first_name: "Pengujian" },
              chat: { id: 987654321 },
            },
          },
        }),
      }),
    );

    // RPC sengaja gagal agar tes berhenti tanpa mengubah data; kegagalan ini ditangani bot.
    assertEquals(response.status, 200);
    assert(calls.length >= 2);
    assert(calls[0].includes("/answerCallbackQuery"));
    const firstDatabaseCall = calls.findIndex((url) =>
      url.includes("/rest/v1/")
    );
    assert(firstDatabaseCall > 0, "Database tidak boleh dipanggil sebelum ACK");
  } finally {
    globalThis.fetch = previous.fetch;
    clearButtonClicksForTests();
    clearServiceClientsForTests();
    for (
      const [name, value] of [["TELEGRAM_BOT_TOKEN", previous.token], [
        "SUPABASE_URL",
        previous.url,
      ], ["SUPABASE_SERVICE_ROLE_KEY", previous.key]] as const
    ) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
