import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')

    if (!botToken || !supabaseUrl) {
      console.error('Missing TELEGRAM_BOT_TOKEN or SUPABASE_URL')
      return new Response('Missing configuration', { status: 500, headers: corsHeaders })
    }

    // Derive functions host from Supabase URL
    const functionsHost = supabaseUrl.replace('https://', 'https://').replace('.supabase.co', '.functions.supabase.co')
    const webhookUrl = `${functionsHost}/telegram-webhook`

    const resp = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query', 'message_reaction', 'edited_message', 'chat_member', 'pre_checkout_query'],
        drop_pending_updates: true,
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
