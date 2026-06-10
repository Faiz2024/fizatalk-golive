import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'; // v1


// GANTI DENGAN URL DARI BAGIAN 1
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxkflZxZk7D4hYweb-Mrvcy90kTsk7Jdmkr9nZ0hru7VYqGe1LFfh2yqsLbKNsq9uCS/exec";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
  };
  date?: number; // Waktu pesan dikirim dalam Unix time (seconds)
  text?: string;
  photo?: Array<{
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    width: number;
    height: number;
  }>;
  caption?: string; // Tambahkan caption untuk media
  video?: any; // Representasi video
  voice?: any; // Representasi voice/voicenote
  sticker?: any; // Representasi sticker
  document?: any; // Representasi dokumen
  animation?: any; // Representasi GIF
  video_note?: any; // Representasi video note
  reply_to_message?: TelegramMessage; // Untuk fitur reply
  successful_payment?: SuccessfulPayment; // Telegram Stars payment
  // Tambahkan tipe media lain jika diperlukan
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  caption_entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
}

interface TelegramReaction {
  emoji?: string;
  custom_emoji_id?: string;
}

interface MessageReaction {
  chat: {
    id: number;
  };
  message_id: number;
  user: {
    id: number;
  };
  date: number;
  old_reaction: TelegramReaction[];
  new_reaction: TelegramReaction[];
}

interface CallbackQuery {
  id: string;
  from: {
    id: number;
    first_name: string;
    username?: string;
  };
  message?: {
    message_id: number;
    chat: {
      id: number;
    };
  };
  data?: string;
}

interface ChatMemberUpdate {
  chat: { id: number; username?: string };
  from: { id: number; first_name: string; username?: string };
  new_chat_member: { status: string; user: { id: number; first_name: string; username?: string } };
}

interface PreCheckoutQuery {
  id: string;
  from: { id: number; first_name: string; username?: string };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  message_reaction?: MessageReaction;
  callback_query?: CallbackQuery;
  chat_member?: ChatMemberUpdate;
  pre_checkout_query?: PreCheckoutQuery;
}

interface Gift {
  id: string;
  name: string; // Nama Indonesia
  emoji: string;
  price: number; 
}



const TELEGRAM_API = 'https://api.telegram.org/bot';

// Channel yang wajib di-join sebelum bisa menggunakan fitur next/search
const REQUIRED_CHANNEL = '@FizaTalkCh';

// ============================================
// HELPER: Format waktu ke zona WIB (UTC+7)
// ============================================
function formatDateWIB(date: Date): string {
  return date.toLocaleDateString('id-ID', { 
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatDateTimeWIB(date: Date): string {
  return date.toLocaleString('id-ID', { 
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) + ' WIB';
}

function formatTimeWIB(date: Date): string {
  return date.toLocaleTimeString('id-ID', { 
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit'
  }) + ' WIB';
}

function formatRemainingTime(blockedUntilStr?: string): string {
  if (!blockedUntilStr) return '15 hari';
  const blockedUntil = new Date(blockedUntilStr);
  const now = new Date();
  const diffMs = blockedUntil.getTime() - now.getTime();
  if (diffMs <= 0) return '0 menit';
  
  const diffMinutes = Math.ceil(diffMs / 60000);
  if (diffMinutes < 60) {
    return `${diffMinutes} menit`;
  }
  
  const diffHours = Math.floor(diffMinutes / 60);
  const remainingMinutes = diffMinutes % 60;
  if (diffHours < 24) {
    return remainingMinutes > 0 
      ? `${diffHours} jam ${remainingMinutes} menit` 
      : `${diffHours} jam`;
  }
  
  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;
  
  let result = `${diffDays} hari`;
  if (remainingHours > 0) result += ` ${remainingHours} jam`;
  if (remainingMinutes > 0) result += ` ${remainingMinutes} menit`;
  
  return result;
}

// === SAKURUPIAH PAYMENT GATEWAY ===
const SAKURUPIAH_API_URL = 'https://sakurupiah.id/api/create.php';
const SAKURUPIAH_CALLBACK_URL = 'https://chwopnsmykwzqflqozvf.supabase.co/functions/v1/sakurupiah-callback';

interface SakurupiahInvoiceParams {
  method: 'QRIS' | 'DANA' | 'GOPAY' | 'SHOPEEPAY' | 'OVO';
  amount: number;
  merchantRef: string;
  productName: string;
  customerName?: string;
  expired?: number;
}

interface SakurupiahInvoiceResult {
  success: boolean;
  trxId?: string;
  qrString?: string;
  checkoutUrl?: string;
  paymentNo?: string; // <--- TAMBAHKAN INI
  error?: string;
}

async function createSakurupiahInvoice(params: SakurupiahInvoiceParams): Promise<SakurupiahInvoiceResult> {
  const apiId = Deno.env.get('SAKURUPIAH_API_ID') || '';
  const apiKey = Deno.env.get('SAKURUPIAH_API_KEY') || '';
  
  if (!apiId || !apiKey) {
    console.error('[SAKURUPIAH] API credentials not configured');
    return { success: false, error: 'Payment gateway not configured' };
  }

  // Generate signature: HMAC-SHA256(api_id + method + merchant_ref + amount, apikey)
  const signatureData = `${apiId}${params.method}${params.merchantRef}${params.amount}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signatureData));
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  const formData = new URLSearchParams();
  formData.append('api_id', apiId);
  formData.append('method', params.method);
  formData.append('name', params.customerName || 'FizaTalk User');
  formData.append('phone', '6280000000000');
  formData.append('amount', params.amount.toString());
  formData.append('merchant_fee', '2'); // 2 = biaya fee ditanggung pelanggan
  formData.append('merchant_ref', params.merchantRef);
  formData.append('expired', (params.expired || 60).toString());
  formData.append('produk[]', params.productName);
  formData.append('qty[]', '1');
  formData.append('harga[]', params.amount.toString());
  formData.append('callback_url', SAKURUPIAH_CALLBACK_URL);
  formData.append('return_url', 'https://t.me/FizaTalkBot');
  formData.append('signature', signature);

  try {
    const resp = await fetch(SAKURUPIAH_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const json = await resp.json();
    console.log('[SAKURUPIAH] Response:', JSON.stringify(json));

    if (json.status === '200' && json.data?.[0]) {
      const inv = json.data[0];
      console.log(`[SAKURUPIAH] Invoice created: trx_id=${inv.trx_id} qr=${inv.qr ? 'YES' : 'NO'} checkout_url=${inv.checkout_url}`);
      return {
        success: true,
        trxId: inv.trx_id,
        qrString: inv.qr || undefined,
        checkoutUrl: inv.checkout_url,
        paymentNo: inv.payment_no || undefined, // <--- TAMBAHKAN INI
      };
    }
    console.error('[SAKURUPIAH] Failed:', json.message, JSON.stringify(json));
    return { success: false, error: json.message || 'Invoice creation failed' };
  } catch (e) {
    console.error('[SAKURUPIAH] Error:', e);
    return { success: false, error: 'Network error' };
  }
}

// === PAYMENT METHOD SELECTION HELPER ===
function buildPaymentMethodKeyboard(
  baseCallback: string, 
  cancelCallback: string, 
  amountIDR: number = 0, 
  starsInvoiceUrl?: string
): any {
  // Derive Stars callback dari baseCallback
  const starsCallback = `${baseCallback}_STARS`;
  
  const kb: any[][] = [
    [{ text: '📱 QRIS (Scan Semua E-Wallet & Bank)', callback_data: `${baseCallback}_QRIS` }],
    [
      { text: '💙 DANA', callback_data: `${baseCallback}_DANA` },
      { text: '🟢 GoPay', callback_data: `${baseCallback}_GOPAY` }
    ]
    // [
    //   { text: '🟠 ShopeePay', callback_data: `${baseCallback}_SHOPEEPAY` },
    //   { text: '💜 OVO', callback_data: `${baseCallback}_OVO` }
    // ]
  ];

  // Tombol Stars
  if (amountIDR > 0) {
    const starsPrice = calculateStarsPrice(amountIDR);
    kb.push([starsInvoiceUrl
      ? { text: `⭐ Telegram Stars (${starsPrice} ⭐)`, url: starsInvoiceUrl }
      : { text: `⭐ Telegram Stars (${starsPrice} ⭐)`, callback_data: starsCallback }
    ]);
  } else {
    kb.push([starsInvoiceUrl
      ? { text: '⭐ Telegram Stars', url: starsInvoiceUrl }
      : { text: '⭐ Telegram Stars', callback_data: starsCallback }
    ]);
  }

  if (cancelCallback) kb.push([{ text: '🔙 Kembali', callback_data: cancelCallback }]);  
  return { inline_keyboard: kb };
}

// === PREMIUM PAYMENT CONFIG (Sakurupiah) ===
const PREMIUM_PAY_CONFIG: Record<string, { days: number; price: number; label: string }> = {
  '30': { days: 30, price: 28000, label: 'PREMIUM 30 HARI (PROMO SPESIAL)' },
  '35': { days: 35, price: 30000, label: 'PREMIUM 35 HARI (PROMO)' },
  '7': { days: 7, price: 19000, label: 'PREMIUM 7 HARI' },
  '3': { days: 3, price: 10000, label: 'PREMIUM 3 HARI' },
  '1': { days: 1, price: 5000, label: 'PREMIUM 1 HARI' },
  'n7': { days: 7, price: 25000, label: 'PREMIUM 7 HARI' },
  'n30': { days: 30, price: 60000, label: 'PREMIUM 30 HARI' },
};

const BUY_PREMIUM_MAP: Record<string, string> = {
  'buy_premium_30': '30',
  'buy_premium_35': '35',
  'buy_premium_7': '7',
  'buy_premium_3': '3',
  'buy_premium_1': '1',
  'buy_premium_normal_7': 'n7',
  'buy_premium_normal_30': 'n30',
};

// === TELEGRAM STARS PAYMENT ===
// 1 Star ≈ $0.013 gross, Telegram takes ~35% → net $0.00845/Star
// At 1 USD ≈ 16,300 IDR → 1 Star net ≈ Rp 137
// Use Rp 125/Star for profit margin after conversion volatility
const STARS_NET_VALUE_IDR = 125;

function calculateStarsPrice(priceIDR: number): number {
  return Math.ceil(priceIDR / STARS_NET_VALUE_IDR);
}

async function createStarsInvoiceLink(
  botToken: string,
  title: string, description: string,
  payload: string, starsAmount: number
): Promise<string | null> {
  try {
    const resp = await fetch(`${TELEGRAM_API}${botToken}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        payload,
        currency: 'XTR',
        prices: [{ label: title, amount: starsAmount }],
      })
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error('[STARS] createInvoiceLink failed:', JSON.stringify(data));
      return null;
    }
    console.log(`[STARS] createInvoiceLink success: title="${title}" stars=${starsAmount}`);
    return data.result as string;
  } catch (e) {
    console.error('[STARS] createInvoiceLink error:', e);
    return null;
  }
}

// Process Stars payment for premium
async function processStarsPremiumPayment(
  botToken: string, userId: number, configKey: string,
  queryId: string, message: any
): Promise<void> {
  const config = PREMIUM_PAY_CONFIG[configKey];
  if (!config) {
    await answerCallbackQuery(botToken, queryId, '❌ Paket tidak valid');
    return;
  }

  const starsPrice = calculateStarsPrice(config.price);
  const payload = JSON.stringify({ t: 'p', k: configKey, u: userId });

  const invoiceLink = await createStarsInvoiceLink(
    botToken,
    config.label,
    `Premium ${config.days} hari - Rp ${config.price.toLocaleString('id-ID')}`,
    payload, starsPrice
  );

  if (invoiceLink) {
    await answerCallbackQuery(botToken, queryId, '', false, invoiceLink);
  } else {
    await answerCallbackQuery(botToken, queryId, '❌ Gagal membuat invoice Stars. Coba lagi.');
  }
}

// Process Stars payment for topup
async function processStarsTopupPayment(
  botToken: string, userId: number, amount: number,
  queryId: string, message: any
): Promise<void> {
  const COIN_PRICE = 10;
  const totalPrice = amount * COIN_PRICE;

  const starsPrice = calculateStarsPrice(totalPrice);
  const payload = JSON.stringify({ t: 'tu', a: amount, u: userId });

  const invoiceLink = await createStarsInvoiceLink(
    botToken,
    `Top-up ${amount.toLocaleString('id-ID')} Koin`,
    `${amount} koin - Rp ${totalPrice.toLocaleString('id-ID')}`,
    payload, starsPrice
  );

  if (invoiceLink) {
    await answerCallbackQuery(botToken, queryId, '', false, invoiceLink);
  } else {
    await answerCallbackQuery(botToken, queryId, '❌ Gagal membuat invoice Stars. Coba lagi.');
  }
}

// Process Stars payment for fine
async function processStarsFinePayment(
  botToken: string, userId: number,
  queryId: string, message: any
): Promise<void> {
  const FINE_AMOUNT = 10000;

  const starsPrice = calculateStarsPrice(FINE_AMOUNT);
  const payload = JSON.stringify({ t: 'f', u: userId });

  const invoiceLink = await createStarsInvoiceLink(
    botToken,
    'Pembayaran Denda - Buka Blokir',
    `Denda Rp ${FINE_AMOUNT.toLocaleString('id-ID')}`,
    payload, starsPrice
  );

  if (invoiceLink) {
    await answerCallbackQuery(botToken, queryId, '', false, invoiceLink);
  } else {
    await answerCallbackQuery(botToken, queryId, '❌ Gagal membuat invoice Stars. Coba lagi.');
  }
}

// Helper: Process successful Stars payment (called from successful_payment handler)
async function handleSuccessfulStarsPayment(
  supabase: any, botToken: string,
  userId: number, payloadStr: string,
  chargeId: string, starsAmount: number
): Promise<void> {
  try {
    const payload = JSON.parse(payloadStr);
    const type = payload.t;

    if (type === 'p') {
      // PREMIUM PAYMENT
      const configKey = payload.k;
      const config = PREMIUM_PAY_CONFIG[configKey];
      if (!config) {
        console.error('[STARS] Invalid premium config:', configKey);
        return;
      }

      // Get existing premium
      const { data: userData } = await supabase
        .from('telegram_users')
        .select('premium_until')
        .eq('id', userId).single();

      let premiumEndDate: Date;
      const existing = userData?.premium_until;
      if (existing && new Date(existing) > new Date()) {
        premiumEndDate = new Date(existing);
        premiumEndDate.setDate(premiumEndDate.getDate() + config.days);
      } else {
        premiumEndDate = new Date();
        premiumEndDate.setDate(premiumEndDate.getDate() + config.days);
      }

      // Update user
      await supabase.from('telegram_users')
        .update({ premium_until: premiumEndDate.toISOString(), penalty_points: 0 })
        .eq('id', userId);

      // Unblock if blocked
      await supabase.from('blocked_users')
        .update({ is_active: false })
        .eq('user_id', userId);

      // Record in premium_requests
      await supabase.from('premium_requests').insert({
        user_id: userId, duration_days: config.days, price: config.price,
        unique_code: 0, status: 'approved', payment_method: 'STARS',
        sakurupiah_trx_id: chargeId,
        processed_at: new Date().toISOString(),
      });

      // Record transaction
      await supabase.from('coin_transactions').insert({
        user_id: userId, amount: -config.price, type: 'purchase',
        description: `Premium ${config.days} hari via Stars (${starsAmount}⭐)`
      });

      const formattedDate = premiumEndDate.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric'
      });

      await sendTelegramMessage(botToken, userId,
        `🎉 <b>SELAMAT! PREMIUM AKTIF!</b>\n\n` +
        `✨ Kamu sekarang user Premium!\n` +
        `📅 Berlaku hingga: ${formattedDate}\n` +
        `⭐ Dibayar: ${starsAmount} Stars\n\n` +
        `🎯 Gunakan /target untuk pilih gender chat!\n\nTerima kasih! 💎`
      );

    } else if (type === 'tu') {
      // TOPUP PAYMENT
      const coinAmount = payload.a;
      const COIN_PRICE = 10;
      const totalPrice = coinAmount * COIN_PRICE;

      // Add coins
      const { data: userData } = await supabase
        .from('telegram_users')
        .select('coins')
        .eq('id', userId).single();

      const newBalance = (userData?.coins || 0) + coinAmount;
      await supabase.from('telegram_users')
        .update({ coins: newBalance })
        .eq('id', userId);

      // Record in topup_requests
      await supabase.from('topup_requests').insert({
        user_id: userId, amount: coinAmount, unique_code: 0,
        status: 'approved', payment_method: 'STARS',
        sakurupiah_trx_id: chargeId,
        processed_at: new Date().toISOString(),
      });

      // Record transaction
      await supabase.from('coin_transactions').insert({
        user_id: userId, amount: coinAmount, type: 'topup',
        description: `Top-up ${coinAmount} koin via Stars (${starsAmount}⭐)`
      });

      await sendTelegramMessage(botToken, userId,
        `✅ <b>TOP-UP BERHASIL!</b>\n\n` +
        `💰 +${coinAmount.toLocaleString('id-ID')} koin\n` +
        `💳 Saldo baru: ${newBalance.toLocaleString('id-ID')} koin\n` +
        `⭐ Dibayar: ${starsAmount} Stars\n\nTerima kasih! 🎉`
      );

    } else if (type === 'f') {
      // FINE PAYMENT
      const FINE_AMOUNT = 10000;

      // Unblock user
      await supabase.from('blocked_users')
        .update({ is_active: false, unblocked_at: new Date().toISOString() })
        .eq('user_id', userId);

      // Reset penalty
      await supabase.from('telegram_users')
        .update({ penalty_points: 0 })
        .eq('id', userId);

      // Record in pending_transactions
      await supabase.from('pending_transactions').insert({
        user_id: userId, amount: FINE_AMOUNT, unique_code: 0,
        total_amount: FINE_AMOUNT, status: 'approved',
        admin_notes: 'FINE_PAYMENT', payment_method: 'STARS',
        sakurupiah_trx_id: chargeId,
        approved_at: new Date().toISOString(),
      });

      // Record transaction
      await supabase.from('coin_transactions').insert({
        user_id: userId, amount: -FINE_AMOUNT, type: 'fine_payment',
        description: `Denda buka blokir via Stars (${starsAmount}⭐)`
      });

      const welcomeKeyboard = {
        inline_keyboard: [[{ text: '🔍 Cari Partner', callback_data: 'search_partner' }]]
      };

      await sendTelegramMessage(botToken, userId,
        `✅ <b>AKUN TELAH DIBUKA BLOKIR!</b>\n\n` +
        `🎉 Pembayaran denda berhasil!\n` +
        `⭐ Dibayar: ${starsAmount} Stars\n\n` +
        `Silakan mulai chat:`,
        welcomeKeyboard
      );

      // Notify admin
      const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
      if (csChatId) {
        await sendTelegramMessage(botToken, parseInt(csChatId),
          `✅ <b>DENDA DIBAYAR VIA STARS</b>\n\n🆔 User: <code>${userId}</code>\n⭐ Stars: ${starsAmount}\n💰 Denda: Rp ${FINE_AMOUNT.toLocaleString('id-ID')}\n\n✅ Auto-approved`
        );
      }
    }
  } catch (e) {
    console.error('[STARS] handleSuccessfulStarsPayment error:', e);
  }
}

