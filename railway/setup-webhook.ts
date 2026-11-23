import { telegramWebhookSecret } from "../supabase/functions/_shared/telegram-webhook-auth.ts";
import { railwayTelegramWebhookUrl } from "../supabase/functions/_shared/telegram-webhook-url.ts";

const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const domain = Deno.env.get("RAILWAY_PUBLIC_DOMAIN");
if (!botToken || !domain) {
  console.error(
    "Set TELEGRAM_BOT_TOKEN dan RAILWAY_PUBLIC_DOMAIN terlebih dahulu.",
  );
  Deno.exit(1);
}

const webhookUrl = railwayTelegramWebhookUrl(domain);
const response = await fetch(
  `https://api.telegram.org/bot${botToken}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: await telegramWebhookSecret(botToken),
      max_connections: 40,
      allowed_updates: [
        "message",
        "callback_query",
        "edited_message",
        "my_chat_member",
        "pre_checkout_query",
      ],
      drop_pending_updates: false,
    }),
  },
);
const result = await response.json();
console.log(JSON.stringify(
  {
    ok: response.ok && result.ok === true,
    webhookUrl,
    description: result.description,
  },
  null,
  2,
));
if (!response.ok || result.ok !== true) Deno.exit(1);
