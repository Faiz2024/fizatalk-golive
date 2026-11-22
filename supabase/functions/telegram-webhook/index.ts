import { handleTelegramWebhook } from "./handler.ts";

Deno.serve(handleTelegramWebhook);
