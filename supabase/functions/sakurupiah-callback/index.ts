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

// Normalize status values from provider
function isSuccessStatus(status: string, statusKode: any): boolean {
  const s = String(status).toLowerCase();
  const k = String(statusKode);
  return (
    (s === 'berhasil' || s === 'paid' || s === 'success' || s === 'settlement') &&
    (k === '1' || k === 'paid' || k === 'success')
  );
}

function isExpiredStatus(status: string, statusKode: any): boolean {
  const s = String(status).toLowerCase();
  const k = String(statusKode);
  return (
    (s === 'expired' || s === 'gagal' || s === 'failed') &&
    (k === '2' || k === 'expired' || k === 'failed')
  );
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();

  // === ENHANCED LOGGING: Headers ===
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => { allHeaders[k] = v; });
  console.log('[CALLBACK] === INCOMING REQUEST ===');
  console.log('[CALLBACK] Headers:', JSON.stringify(allHeaders));
  console.log('[CALLBACK] Body:', rawBody);

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

  console.log('[CALLBACK] Signature check:', { received: callbackSignature, expected: expectedSignature, match: callbackSignature === expectedSignature });

  if (callbackSignature !== expectedSignature) {
    console.error('[CALLBACK] ❌ Invalid signature - rejecting');
    return new Response(JSON.stringify({ success: false, message: 'Invalid signature' }), { status: 403 });
  }

  console.log('[CALLBACK] ✅ Signature valid');

  // Check callback event header - be lenient
  const callbackEvent = req.headers.get('x-callback-event') || '';
  console.log('[CALLBACK] Event header:', callbackEvent);
  
  if (callbackEvent && callbackEvent !== 'payment_status') {
    console.log('[CALLBACK] Non-payment event, ignoring:', callbackEvent);
    return new Response(JSON.stringify({ success: true, message: 'Ignored event' }));
  }

  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch (e) {
    console.error('[CALLBACK] ❌ Failed to parse body as JSON:', e);
    return new Response(JSON.stringify({ success: false, message: 'Invalid JSON' }), { status: 400 });
  }

  const { trx_id, merchant_ref, status, status_kode } = data;
  console.log('[CALLBACK] Parsed data:', { trx_id, merchant_ref, status, status_kode });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

  const prefix = merchant_ref ? merchant_ref.substring(0, 2) : '';
  console.log('[CALLBACK] Prefix:', prefix);

  if (isSuccessStatus(status, status_kode)) {
    console.log('[CALLBACK] ✅ Status = SUCCESS, processing...');
    if (prefix === 'p_') {
      await handlePremiumSuccess(supabase, botToken, merchant_ref, trx_id);
    } else if (prefix === 't_') {
      await handleTopupSuccess(supabase, botToken, merchant_ref, trx_id);
    } else if (prefix === 'f_') {
      await handleFineSuccess(supabase, botToken, merchant_ref, trx_id);
    } else {
      console.error('[CALLBACK] ❌ Unknown prefix:', prefix);
    }
  } else if (isExpiredStatus(status, status_kode)) {
    console.log('[CALLBACK] ⏰ Status = EXPIRED, processing...');
    await handleExpired(supabase, botToken, prefix, merchant_ref);
  } else {
    console.log('[CALLBACK] ⚠️ Unhandled status:', { status, status_kode });
  }

  return new Response(JSON.stringify({ success: true, message: `Status ${status}` }));
});

