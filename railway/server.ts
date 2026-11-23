import { handleTelegramWebhook } from "../supabase/functions/telegram-webhook/handler.ts";
import { handlePakasirCallback } from "../supabase/functions/pakasir-callback/handler.ts";
import { handleSakurupiahCallback } from "../supabase/functions/sakurupiah-callback/handler.ts";
import { handleReengageUsers } from "../supabase/functions/reengage-users/handler.ts";
import { handleCallInviteExchange } from "../supabase/functions/call-invite-exchange/handler.ts";
import { createGracefulShutdown } from "./graceful-shutdown.ts";
import { createWebhookQueueMonitor } from "./webhook-queue-monitor.ts";

export type HttpHandler = (req: Request) => Response | Promise<Response>;
export type RouteTable = Readonly<Record<string, HttpHandler>>;

const handlers: RouteTable = {
  "/telegram-webhook": handleTelegramWebhook,
  "/pakasir-callback": handlePakasirCallback,
  "/sakurupiah-callback": handleSakurupiahCallback,
  "/reengage-users": handleReengageUsers,
  "/call-invite-exchange": handleCallInviteExchange,
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function coreRuntimeReady(): boolean {
  return Boolean(
    Deno.env.get("TELEGRAM_BOT_TOKEN") &&
      Deno.env.get("SUPABASE_URL") &&
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

export function createRouter(
  routes: RouteTable,
  isReady: () => boolean,
): HttpHandler {
  return async (req: Request): Promise<Response> => {
    const rawPath = new URL(req.url).pathname;
    const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;

    if (path === "/health") {
      return isReady()
        ? json({ status: "ok", service: "fizatalk-bot" }, 200)
        : json({ status: "not_configured" }, 503);
    }

    // Accept both Railway-native paths and existing /functions/v1/* integrations.
    const routePath = path.startsWith("/functions/v1/")
      ? path.slice("/functions/v1".length)
      : path;
    const handler = routes[routePath];
    if (!handler) return json({ error: "not_found" }, 404);

    try {
      return await handler(req);
    } catch {
      console.error(`[RAILWAY] Unhandled error on ${routePath}`);
      return json({ error: "internal_error" }, 500);
    }
  };
}

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const server = Deno.serve(
    { hostname: "0.0.0.0", port },
    createRouter(handlers, coreRuntimeReady),
  );
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const adminChatId = Deno.env.get("TELEGRAM_CS_CHAT_ID");
  const queueMonitor = botToken && adminChatId
    ? createWebhookQueueMonitor({ botToken, adminChatId })
    : null;
  queueMonitor?.start();

  const shutdownServer = createGracefulShutdown(server);
  const shutdown = () => {
    queueMonitor?.stop();
    shutdownServer();
  };
  Deno.addSignalListener("SIGTERM", shutdown);
  Deno.addSignalListener("SIGINT", shutdown);
}