// Helper: Process Sakurupiah payment for premium
async function processSakurupiahPremiumPayment(
  supabase: any, botToken: string, userId: number,
  configKey: string, method: 'QRIS' | 'DANA' | 'GOPAY' | 'SHOPEEPAY' | 'OVO', // Update tipe data di sini 
  queryId: string, message: any
): Promise<void> {
  const config = PREMIUM_PAY_CONFIG[configKey];
  if (!config) {
    await answerCallbackQuery(botToken, queryId, '❌ Paket tidak valid');
    return;
  }

  if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);

  const { data: userData } = await supabase
    .from('telegram_users')
    .select('premium_until, first_name, username')
    .eq('id', userId).single();

  // Cancel ALL old pending premium transactions so user can always create new one
  await supabase.from('premium_requests')
    .update({ status: 'cancelled' })
    .eq('user_id', userId).eq('status', 'pending');

  await answerCallbackQuery(botToken, queryId, '✅ Memproses pembayaran...');

  const { data: premReq, error: insertErr } = await supabase.from('premium_requests')
    .insert({
      user_id: userId, duration_days: config.days, price: config.price,
      unique_code: 0, status: 'pending', payment_method: method,
    }).select('id').single();

  if (insertErr || !premReq) {
    console.error('[PREMIUM] Insert error:', JSON.stringify(insertErr));
    await sendTelegramMessage(botToken, userId, '❌ Gagal membuat transaksi. Coba lagi.');
    return;
  }

  const merchantRef = `p_${premReq.id}`;
  const userName = userData?.username ? `@${userData.username}` : userData?.first_name || 'FizaTalk User';

  const invoice = await createSakurupiahInvoice({
    method, amount: config.price, merchantRef,
    productName: config.label, customerName: userName, expired: 60,
  });

  if (!invoice.success) {
    // Fallback ke QRIS Manual
    console.log(`[PREMIUM] Sakurupiah failed, fallback to QRIS Manual: ${invoice.error}`);
    const origCallback = Object.keys(BUY_PREMIUM_MAP).find(k => BUY_PREMIUM_MAP[k] === configKey) || 'cancel_premium';
    await sendManualQRISPayment(supabase, botToken, userId, 'prem', premReq.id, config.price, config.label, origCallback);
    return;
  }

  await supabase.from('premium_requests')
    .update({ sakurupiah_trx_id: invoice.trxId }).eq('id', premReq.id);

  // Mencari callback_data original yang memicu menu payment method (misal: buy_premium_30)
  const origCallback = Object.keys(BUY_PREMIUM_MAP).find(k => BUY_PREMIUM_MAP[k] === configKey) || 'cancel_premium';
  const cancelKb = { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: origCallback }]] };
    
  if (method === 'QRIS' && invoice.qrString) {
      const qrUrl = invoice.qrString;
      const caption = `💳  <b>${config.label}</b>\n\n` +
      `💰  Total: <b>Rp ${config.price.toLocaleString('id-ID')}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📱  <b>CARA BAYAR:</b>\n\n` +
      `1️⃣  Screenshot QR di atas\n` +
      `2️⃣  Buka E-Wallet/M-Banking favorit kamu\n` +
      `3️⃣  Pilih Scan QR / Bayar dari Galeri\n` +
      `4️⃣  Konfirmasi pembayaran\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `✅  Pembayaran <b>otomatis terverifikasi</b>\n` +
      `⏰  Batas waktu: <b>60 menit</b>`;
    try {
      const resp = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: userId, photo: qrUrl, caption, parse_mode: 'HTML', reply_markup: cancelKb })
      });
      const rj = await resp.json();
      if (rj.ok) {
        await supabase.from('premium_requests').update({ message_id: rj.result.message_id }).eq('id', premReq.id);
      } else {
        console.error('[PREMIUM QRIS] sendPhoto failed:', JSON.stringify(rj));
        // Fallback: kirim checkout URL sebagai link
        const fallbackKb = { inline_keyboard: [
          [{ text: '🔗 Buka Halaman Pembayaran', url: invoice.checkoutUrl! }],
          [{ text: '❌ Batalkan Transaksi', callback_data: 'cancel_premium' }]
        ]};
        await sendTelegramMessage(botToken, userId,
          `${caption}\n\n🔗 Klik tombol di bawah untuk membayar:`, fallbackKb);
      }
    } catch (e) {
      console.error('[PREMIUM QRIS] Error:', e);
      const fallbackKb = { inline_keyboard: [
        [{ text: '🔗 Buka Halaman Pembayaran', url: invoice.checkoutUrl! }],
        [{ text: '❌ Batalkan Transaksi', callback_data: 'cancel_premium' }]
      ]};
      await sendTelegramMessage(botToken, userId,
        `${caption}\n\n🔗 Klik tombol di bawah untuk membayar:`, fallbackKb);
    }
  } else {
    // --- LOGIKA E-WALLET BARU (DANA, GOPAY, OVO, SHOPEEPAY) ---
    console.log(`[PREMIUM ${method}] paymentNo:`, invoice.paymentNo, 'checkoutUrl:', invoice.checkoutUrl);
    
    // Konfigurasi visual UI UX E-Wallet
    const eWalletConfig: Record<string, { name: string, emoji: string }> = {
      'DANA': { name: 'DANA', emoji: '💙' },
      'GOPAY': { name: 'GoPay', emoji: '🟢' },
      'SHOPEEPAY': { name: 'ShopeePay', emoji: '🟠' },
      'OVO': { name: 'OVO', emoji: '💜' }
    };
    
    const walletInfo = eWalletConfig[method] || { name: method, emoji: '💳' };
    
    // Gunakan payment_no (Direct App Link) sebagai prioritas utama
    const payUrl = invoice.paymentNo || invoice.checkoutUrl!;
    
    const walletButtons: any[][] = [
      [{ text: `${walletInfo.emoji} Bayar via ${walletInfo.name}`, url: payUrl }]
    ];
    

    walletButtons.push([{ text: '🔙 Kembali', callback_data: origCallback }]);
    const walletKb = { inline_keyboard: walletButtons };

    await sendTelegramMessage(botToken, userId,
      `💳  <b>${config.label}</b>\n\n` +
      `💰  Total: <b>Rp ${config.price.toLocaleString('id-ID')}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📱  Klik tombol di bawah untuk membayar langsung via aplikasi <b>${walletInfo.name}</b>\n\n` +
      `✅  Pembayaran <b>otomatis terverifikasi</b>\n` +
      `⏰  Batas waktu: <b>60 menit</b>`,
      walletKb);
  }
  // Notify admin (Pembayaran Premium)
  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `💎 <b>PEMBAYARAN PREMIUM DIMULAI</b>\n\n👤 User: ${userName}\n🆔 ID: <code>${userId}</code>\n📦 Paket: ${config.label}\n💵 Total: Rp ${config.price.toLocaleString('id-ID')}\n📱 Via: ${method}\n\n⏳ Menunggu pembayaran (auto-verify)...`
    );
  }
}

// HELPER: Get bot setting from database
async function getBotSetting(supabase: any, key: string): Promise<string | null> {
  const { data } = await supabase
    .from('bot_settings')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value || null;
}

// HELPER: Set bot setting in database
async function setBotSetting(supabase: any, key: string, value: string, updatedBy: number): Promise<boolean> {
  const { error } = await supabase
    .from('bot_settings')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy
    });
  return !error;
}

// === QRIS MANUAL FALLBACK HELPER ===
// Digunakan saat Sakurupiah gagal membuat invoice
async function sendManualQRISPayment(
  supabase: any, botToken: string, userId: number,
  type: 'prem' | 'topup' | 'fine', transactionId: string,
  totalAmount: number, productLabel: string, cancelCallback: string
): Promise<void> {
  // Generate unique code untuk identifikasi pembayaran
  const { data: uniqueCode } = await supabase.rpc('generate_unique_payment_code');
  const code = uniqueCode || Math.floor(Math.random() * 999 + 1);
  const totalWithCode = totalAmount + code;

  // Update transaction dengan unique_code dan payment_method
  if (type === 'prem') {
    await supabase.from('premium_requests')
      .update({ unique_code: code, payment_method: 'QRIS_MANUAL', status: 'pending' })
      .eq('id', transactionId);
  } else if (type === 'topup') {
    await supabase.from('topup_requests')
      .update({ unique_code: code, payment_method: 'QRIS_MANUAL', status: 'pending' })
      .eq('id', transactionId);
  } else if (type === 'fine') {
    await supabase.from('pending_transactions')
      .update({ unique_code: code, payment_method: 'QRIS_MANUAL', total_amount: totalWithCode, status: 'pending' })
      .eq('id', transactionId);
  }

  // Set user state ke awaiting_payment
  await supabase.rpc('set_user_payment_state', { p_user_id: userId });

  // Ambil QRIS file_id dari bot_settings atau gunakan URL storage
  let qrisSource = await getBotSetting(supabase, 'qris_file_id');
  if (!qrisSource) {
    // Fallback ke Supabase Storage URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    qrisSource = `${supabaseUrl}/storage/v1/object/public/qris-assets/qris-payment.png`;
  }

  const caption = `📱 <b>${productLabel}</b>\n\n` +
    `💰 Total Bayar: <b>Rp ${totalWithCode.toLocaleString('id-ID')}</b>\n` +
    `🔢 Kode Unik: <b>${code}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📱 <b>CARA BAYAR:</b>\n\n` +
    `1️⃣ Scan QR Code di atas\n` +
    `2️⃣ Bayar sebesar <b>Rp ${totalWithCode.toLocaleString('id-ID')}</b>\n` +
    `3️⃣ <b>Kirim foto bukti transfer</b> ke chat ini\n` +
    `4️⃣ Tunggu verifikasi dari admin\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ <b>PENTING:</b> Pastikan nominal TEPAT termasuk kode unik!\n` +
    `⏰ Batas waktu: <b>60 menit</b>`;

  const cancelKb = { inline_keyboard: [[{ text: '❌ Batalkan', callback_data: cancelCallback }]] };

  try {
    const resp = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, photo: qrisSource, caption, parse_mode: 'HTML', reply_markup: cancelKb })
    });
    const rj = await resp.json();
    if (rj.ok) {
      // Simpan file_id untuk penggunaan berikutnya (hemat bandwidth)
      if (!await getBotSetting(supabase, 'qris_file_id') && rj.result.photo) {
        const photos = rj.result.photo;
        const fileId = photos[photos.length - 1].file_id;
        await setBotSetting(supabase, 'qris_file_id', fileId, userId);
      }
      // Simpan message_id di transaksi
      if (type === 'prem') {
        await supabase.from('premium_requests').update({ message_id: rj.result.message_id }).eq('id', transactionId);
      } else if (type === 'topup') {
        await supabase.from('topup_requests').update({ message_id: rj.result.message_id }).eq('id', transactionId);
      }
    } else {
      console.error('[QRIS MANUAL] sendPhoto failed:', JSON.stringify(rj));
      // Fallback: kirim teks saja
      await sendTelegramMessage(botToken, userId, caption, cancelKb);
    }
  } catch (e) {
    console.error('[QRIS MANUAL] Error:', e);
    await sendTelegramMessage(botToken, userId, caption, cancelKb);
  }

  // Notify CS
  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    const { data: userData } = await supabase.from('telegram_users')
      .select('username, first_name').eq('id', userId).single();
    const userName = userData?.username ? `@${userData.username}` : userData?.first_name || 'User';
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `📱 <b>QRIS MANUAL - MENUNGGU BUKTI</b>\n\n👤 User: ${userName}\n🆔 ID: <code>${userId}</code>\n📦 Produk: ${productLabel}\n💵 Total: Rp ${totalWithCode.toLocaleString('id-ID')}\n🔢 Kode Unik: ${code}\n📋 Tipe: ${type}\n🆔 TRX: <code>${transactionId}</code>\n\n⏳ Menunggu user upload bukti transfer...`
    );
  }
}

// === HANDLER: Proses bukti pembayaran QRIS Manual ===
async function handlePaymentProofUpload(
  supabase: any, botToken: string, userId: number, message: TelegramMessage
): Promise<boolean> {
  // Cari pending QRIS_MANUAL transaction terbaru milik user
  // Cek di 3 tabel: premium_requests, topup_requests, pending_transactions
  let txType: 'prem' | 'topup' | 'fine' | null = null;
  let txData: any = null;

  // 1. Cek premium_requests
  const { data: premReq } = await supabase.from('premium_requests')
    .select('id, price, unique_code, duration_days')
    .eq('user_id', userId).eq('status', 'pending').eq('payment_method', 'QRIS_MANUAL')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (premReq) {
    txType = 'prem';
    txData = premReq;
  }

  // 2. Cek topup_requests
  if (!txType) {
    const { data: topupReq } = await supabase.from('topup_requests')
      .select('id, amount, unique_code')
      .eq('user_id', userId).eq('status', 'pending').eq('payment_method', 'QRIS_MANUAL')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (topupReq) {
      txType = 'topup';
      txData = topupReq;
    }
  }

  // 3. Cek pending_transactions (fine)
  if (!txType) {
    const { data: fineReq } = await supabase.from('pending_transactions')
      .select('id, amount, unique_code, total_amount')
      .eq('user_id', userId).eq('status', 'pending').eq('admin_notes', 'FINE_PAYMENT')
      .is('sakurupiah_trx_id', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (fineReq) {
      txType = 'fine';
      txData = fineReq;
    }
  }

  if (!txType || !txData) return false;

  // Simpan file_id foto bukti
  const photo = message.photo!;
  const fileId = photo[photo.length - 1].file_id;

  if (txType === 'prem') {
    await supabase.from('premium_requests').update({ payment_proof: fileId }).eq('id', txData.id);
  } else if (txType === 'topup') {
    await supabase.from('topup_requests').update({ payment_proof: fileId }).eq('id', txData.id);
  } else if (txType === 'fine') {
    await supabase.from('pending_transactions').update({ payment_proof_url: fileId }).eq('id', txData.id);
  }

  // Kirim konfirmasi ke user
  await sendTelegramMessage(botToken, userId,
    `✅ <b>Bukti pembayaran diterima!</b>\n\nBukti transfer kamu sedang diverifikasi oleh admin.\n⏳ Mohon tunggu, proses biasanya memakan waktu 1-15 menit.\n\n📋 ID Transaksi: <code>${txData.id}</code>`
  );

  // Forward ke CS dengan tombol approve/reject
  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    const { data: userData } = await supabase.from('telegram_users')
      .select('username, first_name').eq('id', userId).single();
    const userName = userData?.username ? `@${userData.username}` : userData?.first_name || 'User';

    let productInfo = '';
    let totalAmount = 0;
    if (txType === 'prem') {
      productInfo = `Premium ${txData.duration_days} hari`;
      totalAmount = txData.price + txData.unique_code;
    } else if (txType === 'topup') {
      const COIN_PRICE = 10;
      productInfo = `Top-up ${txData.amount} Koin`;
      totalAmount = txData.amount * COIN_PRICE + txData.unique_code;
    } else if (txType === 'fine') {
      productInfo = 'Denda Buka Blokir';
      totalAmount = txData.total_amount;
    }

    const csCaption = `🧾 <b>BUKTI PEMBAYARAN QRIS MANUAL</b>\n\n` +
      `👤 User: ${userName}\n` +
      `🆔 ID: <code>${userId}</code>\n` +
      `📦 Produk: ${productInfo}\n` +
      `💵 Total: Rp ${totalAmount.toLocaleString('id-ID')}\n` +
      `🔢 Kode Unik: ${txData.unique_code}\n` +
      `📋 TRX ID: <code>${txData.id}</code>\n\n` +
      `⬇️ Verifikasi bukti di bawah:`;

    const csKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `cs_approve_${txType}_${txData.id}` },
          { text: '❌ Reject', callback_data: `cs_reject_${txType}_${txData.id}` }
        ]
      ]
    };

    // Kirim info teks dulu
    await sendTelegramMessage(botToken, parseInt(csChatId), csCaption, csKeyboard);
    // Forward foto bukti
    await copyTelegramMessage(botToken, parseInt(csChatId), userId, message.message_id);
  }

  // Reset state user ke idle/chatting
  await supabase.rpc('reset_payment_state', { p_user_id: userId });

  return true;
}

// === HANDLER: CS Approve/Reject QRIS Manual ===
async function handleCSApproveReject(
  supabase: any, botToken: string, action: 'approve' | 'reject',
  txType: 'prem' | 'topup' | 'fine', txId: string,
  csMessage: any, csChatId: number
): Promise<void> {
  const originalText = (csMessage as any)?.text || '';

  if (action === 'approve') {
    if (txType === 'prem') {
      // Ambil data premium request
      const { data: premReq } = await supabase.from('premium_requests')
        .select('user_id, duration_days, price, status').eq('id', txId).single();
      
      if (!premReq || premReq.status !== 'pending') {
        await editCSMessage(botToken, csChatId, csMessage.message_id, originalText, '⚠️ Transaksi sudah diproses sebelumnya.');
        return;
      }

      const userId = premReq.user_id;

      // Update premium request
      await supabase.from('premium_requests')
        .update({ status: 'approved', processed_at: new Date().toISOString() })
        .eq('id', txId);

      // Activate premium
      const { data: userData } = await supabase.from('telegram_users')
        .select('premium_until').eq('id', userId).single();

      let premiumEndDate: Date;
      const existing = userData?.premium_until;
      if (existing && new Date(existing) > new Date()) {
        premiumEndDate = new Date(existing);
        premiumEndDate.setDate(premiumEndDate.getDate() + premReq.duration_days);
      } else {
        premiumEndDate = new Date();
        premiumEndDate.setDate(premiumEndDate.getDate() + premReq.duration_days);
      }

      await supabase.from('telegram_users')
        .update({ premium_until: premiumEndDate.toISOString(), penalty_points: 0 })
        .eq('id', userId);

      // Unblock if blocked
      await supabase.from('blocked_users')
        .update({ is_active: false }).eq('user_id', userId);

      // Record transaction
      await supabase.from('coin_transactions').insert({
        user_id: userId, amount: -premReq.price, type: 'purchase',
        description: `Premium ${premReq.duration_days} hari via QRIS Manual`
      });

      const formattedDate = premiumEndDate.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric'
      });

      await sendTelegramMessage(botToken, userId,
        `🎉 <b>SELAMAT! PREMIUM AKTIF!</b>\n\n` +
        `✨ Kamu sekarang user Premium!\n` +
        `📅 Berlaku hingga: ${formattedDate}\n\n` +
        `🎯 Gunakan /target untuk pilih gender chat!\nTerima kasih! 💎`
      );

      await editCSMessage(botToken, csChatId, csMessage.message_id, originalText, '✅ DIAPPROVE - Premium diaktifkan');

    } else if (txType === 'topup') {
      const { data: topupReq } = await supabase.from('topup_requests')
        .select('user_id, amount, status').eq('id', txId).single();
      
      if (!topupReq || topupReq.status !== 'pending') {
        await editCSMessage(botToken, csChatId, csMessage.message_id, originalText, '⚠️ Transaksi sudah diproses sebelumnya.');
        return;
      }

      const userId = topupReq.user_id;
      const coinAmount = topupReq.amount;

      await supabase.from('topup_requests')
        .update({ status: 'approved', processed_at: new Date().toISOString() })
        .eq('id', txId);

      const { data: userData } = await supabase.from('telegram_users')
        .select('coins').eq('id', userId).single();
      const newBalance = (userData?.coins || 0) + coinAmount;

      await supabase.from('telegram_users')
        .update({ coins: newBalance }).eq('id', userId);

      await supabase.from('coin_transactions').insert({
        user_id: userId, amount: coinAmount, type: 'topup',
        description: `Top-up ${coinAmount} koin via QRIS Manual`
      });

      await sendTelegramMessage(botToken, userId,
        `✅ <b>TOP-UP BERHASIL!</b>\n\n💰 +${coinAmount.toLocaleString('id-ID')} koin\n💳 Saldo baru: ${newBalance.toLocaleString('id-ID')} koin\n\nTerima kasih! 🎉`
      );

      await editCSMessage(botToken, csChatId, csMessage.message_id, originalText, `✅ DIAPPROVE - +${coinAmount} koin`);

    } else if (txType === 'fine') {
      const { data: fineReq } = await supabase.from('pending_transactions')
        .select('user_id, amount, status').eq('id', txId).single();
      
      if (!fineReq || fineReq.status !== 'pending') {
        await editCSMessage(botToken, csChatId, csMessage.message_id, originalText, '⚠️ Transaksi sudah diproses sebelumnya.');
        return;
      }

      const userId = fineReq.user_id;

      await supabase.from('pending_transactions')
        .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: csChatId })
        .eq('id', txId);

      // Unblock user
      await supabase.from('blocked_users')
        .update({ is_active: false, unblocked_at: new Date().toISOString() })
        .eq('user_id', userId);

      // Reset penalty
      await supabase.from('telegram_users')
        .update({ penalty_points: 0 }).eq('id', userId);

      await supabase.from('coin_transactions').insert({
        user_id: userId, amount: -fineReq.amount, type: 'fine_payment',
        description: 'Denda buka blokir via QRIS Manual'
      });

      const welcomeKeyboard = {
        inline_keyboard: [[{ text: '🔍 Cari Partner', callback_data: 'search_partner' }]]
      };

      await sendTelegramMessage(botToken, userId,
        `✅ <b>AKUN TELAH DIBUKA BLOKIR!</b>\n\n🎉 Pembayaran denda berhasil diverifikasi!\n\nSilakan mulai chat:`,
        welcomeKeyboard
      );

      await editCSMessage(botToken, csChatId, csMessage.message_id, originalText, '✅ DIAPPROVE - Akun dibuka blokir');
    }
  } else {
    // REJECT
    let userId: number | null = null;

    if (txType === 'prem') {
      const { data } = await supabase.from('premium_requests')
        .select('user_id').eq('id', txId).single();
      userId = data?.user_id;
      await supabase.from('premium_requests').update({ status: 'rejected' }).eq('id', txId);
    } else if (txType === 'topup') {
      const { data } = await supabase.from('topup_requests')
        .select('user_id').eq('id', txId).single();
      userId = data?.user_id;
      await supabase.from('topup_requests').update({ status: 'rejected' }).eq('id', txId);
    } else if (txType === 'fine') {
      const { data } = await supabase.from('pending_transactions')
        .select('user_id').eq('id', txId).single();
      userId = data?.user_id;
      await supabase.from('pending_transactions').update({ status: 'rejected' }).eq('id', txId);
    }

    if (userId) {
      await sendTelegramMessage(botToken, userId,
        `❌ <b>Pembayaran Ditolak</b>\n\nBukti pembayaran kamu tidak valid atau tidak sesuai.\n\nSilakan coba lagi dengan bukti yang benar.`
      );
    }

    await editCSMessage(botToken, csChatId, csMessage.message_id, originalText, '❌ DITOLAK');
  }
}

// Helper: Edit pesan CS setelah approve/reject
async function editCSMessage(botToken: string, chatId: number, messageId: number, originalText: string, statusText: string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: originalText + `\n\n<b>${statusText}</b>\n⏰ ${formatDateTimeWIB(new Date())}`,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('[CS EDIT] Error:', e);
  }
}


// NOTE: Helper functions isUserBlocked, simpleUpsertUser, smartUpsertUser, shouldShowChannelJoin
// telah DIHAPUS - logika sudah terintegrasi dalam comprehensive_search_action RPC
// NOTE: QRISPaymentParams & sendQRISPayment DIHAPUS - diganti Sakurupiah payment gateway

// --- TARUH DI BAGIAN ATAS (setelah import) ---

// Helper untuk deteksi tipe media
function getMediaType(msg: TelegramMessage): string {
  if (msg.sticker) return 'Sticker 🎭';
  if (msg.photo) return 'Foto 📷';
  if (msg.video) return 'Video 📹';
  if (msg.animation) return 'GIF 🎞️';
  if (msg.video_note) return 'Video Note ⭕';
  return 'Media 📁';
}

// Fungsi untuk mengirim media ke Spreadsheet secara background
// async function sendMediaToSheet(botToken: string, message: any, supabase: any) {
//   try {
//     // A. Identifikasi Jenis Media
//     let fileId = '';
//     let fileName = '';
//     let type = '';

//     // Pastikan hanya masuk sini jika FOTO ADA
//     if (message.photo && message.photo.length > 0) { 
//       const photo = message.photo[message.photo.length - 1];
//       fileId = photo.file_id;
//       fileName = `photo_${message.from.id}_${Date.now()}.jpg`;
//       type = 'Photo';
//     } 
//     // Jika bukan foto, baru cek apakah VIDEO
//     else if (message.video) {
//       fileId = message.video.file_id;
//       fileName = `video_${message.from.id}_${Date.now()}.mp4`;
//       type = 'Video';
//     } 
//     else {
//       return; // Abaikan jika bukan foto/video
//     }

//     // B. Ambil Data Tambahan User (Gender & Lokasi)
//     // Kita fetch ulang sebentar untuk memastikan data terbaru tanpa membebani query utama
//     const { data: userData } = await supabase
//       .from('telegram_users')
//       .select('gender, location')
//       .eq('id', message.from.id)
//       .maybeSingle();

//     const gender = userData?.gender || 'Unknown';
//     const location = userData?.location || 'Unknown';
//     const username = message.from.username ? `@${message.from.username}` : (message.from.first_name || 'No Name');

//     // C. Dapatkan Direct URL File dari Telegram API
//     const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
//     const fileJson = await fileRes.json();
    
//     if (!fileJson.ok || !fileJson.result.file_path) return;

//     const directFileUrl = `https://api.telegram.org/file/bot${botToken}/${fileJson.result.file_path}`;

//     // D. Kirim Metadata & URL ke Google Sheet (Fire-and-Forget)
//     // Kita tidak menggunakan 'await' agar bot tidak loading lama (non-blocking)
//     fetch(GOOGLE_SCRIPT_URL, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         fileUrl: directFileUrl,
//         fileName: fileName,
//         username: username,
//         gender: gender,
//         location: location,
//         type: type,
//         caption: message.caption || ''
//       })
//     }).catch(err => console.error('[SHEET LOG] Error:', err));

//   } catch (error) {
//     console.error('[SHEET LOG] System Error:', error);
//   }
// }

// sendQRISPayment DIHAPUS - diganti dengan createSakurupiahInvoice + payment method selection

const PROMO_FILEID_LIST = [
  'AgACAgUAAxkBAfftM2mlRW9AdaD4TzsFbiD8xI_tVRSTAALKDmsbA1AxVZiCukYhy3zkAQADAgADeQADOgQ', // Promo 1
  'AgACAgUAAxkBAfftNGmlRW-WIkrgNkyDf3Yt6emZ485bAALLDmsbA1AxVT6KgMQWEETCAQADAgADeQADOgQ', // Promo 2
  'AgACAgUAAxkBAfftNmmlRW_ayeTLu37HmwABtrHZGXYv0AACzA5rGwNQMVU39IwK63PH5gEAAwIAA3kAAzoE',  // Promo 3
  'AgACAgUAAxkBAfftN2mlRW8kk5MjqFgBQXUG_5cLeop7AALNDmsbA1AxVeXP_ED8KsVhAQADAgADeQADOgQ', // Promo 4
  'AgACAgUAAxkBAfftOGmlRW9fgEHCTscyBkatDpkxREXiAALODmsbA1AxVT2JpjvgquaNAQADAgADeQADOgQ', // Promo 5
  'AgACAgUAAxkBAfftOWmlRW_XpXEKS-CttIUNkdcn6M-1AALPDmsbA1AxVcriYMnbYC7IAQADAgADeQADOgQ', // Promo 6
  'AgACAgUAAxkBAfftOmmlRW8HRNzCBEVcMmhW7L0PO2PYAALQDmsbA1AxVdBMM9LfissMAQADAgADeQADOgQ', // Promo 7
  'AgACAgUAAxkBAfftO2mlRW8LTQNAjlEq_S5vE1UThlQNAALRDmsbA1AxVYYYBlxdAlv5AQADAgADeQADOgQ', // Promo 8
];



// ==========================================
// DATA PESAN & HELPER (IN-MEMORY / ZERO COST)
// ==========================================

// 1. Teks untuk COWOK (100 Pesan - Sopan, elegan, tapi menyindir tajam)
const MALE_WARNINGS = [
  "Bicaralah, asal isinya lebih berbobot dari angin. 💨",
  "Ini ruang obrolan, bukan ruang interogasi. 🕵️‍♂️",
  "Gunakan otakmu sebelum jari jemarimu. 🧠",
  "Tolong bedakan antara percaya diri dan kesombongan. 🦚",
  "Punya sopan santun itu gratis, pakailah. 🎩",
  "Kalau cuma mau basa-basi garing, mending tidur. 🛌",
  "Tunjukkan pesonamu, itu pun kalau memang ada. ✨",
  "Jangan pamer barang yang cicilannya belum lunas. 💳",
  "Lebih baik diam daripada mengetik omong kosong. 🤐",
  "Kalau tak sanggup berkelas, setidaknya jadilah sopan. 👔",
  "Ini bot obrolan, bukan biro jodoh instan. 💒",
  "Kesan pertama itu penting, jangan sengaja dirusak. 🖼️",
  "Bicaralah dengan kehormatan, bukan nafsu. 👑",
  "Hargai waktunya, atau siap-siap ditinggalkan. ⌚",
  "Menjadi pria sejati tidak sesulit hitungan kalkulus. 🧮",
  "Jadilah misteri yang elegan, bukan pengangguran yang sok sibuk. 🕴️",
  "Kalau balasnya tahun depan, mending kirim merpati saja. 🕊️",
  "Pamer harta tak akan menutupi miskinnya etikamu. 💸",
  "Cerdaslah sedikit, wanita suka obrolan berbobot. 📚",
  "Jadilah gentleman, bukan pengemis perhatian. 🤝",
  "Sedikit bicara, perbanyak makna. 🎯",
  "Logikamu jalan kan? Gunakan saat ngobrol. ⚙️",
  "Memuji itu boleh, merayu murahan itu memalukan. 📉",
  "Hargai privasinya seakan menghargai nyawamu. 🛡️",
  "Kalau dia menolak, mundurlah dengan sisa harga dirimu. 🚶‍♂️",
  "Wibawa itu dibentuk, bukan hasil download. 📉",
  "Jadilah pria yang menenangkan, bukan memusingkan. ☕",
  "Kesopananmu mencerminkan kualitas keluargamu. 🏡",
  "Coba ketik pesan yang isinya bukan cuma huruf 'P'. 📱",
  "Jangan sok galak kalau kuota saja masih minta. 📶",
  "Pria berkelas tak akan meminta hal rendahan. 🍷",
  "Mengetik rapi adalah bentuk penghormatan paling dasar. 📝",
  "Kalau obrolan garing, coba cek lagi isi kepalamu. 🌵",
  "Jangan memuji berlebihan, kesannya seperti ada maunya. 🎣",
  "Hormati dia, atau tombol 'Next' akan menghakimi. ⏭️",
  "Tunjukkan intelektualitasmu, jangan cuma modal foto pinjaman. 🎓",
  "Pesona sejati lahir dari kata-kata yang bermartabat. 🌟",
  "Kalau otakmu sedang libur, jangan paksakan untuk ngobrol. 🏖️",
  "Pria sejati tahu kapan harus diam dan menyimak. 👂",
  "Jangan agresif, kamu bukan sales asuransi akhir bulan. 📈",
  "Kualitasmu terbaca dari tanda bacamu. 🔤",
  "Tinggalkan sifat kekanak-kanakanmu di luar obrolan ini. 🍼",
  "Buka percakapan dengan elegan, bukan pertanyaan basi. 🚪",
  "Kalau tidak nyambung, pamitlah layaknya pria terhormat. 🤝",
  "Jangan menyalahkan keadaan kalau ketikanmu memang membosankan. 🥱",
  "Jadilah pendengar, wanita bukan butuh dosen. 👨‍🏫",
  "Kata-katamu adalah cermin dari jiwamu. 🪞",
  "Waktu akan menyaring mana pria sejati dan mana pecundang. ⏳",
  "Ego yang besar tak akan menutupi nyali yang kecil. 🤏",
  "Menjadi asyik bukan berarti harus kehilangan batasan norma. 📏",
  "Hormati penolakannya, itu tanda kedewasaanmu. 🏆",
  "Pria elegan tak pernah mengemis cinta di chat anonim. 🎭",
  "Coba lebih kreatif dari sekadar tanya 'lagi apa'. 🔍",
  "Gunakan bahasa manusia, bukan singkatan tak bermakna. 🦍",
  "Kalau niatnya main-main, mending main game saja. 🎮",
  "Pria mapan secara emosi jauh lebih menarik. 🧘‍♂️",
  "Jangan bersikap posesif padahal baru saling menyapa. ⛓️",
  "Menghargai wanita adalah standar minimal pria waras. 🧠",
  "Kesabaran adalah perhiasan pria berkelas. 💎",
  "Jangan mudah marah kalau balasan dia lambat. 🐢",
  "Kalau mencari kenyamanan, ciptakan dulu suasana yang aman. 🏕️",
  "Humor itu penting, tapi cringe itu penyakit. 🦠",
  "Berdebat dengan wanita tak akan membuatmu menang. ⚖️",
  "Bangun rasa nyaman, bukan malah memberikan tekanan. 🎢",
  "Temukan frekuensi yang sama, jangan paksakan logikamu. 📻",
  "Keheningan kadang lebih bermakna dari paksaan chat. 🤫",
  "Tunjukkan, jangan sekadar banyak bicara. 🎬",
  "Jadilah misteri yang memang layak untuk dipecahkan. 🧩",
  "Jangan menceritakan masa lalu jika tak ditanya. 🔙",
  "Kalau kamu memang baik, tak perlu repot membuktikannya. 😇",
  "Mengobrollah dengan tulus, kepalsuan mudah tercium. 🤥",
  "Jaga jarimu, etika adalah segalanya. ⌨️",
  "Buktikan kamu layak untuk menghabiskan waktunya. ⏳",
  "Jangan terlalu puitis kalau ujungnya cuma minta pap. 📸",
  "Jangan jadi pria yang membosankan di menit pertama. 💤",
  "Berikan dia kenyamanan lewat kata yang sopan. 🛋️",
  "Membaca suasana hati itu keahlian pria tangguh. 🧭",
  "Jadikan obrolan ini investasi yang bermakna. 📈",
  "Jangan sok akrab kalau kenal saja belum ada 5 menit. 🤝",
  "Kalau kamu cerdas, dia pasti akan tinggal. 🧠",
  "Menjadi santun tidak akan menurunkan derajatmu. 📉",
  "Jangan membandingkannya dengan siapapun. 📊",
  "Hargai perbedaan selera, tak perlu jadi kritikus. 🎤",
  "Pria berkelas tahu cara mengakhiri percakapan dengan baik. 🚪",
  "Jangan menjadi beban emosi bagi orang yang baru kenal. 🏋️‍♂️",
  "Kesopanan adalah mata uang yang berlaku di mana saja. 💵",
  "Obrolan berkualitas tak butuh effort yang dipaksakan. ✨",
  "Punya empati sedikit, jangan mendikte hidupnya. 📝",
  "Jadilah teman ngobrol yang bikin dia lupa waktu. 🕰️",
  "Pria sejati menghargai ruang privat pasangannya. 🔒",
  "Jangan jadikan chat sebagai pelampiasan amarah. 🌋",
  "Bersikaplah dewasa, dunia tidak berputar di sekelilingmu. 🌍",
  "Kalau jokes-mu garing, segeralah meminta maaf. 🥶",
  "Ciptakan koneksi, bukan malah membangun tembok. 🧱",
  "Pria terhormat tak pernah merendahkan wanita. 📉",
  "Biarkan dia menilai wibawamu dari bahasamu. 🗣️",
  "Jangan sok penting kalau sibukmu cuma rebahan. 🛌",
  "Kalau dia tidak tertarik, belajarlah menerima kenyataan. 🍂",
  "Mengobrollah layaknya bangsawan, bukan preman jalanan. 🤴",
  "Kualitas seorang pria terlihat saat dia menghargai wanita. 🏆"
];

// 2. Teks untuk CEWEK (100 Pesan - Sopan, elegan, tapi menyindir tajam)
const FEMALE_WARNINGS = [
  "Turunkan ekspektasimu, ini bukan negeri dongeng. 🏰",
  "Kalau cari pembantu, kamu salah aplikasi. 🧹",
  "Jangan buang waktu untuk obrolan murahan. 🗑️",
  "Keanggunan adalah filter terbaik untuk menyingkirkan pria receh. 💅",
  "Balaslah dengan cerdas, atau abaikan dengan elegan. 👑",
  "Jaga prinsipmu, jangan luluh hanya karena rayuan obral. 🏷️",
  "Biarkan dia menebak, misteri selalu lebih memikat. 🎭",
  "Tidak semua pesan receh layak mendapat ketikan balasanmu. 📵",
  "Bunga tidak akan pernah mengejar lebah. 🌸",
  "Emas tetaplah berharga walau dibalut lumpur. ✨",
  "Biarkan waktu yang mengungkap kualitas aslinya. ⏳",
  "Kecerdasanmu memancarkan pesona yang tak bisa dipalsukan. 🧠",
  "Bicara dengan martabat, jangan mengemis perhatian. 💎",
  "Kalau dia lambat, anggap saja dia tidak prioritas. 🐢",
  "Kemandirianmu adalah tameng dari rayuan palsu. 🛡️",
  "Jadilah teka-teki yang terlalu rumit untuk pria biasa. 🧩",
  "Cinta yang baik tak lahir dari paksaan chat anonim. 🎭",
  "Buka pikiranmu, tapi biarkan hatimu tetap terkunci rapat. 🔒",
  "Kecocokan itu langka, jangan paksakan yang sudah berbeda. 🧩",
  "Percayalah pada instingmu, kalau aneh langsung tinggalkan. 🔮",
  "Keamananmu lebih penting daripada menjaga perasaan orang asing. 🚨",
  "Jual mahal itu wajib, kamu bukan barang diskonan. 🏷️",
  "Pria 'red flag' tak pantas menghiasi layar ponselmu. 🚩",
  "Kalau obrolannya garing, tombol 'Next' selalu tersedia. ⏭️",
  "Kamu itu mahakarya, jangan mau dihargai dengan tarif rendah. 🖼️",
  "Jangan buang kesabaran untuk mengasuh pria tantrum. 🍼",
  "Kalau dia sok mengatur, ingatlah dia bukan donatur hidupmu. 💸",
  "Menyendiri jauh lebih elegan daripada bersama pria beban. 🥂",
  "Standar tinggi itu mutlak, bukan soal pilihan ganda. 📈",
  "Jangan memaklumi keburukannya hanya karena kamu kesepian. 🌧️",
  "Pria bermodal janji biasanya miskin pembuktian. 📉",
  "Kalau dia mengajak ke tempat sepi, logikamu harus bunyi. 🔔",
  "Jangan terlalu 'open book', privasimu mahal harganya. 📖",
  "Pria sejati tak butuh validasi berlebihan dari layar kaca. 🪞",
  "Obrolan soal fisik di awal perkenalan adalah tanda kelemahan otak. 🧠",
  "Kalau dia hobi mengkritik, pastikan dia punya cermin di rumah. 👁️",
  "Jangan mau digantungin, jemuran saja bisa bau apek. 👕",
  "Investasikan emosimu pada yang jelas, bukan pada bayangan. 📈",
  "Hidupmu terlalu berharga untuk menjadi tempat rehabilitasi pria toxic. 🏥",
  "Kamu perempuan cerdas, berhentilah mencari pembenaran untuk kesalahannya. 🛑",
  "Kalau dia merendahkan mimpimu, buang dia ke tempat sampah. 🗑️",
  "Jangan membandingkan fiksi dengan realita yang menyedihkan ini. 📚",
  "Jadilah pengemudi dalam hidupmu, jangan disetir pria anonim. 🚗",
  "Berikan ruang, kamu bukan customer service 24 jam. 🎧",
  "Kalau mood-nya berantakan, jangan mau jadi samsak emosinya. 🥊",
  "Jadilah wanita yang tahu apa yang dia mau. 🎯",
  "Pesona aslimu tak butuh filter, hanya butuh otak yang bersinar. ✨",
  "Jangan buang waktumu untuk mengorek masa lalunya yang suram. 🔙",
  "Cerdaslah berinvestasi waktu, pilih obrolan yang menghasilkan tawa. 😂",
  "Menjadi anggun bukan berarti tidak bisa bersikap tegas. 👠",
  "Kalau obrolannya mulai cringe, jangan korbankan matamu untuk membacanya. 🙈",
  "Jangan selalu menjadi pihak yang memulai, hargai effort-mu. 🛑",
  "Kalau dia selalu menghilang, lupakan saja keberadaannya. 👻",
  "Tunjukkan selera humormu yang berkelas. 🥂",
  "Jangan mudah kagum dengan gaya bicara tinggi tanpa bukti. 🗣️",
  "Tidak perlu pura-pura bodoh untuk disukai pria lemah. 🧠",
  "Jadilah wanita hangat namun punya batasan baja. 🛡️",
  "Kalau dia suka gaslighting, sadarlah kamu sedang diracuni. ☣️",
  "Menjadi savage itu sopan tapi menohok tepat di jantung. 🗡️",
  "Jangan memaksakan diri tertawa untuk jokes yang garing. 🥶",
  "Hindari pria yang meminta akses privat di hari pertama. 📵",
  "Kalau dia pelit effort, jangan buang energimu. 🔋",
  "Kamu ini piala emas, bukan medali partisipasi kelurahan. 🏆",
  "Cerdaslah membedakan mana keseriusan dan mana modus operandi. 🕵️‍♀️",
  "Kamu tidak butuh pujian palsu untuk merasa cantik. 💄",
  "Keajaibanmu terlalu berharga untuk pria berjiwa parasit. 🦠",
  "Perempuan berprinsip selalu terlihat lebih seksi di mata pria cerdas. 💋",
  "Tolak dengan sopan, abaikan dengan mutlak. 🛑",
  "Jangan biarkan layar ponsel mengatur kebahagiaan nyatamu. 📱",
  "Kalau dia suka membahas mantan, berikan dia kontak terapis. 🛋️",
  "Obrolan murahan hanya untuk mereka yang tidak punya nilai. 📉",
  "Banggalah pada kemandirianmu, itu menakutkan bagi pria pengecut. 🦅",
  "Jangan gampang memaafkan kebohongan kecil di awal perkenalan. 🤥",
  "Hidup sudah rumit, jangan ditambah drama pria tak jelas. 🎭",
  "Pria yang merendahkan perempuan fiks punya inferiority complex. 🤏",
  "Berani berkata 'TIDAK' adalah tanda kemerdekaan mentalmu. 🗽",
  "Tunjukkan bahwa kecerdasanmu lebih menarik daripada riasanmu. 💄",
  "Kamu wanita berkelas, bertindaklah layaknya ratu. 👑",
  "Jangan pusingkan balasan lambat, anggap saja dia sedang sibuk. ⌚",
  "Memblokir orang toxic adalah rutinitas self-care yang baik. 🛀",
  "Hargai dirimu sendiri sebelum berharap pria asing menghargaimu. 🤝",
  "Jangan korbankan kedamaian mentalmu demi memuaskan egonya. 🧘‍♀️",
  "Tetaplah rasional walau obrolannya mulai terdengar manis. 🍭",
  "Pria berkelas akan segan jika kamu menunjukkan integritas. 🛡️",
  "Jangan menjadi pihak ketiga, karma itu sangat tepat waktu. ⏰",
  "Mengetik dengan rapi adalah bentuk keanggunan digital-mu. ⌨️",
  "Kalau dia suka mendominasi, tinggalkan dia mengobrol sendiri. 🚶‍♀️",
  "Kamu tidak sedang mengemis teman, bersikaplah selektif. 🧐",
  "Pria yang memintamu berubah sejak awal adalah bendera merah berjalan. 🚩",
  "Pertahankan kedamaian batinmu, biarkan pria toxic berteriak di luar sana. 🕊️",
  "Kalau dia tidak menghargai waktumu, tinggalkan saja tanpa pamit. 🚪",
  "Kamu bukan rahasia negara yang harus disembunyikan dalam obrolan gelap. 🕵️‍♀️",
  "Tunjukkan kecerdasan emosionalmu dalam membalas sapaan. 🧠",
  "Biarkan dia menilai dirimu dari opini cerdas yang kamu berikan. 💡",
  "Jangan jadikan mencari pasangan sebagai perlombaan hidup mati. 🏁",
  "Pria mapan emosi tidak akan pernah membuatmu overthinking. 🧘‍♂️",
  "Wanita tegas selalu tahu kapan obrolan harus segera diakhiri. 🛑",
  "Kalau dia tidak merespons, alam semesta sedang menyelamatkanmu. 🌌",
  "Kecantikan sejati terlihat dari cara pandangmu yang elegan. 👁️",
  "Kamu adalah mahkota yang tak sembarang kepala pantas memakainya. 👑"
];
// Helper: Ambil pesan acak berdasarkan gender (Safe & Fast)
function getMessageByGender(gender: string | null) {
  const g = gender ? gender.toLowerCase().trim() : 'cowok'; // Default ke cowok
  if (['cewek', 'female', 'perempuan', 'woman'].includes(g)) {
    return FEMALE_WARNINGS[Math.floor(Math.random() * FEMALE_WARNINGS.length)];
  } else {
    return MALE_WARNINGS[Math.floor(Math.random() * MALE_WARNINGS.length)];
  }
}

// === SAKURUPIAH TOPUP PAYMENT HELPER ===
async function processSakurupiahTopupPayment(
  supabase: any, botToken: string, userId: number,
  amount: number, method: 'QRIS' | 'DANA' | 'GOPAY' | 'SHOPEEPAY' | 'OVO', // <--- Update di sini
  queryId: string, message: any
): Promise<void> {
  const COIN_PRICE = 10; // 1 koin = Rp 10
  const totalPrice = amount * COIN_PRICE;

  if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);

  // Cancel old pending topups without sakurupiah_trx_id
  await supabase.from('topup_requests')
    .update({ status: 'cancelled' })
    .eq('user_id', userId).eq('status', 'pending')
    .is('sakurupiah_trx_id', null);

  // Cancel ALL old pending topup transactions
  await supabase.from('topup_requests')
    .update({ status: 'cancelled' })
    .eq('user_id', userId).eq('status', 'pending')
    .not('sakurupiah_trx_id', 'is', null);

  await answerCallbackQuery(botToken, queryId, '✅ Memproses pembayaran...');

  const { data: topupReq, error: insertErr } = await supabase.from('topup_requests')
    .insert({
      user_id: userId, amount, unique_code: 0,
      status: 'pending', payment_method: method,
    }).select('id').single();

  if (insertErr || !topupReq) {
    console.error('[TOPUP] Insert error:', JSON.stringify(insertErr));
    await sendTelegramMessage(botToken, userId, '❌ Gagal membuat transaksi. Coba lagi.');
    return;
  }

  const merchantRef = `t_${topupReq.id}`;
  const { data: userData } = await supabase.from('telegram_users')
    .select('username, first_name').eq('id', userId).single();
  const userName = userData?.username ? `@${userData.username}` : userData?.first_name || 'FizaTalk User';

  const invoice = await createSakurupiahInvoice({
    method, amount: totalPrice, merchantRef,
    productName: `Top-up ${amount} Koin`, customerName: userName, expired: 60,
  });

  if (!invoice.success) {
    // Fallback ke QRIS Manual
    console.log(`[TOPUP] Sakurupiah failed, fallback to QRIS Manual: ${invoice.error}`);
    await sendManualQRISPayment(supabase, botToken, userId, 'topup', topupReq.id, totalPrice, `Top-up ${amount.toLocaleString('id-ID')} Koin`, `init_topup_${amount}`);
    return;
  }

  await supabase.from('topup_requests')
    .update({ sakurupiah_trx_id: invoice.trxId }).eq('id', topupReq.id);

  const cancelKb = { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: `init_topup_${amount}` }]] };

  if (method === 'QRIS' && invoice.qrString) {
      const qrUrl = invoice.qrString;
      const caption = `💰  <b>TOP-UP ${amount.toLocaleString('id-ID')} KOIN</b>\n\n` +
      `💳  Total: <b>Rp ${totalPrice.toLocaleString('id-ID')}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📱  <b>CARA BAYAR:</b>\n\n` +
      `1️⃣  Screenshot QR di atas\n` +
      `2️⃣  Buka E-Wallet/M-Banking favorit kamu\n` +
      `3️⃣  Pilih Scan QR / Bayar dari Galeri\n` +
      `4️⃣  Konfirmasi pembayaran\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `✅  Pembayaran <b>otomatis terverifikasi</b>\n` +
      `⏰  Batas waktu: <b>60 menit</b>`;
    try {
      const resp = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: userId, photo: qrUrl, caption, parse_mode: 'HTML', reply_markup: cancelKb })
      });
      const rj = await resp.json();
      if (rj.ok) {
        await supabase.from('topup_requests').update({ message_id: rj.result.message_id }).eq('id', topupReq.id);
      } else {
        console.error('[TOPUP QRIS] sendPhoto failed:', JSON.stringify(rj));
        await sendTelegramMessage(botToken, userId,
          `${caption}\n\n🔗 <a href="${invoice.checkoutUrl}">Klik di sini untuk bayar</a>`, cancelKb);
      }
    } catch (e) {
      console.error('[TOPUP QRIS] Error:', e);
      await sendTelegramMessage(botToken, userId,
        `${caption}\n\n🔗 <a href="${invoice.checkoutUrl}">Klik di sini untuk bayar</a>`, cancelKb);
    }
  } else {
    // --- LOGIKA E-WALLET BARU ---
    console.log(`[TOPUP ${method}] paymentNo:`, invoice.paymentNo, 'checkoutUrl:', invoice.checkoutUrl);
    
    const eWalletConfig: Record<string, { name: string, emoji: string }> = {
      'DANA': { name: 'DANA', emoji: '💙' }, 'GOPAY': { name: 'GoPay', emoji: '🟢' },
      'SHOPEEPAY': { name: 'ShopeePay', emoji: '🟠' }, 'OVO': { name: 'OVO', emoji: '💜' }
    };
    const walletInfo = eWalletConfig[method] || { name: method, emoji: '💳' };
    
    const payUrl = invoice.paymentNo || invoice.checkoutUrl!;
    
    const walletButtons: any[][] = [
      [{ text: `${walletInfo.emoji} Bayar via ${walletInfo.name}`, url: payUrl }]
    ];
    

    walletButtons.push([{ text: '🔙 Kembali', callback_data: `init_topup_${amount}` }]);
    const walletKb = { inline_keyboard: walletButtons };

    await sendTelegramMessage(botToken, userId,
      `💰  <b>TOP-UP ${amount.toLocaleString('id-ID')} KOIN</b>\n\n` +
      `💳  Total: <b>Rp ${totalPrice.toLocaleString('id-ID')}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📱  Klik tombol di bawah untuk membayar langsung via aplikasi <b>${walletInfo.name}</b>\n\n` +
      `✅  Pembayaran <b>otomatis terverifikasi</b>\n` +
      `⏰  Batas waktu: <b>60 menit</b>`,
      walletKb);
  }
  // Notify admin (Pembayaran Top Up)
  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `💰 <b>PEMBAYARAN TOP-UP DIMULAI</b>\n\n👤 User: ${userName}\n🆔 ID: <code>${userId}</code>\n🪙 Nominal: ${amount.toLocaleString('id-ID')} Koin\n💵 Total: Rp ${totalPrice.toLocaleString('id-ID')}\n📱 Via: ${method}\n\n⏳ Menunggu pembayaran (auto-verify)...`
    );
  }
}

// === SAKURUPIAH FINE PAYMENT HELPER ===
async function processSakurupiahFinePayment(
  supabase: any, botToken: string, userId: number,
  method: 'QRIS' | 'DANA' | 'GOPAY' | 'SHOPEEPAY' | 'OVO', // <--- Update di sini
  queryId: string, message: any
): Promise<void> {
  const FINE_AMOUNT = 10000;

  if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);

  // Cancel old pending fine without sakurupiah_trx_id
  await supabase.from('pending_transactions')
    .update({ status: 'cancelled' })
    .eq('user_id', userId).eq('status', 'pending').eq('admin_notes', 'FINE_PAYMENT')
    .is('sakurupiah_trx_id', null);

  // Cancel ALL old pending fine transactions
  await supabase.from('pending_transactions')
    .update({ status: 'cancelled' })
    .eq('user_id', userId).eq('status', 'pending').eq('admin_notes', 'FINE_PAYMENT')
    .not('sakurupiah_trx_id', 'is', null);

  await answerCallbackQuery(botToken, queryId, '✅ Memproses pembayaran...');

  const { data: fineReq, error: insertErr } = await supabase.from('pending_transactions')
    .insert({
      user_id: userId, amount: FINE_AMOUNT, unique_code: 0,
      total_amount: FINE_AMOUNT, status: 'pending',
      admin_notes: 'FINE_PAYMENT',
    }).select('id').single();

  if (insertErr || !fineReq) {
    console.error('[FINE] Insert error:', JSON.stringify(insertErr));
    await sendTelegramMessage(botToken, userId, '❌ Gagal membuat transaksi. Coba lagi.');
    return;
  }

  const merchantRef = `f_${fineReq.id}`;
  const { data: userData } = await supabase.from('telegram_users')
    .select('username, first_name').eq('id', userId).single();
  const userName = userData?.username ? `@${userData.username}` : userData?.first_name || 'FizaTalk User';

  const invoice = await createSakurupiahInvoice({
    method, amount: FINE_AMOUNT, merchantRef,
    productName: 'Pembayaran Denda Buka Blokir', customerName: userName, expired: 60,
  });

  if (!invoice.success) {
    // Fallback ke QRIS Manual
    console.log(`[FINE] Sakurupiah failed, fallback to QRIS Manual: ${invoice.error}`);
    await sendManualQRISPayment(supabase, botToken, userId, 'fine', fineReq.id, FINE_AMOUNT, 'Denda Buka Blokir', 'pay_fine');
    return;
  }

  await supabase.from('pending_transactions')
    .update({ sakurupiah_trx_id: invoice.trxId }).eq('id', fineReq.id);

  const cancelKb = { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'pay_fine' }]] };

  if (method === 'QRIS' && invoice.qrString) {
      const qrUrl = invoice.qrString;
      const caption = `💸  <b>PEMBAYARAN DENDA - BUKA BLOKIR</b>\n\n` +
      `💰  Total: <b>Rp ${FINE_AMOUNT.toLocaleString('id-ID')}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📱  <b>CARA BAYAR:</b>\n\n` +
      `1️⃣  Screenshot QR di atas\n` +
      `2️⃣  Buka E-Wallet/M-Banking favorit kamu\n` +
      `3️⃣  Pilih Scan QR / Bayar dari Galeri\n` +
      `4️⃣  Konfirmasi pembayaran\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `✅  Pembayaran <b>otomatis terverifikasi</b>\n` +
      `⏰  Batas waktu: <b>60 menit</b>`;
    try {
      const resp = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: userId, photo: qrUrl, caption, parse_mode: 'HTML', reply_markup: cancelKb })
      });
      const rj = await resp.json();
      if (!rj.ok) {
        console.error('[FINE QRIS] sendPhoto failed:', JSON.stringify(rj));
        await sendTelegramMessage(botToken, userId,
          `${caption}\n\n🔗 <a href="${invoice.checkoutUrl}">Klik di sini untuk bayar</a>`, cancelKb);
      }
    } catch (e) {
      console.error('[FINE QRIS] Error:', e);
      await sendTelegramMessage(botToken, userId,
        `${caption}\n\n🔗 <a href="${invoice.checkoutUrl}">Klik di sini untuk bayar</a>`, cancelKb);
    }
  } else {
    // --- LOGIKA E-WALLET BARU ---
    console.log(`[FINE ${method}] paymentNo:`, invoice.paymentNo, 'checkoutUrl:', invoice.checkoutUrl);
    
    const eWalletConfig: Record<string, { name: string, emoji: string }> = {
      'DANA': { name: 'DANA', emoji: '💙' }, 'GOPAY': { name: 'GoPay', emoji: '🟢' },
      'SHOPEEPAY': { name: 'ShopeePay', emoji: '🟠' }, 'OVO': { name: 'OVO', emoji: '💜' }
    };
    const walletInfo = eWalletConfig[method] || { name: method, emoji: '💳' };
    
    const payUrl = invoice.paymentNo || invoice.checkoutUrl!;
    
    const walletButtons: any[][] = [
      [{ text: `${walletInfo.emoji} Bayar via ${walletInfo.name}`, url: payUrl }]
    ];
    
    walletButtons.push([{ text: '🔙 Kembali', callback_data: 'pay_fine' }]);
    const walletKb = { inline_keyboard: walletButtons };

    await sendTelegramMessage(botToken, userId,
      `💸  <b>PEMBAYARAN DENDA - BUKA BLOKIR</b>\n\n` +
      `💰  Total: <b>Rp ${FINE_AMOUNT.toLocaleString('id-ID')}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📱  Klik tombol di bawah untuk membayar langsung via aplikasi <b>${walletInfo.name}</b>\n\n` +
      `✅  Pembayaran <b>otomatis terverifikasi</b>\n` +
      `⏰  Batas waktu: <b>60 menit</b>`,
      walletKb);
  }

  // Notify admin
  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  if (csChatId) {
    await sendTelegramMessage(botToken, parseInt(csChatId),
      `💰 <b>PEMBAYARAN DENDA DIMULAI</b>\n\n👤 User: ${userName}\n🆔 ID: <code>${userId}</code>\n💵 Total: Rp ${FINE_AMOUNT.toLocaleString('id-ID')}\n📱 Via: ${method}\n\n⏳ Menunggu pembayaran (auto-verify)...`
    );
  }
}