// === PREMIUM SUCCESS ===
async function handlePremiumSuccess(supabase: any, botToken: string, merchantRef: string, trxId?: string) {
  const requestId = merchantRef.substring(2);
  console.log('[CALLBACK:PREMIUM] Looking up request:', requestId);

  let req: any = null;

  // Primary lookup by merchant_ref
  const { data: d1, error: e1 } = await supabase
    .from('premium_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .single();

  if (d1) {
    req = d1;
    console.log('[CALLBACK:PREMIUM] Found by id:', requestId);
  } else {
    console.log('[CALLBACK:PREMIUM] Not found by id, trying trx_id fallback...');
    // Fallback: lookup by sakurupiah_trx_id
    if (trxId) {
      const { data: d2 } = await supabase
        .from('premium_requests')
        .select('*')
        .eq('sakurupiah_trx_id', trxId)
        .eq('status', 'pending')
        .single();
      if (d2) {
        req = d2;
        console.log('[CALLBACK:PREMIUM] Found by trx_id:', trxId);
      }
    }
  }

  if (!req) {
    console.error('[CALLBACK:PREMIUM] ❌ Request not found:', { requestId, trxId });
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
  const { error: updateErr } = await supabase
    .from('telegram_users')
    .update({ premium_until: premiumEndDate.toISOString(), penalty_points: 0 })
    .eq('id', req.user_id);
  console.log('[CALLBACK:PREMIUM] User update:', updateErr ? `❌ ${updateErr.message}` : '✅ OK');

  // Unblock if blocked
  await supabase
    .from('blocked_users')
    .update({ is_active: false })
    .eq('user_id', req.user_id);

  // Update request status
  const { error: reqErr } = await supabase
    .from('premium_requests')
    .update({ status: 'approved', processed_at: new Date().toISOString() })
    .eq('id', req.id);
  console.log('[CALLBACK:PREMIUM] Request update:', reqErr ? `❌ ${reqErr.message}` : '✅ OK');

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

  console.log(`[CALLBACK:PREMIUM] ✅ Approved: user=${req.user_id} days=${req.duration_days}`);
}

// === TOPUP SUCCESS ===
async function handleTopupSuccess(supabase: any, botToken: string, merchantRef: string, trxId?: string) {
  const requestId = merchantRef.substring(2);
  console.log('[CALLBACK:TOPUP] Looking up request:', requestId);

  let req: any = null;

  const { data: d1 } = await supabase
    .from('topup_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .single();

  if (d1) {
    req = d1;
    console.log('[CALLBACK:TOPUP] Found by id:', requestId);
  } else if (trxId) {
    console.log('[CALLBACK:TOPUP] Not found by id, trying trx_id fallback...');
    const { data: d2 } = await supabase
      .from('topup_requests')
      .select('*')
      .eq('sakurupiah_trx_id', trxId)
      .eq('status', 'pending')
      .single();
    if (d2) {
      req = d2;
      console.log('[CALLBACK:TOPUP] Found by trx_id:', trxId);
    }
  }

  if (!req) {
    console.error('[CALLBACK:TOPUP] ❌ Request not found:', { requestId, trxId });
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

  const { error: updateErr } = await supabase
    .from('telegram_users')
    .update({ coins: newBalance })
    .eq('id', req.user_id);
  console.log('[CALLBACK:TOPUP] User coins update:', updateErr ? `❌ ${updateErr.message}` : '✅ OK');

  await supabase.from('coin_transactions').insert({
    user_id: req.user_id,
    amount: req.amount,
    type: 'topup',
    description: `Top-up ${req.amount} koin via ${req.payment_method || 'Sakurupiah'}`
  });

  const { error: reqErr } = await supabase
    .from('topup_requests')
    .update({ status: 'approved', processed_at: new Date().toISOString() })
    .eq('id', req.id);
  console.log('[CALLBACK:TOPUP] Request update:', reqErr ? `❌ ${reqErr.message}` : '✅ OK');

  await sendTelegramMessage(botToken, req.user_id,
    `✅ <b>TOP-UP BERHASIL!</b>\n\n💰 ${req.amount} koin telah ditambahkan.\n💳 Saldo baru: ${newBalance} koin\n\nTerima kasih! 🎉`
  );

  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `✅ <b>TOPUP AUTO-APPROVED</b>\n\n👤 User: ${req.user_id}\n💰 ${req.amount} koin\n📱 Via: ${req.payment_method}`
    );
  }

  console.log(`[CALLBACK:TOPUP] ✅ Approved: user=${req.user_id} amount=${req.amount}`);
}

// === FINE SUCCESS (UNBLOCK) ===
async function handleFineSuccess(supabase: any, botToken: string, merchantRef: string, trxId?: string) {
  const requestId = merchantRef.substring(2);
  console.log('[CALLBACK:FINE] Looking up request:', requestId);

  let req: any = null;

  const { data: d1 } = await supabase
    .from('pending_transactions')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .eq('admin_notes', 'FINE_PAYMENT')
    .single();

  if (d1) {
    req = d1;
    console.log('[CALLBACK:FINE] Found by id:', requestId);
  } else if (trxId) {
    console.log('[CALLBACK:FINE] Not found by id, trying trx_id fallback...');
    const { data: d2 } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('sakurupiah_trx_id', trxId)
      .eq('status', 'pending')
      .eq('admin_notes', 'FINE_PAYMENT')
      .single();
    if (d2) {
      req = d2;
      console.log('[CALLBACK:FINE] Found by trx_id:', trxId);
    }
  }

  if (!req) {
    console.error('[CALLBACK:FINE] ❌ Request not found:', { requestId, trxId });
    return;
  }

  // Approve transaction
  const { error: txErr } = await supabase
    .from('pending_transactions')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', req.id);
  console.log('[CALLBACK:FINE] Transaction update:', txErr ? `❌ ${txErr.message}` : '✅ OK');

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

  console.log(`[CALLBACK:FINE] ✅ Approved, user unblocked: ${req.user_id}`);
}

// === HANDLE EXPIRED ===
async function handleExpired(supabase: any, botToken: string, prefix: string, merchantRef: string) {
  const requestId = merchantRef.substring(2);
  console.log('[CALLBACK:EXPIRED] Processing:', { prefix, requestId });

  if (prefix === 'p_') {
    const { error } = await supabase.from('premium_requests')
      .update({ status: 'expired', processed_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'pending');
    console.log('[CALLBACK:EXPIRED] Premium update:', error ? `❌ ${error.message}` : '✅ OK');

    const { data: req } = await supabase.from('premium_requests').select('user_id').eq('id', requestId).single();
    if (req) {
      await sendTelegramMessage(botToken, req.user_id,
        '⏰ <b>Transaksi Premium Expired</b>\n\nWaktu pembayaran telah habis. Silakan buat transaksi baru jika masih ingin berlangganan Premium.'
      );
    }
  } else if (prefix === 't_') {
    const { error } = await supabase.from('topup_requests')
      .update({ status: 'expired', processed_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'pending');
    console.log('[CALLBACK:EXPIRED] Topup update:', error ? `❌ ${error.message}` : '✅ OK');

    const { data: req } = await supabase.from('topup_requests').select('user_id').eq('id', requestId).single();
    if (req) {
      await sendTelegramMessage(botToken, req.user_id,
        '⏰ <b>Transaksi Top-up Expired</b>\n\nWaktu pembayaran telah habis. Gunakan /topup untuk membuat transaksi baru.'
      );
    }
  } else if (prefix === 'f_') {
    const { error } = await supabase.from('pending_transactions')
      .update({ status: 'expired' })
      .eq('id', requestId)
      .eq('status', 'pending');
    console.log('[CALLBACK:EXPIRED] Fine update:', error ? `❌ ${error.message}` : '✅ OK');
  }

  console.log(`[CALLBACK:EXPIRED] Done: ${prefix} ${requestId}`);
}
