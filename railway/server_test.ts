import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRouter, type RouteTable } from "./server.ts";
import { telegramWebhookSecret } from "../supabase/functions/_shared/telegram-webhook-auth.ts";
import { clearServiceClientsForTests } from "../supabase/functions/_shared/service-client.ts";

async function runWebhookWithFetch(update: unknown, fetcher: typeof fetch): Promise<Response> {
  const previous = {
    token: Deno.env.get("TELEGRAM_BOT_TOKEN"),
    url: Deno.env.get("SUPABASE_URL"),
    key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };
  const originalFetch = globalThis.fetch;
  const token = "local-resilience-test-token";
  Deno.env.set("TELEGRAM_BOT_TOKEN", token);
  Deno.env.set("SUPABASE_URL", "https://resilience.example.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local-test-key");
  globalThis.fetch = fetcher;
  clearServiceClientsForTests();
  try {
    const { handleTelegramWebhook } = await import(
      "../supabase/functions/telegram-webhook/handler.ts"
    );
    return await handleTelegramWebhook(new Request("http://localhost/telegram-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": await telegramWebhookSecret(token),
      },
      body: JSON.stringify(update),
    }));
  } finally {
    globalThis.fetch = originalFetch;
    clearServiceClientsForTests();
    for (const [name, value] of [
      ["TELEGRAM_BOT_TOKEN", previous.token],
      ["SUPABASE_URL", previous.url],
      ["SUPABASE_SERVICE_ROLE_KEY", previous.key],
    ] as const) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("health check siap tanpa memanggil handler atau database", async () => {
  let calls = 0;
  const routes: RouteTable = {
    "/telegram-webhook": () => {
      calls++;
      return new Response("should not run");
    },
  };
  const response = await createRouter(routes, () => true)(
    new Request("http://localhost/health"),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ok",
    service: "fizatalk-bot",
  });
  assertEquals(calls, 0);
});

Deno.test("health check menolak runtime yang belum dikonfigurasi", async () => {
  const response = await createRouter({}, () => false)(
    new Request("http://localhost/health"),
  );
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { status: "not_configured" });
});

Deno.test("path Railway dan /functions/v1 memakai handler yang sama", async () => {
  for (
    const path of [
      "/telegram-webhook",
      "/telegram-webhook/",
      "/functions/v1/telegram-webhook",
    ]
  ) {
    const routes: RouteTable = {
      "/telegram-webhook": async (req) =>
        new Response(`${req.method}:${await req.text()}`, { status: 202 }),
    };
    const response = await createRouter(routes, () => true)(
      new Request(`http://localhost${path}`, {
        method: "POST",
        body: "update",
      }),
    );
    assertEquals(response.status, 202);
    assertEquals(await response.text(), "POST:update");
  }
});

Deno.test("path asing dan error internal tidak membocorkan detail", async () => {
  const routes: RouteTable = {
    "/telegram-webhook": () => {
      throw new Error("credential-shaped internal detail");
    },
  };
  const router = createRouter(routes, () => true);
  const missing = await router(new Request("http://localhost/unknown"));
  assertEquals(missing.status, 404);
  assertEquals(await missing.json(), { error: "not_found" });

  const failed = await router(
    new Request("http://localhost/telegram-webhook", { method: "POST" }),
  );
  assertEquals(failed.status, 500);
  assertEquals(await failed.json(), { error: "internal_error" });
});

Deno.test("pesan tertahan lebih dari 90 detik selesai tanpa database atau Telegram API", async () => {
  let calls = 0;
  const response = await runWebhookWithFetch(
    {
      update_id: 90,
      message: {
        message_id: 1,
        from: { id: 123, first_name: "Test" },
        chat: { id: 123 },
        date: Math.floor(Date.now() / 1000) - 91,
        text: "pesan lama",
      },
    },
    (() => {
      calls++;
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    }) as typeof fetch,
  );
  assertEquals(response.status, 200);
  assertEquals(calls, 0);
});

Deno.test("error database pada chat biasa kembali 200 dan memberi pesan coba lagi", async () => {
  const calls: string[] = [];
  const response = await runWebhookWithFetch(
    {
      update_id: 91,
      message: {
        message_id: 2,
        from: { id: 123, first_name: "Test" },
        chat: { id: 123 },
        date: Math.floor(Date.now() / 1000),
        text: "halo",
      },
    },
    ((input: Request | URL | string) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("api.telegram.org")) {
        return Promise.resolve(Response.json({ ok: true, result: { message_id: 3 } }));
      }
      return Promise.resolve(new Response("database busy", { status: 503 }));
    }) as typeof fetch,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(response.status, 200);
  assertEquals(calls.filter((url) => url.includes("get_chat_envelope")).length, 1);
  assertEquals(calls.filter((url) => url.includes("sendMessage")).length, 1);
});

