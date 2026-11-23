import { telegramWebhookSecret } from '../_shared/telegram-webhook-auth.ts'
import { railwayTelegramWebhookUrl } from '../_shared/telegram-webhook-url.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    const railwayDomain = Deno.env.get('RAILWAY_PUBLIC_DOMAIN') || 'fizatalk-golive-production.up.railway.app'

    if (!botToken) {
      console.error('Missing TELEGRAM_BOT_TOKEN')
      return new Response('Missing configuration', { status: 500, headers: corsHeaders })
    }

    // Jangan pernah mengarahkan webhook produksi kembali ke runtime Supabase lama.
    const webhookUrl = railwayTelegramWebhookUrl(railwayDomain)

    const resp = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: await telegramWebhookSecret(botToken),
        max_connections: 40,
        allowed_updates: ['message', 'callback_query', 'edited_message', 'my_chat_member', 'pre_checkout_query'],
        drop_pending_updates: false,
      })
    })

    const data = await resp.json()
    console.log('SetWebhook response:', data)

    return new Response(JSON.stringify({ ok: true, webhookUrl, telegram: data }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('setup-telegram-webhook error', e)
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