// 1. DAFTAR GIFT (18 Item, 6 Baris x 3 Kolom)
const GIFT_LIST: Gift[] = [
  // Baris 1: Receh
  { id: 'gift_rose', name: 'Bunga Mawar', emoji: '🌹', price: 1 },
  { id: 'gift_finger', name: 'Saranghaeyo', emoji: '🫰', price: 5 },
  { id: 'gift_perfume', name: 'Parfum', emoji: '🧴', price: 20 },
  // Baris 2: Murah
  { id: 'gift_donut', name: 'Donat', emoji: '🍩', price: 30 },
  { id: 'gift_cap', name: 'Topi', emoji: '🧢', price: 99 },
  { id: 'gift_confetti', name: 'Hujan Kertas', emoji: '🎉', price: 100 },
  // Baris 3: Menengah
  { id: 'gift_sunglasses', name: 'Kacamata', emoji: '😎', price: 199 },
  { id: 'gift_boxing', name: 'Tinju', emoji: '🥊', price: 299 },
  { id: 'gift_moneygun', name: 'Pistol Uang', emoji: '💸', price: 500 },
  // Baris 4: Efek
  { id: 'gift_swan', name: 'Angsa', emoji: '🦢', price: 699 },
  { id: 'gift_galaxy', name: 'Galaksi', emoji: '🌌', price: 1000 },
  { id: 'gift_whale', name: 'Paus', emoji: '🐋', price: 2150 },
  // Baris 5: Sultan
  { id: 'gift_jet', name: 'Jet Pribadi', emoji: '✈️', price: 4888 },
  { id: 'gift_unicorn', name: 'Kuda Poni', emoji: '🦄', price: 5000 },
  { id: 'gift_rocket', name: 'Roket', emoji: '🚀', price: 10000 },
  // Baris 6: Dewa
  { id: 'gift_castle', name: 'Istana', emoji: '🏰', price: 20000 },
  { id: 'gift_lion', name: 'Singa', emoji: '🦁', price: 29999 },
  { id: 'gift_universe', name: 'Fizatalk Universe', emoji: '🌏', price: 44999 },
];

// 2. OPSI TOP UP (100 Koin = Rp 1.000)
const TOPUP_OPTIONS = [
  { coins: 100, price: 1000 },
  { coins: 250, price: 2500 },
  { coins: 500, price: 5000 },
  { coins: 1000, price: 10000 },
  { coins: 2500, price: 25000 },
  { coins: 5000, price: 50000 },
  { coins: 10000, price: 100000 },
  { coins: 25000, price: 250000 },
  { coins: 50000, price: 500000 },
];

// ===============================
// PREMIUM PACKAGE CONFIGURATION
// ===============================
const PREMIUM_PACKAGES = {
  normal: {
    '7': { days: 7, price: 25000, label: '1 Minggu' },
    '30': { days: 30, price: 60000, label: '1 Bulan' }
  },
  promo: {
    '30': { days: 30, price: 5000, label: '1 Bulan' },
    '90': { days: 90, price: 12000, label: '3 Bulan' }
  }
};

// Helper function to get premium image file_id from database
async function getPremiumFileId(supabase: any): Promise<string | null> {
  return await getBotSetting(supabase, 'premium_file_id');
}

// Helper function to get promo premium image file_id from database
async function getPromoPremiumFileId(supabase: any): Promise<string | null> {
  return await getBotSetting(supabase, 'promo_premium_file_id');
}

// Helper function to build premium benefits text
function getPremiumBenefitsText(): string {
  return `✨ <b>KEUNTUNGAN PREMIUM:</b>
• 🎯 <b>Filter Gender:</b> Bebas pilih target gender chat sesuai keinginanmu.
• 📍 <b>Filter Lokasi:</b> Cari partner berdasarkan target lokasi spesifik.
• 🛡️ <b>Anti Banned:</b> Akunmu mendapatkan status VIP yang lebih kebal terhadap blokir/banned.
• 🎭 <b>Bebas Stiker:</b> Kirim stiker favoritmu tanpa batasan atau peninjauan sistem.
• ⚠️ <b>Bebas Peringatan:</b> Terbebas dari peringatan spam yang mengganggu kenyamanan chat.
• ⭐ <b>Badge Premium:</b> Tampil beda dengan lencana eksklusif.
• 🚀 <b>Prioritas matching:</b> Dapatkan partner chat lebih cepat dari pengguna biasa.`;
}

// Helper function to build premium-only filter message
function buildFilterPremiumOnlyMessage(customTitle: string = '🔒 Fitur Khusus Premium!'): string {
  return `<b>${customTitle}</b>

${getPremiumBenefitsText()}

💎 Beli sekarang untuk menikmati semua fiturnya!`;
}

// Helper function to build premium purchase keyboard (normal prices)
function buildPremiumNormalKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: `📦 ${PREMIUM_PACKAGES.normal['7'].label} - Rp ${PREMIUM_PACKAGES.normal['7'].price.toLocaleString('id-ID')}`, callback_data: 'buy_premium_normal_7' }],
      [{ text: `📦 ${PREMIUM_PACKAGES.normal['30'].label} - Rp ${PREMIUM_PACKAGES.normal['30'].price.toLocaleString('id-ID')}`, callback_data: 'buy_premium_normal_30' }]
    ]
  };
}

// Helper function to send premium offer with photo
async function sendPremiumOffer(supabase: any, botToken: string, userId: number, featureName: string, customTitle?: string): Promise<void> {
  const titleToUse = customTitle || '🔒 Fitur Khusus Premium!';
  const premiumMessage = buildFilterPremiumOnlyMessage(titleToUse);
  const keyboard = buildPremiumNormalKeyboard();
  
  // Get premium file_id from database
  const premiumFileId = await getPremiumFileId(supabase);
  
  if (!premiumFileId) {
    // No photo set, send text only
    await sendTelegramMessage(botToken, userId, premiumMessage, keyboard);
    return;
  }
  
  try {
    const resp = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        photo: premiumFileId,
        caption: premiumMessage,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });

    if (!resp.ok) {
      await sendTelegramMessage(botToken, userId, premiumMessage, keyboard);
    }
  } catch (e) {
    console.error('sendPremiumOffer error:', e);
    await sendTelegramMessage(botToken, userId, premiumMessage, keyboard);
  }
}

// 3. HELPER: Build Keyboard Gift (Disertai Tombol Top Up)
function buildGiftKeyboard() {
  const keyboard = [];
  let row: any[] = [];

  for (let i = 0; i < GIFT_LIST.length; i++) {
    const gift = GIFT_LIST[i];
    // Tampilan: 🌹 1
    row.push({ 
      text: `${gift.emoji} ${gift.price.toLocaleString('id-ID')}`, 
      callback_data: `send_gift_${gift.id}` 
    });

    if (row.length === 3 || i === GIFT_LIST.length - 1) {
      keyboard.push(row);
      row = [];
    }
  }
  //  tombol Top Up
  keyboard.push([{ text: '➕ Top Up Saldo', callback_data: 'open_topup_menu' }]);
  return { inline_keyboard: keyboard };
}

// 4. HELPER: Build Keyboard Top Up (3x3 Grid)
function buildTopupKeyboard() {
  const keyboard = [];
  let row: any[] = [];

  for (let i = 0; i < TOPUP_OPTIONS.length; i++) {
    const option = TOPUP_OPTIONS[i];
    // Tampilan: 100 💰
    row.push({ 
      text: `${option.coins.toLocaleString('id-ID')} 💰`, 
      callback_data: `init_topup_${option.coins}` 
    });

    if (row.length === 3 || i === TOPUP_OPTIONS.length - 1) {
      keyboard.push(row);
      row = [];
    }
  }
  return { inline_keyboard: keyboard };
}


// HELPER: Mendapatkan preview pesan yang dibalas (1 Baris & Bersih)
function getReplyPreview(replyMsg: any, currentUserId: number): string {
  if (!replyMsg) return '';

  // 1. Tentukan Label Pengirim
  let senderName = "Membalas Anda"; 
  if (replyMsg.from?.id === currentUserId) {
      senderName = "Partner";
  }

  // --- FUNGSI PEMROSES TEKS ---
  const processText = (text: string) => {
    if (!text) return '';
    
    let clean = text
      // A. Hapus Blockquote HTML lama (jika ada)
      .replace(/^<blockquote>[\s\S]*?<\/blockquote>\s*/i, '')
      // B. Hapus Visual Quote lama 
      .replace(/^.*?(?:Membalas Anda|Partner)[\s\S]*?\n[\s\S]*?\n/i, '');


    // C. FLATTEN: Ganti Enter (\n) dan spasi ganda menjadi 1 spasi
    // Ini yang membuat pesan jadi satu baris lurus
    clean = clean.replace(/\s+/g, ' ').trim();

    return clean;
  };

  let previewText = "";

  // 2. Ambil konten pesan (Text atau Media)
  if (replyMsg.text) {
    previewText = processText(replyMsg.text);
  } 
  else {
    // Label Media
    let mediaLabel = "📎 [Media]";
    if (replyMsg.photo) mediaLabel = "📷 [Foto]";
    else if (replyMsg.video) mediaLabel = "📹 [Video]";
    else if (replyMsg.voice) mediaLabel = "🎤 [Voice]";
    else if (replyMsg.sticker) mediaLabel = "😊 [Sticker]";
    else if (replyMsg.document) mediaLabel = "📁 [File]";
    
    previewText = mediaLabel;

    // Jika ada caption, sambungkan di sebelahnya
    if (replyMsg.caption) {
        const cleanCaption = processText(replyMsg.caption);
        if (cleanCaption) {
           previewText = `${mediaLabel} ${cleanCaption}`;
        }
    }
  }

  // 3. TRUNCATE: Potong jika > 50 karakter agar tetap 1 baris visual
  if (previewText.length > 25) {
    previewText = previewText.substring(0, 25) + "...";
  }

  // 4. Escape HTML (Penting)
  previewText = previewText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Format Akhir
  return `<blockquote><b>${senderName}:</b>\n${previewText}</blockquote>\n`;
}

// Helper untuk mendeteksi pesan yang bisa di-klik (link, mention, command)
function hasSpamEntities(message: TelegramMessage): boolean {
  const entities = message.entities || message.caption_entities || [];
  for (const ent of entities) {
    if (['url', 'text_link', 'mention', 'bot_command'].includes(ent.type)) {
      return true;
    }
  }
  return false;
}

// Helper untuk aksi eksekusi pemblokiran & peringatan oleh Admin
async function handleAdminSpamAction(supabase: any, botToken: string, targetId: number, action: 'warn' | 'block', adminMsg: any, adminChatId: number) {
    const { data: user } = await supabase.from('telegram_users')
        .select('premium_until, spam_warnings, spam_warning_until, penalty_points')
        .eq('id', targetId).single();
        
    if (!user) return;
    
    const isPremium = user.premium_until && new Date(user.premium_until) > new Date();
    let warnings = user.spam_warnings || 0;
    const warningUntil = user.spam_warning_until ? new Date(user.spam_warning_until) : null;
    
    // Reset peringatan jika sudah melewati masa 30 hari
    if (warningUntil && new Date() > warningUntil) {
        warnings = 0;
    }
    
    // Tetapkan logika penambahan point & status
    if (action === 'warn') {
        warnings += 1;
    } else {
        warnings = 4; // Auto-Trigger block max
    }
    
    const newWarningDate = new Date();
    newWarningDate.setDate(newWarningDate.getDate() + 30); // Reset timer 30 hari
    
    if (warnings >= 4) {
        // ----- LOGIKA MENCAPAI 4 PERINGATAN (BLOKIR) -----
        if (isPremium) {
            // PREMIUM: Tidak diblokir, hanya update peringatan & penalty_points (tidak di-set blocked_until)
            await supabase.from('telegram_users').update({ 
                spam_warnings: warnings, 
                spam_warning_until: newWarningDate.toISOString(),
                penalty_points: 99
            }).eq('id', targetId);
            
            await sendTelegramMessage(
                botToken, 
                targetId, 
                `⚠️ <b>PERINGATAN KERAS</b>\n\nAnda telah mencapai batas peringatan SPAM maksimum (4/4). Sebagai pengguna <b>Premium</b>, akun Anda tidak diblokir, namun harap patuhi aturan komunitas.`
            );
        } else {
            await supabase.from('telegram_users').update({ 
                spam_warnings: warnings, 
                spam_warning_until: newWarningDate.toISOString(),
                penalty_points: 100
            }).eq('id', targetId);
            
            await supabase.from('blocked_users').upsert({
                user_id: targetId,
                reason: 'spam_block',
                blocked_message: 'Akun diblokir karena melakukan spam link / pelanggaran keras.',
                is_active: true
            });
            
            // Gunakan UI Blokir Existing
            const blockedKeyboard = {
              inline_keyboard: [
                [{ text: '💸 Bayar Denda - Rp 10.000', callback_data: 'pay_fine' }],
                [{ text: '💎 Upgrade Premium (Anti-Banned)', callback_data: 'show_premium_offer_antibanned' }]
              ]
            };
            const blockedMsg = `🚫 <b>AKUN ANDA DIBLOKIR</b>\n\n⚠️ <b>Alasan:</b> Anda telah mencapai batas peringatan SPAM (4/4). Demi kenyamanan, akses chat Anda <b>dinonaktifkan</b>.\n\nPilih opsi di bawah untuk memulihkan akun:`;
            await sendTelegramMessage(botToken, targetId, blockedMsg, blockedKeyboard);
        }
    } else {
        // ----- LOGIKA HANYA PERINGATAN (1/4 - 3/4) -----
        await supabase.from('telegram_users').update({ 
            spam_warnings: warnings, 
            spam_warning_until: newWarningDate.toISOString(),
            penalty_points: (user.penalty_points || 0) + 10 // Tambah penalty poin
        }).eq('id', targetId);
        
        // Peringatan HANYA jika bukan premium
        if (!isPremium) {

            const premiumUpgradeKeyboard = {
                inline_keyboard: [
                    [{ text: '💎 Upgrade Premium (Bebas Peringatan)', callback_data: 'show_premium_offer_peringatan' }]
                ]
            };
            const warnMsg = `⚠️ <b>PERINGATAN (${warnings}/4)</b>\n\nKami mendeteksi aktivitas SPAM atau konten dilarang di akun Anda.\n\n🚫 <b>HIMBAUAN:</b>\nJangan menyebar spam link, mengirim stiker 18+, atau media 18+.\n\n<i>Peringatan ini akan hilang seiring banyaknya partner yang suka berinteraksi dengan Anda.</i>\n\n💎 <b>Beli Premium</b> untuk menghindari peringatan ini dan blokir permanen.`;
            await sendTelegramMessage(botToken, targetId, warnMsg, premiumUpgradeKeyboard);
        }
    }
    
    // Ubah UI pesan Admin agar tidak diklik dua kali
    if (adminMsg) {
        await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: adminChatId,
                message_id: adminMsg.message_id,
                text: adminMsg.text + `\n\n✅ <b>Tindakan:</b> ${action === 'warn' ? 'Diberi Peringatan' : 'Diblokir'} (${warnings}/4)`
            })
        });
    }
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string, replyMarkup?: any, retries = 2): Promise<boolean> {
  const url = `${TELEGRAM_API}${botToken}/sendMessage`;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup })
      });
      if (response.ok) return true;
      if (response.status === 429) await new Promise(res => setTimeout(res, 1000)); // Rate limit handling
    } catch (error) {
       if (i === retries - 1) return false;
    }
  }
  return false;
}

