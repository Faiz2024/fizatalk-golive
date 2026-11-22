import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRouter, type RouteTable } from "./server.ts";

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
