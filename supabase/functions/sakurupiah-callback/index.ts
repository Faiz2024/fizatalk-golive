import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const TELEGRAM_API = 'https://api.telegram.org/bot';

async function sendTelegramMessage(botToken: string, chatId: number, text: string, replyMarkup?: any): Promise<void> {
  const body: any = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formatDateWIB(date: Date): string {
  return date.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric'
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  console.log('[CALLBACK] Received:', rawBody);

  // Validate X-Callback-Signature
  const callbackSignature = req.headers.get('x-callback-signature') || '';
  const apiKey = Deno.env.get('SAKURUPIAH_API_KEY') || '';

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedSignature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (callbackSignature !== expectedSignature) {
    console.error('[CALLBACK] Invalid signature');
    return new Response(JSON.stringify({ success: false, message: 'Invalid signature' }), { status: 403 });
  }

  const callbackEvent = req.headers.get('x-callback-event');
  if (callbackEvent !== 'payment_status') {
    return new Response(JSON.stringify({ success: true, message: 'Ignored event' }));
  }

  const data = JSON.parse(rawBody);
  const { trx_id, merchant_ref, status, status_kode } = data;
  console.log(`[CALLBACK] trx_id=${trx_id} ref=${merchant_ref} status=${status} code=${status_kode}`);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

  const prefix = merchant_ref.substring(0, 2);

  if (status === 'berhasil' && status_kode === 1) {
    if (prefix === 'p_') {
      await handlePremiumSuccess(supabase, botToken, merchant_ref);
    } else if (prefix === 't_') {
      await handleTopupSuccess(supabase, botToken, merchant_ref);
    } else if (prefix === 'f_') {
      await handleFineSuccess(supabase, botToken, merchant_ref);
    }
  } else if (status === 'expired' && status_kode === 2) {
    await handleExpired(supabase, botToken, prefix, merchant_ref);
  }

  return new Response(JSON.stringify({ success: true, message: `Status ${status}` }));
});

// === PREMIUM SUCCESS ===
async function handlePremiumSuccess(supabase: any, botToken: string, merchantRef: string) {
  const requestId = merchantRef.substring(2);

  const { data: req, error } = await supabase
    .from('premium_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .single();

  if (error || !req) {
    console.error('[CALLBACK] Premium not found:', requestId);
    return;
  }

  // Calculate premium end date
  const { data: userData } = await supabase
    .from('telegram_users')
    .select('premium_until')
    .eq('id', req.user_id)
    .single();

  let premiumEndDate: Date;
  if (userData?.premium_until && new Date(userData.premium_until) > new Date()) {
    premiumEndDate = new Date(userData.premium_until);
    premiumEndDate.setDate(premiumEndDate.getDate() + req.duration_days);
  } else {
    premiumEndDate = new Date();
    premiumEndDate.setDate(premiumEndDate.getDate() + req.duration_days);
  }

  // Update user: activate premium + reset penalty
  await supabase
    .from('telegram_users')
    .update({ premium_until: premiumEndDate.toISOString(), penalty_points: 0 })
    .eq('id', req.user_id);

  // Unblock if blocked
  await supabase
    .from('blocked_users')
    .update({ is_active: false })
    .eq('user_id', req.user_id);

  // Update request status
  await supabase
    .from('premium_requests')
    .update({ status: 'approved', processed_at: new Date().toISOString() })
    .eq('id', requestId);

  // Record transaction
  await supabase.from('coin_transactions').insert({
    user_id: req.user_id,
    amount: -req.price,
    type: 'purchase',
    description: `Pembelian Premium ${req.duration_days} hari via ${req.payment_method || 'Sakurupiah'}`
  });

  const formattedDate = formatDateWIB(premiumEndDate);

  await sendTelegramMessage(botToken, req.user_id,
    `🎉 <b>SELAMAT! PREMIUM AKTIF!</b>\n\n✨ Kamu sekarang adalah user Premium!\n📅 Berlaku hingga: ${formattedDate}\n\n🎯 Gunakan /target untuk memilih gender chat!\n\nTerima kasih telah berlangganan! 💎`
  );

  // Notify admin
  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `✅ <b>PREMIUM AUTO-APPROVED</b>\n\n👤 User: ${req.user_id}\n💎 Paket: ${req.duration_days} hari\n💰 Rp ${req.price.toLocaleString('id-ID')}\n📱 Via: ${req.payment_method}\n📅 Hingga: ${formattedDate}`
    );
  }

  console.log(`[CALLBACK] Premium approved: user=${req.user_id} days=${req.duration_days}`);
}

