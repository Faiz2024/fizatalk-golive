// === LOGIKA SUKSES PEMBAYARAN (dipakai bersama Sakurupiah & Pakasir) ===
const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function sendTelegramMessage(botToken: string, chatId: number, text: string, replyMarkup?: any): Promise<void> {
  const body: any = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function formatDateWIB(date: Date): string {
  return date.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// === PREMIUM SUCCESS ===
export async function handlePremiumSuccess(supabase: any, botToken: string, requestId: string, gatewayLabel = 'Sakurupiah') {
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

  const { data: userData } = await supabase
    .from('telegram_users')
    .select('premium_until, special_promo_purchased_at, has_received_special_promo, special_promo_sent_at')
    .eq('id', req.user_id)
    .single();

  const isSpecialPromo = (req.price === 15000 && req.duration_days === 30) || (req.price === 10000 && req.duration_days === 7);

  // Validasi Lapis 3: Cek apakah invoice telat dibayar (melewati batas hari) atau sudah klaim
  if (isSpecialPromo) {
    let isPromoValid = false;
    if (userData?.has_received_special_promo && userData?.special_promo_sent_at) {
      const sentAt = new Date(userData.special_promo_sent_at);
      const sentWib = new Date(sentAt.getTime() + (7 * 60 * 60 * 1000));
      const sentDate = sentWib.toISOString().split('T')[0];

      const now = new Date();
      const nowWib = new Date(now.getTime() + (7 * 60 * 60 * 1000));
      const nowDate = nowWib.toISOString().split('T')[0];

      if (sentDate === nowDate) {
        isPromoValid = true;
      }
    }

    if (!isPromoValid || userData?.special_promo_purchased_at) {
      console.warn(`[CALLBACK] Special promo rejected for ${req.user_id}: expired or already purchased.`);

      await supabase
        .from('premium_requests')
        .update({ status: 'expired', processed_at: new Date().toISOString() })
        .eq('id', requestId);

      await sendTelegramMessage(botToken, req.user_id, '⚠️ <b>Transaksi Ditolak</b>\n\nPembayaran diterima, namun batas waktu penawaran promo khusus ini telah habis (kedaluwarsa) atau jatah (1x seumur hidup) telah terpakai. Transaksi promo tidak berlaku lagi.');
      return;
    }
  }

  let premiumEndDate: Date;
  if (userData?.premium_until && new Date(userData.premium_until) > new Date()) {
    premiumEndDate = new Date(userData.premium_until);
    premiumEndDate.setDate(premiumEndDate.getDate() + req.duration_days);
  } else {
    premiumEndDate = new Date();
    premiumEndDate.setDate(premiumEndDate.getDate() + req.duration_days);
  }

  const updatePayload: any = { premium_until: premiumEndDate.toISOString(), penalty_points: 0 };
  if (isSpecialPromo) {
    updatePayload.special_promo_purchased_at = new Date().toISOString();
  }

  await supabase
    .from('telegram_users')
    .update(updatePayload)
    .eq('id', req.user_id);

  await supabase
    .from('blocked_users')
    .update({ is_active: false })
    .eq('user_id', req.user_id);

  await supabase
    .from('premium_requests')
    .update({ status: 'approved', processed_at: new Date().toISOString() })
    .eq('id', requestId);

  await supabase.from('coin_transactions').insert({
    user_id: req.user_id,
    amount: -req.price,
    type: 'purchase',
    description: `Pembelian Premium ${req.duration_days} hari via ${req.payment_method || gatewayLabel}`
  });

  const formattedDate = formatDateWIB(premiumEndDate);

  await sendTelegramMessage(botToken, req.user_id,
    `🎉 <b>SELAMAT! PREMIUM AKTIF!</b>\n\n✨ Kamu sekarang adalah user Premium!\n📅 Berlaku hingga: ${formattedDate}\n\n🎯 Gunakan /target untuk memilih gender chat!\n\nTerima kasih telah berlangganan! 💎`
  );

  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `✅ <b>PREMIUM AUTO-APPROVED</b>\n\n👤 User: ${req.user_id}\n💎 Paket: ${req.duration_days} hari\n💰 Rp ${req.price.toLocaleString('id-ID')}\n📱 Via: ${req.payment_method}\n📅 Hingga: ${formattedDate}`
    );
  }

  console.log(`[CALLBACK] Premium approved: user=${req.user_id} days=${req.duration_days}`);
}

// === TOPUP SUCCESS ===
export async function handleTopupSuccess(supabase: any, botToken: string, requestId: string, gatewayLabel = 'Sakurupiah') {
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
    description: `Top-up ${req.amount} koin via ${req.payment_method || gatewayLabel}`
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
export async function handleFineSuccess(supabase: any, botToken: string, requestId: string, gatewayLabel = 'Sakurupiah') {
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

  await supabase
    .from('pending_transactions')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', requestId);

  await supabase
    .from('blocked_users')
    .update({ is_active: false, unblocked_at: new Date().toISOString() })
    .eq('user_id', req.user_id);

  await supabase
    .from('telegram_users')
    .update({ penalty_points: 0 })
    .eq('id', req.user_id);

  await supabase.from('coin_transactions').insert({
    user_id: req.user_id,
    amount: -req.amount,
    type: 'deduction',
    description: `Pembayaran denda buka blokir via ${gatewayLabel}`
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
export async function handleExpired(supabase: any, botToken: string, prefix: string, requestId: string) {
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