async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string, showAlert: boolean = false, url?: string) {
  const apiUrl = `${TELEGRAM_API}${botToken}/answerCallbackQuery`;
  const body: any = {
    callback_query_id: callbackQueryId,
    show_alert: showAlert
  };
  if (text) body.text = text;
  if (url) body.url = url;
  await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// FUNGSI BARU: Menggunakan copyMessage untuk meneruskan SEMUA JENIS PESAN tanpa tag "diteruskan oleh"
async function copyTelegramMessage(botToken: string, chatId: number, fromChatId: number, messageId: number, replyMarkup?: any) {
  const url = `${TELEGRAM_API}${botToken}/copyMessage`;
  const body: any = {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId
  };
  // TAMBAHKAN INI UNTUK MENDUKUNG TOMBOL
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// FUNGSI BARU: Menghapus pesan di chat
async function deleteTelegramMessage(botToken: string, chatId: number, messageId: number): Promise<boolean> {
  const url = `${TELEGRAM_API}${botToken}/deleteMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId
      })
    });
    return response.ok;
  } catch (error) {
    console.error('deleteMessage error:', error);
    return false;
  }
}


// ============================================
// CHANNEL MEMBERSHIP CHECK
// Cek apakah user sudah join channel wajib
// ============================================

// HELPER: Cek apakah user sudah bergabung di channel yang diperlukan
async function checkChannelMembership(botToken: string, userId: number, channelUsername: string): Promise<{ isMember: boolean; status: string; botNotAdmin: boolean }> {
  try {
    const url = `${TELEGRAM_API}${botToken}/getChatMember`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channelUsername,
        user_id: userId
      })
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      // Jika error "member list is inaccessible", bot bukan admin channel
      if (data.description?.includes('member list is inaccessible')) {
        return { isMember: false, status: 'bot_not_admin', botNotAdmin: true };
      }
      // Error lain (misal user belum pernah join), anggap belum member
      return { isMember: false, status: 'unknown', botNotAdmin: false };
    }
    
    const status = data.result.status;
    // Status yang dianggap sebagai member: creator, administrator, member
    const isMember = ['creator', 'administrator', 'member'].includes(status);
    
    return { isMember, status, botNotAdmin: false };
  } catch (error) {
    // Jika exception, anggap belum member untuk memaksa join
    return { isMember: false, status: 'error', botNotAdmin: false };
  }
}

// HELPER: Kirim pesan permintaan join channel
async function sendJoinChannelMessage(botToken: string, userId: number, botNotAdmin: boolean = false): Promise<void> {
  const channelUrl = `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`;
  
  let message: string;
  
  if (botNotAdmin) {
    // Bot belum jadi admin, tampilkan pesan khusus
    message = `⚠️ <b>Gabung ke channel kami dulu ya!</b>

Untuk menggunakan fitur pencarian partner, kamu harus bergabung ke channel official kami terlebih dahulu.

📢 <b>Channel:</b> ${REQUIRED_CHANNEL}

Setelah bergabung, tekan tombol "✅ Sudah Gabung" untuk melanjutkan.

<i>💡 Tips: Pastikan kamu sudah menekan tombol "Join" di channel.</i>`;
  } else {
    message = `⚠️ <b>Kamu belum bergabung ke channel kami!</b>

Untuk menggunakan fitur pencarian partner, kamu harus bergabung ke channel official kami terlebih dahulu.

📢 <b>Channel:</b> ${REQUIRED_CHANNEL}

Setelah bergabung, tekan tombol "✅ Sudah Gabung" untuk melanjutkan.`;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: '📢 Gabung Channel', url: channelUrl }],
      [{ text: '✅ Sudah Gabung', callback_data: 'check_channel_joined' }]
    ]
  };
  
  await sendTelegramMessage(botToken, userId, message, keyboard);
}

// ============================================
// RPC-BASED PARTNER MATCHING (Cost Optimized)
// Menggunakan database RPC untuk mengurangi round-trip
// ============================================

// Helper: Build end chat keyboard with rating buttons
function buildEndChatKeyboard(partnerId: number): any {
  return {
    inline_keyboard: [
      [
        { text: '🚩 Laporkan', callback_data: `report_user_${partnerId}`},
        { text: '😎 Asik', callback_data: `rate_asik_${partnerId}` },
        { text: '👍 Baik', callback_data: `rate_baik_${partnerId}` }
      ],
      [
        { text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }
      ],
      [
        { text: '🔄 Hubungi Kembali', callback_data: `reconnect_${partnerId}` }
      ]
    ]
  };
}

// ============================================
// UNIFIED RPC: search_or_next_partner
// Menggabungkan semua logika search & next dalam satu RPC
// ============================================

// Interface for comprehensive_search_action RPC result
interface ComprehensiveSearchResult {
  success: boolean;
  matched?: boolean;
  partner_id?: number;
  partner_premium_until?: string | null;
  error?: string;
  action?: string;
  chat_ended?: boolean;
  old_partner_id?: number;
  old_partner_promo?: { should_send: boolean };
  should_check_channel?: boolean;
  is_new_user?: boolean;
  blocked_message?: string;
  blocked_until?: string;
  reputation?: {
    status: string;
    message: string | null;
    penalty_points: number;
  };
}

// HELPER: Build pesan pencarian dengan peringatan reputasi (jika ada)
// Menggabungkan pesan "Mencari partner" dengan peringatan reputasi dalam 1 pesan
// skipIfLowPenalty: jika true dan penalty < 40, return null (tidak perlu kirim pesan)
function buildSearchMessageWithReputation(
  reputation?: ComprehensiveSearchResult['reputation'], 
  isNext: boolean = false,
  skipIfLowPenalty: boolean = false,
  filterInfo?: { target_gender?: string | null; target_location?: string | null }
): string | null {
  const baseAction = isNext ? '🔄 <b>Mengakhiri chat dan mencari partner baru...</b>' : '🔍 Mencari partner untuk kamu...';
  
  // Build filter info text - tampilkan semua info filter jika filterInfo ada
  let filterText = '';
  if (filterInfo) {
    const genderVal = filterInfo.target_gender || 'semua';
    const gLabel = genderVal === 'cowok' ? '👦 Cowok' : genderVal === 'cewek' ? '👧 Cewek' : '👥 Semua';
    const locVal = filterInfo.target_location || 'semua';
    const locLabel = locVal === 'semua' ? '🌏 Semua' : `📍 ${locVal}`;
    filterText = `\n🎯Target Gender: <b>${gLabel}</b>\n📍Target Lokasi: <b>${locLabel}</b>`;
  }

  // Jika tidak ada reputation atau penalty di bawah 40
  if (!reputation || reputation.penalty_points < 40) {
    // Jika skipIfLowPenalty = true, tidak perlu kirim pesan
    if (skipIfLowPenalty) {
      return null;
    }
    return `${baseAction}${filterText}\n\n${isNext ? '✨ Bagaimana pengalaman chat kamu? Beri penilaian untuk partner!' : 'Mohon tunggu sebentar!'}`; 
   }
  
  // Penalty 40-69: Status Peringatan
  if (reputation.status === 'warning') {
    return `${baseAction}${filterText}\n\n⚠️ <b>Status: Peringatan</b>\n\n${reputation.message || 'Anda mendapat beberapa laporan negatif dari pengguna lain.'} Harap perbaiki sikap atau akun berisiko dibatasi.\n\n<i>Anda akan lepas dari peringatan jika banyak partner yang suka berinteraksi dengan Anda</i>.`;
  }
  
  // Penalty 70-99: Status Kritis
  if (reputation.status === 'critical') {
    return `${baseAction}${filterText}\n\n🔞 <b>Status: Kritis</b>\n\n${reputation.message || 'Akun Anda dalam kondisi kritis.'} Satu laporan lagi dan Anda akan dibanned.\n\n🚫 DAFTAR PELANGGARAN KERAS:

<b>NSFW / Sange:</b> Chat seks, meminta pap, atau pembahasan vulgar.

<b>Spam:</b> Mengirim pesan berulang, promosi, iklan, atau link.

<b>Toxic:</b> Kasar, menghina SARA, atau bullying.

<b>Troll:</b> Skip chat terus-menerus tanpa interaksi.

<b>Cara lepas dari peringatan dan menghindari blokir:</b>
1️⃣  Hentikan semua perilaku di atas segera.
2️⃣  Berinteraksi dengan partner secara sopan dan ramah.
3️⃣  Dapatkan feedback positif dari partner.`;
  }
  
  // Default fallback - masih tampilkan jika penalty >= 40 tapi status tidak dikenali
  return `${baseAction}${filterText}\n\nMohon tunggu sebentar!`;
}

// HELPER: Kirim pesan pencarian dengan reputasi (1 pesan gabungan)
// skipIfLowPenalty: jika true dan penalty < 40, tidak kirim pesan sama sekali
async function sendSearchingMessage(
  botToken: string, 
  userId: number, 
  reputation?: ComprehensiveSearchResult['reputation'], 
  isNext: boolean = false,
  skipIfLowPenalty: boolean = false,
  replyMarkup?: any,
  filterInfo?: { target_gender?: string | null; target_location?: string | null }
): Promise<void> {
  const message = buildSearchMessageWithReputation(reputation, isNext, skipIfLowPenalty, filterInfo);
  if (message) {
    await sendTelegramMessage(botToken, userId, message, replyMarkup);
  }
}

// ============================================
// IN-MEMORY CACHE UNTUK STICKER PACKS
// Menghindari tagihan database jebol akibat spam stiker
// ============================================
interface StickerPackData {
  status: string;
  fiza_pack_name: string | null;
  submission_count: number;
}
// Cache in-memory untuk memutus query berulang
const stickerPackCache = new Map<string, StickerPackData>();

// ============================================
// BUTTON DEBOUNCE SYSTEM (Cost Optimization)
// ============================================
// Mencegah double-click dengan menyimpan timestamp klik terakhir
// Key: `${userId}_${action}`, Value: timestamp
// 
// PENTING: Cache ini HARUS dicek PALING AWAL di handler callback_query
// sebelum operasi database apapun untuk menghemat biaya cloud


const buttonClickCache = new Map<string, number>();

// Cooldown per action type (dalam milidetik) - DIPERBESAR untuk mencegah double-click
const BUTTON_COOLDOWNS: Record<string, number> = {
  'search_partner': 5000,    // 5 detik - mencari partner (operasi berat)
  'chat_next': 5000,         // 5 detik - next partner (operasi berat)
  'chat_stop': 3000,         // 3 detik - stop chat
  'send_gift': 3000,         // 3 detik - kirim gift
  'init_topup': 4000,        // 4 detik - init topup
  'buy_premium': 4000,       // 4 detik - beli premium
  'prem_pay': 4000,          // 4 detik - proses bayar premium
  'topup_pay': 4000,         // 4 detik - proses bayar topup
  'fine_pay': 4000,          // 4 detik - proses bayar denda
  'report_user': 3000,       // 3 detik - lapor user
  'rate_asik': 3000,         // 3 detik - rate asik
  'rate_baik': 3000,         // 3 detik - rate baik
  'reconnect': 4000,         // 4 detik - reconnect partner
  'pay_fine': 4000,          // 4 detik - bayar denda (show menu)
  'cancel_topup': 2000,      // 2 detik - cancel topup
  'cancel_premium': 2000,    // 2 detik - cancel premium
  'cancel_fine': 2000,       // 2 detik - cancel fine
  'cs_action': 5000,         // 5 detik - CS approve/reject
  'gender': 2000,            // 2 detik - pilih gender
  'target': 2000,            // 2 detik - pilih target
  'location': 2000,          // 2 detik - pilih lokasi
  'default': 1500,           // 1.5 detik - default
};

// Timestamp terakhir cleanup untuk mencegah cleanup terlalu sering
let lastCacheCleanup = Date.now();
const CLEANUP_INTERVAL = 30000; // Cleanup setiap 30 detik

// Helper: Cek apakah tombol masih dalam cooldown
// Return true jika dalam cooldown (harus di-block), false jika boleh proceed
function isButtonOnCooldown(userId: number, action: string): boolean {
  const cacheKey = `${userId}_${action}`;
  const now = Date.now();
  const lastClick = buttonClickCache.get(cacheKey);
  const cooldownMs = BUTTON_COOLDOWNS[action] || BUTTON_COOLDOWNS['default'];
  
  // Jika masih dalam cooldown, block request
  if (lastClick && (now - lastClick) < cooldownMs) {
    console.log(`[DEBOUNCE] Blocked: user=${userId} action=${action} elapsed=${now - lastClick}ms cooldown=${cooldownMs}ms`);
    return true; // Masih dalam cooldown
  }
  
  // Set timestamp klik baru
  buttonClickCache.set(cacheKey, now);
  
  // Periodic cleanup: hapus entry yang sudah > 1 menit
  if (now - lastCacheCleanup > CLEANUP_INTERVAL) {
    const oneMinuteAgo = now - 60000;
    let cleanedCount = 0;
    for (const [key, timestamp] of buttonClickCache.entries()) {
      if (timestamp < oneMinuteAgo) {
        buttonClickCache.delete(key);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`[DEBOUNCE] Cache cleanup: removed ${cleanedCount} entries, remaining ${buttonClickCache.size}`);
    }
    lastCacheCleanup = now;
  }
  
  return false;
}

// Helper: Get action type dari callback data
function getActionTypeFromCallback(callbackData: string): string {
  if (callbackData === 'search_partner' || callbackData.startsWith('search_partner:')) return 'search_partner';
  if (callbackData === 'chat_next') return 'chat_next';
  if (callbackData === 'chat_stop') return 'chat_stop';
  if (callbackData.startsWith('send_gift_')) return 'send_gift';
  if (callbackData.startsWith('init_topup_')) return 'init_topup';
  if (callbackData.startsWith('buy_premium_')) return 'buy_premium';
  if (callbackData.startsWith('prem_pay_')) return 'prem_pay';
  if (callbackData.startsWith('topup_pay_')) return 'topup_pay';
  if (callbackData.startsWith('fine_pay_')) return 'fine_pay';
  if (callbackData.startsWith('report_user_')) return 'report_user';
  if (callbackData.startsWith('rate_asik_')) return 'rate_asik';
  if (callbackData.startsWith('rate_baik_')) return 'rate_baik';
  if (callbackData.startsWith('reconnect_')) return 'reconnect';
  if (callbackData === 'pay_fine') return 'pay_fine';
  if (callbackData === 'cancel_topup') return 'cancel_topup';
  if (callbackData === 'cancel_premium') return 'cancel_premium';
  if (callbackData === 'cancel_fine') return 'cancel_fine';
  if (callbackData.startsWith('gender_') || callbackData.startsWith('set_gender_')) return 'gender';
  if (callbackData.startsWith('target_')) return 'target';
  if (callbackData.startsWith('set_loc_') || callbackData.startsWith('target_loc_')) return 'location';
  if (callbackData === 'open_gift_menu' || callbackData === 'open_topup_menu') return 'default';
  if (callbackData === 'change_target' || callbackData === 'change_location') return 'default';
  if (callbackData === 'check_channel_joined') return 'search_partner'; // Sama dengan search
  if (callbackData.startsWith('dismiss_promo')) return 'search_partner'; // Dismiss promo = search
  if (callbackData.startsWith('cs_approve_') || callbackData.startsWith('cs_reject_')) return 'cs_action';
  if (callbackData.startsWith('reportm_')) return 'report_media';
  if (callbackData.startsWith('admin_warnm_') || callbackData.startsWith('admin_blockm_')) return 'admin_media_action';
  return 'default';
}

// HELPER: Auto-post stiker preview ke Channel resmi
async function postStickerToChannel(botToken: string, packName: string, previewStickerId: string): Promise<void> {
  const channelUsername = '@FizaStick';
  const packUrl = `https://t.me/addstickers/${packName}`;
  
  // UI/UX: Gunakan Inline Button yang intuitif untuk menambahkan stiker
  const replyMarkup = {
    inline_keyboard: [
      [{ text: '✨ Tambahkan Pack Stiker ✨', url: packUrl }]
    ]
  };

  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/sendSticker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channelUsername,
        sticker: previewStickerId,
        reply_markup: replyMarkup
      })
    });

    if (!res.ok) {
      // Isolasi error log agar rate limit channel tidak membunuh proses utama bot
      const errJson = await res.json();
      console.error('[POST TO CHANNEL] Gagal mengirim ke channel:', JSON.stringify(errJson));
    }
  } catch (error) {
    console.error('[POST TO CHANNEL] System Exception:', error);
  }
}