// === TOPUP SUCCESS ===
async function handleTopupSuccess(supabase: any, botToken: string, merchantRef: string) {
  const requestId = merchantRef.substring(2);

  const { data: req, error } = await supabase
    .from('topup_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .single();

  if (error || !req) {
    console.error('[CALLBACK] Topup not found:', requestId);
    return;
  }

  // Add coins
  const { data: userData } = await supabase
    .from('telegram_users')
    .select('coins')
    .eq('id', req.user_id)
    .single();

  const currentCoins = userData?.coins || 0;
  const newBalance = currentCoins + req.amount;

  await supabase
    .from('telegram_users')
    .update({ coins: newBalance })
    .eq('id', req.user_id);

  await supabase.from('coin_transactions').insert({
    user_id: req.user_id,
    amount: req.amount,
    type: 'topup',
    description: `Top-up ${req.amount} koin via ${req.payment_method || 'Sakurupiah'}`
  });

  await supabase
    .from('topup_requests')
    .update({ status: 'approved', processed_at: new Date().toISOString() })
    .eq('id', requestId);

  await sendTelegramMessage(botToken, req.user_id,
    `✅ <b>TOP-UP BERHASIL!</b>\n\n💰 ${req.amount} koin telah ditambahkan.\n💳 Saldo baru: ${newBalance} koin\n\nTerima kasih! 🎉`
  );

  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `✅ <b>TOPUP AUTO-APPROVED</b>\n\n👤 User: ${req.user_id}\n💰 ${req.amount} koin\n📱 Via: ${req.payment_method}`
    );
  }

  console.log(`[CALLBACK] Topup approved: user=${req.user_id} amount=${req.amount}`);
}

// === FINE SUCCESS (UNBLOCK) ===
async function handleFineSuccess(supabase: any, botToken: string, merchantRef: string) {
  const requestId = merchantRef.substring(2);

  const { data: req, error } = await supabase
    .from('pending_transactions')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .eq('admin_notes', 'FINE_PAYMENT')
    .single();

  if (error || !req) {
    console.error('[CALLBACK] Fine not found:', requestId);
    return;
  }

  // Approve transaction
  await supabase
    .from('pending_transactions')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', requestId);

  // Unblock user
  await supabase
    .from('blocked_users')
    .update({ is_active: false, unblocked_at: new Date().toISOString() })
    .eq('user_id', req.user_id);

  // Reset penalty
  await supabase
    .from('telegram_users')
    .update({ penalty_points: 0 })
    .eq('id', req.user_id);

  // Record transaction
  await supabase.from('coin_transactions').insert({
    user_id: req.user_id,
    amount: -req.amount,
    type: 'deduction',
    description: `Pembayaran denda buka blokir via Sakurupiah`
  });

  const welcomeKeyboard = {
    inline_keyboard: [[{ text: '🔍 Cari Partner', callback_data: 'search_partner' }]]
  };

  await sendTelegramMessage(botToken, req.user_id,
    `✅ <b>AKUN TELAH DIBUKA BLOKIR!</b>\n\n🎉 Pembayaran denda berhasil diverifikasi otomatis.\n\nAkun Anda sekarang aktif kembali. Harap patuhi ketentuan penggunaan.\n\nSilakan mulai chat:`,
    welcomeKeyboard
  );

  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `✅ <b>DENDA AUTO-APPROVED - USER UNBLOCKED</b>\n\n👤 User: ${req.user_id}\n💰 Denda: Rp ${req.amount.toLocaleString('id-ID')}`
    );
  }

  console.log(`[CALLBACK] Fine approved, user unblocked: ${req.user_id}`);
}

// === HANDLE EXPIRED ===
async function handleExpired(supabase: any, botToken: string, prefix: string, merchantRef: string) {
  const requestId = merchantRef.substring(2);

  if (prefix === 'p_') {
    await supabase.from('premium_requests')
      .update({ status: 'expired', processed_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'pending');

    const { data: req } = await supabase.from('premium_requests').select('user_id').eq('id', requestId).single();
    if (req) {
      await sendTelegramMessage(botToken, req.user_id,
        '⏰ <b>Transaksi Premium Expired</b>\n\nWaktu pembayaran telah habis. Silakan buat transaksi baru jika masih ingin berlangganan Premium.'
      );
    }
  } else if (prefix === 't_') {
    await supabase.from('topup_requests')
      .update({ status: 'expired', processed_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'pending');

    const { data: req } = await supabase.from('topup_requests').select('user_id').eq('id', requestId).single();
    if (req) {
      await sendTelegramMessage(botToken, req.user_id,
        '⏰ <b>Transaksi Top-up Expired</b>\n\nWaktu pembayaran telah habis. Gunakan /topup untuk membuat transaksi baru.'
      );
    }
  } else if (prefix === 'f_') {
    await supabase.from('pending_transactions')
      .update({ status: 'expired' })
      .eq('id', requestId)
      .eq('status', 'pending');
  }

  console.log(`[CALLBACK] Expired: ${prefix} ${requestId}`);
}