Deno.test("pembayaran Stars lama tetap diproses dan error database kembali 500", async () => {
  const calls: string[] = [];
  const response = await runWebhookWithFetch(
    {
      update_id: 92,
      message: {
        message_id: 4,
        from: { id: 123, first_name: "Test" },
        chat: { id: 123 },
        date: 1,
        successful_payment: {
          currency: "XTR",
          total_amount: 149,
          invoice_payload: JSON.stringify({ t: "p", k: "n7" }),
          telegram_payment_charge_id: "charge-retry-test",
          provider_payment_charge_id: "provider-test",
        },
      },
    },
    ((input: Request | URL | string) => {
      calls.push(String(input));
      return Promise.resolve(new Response("database busy", { status: 503 }));
    }) as typeof fetch,
  );
  assertEquals(response.status, 500);
  assertEquals(calls.filter((url) => url.includes("premium_requests")).length, 1);
  assertEquals(calls.filter((url) => url.includes("sendMessage")).length, 0);
});

Deno.test("pre-checkout Stars mencoba ulang saat database gagal", async () => {
  const calls: string[] = [];
  const response = await runWebhookWithFetch(
    {
      update_id: 94,
      pre_checkout_query: {
        id: "checkout-database-failure",
        from: { id: 123, first_name: "Test" },
        currency: "XTR",
        total_amount: 149,
        invoice_payload: JSON.stringify({ t: "p", k: "n7" }),
      },
    },
    ((input: Request | URL | string) => {
      calls.push(String(input));
      return Promise.resolve(new Response("database busy", { status: 503 }));
    }) as typeof fetch,
  );
  assertEquals(response.status, 500);
  assertEquals(calls.filter((url) => url.includes("premium_purchase_allowed")).length, 1);
  assertEquals(calls.filter((url) => url.includes("answerPreCheckoutQuery")).length, 0);
});

Deno.test("payload pre-checkout tidak valid ditolak tanpa retry atau database", async () => {
  const calls: string[] = [];
  const response = await runWebhookWithFetch(
    {
      update_id: 95,
      pre_checkout_query: {
        id: "checkout-invalid-payload",
        from: { id: 123, first_name: "Test" },
        currency: "XTR",
        total_amount: 149,
        invoice_payload: "not-json",
      },
    },
    ((input: Request | URL | string) => {
      const url = String(input);
      calls.push(url);
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch,
  );
  assertEquals(response.status, 200);
  assertEquals(calls.filter((url) => url.includes("answerPreCheckoutQuery")).length, 1);
  assertEquals(calls.filter((url) => url.includes("supabase.co")).length, 0);
});

Deno.test("charge Stars yang sudah tercatat tidak memberi manfaat dua kali", async () => {
  const calls: string[] = [];
  const response = await runWebhookWithFetch(
    {
      update_id: 93,
      message: {
        message_id: 5,
        from: { id: 123, first_name: "Test" },
        chat: { id: 123 },
        date: Math.floor(Date.now() / 1000),
        successful_payment: {
          currency: "XTR",
          total_amount: 149,
          invoice_payload: JSON.stringify({ t: "p", k: "n7" }),
          telegram_payment_charge_id: "charge-already-done",
          provider_payment_charge_id: "provider-test",
        },
      },
    },
    ((input: Request | URL | string) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("premium_requests")) {
        return Promise.resolve(Response.json({ id: "existing-payment" }));
      }
      return Promise.resolve(new Response("must not be called", { status: 500 }));
    }) as typeof fetch,
  );
  assertEquals(response.status, 200);
  assertEquals(calls.length, 1);
});

Deno.test("webhook palsu ditolak sebelum koneksi database", async () => {
  const previous = Deno.env.get("TELEGRAM_BOT_TOKEN");
  Deno.env.set("TELEGRAM_BOT_TOKEN", "local-test-token");
  try {
    const { handleTelegramWebhook } = await import(
      "../supabase/functions/telegram-webhook/handler.ts"
    );
    const rejected = await handleTelegramWebhook(
      new Request("http://localhost/telegram-webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "forged",
        },
        body: "{}",
      }),
    );
    assertEquals(rejected.status, 403);
  } finally {
    if (previous === undefined) Deno.env.delete("TELEGRAM_BOT_TOKEN");
    else Deno.env.set("TELEGRAM_BOT_TOKEN", previous);
  }
});