async function cloneStickerPack(botToken: string, originalPackName: string, botUsername: string, ownerId: number): Promise<{ packName: string | null; errorMsg: string }> {
  try {
    const getSetRes = await fetch(`${TELEGRAM_API}${botToken}/getStickerSet?name=${originalPackName}`);
    const setJson = await getSetRes.json();
    
    if (!setJson.ok || !setJson.result || !setJson.result.stickers.length) {
      return { packName: null, errorMsg: setJson.description || 'Pack tidak ditemukan atau kosong' };
    }
    
    const stickers = setJson.result.stickers;
    const stickerFormat = setJson.result.is_animated ? 'animated' : (setJson.result.is_video ? 'video' : 'static');
    
    // Generate nama pack unik (Syarat Telegram: wajib diakhiri _by_botusername)
    const randomStr = Math.random().toString(36).substring(2, 8);
    const newPackName = `fz_${randomStr}_by_${botUsername}`;
    const newPackTitle = "@FizaTalkBot - Cari Kenalan Disini";

    // 🚀 OPTIMASI PERFORMA & BIAYA CLOUD: Ambil 50 stiker teratas untuk di bulk-create. 
    // Mencegah Timeout dan Error 429 Too Many Requests dari Telegram.
    const inputStickers = stickers.slice(0, 50).map((s: any) => ({
      sticker: s.file_id,
      emoji_list: [s.emoji || '✨']
    }));
    
    const createRes = await fetch(`${TELEGRAM_API}${botToken}/createNewStickerSet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: ownerId,
        name: newPackName,
        title: newPackTitle,
        stickers: inputStickers,
        sticker_format: stickerFormat
      })
    });
    
    const createJson = await createRes.json();
    if (!createJson.ok) {
      console.error('[CLONE STICKER] Error:', createJson);
      return { packName: null, errorMsg: createJson.description || 'Gagal membuat sticker set baru' };
    }

    // Gunakan stiker indeks pertama [0] sebagai gambar preview.
    // 🚀 PERBAIKAN: Ambil stiker indeks [0] dari PACK YANG BARU DIBUAT (Kloning)
    if (inputStickers.length > 0) {
      // Jalankan secara background (fire-and-forget) agar bot tidak lambat
      fetch(`${TELEGRAM_API}${botToken}/getStickerSet?name=${newPackName}`)
        .then(res => res.json())
        .then(newSetJson => {
          if (newSetJson.ok && newSetJson.result.stickers.length > 0) {
            // Dapatkan file_id stiker yang sudah terikat dengan pack kloning
            const clonedStickerId = newSetJson.result.stickers[0].file_id;
            
            // Post stiker kloning ke channel
            return postStickerToChannel(botToken, newPackName, clonedStickerId);
          }
        })
        .catch(err => console.error('[POST TO CHANNEL] Gagal mengambil pack kloning:', err));
    }
    return { packName: newPackName, errorMsg: '' };
  } catch (error) {
    console.error('[CLONE STICKER] Exception:', error);
    return { packName: null, errorMsg: error instanceof Error ? error.message : 'Unknown exception' };
  }
}

async function handleStickerReview(supabase: any, botToken: string, message: any, isPremium: boolean = false): Promise<boolean> {
  const sticker = message.sticker;
  const packName = sticker.set_name;
  const chatId = message.chat.id;

  if (isPremium) {
      return true;
  }

  // 1. Tolak otomatis jika stiker custom/ilegal (tidak punya pack)
  if (!packName) {
    await sendTelegramMessage(botToken, chatId, "❌ Stiker kustom tanpa pack resmi tidak diizinkan demi keamanan.");
    return false;
  }

  // Keyboard upgrade premium standar yang memanfaatkan callback original
  const premiumUpgradeKeyboard = {
      inline_keyboard: [
          [{ text: '💎 Upgrade Premium (Bebas Stiker)', callback_data: 'show_premium_offer_stiker' }]
      ]
  };

  // 2. BYPASS OTOMATIS: Jika stiker yang dikirim buatan Bot kita sendiri (@FizaTalkBot)
  const botUsername = Deno.env.get('BOT_USERNAME') || 'FizaTalkBot';
  if (packName.endsWith(`_by_${botUsername}`)) {
     return true; // Langsung izinkan dan teruskan ke partner
  }

  // 3. Cek In-Memory Cache (Performa Cepat, 0 Biaya Baca DB)
  let packData = stickerPackCache.get(packName);

  // 4. Jika tidak ada di cache, sinkronkan ke DB
  if (!packData) {
    const { data } = await supabase.from('sticker_packs')
      .select('status, fiza_pack_name, submission_count')
      .eq('pack_name', packName)
      .single();
      
    if (data) {
      packData = { status: data.status, fiza_pack_name: data.fiza_pack_name, submission_count: data.submission_count || 1 };
      stickerPackCache.set(packName, packData); 
    }
  }

  // 5. Evaluasi Status Interaksi UI/UX ke User
  if (packData) {
    if (packData.status === 'approved') {
      // Jika disetujui, TAPI user mengirim menggunakan pack aslinya (bukan yang dikloning bot)
      if (packData.fiza_pack_name) {
         await sendTelegramMessage(botToken, chatId, `⚠️ <b>Gunakan Pack Resmi Kami!</b>\n\nStiker yang kamu kirim sudah ada versi khususnya. Silakan tambahkan dan gunakan stiker dari pack berikut:\n👉 https://t.me/addstickers/${packData.fiza_pack_name}\n\n<i>Atau gunakan stiker dari channel @FizaStick.</i>`);
      } else {
         return true; // Fallback jika stiker lama belum dikloning tapi berstatus approved
      }
      return false; // Jangan kirim ke partner
    }
    
    if (packData.status === 'rejected') {
      await sendTelegramMessage(botToken, chatId, "❌ Stiker dari pack ini tidak diizinkan. Silakan gunakan stiker dari channel @FizaStick.", premiumUpgradeKeyboard);
      return false;
    }
    
    if (packData.status === 'pending') {
      packData.submission_count = (packData.submission_count || 1) + 1;
      
      // Update DB tanpa menunggu
      supabase.from('sticker_packs')
        .update({ submission_count: packData.submission_count })
        .eq('pack_name', packName)
        .then();
        
      stickerPackCache.set(packName, packData);

      await sendTelegramMessage(botToken, chatId, "⏳ Pack stiker tersebut sedang ditinjau oleh admin.\n💡 <i>Rekomendasi: Gunakan stiker dari channel @FizaStick terlebih dahulu.</i>", premiumUpgradeKeyboard);
      
      const adminChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
      if (adminChatId) {
        const { data: packDb } = await supabase.from('sticker_packs').select('id').eq('pack_name', packName).single();
        if (packDb) {
          await fetch(`${TELEGRAM_API}${botToken}/sendSticker`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: adminChatId, sticker: sticker.file_id })
          });

          const reviewKeyboard = {
            inline_keyboard: [
              [
                { text: '✅ Izinkan & Kloning', callback_data: `ap_${packDb.id}` },
                { text: '❌ Tolak Pack', callback_data: `dp_${packDb.id}` }
              ]
            ]
          };
          await sendTelegramMessage(botToken, parseInt(adminChatId), `⚠️ <b>Review Stiker Baru (Kiriman ke-${packData.submission_count})</b>\n\nNama Pack: <code>${packName}</code>\nPengirim: <code>${chatId}</code>\n\nJika diizinkan, bot otomatis mengkloning pack ini menjadi milik @FizaTalkBot.`, reviewKeyboard);
        }
      }
      return false;
    }
  }

  // 6. PACK BARU (Belum Terdaftar) -> Simpan Requester dan Minta Review
  const { data: newPack, error } = await supabase.from('sticker_packs')
    .insert({ pack_name: packName, status: 'pending', requester_id: chatId })
    .select('id').single();

  if (!error && newPack) {
    stickerPackCache.set(packName, { status: 'pending', fiza_pack_name: null }); 
    await sendTelegramMessage(botToken, chatId, "⏳ Pack stiker tersebut akan ditinjau oleh admin.\n💡 <i>Rekomendasi: Gunakan stiker dari channel @FizaStick terlebih dahulu.</i>", premiumUpgradeKeyboard);

    const adminChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
    if (adminChatId) {
      await fetch(`${TELEGRAM_API}${botToken}/sendSticker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: adminChatId, sticker: sticker.file_id })
      });

      const reviewKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Izinkan & Kloning', callback_data: `ap_${newPack.id}` },
            { text: '❌ Tolak Pack', callback_data: `dp_${newPack.id}` }
          ]
        ]
      };
      await sendTelegramMessage(botToken, parseInt(adminChatId), `⚠️ <b>Review Stiker Baru (Kiriman ke-1)</b>\n\nNama Pack: <code>${packName}</code>\nPengirim: <code>${chatId}</code>\n\nJika diizinkan, bot otomatis mengkloning pack ini menjadi milik @FizaTalkBot.`, reviewKeyboard);
    }
  } else {
    await sendTelegramMessage(botToken, chatId, "⏳ Pack stiker ini sedang diproses sistem.");
  }

  return false; 
}

// Satu panggilan menangani SEMUA: upsert, channel check, state, reputation, search
async function comprehensiveSearchAction(
  supabase: any, 
  botToken: string, 
  userId: number, 
  username: string | undefined,
  firstName: string | undefined,
  isNext: boolean = false
): Promise<{ success: boolean; handled: boolean; result?: ComprehensiveSearchResult }> {
  
  
  // SINGLE RPC CALL - handles everything!
  const { data, error } = await supabase.rpc('comprehensive_search_action', {
    p_user_id: userId,
    p_username: username || null,
    p_first_name: firstName || null,
    p_is_next: isNext
  });
  
  if (error) {
    // Fallback: masukkan user ke antrian secara manual
    await supabase.from('waiting_queue').upsert({
      user_id: userId,
      joined_at: new Date().toISOString()
    });
    await supabase.from('telegram_users').update({ state: 'waiting' }).eq('id', userId);
    return { success: false, handled: true };
  }
  
  const result = data as ComprehensiveSearchResult;
  
  // Handle jika user diblokir (dari blocked_users table)
  if (!result.success && result.error === 'user_blocked') {
    const blockedKeyboard = {
      inline_keyboard: [
        [
          { text: '💸 Bayar Denda - Rp 10.000', callback_data: 'pay_fine' }
        ],
        [
          { text: '💎 Upgrade Premium (Anti-Banned)', callback_data: 'show_premium_offer_antibanned' }
        ]
      ]
    };

    const remainingTimeStr = formatRemainingTime(result.blocked_until);
    const blockedMessage = `🚫 <b>AKUN ANDA DIBLOKIR</b>

  ⚠️ <b>Alasan:</b> Kami menerima terlalu banyak laporan negatif terkait aktivitas chat Anda. Demi kenyamanan komunitas, akses chat Anda <b>dinonaktifkan selama 15 hari.</b>

  ⏳ <b>Sisa Waktu Pemblokiran:</b> <b>${remainingTimeStr}</b>

  🔓 <b>CARA MEMBUKA BLOKIR:</b>

  1️⃣ <b>Bayar Denda Pelanggaran</b>
  Hapus status blokir saat ini dengan membayar denda sebesar <b>Rp 10.000</b>.

  2️⃣ <b>Upgrade ke Premium (Recommended)</b>
  Dapatkan status <b>VIP</b> yang lebih kebal terhadap laporan palsu, prioritas matching, dan fitur eksklusif lainnya.

  Pilih opsi di bawah untuk memulihkan akun Anda segera:`;

    await sendTelegramMessage(
      botToken,
      userId,
      blockedMessage,
      blockedKeyboard
    );
    return { success: false, handled: true, result };
  }
  
  // Handle jika user premium kena temp ban (blocked_until)
  if (!result.success && result.error === 'user_temp_banned') {
    const blockedUntil = result.blocked_until ? new Date(result.blocked_until) : null;
    const blockedUntilStr = blockedUntil ? formatDateTimeWIB(blockedUntil) : '00:00 WIB';
    
    await sendTelegramMessage(
      botToken,
      userId,
      `⏳ <b>AKUN DIBATASI SEMENTARA</b>\n\n⚠️ Kami menerima terlalu banyak laporan negatif terkait aktivitas chat Anda.\n\n🔓 Akun Anda akan dapat digunakan kembali pada:\n📅 <b>${blockedUntilStr}</b>\n\n💡 Gunakan waktu ini untuk merefleksikan perilaku chat Anda. Hindari spam, konten NSFW, perilaku toksik, dan trolling.`
    );
    return { success: false, handled: true, result };
  }
  
  // Handle jika user banned via penalty points
  // Handle jika user banned via penalty points
  if (!result.success && result.error === 'user_banned') {
    const blockedKeyboard = {
      inline_keyboard: [
        [
          { text: '💸 Bayar Denda - Rp 10.000', callback_data: 'pay_fine' }
        ],
        [
          { text: '💎 Upgrade Premium (Anti-Banned)', callback_data: 'show_premium_offer_antibanned' }
        ]
      ]
    };

    const remainingTimeStr = formatRemainingTime(result.blocked_until);
    const blockedMessage = `🚫 <b>AKUN ANDA DIBLOKIR</b>

  ⚠️ <b>Alasan:</b> Kami menerima terlalu banyak laporan negatif terkait aktivitas chat Anda. Demi kenyamanan komunitas, akses chat Anda <b>dinonaktifkan selama 15 hari.</b>

  ⏳ <b>Sisa Waktu Pemblokiran:</b> <b>${remainingTimeStr}</b>

  🔓 <b>CARA MEMBUKA BLOKIR:</b>

  1️⃣ <b>Bayar Denda Pelanggaran</b>
  Hapus status blokir saat ini dengan membayar denda sebesar <b>Rp 10.000</b>.

  2️⃣ <b>Upgrade ke Premium (Recommended)</b>
  Dapatkan status <b>VIP</b> yang lebih kebal terhadap laporan palsu, prioritas matching, dan fitur eksklusif lainnya.

  Pilih opsi di bawah untuk memulihkan akun Anda segera:`;

    await sendTelegramMessage(
      botToken,
      userId,
      blockedMessage,
      blockedKeyboard
    );
    return { success: false, handled: true, result };
  }
  
  // Handle error lain
  if (!result.success) {
    return { success: false, handled: true, result };
  }
  
  // ========== HANDLE NOTIFIKASI KE PARTNER LAMA (JIKA NEXT) ==========
  if (result.chat_ended && result.old_partner_id) {
    // Kirim notifikasi ke partner lama dengan tombol rating
    const combinedPartnerKeyboard = buildEndChatKeyboard(userId);
    await sendTelegramMessage(
      botToken, 
      result.old_partner_id, 
      `⚠️ Partner mengakhiri chat.\n\n✨ Bagaimana pengalaman chat kamu? Beri penilaian untuk partner!`,
      combinedPartnerKeyboard
    );
    
    // Kirim promo ke partner lama jika syarat terpenuhi
    if (result.old_partner_promo?.should_send) {
      await executePromoAction(supabase, botToken, result.old_partner_id);
    }
  }
  
  // ========== RETURN RESULT UNTUK DIPROSES DI CALLER ==========
  return { success: true, handled: false, result };
}

// HELPER: Proses hasil RPC dan kirim notifikasi
// isNext: true jika dari tombol Next, false jika dari tombol Cari Partner
// searchMessageAlreadySent: true jika pesan "Mengakhiri chat..." sudah dikirim oleh caller (untuk menghindari race condition)
async function handleComprehensiveSearchResult(
  supabase: any,
  botToken: string,
  userId: number,
  result: ComprehensiveSearchResult,
  isNext: boolean = false,
  searchMessageAlreadySent: boolean = false
): Promise<void> {
  const penaltyPoints = result.reputation?.penalty_points || 0;
  const warningsCount = (result.reputation as any)?.report_warnings_to_show || 0;

  // Tampilkan peringatan jika ada laporan yang belum diakui
  if (warningsCount > 0) {
    const warningText = "⚠️ <b>PERINGATAN</b>\n\nKamu telah dilaporkan oleh user lain. Kami akan meninjau laporan tersebut. Harap berinteraksi dengan sopan dan patuhi aturan sebelum akun kamu diblokir.";
    await sendTelegramMessage(botToken, userId, warningText);
  }

  // Ambil filter info user untuk pesan "Mencari..." (hanya premium)
  const { data: filterUserData } = await supabase
    .from('telegram_users')
    .select('target_gender, target_location, premium_until')
    .eq('id', userId)
    .single();
  
  // Filter info hanya ditampilkan untuk premium
  let filterInfo: { target_gender?: string | null; target_location?: string | null } | undefined = undefined;

  let isPremium = false;

  if (filterUserData) {
    isPremium = filterUserData.premium_until && new Date(filterUserData.premium_until) > new Date();
    if (isPremium) {
      filterInfo = {
        target_gender: filterUserData.target_gender,
        target_location: filterUserData.target_location
      };
    }
  }

  // Buat keyboard "Laporkan" & "Asik" jika user menekan Next dan penalti < 40
  let endChatKeyboard: any = undefined;
  const inlineKeyboard: any[][] = [];

  // Jika user menekan Next dan penalti < 40, tampilkan tombol rating
  if (isNext && result.old_partner_id && penaltyPoints < 40) {
    inlineKeyboard.push([
      { text: '🚩 Laporkan', callback_data: `report_user_${result.old_partner_id}` },
      { text: '😎 Asik', callback_data: `rate_asik_${result.old_partner_id}` },
      { text: '👍 Baik', callback_data: `rate_baik_${result.old_partner_id}` }
    ]);
  }

  // Jika penalty >= 40, tampilkan tombol Upgrade Premium (Anti Banned)
  if (penaltyPoints >= 40 && !isPremium) {
    inlineKeyboard.push([
      { text: '💎 Upgrade Premium (Anti Banned)', callback_data: 'show_premium_offer_antibanned' }
    ]);
  }

  // Pasang keyboard jika ada isinya
  if (inlineKeyboard.length > 0) {
    endChatKeyboard = { inline_keyboard: inlineKeyboard };
  }
  
  if (!result.matched) {
    // Tidak ada partner yang cocok, user sudah dimasukkan ke antrian oleh RPC
    
    // Jika pesan sudah dikirim sebelum RPC (fix race condition), skip
    if (!searchMessageAlreadySent) {
      // Untuk tombol Next: selalu tampilkan pesan "Mengakhiri chat..." (dengan peringatan jika >= 40)
      // Untuk tombol Cari Partner: tampilkan pesan mencari (dengan peringatan jika >= 40)
      await sendSearchingMessage(botToken, userId, result.reputation, isNext, false, endChatKeyboard, filterInfo);
    }
    return;
  }
  
  // Partner ditemukan!
  const partnerId = result.partner_id!;
  
  // Jika pesan sudah dikirim sebelum RPC (fix race condition), skip
  if (!searchMessageAlreadySent) {
    // Jika penalty >= 40: TETAP tampilkan pesan pencarian + peringatan walaupun langsung dapat partner
    // skipIfLowPenalty = true: jika penalty < 40 dan matched, lewati pesan pencarian
    if (isNext || penaltyPoints >= 40) {
      await sendSearchingMessage(botToken, userId, result.reputation, isNext, false, endChatKeyboard, filterInfo);
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  }
  // Jika penalty < 40 dan matched: langsung ke notifikasi pairing (lewati pesan pencarian)
  
  // Kirim notifikasi pairing berhasil
  const { data: myself } = await supabase.from('telegram_users').select('premium_until').eq('id', userId).single();
  const myPremiumUntil = myself?.premium_until;

  // 2. Status Premium Partner
  // INI PENTING: Kita pakai data dari RPC result, JANGAN query DB lagi.
  const partnerPremiumUntil = result.partner_premium_until;

  // Kirim notifikasi pairing (Tanpa Query Tambahan)
  await sendPairingNotifications(supabase, botToken, userId, partnerId, myPremiumUntil ?? null, partnerPremiumUntil ?? null);
}

// ============================================
// OPTIMIZED AUTO-SEARCH LOGIC (CLEAN)
// ============================================

async function autoSearchPartner(supabase: any, botToken: string, userId: number): Promise<void> {
    // 0. Ambil filter info user untuk ditampilkan di pesan mencari (hanya premium)
    const { data: filterData } = await supabase
      .from('telegram_users')
      .select('target_gender, target_location, premium_until')
      .eq('id', userId)
      .single();
    
    const isPremium = filterData?.premium_until && new Date(filterData.premium_until) > new Date();
    
    // Hanya tampilkan filter info jika user premium
    const filterInfo = isPremium ? {
      target_gender: filterData?.target_gender,
      target_location: filterData?.target_location
    } : undefined;

    // 1. Kirim pesan UI "Mencari..." di awal (dengan filter info)
    await sendSearchingMessage(botToken, userId, undefined, false, false, undefined, filterInfo);

    // 2. Panggil RPC (Otomatis match atau masuk queue)
    const { data, error } = await supabase.rpc('find_and_pair_partner', {
      p_user_id: userId
    });
    
    // Handle Error RPC / Koneksi
    if (error) {
      console.error('AutoSearch Error:', error);
      // Fallback: Masukkan ke antrian secara manual jika RPC error
      await supabase.from('waiting_queue').upsert({ user_id: userId, joined_at: new Date().toISOString() });
      await supabase.from('telegram_users').update({ state: 'waiting' }).eq('id', userId);
      return;
    }
    
    // 3. Handle Result
    if (!data.success) {
      if (data.error === 'user_already_chatting') {
         const chatKeyboard = {
            inline_keyboard: [[{ text: '🛑 Stop', callback_data: 'chat_stop' }, { text: '⏭️ Next', callback_data: 'chat_next' }]]
         };
         await sendTelegramMessage(botToken, userId, '⚠️ Kamu sudah memiliki partner aktif.', chatKeyboard);
      }
      return;
    }
    
    // 4. Jika Match, kirim notifikasi. Jika Waiting, biarkan saja (pesan "Mencari..." sudah ada).
    if (data.status === 'matched' && data.partner_id) {
       await sendPairingNotifications(supabase, botToken, userId, data.partner_id, null, null);
    }
}


// HELPER: Kirim notifikasi setelah pairing berhasil
async function sendPairingNotifications(
  supabase: any,
  botToken: string, 
  user1Id: number, 
  user2Id: number,
  user1PremiumUntil: string | null,
  user2PremiumUntil: string | null
): Promise<void> {
  
  const user1IsPremium = !!(user1PremiumUntil && new Date(user1PremiumUntil) > new Date());
  const user2IsPremium = !!(user2PremiumUntil && new Date(user2PremiumUntil) > new Date());
  
  // Build chat action keyboard
  const buildChatKeyboard = (isPremium: boolean) => ({
    inline_keyboard: [
      [
        { text: '🛑 Stop', callback_data: 'chat_stop' },
        { text: '⏭️ Next', callback_data: 'chat_next' }
      ],
      [
        { text: '🎯 Filter Gender', callback_data: 'change_target' },
        { text: '📍 Filter Lokasi', callback_data: 'change_location' }
      ],
      [
        { text: '🎁 Kirim Gift', callback_data: 'open_gift_menu' }
      ]
    ]
  });

  // 1. Ambil Gender Kedua User (Single Optimized Query)
  // Menggunakan .in() jauh lebih hemat daripada 2 query terpisah
  let genderUser1 = 'cowok';
  let genderUser2 = 'cowok';

  try {
      const { data: usersData } = await supabase
        .from('telegram_users')
        .select('id, gender')
        .in('id', [user1Id, user2Id]);

      if (usersData) {
          const u1 = usersData.find((u: any) => u.id === user1Id);
          const u2 = usersData.find((u: any) => u.id === user2Id);
          if (u1?.gender) genderUser1 = u1.gender;
          if (u2?.gender) genderUser2 = u2.gender;
      }
  } catch (e) {
      console.error('Failed fetching gender for pairing msg', e);
  }

  // 2. Pilih Pesan Sesuai Gender
  const warningUser1 = getMessageByGender(genderUser1);
  const warningUser2 = getMessageByGender(genderUser2);

  // Send notifications in parallel
  await Promise.all([
    sendTelegramMessage(
      botToken, 
      user1Id, 
      // `✅ <b>Partner ditemukan!</b> Mulai ngobrol sekarang.\n\nHarap sopan dan patuhi aturan.`,
      `✅ <b>Partner ditemukan!</b> Mulai ngobrol sekarang.\n\n<i>"${warningUser1}"</i>`,
      buildChatKeyboard(user1IsPremium)
    ),
    sendTelegramMessage(
      botToken, 
      user2Id, 
      // `✅ <b>Partner ditemukan!</b> Mulai ngobrol sekarang.\n\nHarap sopan dan patuhi aturan.`,
      `✅ <b>Partner ditemukan!</b> Mulai ngobrol sekarang.\n\n<i>"${warningUser2}"</i>`,
      buildChatKeyboard(user2IsPremium)
    )
  ]);
}

// LEGACY: Keep old function name as alias for backward compatibility
async function searchPartnerWithQueueCheck(supabase: any, botToken: string, userId: number): Promise<void> {
  return autoSearchPartner(supabase, botToken, userId);
}

// Helper: Build target gender keyboard or premium offer based on user status
async function buildTargetGenderKeyboard(supabase: any, userId: number): Promise<{ keyboard: any; extraText: string; isPremium: boolean }> {
  const { data: userData } = await supabase
    .from('telegram_users')
    .select('premium_until, target_gender, target_location')
    .eq('id', userId)
    .single();

  const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

  if (isPremium) {
    const currentTarget = userData?.target_gender 
      ? (userData.target_gender === 'cowok' ? 'Cowok 👦' : userData.target_gender === 'cewek' ? 'Cewek 👧' : 'Semua 👥') 
      : 'Semua 👥';

    return {
      keyboard: {
        inline_keyboard: [
          [
            { text: '👦 Cowok', callback_data: 'target_cowok' },
            { text: '👧 Cewek', callback_data: 'target_cewek' },
            { text: '👥 Semua', callback_data: 'target_semua' }
          ]
        ]
      },
      extraText: `\n\n🎯 <b>Ubah Target Gender</b> (saat ini: ${currentTarget})`,
      isPremium: true
    };
  } else {
    return {
      keyboard: {
        inline_keyboard: [
          [
            { text: '🎯 Filter Gender', callback_data: 'show_target_premium' }
          ]
        ]
      },
      extraText: '',
      isPremium: false
    };
  }
}

// Helper: Show premium offer for location filter (non-premium users)
async function showLocationFilterPremiumOffer(supabase: any, botToken: string, userId: number) {
  await sendPremiumOffer(supabase, botToken, userId, 'filter_lokasi');
}

// Daftar lokasi Indonesia
const LOCATION_LIST = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Kepulauan Riau',
  'Jambi', 'Sumatera Selatan', 'Bangka Belitung', 'Bengkulu', 'Lampung',
  'DKI Jakarta', 'Banten', 'Jawa Barat', 'Jawa Tengah', 'DI Yogyakarta', 'Jawa Timur',
  'Bali', 'NTB', 'NTT',
  'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara',
  'Sulawesi Utara', 'Gorontalo', 'Sulawesi Tengah', 'Sulawesi Barat', 'Sulawesi Selatan', 'Sulawesi Tenggara',
  'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Selatan', 'Papua Tengah', 'Lainnya'
];

// Helper: Show premium offer for target gender (non-premium users)
async function showTargetGenderPremiumOffer(supabase: any, botToken: string, userId: number) {
  await sendPremiumOffer(supabase, botToken, userId, 'pilih target gender');
}

// LEGACY: pairUsers - sekarang menggunakan RPC, fungsi ini hanya untuk backward compatibility

// Helper: Kirim promo yang status 'waiting_idle' ke user tertentu saat kembali idle
// Helper: Send promo to single user (optimized) - MUST be defined before sendPendingPromoToUser
async function sendPromoToUser(
  botToken: string, 
  targetUserId: number, 
  messageText: string, 
  photoUrl: string | null, 
  promoButtons: any
): Promise<{ success: boolean; messageId?: number; blocked?: boolean }> {
  try {
    let result;
    if (photoUrl) {
      const response = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetUserId,
          photo: photoUrl,
          caption: messageText,
          parse_mode: 'HTML',
          reply_markup: promoButtons
        })
      });
      result = await response.json();
      
      // Fallback to text if photo fails
      if (!result.ok && !result.description?.includes('blocked')) {
        const fallbackResp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetUserId,
            text: messageText,
            parse_mode: 'HTML',
            reply_markup: promoButtons
          })
        });
        result = await fallbackResp.json();
      }
    } else {
      const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetUserId,
          text: messageText,
          parse_mode: 'HTML',
          reply_markup: promoButtons
        })
      });
      result = await response.json();
    }

    if (result.ok) {
      return { success: true, messageId: result.result.message_id };
    }
    
    const desc = result.description?.toLowerCase() || '';
    const isBlocked = desc.includes('blocked') || desc.includes('initiate') || desc.includes('deactivated');
    return { success: false, blocked: isBlocked };
  } catch (e) {
    console.error(`Error sending to ${targetUserId}:`, e);
    return { success: false };
  }
}

// Helper Global untuk memvalidasi kadaluarsa promo (maks 1 jam, khusus paket promo diskon)
async function validatePromoExpiration(supabase: any, userId: number, configKey: string): Promise<boolean> {
  // Paket normal tidak akan kadaluarsa
  if (configKey.startsWith('n')) return true;

  const { data: promoData } = await supabase
    .from('telegram_users')
    .select('last_promo_sent_at')
    .eq('id', userId)
    .single();

  if (!promoData || !promoData.last_promo_sent_at) return false;

  let dbTimeStr = promoData.last_promo_sent_at;
  if (dbTimeStr.endsWith('Z')) {
    dbTimeStr = dbTimeStr.slice(0, -1) + '+07:00';
  } else if (dbTimeStr.includes('+00:00')) {
    dbTimeStr = dbTimeStr.replace('+00:00', '+07:00');
  } else if (!dbTimeStr.includes('+')) {
    dbTimeStr = dbTimeStr + '+07:00';
  }

  const lastPromoTimeMs = new Date(dbTimeStr).getTime();
  const currentTimeMs = Date.now();
  const ageHours = (currentTimeMs - lastPromoTimeMs) / (1000 * 60 * 60);

  return ageHours <= 1;
}

// Helper Global untuk mengirim promo agar sinkron di semua fitur
async function executePromoAction(supabase: any, botToken: string, userId: number) {
  
  // 1. LOGIKA PEMILIHAN GAMBAR ACAK (Zero Cost & Fast)
  let selectedPromoFileId: string | null = null;

  if (PROMO_FILEID_LIST && PROMO_FILEID_LIST.length > 0) {
    // Pilih satu secara acak dari list konstanta (Sangat Cepat)
    const randomIndex = Math.floor(Math.random() * PROMO_FILEID_LIST.length);
    selectedPromoFileId = PROMO_FILEID_LIST[randomIndex];
  } else {
    // Fallback: Jika list kosong, ambil dari setting database (agar Admin tetap punya kontrol via /set_promo)
    selectedPromoFileId = await getPromoPremiumFileId(supabase);
  }

  const promoMessage = `🚨 <b>PROMO TERBATAS! HANYA 1 JAM!</b> 🚨

⏰ <b>Berakhir dalam 1 jam dari sekarang!</b> - Jangan sampai kelewatan!

🎁 <b>PENAWARAN EKSKLUSIF:</b>
━━━━━━━━━━━━━━━━━━━━
📦 <b>PREMIUM 30 HARI</b>
<s>Rp 60.000</s> → <b>HANYA Rp 28.000!</b>
━━━━━━━━━━━━━━━━━━━━
💥 <b>HEMAT 53%!</b>`;

  const promoKeyboard = {
    inline_keyboard: [
      [{ text: '🔥 30 Hari / 𝑅̶𝑝̶6̶0̶.̶0̶0̶0̶ ➡️ Rp 28.000', callback_data: 'buy_premium_30' }],
      [{ text: '📦 7 Hari / 𝑅̶𝑝̶2̶5̶.̶0̶0̶0̶ ➡️ Rp 19.000', callback_data: 'buy_premium_7' }],
      [{ text: '💎 35 Hari / Rp 30.000', callback_data: 'buy_premium_35' }],
      [{ text: '📅 3 Hari / Rp 10.000', callback_data: 'buy_premium_3' }],
      [{ text: '⚡ 1 Hari / Rp 5.000', callback_data: 'buy_premium_1' }],
      [{ text: '⏭️ Abaikan & Lanjut Cari Partner', callback_data: 'dismiss_promo_search' }]
    ]
  };

  // Kirim menggunakan File ID yang terpilih
  return await sendPromoToUser(botToken, userId, promoMessage, selectedPromoFileId, promoKeyboard);
}

// NOTE: buildEndChatKeyboard sudah didefinisikan di atas (line ~811)

// Interface untuk hasil RPC end_chat_comprehensive
interface EndChatResult {
  success: boolean;
  error?: string;
  partner_id: number | null;
  partner_reset?: boolean;
  user_promo?: { should_send: boolean };
  partner_promo?: { should_send: boolean };
  reconnect_notification?: {
    request_id: string;
    requester_id: number;
    requester_message_id: number | null;
  } | null;
}

async function endChat(supabase: any, botToken: string, userId: number): Promise<boolean> {
  
  
  // SATU PANGGILAN RPC - handles semua operasi end chat!
  const { data, error } = await supabase.rpc('end_chat_comprehensive', {
    p_user_id: userId
  });
  
  if (error) {
    return false;
  }
  
  const result = data as EndChatResult;
  
  if (!result.success) {
    return false;
  }
  
  const partnerId = result.partner_id!;
  
  
  
  // Kirim notifikasi ke partner jika berhasil di-reset
  if (result.partner_reset) {
    
    const combinedPartnerKeyboard = buildEndChatKeyboard(userId);
    await sendTelegramMessage(
      botToken, 
      partnerId, 
      `⚠️ Partner mengakhiri chat.\n\n✨ Bagaimana pengalaman chat kamu? Beri penilaian untuk partner!`,
      combinedPartnerKeyboard
    );
  }
  
  // Kirim notifikasi ke user yang mengakhiri
  const endChatKeyboard = buildEndChatKeyboard(partnerId);
  await sendTelegramMessage(
    botToken, 
    userId, 
    `👋 Anda mengakhiri chat.\n\n✨ Bagaimana pengalaman chat kamu? Beri penilaian untuk partner!`,
    endChatKeyboard
  );
  
  // Kirim promo ke user jika syarat terpenuhi (dari RPC)
  if (result.user_promo?.should_send) {
    await executePromoAction(supabase, botToken, userId);
  }
  
  // Kirim promo ke partner jika syarat terpenuhi (dari RPC)
  if (result.partner_promo?.should_send) {
    await executePromoAction(supabase, botToken, partnerId);
  }


  
 // === LOGIKA BARU: CEK PENDING RECONNECT ===
  // SCENARIO C: Partner (User ini) selesai chat, dan ada yang menunggu (Requester)
  if (result.reconnect_notification) {
      const notif = result.reconnect_notification;
      
      // 1. Kirim Notifikasi ke User ini (Target)
      const acceptKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Terima', callback_data: `accept_reconnect_${notif.request_id}` },
                    { text: '❌ Tolak', callback_data: `reject_reconnect_${notif.request_id}` }
                ]
            ]
        };
       
       // Delay sedikit agar tidak bertumpuk dengan pesan "Chat Ended"
       setTimeout(async () => {
           await sendTelegramMessage(
                botToken,
                userId, // Target (User yang baru selesai chat)
                `📞 <b>PANGGILAN TERTUNDA!</b>\n\nPartner sebelumnya (${notif.requester_id}) ingin ngobrol lagi. Terima?`,
                acceptKeyboard
            );
       }, 1000);

      // 2. Edit Pesan di Sisi Penelpon (Requester)
      // Memberitahu bahwa notifikasi SUDAH dikirim ke target (karena target sudah free)
      if (notif.requester_message_id) {
          try {
              await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: notif.requester_id,
                    message_id: notif.requester_message_id,
                    text: `🔔 <b>Partner Online!</b>\n\nPartner telah menyelesaikan chat mereka. Notifikasi panggilan telah dikirim. Menunggu jawaban...`,
                    parse_mode: 'HTML'
                })
            });
          } catch (e) {
              console.error('Failed to update requester message:', e);
          }
      }
  }

  return true;
}



Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN not configured');
      return new Response('Bot token not configured', { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);


    // === ROUTING LOGIC BARU ===
    // Cek URL parameter untuk menentukan tugas: Bot Telegram atau Background Job
    const url = new URL(req.url);
    const target = url.searchParams.get('target');

    
    // Baca body dengan error handling
    let update: TelegramUpdate;
    try {
      const text = await req.text();
      
      if (!text || text.trim() === '') {
        return new Response('OK', { status: 200 });
      }
      
      update = JSON.parse(text);
    } catch (parseError) {
      return new Response('Invalid JSON', { status: 400 });
    }
    
    
    // === Handle my_chat_member: deteksi user block/unblock bot ===
    if (update.my_chat_member) {
      const myChatMember = update.my_chat_member;
      const memberId = myChatMember.from.id;
      const newStatus = myChatMember.new_chat_member.status;
      const chatType = myChatMember.chat.type;

      // Hanya proses event dari private chat (bot <-> user langsung)
      if (chatType === 'private') {
        if (newStatus === 'kicked') {
          // === USER MEMBLOKIR BOT ===
          console.log(`[MY_CHAT_MEMBER] User ${memberId} BLOCKED the bot`);

          // 1. Set last_reengagement_sent_at ke 2099 agar tidak ditarget re-engagement
          const { error: blockError } = await supabase
            .from('telegram_users')
            .update({ last_reengagement_sent_at: '2099-12-31T00:00:00+00:00' })
            .eq('id', memberId);

          if (blockError) {
            console.error(`[MY_CHAT_MEMBER] DB update error for blocked user ${memberId}:`, blockError.message);
          } else {
            console.log(`[MY_CHAT_MEMBER] User ${memberId} marked as blocked (last_reengagement_sent_at = 2099)`);
          }

          // 2. Akhiri chat jika user sedang chatting agar partner tidak menunggu
          try {
            await endChat(supabase, botToken, memberId);
            console.log(`[MY_CHAT_MEMBER] endChat called for blocked user ${memberId}`);
          } catch (endChatErr) {
            // endChat bisa gagal jika user tidak sedang chatting, abaikan saja
            console.log(`[MY_CHAT_MEMBER] endChat for ${memberId} - no active chat or error:`, endChatErr);
          }

        } else if (newStatus === 'member') {
          // === USER MEMBUKA BLOKIR BOT ===
          console.log(`[MY_CHAT_MEMBER] User ${memberId} UNBLOCKED the bot`);

          // Set last_reengagement_sent_at ke hari ini → re-engagement dikirim 7 hari kemudian
          const { error: unblockError } = await supabase
            .from('telegram_users')
            .update({ last_reengagement_sent_at: new Date().toISOString() })
            .eq('id', memberId);

          if (unblockError) {
            console.error(`[MY_CHAT_MEMBER] DB update error for unblocked user ${memberId}:`, unblockError.message);
          } else {
            console.log(`[MY_CHAT_MEMBER] User ${memberId} unblocked, last_reengagement_sent_at reset to now`);
          }
        }
      }

      return new Response('OK', { status: 200 });
    }

    // Tangkap event saat user join/leave channel @FizaTalkCh SAJA
    if (update.chat_member) {
      const chatUsername = update.chat_member.chat.username;
      
      // Filter: hanya proses event dari channel @FizaTalkCh
      if (chatUsername !== 'FizaTalkCh') {
        console.log(`[CHAT_MEMBER] Ignored - channel @${chatUsername} bukan @FizaTalkCh`);
        return new Response('OK', { status: 200 });
      }
      
      const memberId = update.chat_member.new_chat_member.user.id;
      const newStatus = update.chat_member.new_chat_member.status;
      
      // Jika statusnya member/admin/creator, set true. Jika left/kicked, set false.
      const isNowMember = ['member', 'administrator', 'creator'].includes(newStatus);

      console.log(`[CHAT_MEMBER] @FizaTalkCh - User ${memberId} -> ${newStatus} (member: ${isNowMember})`);

      // Update DB dengan await agar query benar-benar dieksekusi
      const { error: memberError } = await supabase
        .from('telegram_users')
        .update({ is_channel_member: isNowMember })
        .eq('id', memberId);
      
      if (memberError) {
        console.error(`[CHAT_MEMBER] DB update error for user ${memberId}:`, memberError.message);
      } else {
        console.log(`[CHAT_MEMBER] DB updated: user ${memberId} is_channel_member = ${isNowMember}`);
      }
      
      return new Response('OK', { status: 200 });
    }
    // Handle pre_checkout_query (Telegram Stars)
    if (update.pre_checkout_query) {
      const pcq = update.pre_checkout_query;
      console.log(`[STARS] pre_checkout_query from ${pcq.from.id}: ${pcq.invoice_payload}`);
      await fetch(`${TELEGRAM_API}${botToken}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre_checkout_query_id: pcq.id, ok: true })
      });
      return new Response('OK', { status: 200 });
    }

    // Handle callback queries (emoji rating & NEW: cancel topup)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const callbackData = query.data || '';
      const message = query.message;

      // ============================================
      // STEP 1: DEBOUNCE CHECK - PALING AWAL!
      // ============================================
      // Cek debounce SEBELUM operasi apapun (termasuk database)
      // Ini mencegah double-click bahkan saat Edge Function restart
      const actionType = getActionTypeFromCallback(callbackData);
      if (isButtonOnCooldown(userId, actionType)) {
        // Langsung jawab callback dan return - NO DATABASE OPERATIONS
        await answerCallbackQuery(botToken, query.id, '⏳ Mohon tunggu sebentar...', false);
        return new Response('OK', { status: 200 });
      }

      // ============================================
      // STEP 1.5: PROMO EXPIRATION CHECK (Dual Validation)
      // ============================================
      // Validasi ganda: Telegram message.date + Database last_promo_sent_at
      // Tombol promo tetap aktif selama 1 jam (fleksibel berganti pilihan paket)
      // Tombol yang tertinggal (>1 jam) otomatis kedaluwarsa & dihapus
      const LIMITED_TIME_PROMOS = [
        'buy_premium_30',
        'buy_premium_35',
        'buy_premium_7',
        'buy_premium_3',
        'buy_premium_1'
      ];

      const isLimitedPromoCallback = LIMITED_TIME_PROMOS.includes(callbackData) || 
        (callbackData.startsWith('prem_pay_') && ['30', '35', '7', '3', '1'].includes(callbackData.split('_')[2]));

      if (isLimitedPromoCallback) {
        let promoExpired = false;

        // CHECK 1: Telegram message.date (read-only, 100% akurat)
        const messageDate = (message as any)?.date; 
        if (messageDate) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          const diffSeconds = nowSeconds - messageDate;
          const ONE_HOUR = 3600; // 3600 detik

          // Jika umur pesan lebih dari 1 jam (tambah buffer 60 detik untuk toleransi delay jaringan)
          if (diffSeconds > (ONE_HOUR + 60)) {
            promoExpired = true;
          }
        }

        // CHECK 2: Database last_promo_sent_at (anti abuse pesan tertinggal)
        if (!promoExpired) {
          const { data: promoUserData } = await supabase
            .from('telegram_users')
            .select('last_promo_sent_at')
            .eq('id', userId)
            .single();
          
          if (promoUserData) {
            const lastPromoSent = promoUserData.last_promo_sent_at;
            if (!lastPromoSent) {
              // last_promo_sent_at NULL = belum pernah dapat promo, atau data tidak konsisten
              // Pesan ini seharusnya tidak ada jika belum pernah dapat promo -> kedaluwarsa
              promoExpired = true;
            } else {
              // FIX TIMEZONE: Supabase mengembalikan format timestamp without timezone
              // yang sebenarnya adalah waktu Jakarta. Kita perlu memaksanya dibaca sebagai UTC+7.
              let dateStr = lastPromoSent;
              if (dateStr.endsWith('Z')) dateStr = dateStr.slice(0, -1);
              if (!dateStr.includes('+')) dateStr += '+07:00';
              
              const promoSentTime = new Date(dateStr).getTime();
              const nowMs = Date.now();
              const diffMs = nowMs - promoSentTime;
              const ONE_HOUR_MS = 3600 * 1000 + 60 * 1000; // 1 jam + 60 detik buffer
              
              if (diffMs > ONE_HOUR_MS) {
                promoExpired = true;
              }
            }
          }
        }

        // TINDAKAN: Jika promo kedaluwarsa dari salah satu pemeriksaan
        if (promoExpired) {
          // 1. Beritahu user via Alert (Pop-up)
          await answerCallbackQuery(
            botToken, 
            query.id, 
            '⏳ Yah, telat!\n\nMasa promo 1 JAM sudah berakhir. Tunggu penawaran spesial berikutnya ya! 👋', 
            true // true = Tampilkan sebagai alert window, bukan toast
          );

          // 2. Hapus pesan promo yang sudah kadaluarsa (Cleanup UI)
          if (message) {
            await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
          }

          // 3. Stop proses, jangan lanjutkan ke logic database/pembayaran
          return new Response('OK', { status: 200 });
        }
      }

      // ============================================
      // STEP 2: ACKNOWLEDGE CALLBACK SEGERA
      // ============================================
      // Untuk action tertentu yang berat, acknowledge dulu untuk mencegah Telegram resend
      // Ini juga menghilangkan "loading" indicator di tombol
      const heavyActions = ['search_partner', 'chat_next', 'chat_stop', 'send_gift', 'init_topup', 'buy_premium', 'reconnect'];
      if (heavyActions.includes(actionType)) {
        // Don't await - fire and forget untuk kecepatan
        answerCallbackQuery(botToken, query.id);
      }

      // ============================================
      // STEP 3: CEK STATE AWAITING_PAYMENT (LEGACY - hanya peringatkan, tidak blokir)
      // Pembayaran via Sakurupiah berjalan async, user tetap bisa berinteraksi
      // ============================================
      // (awaiting_payment check DIHAPUS - pembayaran otomatis via callback)

      // --- LOGIKA PEMBATALAN SEMUA TRANSAKSI (UNIFIED & OPTIMIZED) ---
      const paymentAllowedCallbacks = ['cancel_topup', 'cancel_premium', 'cancel_fine'];
      if (paymentAllowedCallbacks.includes(callbackData)) {
          await answerCallbackQuery(botToken, query.id, '🔄 Kembali ke menu...');

          // Eksekusi RPC pembatalan secara paralel (Cepat & hemat)
          await Promise.all([
              supabase.rpc('cancel_topup_transaction', { p_user_id: userId }),
              supabase.rpc('cancel_premium_transaction', { p_user_id: userId }),
              supabase.rpc('cancel_fine_transaction', { p_user_id: userId })
          ]).catch(e => console.error('[CANCEL ERROR]', e));

          // 1. Tentukan Pesan & Keyboard tujuan (Back Navigation)
          let backText = '';
          let backKeyboard: any = undefined;

          if (callbackData === 'cancel_topup') {
              const { data: userData } = await supabase.from('telegram_users').select('coins').eq('id', userId).single();
              const balance = userData?.coins || 0;
              backText = `➕ <b>Top Up Saldo Koin</b>\n\n💰 Saldo saat ini: <b>${balance} koin</b>\n\nSilakan pilih nominal top up (100 koin = Rp 1.000):`;
              backKeyboard = buildTopupKeyboard();
              
          } else if (callbackData === 'cancel_premium') {
              // Kembali ke penawaran premium
              backText = `💎 <b>Upgrade ke Premium</b>\n\n✨ <b>KEUNTUNGAN PREMIUM:</b>\n• 🎯 Pilih target gender chat\n• 📍 Pilih target lokasi chat\n• ⭐ Badge Premium\n• 🚀 Prioritas matching\n\n💰 <b>HARGA PREMIUM:</b>\n📦 <b>1 MINGGU:</b> Rp 25.000\n📦 <b>1 BULAN:</b> Rp 60.000\n\nPilih paket di bawah ini:`;
              backKeyboard = buildPremiumNormalKeyboard();
              
          } else if (callbackData === 'cancel_fine') {
              // Kembali ke halaman peringatan blokir
              backText = `🚫 <b>AKUN ANDA DIBLOKIR</b>\n\n⚠️ Akses chat Anda dinonaktifkan karena pelanggaran.\n\n🔓 <b>CARA MEMBUKA BLOKIR:</b>\n\n1️⃣ <b>Bayar Denda Pelanggaran</b>\nBayar denda sebesar <b>Rp 10.000</b>.`;
              backKeyboard = { inline_keyboard: [[{ text: '💸 Bayar Denda - Rp 10.000', callback_data: 'pay_fine' }]] };
          }

          // 2. Eksekusi Pengubahan UI
          if (message) {
              if ((message as any).photo) {
                  // Fallback: Jika UI sebelumnya adalah QRIS (Foto), API Telegram tidak bisa mengedit tipe pesannya menjadi teks.
                  // Terpaksa gunakan Delete -> Send
                  await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
                  await sendTelegramMessage(botToken, userId, backText, backKeyboard);
              } else {
                  // Mode Hemat Biaya & Fast UI: Edit teks langsung
                  try {
                      await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              chat_id: message.chat.id,
                              message_id: message.message_id,
                              text: backText,
                              parse_mode: 'HTML',
                              reply_markup: backKeyboard
                          })
                      });
                  } catch (e) {
                      console.error('[EDIT UI ERROR]', e);
                  }
              }
          } else {
              // Fallback jika objek message hilang
              await sendTelegramMessage(botToken, userId, backText, backKeyboard);
          }

          return new Response('OK', { status: 200 });
      }

      // >>> ROUTE PENANGANAN SPAM <<<
      if (callbackData.startsWith('reportspam_')) {
        if (isButtonOnCooldown(userId, 'report_user')) return new Response('OK');
        const spammerId = parseInt(callbackData.split('_')[1]);
        const adminChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
        
        await answerCallbackQuery(botToken, query.id, 'Laporan diteruskan ke Admin. Terima kasih!', true);
        
        // Hapus tombol spam dari pesan agar partner tidak double-klik
        if (message) {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageReplyMarkup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: userId,
                    message_id: message.message_id,
                    reply_markup: { inline_keyboard: [] }
                })
            });
        }

        // Notifikasi ke CS / Admin
        if (adminChatId) {
            const adminMsg = `🚨 <b>LAPORAN SPAM/LINK</b>\n\nTerlapor ID: <code>${spammerId}</code>\nPelapor ID: <code>${userId}</code>\n\nPilih tindakan (Bukti pesan di bawah):`;
            const adminKb = {
                inline_keyboard: [
                    [
                        { text: '⚠️ Beri Peringatan', callback_data: `admin_warn_${spammerId}` },
                        { text: '🚫 Blokir Langsung', callback_data: `admin_block_${spammerId}` }
                    ]
                ]
            };
            await sendTelegramMessage(botToken, parseInt(adminChatId), adminMsg, adminKb);
            
            if (message) {
              await copyTelegramMessage(botToken, parseInt(adminChatId), userId, message.message_id);
            }
        }
        return new Response('OK');
      }

      // Eksekusi Peringatan
      if (callbackData.startsWith('admin_warn_')) {
        const targetId = parseInt(callbackData.split('_')[2]);
        await handleAdminSpamAction(supabase, botToken, targetId, 'warn', message, userId);
        await answerCallbackQuery(botToken, query.id, 'Peringatan berhasil diberikan.');
        return new Response('OK');
      }

      

      // Menangkap callback 'ap_' (Allow Pack) dan 'dp_' (Deny Pack)
      if (callbackData.startsWith('ap_')) {
        const packId = callbackData.replace('ap_', '');
        const adminChatId = query.message!.chat.id;
        const messageId = query.message!.message_id;
        const originalText = (query.message as any)?.text || '';

        // 1. Loading UI - Edit pesan agar tidak ditekan admin berulang kali
        await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: adminChatId,
                message_id: messageId,
                text: originalText + `\n\n⏳ <b>Sedang diproses... Mengkloning stiker...</b>`,
                parse_mode: 'HTML'
            })
        });

        const { data: pack } = await supabase.from('sticker_packs').select('*').eq('id', packId).single();
        
        if (pack && pack.status === 'pending') {
          // 💡 Environment variable ini perlu Anda set di dashboard Supabase Anda
          const OWNER_ID = parseInt(Deno.env.get('STICKER_OWNER_ID') || '0'); 
          const BOT_USERNAME = Deno.env.get('BOT_USERNAME') || 'FizaTalkBot';

          if (!OWNER_ID) {
            await sendTelegramMessage(botToken, adminChatId, `❌ Gagal: Env variabel STICKER_OWNER_ID belum diset! (Dibutuhkan ID telegram admin pribadi).`);
            return new Response('OK');
          }

          // 2. Mulai eksekusi Kloning
          const cloneResult = await cloneStickerPack(botToken, pack.pack_name, BOT_USERNAME, OWNER_ID);
          
          if (cloneResult.packName) {
            const newPackName = cloneResult.packName;
            
            // 3. Update Database & In-Memory Cache
            await supabase.from('sticker_packs')
              .update({ status: 'approved', fiza_pack_name: newPackName })
              .eq('id', packId);
            
            stickerPackCache.set(pack.pack_name, { status: 'approved', fiza_pack_name: newPackName });

            // 4. Beri feedback visual ke Admin
            await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  chat_id: adminChatId,
                  message_id: messageId,
                  text: originalText + `\n\n✅ <b>BERHASIL KLONING!</b>\nStiker diclone ke: <code>${newPackName}</code>`,
                  parse_mode: 'HTML'
              })
            });

            // 5. Beritahu kembali user yang pertama kali request
            if (pack.requester_id) {
              await sendTelegramMessage(
                  botToken, 
                  pack.requester_id, 
                  `🎉 <b>Stiker yang kamu ajukan telah disetujui!</b>\n\nKami telah membuat versi resmi FizaTalk. Silakan tambahkan dan gunakan pack ini untuk dikirim ke partner:\n👉 https://t.me/addstickers/${newPackName}`
              );
            }
          } else {
            // PERBAIKAN: Tampilkan error asli dari Telegram di chat admin
            await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  chat_id: adminChatId,
                  message_id: messageId,
                  text: originalText + `\n\n❌ <b>GAGAL KLONING.</b>\nAlasan: <code>${cloneResult.errorMsg}</code>`,
                  parse_mode: 'HTML'
              })
            });
          }
        }
      }

      // Handler 'dp_' (Deny/Tolak Pack)
      if (callbackData.startsWith('dp_')) {
        const packId = callbackData.replace('dp_', '');
        const adminChatId = query.message!.chat.id;
        const messageId = query.message!.message_id;
        const originalText = (query.message as any)?.text || '';

        const { data: pack } = await supabase.from('sticker_packs').select('*').eq('id', packId).single();

        if (pack && pack.status === 'pending') {
          // Update status ke rejected
          await supabase.from('sticker_packs')
            .update({ status: 'rejected' })
            .eq('id', packId);

          // Update cache
          stickerPackCache.set(pack.pack_name, { status: 'rejected', fiza_pack_name: null });

          // Edit pesan admin
          await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: adminChatId,
              message_id: messageId,
              text: originalText + `\n\n❌ <b>DITOLAK.</b> Pack ini tidak akan bisa digunakan.`,
              parse_mode: 'HTML'
            })
          });

        } else {
          await answerCallbackQuery(botToken, query.id, '⚠️ Pack sudah diproses sebelumnya.');
        }

        await answerCallbackQuery(botToken, query.id);
        return new Response('OK');
      }

      // --- HANDLER CS APPROVE/REJECT QRIS MANUAL ---
      if (callbackData.startsWith('cs_approve_') || callbackData.startsWith('cs_reject_')) {
        const isApprove = callbackData.startsWith('cs_approve_');
        const parts = callbackData.replace(isApprove ? 'cs_approve_' : 'cs_reject_', '').split('_');
        const txType = parts[0] as 'prem' | 'topup' | 'fine';
        const txId = parts.slice(1).join('_'); // UUID bisa mengandung underscore? Tidak, tapi join untuk safety

        await answerCallbackQuery(botToken, query.id, isApprove ? '✅ Memproses...' : '❌ Menolak...');
        await handleCSApproveReject(supabase, botToken, isApprove ? 'approve' : 'reject', txType, txId, message, userId);
        return new Response('OK', { status: 200 });
      }

      // Eksekusi Blokir
      if (callbackData.startsWith('admin_block_')) {
        const targetId = parseInt(callbackData.split('_')[2]);
        await handleAdminSpamAction(supabase, botToken, targetId, 'block', message, userId);
        await answerCallbackQuery(botToken, query.id, 'User telah diblokir.');
        return new Response('OK');
      }


      // MEDIA REPORT LOGIC
      if (callbackData.startsWith('reportm_')) {
        const senderId = callbackData.split('_')[1];
        
        // 1. Delete message from partner
        await fetch(`${TELEGRAM_API}${botToken}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: userId, message_id: query.message.message_id })
        });
        
        await answerCallbackQuery(botToken, query.id, '✅ Media berhasil dihapus dan dilaporkan ke Admin.', true);
        
        // 2. Extract file_id from query.message
        let fileId = '';
        let mediaEndpoint = '';
        let mediaField = '';
        
        if (query.message.photo) {
            mediaEndpoint = 'sendPhoto';
            mediaField = 'photo';
            fileId = query.message.photo[query.message.photo.length - 1].file_id;
        } else if (query.message.video) {
            mediaEndpoint = 'sendVideo';
            mediaField = 'video';
            fileId = query.message.video.file_id;
        } else if (query.message.animation) {
            mediaEndpoint = 'sendAnimation';
            mediaField = 'animation';
            fileId = query.message.animation.file_id;
        } else if (query.message.video_note) {
            mediaEndpoint = 'sendVideoNote';
            mediaField = 'video_note';
            fileId = query.message.video_note.file_id;
        }
        
        // 3. Send to Admin
        const adminChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
        if (adminChatId && fileId) {
            const adminKeyboard = {
                inline_keyboard: [
                    [{ text: '⚠️ Beri Peringatan', callback_data: `admin_warnm_${senderId}` }],
                    [{ text: '🚫 Blokir User', callback_data: `admin_blockm_${senderId}` }]
                ]
            };
            
            const payload: any = {
                chat_id: adminChatId,
                [mediaField]: fileId,
                reply_markup: adminKeyboard
            };
            
            if (mediaField !== 'video_note') {
                payload.caption = `⚠️ <b>LAPORAN MEDIA</b>\n\nPengirim: <code>${senderId}</code>\nMedia ini dilaporkan oleh partner.`;
                payload.parse_mode = 'HTML';
            } else {
                await sendTelegramMessage(botToken, parseInt(adminChatId), `⚠️ <b>LAPORAN VIDEO NOTE</b>\nPengirim: <code>${senderId}</code>\nDi bawah ini adalah video bulat yang dilaporkan.`);
            }
            
            await fetch(`${TELEGRAM_API}${botToken}/${mediaEndpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        return new Response('OK', { status: 200 });
      }

      if (callbackData.startsWith('admin_warnm_') || callbackData.startsWith('admin_blockm_')) {
        const action = callbackData.startsWith('admin_warnm_') ? 'warn' : 'block';
        const senderId = callbackData.split('_')[2];
        
        let fileId = '';
        let mediaEndpoint = '';
        let mediaField = '';
        
        if (query.message.photo) {
            mediaEndpoint = 'sendPhoto';
            mediaField = 'photo';
            fileId = query.message.photo[query.message.photo.length - 1].file_id;
        } else if (query.message.video) {
            mediaEndpoint = 'sendVideo';
            mediaField = 'video';
            fileId = query.message.video.file_id;
        } else if (query.message.animation) {
            mediaEndpoint = 'sendAnimation';
            mediaField = 'animation';
            fileId = query.message.animation.file_id;
        } else if (query.message.video_note) {
            mediaEndpoint = 'sendVideoNote';
            mediaField = 'video_note';
            fileId = query.message.video_note.file_id;
        }
        
        const { data, error } = await supabase.rpc('admin_process_media_report', {
            p_sender_id: parseInt(senderId),
            p_action: action
        });
        
        if (data?.error === 'user_is_premium') {
            const premMsg = `✅ User ${senderId} adalah pengguna Premium dan kebal dari aksi.`;
            if (mediaField !== 'video_note') {
                await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
                        caption: premMsg,
                        reply_markup: { inline_keyboard: [] }
                    })
                });
            } else {
                await sendTelegramMessage(botToken, query.message.chat.id, premMsg);
            }
            await answerCallbackQuery(botToken, query.id, 'User Premium kebal dari blokir.', false);
            return new Response('OK', { status: 200 });
        }
        
        if (fileId) {
            const payload: any = {
                chat_id: senderId,
                [mediaField]: fileId
            };
            
            if (action === 'warn') {
                payload.reply_markup = {
                    inline_keyboard: [[{ text: '💎 Upgrade Premium (Anti Banned)', callback_data: 'buy_premium_normal_7' }]]
                };
                if (mediaField !== 'video_note') {
                    payload.caption = `⚠️ <b>PERINGATAN DARI ADMIN</b>\n\nMedia yang Anda kirim telah dilaporkan dan melanggar aturan komunitas. Harap patuhi aturan atau akun Anda akan diblokir.`;
                    payload.parse_mode = 'HTML';
                } else {
                    await sendTelegramMessage(botToken, parseInt(senderId), `⚠️ <b>PERINGATAN DARI ADMIN</b>\nVideo Note yang Anda kirim melanggar aturan komunitas.`, payload.reply_markup);
                }
            } else {
                payload.reply_markup = {
                    inline_keyboard: [[
                        { text: '💸 Bayar Denda', callback_data: 'pay_fine' },
                        { text: '💎 Upgrade Premium (Anti Banned)', callback_data: 'buy_premium_normal_7' }
                    ]]
                };
                if (mediaField !== 'video_note') {
                    payload.caption = `🚫 <b>AKUN DIBLOKIR</b>\n\nAkun Anda telah diblokir otomatis selama 15 hari oleh Admin karena mengirim media terlarang.`;
                    payload.parse_mode = 'HTML';
                } else {
                    await sendTelegramMessage(botToken, parseInt(senderId), `🚫 <b>AKUN DIBLOKIR</b>\nVideo Note yang Anda kirim melanggar aturan.`, payload.reply_markup);
                }
                
                // Disconnect their chat if active
                await supabase.rpc('search_or_next_partner', { p_user_id: parseInt(senderId), p_is_next: true });
            }
            
            await fetch(`${TELEGRAM_API}${botToken}/${mediaEndpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        
        // Remove keyboard and update text for admin
        const newCaption = action === 'warn' ? `✅ Peringatan telah dikirim ke ${senderId}.` : `✅ User ${senderId} telah diblokir.`;
        
        if (mediaField !== 'video_note') {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    caption: newCaption,
                    reply_markup: { inline_keyboard: [] }
                })
            });
        } else {
            // Can't edit video note, just send a message
            await sendTelegramMessage(botToken, query.message.chat.id, newCaption);
        }
        
        await answerCallbackQuery(botToken, query.id, 'Berhasil', false);
        return new Response('OK', { status: 200 });
      }

      if (callbackData.startsWith('reveal_')) {
        // Format data: reveal_SENDERID_MESSAGEID
        const parts = callbackData.split('_');
        const senderId = parseInt(parts[1]);
        const originalMsgId = parseInt(parts[2]);

        if (!senderId || !originalMsgId) {
          await answerCallbackQuery(botToken, query.id, '❌ Error data');
          return new Response('OK', { status: 200 });
        }

        // Feedback UI Loading
        await answerCallbackQuery(botToken, query.id, '🔓 Membuka...');

        try {
          // 1. Copy pesan asli dari Pengirim ke Penerima (User yang klik tombol)
          const copyRes = await fetch(`${TELEGRAM_API}${botToken}/copyMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  chat_id: userId,        // Penerima (yang klik tombol)
                  from_chat_id: senderId, // Pengirim Asli
                  message_id: originalMsgId
              })
          });

          const copyJson = await copyRes.json();

          if (copyJson.ok) {
              // 2. HAPUS pesan sensor (tombol) agar chat bersih
              if (message) {
                  await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
              }
          } else {
              // Jika pesan asli sudah dihapus/kadaluarsa
              await answerCallbackQuery(botToken, query.id, '❌ Media gagal dimuat', true);
              
              // Update tampilan jadi error
              if (message) {
                  await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: message.chat.id,
                      message_id: message.message_id,
                      text: `❌ <b>Gagal Memuat</b>\nMedia asli mungkin sudah dihapus.`,
                      parse_mode: 'HTML'
                    })
                  });
              }
          }
        } catch (e) {
          console.error('Reveal Error:', e);
        }
        return new Response('OK', { status: 200 });
      }
      // --- LOGIKA BAYAR DENDA (BUKA BLOKIR) - SHOW PAYMENT METHOD ---
      if (callbackData === 'pay_fine') {
        await answerCallbackQuery(botToken, query.id);
        if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        
        const FINE_AMOUNT = 10000; // Pastikan sesuai nominal denda
        const fineStarsPrice = calculateStarsPrice(FINE_AMOUNT);
        const fineStarsPayload = JSON.stringify({ t: 'f', u: userId });
        const fineStarsInvoiceLink = await createStarsInvoiceLink(
          botToken,
          'Pembayaran Denda - Buka Blokir',
          `Denda Rp ${FINE_AMOUNT.toLocaleString('id-ID')}`,
          fineStarsPayload,
          fineStarsPrice
        );
        console.log(`[STARS] fine payment button mode: ${fineStarsInvoiceLink ? 'url' : 'callback_fallback'}`);
        
        await sendTelegramMessage(botToken, userId,
          `💸 <b>PEMBAYARAN DENDA - BUKA BLOKIR</b>\n\n💰 Total: <b>Rp ${FINE_AMOUNT.toLocaleString('id-ID')}</b>\n\nPilih metode pembayaran:`,
          buildPaymentMethodKeyboard('fine_pay', 'cancel_fine', FINE_AMOUNT, fineStarsInvoiceLink || undefined)
        );
        return new Response('OK', { status: 200 });
      }

      // --- HANDLER PROSES PEMBAYARAN DENDA VIA SAKURUPIAH/STARS ---
      if (callbackData.startsWith('fine_pay_')) {
        // UBAH BARIS INI:
        const method = callbackData.replace('fine_pay_', '') as 'QRIS' | 'DANA' | 'GOPAY' | 'SHOPEEPAY' | 'OVO' | 'STARS';
        
        if (method === 'STARS') {
          await processStarsFinePayment(botToken, userId, query.id, message);
        } else {
          await processSakurupiahFinePayment(supabase, botToken, userId, method, query.id, message);
        }
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMILIHAN GENDER (DARI /START - PERTAMA KALI) - SATU RPC ---
      if (callbackData === 'gender_cowok' || callbackData === 'gender_cewek') {
        const selectedGender = callbackData === 'gender_cowok' ? 'cowok' : 'cewek';
        
        // Hapus pesan pilihan gender
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // SATU RPC: Update gender dan cek apakah perlu set lokasi
        const { data: genderResult } = await supabase.rpc('update_user_gender', {
          p_user_id: userId,
          p_gender: selectedGender
        });

        await answerCallbackQuery(botToken, query.id, `✅ Gender diset: ${selectedGender === 'cowok' ? 'Cowok 👦' : 'Cewek 👧'}`);

        // Cek dari RPC apakah perlu set lokasi
        if (genderResult?.needs_location) {
          // Buat keyboard lokasi (3 kolom per baris)
          const locationButtons = [];
          for (let i = 0; i < LOCATION_LIST.length; i += 3) {
            const row = [];
            for (let j = 0; j < 3 && i + j < LOCATION_LIST.length; j++) {
              const loc = LOCATION_LIST[i + j];
              row.push({ text: loc, callback_data: `init_loc_${loc}` });
            }
            locationButtons.push(row);
          }

          const locationKeyboard = {
            inline_keyboard: locationButtons
          };

          await sendTelegramMessage(
            botToken,
            userId,
            `✅ Gender: <b>${selectedGender === 'cowok' ? 'Cowok 👦' : 'Cewek 👧'}</b>\n\n📍 <b>Sekarang pilih lokasimu:</b>`,
            locationKeyboard
          );
          return new Response('OK', { status: 200 });
        }

        await autoSearchPartner(supabase, botToken, userId);

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMILIHAN LOKASI AWAL (DARI /START - PERTAMA KALI) - SATU RPC ---
      if (callbackData.startsWith('init_loc_')) {
        const selectedLocation = callbackData.replace('init_loc_', '');
        
        // Hapus pesan pilihan lokasi
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // SATU RPC: Update location user
        await supabase.rpc('update_user_location', {
          p_user_id: userId,
          p_location: selectedLocation
        });

        await answerCallbackQuery(botToken, query.id, `✅ Lokasi diset: ${selectedLocation}`);

        await autoSearchPartner(supabase, botToken, userId);

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA SHOW PREMIUM OFFER (DINAMIS DARI TOMBOL ANTI BANNED / STIKER / PERINGATAN) ---
      if (callbackData.startsWith('show_premium_offer')) {
        await answerCallbackQuery(botToken, query.id);
        
        let customTitle = '🔒 Fitur Khusus Premium!';
        if (callbackData === 'show_premium_offer_antibanned') {
          customTitle = '💎 Upgrade Premium (Anti Banned)';
        } else if (callbackData === 'show_premium_offer_stiker') {
          customTitle = '💎 Upgrade Premium (Bebas Stiker)';
        } else if (callbackData === 'show_premium_offer_peringatan') {
          customTitle = '💎 Upgrade Premium (Bebas Peringatan)';
        }
        
        // Memanggil fungsi sendPremiumOffer dengan mengirimkan judul (customTitle) spesifik
        await sendPremiumOffer(supabase, botToken, userId, 'premium', customTitle);
        
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMILIHAN TARGET GENDER (PREMIUM) - SATU RPC ---
      if (callbackData === 'target_cowok' || callbackData === 'target_cewek' || callbackData === 'target_semua') {
        const targetGender = callbackData === 'target_cowok' ? 'cowok' : callbackData === 'target_cewek' ? 'cewek' : 'semua';
        
        // SATU RPC: Update target_gender dan tangkap return 'state'
        const { data: userState } = await supabase.rpc('update_target_gender', {
          p_user_id: userId,
          p_target_gender: targetGender
        });

        const targetLabel = targetGender === 'cowok' ? 'Cowok 👦' : targetGender === 'cewek' ? 'Cewek 👧' : 'Semua 👥';
        
        // Jawab callback agar loading di tombol hilang
        await answerCallbackQuery(botToken, query.id, `✅ Target gender: ${targetLabel}`);

        // Cek apakah hasil return rpc menunjukkan user sedang chatting
        const isChatting = (userState?.state || userState) === 'chatting';

        // EDIT PESAN MENU MENJADI KONFIRMASI
        if (message) {
          const searchKeyboard = {
            inline_keyboard: [
              [
                isChatting 
                  ? { text: '🛑 Stop', callback_data: 'chat_stop' }
                  : { text: '🔍 Cari Partner', callback_data: 'search_partner' },
                isChatting 
                  ? { text: '⏭️ Next Partner', callback_data: 'chat_next' }
                  : null
              ].filter(Boolean), // Filter akan otomatis membuang nilai null
              [
                { text: '🎯 Ubah Target Lagi', callback_data: 'change_target' }
              ]
            ]
          };

          try {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: `✅ <b>Target Gender Berhasil Diubah!</b>\n\n🎯 Target partner kamu sekarang: <b>${targetLabel}</b>\n\nSilakan mulai pencarian untuk menemukan partner baru.`,
                parse_mode: 'HTML',
                reply_markup: searchKeyboard
              })
            });
          } catch (e) {
            console.error('Gagal mengedit pesan target gender:', e);
          }
        }

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMILIHAN TARGET LOKASI (PREMIUM) - SATU RPC ---
      if (callbackData.startsWith('target_loc_')) {
        const targetLocation = callbackData.replace('target_loc_', '');
        
        // SATU RPC: Update target_location dan tangkap return 'state'
        const { data: userState } = await supabase.rpc('update_target_location', {
          p_user_id: userId,
          p_target_location: targetLocation
        });

        const targetLabel = targetLocation === 'semua' ? 'Semua 🌏' : `📍 ${targetLocation}`;
        
        // Jawab callback agar loading di tombol hilang
        await answerCallbackQuery(botToken, query.id, `✅ Target lokasi: ${targetLabel}`);

        // Cek apakah hasil return rpc menunjukkan user sedang chatting
        const isChatting = (userState?.state || userState) === 'chatting';

        // EDIT PESAN MENU MENJADI KONFIRMASI
        if (message) {
          const searchKeyboard = {
            inline_keyboard: [
              [
                isChatting 
                  ? { text: '🛑 Stop', callback_data: 'chat_stop' }
                  : { text: '🔍 Cari Partner', callback_data: 'search_partner' },
                isChatting 
                  ? { text: '⏭️ Next Partner', callback_data: 'chat_next' }
                  : null
              ].filter(Boolean),
              [
                { text: '📍 Ubah Lokasi Lagi', callback_data: 'change_location' }
              ]
            ]
          };

          try {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: `✅ <b>Target Lokasi Berhasil Diubah!</b>\n\n📌 Target lokasi partner kamu sekarang: <b>${targetLabel}</b>\n\nSilakan mulai pencarian untuk menemukan partner baru.`,
                parse_mode: 'HTML',
                reply_markup: searchKeyboard
              })
            });
          } catch (e) {
            console.error('Gagal mengedit pesan target lokasi:', e);
          }
        }

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA CHANGE LOCATION (INLINE BUTTON) ---
      if (callbackData === 'change_location') {
        // Cek premium langsung (filter hanya untuk premium)
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until, target_location')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

        if (!isPremium) {
          await answerCallbackQuery(botToken, query.id, '🔒 Fitur Premium Only!');
          await sendPremiumOffer(supabase, botToken, userId, 'filter_lokasi');
          return new Response('OK', { status: 200 });
        }

        // Buat keyboard lokasi untuk premium (Kecualikan "Lainnya")
        const targetLocationList = LOCATION_LIST.filter(loc => loc !== 'Lainnya');
        const locationButtons: any[][] = [];

        for (let i = 0; i < targetLocationList.length; i += 3) {
          const row = [];
          for (let j = 0; j < 3 && i + j < targetLocationList.length; j++) {
            const loc = targetLocationList[i + j];
            row.push({ text: loc, callback_data: `target_loc_${loc}` });
          }
          locationButtons.push(row);
        }
        
        // Tambahkan opsi Semua Lokasi di paling bawah
        locationButtons.push([{ text: '🇮🇩 Semua Lokasi', callback_data: 'target_loc_semua' }]);


        const locationKeyboard = { inline_keyboard: locationButtons };

        const tl = userData?.target_location;
        const currentTarget = tl ? (tl === 'semua' ? 'Semua 🌏' : `📍 ${tl}`) : 'Semua 🌏';

        await answerCallbackQuery(botToken, query.id);
        await sendTelegramMessage(
          botToken, userId,
          `📍 <b>Pilih Target Lokasi Chat</b>\n\n📌 Target saat ini: <b>${currentTarget}</b>\n\nPilih lokasi partner yang ingin kamu ajak chat:`,
          locationKeyboard
        );

        return new Response('OK', { status: 200 });
      }

      // Handler untuk set_loc_* (dari /lokasi command - TANPA auto-search partner) - SATU RPC
      if (callbackData.startsWith('set_loc_')) {
        const selectedLocation = callbackData.replace('set_loc_', '');
        
        // Hapus pesan pilihan lokasi
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // SATU RPC: Update location user
        await supabase.rpc('update_user_location', {
          p_user_id: userId,
          p_location: selectedLocation
        });

        await answerCallbackQuery(botToken, query.id, `✅ Lokasi diset: ${selectedLocation}`);
        
        // Hanya konfirmasi update, TIDAK mencari partner otomatis
        await sendTelegramMessage(
          botToken,
          userId,
          `✅ Lokasi berhasil diubah menjadi <b>📍 ${selectedLocation}</b>\n\nGunakan /start untuk mencari partner chat.`
        );

        return new Response('OK', { status: 200 });
      }

      // Handler untuk set_gender_* (dari /gender command - TANPA auto-search partner)
      if (callbackData === 'set_gender_cowok' || callbackData === 'set_gender_cewek') {
        const selectedGender = callbackData === 'set_gender_cowok' ? 'cowok' : 'cewek';
        
        // Hapus pesan pilihan gender
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Update gender user
        await supabase
          .from('telegram_users')
          .update({ gender: selectedGender })
          .eq('id', userId);

        await answerCallbackQuery(botToken, query.id, `✅ Gender diset: ${selectedGender === 'cowok' ? 'Cowok 👦' : 'Cewek 👧'}`);
        
        // Hanya konfirmasi update, TIDAK mencari partner otomatis
        await sendTelegramMessage(
          botToken,
          userId,
          `✅ Gender berhasil diubah menjadi <b>${selectedGender === 'cowok' ? 'Cowok 👦' : 'Cewek 👧'}</b>\n\nGunakan /start untuk mencari partner chat.`
        );

        return new Response('OK', { status: 200 });
      }
      // ============================================================
      // 1. HANDLER BUKA MENU GIFT (Navigasi)
      // ============================================================
      if (callbackData === 'open_gift_menu') {
        const { data: userData } = await supabase.from('telegram_users').select('state, coins, partner_id').eq('id', userId).single();
        
        // Guard: Harus Chatting
        if (userData?.state !== 'chatting' || !userData?.partner_id) {
           await answerCallbackQuery(botToken, query.id, '❌ Sesi chat berakhir');
           // Tampilkan menu start jika user klik tombol lama saat sudah tidak chat
           const startKeyboard = { inline_keyboard: [[{ text: '🔍 Cari Partner', callback_data: 'search_partner' }]] };
           if (message) await sendTelegramMessage(botToken, userId, '⚠️ Kamu tidak sedang dalam chat.', startKeyboard);
           return new Response('OK', { status: 200 });
        }

        const balance = userData?.coins || 0;
        const msgText = `🎁 <b>Kirim Gift FizaTalk</b>\n\n💰 Saldo kamu: <b>${balance} koin</b>\n\nPilih gift untuk dikirim ke partner:`;

      
        await sendTelegramMessage(botToken, userId, msgText, buildGiftKeyboard());
        
        await answerCallbackQuery(botToken, query.id);
        return new Response('OK', { status: 200 });
      }

      // ============================================================
      // 2. HANDLER TRANSAKSI GIFT (Kirim Gift)
      // ============================================================
      if (callbackData.startsWith('send_gift_')) {
        const giftId = callbackData.replace('send_gift_', '');
        const selectedGift = GIFT_LIST.find(g => g.id === giftId);

        if (!selectedGift) {
            await answerCallbackQuery(botToken, query.id, '❌ Gift error');
            return new Response('OK', { status: 200 });
        }

        // SATU RPC: Proses gift atomik (cek saldo, kurangi sender, tambah partner, log)
        const { data: giftResult, error: giftError } = await supabase.rpc('process_gift_transaction', {
          p_sender_id: userId,
          p_gift_id: selectedGift.id,
          p_gift_name: selectedGift.name,
          p_gift_price: selectedGift.price
        });
        
        if (giftError || !giftResult?.success) {
          // Handle error berdasarkan tipe
          const errorType = giftResult?.error || 'unknown';
          
          if (errorType === 'not_chatting') {
            await answerCallbackQuery(botToken, query.id, '❌ Tidak sedang chatting!');
            if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
            return new Response('OK', { status: 200 });
          }
          
          if (errorType === 'insufficient_balance') {
            await answerCallbackQuery(botToken, query.id, '❌ Saldo tidak cukup, silakan Top Up');
            if (message) {
              await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: message.chat.id,
                  message_id: message.message_id,
                  text: `⚠️ <b>Saldo Tidak Cukup!</b>\n\n🎁 Harga Gift: <b>${selectedGift.price} koin</b>\n💰 Saldo Kamu: <b>${giftResult?.current_coins || 0} koin</b>\n\nSilakan isi ulang saldo untuk melanjutkan:`,
                  parse_mode: 'HTML',
                  reply_markup: buildTopupKeyboard()
                })
              });
            }
            return new Response('OK', { status: 200 });
          }
          
          await answerCallbackQuery(botToken, query.id, '❌ Terjadi kesalahan');
          return new Response('OK', { status: 200 });
        }

        // Gift berhasil! Ambil data dari result RPC
        const partnerId = giftResult.partner_id;
        const newSenderBalance = giftResult.new_sender_balance;
        const payoutAmount = giftResult.payout_amount;

        // Update Tampilan Menu Gift (Saldo berkurang, menu tetap terbuka)
        if (message) {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: `🎁 <b>Kirim Gift FizaTalk</b>\n\n💰 Saldo kamu: <b>${newSenderBalance} koin</b>\n\nPilih gift untuk dikirim ke partner:`,
                parse_mode: 'HTML',
                reply_markup: buildGiftKeyboard()
              })
            });
        }

        // Notifikasi Toast
        await answerCallbackQuery(botToken, query.id, `✅ Terkirim: ${selectedGift.name}`);

        // Pesan ke Chat Log (Pengirim)
        await sendTelegramMessage(botToken, userId, `🎁 Kamu mengirim <b>${selectedGift.name}</b> ${selectedGift.emoji}`);

        // Pesan ke Partner (Penerima)
        let specialEffect = '';
        if (selectedGift.price >= 1000) specialEffect = '\n✨✨✨ <b>SULTAN VIBES!</b> ✨✨✨';
        
        await sendTelegramMessage(
            botToken, 
            partnerId, 
            `🎁 <b>GIFT DITERIMA!</b>${specialEffect}\n\nPartner mengirim: ${selectedGift.emoji} <b>${selectedGift.name}</b>\n💰 Kamu menerima: <b>+${payoutAmount} koin</b>`
        );

        return new Response('OK', { status: 200 });
      }

      // ============================================================
      // 3. HANDLER BUKA MENU TOP UP
      // ============================================================
      if (callbackData === 'open_topup_menu') {
        const { data: userData } = await supabase.from('telegram_users').select('coins').eq('id', userId).single();
        const balance = userData?.coins || 0;

        // Edit pesan yang ada menjadi Menu Top Up
        if (message) {
            const url = `${TELEGRAM_API}${botToken}/editMessageText`;
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: `➕ <b>Top Up Saldo Koin</b>\n\n💰 Saldo saat ini: <b>${balance} koin</b>\n\nSilakan pilih nominal top up (100 koin = Rp 1.000):`,
                parse_mode: 'HTML',
                reply_markup: buildTopupKeyboard()
              })
            });
        }
        await answerCallbackQuery(botToken, query.id);
        return new Response('OK', { status: 200 });
      }

      // ============================================================
      // 4. HANDLER PROSES TOP UP (Buat Invoice) - SATU RPC
      // ============================================================
      if (callbackData.startsWith('init_topup_')) {
        const amount = parseInt(callbackData.replace('init_topup_', ''));
        await answerCallbackQuery(botToken, query.id);
        
        const COIN_PRICE = 10;
        const totalPrice = amount * COIN_PRICE;

        // Hapus menu Top Up
        if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);

        const topupStarsPrice = calculateStarsPrice(totalPrice);
        const topupStarsPayload = JSON.stringify({ t: 'tu', a: amount, u: userId });
        const topupStarsInvoiceLink = await createStarsInvoiceLink(
          botToken,
          `Top-up ${amount.toLocaleString('id-ID')} Koin`,
          `${amount} koin - Rp ${totalPrice.toLocaleString('id-ID')}`,
          topupStarsPayload,
          topupStarsPrice
        );
        console.log(`[STARS] topup payment button mode: ${topupStarsInvoiceLink ? 'url' : 'callback_fallback'}`);

        // Tampilkan pilihan metode pembayaran beserta harga Stars
        await sendTelegramMessage(botToken, userId,
          `💰 <b>TOP-UP ${amount.toLocaleString('id-ID')} KOIN</b>\n\n💳 Total: <b>Rp ${totalPrice.toLocaleString('id-ID')}</b>\n\nPilih metode pembayaran:`,
          buildPaymentMethodKeyboard(`topup_pay_${amount}`, 'cancel_topup', totalPrice, topupStarsInvoiceLink || undefined)
        );

        return new Response('OK', { status: 200 });
      }

      // --- HANDLER PROSES TOPUP VIA SAKURUPIAH/STARS ---
      if (callbackData.startsWith('topup_pay_')) {
        const parts = callbackData.replace('topup_pay_', '').split('_');
        const amount = parseInt(parts[0]);
        // UBAH BARIS INI:
        const method = parts[1] as 'QRIS' | 'DANA' | 'GOPAY' | 'SHOPEEPAY' | 'OVO' | 'STARS';
        
        if (method === 'STARS') {
          await processStarsTopupPayment(botToken, userId, amount, query.id, message);
        } else {
          await processSakurupiahTopupPayment(supabase, botToken, userId, amount, method, query.id, message);
        }
        return new Response('OK', { status: 200 });
      }
      // --- LOGIKA CHECK CHANNEL JOINED (INLINE BUTTON) ---
      if (callbackData === 'check_channel_joined') {
        // Cek apakah user sudah bergabung ke channel
        const { isMember, botNotAdmin } = await checkChannelMembership(botToken, userId, REQUIRED_CHANNEL);
        
        if (!isMember) {
          await answerCallbackQuery(botToken, query.id, '❌ Kamu belum bergabung ke channel!', true);
          await sendJoinChannelMessage(botToken, userId, botNotAdmin);
          return new Response('OK', { status: 200 });
        }
        
        // User sudah bergabung, hapus pesan join channel dan lanjutkan pencarian partner
        await answerCallbackQuery(botToken, query.id, '✅ Terverifikasi! Mencari partner...');
        
        // Hapus pesan join channel
        if (query.message?.message_id) {
          try {
            await fetch(`${TELEGRAM_API}${botToken}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: userId,
                message_id: query.message.message_id
              })
            });
          } catch (e) {
            console.error('Failed to delete join channel message:', e);
          }
        }
        
        await autoSearchPartner(supabase, botToken, userId);
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA SEARCH PARTNER (INLINE BUTTON) - SATU PANGGILAN RPC ---
      if (callbackData === 'search_partner' || callbackData.startsWith('search_partner:')) {
        // Intersepsi klik promo untuk pencatatan konversi
        if (callbackData.startsWith('search_partner:promo_')) {
          // Cek umur pesan promo (maksimal 1 jam = 3600 detik)
          if (message && message.date) {
            const messageTimeMs = message.date * 1000;
            const currentTimeMs = Date.now();
            const ageHours = (currentTimeMs - messageTimeMs) / (1000 * 60 * 60);

            if (ageHours > 1) {
              await answerCallbackQuery(botToken, query.id, '❌ Promo sudah kadaluarsa (lebih dari 1 jam).', true);
              await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
              return new Response('OK', { status: 200 });
            }
            
            // Hapus pesan promo secara langsung agar tidak menumpuk di riwayat chat
            await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
          }

          const templateKey = callbackData.replace('search_partner:promo_', '');
          // Catat konversi secara asinkron ke database
          supabase.from('reengagement_clicks').insert({
            user_id: userId,
            template_key: templateKey,
            clicked_at: new Date().toISOString()
          }).then(
            () => console.log(`[Webhook] Logged reengagement click for user ${userId}, template ${templateKey}`),
            (err) => console.error('[Webhook] Failed to log click:', err)
          );
        }

        await answerCallbackQuery(botToken, query.id, '🔍 Mencari partner...');
        
        // SATU PANGGILAN RPC: handles upsert, blocked check, state check, gender check, reputation, search
        const { success, handled, result } = await comprehensiveSearchAction(
          supabase, botToken, userId, 
          query.from.username, query.from.first_name, 
          false // isNext = false
        );
        
        if (handled) {
          // RPC sudah menangani notifikasi (banned, blocked, error)
          return new Response('OK', { status: 200 });
        }
        
        if (success && result) {
          // Handle aksi berdasarkan result.action
          
          // Perlu set gender dulu
          if (result.action === 'needs_gender') {
            const genderKeyboard = {
              inline_keyboard: [
                [
                  { text: '👦 Cowok', callback_data: 'gender_cowok' },
                  { text: '👧 Cewek', callback_data: 'gender_cewek' }
                ]
              ]
            };
            await sendTelegramMessage(
              botToken, userId,
              '👋 <b>Sebelum mulai, silahkan pilih jenis kelamin kamu:</b>',
              genderKeyboard
            );
            return new Response('OK', { status: 200 });
          }
          
          // Sedang chatting - tampilkan opsi stop/next
          if (result.action === 'already_chatting') {
            const chattingKeyboard = {
              inline_keyboard: [
                [
                  { text: '🛑 Stop', callback_data: 'chat_stop' },
                  { text: '⏭️ Next', callback_data: 'chat_next' }
                ]
              ]
            };
            await sendTelegramMessage(botToken, userId, '⚠️ Kamu sedang dalam chat.\n\nPilih aksi:', chattingKeyboard);
            return new Response('OK', { status: 200 });
          }
          
          // Sudah dalam antrian
          if (result.action === 'already_in_queue') {
            await sendTelegramMessage(botToken, userId, '⏳ Kamu sedang dalam antrian menunggu partner.\n\nMohon tunggu sebentar!');
            return new Response('OK', { status: 200 });
          }
          
          if (result.action === 'needs_channel_check') {
            const { isMember, botNotAdmin } = await checkChannelMembership(botToken, userId, REQUIRED_CHANNEL);
            if (!isMember) {
              await sendJoinChannelMessage(botToken, userId, botNotAdmin);
              return new Response('OK', { status: 200 });
            } else {
              // UPDATE FLAG AGAR TIDAK DICEK LAGI SEUMUR HIDUP
              await supabase.from('telegram_users').update({ is_channel_member: true }).eq('id', userId);
              
              // Masukkan ke antrean
              await searchPartnerWithQueueCheck(supabase, botToken, userId);
              return new Response('OK', { status: 200 });
            }
          }
          
          // Handle hasil pencarian partner (isNext = false untuk tombol Cari Partner)
          await handleComprehensiveSearchResult(supabase, botToken, userId, result, false);
        }

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA CHANGE TARGET (INLINE BUTTON) ---
      if (callbackData === 'change_target') {
        // Cek premium langsung (filter hanya untuk premium)
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until, target_gender')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

        if (!isPremium) {
          // Non-premium: tampilkan pesan premium-only
          await answerCallbackQuery(botToken, query.id, '🔒 Fitur Premium Only!');
          await sendPremiumOffer(supabase, botToken, userId, 'filter_gender');
          return new Response('OK', { status: 200 });
        }

        // Tampilkan pilihan target gender
        const targetKeyboard = {
          inline_keyboard: [
            [
              { text: '👦 Cowok', callback_data: 'target_cowok' },
              { text: '👧 Cewek', callback_data: 'target_cewek' }
            ],
            [
              { text: '👥 Semua', callback_data: 'target_semua' }
            ]
          ]
        };

        const tg = userData?.target_gender;
        const currentTarget = tg ? (tg === 'cowok' ? 'Cowok 👦' : tg === 'cewek' ? 'Cewek 👧' : 'Semua 👥') : 'Semua 👥';

        await answerCallbackQuery(botToken, query.id);
        await sendTelegramMessage(
          botToken, userId,
          `🎯 <b>Pilih Target Gender Chat</b>\n\n📌 Target saat ini: <b>${currentTarget}</b>\n\nPilih siapa yang ingin kamu ajak chat:`,
          targetKeyboard
        );

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA CHAT NEXT (INLINE BUTTON) - SATU PANGGILAN RPC ---
      if (callbackData === 'chat_next') {
        await answerCallbackQuery(botToken, query.id, '⏭️ Mencari partner baru...');
        
        // === FIX RACE CONDITION ===
        // Pre-fetch data user SEBELUM RPC agar bisa mengirim pesan "Mengakhiri chat..."
        // SEBELUM user dimasukkan ke waiting_queue oleh RPC.
        // Ini mencegah user lain mendapatkan match dan mengirim "Partner ditemukan!"
        // sebelum pesan "Mengakhiri chat..." sempat terkirim.
        const { data: preNextData } = await supabase
          .from('telegram_users')
          .select('partner_id, penalty_points, target_gender, target_location, premium_until')
          .eq('id', userId)
          .single();
        
        const preNextPenalty = preNextData?.penalty_points || 0;
        const preNextIsPremium = preNextData?.premium_until && new Date(preNextData.premium_until) > new Date();
        const preNextFilterInfo = preNextIsPremium ? {
          target_gender: preNextData?.target_gender,
          target_location: preNextData?.target_location
        } : undefined;
        
        // Bangun keyboard Laporkan/Asik/Baik untuk partner lama
        const preNextInlineKeyboard: any[][] = [];
        if (preNextData?.partner_id && preNextPenalty < 40) {
          preNextInlineKeyboard.push([
            { text: '🚩 Laporkan', callback_data: `report_user_${preNextData.partner_id}` },
            { text: '😎 Asik', callback_data: `rate_asik_${preNextData.partner_id}` },
            { text: '👍 Baik', callback_data: `rate_baik_${preNextData.partner_id}` }
          ]);
        }
        if (preNextPenalty >= 40 && !preNextIsPremium) {
          preNextInlineKeyboard.push([
            { text: '💎 Upgrade Premium (Anti Banned)', callback_data: 'show_premium_offer_antibanned' }
          ]);
        }
        const preNextKeyboard = preNextInlineKeyboard.length > 0 ? { inline_keyboard: preNextInlineKeyboard } : undefined;
        
        // Kirim pesan "Mengakhiri chat dan mencari partner baru..." SEBELUM RPC
        const preNextReputation = preNextPenalty >= 40 ? {
          status: preNextPenalty >= 70 ? 'critical' : 'warning',
          message: null,
          penalty_points: preNextPenalty
        } : undefined;
        await sendSearchingMessage(botToken, userId, preNextReputation, true, false, preNextKeyboard, preNextFilterInfo);
        
        // SEKARANG baru panggil RPC (user aman masuk queue setelah pesan terkirim)
        const { success, handled, result: searchResult } = await comprehensiveSearchAction(
          supabase, botToken, userId,
          query.from.username, query.from.first_name,
          true // isNext = true
        );
        
        if (handled) {
          // RPC sudah menangani notifikasi (banned, blocked, error)
          return new Response('OK', { status: 200 });
        }
        
        if (success && searchResult) {
          // 1. TANGANI PROMO DARI DATABASE (Cegah Partner Nyangkut)
          if (searchResult.action === 'show_promo') {
             await executePromoAction(supabase, botToken, userId);
             return new Response('OK', { status: 200 });
          }

          // TANGANI CHANNEL CHECK
          if (searchResult.action === 'needs_channel_check') {
            const { isMember, botNotAdmin } = await checkChannelMembership(botToken, userId, REQUIRED_CHANNEL);
            if (!isMember) {
              await sendJoinChannelMessage(botToken, userId, botNotAdmin);
              return new Response('OK', { status: 200 });
            } else {
              // UPDATE FLAG AGAR TIDAK DICEK LAGI SEUMUR HIDUP
              await supabase.from('telegram_users').update({ is_channel_member: true }).eq('id', userId);
              
              // Masukkan ke antrean
              await searchPartnerWithQueueCheck(supabase, botToken, userId);
              return new Response('OK', { status: 200 });
            }
          }
          
          // 3. JIKA BUKAN PROMO & SUDAH JOIN CHANNEL -> NORMAL MATCHING
          // searchMessageAlreadySent = true: pesan sudah dikirim di atas sebelum RPC
          await handleComprehensiveSearchResult(supabase, botToken, userId, searchResult, true, true);
        }

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA CHAT STOP (INLINE BUTTON) ---
      if (callbackData === 'chat_stop') {
        
        // Ambil state user terlebih dahulu
        const { data: stopUserData } = await supabase
          .from('telegram_users')
          .select('state')
          .eq('id', userId)
          .single();

        await answerCallbackQuery(botToken, query.id, '🛑 Chat diakhiri');
        
        if (stopUserData?.state !== 'chatting') {
          const startKeyboard = {
              inline_keyboard: [
                [
                  { text: '🔍 Cari Partner', callback_data: 'search_partner' }
                ],
                [
                  { text: '🎯 Filter Gender', callback_data: 'change_target' },
                  { text: '📍 Filter Lokasi', callback_data: 'change_location' }
                ]
              ]
            };
            await sendTelegramMessage(botToken, userId, '👋 Kamu tidak dalam chat. Pilih aksi:', startKeyboard);
            return new Response('OK', { status: 200 });
        }
        await endChat(supabase, botToken, userId);
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA RECONNECT PARTNER (FITUR PREMIUM) ---
      if (callbackData.startsWith('reconnect_')) {
        const targetPartnerId = parseInt(callbackData.split('_')[1]);
        
        // Cek status premium user
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until, state')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

        if (!isPremium) {
          // User belum premium - tampilkan penawaran premium
          await answerCallbackQuery(botToken, query.id, '🔒 Fitur Premium Only!');
          await sendPremiumOffer(supabase, botToken, userId, 'reconnect');
          return new Response('OK', { status: 200 });
        }

        // 2. User Premium -> Eksekusi Reconnect via RPC
    await answerCallbackQuery(botToken, query.id, '🔄 Menghubungi...');

    // Panggil RPC initiate_reconnect
    const { data: reconnectRes, error: rpcError } = await supabase.rpc('initiate_reconnect', {
        p_requester_id: userId,
        p_target_id: targetPartnerId,
        p_message_id: message?.message_id // Kirim ID pesan tombol untuk diedit nanti
    });

    if (rpcError || !reconnectRes.success) {
        const errorMsg = reconnectRes?.error === 'recently_rejected' 
            ? '❌ Partner menolak panggilan ini. Coba lagi nanti.' 
            : '❌ Gagal menghubungkan. Partner mungkin sudah tidak aktif.';
        
        await answerCallbackQuery(botToken, query.id, errorMsg, true);
        return new Response('OK', { status: 200 });
    }

    // 3. Handle Hasil RPC
    if (reconnectRes.action === 'notify_now') {
        // SKENARIO A: Partner Idle -> Kirim Notifikasi Langsung
        const reqId = reconnectRes.request_id;
        
        const acceptKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Terima', callback_data: `accept_reconnect_${reqId}` },
                    { text: '❌ Tolak', callback_data: `reject_reconnect_${reqId}` }
                ]
            ]
        };

        // Kirim notifikasi ke Target
        await sendTelegramMessage(
            botToken,
            targetPartnerId,
            `📞 <b>PANGGILAN MASUK!</b>\n\nPartner sebelumnya ingin ngobrol lagi sama kamu. Terima?`,
            acceptKeyboard
        );

        // Update Pesan User (Pengirim)
        if (message) {
             await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: userId,
                    message_id: message.message_id,
                    text: `🔄 <b>Menunggu Konfirmasi...</b>\n\nNotifikasi telah dikirim ke partner. Menunggu jawaban mereka...`,
                    parse_mode: 'HTML'
                })
            });
        }

    } else if (reconnectRes.action === 'queue_notification') {
        // SKENARIO B: Partner Busy -> Notifikasi bahwa request di-queue
        if (message) {
             await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: userId,
                    message_id: message.message_id,
                    text: `⏳ <b>Partner Sedang Sibuk</b>\n\nPartner sedang dalam percakapan lain. Kami akan memberitahu mereka segera setelah mereka selesai.\n\nAnda akan mendapat notifikasi jika mereka menerima.`,
                    parse_mode: 'HTML',
                    reply_markup: {
                         inline_keyboard: [[{ text: '🔍 Cari Partner Lain', callback_data: 'search_partner' }]]
                    }
                })
            });
        }
    }
    return new Response('OK', { status: 200 });
}

      // --- HANDLER TERIMA/TOLAK RECONNECT ---
if (callbackData.startsWith('accept_reconnect_') || callbackData.startsWith('reject_reconnect_')) {
    const action = callbackData.startsWith('accept_reconnect_') ? 'accept' : 'reject';
    const requestId = callbackData.split('_')[2]; // Format: action_reconnect_UUID

    await answerCallbackQuery(botToken, query.id, action === 'accept' ? '✅ Menghubungkan...' : '❌ Menolak...');

    // Panggil RPC Resolve
    const { data: resolveRes, error } = await supabase.rpc('resolve_reconnect', {
        p_request_id: requestId,
        p_action: action
    });

    // Hapus pesan notifikasi (tombol terima/tolak) agar tidak diklik 2x
    if (message) {
        await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
    }

    if (error || !resolveRes.success) {
        if (resolveRes?.error === 'requester_busy') {
            await sendTelegramMessage(botToken, userId, '❌ Penelpon sudah masuk ke chat lain.');
        } else if (resolveRes?.error === 'target_busy') {
             await sendTelegramMessage(botToken, userId, '⚠️ Kamu harus keluar dari antrian/chat untuk menerima panggilan.');
        } else {
             await sendTelegramMessage(botToken, userId, '❌ Permintaan kadaluarsa.');
        }
        return new Response('OK', { status: 200 });
    }

    // SUKSES
    if (action === 'accept') {
        const requesterId = resolveRes.requester_id;
        
        // Kirim Notifikasi Pairing ke Keduanya (Gunakan helper yang sudah ada)
        // Fungsi ini akan mengirim pesan "Partner Ditemukan" ke User A dan User B
        await sendPairingNotifications(supabase, botToken, requesterId, userId, null, null);

    } else {
        // REJECT
        const requesterId = resolveRes.requester_id;
        // Beritahu penelpon bahwa ditolak
        await sendTelegramMessage(botToken, requesterId, '❌ Partner menolak atau sedang tidak bisa diganggu.');
    }

    return new Response('OK', { status: 200 });
}

      // --- LOGIKA RATING PARTNER (SPAM/SANGE/ASIK) ---
      if (callbackData.startsWith('report_user_')) {        // Ambil partner_id dari pesan sebelumnya jika ada, atau dari database
        
        const reportPartnerId = parseInt(callbackData.replace('report_user_', ''));
  
        if (!reportPartnerId || isNaN(reportPartnerId)) {
          await answerCallbackQuery(botToken, query.id, '❌ Partner tidak ditemukan');
          return new Response('OK', { status: 200 });
        }
        
        // Tampilkan pilihan rating: Spam, Sange
        const reportKeyboard = {
          inline_keyboard: [
            [
              { text: '🚨 Spam', callback_data: `rate_spam_${reportPartnerId}` },
              { text: '🔞 Sange', callback_data: `rate_sange_${reportPartnerId}` }
            ]
          ]
        };
        await answerCallbackQuery(botToken, query.id);
        try {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageReplyMarkup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message?.chat.id,
                message_id: message?.message_id,
                reply_markup: reportKeyboard
              })
            });
        } catch (e) {
          console.error('Failed to edit message for report options:', e);
        }
        return new Response('OK', { status: 200 });
      }

          
      if (callbackData.startsWith('rate_')) {
        const parts = callbackData.split('_');
        const rateType = parts[1]; // spam, sange, atau asik
        const reportedId = parseInt(parts[2]);
        
        if (!reportedId || isNaN(reportedId)) {
          await answerCallbackQuery(botToken, query.id, '❌ Data tidak valid');
          return new Response('OK', { status: 200 });
        }
        
        // Panggil RPC untuk submit report (hemat biaya cloud)
        const { data: reportResult, error: reportError } = await supabase.rpc('submit_partner_report', {
          p_reporter_id: userId,
          p_reported_id: reportedId,
          p_report_type: rateType
        });
        
        if (reportError) {
          console.error('submit_partner_report error:', reportError);
          await answerCallbackQuery(botToken, query.id, '❌ Gagal mengirim rating');
          return new Response('OK', { status: 200 });
        }
        
        // Handle hasil RPC
        // Handle hasil RPC
        if (!reportResult?.success) {
          if (reportResult?.error === 'already_reported') {
            await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sudah memberi rating ke partner ini!', true);
          } else if (reportResult?.error === 'rate_limit_exceeded') {
            await answerCallbackQuery(botToken, query.id, '⚠️ Batas 3 rating per jam tercapai!', true);
          } else if (reportResult?.error === 'partner_not_recent') {
            await answerCallbackQuery(botToken, query.id, '⚠️ Kamu hanya bisa memberi rating pada partner terakhir!', true);
          } else if (reportResult?.error === 'reputation_too_low') {
            await answerCallbackQuery(botToken, query.id, '⚠️ Reputasimu terlalu rendah untuk melapor!', true);
          } else {
            await answerCallbackQuery(botToken, query.id, '❌ Gagal mengirim rating');
          }
          return new Response('OK', { status: 200 });
        }
        
        // Berhasil mengirim rating
        let ratingEmoji = '';
        let ratingLabel = '';
        if (rateType === 'spam') {
          ratingEmoji = '🚨';
          ratingLabel = 'Spam';
        } else if (rateType === 'sange') {
          ratingEmoji = '🔞';
          ratingLabel = 'Sange';
        } else if (rateType === 'baik') {
          ratingEmoji = '👍';
          ratingLabel = 'Baik';
        } else if (rateType === 'asik') {
          ratingEmoji = '😎';
          ratingLabel = 'Asik';
        }
        
        await answerCallbackQuery(botToken, query.id, `✅ Rating ${ratingEmoji} ${ratingLabel} terkirim!`);
        
        // Update pesan: Ganti teks jadi Terima Kasih & Update Tombol
        if (message) {
          const updatedKeyboard = {
            inline_keyboard: [
              [
                { text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }
              ],
              [
                { text: '🔄 Hubungi Kembali', callback_data: `reconnect_${reportedId}` }
              ]
            ]
          };

          // Tentukan pesan berdasarkan jenis rating
          let thanksText = "";
          if (rateType === 'asik' || rateType === 'baik') {
             thanksText = `✅ <b>Terima Kasih!</b>\n\nKamu memberi rating <b>${ratingEmoji} ${ratingLabel}</b> ke partner ini. Semoga partner selanjutnya juga asik ya!`;
          } else {
             thanksText = `✅ <b>Laporan Diterima</b>\n\nTerima kasih atas laporan <b>${ratingEmoji} ${ratingLabel}</b> Anda. Kami akan meninjau akun tersebut.`;
          }
          
          try {
            // KODE BARU (Ubah Teks & Tombol)
            await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: thanksText,           // <--- Teks baru dimasukkan di sini
                parse_mode: 'HTML',         // <--- Agar huruf tebal berfungsi
                reply_markup: updatedKeyboard
              })
            });
          } catch (e) {
            console.error('Failed to edit rating message:', e);
          }
        }
        
        // Jika user di-ban karena penalty >= 100, kirim notifikasi
        if (reportResult?.is_banned) {
          // Non-premium: permanent ban
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (csChatId) {
            await sendTelegramMessage(
              botToken,
              parseInt(csChatId),
              `🚨 <b>USER DIBLOKIR OTOMATIS (PENALTY 100+)</b>\n\n🆔 User ID: <code>${reportedId}</code>\n⚠️ Alasan: Terlalu banyak laporan negatif dari pengguna lain\n📊 Penalty: ${reportResult.new_penalty} poin\n\n⏰ Waktu: ${formatDateTimeWIB(new Date())}`
            );
          }
        }
        
        // Jika user premium kena temp ban
        if (reportResult?.is_temp_banned) {
          const blockedUntil = reportResult.blocked_until ? new Date(reportResult.blocked_until) : null;
          const blockedUntilStr = blockedUntil ? formatDateTimeWIB(blockedUntil) : '00:00 WIB';
          
          // Notifikasi ke admin
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (csChatId) {
            await sendTelegramMessage(
              botToken,
              parseInt(csChatId),
              `⏳ <b>USER PREMIUM DIBATASI SEMENTARA (PENALTY 100+)</b>\n\n🆔 User ID: <code>${reportedId}</code>\n⚠️ Alasan: Terlalu banyak laporan negatif\n🔓 Dibatasi sampai: <b>${blockedUntilStr}</b>\n📊 Penalty direset ke 0\n\n⏰ Waktu: ${formatDateTimeWIB(new Date())}`
            );
          }
          
          // Notifikasi ke user yang kena temp ban
          await sendTelegramMessage(
            botToken,
            reportedId,
            `⏳ <b>AKUN DIBATASI SEMENTARA</b>\n\n⚠️ Kami menerima terlalu banyak laporan negatif terkait aktivitas chat Anda.\n\n🔓 Akun Anda akan dapat digunakan kembali pada:\n📅 <b>${blockedUntilStr}</b>\n\n💡 Hindari spam, konten NSFW, perilaku toksik, dan trolling agar akun tidak dibatasi lagi.`
          );
        }
        
        return new Response('OK', { status: 200 });
      }

      // --- DISMISS PROMO & CARI PARTNER ---
      if (callbackData === 'dismiss_promo_search') {
        // Hapus pesan promo
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }
        
        // Hapus dari promo_queue jika ada
        await supabase
          .from('promo_queue')
          .delete()
          .eq('user_id', userId)
          .in('status', ['pending', 'waiting_idle']);

        await answerCallbackQuery(botToken, query.id, '🔍 Mencari partner...');
        
        // Langsung cari partner - upsert sudah terintegrasi di RPC
        await searchPartnerWithQueueCheck(supabase, botToken, userId);
        return new Response('OK', { status: 200 });
      }

      // === UNIFIED PREMIUM PURCHASE HANDLER (semua buy_premium_* callbacks) ===
      if (BUY_PREMIUM_MAP[callbackData]) {
        const configKey = BUY_PREMIUM_MAP[callbackData];
        
        // Cek umur pesan khusus untuk paket promo (maksimal 1 jam)
        const isPromoValid = await validatePromoExpiration(supabase, userId, configKey);
        if (!isPromoValid && !configKey.startsWith('n')) {
          await answerCallbackQuery(botToken, query.id, '❌ Penawaran promo ini sudah kadaluarsa atau tidak valid.', true);
          if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
          return new Response('OK', { status: 200 });
        }

        const config = PREMIUM_PAY_CONFIG[configKey];
        if (!config) {
          await answerCallbackQuery(botToken, query.id, '❌ Paket tidak valid');
          return new Response('OK', { status: 200 });
        }

        await answerCallbackQuery(botToken, query.id);
        if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);

        const premiumStarsPrice = calculateStarsPrice(config.price);
        const premiumStarsPayload = JSON.stringify({ t: 'p', k: configKey, u: userId });
        const premiumStarsInvoiceLink = await createStarsInvoiceLink(
          botToken,
          config.label,
          `Premium ${config.days} hari - Rp ${config.price.toLocaleString('id-ID')}`,
          premiumStarsPayload,
          premiumStarsPrice
        );
        console.log(`[STARS] premium payment button mode: ${premiumStarsInvoiceLink ? 'url' : 'callback_fallback'} (${configKey})`);

        // Tampilkan pilihan metode pembayaran beserta harga Stars
        await sendTelegramMessage(botToken, userId,
          `💎 <b>${config.label}</b>\n\n💰 Harga: <b>Rp ${config.price.toLocaleString('id-ID')}</b>\n📅 Durasi: <b>${config.days} hari</b>\n\nPilih metode pembayaran:`,
          buildPaymentMethodKeyboard(`prem_pay_${configKey}`, 'cancel_premium', config.price, premiumStarsInvoiceLink || undefined)
        );
        return new Response('OK', { status: 200 });
      }

      // === HANDLER PROSES PEMBAYARAN PREMIUM VIA SAKURUPIAH/STARS ===
      if (callbackData.startsWith('prem_pay_')) {
        const payload = callbackData.replace('prem_pay_', '');
        const lastUnderscore = payload.lastIndexOf('_');
        const configKey = payload.substring(0, lastUnderscore);
        // UBAH BARIS INI:
        const method = payload.substring(lastUnderscore + 1) as 'QRIS' | 'DANA' | 'GOPAY' | 'SHOPEEPAY' | 'OVO' | 'STARS';
        
        // Cek kembali kadaluarsa promo saat metode pembayaran ditekan
        const isPromoValid = await validatePromoExpiration(supabase, userId, configKey);
        if (!isPromoValid && !configKey.startsWith('n')) {
          await answerCallbackQuery(botToken, query.id, '❌ Penawaran promo ini sudah kadaluarsa.', true);
          if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
          return new Response('OK', { status: 200 });
        }

        if (method === 'STARS') {
          await processStarsPremiumPayment(botToken, userId, configKey, query.id, message);
        } else {
          await processSakurupiahPremiumPayment(supabase, botToken, userId, configKey, method, query.id, message);
        }
        return new Response('OK', { status: 200 });
      }


    }
    // --- END LOGIKA CALLBACK ---

    // NOTE: Message reaction handler DIHAPUS untuk hemat biaya cloud
    // Setiap reaction memicu 2 query database (blocked check + state check)

    // ************************************************
    // START LOGIKA PESAN/COMMAND
    // ************************************************

    // Handle successful Stars payment
    if (update.message?.successful_payment) {
      const sp = update.message.successful_payment;
      const spUserId = update.message.from.id;
      console.log(`[STARS] successful_payment from ${spUserId}: ${sp.invoice_payload} amount=${sp.total_amount} XTR`);
      await handleSuccessfulStarsPayment(supabase, botToken, spUserId, sp.invoice_payload, sp.telegram_payment_charge_id, sp.total_amount);
      return new Response('OK', { status: 200 });
    }

    // Pastikan ada pesan masuk
    if (!update.message?.from) {
      return new Response('OK', { status: 200 });
    }

    const message = update.message;
    const userId = message.from.id;
    const text = message.text; 

   // ... kode sebelumnya (setelah const text = message.text) ...

    let currentUser: { state: string; partner_id: number | null } | null = null;
    
    // UBAH BAGIAN INI: Tambahkan retry sederhana atau error blocking
    const { data: dbUser, error: dbError } = await supabase
      .from('telegram_users')
      .select('state, partner_id, premium_until')
      .eq('id', userId)
      .maybeSingle();

    // JIKA DB ERROR: Jangan lanjut ke logika Welcome! 
    // Return 500 agar Telegram mencoba mengirim ulang pesan (webhook retry)
    if (dbError) {
      console.error('[CRITICAL] DB Error fetching user:', dbError.message);
      return new Response('Database Error', { status: 500 });
    }

    if (dbUser) {
      currentUser = dbUser;
    }


    // === HANDLER BUKTI PEMBAYARAN QRIS MANUAL ===
    // Jika user mengirim foto dan state awaiting_payment, cek apakah ada transaksi QRIS_MANUAL pending
    if (message.photo && currentUser?.state === 'awaiting_payment') {
      const handled = await handlePaymentProofUpload(supabase, botToken, userId, message);
      if (handled) {
        return new Response('OK', { status: 200 });
      }
    }

    // ************************************************
    // LOGIKA CHATTING & FORWARDING (TANPA TAG)
    // ************************************************
    if (currentUser?.state === 'chatting' && currentUser?.partner_id && message.message_id) {
        const partnerId = currentUser.partner_id as number;
        
        let isCommand = false;

        // 1. Cek dan Proses Command (Prioritas Utama saat chatting)
        if (text) {
          if (text === '/next') {
              const chattingKeyboard = {
               inline_keyboard: [
                 [
                   { text: '⏭️ Next', callback_data: 'chat_next' }
                 ],
                 [
                   { text: '🎯 Filter Gender', callback_data: 'change_target' },
                   { text: '📍 Filter Lokasi', callback_data: 'change_location' }
                 ]
               ]
              };
              await sendTelegramMessage(botToken, userId, '🔵 Kamu yakin ingin mangakhiri chat saat ini dan mencari partner baru?.\n\nPilih aksi:', chattingKeyboard);
              isCommand = true;
          } else if (text === '/stop') {
              
              const chattingKeyboard = {
               inline_keyboard: [
                 [
                   { text: '🛑 Stop', callback_data: 'chat_stop' },
                   { text: '⏭️ Next', callback_data: 'chat_next' }
                 ],
                 [
                   { text: '🎯 Filter Gender', callback_data: 'change_target' },
                   { text: '📍 Filter Lokasi', callback_data: 'change_location' }
                 ]
               ]
              };
              await sendTelegramMessage(botToken, userId, '🔵 Kamu yakin ingin mangakhiri chat?.\n\nPilih aksi:', chattingKeyboard);
              isCommand = true;
          } else if (text === '/start') {
              const chattingKeyboard = {
               inline_keyboard: [
                  [
                    { text: '🛑 Stop', callback_data: 'chat_stop' },
                    { text: '⏭️ Next', callback_data: 'chat_next' }
                  ],
                  [
                    { text: '🎯 Filter Gender', callback_data: 'change_target' },
                    { text: '📍 Filter Lokasi', callback_data: 'change_location' }
                  ]
                ]
              };
              await sendTelegramMessage(botToken, userId, '⚠️ Kamu sedang dalam chat.\n\nPilih aksi:', chattingKeyboard);
              isCommand = true;
          } else if (text === '/filter_lokasi') {
          // Cek apakah user premium
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('premium_until, target_location')
            .eq('id', userId)
            .single();

          const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

          if (!isPremium) {
            await sendPremiumOffer(supabase, botToken, userId, 'filter_lokasi');
            return new Response('OK', { status: 200 });
          }

          // Buat keyboard lokasi untuk premium (Kecualikan "Lainnya")
          const targetLocationList = LOCATION_LIST.filter(loc => loc !== 'Lainnya');
          const locationButtons: any[][] = [];

          for (let i = 0; i < targetLocationList.length; i += 3) {
            const row = [];
            for (let j = 0; j < 3 && i + j < targetLocationList.length; j++) {
              const loc = targetLocationList[i + j];
              row.push({ text: loc, callback_data: `target_loc_${loc}` });
            }
            locationButtons.push(row);
          }
          
          // Tambahkan opsi Semua Lokasi di paling bawah
          locationButtons.push([{ text: '🇮🇩 Semua Lokasi', callback_data: 'target_loc_semua' }]);
          
          const locationKeyboard = {
            inline_keyboard: locationButtons
          };

          const currentTarget = userData?.target_location 
            ? (userData.target_location === 'semua' ? 'Semua 🌏' : `📍 ${userData.target_location}`) 
            : 'Semua 🌏';

          await sendTelegramMessage(
            botToken,
            userId,
            `📍 <b>Pilih Target Lokasi Chat</b>\n\n📌 Target saat ini: <b>${currentTarget}</b>\n\nPilih lokasi partner yang ingin kamu ajak chat:`,
            locationKeyboard
          );
        } else if (text === '/target') {
          // Cek apakah user premium
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('premium_until, target_gender')
            .eq('id', userId)
            .single();

          const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

          if (!isPremium) {
            await sendPremiumOffer(supabase, botToken, userId, '💎 Upgrade Premium (Filter Gender)');
            return new Response('OK', { status: 200 });
          }

          // Tampilkan pilihan target gender untuk user premium
          const targetKeyboard = {
            inline_keyboard: [
              [
                { text: '👦 Cowok', callback_data: 'target_cowok' },
                { text: '👧 Cewek', callback_data: 'target_cewek' }
              ],
              [
                { text: '👥 Semua', callback_data: 'target_semua' }
              ]
            ]
          };

          const currentTarget = userData?.target_gender 
            ? (userData.target_gender === 'cowok' ? 'Cowok 👦' : userData.target_gender === 'cewek' ? 'Cewek 👧' : 'Semua 👥') 
            : 'Semua 👥';

          await sendTelegramMessage(
            botToken,
            userId,
            `🎯 <b>Pilih Target Gender Chat</b>\n\n📌 Target saat ini: <b>${currentTarget}</b>\n\nPilih siapa yang ingin kamu ajak chat:`,
            targetKeyboard
          );
            isCommand = true;
          } else if (text === '/gender') {
          const genderKeyboard = {
            inline_keyboard: [
              [
                { text: '👦 Cowok', callback_data: 'set_gender_cowok' },
                { text: '👧 Cewek', callback_data: 'set_gender_cewek' }
              ]
            ]
          };

          // Get current gender
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('gender')
            .eq('id', userId)
            .single();

          const currentGender = userData?.gender ? (userData.gender === 'cowok' ? 'Cowok 👦' : 'Cewek 👧') : 'Belum diset';

          await sendTelegramMessage(
            botToken,
            userId,
            `🔄 <b>Ubah Gender</b>\n\n📌 Gender saat ini: <b>${currentGender}</b>\n\nPilih gender baru:`,
            genderKeyboard
          );
            isCommand = true;
          } else if (text === '/coins') {
              // Logika /coins saat chatting
              const { data: userData } = await supabase
                  .from('telegram_users')
                  .select('coins')
                  .eq('id', userId)
                  .single();

              const coins = userData?.coins || 0;
              await sendTelegramMessage(botToken, userId, `💰 Saldo Koin Kamu: ${coins} koin`);
              isCommand = true;
          // ... kode sebelumnya ...
          }
        // COMMAND /LOKASI - Ubah lokasi (tidak memerlukan premium)
        else if (text === '/lokasi') {
          // Buat keyboard lokasi 
          const locationButtons = [];
          for (let i = 0; i < LOCATION_LIST.length; i += 3) {
            const row = [];
            for (let j = 0; j < 3 && i + j < LOCATION_LIST.length; j++) {
              const loc = LOCATION_LIST[i + j];
              row.push({ text: loc, callback_data: `set_loc_${loc}` });
            }
            locationButtons.push(row);
          }

          const locationKeyboard = {
            inline_keyboard: locationButtons
          };

          // Get current location
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('location')
            .eq('id', userId)
            .single();

          const currentLocation = userData?.location ? `📍 ${userData.location}` : 'Belum diset';

          await sendTelegramMessage(
            botToken,
            userId,
            `🔄 <b>Ubah Lokasi</b>\n\n📌 Lokasi saat ini: <b>${currentLocation}</b>\n\nPilih lokasi baru:`,
            locationKeyboard
          );
            isCommand = true;
          } else if (text === '/gift') {
            // Jika SEDANG chatting: Tampilkan Menu Gift
            const { data: userCoins } = await supabase.from('telegram_users').select('coins').eq('id', userId).single();
            const balance = userCoins?.coins || 0;
            
            await sendTelegramMessage(
              botToken, 
              userId, 
              `🎁 <b>Kirim Gift FizaTalk</b>\n\n💰 Saldo kamu: <b>${balance} koin</b>\n\nPilih gift untuk dikirim ke partner:`,
              buildGiftKeyboard()
            );
                isCommand = true;
          }  else if (text === '/live') {
          // Panggil RPC Toggle
            const { data: toggleRes, error } = await supabase.rpc('toggle_tiktok_mode', {
              p_user_id: userId
            });

            if (toggleRes) {
              const isActive = toggleRes.is_active;
              const statusText = isActive ? '🟢 <b>AKTIF</b>' : '🔴 <b>NONAKTIF</b>';
              
              const msg = `🎥 <b>Mode Live TikTok</b>\n\nStatus: ${statusText}\n\n${isActive 
              ? '✅ Semua foto, video, dan stiker dari partner akan <b>disensor otomatis</b>.\n👆 Kamu harus klik "Buka" untuk melihatnya.\n🛡️ Aman untuk streaming!' 
              : '❌ Media akan tampil otomatis seperti biasa.'}`;

              await sendTelegramMessage(botToken, userId, msg);
            };
            isCommand = true;

          }
    
          // Tambahkan command lain yang diizinkan saat chatting di sini

          // JANGAN FORWARD JIKA ITU ADALAH COMMAND YANG DIKENAL
          if (isCommand) {
              return new Response('OK', { status: 200 }); 
          }
        }

        // === DETEKSI SPAM UNTUK SEMUA JENIS PESAN ===
        let spamMarkup = undefined;

        const isSenderPremium = dbUser?.premium_until && new Date(dbUser.premium_until) > new Date();

        if (hasSpamEntities(message) && !isSenderPremium) {
            spamMarkup = {
                inline_keyboard: [[ { text: '🚩 Laporkan spam', callback_data: `reportspam_${userId}` } ]]
            };
        }
       
        

           // === LOGIKA HANDLER REPLY / BALAS PESAN (UPDATED) ===
            
            const isReply = message.reply_to_message ? true : false;
            let visualQuote = '';

            if (isReply) {
                // Pass userId ke fungsi helper yang baru
                visualQuote = getReplyPreview(message.reply_to_message, userId);
            }



            // A. Jika USER MENGIRIM TEKS
            if (text) {
                if (isReply) {
                    // Gabungkan Quote + Pesan Baru
                    const finalMessage = `${visualQuote}${text}`;
                    await sendTelegramMessage(botToken, partnerId, finalMessage, spamMarkup);
                } else {
                    // Copy message biasa
                    await copyTelegramMessage(botToken, partnerId, userId, message.message_id, spamMarkup);
                }
            } else if (message.sticker) {
              const isAllowed = await handleStickerReview(supabase, botToken, message, isSenderPremium);
              if (!isAllowed) {
                return new Response('OK', { status: 200, headers: corsHeaders }); 
              }
              // Sticker diizinkan -> teruskan ke partner
              if (isReply) {
                await sendTelegramMessage(botToken, partnerId, visualQuote + "<i>(membalas dengan sticker)</i>");
              }
              await copyTelegramMessage(botToken, partnerId, userId, message.message_id, spamMarkup);
            }

// ... Lanjut ke kode aslinya: 
// await copyTelegramMessage(botToken, partnerId, userId, messageId, ...);
            // B. Jika USER MENGIRIM MEDIA (Photo/Video/Animation/VideoNote)
            else if (message.photo || message.video || message.animation || message.video_note) {
              // Cek apakah partner mengaktifkan Mode TikTok
              const { data: partnerSettings } = await supabase.rpc('get_partner_settings', {
                p_partner_id: partnerId
              });

              const isPartnerInTikTokMode = partnerSettings?.is_tiktok_mode || false;

              // SKENARIO A: Partner Mode TikTok AKTIF -> SENSOR
              if (isPartnerInTikTokMode) {
                const mediaType = getMediaType(message);
                
                const revealData = `reveal_${userId}_${message.message_id}`;
                
                const hiddenKeyboard = {
                  inline_keyboard: [
                    [{ text: `🔓 Buka ${mediaType}`, callback_data: revealData }]
                  ]
                };

                let hiddenMsg = `🛡️ <b>SENSOR LIVE MODE</b>\n\nPartner mengirim <b>${mediaType}</b>.\nKonten disembunyikan untuk keamanan Live Streaming.`;
                const originalCaption = message.caption || "";
                
                if (isReply) {
                    let finalCaption = `${visualQuote}${originalCaption}`;
                    if (finalCaption.length > 1000) {
                        finalCaption = finalCaption.substring(0, 997) + "...";
                    }
                    hiddenMsg = `${visualQuote}${originalCaption}\n\n${hiddenMsg}.`;
                    await sendTelegramMessage(botToken, partnerId, hiddenMsg, hiddenKeyboard);
                } else {
                await sendTelegramMessage(botToken, partnerId, hiddenMsg, hiddenKeyboard);
                }
              } else {
                let mediaEndpoint = '';
                let mediaField = '';
                let fileId = '';

                if (message.photo) {
                    mediaEndpoint = 'sendPhoto';
                    mediaField = 'photo';
                    fileId = message.photo[message.photo.length - 1].file_id;
                } else if (message.video) {
                    mediaEndpoint = 'sendVideo';
                    mediaField = 'video';
                    fileId = message.video.file_id;
                } else if (message.animation) {
                    mediaEndpoint = 'sendAnimation';
                    mediaField = 'animation';
                    fileId = message.animation.file_id;
                } else if (message.video_note) {
                    mediaEndpoint = 'sendVideoNote';
                    mediaField = 'video_note';
                    fileId = message.video_note.file_id;
                }

                const originalCaption = message.caption || "";
                let finalCaption = isReply ? `${visualQuote}${originalCaption}` : originalCaption;
                if (finalCaption.length > 1000) {
                    finalCaption = finalCaption.substring(0, 997) + "...";
                }

                const { data: senderData } = await supabase.from('telegram_users').select('premium_until').eq('id', userId).single();
                const isPremiumSender = senderData?.premium_until && new Date(senderData.premium_until) > new Date();
                
                const reportMarkup = isPremiumSender 
                    ? { inline_keyboard: [] } 
                    : { inline_keyboard: [[{ text: '🗑️ Hapus & Laporkan', callback_data: `reportm_${userId}` }]] };
                
                const bodyPayload: any = {
                    chat_id: partnerId,
                    [mediaField]: fileId,
                    reply_markup: reportMarkup
                };

                if (!message.video_note) {
                    bodyPayload.caption = finalCaption;
                    if (finalCaption) bodyPayload.parse_mode = 'HTML';
                    bodyPayload.has_spoiler = true;
                }

                await fetch(`${TELEGRAM_API}${botToken}/${mediaEndpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyPayload)
                });
            }
        
            }
            // C. Jika USER MENGIRIM MEDIA LAIN (Foto, Video, Voice, File)
            else {

                
                // Media ini support caption, jadi kita 'inject' quote ke dalam caption
                const originalCaption = message.caption || "";
                
                if (isReply) {
                    let finalCaption = `${visualQuote}${originalCaption}`;
    
                    // Potong jika terlalu panjang (Limit Telegram 1024)
                    if (finalCaption.length > 1000) {
                        finalCaption = finalCaption.substring(0, 997) + "...";
                    }
                    
                    // Gunakan copyMessage dengan caption override
                    await fetch(`${TELEGRAM_API}${botToken}/copyMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: partnerId,
                            from_chat_id: userId,
                            message_id: message.message_id,
                            caption: finalCaption,
                            parse_mode: 'HTML'
                        })
                    });
                } else {
                  
                    // Bukan reply, copy biasa (mempertahankan caption asli user jika ada)
                    await copyTelegramMessage(botToken, partnerId, userId, message.message_id);
                }
            }
        
        
        return new Response('OK', { status: 200 });
    } 
    // ************************************************
    // END LOGIKA CHATTING & FORWARDING
    // ************************************************


    // Jika tidak sedang chatting, lanjutkan ke pengecekan command (jika ada teks)
    else if (text) {
        // Handle commands (Hanya diproses jika ada teks)
        if (text === '/coins') {
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('coins')
            .eq('id', userId)
            .single();

          const coins = userData?.coins || 0;
          await sendTelegramMessage(botToken, userId, `💰 Saldo Koin Kamu: ${coins} koin`);
        }

        else if (text === '/gift') {
        const startKeyboard = {
          inline_keyboard: [
            [{ text: '🔍 Cari Partner', callback_data: 'search_partner' }],
            [
              { text: '🎯 Filter Gender', callback_data: 'change_target' },
              { text: '📍 Filter Lokasi', callback_data: 'change_location' }
            ]
          ]
        };
        await sendTelegramMessage(botToken, userId, '⚠️ <b>Fitur Gift hanya tersedia saat chatting!</b>\n\nSilakan cari partner terlebih dahulu:', startKeyboard);
      }

        else if (text === '/start') {
          // Step 1: Cek apakah user sudah ada di database
          const { data: existingUser } = await supabase
            .from('telegram_users')
            .select('id, gender, location')
            .eq('id', userId)
            .maybeSingle();

          // Jika belum ada, insert ke database
          if (!existingUser) {
            await supabase.from('telegram_users').insert({
              id: userId,
              first_name: message.from.first_name,
              username: message.from.username,
              state: 'idle',
              coins: 0
            });
            
            // Tampilkan welcome + pilihan gender
            const genderKeyboard = {
              inline_keyboard: [
                [
                  { text: '👦 Cowok', callback_data: 'gender_cowok' },
                  { text: '👧 Cewek', callback_data: 'gender_cewek' }
                ]
              ]
            };

            await sendTelegramMessage(
              botToken,
              userId,
              '👋 <b>Selamat datang di Fizatalk!</b>\n\nPilih jenis kelamin kamu:',
              genderKeyboard
            );
            return new Response('OK', { status: 200 });
          }

          // Step 2: Cek apakah gender sudah diset
          if (!existingUser.gender) {
            const genderKeyboard = {
              inline_keyboard: [
                [
                  { text: '👦 Cowok', callback_data: 'gender_cowok' },
                  { text: '👧 Cewek', callback_data: 'gender_cewek' }
                ]
              ]
            };

            await sendTelegramMessage(
              botToken,
              userId,
              '👋 <b>Selamat datang di Fizatalk!</b>\n\nPilih jenis kelamin kamu:',
              genderKeyboard
            );
            return new Response('OK', { status: 200 });
          }

          // Step 3: Cek apakah lokasi sudah diset
          if (!existingUser.location) {
            // Buat keyboard lokasi (3 kolom per baris)
            const locationButtons = [];
            for (let i = 0; i < LOCATION_LIST.length; i += 3) {
              const row = [];
              for (let j = 0; j < 3 && i + j < LOCATION_LIST.length; j++) {
                const loc = LOCATION_LIST[i + j];
                row.push({ text: loc, callback_data: `init_loc_${loc}` });
              }
              locationButtons.push(row);
            }

            const locationKeyboard = {
              inline_keyboard: locationButtons
            };

            await sendTelegramMessage(
              botToken,
              userId,
              `✅ Gender: <b>${existingUser.gender === 'cowok' ? 'Cowok 👦' : 'Cewek 👧'}</b>\n\n📍 <b>Sekarang pilih lokasimu:</b>`,
              locationKeyboard
            );
            return new Response('OK', { status: 200 });
          }

          // Step 4: Gender dan lokasi sudah lengkap, tampilkan menu utama
          const mainMenuKeyboard = {
            inline_keyboard: [
              [
                { text: '🔍 Cari Partner', callback_data: 'search_partner' }
              ],
              [
                { text: '🎯 Filter Gender', callback_data: 'change_target' },
                { text: '📍 Filter Lokasi', callback_data: 'change_location_target' }
              ]
            ]
          };

          await sendTelegramMessage(
            botToken,
            userId,
            '👋 <b>Selamat datang kembali di Fizatalk!</b>\n\nPilih aksi di bawah untuk memulai:',
            mainMenuKeyboard
          );
        }
        else if (text === '/next') {
            // Jika tidak chatting, tampilkan menu start
            const startKeyboard = {
              inline_keyboard: [
                [
                  { text: '🔍 Cari Partner', callback_data: 'search_partner' }
                ],
                [
                  { text: '🎯 Filter Gender', callback_data: 'change_target' },
                  { text: '📍 Filter Lokasi', callback_data: 'change_location' }
                ]
              ]
            };
            await sendTelegramMessage(botToken, userId, '👋 Kamu belum dalam chat. Pilih aksi:', startKeyboard);
        }
        else if (text === '/stop') {
            // Jika tidak chatting, tampilkan menu start
            const startKeyboard = {
              inline_keyboard: [
                [
                  { text: '🔍 Cari Partner', callback_data: 'search_partner' }
                ],
                [
                  { text: '🎯 Filter Gender', callback_data: 'change_target' },
                  { text: '📍 Filter Lokasi', callback_data: 'change_location' }
                ]
              ]
            };
            await sendTelegramMessage(botToken, userId, '👋 Kamu tidak dalam chat. Pilih aksi:', startKeyboard);
        }
        else if (text === '/live') {
          // Panggil RPC Toggle
            const { data: toggleRes, error } = await supabase.rpc('toggle_tiktok_mode', {
              p_user_id: userId
            });

            if (toggleRes) {
              const isActive = toggleRes.is_active;
              const statusText = isActive ? '🟢 <b>AKTIF</b>' : '🔴 <b>NONAKTIF</b>';
              
              const msg = `🎥 <b>Mode Live TikTok</b>\n\nStatus: ${statusText}\n\n${isActive 
              ? '✅ Semua foto, video, dan stiker dari partner akan <b>disensor otomatis</b>.\n👆 Kamu harus klik "Buka" untuk melihatnya.\n🛡️ Aman untuk streaming!' 
              : '❌ Media akan tampil otomatis seperti biasa.'}`;

              await sendTelegramMessage(botToken, userId, msg);
            };
          }
        
        // COMMAND /GENDER - Ganti gender (tanpa auto-search partner)
        else if (text === '/gender') {
          const genderKeyboard = {
            inline_keyboard: [
              [
                { text: '👦 Cowok', callback_data: 'set_gender_cowok' },
                { text: '👧 Cewek', callback_data: 'set_gender_cewek' }
              ]
            ]
          };

          // Get current gender
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('gender')
            .eq('id', userId)
            .single();

          const currentGender = userData?.gender ? (userData.gender === 'cowok' ? 'Cowok 👦' : 'Cewek 👧') : 'Belum diset';

          await sendTelegramMessage(
            botToken,
            userId,
            `🔄 <b>Ubah Gender</b>\n\n📌 Gender saat ini: <b>${currentGender}</b>\n\nPilih gender baru:`,
            genderKeyboard
          );
        }
        // COMMAND /TARGET - PREMIUM ONLY
        else if (text === '/target' || text.startsWith('/target ')) {
          // Cek apakah user premium
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('premium_until, target_gender')
            .eq('id', userId)
            .single();

          const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

          if (!isPremium) {
            // User bukan premium - tampilkan penawaran beli premium
            await sendPremiumOffer(supabase, botToken, userId, 'filter_gender');
            return new Response('OK', { status: 200 });
          }

          // Tampilkan pilihan target gender untuk user premium
          const targetKeyboard = {
            inline_keyboard: [
              [
                { text: '👦 Cowok', callback_data: 'target_cowok' },
                { text: '👧 Cewek', callback_data: 'target_cewek' }
              ],
              [
                { text: '👥 Semua', callback_data: 'target_semua' }
              ]
            ]
          };

          const currentTarget = userData?.target_gender 
            ? (userData.target_gender === 'cowok' ? 'Cowok 👦' : userData.target_gender === 'cewek' ? 'Cewek 👧' : 'Semua 👥') 
            : 'Semua 👥';

          await sendTelegramMessage(
            botToken,
            userId,
            `🎯 <b>Pilih Target Gender Chat</b>\n\n📌 Target saat ini: <b>${currentTarget}</b>\n\nPilih siapa yang ingin kamu ajak chat:`,
            targetKeyboard
          );
        }
        // COMMAND /LOKASI - Ubah lokasi (tidak memerlukan premium)
        else if (text === '/lokasi') {
          // Buat keyboard lokasi 
          const locationButtons = [];
          for (let i = 0; i < LOCATION_LIST.length; i += 3) {
            const row = [];
            for (let j = 0; j < 3 && i + j < LOCATION_LIST.length; j++) {
              const loc = LOCATION_LIST[i + j];
              row.push({ text: loc, callback_data: `set_loc_${loc}` });
            }
            locationButtons.push(row);
          }

          const locationKeyboard = {
            inline_keyboard: locationButtons
          };

          // Get current location
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('location')
            .eq('id', userId)
            .single();

          const currentLocation = userData?.location ? `📍 ${userData.location}` : 'Belum diset';

          await sendTelegramMessage(
            botToken,
            userId,
            `🔄 <b>Ubah Lokasi</b>\n\n📌 Lokasi saat ini: <b>${currentLocation}</b>\n\nPilih lokasi baru:`,
            locationKeyboard
          );
        }
        // COMMAND /FILTER_LOKASI - PREMIUM ONLY (filter target lokasi)
        else if (text === '/filter_lokasi') {
          // Cek apakah user premium
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('premium_until, target_location')
            .eq('id', userId)
            .single();

          const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

          if (!isPremium) {
            await sendPremiumOffer(supabase, botToken, userId, 'filter_lokasi');
            return new Response('OK', { status: 200 });
          }

          // Buat keyboard lokasi untuk premium (dengan opsi Semua di atas)
          const locationButtons: any[][] = [];
          for (let i = 0; i < LOCATION_LIST.length; i += 3) {
            const row = [];
            for (let j = 0; j < 3 && i + j < LOCATION_LIST.length; j++) {
              const loc = LOCATION_LIST[i + j];
              row.push({ text: loc, callback_data: `target_loc_${loc}` });
            }
            locationButtons.push(row);
          }
          locationButtons.push([{ text: '🇮🇩 Semua Lokasi', callback_data: 'target_loc_semua' }]);

          const locationKeyboard = {
            inline_keyboard: locationButtons
          };

          const currentTarget = userData?.target_location 
            ? (userData.target_location === 'semua' ? 'Semua 🌏' : `📍 ${userData.target_location}`) 
            : 'Semua 🌏';

          await sendTelegramMessage(
            botToken,
            userId,
            `📍 <b>Pilih Target Lokasi Chat</b>\n\n📌 Target saat ini: <b>${currentTarget}</b>\n\nPilih lokasi partner yang ingin kamu ajak chat:`,
            locationKeyboard
          );
        }
        else {
          // Pesan Teks Non-Command jatuh ke blok sambutan
          const welcomeKeyboard = {
            inline_keyboard: [
              [
                { text: '🔍 Cari Partner', callback_data: 'search_partner' }
              ],
              [
                { text: '🎯 Filter Gender', callback_data: 'change_target' },
                { text: '📍 Filter Lokasi', callback_data: 'change_location' }
              ]
            ]
          };
          await sendTelegramMessage(botToken, userId, '👋 <b>Selamat datang di Fizatalk!</b>\n\nPilih aksi di bawah untuk memulai:', welcomeKeyboard);
        }
        // COMMAND /SET_PREMIUM - ADMIN ONLY (Reply to photo to set Premium image)
        if (text === '/set_premium') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          if (message.reply_to_message?.photo) {
            const photo = message.reply_to_message.photo;
            const fileId = photo[photo.length - 1].file_id;
            await setBotSetting(supabase, 'premium_file_id', fileId, userId);
            await sendTelegramMessage(botToken, userId, `✅ <b>Foto Premium berhasil diperbarui!</b>\n\nFile ID: <code>${fileId.substring(0, 30)}...</code>`);
          } else {
            await sendTelegramMessage(botToken, userId, '⚠️ Reply ke foto Premium dengan command /set_premium');
          }
        }
        // COMMAND /SET_PROMO - ADMIN ONLY (Reply to photo to set Promo image)
        if (text === '/set_promo') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          if (message.reply_to_message?.photo) {
            const photo = message.reply_to_message.photo;
            const fileId = photo[photo.length - 1].file_id;
            await setBotSetting(supabase, 'promo_premium_file_id', fileId, userId);
            await sendTelegramMessage(botToken, userId, `✅ <b>Foto Promo berhasil diperbarui!</b>\n\nFile ID: <code>${fileId.substring(0, 30)}...</code>`);
          } else {
            await sendTelegramMessage(botToken, userId, '⚠️ Reply ke foto Promo dengan command /set_promo');
          }
        }
        // COMMAND /SET_REENGAGE_CAT - ADMIN ONLY (Reply to photo to set Cute Cat image)
        if (text === '/set_reengage_cat') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          if (message.reply_to_message?.photo) {
            const photo = message.reply_to_message.photo;
            const fileId = photo[photo.length - 1].file_id;
            await setBotSetting(supabase, 'reengage_file_id_cute_pleading_cat', fileId, userId);
            await sendTelegramMessage(botToken, userId, `✅ <b>Foto Re-engage Cat berhasil diperbarui!</b>\n\nFile ID: <code>${fileId.substring(0, 30)}...</code>`);
          } else {
            await sendTelegramMessage(botToken, userId, '⚠️ Reply ke foto Cat dengan command /set_reengage_cat');
          }
        }
        // COMMAND /SET_REENGAGE_GIFT - ADMIN ONLY (Reply to photo to set Gift Box image)
        if (text === '/set_reengage_gift') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          if (message.reply_to_message?.photo) {
            const photo = message.reply_to_message.photo;
            const fileId = photo[photo.length - 1].file_id;
            await setBotSetting(supabase, 'reengage_file_id_mysterious_gift_box', fileId, userId);
            await sendTelegramMessage(botToken, userId, `✅ <b>Foto Re-engage Gift Box berhasil diperbarui!</b>\n\nFile ID: <code>${fileId.substring(0, 30)}...</code>`);
          } else {
            await sendTelegramMessage(botToken, userId, '⚠️ Reply ke foto Gift dengan command /set_reengage_gift');
          }
        }
        // COMMAND /SET_REENGAGE_GRUMPY - ADMIN ONLY (Reply to photo to set Grumpy Cat image)
        if (text === '/set_reengage_grumpy') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          if (message.reply_to_message?.photo) {
            const photo = message.reply_to_message.photo;
            const fileId = photo[photo.length - 1].file_id;
            await setBotSetting(supabase, 'reengage_file_id_grumpy_cute_cat', fileId, userId);
            await sendTelegramMessage(botToken, userId, `✅ <b>Foto Re-engage Grumpy Cat berhasil diperbarui!</b>\n\nFile ID: <code>${fileId.substring(0, 30)}...</code>`);
          } else {
            await sendTelegramMessage(botToken, userId, '⚠️ Reply ke foto Grumpy Cat dengan command /set_reengage_grumpy');
          }
        }
        // COMMAND /SET_REENGAGE_HEARTS - ADMIN ONLY (Reply to photo to set Match Hearts image)
        if (text === '/set_reengage_hearts') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          if (message.reply_to_message?.photo) {
            const photo = message.reply_to_message.photo;
            const fileId = photo[photo.length - 1].file_id;
            await setBotSetting(supabase, 'reengage_file_id_social_match_hearts', fileId, userId);
            await sendTelegramMessage(botToken, userId, `✅ <b>Foto Re-engage Hearts berhasil diperbarui!</b>\n\nFile ID: <code>${fileId.substring(0, 30)}...</code>`);
          } else {
            await sendTelegramMessage(botToken, userId, '⚠️ Reply ke foto Hearts dengan command /set_reengage_hearts');
          }
        }
        // COMMAND /STATS - ADMIN ONLY (Melihat statistik user)
        if (text === '/stats') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }

          // Kirim pesan loading karena query ke DB mungkin memakan waktu
          await sendTelegramMessage(botToken, userId, '⏳ Menghitung statistik... Mohon tunggu.');

          try {
            // Setup Waktu (Referensi: Kemarin)
            const now = new Date();
            // Reset ke jam 00:00:00 hari ini
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            // Awal hari kemarin (00:00:00 kemarin)
            const yesterdayStart = new Date(todayStart);
            yesterdayStart.setDate(yesterdayStart.getDate() - 1);
            
            // Batas 30 hari sebelum kemarin (untuk menghitung churn)
            const churnDateStart = new Date(yesterdayStart);
            churnDateStart.setDate(churnDateStart.getDate() - 30);
            
            const churnDateEnd = new Date(todayStart);
            churnDateEnd.setDate(churnDateEnd.getDate() - 30);

            // Format tanggal untuk ditampilkan di pesan
            const displayDate = yesterdayStart.toLocaleDateString('id-ID', {
              day: 'numeric', month: 'long', year: 'numeric'
            });

            // 1. Pengguna Baru pada hari kemarin (created_at >= yesterdayStart AND < todayStart)
            const { count: newUsers } = await supabase
              .from('telegram_users')
              .select('*', { count: 'exact', head: true })
              .gte('created_at', yesterdayStart.toISOString())
              .lt('created_at', todayStart.toISOString());

            // 2. Pengguna Aktif pada hari kemarin (last_active >= yesterdayStart AND < todayStart)
            const { count: activeUsers } = await supabase
              .from('telegram_users')
              .select('*', { count: 'exact', head: true })
              .gte('last_active', yesterdayStart.toISOString())
              .lt('last_active', todayStart.toISOString());

            // 3. Tidak aktif > 30 hari dihitung dari kemarin (last_active < 30 hari sebelum kemarin)
            const { count: inactiveUsers } = await supabase
              .from('telegram_users')
              .select('*', { count: 'exact', head: true })
              .lt('last_active', churnDateStart.toISOString());

            // 4. User Churn (Tepat 30 hari tidak aktif pada hari kemarin)
            // Berarti terakhir aktif pada rentang waktu `churnDateStart` hingga `churnDateEnd`
            const { count: churnedUsers } = await supabase
              .from('telegram_users')
              .select('*', { count: 'exact', head: true })
              .gte('last_active', churnDateStart.toISOString())
              .lt('last_active', churnDateEnd.toISOString());

            // Format Pesan Balasan
            const statsMessage = `📊 <b>Statistik Pengguna Harian</b>\n` +
              `📅 Tanggal: <b>${displayDate}</b>\n\n` +
              `📈 <b>Pengguna Baru:</b> ${newUsers || 0} user\n` +
              `🔥 <b>Pengguna Aktif:</b> ${activeUsers || 0} user\n` +
              `💤 <b>Tidak Aktif (>30 Hari):</b> ${inactiveUsers || 0} user\n` +
              `📉 <b>User Churn (Tepat 30 Hari):</b> ${churnedUsers || 0} user`;

            await sendTelegramMessage(botToken, userId, statsMessage);
          } catch (e) {
            console.error('[STATS COMMAND] Error:', e);
            await sendTelegramMessage(botToken, userId, '❌ Terjadi kesalahan sistem saat mengambil data statistik.');
          }
          return new Response('OK', { status: 200 });
        }
    }
    else {
        // Jika TIDAK ada teks (yaitu media non-chatting), maka jatuh ke blok sambutan juga.
        const welcomeKeyboard = {
            inline_keyboard: [
              [
                { text: '🔍 Cari Partner', callback_data: 'search_partner' }
              ],
              [
                { text: '🎯 Filter Gender', callback_data: 'change_target' },
                { text: '📍 Filter Lokasi', callback_data: 'change_location' }
              ]
            ]
          };
          await sendTelegramMessage(botToken, userId, '👋 <b>Selamat datang di Fizatalk!</b>\n\nPilih aksi di bawah untuk memulai:', welcomeKeyboard);
    }

    return new Response('OK', { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    try {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      sb.rpc('log_bot_event', {
        p_level: 'error', p_source: 'telegram-webhook', p_event: 'top_level_exception',
        p_user_id: null, p_message: errorMessage,
        p_context: { stack: error instanceof Error ? error.stack : null },
      }).then(() => {}, () => {});
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
