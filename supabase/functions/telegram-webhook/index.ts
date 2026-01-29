import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'; // v1

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
  reply_to_message?: TelegramMessage; // Untuk fitur reply
  // Tambahkan tipe media lain jika diperlukan
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

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  message_reaction?: MessageReaction;
  callback_query?: CallbackQuery;
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

// ============================================
// SPAM DETECTION & AUTO-BLOCK SYSTEM
// ============================================

// Daftar kata sapaan awal yang dikecualikan dari deteksi spam
const EXCLUDED_GREETINGS = [
  'ce', 'co', 'cwek', 'cwok', 'cewek', 'cowok',
  'hai', 'halo', 'hi', 'hello', 'hey',
  'pagi', 'siang', 'sore', 'malam',
  'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam',
  'mba', 'mas', 'kak', 'bang', 'bro', 'sis',
  'hy', 'haloo', 'halloo', 'haiii', 'hyy',
  'assalamualaikum', 'assalamu alaikum', 'waalaikumsalam',
  'p', 'pp', 'gas', 'yuk', 'ayo',
  'wkwk', 'wkwkwk', 'haha', 'hahaha', 'hihi', 'hehe',
  'ok', 'oke', 'sip', 'siap', 'ya', 'iya', 'gak', 'tidak',
  'makasih', 'terima kasih', 'thanks', 'thx', 'ty',
  'lagi apa', 'lg apa', 'lagi ngapain', 'lg ngapain',
  'dari mana', 'darimana', 'dimana', 'di mana',
  'umur berapa', 'umur brp', 'berapa umur', 'brp umur',
  'asl', 'asl?', 'mau kenalan', 'kenalan yuk'
];

// Minimum karakter untuk dianggap copy-paste spam (pesan panjang)
const MIN_SPAM_CHARS = 50;

// Konfigurasi deteksi pesan pendek berulang
const SHORT_MESSAGE_MAX_CHARS = 49; // Pesan di bawah ini dianggap pendek
const SHORT_MESSAGE_SPAM_THRESHOLD = 4; // Berapa kali pesan pendek sama untuk dianggap spam
const SHORT_MESSAGE_INTERVAL_MINUTES = 15; // Dalam interval waktu berapa menit

// Konfigurasi deteksi username tag spam
const USERNAME_TAG_THRESHOLD = 3; // Minimal berapa kali kirim username tag untuk dianggap spam
const USERNAME_TAG_INTERVAL_MINUTES = 10; // Dalam interval waktu berapa menit

// HELPER: Cek apakah user sudah diblokir
async function isUserBlocked(supabase: any, userId: number): Promise<boolean> {
  const { data } = await supabase
    .from('blocked_users')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  
  return !!data;
}

// HELPER: Generate simple hash for message comparison
function simpleHash(text: string): string {
  // Normalize: lowercase, remove extra spaces, remove special chars
  const normalized = text.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
  
  // Simple hash using first 100 chars + length
  return `${normalized.substring(0, 100)}_${normalized.length}`;
}

// HELPER: Cek apakah pesan adalah sapaan awal yang dikecualikan
function isExcludedGreeting(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  
  // Jika pesan kurang dari 20 karakter, cek apakah sapaan
  if (normalized.length <= 20) {
    for (const greeting of EXCLUDED_GREETINGS) {
      if (normalized === greeting || normalized.startsWith(greeting + ' ') || normalized.endsWith(' ' + greeting)) {
        return true;
      }
    }
  }
  
  return false;
}

// HELPER: Deteksi spam dalam pesan
interface SpamDetectionResult {
  isSpam: boolean;
  reason: string;
  detectionType: 'username_tag' | 'copy_paste' | 'repeated_message' | null;
}

async function detectSpam(supabase: any, userId: number, text: string): Promise<SpamDetectionResult> {
  // Cek apakah autoblock diaktifkan
  const autoBlockEnabled = await getBotSetting(supabase, 'autoblock_enabled');
  if (autoBlockEnabled === 'off') {
    // Autoblock dinonaktifkan, skip semua deteksi spam (hemat biaya cloud)
    return { isSpam: false, reason: '', detectionType: null };
  }
  
  // Skip jika teks kosong atau terlalu pendek
  if (!text || text.length < 10) {
    return { isSpam: false, reason: '', detectionType: null };
  }
  
  // Skip jika sapaan awal
  if (isExcludedGreeting(text)) {
    return { isSpam: false, reason: '', detectionType: null };
  }
  
  // 1. Deteksi tag username (@username) - hanya spam jika berulang dalam interval waktu tertentu
  const usernamePattern = /@[a-zA-Z0-9_]{3,}/g;
  const usernameMatches = text.match(usernamePattern);
  
  if (usernameMatches && usernameMatches.length > 0) {
    const intervalStart = new Date(Date.now() - USERNAME_TAG_INTERVAL_MINUTES * 60 * 1000).toISOString();
    
    // Cek berapa kali user mengirim pesan dengan username tag dalam interval terakhir
    const { count: tagCount } = await supabase
      .from('spam_detection')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('detection_type', 'username_tag')
      .gte('detected_at', intervalStart);
    
    // Simpan record untuk tracking
    await supabase.from('spam_detection').insert({
      user_id: userId,
      message_hash: `tag_${usernameMatches.join('_')}`,
      message_preview: text.substring(0, 200),
      detection_type: 'username_tag'
    });
    
    // Hanya blokir jika sudah melebihi threshold (sudah kirim tag berulang kali)
    if (tagCount && tagCount >= USERNAME_TAG_THRESHOLD - 1) {
      return {
        isSpam: true,
        reason: `Mengirim tag username berulang kali (${(tagCount || 0) + 1}x dalam ${USERNAME_TAG_INTERVAL_MINUTES} menit): ${usernameMatches.join(', ')}`,
        detectionType: 'username_tag'
      };
    }
    
    // Belum spam, tapi sudah di-track
    console.log(`📝 Username tag tracked for user ${userId}: ${usernameMatches.join(', ')} (${(tagCount || 0) + 1}/${USERNAME_TAG_THRESHOLD})`);
  }
  
  // 2. Deteksi copy-paste (pesan panjang yang berulang) - langsung blokir jika dikirim 2x
  if (text.length >= MIN_SPAM_CHARS) {
    const messageHash = simpleHash(text);
    
    // Cek apakah pesan dengan hash serupa sudah pernah dikirim
    const { data: existingSpam } = await supabase
      .from('spam_detection')
      .select('id, detected_at')
      .eq('user_id', userId)
      .eq('message_hash', messageHash)
      .gte('detected_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // 24 jam terakhir
      .maybeSingle();
    
    if (existingSpam) {
      return {
        isSpam: true,
        reason: `Copy-paste pesan panjang (${text.length} karakter) yang sudah pernah dikirim`,
        detectionType: 'copy_paste'
      };
    }
    
    // Simpan hash pesan untuk tracking
    await supabase.from('spam_detection').insert({
      user_id: userId,
      message_hash: messageHash,
      message_preview: text.substring(0, 200),
      detection_type: 'tracking'
    });
  }
  
  // 3. Deteksi pesan pendek yang di-copy paste berulang kali (bukan sapaan umum)
  if (text.length >= 10 && text.length <= SHORT_MESSAGE_MAX_CHARS) {
    const messageHash = simpleHash(text);
    const intervalStart = new Date(Date.now() - SHORT_MESSAGE_INTERVAL_MINUTES * 60 * 1000).toISOString();
    
    // Cek berapa kali pesan yang sama persis dikirim dalam interval waktu tertentu
    const { count: repeatCount } = await supabase
      .from('spam_detection')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('message_hash', messageHash)
      .eq('detection_type', 'short_repeat')
      .gte('detected_at', intervalStart);
    
    // Simpan record untuk tracking
    await supabase.from('spam_detection').insert({
      user_id: userId,
      message_hash: messageHash,
      message_preview: text.substring(0, 200),
      detection_type: 'short_repeat'
    });
    
    // Blokir jika sudah melebihi threshold
    if (repeatCount && repeatCount >= SHORT_MESSAGE_SPAM_THRESHOLD - 1) {
      return {
        isSpam: true,
        reason: `Copy-paste pesan pendek berulang kali (${(repeatCount || 0) + 1}x dalam ${SHORT_MESSAGE_INTERVAL_MINUTES} menit): "${text.substring(0, 50)}"`,
        detectionType: 'repeated_message'
      };
    }
    
    // Log tracking
    if (repeatCount && repeatCount >= 1) {
      console.log(`📝 Short message tracked for user ${userId}: "${text.substring(0, 30)}..." (${(repeatCount || 0) + 1}/${SHORT_MESSAGE_SPAM_THRESHOLD})`);
    }
  }
  
  return { isSpam: false, reason: '', detectionType: null };
}

// HELPER: Blokir user dan kirim notifikasi
async function blockUserForSpam(
  supabase: any,
  botToken: string,
  userId: number,
  username: string | undefined,
  firstName: string | undefined,
  reason: string,
  blockedMessage: string
): Promise<void> {
  // 1. Insert ke tabel blocked_users
  await supabase.from('blocked_users').upsert({
    user_id: userId,
    username: username,
    first_name: firstName,
    reason: reason,
    blocked_message: blockedMessage.substring(0, 500), // Limit panjang pesan
    blocked_at: new Date().toISOString(),
    is_active: true
  }, { onConflict: 'user_id' });
  
  // 2. Hapus dari waiting_queue jika ada
  await supabase.from('waiting_queue').delete().eq('user_id', userId);
  
  // 3. Disconnect dari partner jika sedang chatting
  const { data: userData } = await supabase
    .from('telegram_users')
    .select('partner_id, state')
    .eq('id', userId)
    .single();
  
  if (userData?.partner_id && userData?.state === 'chatting') {
    const partnerId = userData.partner_id;
    
    // Reset partner
    await supabase
      .from('telegram_users')
      .update({ state: 'idle', partner_id: null })
      .eq('id', partnerId);
    
    // Notifikasi partner
    const endKeyboard = {
      inline_keyboard: [
        [{ text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }]
      ]
    };
    
    await sendTelegramMessage(
      botToken,
      partnerId,
      '⚠️ <b>Partner telah keluar dari chat.</b>\n\nPilih aksi untuk melanjutkan:',
      endKeyboard
    );
  }
  
  // 4. Reset state user yang diblokir
  await supabase
    .from('telegram_users')
    .update({ state: 'idle', partner_id: null })
    .eq('id', userId);
  
  // 5. Kirim pesan ke user yang diblokir (TANPA menyebutkan alasan untuk mencegah user mengakali sistem)
  const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
  
  // Keyboard dengan opsi bayar denda
  const blockedKeyboard = {
    inline_keyboard: [
      [{ text: '💰 Bayar Denda Rp10.000', callback_data: 'pay_fine' }]
    ]
  };
  
  await sendTelegramMessage(
    botToken,
    userId,
    `🚫 <b>Akun Anda Diblokir</b>\n\nAnda telah diblokir dari menggunakan layanan ini karena melanggar ketentuan penggunaan.\n\n💰 <b>Opsi Buka Blokir:</b>\nBayar denda Rp10.000 untuk membuka blokir akun.\n\n📞 Atau hubungi admin: @FizatalkCS`,
    blockedKeyboard
  );
  
  // 6. Kirim notifikasi ke admin
  if (csChatId) {
    const userName = username ? `@${username}` : firstName || 'Unknown';
    
    await sendTelegramMessage(
      botToken,
      parseInt(csChatId),
      `🚨 <b>USER DIBLOKIR OTOMATIS</b>\n\n👤 User: ${userName}\n🆔 ID: <code>${userId}</code>\n\n⚠️ <b>Alasan:</b>\n${reason}\n\n💬 <b>Pesan yang menyebabkan blokir:</b>\n<code>${blockedMessage.substring(0, 300)}${blockedMessage.length > 300 ? '...' : ''}</code>\n\n⏰ Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`
    );
  }
  
  console.log(`🚫 User ${userId} (${username || firstName}) blocked for spam: ${reason}`);
}

// HELPER: Simple upsert user - uses RPC for maximum cost savings
// Only updates username/first_name, NEVER update last_active
async function simpleUpsertUser(
  supabase: any, 
  userId: number, 
  username: string | undefined, 
  firstName: string | undefined
): Promise<void> {
  // Use RPC for optimized upsert (skips update if data unchanged)
  await supabase.rpc('upsert_user_optimized', {
    p_user_id: userId,
    p_username: username || null,
    p_first_name: firstName || null,
    p_update_last_active: false
  });
}

// HELPER: Smart upsert user - update last_active ONLY ONCE PER DAY
// Called on "Cari Partner", "Next", or "Stop" buttons
async function smartUpsertUser(
  supabase: any, 
  userId: number, 
  username: string | undefined, 
  firstName: string | undefined
): Promise<void> {
  // Use RPC for optimized upsert with daily last_active update
  await supabase.rpc('upsert_user_optimized', {
    p_user_id: userId,
    p_username: username || null,
    p_first_name: firstName || null,
    p_update_last_active: true // Only updates if last_active is not today
  });
}

// HELPER: Check if user should see channel join message (registered > 1 week)
async function shouldShowChannelJoin(supabase: any, userId: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('should_show_channel_join', { p_user_id: userId });
  if (error) {
    console.error('shouldShowChannelJoin error:', error);
    return true; // Default to showing channel check on error
  }
  return data === true;
}

// HELPER: Kirim foto QRIS dengan instruksi pembayaran
interface QRISPaymentParams {
  supabase: any;
  botToken: string;
  chatId: number;
  title: string;
  price: number;
  uniqueCode: number;
  totalAmount: number;
  expiryMinutes?: number;
  cancelCallbackData: string;
}

async function sendQRISPayment(params: QRISPaymentParams): Promise<number | null> {
  const { supabase, botToken, chatId, title, price, uniqueCode, totalAmount, expiryMinutes = 30, cancelCallbackData } = params;
  
  // Get QRIS file_id from database
  const qrisFileId = await getBotSetting(supabase, 'qris_file_id');
  
  if (!qrisFileId) {
    // No QRIS set, send text only
    console.error('QRIS file_id not set in bot_settings');
    const caption = `💳 <b>${title}</b>

💰 Harga: Rp ${price.toLocaleString('id-ID')}
🔢 Kode Unik: ${uniqueCode}
💵 <b>Total Bayar: Rp ${totalAmount.toLocaleString('id-ID')}</b>

⚠️ QRIS belum diatur oleh admin. Hubungi admin untuk pembayaran.

⏰ Batas waktu: ${expiryMinutes} menit`;

    const cancelKeyboard = { inline_keyboard: [[{ text: '❌ Batalkan Transaksi', callback_data: cancelCallbackData }]] };
    
    try {
      const resp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          reply_markup: cancelKeyboard
        })
      });
      const respJson = await resp.json();
      if (respJson.ok) return respJson.result.message_id;
      return null;
    } catch (e) {
      console.error('sendQRISPayment text fallback exception:', e);
      return null;
    }
  }

  const cancelKeyboard = { inline_keyboard: [[{ text: '❌ Batalkan Transaksi', callback_data: cancelCallbackData }]] };

  const caption = `💳 <b>${title}</b>

💵 <b>Total Bayar: Rp ${totalAmount.toLocaleString('id-ID')}</b>
💰 Harga: Rp ${price.toLocaleString('id-ID')}
🔢 Kode Unik: ${uniqueCode}

📱 <b>CARA PEMBAYARAN:</b>
1️⃣ Screenshot/simpan gambar QRIS di atas
2️⃣ Buka aplikasi e-wallet (GoPay/OVO/DANA/ShopeePay/dll)
3️⃣ Pilih menu <b>Scan QR</b> atau <b>Bayar</b>
4️⃣ Pilih dari galeri, lalu pilih gambar QRIS
5️⃣ Masukkan nominal <b>TEPAT Rp ${totalAmount.toLocaleString('id-ID')}</b>
6️⃣ Konfirmasi pembayaran

📸 Kirim <b>foto bukti pembayaran</b> ke chat ini.

⏰ Batas waktu: ${expiryMinutes} menit
⚠️ Harap hubungi Admin @FizaTalkCS jika mengalami kendala`;

  try {
    const resp = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: qrisFileId,
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: cancelKeyboard
      })
    });
    const respJson = await resp.json();
    if (respJson.ok) {
      return respJson.result.message_id;
    }
    console.error('sendQRISPayment failed:', respJson);
    return null;
  } catch (e) {
    console.error('sendQRISPayment exception:', e);
    return null;
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
// function getPremiumBenefitsText(): string {
//   return `✨ <b>KEUNTUNGAN PREMIUM:</b>
// • 🎯 Pilih target gender chat
// • 📍 Pilih target lokasi chat
// • ⭐ Badge Premium
// • 🚀 Prioritas matching`;
// }

// Helper function to build premium offer message for non-premium users
function buildPremiumOfferMessage(featureName: string): string {
  return `❌ <b>Fitur Premium Only!</b>

Fitur ${featureName} hanya tersedia untuk user <b>Premium</b>.

${getPremiumBenefitsText()}

💰 <b>HARGA PREMIUM:</b>
📦 <b>1 MINGGU:</b> Rp ${PREMIUM_PACKAGES.normal['7'].price.toLocaleString('id-ID')}
📦 <b>1 BULAN:</b> Rp ${PREMIUM_PACKAGES.normal['30'].price.toLocaleString('id-ID')}

💎 Beli sekarang untuk menikmati fitur eksklusif!`;
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
async function sendPremiumOffer(supabase: any, botToken: string, userId: number, featureName: string): Promise<void> {
  const premiumMessage = buildPremiumOfferMessage(featureName);
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


async function sendTelegramMessage(botToken: string, chatId: number, text: string, replyMarkup?: any): Promise<boolean> {
  const url = `${TELEGRAM_API}${botToken}/sendMessage`;
  try {
    console.log(`📤 Sending message to chat ${chatId}...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ sendMessage failed [${response.status}]:`, errorText);
      return false;
    }
    
    console.log(`✅ Message sent successfully to chat ${chatId}`);
    return true;
  } catch (error) {
    console.error(`❌ sendMessage exception for chat ${chatId}:`, error);
    return false;
  }
}

async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string, showAlert: boolean = false) {
  const url = `${TELEGRAM_API}${botToken}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert
    })
  });
}

// FUNGSI BARU: Menggunakan copyMessage untuk meneruskan SEMUA JENIS PESAN tanpa tag "diteruskan oleh"
async function copyTelegramMessage(botToken: string, chatId: number, fromChatId: number, messageId: number) {
  const url = `${TELEGRAM_API}${botToken}/copyMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_id: messageId
    })
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
      console.error('getChatMember error:', data);
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
    console.error('checkChannelMembership exception:', error);
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

// HELPER: Panggil RPC find_and_pair_partner dan kirim notifikasi jika berhasil
async function searchPartnerWithRPC(supabase: any, botToken: string, userId: number): Promise<boolean> {
  console.log(`🔍 searchPartnerWithRPC: Memulai pencarian untuk user ${userId}`);
  
    // Panggil RPC function di database - semua logika matching dilakukan di sini
    const { data, error } = await supabase.rpc('find_and_pair_partner', {
      p_user_id: userId
  // try {
  //   });
    
  //   if (error) {
  //     console.error(`❌ RPC Error:`, error);
  //     // Fallback: masukkan user ke antrian secara manual
  //     await supabase.from('waiting_queue').upsert({
  //       user_id: userId,
  //       joined_at: new Date().toISOString()
  //     });
  //     await supabase.from('telegram_users').update({ state: 'waiting' }).eq('id', userId);
  //     await sendTelegramMessage(botToken, userId, '🔍 Mencari partner untuk kamu...\n\nMohon tunggu sebentar!');
  //     return false;
  //   }
    
    console.log(`📦 RPC Result:`, data);
    
    // Cek hasil RPC
    if (!data.success) {
      // Error dari RPC (user_not_found, user_already_chatting, dll)
      console.log(`⚠️ RPC tidak sukses: ${data.error}`);
      if (data.error === 'user_already_chatting') {
        await sendTelegramMessage(botToken, userId, '⚠️ Kamu sudah dalam sesi chat!');
      }
      return false;
    }
    
    if (!data.matched) {
      // Tidak ada partner yang cocok, user sudah dimasukkan ke antrian oleh RPC
      console.log(`📥 User ${userId} masuk antrian via RPC`);
      await sendTelegramMessage(botToken, userId, '🔍 Mencari partner untuk kamu...\n\nMohon tunggu sebentar!');
      return false;
    }
    
    // Partner ditemukan! Kirim notifikasi ke kedua user
    const partnerId = data.partner_id;
    console.log(`✅ Partner ditemukan via RPC: ${userId} <-> ${partnerId}`);
    
    // Kirim notifikasi pairing berhasil
    await sendPairingNotifications(supabase, botToken, userId, partnerId);
    return true;
    
  } // catch (err) {
  //   console.error(`❌ searchPartnerWithRPC exception:`, err);
  //   // Fallback: masukkan user ke antrian
  //   await supabase.from('waiting_queue').upsert({
  //     user_id: userId,
  //     joined_at: new Date().toISOString()
  //   });
  //   await supabase.from('telegram_users').update({ state: 'waiting' }).eq('id', userId);
  //   await sendTelegramMessage(botToken, userId, '🔍 Mencari partner untuk kamu...\n\nMohon tunggu sebentar!');
  //   return false;
  // }
}

// HELPER: Kirim notifikasi setelah pairing berhasil
async function sendPairingNotifications(supabase: any, botToken: string, user1Id: number, user2Id: number): Promise<void> {
  

  // Get premium status for both users
  const [{ data: user1Data }, { data: user2Data }] = await Promise.all([
    supabase.from('telegram_users').select('premium_until').eq('id', user1Id).single(),
    supabase.from('telegram_users').select('premium_until').eq('id', user2Id).single()
  ]);

  const user1IsPremium = user1Data?.premium_until && new Date(user1Data.premium_until) > new Date();
  const user2IsPremium = user2Data?.premium_until && new Date(user2Data.premium_until) > new Date();

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

  // Send notifications in parallel
  await Promise.all([
    sendTelegramMessage(
      botToken, 
      user1Id, 
      `✅ <b>Partner ditemukan!</b> Mulai ngobrol sekarang.\n\n🎁 Gift Partner: ${user2ReactionCount} gift\n${user2Stats}`,
      buildChatKeyboard(user1IsPremium)
    ),
    sendTelegramMessage(
      botToken, 
      user2Id, 
      `✅ <b>Partner ditemukan!</b> Mulai ngobrol sekarang.\n\n🎁 Gift Partner: ${user1ReactionCount} gift\n${user1Stats}`,
      buildChatKeyboard(user2IsPremium)
    )
  ]);
}

// LEGACY: Keep old function name as alias for backward compatibility
async function searchPartnerWithQueueCheck(supabase: any, botToken: string, userId: number): Promise<boolean> {
  return searchPartnerWithRPC(supabase, botToken, userId);
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
  await sendPremiumOffer(supabase, botToken, userId, 'pilih target lokasi');
}

// Daftar lokasi Indonesia
const LOCATION_LIST = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Kepulauan Riau',
  'Jambi', 'Sumatera Selatan', 'Bangka Belitung', 'Bengkulu', 'Lampung',
  'DKI Jakarta', 'Banten', 'Jawa Barat', 'Jawa Tengah', 'DI Yogyakarta', 'Jawa Timur',
  'Bali', 'NTB', 'NTT',
  'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara',
  'Sulawesi Utara', 'Gorontalo', 'Sulawesi Tengah', 'Sulawesi Barat', 'Sulawesi Selatan', 'Sulawesi Tenggara',
  'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Selatan', 'Papua Tengah', 'Papua Pegunungan'
];

// Helper: Show premium offer for target gender (non-premium users)
async function showTargetGenderPremiumOffer(supabase: any, botToken: string, userId: number) {
  await sendPremiumOffer(supabase, botToken, userId, 'pilih target gender');
}

// LEGACY: pairUsers - sekarang menggunakan RPC, fungsi ini hanya untuk backward compatibility
// Tidak digunakan lagi karena logika sudah di database RPC find_and_pair_partner

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

// Optimized: Send pending promo when user becomes idle - USING RPC
async function sendPendingPromoToUser(supabase: any, botToken: string, userId: number) {
  // Get waiting_idle promos using RPC (more cost-effective)
  const { data: pendingPromos, error } = await supabase.rpc('get_waiting_idle_promos', { p_user_id: userId });

  if (error || !pendingPromos || pendingPromos.length === 0) return;

  const promo = pendingPromos[0];
  
  // Send using optimized helper
  const result = await sendPromoToUser(
    botToken, 
    userId, 
    promo.message_text, 
    promo.photo_url, 
    promo.promo_buttons
  );

  if (result.success && result.messageId) {
    // Mark as sent using RPC
    await supabase.rpc('mark_promo_sent', { p_promo_id: promo.id, p_message_id: result.messageId });
    console.log(`✅ Promo (waiting_idle) terkirim ke user ${userId}`);
  } else if (result.blocked) {
    await supabase.from('promo_queue').update({ status: 'failed_blocked' }).eq('id', promo.id);
  }
}

async function endChat(supabase: any, botToken: string, userId: number): Promise<boolean> {
  console.log(`🔚 endChat: User ${userId} mengakhiri chat`);
  
  // === ATOMIC CHECK: Ambil partner_id DAN reset user dalam satu operasi ===
  // Ini mencegah race condition dimana kedua user mengakhiri bersamaan
  const { data: user } = await supabase
    .from('telegram_users')
    .select('partner_id, state')
    .eq('id', userId)
    .single();

  const partnerId = user?.partner_id;
  const userState = user?.state;
  
  // Jika user tidak dalam state chatting atau tidak punya partner, skip
  if (userState !== 'chatting' || !partnerId) {
    console.log(`⚠️ User ${userId} tidak dalam chat (state: ${userState}, partner: ${partnerId})`);
    return false;
  }

  // === ATOMIC RESET: Reset user HANYA jika masih punya partner yang sama ===
  // Ini mencegah double processing
  const { data: resetResult, error: resetError } = await supabase
    .from('telegram_users')
    .update({ state: 'idle', partner_id: null })
    .eq('id', userId)
    .eq('partner_id', partnerId)  // Kondisi tambahan untuk atomic check
    .select();
  
  // Jika tidak ada row yang di-update, berarti sudah di-proses oleh partner
  if (resetError || !resetResult || resetResult.length === 0) {
    console.log(`⚠️ User ${userId} sudah di-reset oleh partner`);
    return false;
  }
  
  console.log(`✅ User ${userId} berhasil di-reset`);

  // === Reset partner ===
  // Cek dulu apakah partner masih punya kita sebagai partner
  const { data: partnerResetResult } = await supabase
    .from('telegram_users')
    .update({ state: 'idle', partner_id: null })
    .eq('id', partnerId)
    .eq('partner_id', userId)  // Hanya reset jika partner masih connected ke kita
    .select();
  
  // Jika berhasil reset partner, kirim notifikasi ke partner
  if (partnerResetResult && partnerResetResult.length > 0) {
    console.log(`✅ Partner ${partnerId} berhasil di-reset, kirim notifikasi`);
    
    // Build combined keyboard with reactions + Cari Partner + Filters + Reconnect
    const combinedPartnerKeyboard = {
      inline_keyboard: [
        [
          { text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }
        ],
        [
          { text: '🔄 Hubungi Kembali', callback_data: `reconnect_${userId}` }
        ]
      ]
    };

    await sendTelegramMessage(
      botToken, 
      partnerId, 
      `⚠️ Partner mengakhiri chat.\n\n✨ Bagaimana pengalaman chat kamu? Beri rating untuk partner!`,
      combinedPartnerKeyboard
    );
    
    // Kirim promo yang tertunda ke partner yang kembali idle
    await sendPendingPromoToUser(supabase, botToken, partnerId);
  } else {
    console.log(`⚠️ Partner ${partnerId} sudah di-reset sebelumnya (atau state berubah)`);
  }

  // Remove from queue if in queue
  await supabase.from('waiting_queue').delete().eq('user_id', userId);

  // Build end chat keyboard for the user who ended with reconnect option
  const endChatKeyboard = {
    inline_keyboard: [
        [
          { text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }
        ],
        [
          { text: '🔄 Hubungi Kembali', callback_data: `reconnect_${userId}` }
        ]
    ]
  };

  await sendTelegramMessage(
    botToken, 
    userId, 
    `👋 Anda mengakhiri chat. Pilih aksi:`,
    endChatKeyboard
  );
  
  // Kirim promo yang tertunda ke user yang kembali idle
  await sendPendingPromoToUser(supabase, botToken, userId);
  
  return true;
}

// --- BACKGROUND JOB LOGIC (ESTAFET) - COST OPTIMIZED v2 ---

// ===============================
// CLEANUP JOB - Fire-and-Forget dengan Estafet
// ===============================

// Fire-and-Forget delete Telegram message (tidak await response)
function fireAndForgetDeleteMessage(botToken: string, chatId: number, messageId: number): void {
  fetch(`${TELEGRAM_API}${botToken}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  }).catch(() => {}); // Ignore errors - fire and forget
}

// Sleep helper untuk delay anti-flood
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function handleCleanupJob(req: Request, supabase: any, botToken: string, serviceRoleKey: string) {
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 25000; // 25 detik max (safety margin)
  const BATCH_SIZE = 50;
  const DELAY_MS = 40; // Delay 40ms antar request Telegram untuk anti-flood
  
  console.log("🧹 Cleanup Job: Memulai pembersihan data sampah...");
  
  let cleanedPromos = 0;
  let cleanedTopups = 0;
  let cleanedPremiums = 0;
  let hasMoreData = false;
  
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  
  // ===========================================
  // 1. CLEANUP EXPIRED PROMO MESSAGES
  // ===========================================
  console.log("📢 Cleaning expired promo messages...");
  
  const { data: expiredPromos } = await supabase
    .from('promo_queue')
    .select('id, user_id, sent_message_id')
    .lt('expires_at', now.toISOString())
    .in('status', ['sent', 'pending', 'waiting_idle'])
    .limit(BATCH_SIZE);
  
  if (expiredPromos && expiredPromos.length > 0) {
    console.log(`🗑️ Found ${expiredPromos.length} expired promos to clean`);
    
    for (const promo of expiredPromos) {
      // Fire-and-forget delete Telegram message jika ada
      if (promo.sent_message_id && promo.user_id) {
        fireAndForgetDeleteMessage(botToken, promo.user_id, promo.sent_message_id);
        await sleep(DELAY_MS); // Anti-flood delay
      }
      
      // Check timeout
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        hasMoreData = true;
        break;
      }
    }
    
    // Batch delete dari database
    const expiredIds = expiredPromos.map((p: any) => p.id);
    await supabase.from('promo_queue').delete().in('id', expiredIds);
    cleanedPromos = expiredPromos.length;
  }
  
  // ===========================================
  // 2. CLEANUP STALE TOP-UP REQUESTS (> 30 menit pending)
  // ===========================================
  if (Date.now() - startTime < MAX_EXECUTION_TIME) {
    console.log("💰 Cleaning stale top-up requests...");
    
    const { data: staleTopups } = await supabase
      .from('topup_requests')
      .select('id, user_id, message_id')
      .eq('status', 'pending')
      .lt('created_at', thirtyMinutesAgo.toISOString())
      .limit(BATCH_SIZE);
    
    if (staleTopups && staleTopups.length > 0) {
      console.log(`🗑️ Found ${staleTopups.length} stale top-up requests`);
      
      for (const topup of staleTopups) {
        // Fire-and-forget delete Telegram message jika ada
        if (topup.message_id && topup.user_id) {
          fireAndForgetDeleteMessage(botToken, topup.user_id, topup.message_id);
          await sleep(DELAY_MS);
        }
        
        // Reset user state jika masih awaiting_payment
        await supabase
          .from('telegram_users')
          .update({ state: 'idle' })
          .eq('id', topup.user_id)
          .eq('state', 'awaiting_payment');
        
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          hasMoreData = true;
          break;
        }
      }
      
      // Update status ke expired
      const staleIds = staleTopups.map((t: any) => t.id);
      await supabase.from('topup_requests').update({ status: 'expired' }).in('id', staleIds);
      cleanedTopups = staleTopups.length;
    }
  }
  
  // ===========================================
  // 3. CLEANUP STALE PREMIUM REQUESTS (> 30 menit pending)
  // ===========================================
  if (Date.now() - startTime < MAX_EXECUTION_TIME) {
    console.log("⭐ Cleaning stale premium requests...");
    
    const { data: stalePremiums } = await supabase
      .from('premium_requests')
      .select('id, user_id, message_id')
      .eq('status', 'pending')
      .lt('created_at', thirtyMinutesAgo.toISOString())
      .limit(BATCH_SIZE);
    
    if (stalePremiums && stalePremiums.length > 0) {
      console.log(`🗑️ Found ${stalePremiums.length} stale premium requests`);
      
      for (const premium of stalePremiums) {
        // Fire-and-forget delete Telegram message jika ada
        if (premium.message_id && premium.user_id) {
          fireAndForgetDeleteMessage(botToken, premium.user_id, premium.message_id);
          await sleep(DELAY_MS);
        }
        
        // Reset user state jika masih awaiting_payment
        await supabase
          .from('telegram_users')
          .update({ state: 'idle' })
          .eq('id', premium.user_id)
          .eq('state', 'awaiting_payment');
        
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          hasMoreData = true;
          break;
        }
      }
      
      // Update status ke expired
      const staleIds = stalePremiums.map((p: any) => p.id);
      await supabase.from('premium_requests').update({ status: 'expired' }).in('id', staleIds);
      cleanedPremiums = stalePremiums.length;
    }
  }
  
  // ===========================================
  // 4. CLEANUP STALE PENDING TRANSACTIONS (> 30 menit)
  // ===========================================
  if (Date.now() - startTime < MAX_EXECUTION_TIME) {
    console.log("📋 Cleaning stale pending transactions...");
    
    const { data: stalePending } = await supabase
      .from('pending_transactions')
      .select('id, user_id')
      .eq('status', 'pending')
      .lt('created_at', thirtyMinutesAgo.toISOString())
      .limit(BATCH_SIZE);
    
    if (stalePending && stalePending.length > 0) {
      console.log(`🗑️ Found ${stalePending.length} stale pending transactions`);
      
      // Update status ke expired
      const staleIds = stalePending.map((p: any) => p.id);
      await supabase.from('pending_transactions').update({ status: 'expired' }).in('id', staleIds);
      
      // Reset user states
      const userIds = stalePending.map((p: any) => p.user_id);
      await supabase
        .from('telegram_users')
        .update({ state: 'idle' })
        .in('id', userIds)
        .eq('state', 'awaiting_payment');
    }
  }
  
  // ===========================================
  // 5. CLEANUP ZOMBIE USERS IN WAITING QUEUE (> 5 menit)
  // ===========================================
  if (Date.now() - startTime < MAX_EXECUTION_TIME) {
    console.log("👻 Cleaning zombie users in waiting queue...");
    
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    const { data: zombieQueue } = await supabase
      .from('waiting_queue')
      .select('user_id')
      .lt('joined_at', fiveMinutesAgo.toISOString())
      .limit(BATCH_SIZE);
    
    if (zombieQueue && zombieQueue.length > 0) {
      console.log(`🗑️ Found ${zombieQueue.length} zombie users in queue`);
      
      const zombieIds = zombieQueue.map((z: any) => z.user_id);
      
      // Delete dari waiting_queue
      await supabase.from('waiting_queue').delete().in('user_id', zombieIds);
      
      // Reset state mereka ke idle
      await supabase
        .from('telegram_users')
        .update({ state: 'idle' })
        .in('id', zombieIds)
        .eq('state', 'waiting');
    }
  }
  
  // ===========================================
  // 6. CHECK IF MORE DATA NEEDS CLEANING
  // ===========================================
  const { count: remainingPromos } = await supabase
    .from('promo_queue')
    .select('*', { count: 'exact', head: true })
    .lt('expires_at', now.toISOString())
    .in('status', ['sent', 'pending', 'waiting_idle']);
  
  const { count: remainingTopups } = await supabase
    .from('topup_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('created_at', thirtyMinutesAgo.toISOString());
  
  const { count: remainingPremiums } = await supabase
    .from('premium_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('created_at', thirtyMinutesAgo.toISOString());
  
  const totalRemaining = (remainingPromos || 0) + (remainingTopups || 0) + (remainingPremiums || 0);
  
  // ===========================================
  // 7. LOG HASIL (pg_cron akan memanggil lagi)
  // ===========================================
  if (totalRemaining > 0 || hasMoreData) {
    console.log(`📋 Sisa data: promos=${remainingPromos}, topups=${remainingTopups}, premiums=${remainingPremiums}. pg_cron akan memproses batch berikutnya.`);
  } else {
    console.log(`🎉 CLEANUP SELESAI! Semua data sampah sudah dibersihkan.`);
  }
  
  const duration = Date.now() - startTime;
  console.log(`⏱️ Cleanup job selesai dalam ${duration}ms`);
  
  return new Response(JSON.stringify({ 
    success: true,
    cleaned: {
      promos: cleanedPromos,
      topups: cleanedTopups,
      premiums: cleanedPremiums
    },
    remaining: {
      promos: remainingPromos || 0,
      topups: remainingTopups || 0,
      premiums: remainingPremiums || 0
    },
    duration_ms: duration,
    will_continue: totalRemaining > 0 || hasMoreData
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Parallel send with concurrency limit - OPTIMIZED with pre-filtered users
async function sendPromosBatch(
  botToken: string,
  users: Array<{ id: string; user_id: number; current_state?: string }>,
  messageText: string,
  photoUrl: string | null,
  promoButtons: any,
  supabase: any
): Promise<{ sent: number; waiting: number; blocked: number }> {
  const CONCURRENCY = 25; // Send 25 at a time
  let sent = 0, waiting = 0, blocked = 0;
  
  // Separate idle vs chatting users (state already provided from RPC)
  const idleUsers: typeof users = [];
  const chattingUsers: typeof users = [];
  
  for (const user of users) {
    // If current_state is provided (from RPC), use it directly
    if (user.current_state === 'idle') {
      idleUsers.push(user);
    } else if (user.current_state === 'chatting') {
      chattingUsers.push(user);
    } else {
      // Fallback: if no state provided, treat as idle
      idleUsers.push(user);
    }
  }
  
  // Mark chatting users as waiting_idle (will be sent when they exit chat)
  if (chattingUsers.length > 0) {
    const chattingIds = chattingUsers.map(u => u.id);
    await supabase.from('promo_queue').update({ status: 'waiting_idle' }).in('id', chattingIds);
    waiting = chattingUsers.length;
    console.log(`📋 ${chattingUsers.length} user sedang chatting, promo di-queue untuk nanti`);
  }
  
  // Process idle users in parallel chunks - send immediately
  for (let i = 0; i < idleUsers.length; i += CONCURRENCY) {
    const chunk = idleUsers.slice(i, i + CONCURRENCY);
    
    const results = await Promise.allSettled(
      chunk.map(async (user) => {
        const result = await sendPromoToUser(botToken, user.user_id, messageText, photoUrl, promoButtons);
        return { user, result };
      })
    );
    
    // Batch collect updates
    const sentUpdates: Array<{ id: string; messageId: number }> = [];
    const blockedIds: string[] = [];
    
    for (const res of results) {
      if (res.status === 'fulfilled') {
        const { user, result } = res.value;
        if (result.success && result.messageId) {
          sentUpdates.push({ id: user.id, messageId: result.messageId });
          sent++;
        } else if (result.blocked) {
          blockedIds.push(user.id);
          blocked++;
        }
      }
    }
    
    // Batch DB updates using RPC for sent items
    if (sentUpdates.length > 0) {
      for (const update of sentUpdates) {
        await supabase.rpc('mark_promo_sent', { p_promo_id: update.id, p_message_id: update.messageId });
      }
    }
    
    if (blockedIds.length > 0) {
      await supabase.from('promo_queue').update({ status: 'failed_blocked' }).in('id', blockedIds);
    }
    
    // Small delay between chunks to avoid rate limiting
    if (i + CONCURRENCY < idleUsers.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return { sent, waiting, blocked };
}

async function handlePromoJob(req: Request, supabase: any, botToken: string, serviceRoleKey: string) {
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 28000; // 28 detik max
  const BATCH_SIZE = 150; // Process more per batch (was 50)
  
  console.log("🚀 Promo Job v2: Memulai proses batch (cost-optimized)...");

  // Get pending promos (only id, user_id - minimal data)
  const { data: pendingPromos, error } = await supabase
    .from('promo_queue')
    .select('id, user_id, message_text, photo_url, promo_buttons, expires_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error('Error fetching promo queue:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!pendingPromos || pendingPromos.length === 0) {
    console.log("✅ Tidak ada antrean pending. Job done.");
    return new Response(JSON.stringify({ message: 'Done' }), { status: 200 });
  }

  const now = new Date();
  
  // Filter out expired (batch delete)
  const expiredIds = pendingPromos
    .filter((p: any) => new Date(p.expires_at) < now)
    .map((p: any) => p.id);
  
  if (expiredIds.length > 0) {
    await supabase.from('promo_queue').update({ status: 'expired' }).in('id', expiredIds);
  }
  
  // Valid promos to send
  const validPromos = pendingPromos.filter((p: any) => new Date(p.expires_at) >= now);
  
  if (validPromos.length === 0) {
    console.log("✅ Semua promo expired. Job done.");
    return new Response(JSON.stringify({ message: 'All expired' }), { status: 200 });
  }

  // Use first promo's content (they should all be same)
  const firstPromo = validPromos[0];
  const messageText = firstPromo.message_text;
  const photoUrl = firstPromo.photo_url;
  const promoButtons = firstPromo.promo_buttons;

  // Send promos in optimized batch
  const stats = await sendPromosBatch(
    botToken,
    validPromos.map((p: any) => ({ id: p.id, user_id: p.user_id })),
    messageText,
    photoUrl,
    promoButtons,
    supabase
  );

  console.log(`📊 Batch selesai: Sent=${stats.sent}, Waiting=${stats.waiting}, Blocked=${stats.blocked}`);

  // Check remaining and trigger next batch
  const { count: remainingPending } = await supabase
    .from('promo_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  // LOG HASIL (pg_cron akan memanggil lagi jika masih ada pending)
  if (remainingPending && remainingPending > 0) {
    console.log(`📋 Sisa ${remainingPending} pending. pg_cron akan memproses batch berikutnya.`);
  } else {
    console.log(`🎉 SEMUA PROMO SELESAI DIKIRIM!`);
  }

  return new Response(JSON.stringify({ 
    processed: stats.sent,
    moved_to_waiting: stats.waiting,
    blocked: stats.blocked,
    remaining_pending: remainingPending 
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
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

    // 1. JALUR BACKGROUND JOB - PROMO
    if (target === 'promo_job') {
      return handlePromoJob(req, supabase, botToken, supabaseKey);
    }
    
    // 2. JALUR BACKGROUND JOB - CLEANUP
    if (target === 'cleanup_job') {
      return handleCleanupJob(req, supabase, botToken, supabaseKey);
    }
    // Baca body dengan error handling
    let update: TelegramUpdate;
    try {
      const text = await req.text();
      console.log('Raw request body:', text);
      
      if (!text || text.trim() === '') {
        console.log('Empty request body, ignoring');
        return new Response('OK', { status: 200 });
      }
      
      update = JSON.parse(text);
      console.log('Parsed update:', JSON.stringify(update));
    } catch (parseError) {
      console.error('Error parsing request:', parseError);
      return new Response('Invalid JSON', { status: 400 });
    }

    // Handle callback queries (emoji rating & NEW: cancel topup)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const callbackData = query.data || '';
      const message = query.message;

      // ************************************************
      // CEK APAKAH USER SUDAH DIBLOKIR (CALLBACK QUERY)
      // ************************************************
      // PENGECUALIAN: pay_fine dan cancel_fine harus diizinkan agar user bisa bayar denda
      const fineAllowedCallbacks = ['pay_fine', 'cancel_fine'];
      
      if (!fineAllowedCallbacks.includes(callbackData)) {
        const userIsBlockedCallback = await isUserBlocked(supabase, userId);
        if (userIsBlockedCallback) {
          // User diblokir, kirim alert dan abaikan
          await answerCallbackQuery(botToken, query.id, '🚫 Akun Anda diblokir. Hubungi @FizatalkCS jika ini kekeliruan.', true);
          return new Response('OK', { status: 200 });
        }
      }

      // === CEK STATE AWAITING_PAYMENT - BLOKIR SEMUA TOMBOL KECUALI CANCEL ===
      // Hanya izinkan cancel_topup, cancel_premium, dan cancel_fine saat sedang dalam pembayaran
      const paymentAllowedCallbacks = ['cancel_topup', 'cancel_premium', 'cancel_fine'];
      
      if (!paymentAllowedCallbacks.includes(callbackData)) {
        const { data: userPaymentCheck } = await supabase
          .from('telegram_users')
          .select('state')
          .eq('id', userId)
          .single();
        
        if (userPaymentCheck?.state === 'awaiting_payment') {
          await answerCallbackQuery(botToken, query.id, '⚠️ Selesaikan atau batalkan pembayaran terlebih dahulu!');
          await sendTelegramMessage(
            botToken, 
            userId, 
            '⚠️ <b>Kamu sedang dalam proses pembayaran!</b>\n\nSelesaikan pembayaran dan <b>kirim bukti trsndfer ke chat ini</b> atau tekan tombol "Batalkan" pada pesan QRIS untuk membatalkan transaksi.'
          );
          return new Response('OK', { status: 200 });
        }
      }

      // --- LOGIKA PEMBATALAN TOP-UP DARI INLINE BUTTON ---
      if (callbackData === 'cancel_topup') {
          // Batalkan topup request pending
          await supabase
              .from('topup_requests')
              .update({ status: 'cancelled' })
              .eq('user_id', userId)
              .eq('status', 'pending');
          
          // Reset state user ke CHATTING atau IDLE
          const { data: userBeforeCancel } = await supabase
            .from('telegram_users')
            .select('partner_id')
            .eq('id', userId)
            .single();

          const newState = userBeforeCancel?.partner_id ? 'chatting' : 'idle';
          
          await supabase
              .from('telegram_users')
              .update({ state: newState })
              .eq('id', userId);

          await answerCallbackQuery(botToken, query.id, '🚫 Transaksi dibatalkan!');
          
          // Hapus pesan QRIS (bukan edit)
          if (message) {
              await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
          }
          
          // Kirim pesan konfirmasi pembatalan
          const nextActionText = newState === 'chatting' ? 'Anda dapat melanjutkan chat Anda.' : 'Anda dapat memulai chat baru dengan /start.';
          await sendTelegramMessage(
            botToken,
            userId,
            `🚫 <b>TRANSAKSI TOP-UP DIBATALKAN</b>\n\n${nextActionText}\n\nGunakan /topup untuk top-up koin lagi.`
          );
          
          return new Response('OK', { status: 200 });
      }

      // --- LOGIKA BAYAR DENDA (BUKA BLOKIR) ---
      if (callbackData === 'pay_fine') {
        await answerCallbackQuery(botToken, query.id);
        
        const FINE_AMOUNT = 10000; // Denda Rp10.000
        
        // Generate unique code untuk pembayaran
        const { data: uniqueCodeResult } = await supabase.rpc('generate_unique_payment_code');
        const uniqueCode = uniqueCodeResult || Math.floor(Math.random() * 999) + 1;
        const totalAmount = FINE_AMOUNT + uniqueCode;
        
        // Simpan transaksi denda ke pending_transactions
        await supabase.from('pending_transactions').insert({
          user_id: userId,
          amount: FINE_AMOUNT,
          unique_code: uniqueCode,
          total_amount: totalAmount,
          status: 'pending',
          admin_notes: 'FINE_PAYMENT' // Mark sebagai pembayaran denda
        });
        
        // Update state user ke awaiting_payment
        await supabase
          .from('telegram_users')
          .update({ state: 'awaiting_payment' })
          .eq('id', userId);
        
        // Kirim QRIS pembayaran
        await sendQRISPayment({
          supabase,
          botToken,
          chatId: userId,
          title: 'PEMBAYARAN DENDA - BUKA BLOKIR',
          price: FINE_AMOUNT,
          uniqueCode,
          totalAmount,
          expiryMinutes: 30,
          cancelCallbackData: 'cancel_fine'
        });
        
        // Notifikasi admin
        const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
        if (csChatId) {
          const userName = query.from.username ? `@${query.from.username}` : query.from.first_name || 'Unknown';
          await sendTelegramMessage(
            botToken,
            parseInt(csChatId),
            `💰 <b>PEMBAYARAN DENDA DIMULAI</b>\n\n👤 User: ${userName}\n🆔 ID: <code>${userId}</code>\n💵 Total: Rp ${totalAmount.toLocaleString('id-ID')}\n\n⏳ Menunggu bukti pembayaran...`
          );
        }
        
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMBATALAN DENDA DARI INLINE BUTTON ---
      if (callbackData === 'cancel_fine') {
        // Batalkan pending transaction dengan notes FINE_PAYMENT
        await supabase
          .from('pending_transactions')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .eq('admin_notes', 'FINE_PAYMENT');
        
        // Reset state user ke idle (tetap blocked)
        await supabase
          .from('telegram_users')
          .update({ state: 'idle' })
          .eq('id', userId);

        await answerCallbackQuery(botToken, query.id, '🚫 Pembayaran denda dibatalkan!');
        
        // Hapus pesan QRIS
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }
        
        // Kirim pesan konfirmasi (tetap blocked)
        const blockedKeyboard = {
          inline_keyboard: [
            [{ text: '💰 Bayar Denda Rp10.000', callback_data: 'pay_fine' }]
          ]
        };
        
        await sendTelegramMessage(
          botToken,
          userId,
          `🚫 <b>Pembayaran Denda Dibatalkan</b>\n\nAkun Anda masih dalam status diblokir.\n\n💰 Bayar denda Rp10.000 untuk membuka blokir.`,
          blockedKeyboard
        );
        
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMILIHAN GENDER (DARI /START - PERTAMA KALI) ---
      if (callbackData === 'gender_cowok' || callbackData === 'gender_cewek') {
        const selectedGender = callbackData === 'gender_cowok' ? 'cowok' : 'cewek';
        
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

        // Cek apakah user sudah set lokasi
        const { data: userLocationCheck } = await supabase
          .from('telegram_users')
          .select('location')
          .eq('id', userId)
          .single();

        // Jika belum set lokasi, minta set lokasi dulu
        if (!userLocationCheck?.location) {
          // Buat keyboard lokasi (4 kolom per baris)
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

        // Jika sudah set lokasi, langsung cari partner dengan logika baru
        // Cek antrian dulu, jika tidak ada yang cocok baru masuk antrian
        await searchPartnerWithQueueCheck(supabase, botToken, userId);

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMILIHAN LOKASI AWAL (DARI /START - PERTAMA KALI) ---
      if (callbackData.startsWith('init_loc_')) {
        const selectedLocation = callbackData.replace('init_loc_', '');
        
        // Hapus pesan pilihan lokasi
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Update location user
        await supabase
          .from('telegram_users')
          .update({ location: selectedLocation })
          .eq('id', userId);

        await answerCallbackQuery(botToken, query.id, `✅ Lokasi diset: ${selectedLocation}`);

        // Langsung cari partner dengan logika baru
        // Cek antrian dulu, jika tidak ada yang cocok baru masuk antrian
        await searchPartnerWithQueueCheck(supabase, botToken, userId);

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA SHOW TARGET PREMIUM (NON-PREMIUM USER CLICKED BUTTON) ---
      if (callbackData === 'show_target_premium') {
        await answerCallbackQuery(botToken, query.id);
        await showTargetGenderPremiumOffer(supabase, botToken, userId);
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMILIHAN TARGET GENDER (PREMIUM) ---
      if (callbackData === 'target_cowok' || callbackData === 'target_cewek' || callbackData === 'target_semua') {
        const targetGender = callbackData === 'target_cowok' ? 'cowok' : callbackData === 'target_cewek' ? 'cewek' : 'semua';
        
        // Update target_gender user tanpa hapus pesan
        await supabase
          .from('telegram_users')
          .update({ target_gender: targetGender })
          .eq('id', userId);

        const targetLabel = targetGender === 'cowok' ? 'Cowok 👦' : targetGender === 'cewek' ? 'Cewek 👧' : 'Semua 👥';
        await answerCallbackQuery(botToken, query.id, `✅ Target gender: ${targetLabel}`);

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMILIHAN TARGET LOKASI (PREMIUM) ---
      if (callbackData.startsWith('target_loc_')) {
        const targetLocation = callbackData.replace('target_loc_', '');
        
        // Update target_location user tanpa hapus pesan
        await supabase
          .from('telegram_users')
          .update({ target_location: targetLocation })
          .eq('id', userId);

        const targetLabel = targetLocation === 'semua' ? 'Semua 🌏' : `📍 ${targetLocation}`;
        await answerCallbackQuery(botToken, query.id, `✅ Target lokasi: ${targetLabel}`);

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA CHANGE LOCATION (INLINE BUTTON - PREMIUM ONLY) ---
      if (callbackData === 'change_location') {
        // Cek apakah user premium
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until, target_location')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

        if (!isPremium) {
          await answerCallbackQuery(botToken, query.id);
          await showLocationFilterPremiumOffer(supabase, botToken, userId);
          return new Response('OK', { status: 200 });
        }

        // Buat keyboard lokasi untuk premium (dengan opsi Semua di atas)
        const locationButtons = [[{ text: '🌏 Semua Lokasi', callback_data: 'target_loc_semua' }]];
        for (let i = 0; i < LOCATION_LIST.length; i += 3) {
          const row = [];
          for (let j = 0; j < 3 && i + j < LOCATION_LIST.length; j++) {
            const loc = LOCATION_LIST[i + j];
            row.push({ text: loc, callback_data: `target_loc_${loc}` });
          }
          locationButtons.push(row);
        }

        const locationKeyboard = {
          inline_keyboard: locationButtons
        };

        const currentTarget = userData?.target_location 
          ? (userData.target_location === 'semua' ? 'Semua 🌏' : `📍 ${userData.target_location}`) 
          : 'Semua 🌏';

        await answerCallbackQuery(botToken, query.id);
        await sendTelegramMessage(
          botToken,
          userId,
          `📍 <b>Pilih Target Lokasi Chat</b>\n\n📌 Target saat ini: <b>${currentTarget}</b>\n\nPilih lokasi partner yang ingin kamu ajak chat:`,
          locationKeyboard
        );

        return new Response('OK', { status: 200 });
      }

      // Handler untuk set_loc_* (dari /lokasi command - TANPA auto-search partner)
      if (callbackData.startsWith('set_loc_')) {
        const selectedLocation = callbackData.replace('set_loc_', '');
        
        // Hapus pesan pilihan lokasi
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Update location user
        await supabase
          .from('telegram_users')
          .update({ location: selectedLocation })
          .eq('id', userId);

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

        // Ambil data terbaru
        const { data: senderData } = await supabase
            .from('telegram_users')
            .select('coins, state, partner_id')
            .eq('id', userId)
            .single();

        // Validasi Status
        if (senderData?.state !== 'chatting' || !senderData?.partner_id) {
            await answerCallbackQuery(botToken, query.id, '❌ Tidak sedang chatting!');
            if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
            return new Response('OK', { status: 200 });
        }

        const partnerId = senderData.partner_id;
        const currentCoins = senderData.coins || 0;

  
        // Validasi Saldo
        if (currentCoins < selectedGift.price) {
            // 1. Beri notifikasi toast bahwa saldo kurang
            await answerCallbackQuery(botToken, query.id, '❌ Saldo tidak cukup, silakan Top Up');

            // 2. Langsung EDIT pesan menjadi Menu Top Up
            if (message) {
                const url = `${TELEGRAM_API}${botToken}/editMessageText`;
                await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    // Tampilkan detail kenapa dialihkan
                    text: `⚠️ <b>Saldo Tidak Cukup!</b>\n\n🎁 Harga Gift: <b>${selectedGift.price} koin</b>\n💰 Saldo Kamu: <b>${currentCoins} koin</b>\n\nSilakan isi ulang saldo untuk melanjutkan:`,
                    parse_mode: 'HTML',
                    reply_markup: buildTopupKeyboard() // Panggil helper keyboard topup
                  })
                });
            }
            return new Response('OK', { status: 200 });
        }

        // --- EKSEKUSI TRANSAKSI ---
        // 1. Kurangi Saldo Pengirim
        const newSenderBalance = currentCoins - selectedGift.price;
        await supabase.from('telegram_users').update({ coins: newSenderBalance }).eq('id', userId);
        
        await supabase.from('coin_transactions').insert({
            user_id: userId,
            amount: -selectedGift.price,
            type: 'gift_sent',
            description: `Kirim gift ${selectedGift.name}`
        });

        // 2. Tambah Saldo Partner (75% Payout)
        const payoutAmount = Math.floor(selectedGift.price * 0.75); // 75% Bulat
        const { data: partnerData } = await supabase.from('telegram_users').select('coins').eq('id', partnerId).single();
        const newPartnerBalance = (partnerData?.coins || 0) + payoutAmount;

        await supabase.from('telegram_users').update({ coins: newPartnerBalance }).eq('id', partnerId);
        
        await supabase.from('coin_transactions').insert({
            user_id: partnerId,
            amount: payoutAmount,
            type: 'gift_received',
            description: `Terima gift ${selectedGift.name}`
        });

        // 3. Update Tampilan Menu Gift (Saldo berkurang, menu tetap terbuka)
        if (message) {
            const url = `${TELEGRAM_API}${botToken}/editMessageText`;
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                // Update teks saldo
                text: `🎁 <b>Kirim Gift FizaTalk</b>\n\n💰 Saldo kamu: <b>${newSenderBalance} koin</b>\n\nPilih gift untuk dikirim ke partner:`,
                parse_mode: 'HTML',
                reply_markup: buildGiftKeyboard()
              })
            });
        }

        // 4. Notifikasi Toast
        await answerCallbackQuery(botToken, query.id, `✅ Terkirim: ${selectedGift.name}`);

        // 5. Pesan ke Chat Log (Pengirim)
        await sendTelegramMessage(botToken, userId, `🎁 Kamu mengirim <b>${selectedGift.name}</b> ${selectedGift.emoji}`);

        // 6. Pesan ke Partner (Penerima)
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
      // 4. HANDLER PROSES TOP UP (Buat Invoice)
      // ============================================================
      if (callbackData.startsWith('init_topup_')) {
        const amount = parseInt(callbackData.replace('init_topup_', ''));
        const COIN_PRICE = 10; // 1 koin = Rp 10 (100 koin = Rp 1.000)

        // Bersihkan transaksi pending lama
        await supabase
            .from('topup_requests')
            .update({ status: 'cancelled' })
            .eq('user_id', userId)
            .eq('status', 'pending')
            .is('payment_proof', null);

        // Generate Kode Unik
        const uniqueCode = Math.floor(Math.random() * 999) + 1;
        const totalPrice = (amount * COIN_PRICE) + uniqueCode;

        

        // Set state ke awaiting_payment
        await supabase.from('telegram_users').update({ state: 'awaiting_payment' }).eq('id', userId);

        // Hapus menu Top Up
        if (message) await deleteTelegramMessage(botToken, message.chat.id, message.message_id);

        // Kirim QRIS menggunakan helper function
        const qrisMsgId = await sendQRISPayment({
          supabase,
          botToken,
          chatId: userId,
          title: `TOP-UP ${amount.toLocaleString('id-ID')} KOIN`,
          price: amount * COIN_PRICE,
          uniqueCode,
          totalAmount: totalPrice,
          expiryMinutes: 30,
          cancelCallbackData: 'cancel_topup'
        });

        // INSERT KE DB DENGAN MESSAGE ID
        if (qrisMsgId) {
            await supabase.from('topup_requests').insert({
                user_id: userId,
                amount: amount,
                unique_code: uniqueCode,
                status: 'pending',
                payment_proof: null,
                message_id: qrisMsgId
            });
            await answerCallbackQuery(botToken, query.id, '✅ Invoice dibuat (30 menit)');
        } else {
            await sendTelegramMessage(botToken, userId, '❌ Gagal membuat invoice. Coba lagi.');
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
        
        await searchPartnerWithQueueCheck(supabase, botToken, userId);
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA SEARCH PARTNER (INLINE BUTTON) ---
      if (callbackData === 'search_partner') {
        // PENTING: Pastikan user ada di database sebelum proses
        await smartUpsertUser(supabase, userId, query.from.username, query.from.first_name);

        // Cek state user saat ini
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('gender, state, partner_id')
          .eq('id', userId)
          .single();

        // Jika sedang chatting, tampilkan opsi stop dan next
        if (userData?.state === 'chatting') {
          const chattingKeyboard = {
            inline_keyboard: [
              [
                { text: '🛑 Stop', callback_data: 'chat_stop' },
                { text: '⏭️ Next', callback_data: 'chat_next' }
              ]
            ]
          };
          await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sedang dalam chat!');
          await sendTelegramMessage(botToken, userId, '⚠️ Kamu sedang dalam chat.\n\nPilih aksi:', chattingKeyboard);
          return new Response('OK', { status: 200 });
        }

        // Jika sedang dalam antrian (waiting), tampilkan pemberitahuan dan opsi stop
        if (userData?.state === 'waiting') {
          const { data: queueData } = await supabase
          .from('waiting_queue')
          .select('user_id')
          .eq('user_id', userId)
          .single();
    
          if (!queueData) {
            // DITEMUKAN ZOMBIE! Perbaiki statusnya.
            console.log(`🧟 Zombie User Detected: ${userId}. Resetting state to idle.`);
            await supabase
              .from('telegram_users')
              .update({ state: 'idle' }) // Paksa jadi idle dulu
              .eq('id', userId);
              
            // Lanjut ke logika pencarian di bawah seolah-olah dia user normal...
          } else {
                await answerCallbackQuery(botToken, query.id, '⏳ Sedang dalam antrian...');
                await sendTelegramMessage(botToken, userId, '⏳ Kamu sedang dalam antrian menunggu partner.\n\nMohon tunggu sebentar!');
                return new Response('OK', { status: 200 });
              }
        }
        // Cek apakah user sudah set gender
        if (!userData?.gender) {
          // Tampilkan pilihan gender dulu
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
            '👋 <b>Sebelum mulai, pilih gender kamu dulu ya:</b>',
            genderKeyboard
          );
          return new Response('OK', { status: 200 });
        }

        // CEK KEANGGOTAAN CHANNEL HANYA JIKA USER SUDAH TERDAFTAR > 1 MINGGU (hemat biaya cloud)
        const shouldCheckChannel = await shouldShowChannelJoin(supabase, userId);
        if (shouldCheckChannel) {
          const { isMember: isChannelMember, botNotAdmin: botNotAdminSearch } = await checkChannelMembership(botToken, userId, REQUIRED_CHANNEL);
          
          if (!isChannelMember) {
            await answerCallbackQuery(botToken, query.id, '⚠️ Gabung channel dulu!');
            await sendJoinChannelMessage(botToken, userId, botNotAdminSearch);
            return new Response('OK', { status: 200 });
          }
        }

        // User idle - langsung cari partner dengan logika baru
        await answerCallbackQuery(botToken, query.id, '🔍 Mencari partner...');
        
        // Cek antrian dulu, jika tidak ada yang cocok baru masuk antrian
        await searchPartnerWithQueueCheck(supabase, botToken, userId);

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA CHANGE TARGET (INLINE BUTTON) ---
      if (callbackData === 'change_target') {
        // Cek apakah user premium
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until, target_gender')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

        if (!isPremium) {
          await answerCallbackQuery(botToken, query.id);
          await showTargetGenderPremiumOffer(supabase, botToken, userId);
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

        await answerCallbackQuery(botToken, query.id);
        await sendTelegramMessage(
          botToken,
          userId,
          `🎯 <b>Pilih Target Gender Chat</b>\n\n📌 Target saat ini: <b>${currentTarget}</b>\n\nPilih siapa yang ingin kamu ajak chat:`,
          targetKeyboard
        );

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA CHAT NEXT (INLINE BUTTON) ---
      if (callbackData === 'chat_next') {
        // PENTING: Update last_active (hanya sekali sehari) karena user aktif menekan next
        await smartUpsertUser(supabase, userId, query.from.username, query.from.first_name);

        // CEK KEANGGOTAAN CHANNEL HANYA JIKA USER SUDAH TERDAFTAR > 1 MINGGU (hemat biaya cloud)
        const shouldCheckChannelNext = await shouldShowChannelJoin(supabase, userId);
        if (shouldCheckChannelNext) {
          const { isMember: isChannelMemberNext, botNotAdmin: botNotAdminNext } = await checkChannelMembership(botToken, userId, REQUIRED_CHANNEL);
          
          if (!isChannelMemberNext) {
            await answerCallbackQuery(botToken, query.id, '⚠️ Gabung channel dulu!');
            await sendJoinChannelMessage(botToken, userId, botNotAdminNext);
            return new Response('OK', { status: 200 });
          }
        }

        // Cek state user saat ini
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('state, partner_id')
          .eq('id', userId)
          .single();

        // Jika sedang dalam antrian (waiting), tampilkan pemberitahuan dan opsi stop
        if (userData?.state === 'waiting') {
          const { data: queueData } = await supabase
          .from('waiting_queue')
          .select('user_id')
          .eq('user_id', userId)
          .single();
    
          if (!queueData) {
            // DITEMUKAN ZOMBIE! Perbaiki statusnya.
            console.log(`🧟 Zombie User Detected: ${userId}. Resetting state to idle.`);
            await supabase
              .from('telegram_users')
              .update({ state: 'idle' }) // Paksa jadi idle dulu
              .eq('id', userId);
              
            // Lanjut ke logika pencarian di bawah seolah-olah dia user normal...
          } else {
                await answerCallbackQuery(botToken, query.id, '⏳ Sedang dalam antrian...');
                await sendTelegramMessage(botToken, userId, '⏳ Kamu sedang dalam antrian menunggu partner.\n\nMohon tunggu sebentar!');
                return new Response('OK', { status: 200 });
              }
        }

        // Jika sedang chatting, akhiri chat dan langsung cari partner baru
        if (userData?.state === 'chatting' && userData?.partner_id) {
          await answerCallbackQuery(botToken, query.id, '⏭️Mencari partner baru...');
          
          const partnerId = userData.partner_id;

          // === ATOMIC RESET: Reset user HANYA jika masih punya partner yang sama ===
          const { data: resetResult, error: resetError } = await supabase
            .from('telegram_users')
            .update({ state: 'idle', partner_id: null })
            .eq('id', userId)
            .eq('partner_id', partnerId)
            .select();
          
          // Jika tidak ada row yang di-update, chat sudah berakhir
          if (resetError || !resetResult || resetResult.length === 0) {
            console.log(`⚠️ Chat sudah berakhir untuk user ${userId}`);
            // Langsung cari partner baru dengan logika baru
            await searchPartnerWithQueueCheck(supabase, botToken, userId);
            return new Response('OK', { status: 200 });
          }

          // Reset partner dengan atomic check
          const { data: partnerResetResult } = await supabase
            .from('telegram_users')
            .update({ state: 'idle', partner_id: null })
            .eq('id', partnerId)
            .eq('partner_id', userId)
            .select();
          
          // Jika berhasil reset partner, kirim notifikasi
          if (partnerResetResult && partnerResetResult.length > 0) {
            const combinedPartnerKeyboard = {
              inline_keyboard: [
        
                [
                  { text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }
                ],
                [
                  { text: '🔄 Hubungi Kembali', callback_data: `reconnect_${userId}` }
                ]
              ]
            };

            await sendTelegramMessage(
              botToken, 
              partnerId, 
              `⚠️ Partner mengakhiri chat.\n\n✨ Bagaimana pengalaman chat kamu? Beri penilaian untuk partner!`,
              combinedPartnerKeyboard
            );
            
            await sendPendingPromoToUser(supabase, botToken, partnerId);
          }

          // Remove from queue
          await supabase.from('waiting_queue').delete().eq('user_id', userId);

          // Kirim pesan ke user yang menekan next
          await sendTelegramMessage(botToken, userId, '🔄 <b>Mengakhiri chat dan mencari partner baru...</b>');
          
          await sendPendingPromoToUser(supabase, botToken, userId);

          // Start searching again dengan logika baru
          // Cek antrian dulu, jika tidak ada yang cocok baru masuk antrian
          await searchPartnerWithQueueCheck(supabase, botToken, userId);

          return new Response('OK', { status: 200 });
        }

        // Jika user tidak dalam chat (idle), langsung cari partner dengan logika baru
        await answerCallbackQuery(botToken, query.id, '🔍 Mencari partner...');
        
        // Cek antrian dulu, jika tidak ada yang cocok baru masuk antrian
        await searchPartnerWithQueueCheck(supabase, botToken, userId);

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA CHAT STOP (INLINE BUTTON) ---
      if (callbackData === 'chat_stop') {
        // PENTING: Update last_active (hanya sekali sehari) karena user aktif menekan stop
        await smartUpsertUser(supabase, userId, query.from.username, query.from.first_name);
        
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
          
          // Get premium file_id from database
          const premiumFileId = await getPremiumFileId(supabase);

          const buyPremiumKeyboard = {
            inline_keyboard: [
              [
                { text: '📦 1 Minggu - Rp 25.000', callback_data: 'buy_premium_normal_7' },
              ],
              [
                { text: '📦 1 Bulan - Rp 60.000', callback_data: 'buy_premium_normal_30' }
              ]
            ]
          };

          const premiumMessage = `🔒 <b>Fitur Premium Only!</b>

Fitur <b>Hubungi Kembali</b> hanya tersedia untuk user <b>Premium</b>.

✨ <b>KEUNTUNGAN PREMIUM:</b>
• 🔄 Hubungi kembali partner sebelumnya
• 🎯 Pilih target gender chat
• 📍 Pilih target lokasi chat
• ⭐ Badge Premium
• 🚀 Prioritas matching

💰 <b>HARGA PREMIUM:</b>
📦 <b>1 MINGGU:</b> Rp 25.000
📦 <b>1 BULAN:</b> Rp 60.000

💎 Beli sekarang untuk menikmati fitur eksklusif!`;

          if (premiumFileId) {
            try {
              await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: userId,
                  photo: premiumFileId,
                  caption: premiumMessage,
                  parse_mode: 'HTML',
                  reply_markup: buyPremiumKeyboard
                })
              });
            } catch (e) {
              console.error('sendPhoto error for reconnect premium offer:', e);
              await sendTelegramMessage(botToken, userId, premiumMessage, buyPremiumKeyboard);
            }
          } else {
            await sendTelegramMessage(botToken, userId, premiumMessage, buyPremiumKeyboard);
          }

          return new Response('OK', { status: 200 });
        }

        // User sudah premium - tampilkan pesan fitur sedang dikembangkan
        await answerCallbackQuery(botToken, query.id, '🚧 Fitur dalam pengembangan');
        
        await sendTelegramMessage(
          botToken,
          userId,
          `🚧 <b>Fitur Dalam Pengembangan</b>

Terima kasih sudah menjadi user <b>Premium</b>! 💎

Fitur <b>Hubungi Kembali Partner</b> sedang dalam tahap pengembangan dan akan segera tersedia.

Kami akan memberitahu kamu ketika fitur ini sudah siap digunakan! 🔔`,
          {
            inline_keyboard: [
              [
                { text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }
              ]
            ]
          }
        );

        return new Response('OK', { status: 200 });
      }

      // --- DISMISS PROMO & CARI PARTNER ---
      if (callbackData === 'dismiss_promo_search') {
        // Hapus pesan promo
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }
        
        // Pastikan user ada di database (tanpa update last_active untuk hemat biaya)
        await simpleUpsertUser(supabase, userId, query.from.username, query.from.first_name);
        
        // Hapus dari promo_queue jika ada
        await supabase
          .from('promo_queue')
          .delete()
          .eq('user_id', userId)
          .in('status', ['pending', 'waiting_idle']);

        await answerCallbackQuery(botToken, query.id, '🔍 Mencari partner...');
        
        // Langsung cari partner menggunakan helper yang sudah ada
        await searchPartnerWithQueueCheck(supabase, botToken, userId);
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMBELIAN PREMIUM 5 BULAN (150 HARI) + BONUS 5000 KOIN ---
      if (callbackData === 'buy_premium_150') {
        const durationDays = 150; // 5 bulan
        const price = 10000;
        const bonusCoins = 5000;
        
        // Hapus pesan promo
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Cek apakah user sudah premium
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();
        if (isPremium) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sudah Premium!');
          await sendTelegramMessage(
            botToken,
            userId,
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${new Date(userData.premium_until).toLocaleDateString('id-ID')}\n\nGunakan /target untuk memilih gender chat!`
          );
          return new Response('OK', { status: 200 });
        }

        // Batalkan premium request pending sebelumnya yang belum ada bukti bayar
        await supabase
          .from('premium_requests')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('payment_proof', null);

        // Cek apakah ada premium request pending dengan bukti bayar
        const { count: paymentPendingCount } = await supabase
          .from('premium_requests')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .not('payment_proof', 'is', null);

        if (paymentPendingCount && paymentPendingCount > 0) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Transaksi pending!');
          await sendTelegramMessage(
            botToken,
            userId,
            '⚠️ Anda memiliki transaksi premium yang sedang menunggu konfirmasi admin. Mohon tunggu verifikasi.'
          );
          return new Response('OK', { status: 200 });
        }

        // Generate unique code
        const uniqueCode = Math.floor(Math.random() * 999) + 1;
        const totalAmount = price + uniqueCode;

        // Update user state
        await supabase
          .from('telegram_users')
          .update({ state: 'awaiting_payment' })
          .eq('id', userId);

        // Kirim QRIS menggunakan helper function
        await answerCallbackQuery(botToken, query.id, '✅ Memproses...');
        
        const qrisMsgId = await sendQRISPayment({
          supabase,
          botToken,
          chatId: userId,
          title: `PREMIUM 5 BULAN + BONUS ${bonusCoins} KOIN (PROMO SPESIAL)`,
          price,
          uniqueCode,
          totalAmount,
          expiryMinutes: 15,
          cancelCallbackData: 'cancel_premium'
        });

        // INSERT DB dengan catatan bonus coins
        if (qrisMsgId) {
            await supabase.from('premium_requests').insert({
                user_id: userId,
                duration_days: durationDays,
                price: price,
                unique_code: uniqueCode,
                status: 'pending',
                message_id: qrisMsgId
            });
        }
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMBELIAN PREMIUM 1 BULAN (30 HARI) ---
      if (callbackData === 'buy_premium_30') {
        const durationDays = 30;
        const price = 5000;
        
        // Hapus pesan promo
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Cek apakah user sudah premium
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();
        if (isPremium) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sudah Premium!');
          await sendTelegramMessage(
            botToken,
            userId,
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${new Date(userData.premium_until).toLocaleDateString('id-ID')}\n\nGunakan /target untuk memilih gender chat!`
          );
          return new Response('OK', { status: 200 });
        }

        // Batalkan premium request pending sebelumnya yang belum ada bukti bayar
        await supabase
          .from('premium_requests')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('payment_proof', null);

        // Cek apakah ada premium request pending dengan bukti bayar
        const { count: paymentPendingCount } = await supabase
          .from('premium_requests')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .not('payment_proof', 'is', null);

        if (paymentPendingCount && paymentPendingCount > 0) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Transaksi pending!');
          await sendTelegramMessage(
            botToken,
            userId,
            '⚠️ Anda memiliki transaksi premium yang sedang menunggu konfirmasi admin. Mohon tunggu verifikasi.'
          );
          return new Response('OK', { status: 200 });
        }

        // Generate unique code
        const uniqueCode = Math.floor(Math.random() * 999) + 1;
        const totalAmount = price + uniqueCode;

        // Update user state
        await supabase
          .from('telegram_users')
          .update({ state: 'awaiting_payment' })
          .eq('id', userId);

        // Kirim QRIS menggunakan helper function
        await answerCallbackQuery(botToken, query.id, '✅ Memproses...');
        
        const qrisMsgId = await sendQRISPayment({
          supabase,
          botToken,
          chatId: userId,
          title: `PEMBELIAN PREMIUM ${durationDays} HARI (PROMO)`,
          price,
          uniqueCode,
          totalAmount,
          expiryMinutes: 15,
          cancelCallbackData: 'cancel_premium'
        });

        // INSERT DB
        if (qrisMsgId) {
            await supabase.from('premium_requests').insert({
                user_id: userId,
                duration_days: durationDays,
                price: price,
                unique_code: uniqueCode,
                status: 'pending',
                message_id: qrisMsgId
            });
        }
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMBELIAN PREMIUM 3 HARI ---
      if (callbackData === 'buy_premium_3') {
        const durationDays = 3;
        const price = 1000;
        
        // Hapus pesan promo
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Cek apakah user sudah premium
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();
        if (isPremium) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sudah Premium!');
          await sendTelegramMessage(
            botToken,
            userId,
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${new Date(userData.premium_until).toLocaleDateString('id-ID')}\n\nGunakan /target untuk memilih gender chat!`
          );
          return new Response('OK', { status: 200 });
        }

        // Batalkan premium request pending sebelumnya yang belum ada bukti bayar
        await supabase
          .from('premium_requests')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('payment_proof', null);

        // Cek apakah ada premium request pending dengan bukti bayar
        const { count: paymentPendingCount } = await supabase
          .from('premium_requests')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .not('payment_proof', 'is', null);

        if (paymentPendingCount && paymentPendingCount > 0) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Transaksi pending!');
          await sendTelegramMessage(
            botToken,
            userId,
            '⚠️ Anda memiliki transaksi premium yang sedang menunggu konfirmasi admin. Mohon tunggu verifikasi.'
          );
          return new Response('OK', { status: 200 });
        }

        // Generate unique code
        const uniqueCode = Math.floor(Math.random() * 999) + 1;
        const totalAmount = price + uniqueCode;

        // Update user state
        await supabase
          .from('telegram_users')
          .update({ state: 'awaiting_payment' })
          .eq('id', userId);

        // Kirim QRIS menggunakan helper function
        await answerCallbackQuery(botToken, query.id, '✅ Memproses...');
        
        const qrisMsgId = await sendQRISPayment({
          supabase,
          botToken,
          chatId: userId,
          title: `PEMBELIAN PREMIUM ${durationDays} HARI (PROMO)`,
          price,
          uniqueCode,
          totalAmount,
          expiryMinutes: 15,
          cancelCallbackData: 'cancel_premium'
        });

        // INSERT DB
        if (qrisMsgId) {
            await supabase.from('premium_requests').insert({
                user_id: userId,
                duration_days: durationDays,
                price: price,
                unique_code: uniqueCode,
                status: 'pending',
                message_id: qrisMsgId
            });
        }
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMBELIAN PREMIUM 1 MINGGU (7 HARI) ---
      if (callbackData === 'buy_premium_7') {
        const durationDays = 7;
        const price = 2000;
        
        // Hapus pesan promo
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Cek apakah user sudah premium
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();
        if (isPremium) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sudah Premium!');
          await sendTelegramMessage(
            botToken,
            userId,
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${new Date(userData.premium_until).toLocaleDateString('id-ID')}\n\nGunakan /target untuk memilih gender chat!`
          );
          return new Response('OK', { status: 200 });
        }

        // Batalkan premium request pending sebelumnya yang belum ada bukti bayar
        await supabase
          .from('premium_requests')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('payment_proof', null);

        // Cek apakah ada premium request pending dengan bukti bayar
        const { count: paymentPendingCount } = await supabase
          .from('premium_requests')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .not('payment_proof', 'is', null);

        if (paymentPendingCount && paymentPendingCount > 0) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Transaksi pending!');
          await sendTelegramMessage(
            botToken,
            userId,
            '⚠️ Anda memiliki transaksi premium yang sedang menunggu konfirmasi admin. Mohon tunggu verifikasi.'
          );
          return new Response('OK', { status: 200 });
        }

        // Generate unique code
        const uniqueCode = Math.floor(Math.random() * 999) + 1;
        const totalAmount = price + uniqueCode;

        // Update user state
        await supabase
          .from('telegram_users')
          .update({ state: 'awaiting_payment' })
          .eq('id', userId);

        // Kirim QRIS menggunakan helper function
        await answerCallbackQuery(botToken, query.id, '✅ Memproses...');
        
        const qrisMsgId = await sendQRISPayment({
          supabase,
          botToken,
          chatId: userId,
          title: `PEMBELIAN PREMIUM ${durationDays} HARI (PROMO)`,
          price,
          uniqueCode,
          totalAmount,
          expiryMinutes: 15,
          cancelCallbackData: 'cancel_premium'
        });

        // INSERT DB
        if (qrisMsgId) {
            await supabase.from('premium_requests').insert({
                user_id: userId,
                duration_days: durationDays,
                price: price,
                unique_code: uniqueCode,
                status: 'pending',
                message_id: qrisMsgId
            });
        }
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMBELIAN PREMIUM 6 BULAN (180 HARI) ---
      if (callbackData === 'buy_premium_180') {
        const durationDays = 180;
        const price = 25000;
        
        // Hapus pesan promo
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Cek apakah user sudah premium
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();
        if (isPremium) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sudah Premium!');
          await sendTelegramMessage(
            botToken,
            userId,
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${new Date(userData.premium_until).toLocaleDateString('id-ID')}\n\nGunakan /target untuk memilih gender chat!`
          );
          return new Response('OK', { status: 200 });
        }

        // Batalkan premium request pending sebelumnya yang belum ada bukti bayar
        await supabase
          .from('premium_requests')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('payment_proof', null);

        // Cek apakah ada premium request pending dengan bukti bayar
        const { count: paymentPendingCount } = await supabase
          .from('premium_requests')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .not('payment_proof', 'is', null);

        if (paymentPendingCount && paymentPendingCount > 0) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Transaksi pending!');
          await sendTelegramMessage(
            botToken,
            userId,
            '⚠️ Anda memiliki transaksi premium yang sedang menunggu konfirmasi admin. Mohon tunggu verifikasi.'
          );
          return new Response('OK', { status: 200 });
        }

        // Generate unique code
        const uniqueCode = Math.floor(Math.random() * 999) + 1;
        const totalAmount = price + uniqueCode;

        // Update user state
        await supabase
          .from('telegram_users')
          .update({ state: 'awaiting_payment' })
          .eq('id', userId);

        // Kirim QRIS menggunakan helper function
        await answerCallbackQuery(botToken, query.id, '✅ Memproses...');
        
        const qrisMsgId = await sendQRISPayment({
          supabase,
          botToken,
          chatId: userId,
          title: `PEMBELIAN PREMIUM ${durationDays} HARI (6 BULAN PROMO)`,
          price,
          uniqueCode,
          totalAmount,
          expiryMinutes: 15,
          cancelCallbackData: 'cancel_premium'
        });

        // INSERT DB
        if (qrisMsgId) {
            await supabase.from('premium_requests').insert({
                user_id: userId,
                duration_days: durationDays,
                price: price,
                unique_code: uniqueCode,
                status: 'pending',
                message_id: qrisMsgId
            });
        }
        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA PEMBELIAN PREMIUM HARGA NORMAL (dari /target) ---
      if (callbackData === 'buy_premium_normal_7' || callbackData === 'buy_premium_normal_30') {
        const durationDays = callbackData === 'buy_premium_normal_7' ? 7 : 30;
        const price = callbackData === 'buy_premium_normal_7' ? 25000 : 60000;
        
        // Hapus pesan promo
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }

        // Cek apakah user sudah premium
        const { data: userData } = await supabase
          .from('telegram_users')
          .select('premium_until')
          .eq('id', userId)
          .single();

        const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();
        if (isPremium) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sudah Premium!');
          await sendTelegramMessage(
            botToken,
            userId,
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${new Date(userData.premium_until).toLocaleDateString('id-ID')}\n\nGunakan /target untuk memilih gender chat!`
          );
          return new Response('OK', { status: 200 });
        }

        // Batalkan premium request pending sebelumnya yang belum ada bukti bayar
        await supabase
          .from('premium_requests')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('payment_proof', null);

        // Cek apakah ada premium request pending dengan bukti bayar
        const { count: paymentPendingCount } = await supabase
          .from('premium_requests')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending')
          .not('payment_proof', 'is', null);

        if (paymentPendingCount && paymentPendingCount > 0) {
          await answerCallbackQuery(botToken, query.id, '⚠️ Transaksi pending!');
          await sendTelegramMessage(
            botToken,
            userId,
            '⚠️ Anda memiliki transaksi premium yang sedang menunggu konfirmasi admin. Mohon tunggu verifikasi.'
          );
          return new Response('OK', { status: 200 });
        }

        // Generate unique code
        const uniqueCode = Math.floor(Math.random() * 999) + 1;
        const totalAmount = price + uniqueCode;

        

        // Update user state
        await supabase
          .from('telegram_users')
          .update({ state: 'awaiting_payment' })
          .eq('id', userId);

        // Kirim QRIS menggunakan helper function
        await answerCallbackQuery(botToken, query.id, '✅ Memproses...');
        
        const qrisMsgId = await sendQRISPayment({
          supabase,
          botToken,
          chatId: userId,
          title: `PEMBELIAN PREMIUM ${durationDays} HARI`,
          price,
          uniqueCode,
          totalAmount,
          expiryMinutes: 15,
          cancelCallbackData: 'cancel_premium'
        });

        // INSERT DB
        if (qrisMsgId) {
            await supabase.from('premium_requests').insert({
                user_id: userId,
                duration_days: durationDays,
                price: price,
                unique_code: uniqueCode,
                status: 'pending',
                message_id: qrisMsgId
            });
        }
        return new Response('OK', { status: 200 });
      }
      // --- LOGIKA PEMBATALAN PREMIUM ---
      if (callbackData === 'cancel_premium') {
        // Batalkan premium request pending
        await supabase
          .from('premium_requests')
          .update({ status: 'cancelled' })
          .eq('user_id', userId)
          .eq('status', 'pending');
        
        // Reset state user
        const { data: userBeforeCancel } = await supabase
          .from('telegram_users')
          .select('partner_id')
          .eq('id', userId)
          .single();

        const newState = userBeforeCancel?.partner_id ? 'chatting' : 'idle';
        
        await supabase
          .from('telegram_users')
          .update({ state: newState })
          .eq('id', userId);

        await answerCallbackQuery(botToken, query.id, '🚫 Transaksi dibatalkan!');
        
        // Hapus pesan QRIS
        if (message) {
          await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
        }
        
        // Kirim pesan konfirmasi pembatalan
        await sendTelegramMessage(
          botToken,
          userId,
          `🚫 <b>TRANSAKSI PREMIUM DIBATALKAN</b>\n\nAnda dapat mencoba lagi kapan saja dengan mengklik tombol beli premium atau ketik /premium`
        );
        return new Response('OK', { status: 200 });
      }
      // --- END LOGIKA PEMBELIAN PREMIUM ---

      // --- LOGIKA ADMIN APPROVE/REJECT TOPUP ---
      if (callbackData.startsWith('admin_approve_topup_') || callbackData.startsWith('admin_reject_topup_')) {
        const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
        
        // Cek apakah user adalah admin
        if (userId.toString() !== csChatId) {
          await answerCallbackQuery(botToken, query.id, '❌ Anda bukan admin!');
          return new Response('OK', { status: 200 });
        }

        const isApprove = callbackData.startsWith('admin_approve_topup_');
        const requestId = callbackData.replace('admin_approve_topup_', '').replace('admin_reject_topup_', '');

        // Get topup request
        const { data: topupRequest, error: fetchError } = await supabase
          .from('topup_requests')
          .select('*')
          .eq('id', requestId)
          .eq('status', 'pending')
          .single();

        if (fetchError || !topupRequest) {
          await answerCallbackQuery(botToken, query.id, '❌ Transaksi tidak ditemukan atau sudah diproses.');
          return new Response('OK', { status: 200 });
        }

        if (isApprove) {
          const COIN_PRICE = 1;
          const coinsFromUniqueCode = topupRequest.unique_code / COIN_PRICE;
          const totalCoinsToAdd = topupRequest.amount + coinsFromUniqueCode;

          const { data: userData } = await supabase
            .from('telegram_users')
            .select('coins')
            .eq('id', topupRequest.user_id)
            .single();

          const currentCoins = userData?.coins || 0;
          const newBalance = currentCoins + totalCoinsToAdd;

          await supabase
            .from('telegram_users')
            .update({ coins: newBalance })
            .eq('id', topupRequest.user_id);

          await supabase.from('coin_transactions').insert({
            user_id: topupRequest.user_id,
            amount: totalCoinsToAdd,
            type: 'topup',
            description: `Top-up ${totalCoinsToAdd} koin via QRIS`
          });

          await supabase
            .from('topup_requests')
            .update({ 
              status: 'approved',
              processed_at: new Date().toISOString()
            })
            .eq('id', requestId);

          // Notify user
          await sendTelegramMessage(
            botToken,
            topupRequest.user_id,
            `✅ <b>TOP-UP BERHASIL!</b>\n\n💰 ${totalCoinsToAdd} koin telah ditambahkan ke akun kamu.\n💳 Saldo baru: ${newBalance} koin\n\nTerima kasih! 🎉`
          );

          await answerCallbackQuery(botToken, query.id, '✅ Top-up diapprove!');

          // Edit message to show approved
          if (message) {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                caption: `✅ <b>TOP-UP DIAPPROVE</b>\n\n👤 User ID: ${topupRequest.user_id}\n💰 Jumlah: ${totalCoinsToAdd} koin\n\n✅ Diproses oleh admin`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
              })
            });
          }
        } else {
          await supabase
            .from('topup_requests')
            .update({ 
              status: 'rejected',
              processed_at: new Date().toISOString()
            })
            .eq('id', requestId);

          await sendTelegramMessage(
            botToken,
            topupRequest.user_id,
            `❌ <b>TOP-UP DITOLAK</b>\n\n😔 Maaf, transaksi top-up ${topupRequest.amount} koin kamu tidak dapat diproses.\n\nSilakan coba lagi dengan /topup atau hubungi admin @FizaTalkCS untuk bantuan.`
          );

          await answerCallbackQuery(botToken, query.id, '❌ Top-up ditolak!');

          if (message) {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                caption: `❌ <b>TOP-UP DITOLAK</b>\n\n👤 User ID: ${topupRequest.user_id}\n💰 Jumlah: ${topupRequest.amount} koin\n\n❌ Ditolak oleh admin`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
              })
            });
          }
        }

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA ADMIN APPROVE/REJECT PREMIUM ---
      if (callbackData.startsWith('admin_approve_premium_') || callbackData.startsWith('admin_reject_premium_')) {
        const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
        
        if (userId.toString() !== csChatId) {
          await answerCallbackQuery(botToken, query.id, '❌ Anda bukan admin!');
          return new Response('OK', { status: 200 });
        }

        const isApprove = callbackData.startsWith('admin_approve_premium_');
        const requestId = callbackData.replace('admin_approve_premium_', '').replace('admin_reject_premium_', '');

        const { data: premiumRequest, error: fetchError } = await supabase
          .from('premium_requests')
          .select('*')
          .eq('id', requestId)
          .eq('status', 'pending')
          .single();

        if (fetchError || !premiumRequest) {
          await answerCallbackQuery(botToken, query.id, '❌ Transaksi tidak ditemukan atau sudah diproses.');
          return new Response('OK', { status: 200 });
        }

        if (isApprove) {
          const currentPremiumUntil = await supabase
            .from('telegram_users')
            .select('premium_until')
            .eq('id', premiumRequest.user_id)
            .single();

          let premiumEndDate: Date;
          const existingPremium = currentPremiumUntil.data?.premium_until;
          
          if (existingPremium && new Date(existingPremium) > new Date()) {
            premiumEndDate = new Date(existingPremium);
            premiumEndDate.setDate(premiumEndDate.getDate() + premiumRequest.duration_days);
          } else {
            premiumEndDate = new Date();
            premiumEndDate.setDate(premiumEndDate.getDate() + premiumRequest.duration_days);
          }

          await supabase
            .from('telegram_users')
            .update({ premium_until: premiumEndDate.toISOString() })
            .eq('id', premiumRequest.user_id);

          await supabase
            .from('premium_requests')
            .update({ 
              status: 'approved',
              processed_at: new Date().toISOString()
            })
            .eq('id', requestId);

          await supabase.from('coin_transactions').insert({
            user_id: premiumRequest.user_id,
            amount: -premiumRequest.price,
            type: 'premium_purchase',
            description: `Pembelian Premium ${premiumRequest.duration_days} hari`
          });

          const formattedDate = premiumEndDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

          await sendTelegramMessage(
            botToken,
            premiumRequest.user_id,
            `🎉 <b>SELAMAT! PREMIUM AKTIF!</b>\n\n✨ Kamu sekarang adalah user Premium!\n📅 Berlaku hingga: ${formattedDate}\n\n🎯 Gunakan /target untuk memilih gender chat!\n\nTerima kasih telah berlangganan! 💎`
          );

          await answerCallbackQuery(botToken, query.id, '✅ Premium diapprove!');

          if (message) {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                caption: `✅ <b>PREMIUM DIAPPROVE</b>\n\n👤 User ID: ${premiumRequest.user_id}\n💎 Paket: ${premiumRequest.duration_days} hari\n📅 Hingga: ${formattedDate}\n\n✅ Diproses oleh admin`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
              })
            });
          }
        } else {
          await supabase
            .from('premium_requests')
            .update({ 
              status: 'rejected',
              processed_at: new Date().toISOString()
            })
            .eq('id', requestId);

          await sendTelegramMessage(
            botToken,
            premiumRequest.user_id,
            `❌ <b>PEMBELIAN PREMIUM DITOLAK</b>\n\n😔 Maaf, transaksi premium kamu tidak dapat diproses.\n\nSilakan coba lagi atau hubungi admin @FizaTalkCS untuk bantuan.`
          );

          await answerCallbackQuery(botToken, query.id, '❌ Premium ditolak!');

          if (message) {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                caption: `❌ <b>PREMIUM DITOLAK</b>\n\n👤 User ID: ${premiumRequest.user_id}\n💎 Paket: ${premiumRequest.duration_days} hari\n\n❌ Ditolak oleh admin`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
              })
            });
          }
        }

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA ADMIN APPROVE/REJECT FINE (UNBLOCK USER) ---
      if (callbackData.startsWith('admin_approve_fine_') || callbackData.startsWith('admin_reject_fine_')) {
        const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
        
        if (userId.toString() !== csChatId) {
          await answerCallbackQuery(botToken, query.id, '❌ Anda bukan admin!');
          return new Response('OK', { status: 200 });
        }

        const isApprove = callbackData.startsWith('admin_approve_fine_');
        const requestId = callbackData.replace('admin_approve_fine_', '').replace('admin_reject_fine_', '');

        // Get fine payment request
        const { data: fineRequest, error: fetchError } = await supabase
          .from('pending_transactions')
          .select('*')
          .eq('id', requestId)
          .eq('status', 'pending')
          .eq('admin_notes', 'FINE_PAYMENT')
          .single();

        if (fetchError || !fineRequest) {
          await answerCallbackQuery(botToken, query.id, '❌ Transaksi tidak ditemukan atau sudah diproses.');
          return new Response('OK', { status: 200 });
        }

        if (isApprove) {
          // 1. Update pending_transaction ke approved
          await supabase
            .from('pending_transactions')
            .update({ 
              status: 'approved',
              approved_at: new Date().toISOString(),
              approved_by: userId
            })
            .eq('id', requestId);

          // 2. UNBLOCK USER - set is_active = false
          await supabase
            .from('blocked_users')
            .update({ 
              is_active: false,
              unblocked_at: new Date().toISOString(),
              unblocked_by: userId
            })
            .eq('user_id', fineRequest.user_id);

          // 3. Record transaction
          await supabase.from('coin_transactions').insert({
            user_id: fineRequest.user_id,
            amount: -fineRequest.amount,
            type: 'fine_payment',
            description: `Pembayaran denda buka blokir Rp${fineRequest.amount.toLocaleString('id-ID')}`
          });

          // 4. Notify user - UNBLOCKED!
          const welcomeKeyboard = {
            inline_keyboard: [
              [{ text: '🔍 Cari Partner', callback_data: 'search_partner' }]
            ]
          };

          await sendTelegramMessage(
            botToken,
            fineRequest.user_id,
            `✅ <b>AKUN TELAH DIBUKA BLOKIR!</b>\n\n🎉 Pembayaran denda berhasil diverifikasi.\n💰 Denda: Rp ${fineRequest.total_amount.toLocaleString('id-ID')}\n\nAkun Anda sekarang aktif kembali. Harap patuhi ketentuan penggunaan untuk menghindari blokir di kemudian hari.\n\nSilakan mulai chat dengan menekan tombol di bawah:`,
            welcomeKeyboard
          );

          await answerCallbackQuery(botToken, query.id, '✅ User di-unblock!');

          // 5. Edit admin message
          if (message) {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                caption: `✅ <b>DENDA DIAPPROVE - USER UNBLOCKED</b>\n\n👤 User ID: ${fineRequest.user_id}\n💰 Denda: Rp ${fineRequest.total_amount.toLocaleString('id-ID')}\n\n✅ Diproses oleh admin`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
              })
            });
          }
        } else {
          // Reject fine payment
          await supabase
            .from('pending_transactions')
            .update({ 
              status: 'rejected',
              approved_at: new Date().toISOString()
            })
            .eq('id', requestId);

          // Notify user - still blocked
          const blockedKeyboard = {
            inline_keyboard: [
              [{ text: '💰 Bayar Denda Rp10.000', callback_data: 'pay_fine' }]
            ]
          };

          await sendTelegramMessage(
            botToken,
            fineRequest.user_id,
            `❌ <b>PEMBAYARAN DENDA DITOLAK</b>\n\n😔 Maaf, bukti pembayaran denda tidak valid.\n\nKemungkinan:\n- Nominal tidak sesuai\n- Bukti transfer tidak jelas\n\nSilakan bayar ulang dengan nominal yang tepat:\n💵 Total: Rp ${fineRequest.total_amount.toLocaleString('id-ID')}`,
            blockedKeyboard
          );

          await answerCallbackQuery(botToken, query.id, '❌ Denda ditolak!');

          if (message) {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                caption: `❌ <b>DENDA DITOLAK</b>\n\n👤 User ID: ${fineRequest.user_id}\n💰 Denda: Rp ${fineRequest.total_amount.toLocaleString('id-ID')}\n\n❌ Ditolak oleh admin - User tetap blocked`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] }
              })
            });
          }
        }

        return new Response('OK', { status: 200 });
      }

      // --- LOGIKA RATING: PERUBAHAN UTAMA UNTUK MENAMBAH KOIN PARTNER ---
      if (callbackData.startsWith('rate_')) {
        const RATING_COST = 10;
        const PARTNER_SHARE_RATE = 0.8;
        const PARTNER_COIN_EARNED = RATING_COST * PARTNER_SHARE_RATE; // 8 koin

        const [, ratedUserIdStr, emoji] = callbackData.split('_');
        const ratedUserId = parseInt(ratedUserIdStr);
        
        // 1. Ambil saldo user pemberi rating
        const { data: raterData } = await supabase
          .from('telegram_users')
          .select('coins')
          .eq('id', userId)
          .single();

        const currentRaterCoins = raterData?.coins || 0;

        // 2. Cek koin pemberi rating
        if (currentRaterCoins < RATING_COST) {
          // Logika koin tidak cukup tetap sama
          await answerCallbackQuery(botToken, query.id, '❌ Koin tidak cukup!');
          
          if (message) {
            const url = `${TELEGRAM_API}${botToken}/editMessageText`;
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: `⚠️ Partner mengakhiri chat. Gunakan /start untuk mencari partner baru!\n\n❌ Koin tidak cukup untuk memberi rating!\n\n💰 Saldo kamu: ${currentRaterCoins} koin\n💎 Dibutuhkan: ${RATING_COST} koin\n\nGunakan /topup [jumlah] untuk top-up koin.\nContoh: /topup 1000`
              })
            });
          }
          
          return new Response('OK', { status: 200 });
        }

        // 3. Potong koin pemberi rating
        const newRaterBalance = currentRaterCoins - RATING_COST;
        await supabase
          .from('telegram_users')
          .update({ coins: newRaterBalance })
          .eq('id', userId);

        // Record transaction (potongan)
        await supabase.from('coin_transactions').insert({
          user_id: userId,
          amount: -RATING_COST,
          type: 'rating_given', // Diubah menjadi rating_given
          description: `Rating ${emoji} untuk partner`
        });
        
        // --- LOGIKA PENAMBAHAN KOIN PARTNER (RATED USER) ---

        // 4. Ambil saldo partner (rated user)
        const { data: partnerData } = await supabase
            .from('telegram_users')
            .select('coins')
            .eq('id', ratedUserId)
            .single();

        const currentPartnerCoins = partnerData?.coins || 0;
        
        // 5. Tambah koin partner (80%)
        const PARTNER_COIN_EARNED_INT = Math.floor(PARTNER_COIN_EARNED); // Pastikan koin yang ditambahkan adalah integer
        const newPartnerBalance = currentPartnerCoins + PARTNER_COIN_EARNED_INT;
        await supabase
            .from('telegram_users')
            .update({ coins: newPartnerBalance })
            .eq('id', ratedUserId);

        // Record transaction (penambahan)
        await supabase.from('coin_transactions').insert({
            user_id: ratedUserId,
            amount: PARTNER_COIN_EARNED_INT,
            type: 'rating_received', // Ditambah rating_received
            description: `Menerima rating ${emoji} (+${PARTNER_COIN_EARNED_INT} koin)`
        });
        
        // Simpan emoji rating ke user_reactions
        await supabase.from('user_reactions').insert({
          user_id: ratedUserId,      // User yang MENERIMA rating
          from_user_id: userId,       // User yang MEMBERI rating
          emoji: emoji
        });
        
        // 6. Kirim notifikasi ke partner (rated user)
        await sendTelegramMessage(
            botToken,
            ratedUserId,
            `🎉 Anda mendapat rating ${emoji} dari partner chat Anda! (+${PARTNER_COIN_EARNED_INT} koin)\n\n💰 Saldo Anda: ${newPartnerBalance} koin`
        );

        // 7. Selesaikan callback query
        await answerCallbackQuery(botToken, query.id, `Rating ${emoji} dikirim! (-${RATING_COST} koin)`);
        
        // Update message to remove keyboard
        if (message) {
          const url = `${TELEGRAM_API}${botToken}/editMessageText`;
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: message.chat.id,
              message_id: message.message_id,
              text: `⚠️ Partner mengakhiri chat. Gunakan /start untuk mencari partner baru!\n\n✅ Rating ${emoji} telah dikirim! (-${RATING_COST} koin)\n💰 Saldo: ${newRaterBalance} koin`
            })
          });
        }

        return new Response('OK', { status: 200 });
      }
    }
    // --- END LOGIKA RATING & CALLBACK ---

    // Handle message reactions
    if (update.message_reaction) {
      const reaction = update.message_reaction;
      const userId = reaction.user.id;

      // ************************************************
      // CEK APAKAH USER SUDAH DIBLOKIR (REACTION)
      // ************************************************
      const userIsBlockedReaction = await isUserBlocked(supabase, userId);
      if (userIsBlockedReaction) {
        // User diblokir, abaikan reaction
        return new Response('OK', { status: 200 });
      }

      // Get current user and partner
      const { data: currentUser } = await supabase
        .from('telegram_users')
        .select('state, partner_id')
        .eq('id', userId)
        .single();

      // If user is chatting and has a partner, notify partner about reaction
      if (currentUser?.state === 'chatting' && currentUser?.partner_id) {
        const newReactions = reaction.new_reaction || [];
        const oldReactions = reaction.old_reaction || [];
        
        if (newReactions.length > oldReactions.length) {
          // New reaction added
          const newEmoji = newReactions[newReactions.length - 1]?.emoji || '👍';
          await sendTelegramMessage(
            botToken, 
            currentUser.partner_id as number, 
            `${newEmoji} <i>Partner bereaksi pada pesan</i>`
          );
        }
      }

      return new Response('OK', { status: 200 });
    }

    // ************************************************
    // START LOGIKA PESAN/COMMAND
    // ************************************************

    // Pastikan ada pesan masuk
    if (!update.message?.from) {
      return new Response('OK', { status: 200 });
    }

    const message = update.message;
    const userId = message.from.id;
    const text = message.text; 

    // ************************************************
    // CEK APAKAH USER SUDAH DIBLOKIR
    // ************************************************
    const userIsBlocked = await isUserBlocked(supabase, userId);
    if (userIsBlocked) {
      // User diblokir, kirim pesan dan abaikan
      await sendTelegramMessage(
        botToken,
        userId,
        '🚫 <b>Akun Anda Diblokir</b>\n\nAnda tidak dapat menggunakan layanan ini karena terdeteksi aktivitas mencurigakan.\n\n📞 Hubungi admin jika ini adalah kekeliruan: @FizatalkCS'
      );
      return new Response('OK', { status: 200 });
    }

  

    // Photo received - log for debugging only
    if (message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1];
      console.log('📸 Photo received from user', userId);
    }

    // Get current user state
    const { data: currentUser } = await supabase
      .from('telegram_users')
      .select('state, partner_id')
      .eq('id', userId)
      .single();

    // ************************************************
    // LOGIKA GUARD: Hanya Terima Foto dan Command /stop saat Awaiting Payment
    // ************************************************
    if (currentUser?.state === 'awaiting_payment') {
      if (message.photo) {
        // --- LOGIKA PEMROSESAN FOTO BUKTI BAYAR ---
        const photos = message.photo;
        const largestPhoto = photos[photos.length - 1];
        const fileId = largestPhoto.file_id;

        // Cek apakah ini untuk premium request atau topup request
        const { data: premiumRequest } = await supabase
          .from('premium_requests')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('payment_proof', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (premiumRequest) {
          // Update premium request dengan bukti bayar
          await supabase
            .from('premium_requests')
            .update({ payment_proof: fileId })
            .eq('id', premiumRequest.id);

          // Reset state user
          const newState = currentUser.partner_id ? 'chatting' : 'idle';
          await supabase
            .from('telegram_users')
            .update({ state: newState })
            .eq('id', userId);

          // Kirim notifikasi ke CS
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (csChatId) {
            const { data: userData } = await supabase
              .from('telegram_users')
              .select('username, first_name')
              .eq('id', userId)
              .single();

            const userName = userData?.username ? `@${userData.username}` : userData?.first_name || 'Unknown';
            const totalWithCode = premiumRequest.price + premiumRequest.unique_code;

            const adminPremiumKeyboard = {
              inline_keyboard: [
                [
                  { text: '✅ Approve', callback_data: `admin_approve_premium_${premiumRequest.id}` },
                  { text: '❌ Reject', callback_data: `admin_reject_premium_${premiumRequest.id}` }
                ]
              ]
            };

            await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: csChatId,
                photo: fileId,
                caption: `🔔 <b>BUKTI PEMBAYARAN PREMIUM BARU</b>\n\n👤 User: ${userName} (ID: ${userId})\n💎 Paket: Premium ${premiumRequest.duration_days} hari\n💰 Harga: Rp ${premiumRequest.price.toLocaleString('id-ID')}\n🔢 Kode Unik: ${premiumRequest.unique_code}\n💳 Total Transfer: Rp ${totalWithCode.toLocaleString('id-ID')}\n🆔 Request ID: <code>${premiumRequest.id}</code>`,
                parse_mode: 'HTML',
                reply_markup: adminPremiumKeyboard
              })
            });
          }

          await sendTelegramMessage(
            botToken,
            userId,
            '✅ <b>Bukti pembayaran Premium diterima!</b>\n\n⏳ Mohon tunggu verifikasi admin. Anda akan mendapat notifikasi setelah Premium aktif.'
          );
          return new Response('OK', { status: 200 });
        }

        // Cek apakah ini untuk pembayaran denda (FINE_PAYMENT)
        const { data: finePayment } = await supabase
          .from('pending_transactions')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .eq('admin_notes', 'FINE_PAYMENT')
          .is('payment_proof_url', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (finePayment) {
          // Update pending transaction dengan bukti bayar
          await supabase
            .from('pending_transactions')
            .update({ payment_proof_url: fileId })
            .eq('id', finePayment.id);

          // Reset state user ke idle (masih blocked sampai di-approve)
          await supabase
            .from('telegram_users')
            .update({ state: 'idle' })
            .eq('id', userId);

          // Kirim notifikasi ke CS
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (csChatId) {
            const { data: userData } = await supabase
              .from('telegram_users')
              .select('username, first_name')
              .eq('id', userId)
              .single();

            const userName = userData?.username ? `@${userData.username}` : userData?.first_name || 'Unknown';

            const adminFineKeyboard = {
              inline_keyboard: [
                [
                  { text: '✅ Approve (Unblock)', callback_data: `admin_approve_fine_${finePayment.id}` },
                  { text: '❌ Reject', callback_data: `admin_reject_fine_${finePayment.id}` }
                ]
              ]
            };

            await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: csChatId,
                photo: fileId,
                caption: `🚨 <b>BUKTI PEMBAYARAN DENDA (BUKA BLOKIR)</b>\n\n👤 User: ${userName} (ID: ${userId})\n💰 Denda: Rp ${finePayment.amount.toLocaleString('id-ID')}\n🔢 Kode Unik: ${finePayment.unique_code}\n💳 Total Transfer: Rp ${finePayment.total_amount.toLocaleString('id-ID')}\n🆔 Request ID: <code>${finePayment.id}</code>\n\n⚠️ <b>Approve untuk UNBLOCK user ini</b>`,
                parse_mode: 'HTML',
                reply_markup: adminFineKeyboard
              })
            });
          }

          await sendTelegramMessage(
            botToken,
            userId,
            '✅ <b>Bukti pembayaran denda diterima!</b>\n\n⏳ Mohon tunggu verifikasi admin. Anda akan mendapat notifikasi setelah akun dibuka blokirnya.'
          );
          return new Response('OK', { status: 200 });
        }

        // Get pending topup request (yang belum ada payment_proof)
        const { data: topupRequest } = await supabase
          .from('topup_requests')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .is('payment_proof', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (topupRequest) {
          // Update request dengan file_id bukti bayar
          await supabase
            .from('topup_requests')
            .update({ 
                payment_proof: fileId,
                status: 'pending' // Tetap pending, menunggu approve admin
            })
            .eq('id', topupRequest.id);

          // Reset state user ke CHATTING atau IDLE
          const newState = currentUser.partner_id ? 'chatting' : 'idle';
          await supabase
            .from('telegram_users')
            .update({ state: newState }) // <-- KEMBALIKAN KE CHATTING/IDLE
            .eq('id', userId);
            
          const COIN_PRICE = 1; // 1 koin = Rp 1

          // Kirim notifikasi ke CS
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (csChatId) {
            const { data: userData } = await supabase
              .from('telegram_users')
              .select('username, first_name')
              .eq('id', userId)
              .single();

            const userName = userData?.username ? `@${userData.username}` : userData?.first_name || 'Unknown';
            
            const totalWithCode = (topupRequest.amount * COIN_PRICE) + topupRequest.unique_code; 
            
            const adminTopupKeyboard = {
              inline_keyboard: [
                [
                  { text: '✅ Approve', callback_data: `admin_approve_topup_${topupRequest.id}` },
                  { text: '❌ Reject', callback_data: `admin_reject_topup_${topupRequest.id}` }
                ]
              ]
            };

            await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: csChatId,
                photo: fileId,
                caption: `🔔 <b>BUKTI PEMBAYARAN BARU</b>\n\n👤 User: ${userName} (ID: ${userId})\n💰 Jumlah Koin: ${topupRequest.amount}\n🔢 Kode Unik: ${topupRequest.unique_code}\n💳 Total Transfer: Rp ${totalWithCode.toLocaleString('id-ID')}\n🆔 Request ID: <code>${topupRequest.id}</code>`,
                parse_mode: 'HTML',
                reply_markup: adminTopupKeyboard
              })
            });
          }

          await sendTelegramMessage(
            botToken, 
            userId, 
            '✅ <b>Bukti pembayaran diterima!</b>\n\n⏳ Mohon tunggu verifikasi admin. Anda dapat melanjutkan chat.' // <-- PESAN BARU
          );
        } else {
          // Jika tidak ada request pending yang menanti bukti bayar
          await sendTelegramMessage(
            botToken,
            userId,
            '❌ Tidak ada transaksi pending yang menanti bukti pembayaran. Gunakan /topup [jumlah] terlebih dahulu untuk membuat permintaan baru.'
          );
        }
      } else if (text === '/stop') {
          // Izinkan command /stop untuk membatalkan transaksi yang belum ada bukti bayar (masih dianggap 'mengendap')
          await supabase
              .from('topup_requests')
              .update({ status: 'cancelled' })
              .eq('user_id', userId)
              .eq('status', 'pending')
              .is('payment_proof', null); // HANYA batalkan yang belum ada bukti bayar
          
          // Reset state user ke CHATTING atau IDLE
          const newState = currentUser.partner_id ? 'chatting' : 'idle';
          await supabase
              .from('telegram_users')
              .update({ state: newState }) // <-- KEMBALIKAN KE CHATTING JIKA ADA PARTNER
              .eq('id', userId);
          
          await sendTelegramMessage(botToken, userId, '🚫 Permintaan top-up yang belum dibayar dibatalkan. Anda dapat melanjutkan chat.'); // <-- PESAN BARU
          
      } else {
        // Pesan masuk BUKAN foto dan BUKAN /stop (semua command lain dan teks biasa/media lain)
        await sendTelegramMessage(
          botToken, 
          userId, 
          '⚠️ Anda sedang menunggu proses top-up. Silakan kirimkan **foto bukti pembayaran** Anda, atau gunakan **/stop** untuk membatalkan dan kembali ke chat.' // <-- PESAN BARU
        );
      }
      return new Response('OK', { status: 200 }); // Selesai memproses jika state awaiting_payment
    }
    // ************************************************
    // END LOGIKA AWAITING PAYMENT GUARD
    // ************************************************


    // ************************************************
    // LOGIKA CHATTING & FORWARDING (TANPA TAG)
    // ************************************************
    if (currentUser?.state === 'chatting' && currentUser?.partner_id && message.message_id) {
        const partnerId = currentUser.partner_id as number;
        
        // === VALIDASI TAMBAHAN: Cek apakah partner masih connected ===
        const { data: partnerCheck } = await supabase
            .from('telegram_users')
            .select('state, partner_id')
            .eq('id', partnerId)
            .single();
        
        // Jika partner sudah tidak connected ke kita, reset state dan beri notifikasi
        if (!partnerCheck || partnerCheck.state !== 'chatting' || partnerCheck.partner_id !== userId) {
            console.log(`⚠️ Partner ${partnerId} sudah tidak connected ke user ${userId}`);
            
            // Reset state user
            await supabase
                .from('telegram_users')
                .update({ state: 'idle', partner_id: null })
                .eq('id', userId);
            
            // Beri notifikasi dan menu untuk cari partner baru
            const endKeyboard = {
                inline_keyboard: [
                    [{ text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }],
                    [
                        { text: '🎯 Filter Gender', callback_data: 'change_target' },
                        { text: '📍 Filter Lokasi', callback_data: 'change_location' }
                    ]
                ]
            };
            
            await sendTelegramMessage(
                botToken,
                userId,
                '⚠️ <b>Sesi chat sudah berakhir.</b>\n\nPartner sudah keluar dari chat. Pilih aksi:',
                endKeyboard
            );
            
            return new Response('OK', { status: 200 });
        }
        
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
              await sendTelegramMessage(botToken, userId, '⚠️ Kamu yakin ingin mangakhiri chat saat ini dan mencari partner baru?.\n\nPilih aksi:', chattingKeyboard);
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
              await sendTelegramMessage(botToken, userId, '⚠️ Kamu yakin ingin mangakhiri chat?.\n\nPilih aksi:', chattingKeyboard);
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
          } else if (text === '/filter') {
          // Cek apakah user premium
          const { data: userData } = await supabase
            .from('telegram_users')
            .select('premium_until, target_gender')
            .eq('id', userId)
            .single();

          const isPremium = userData?.premium_until && new Date(userData.premium_until) > new Date();

          if (!isPremium) {
            // User bukan premium - tampilkan penawaran beli premium dengan harga normal
            // Get premium file_id from database
            const premiumFileId = await getPremiumFileId(supabase);

            const buyPremiumKeyboard = {
              inline_keyboard: [
                [
                  { text: '📦 1 Minggu - Rp 20.000', callback_data: 'buy_premium_normal_7' },
                ],
                [
                  { text: '📦 1 Bulan - Rp 60.000', callback_data: 'buy_premium_normal_30' }
                ]
              ]
            };

            const premiumMessage = `❌ <b>Fitur Premium Only!</b>

Fitur memilih gender target hanya tersedia untuk user <b>Premium</b>.

✨ <b>KEUNTUNGAN PREMIUM:</b>
• 🎯 Pilih target gender chat
• ⭐ Badge Premium
• 🚀 Prioritas matching

💰 <b>HARGA PREMIUM:</b>
📦 <b>1 MINGGU:</b> Rp 20.000
📦 <b>1 BULAN:</b> Rp 60.000

💎 Beli sekarang untuk menikmati fitur eksklusif!`;

            // Kirim dengan foto premium (jika file_id ada)
            if (premiumFileId) {
              try {
                const resp = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: userId,
                    photo: premiumFileId,
                    caption: premiumMessage,
                    parse_mode: 'HTML',
                    reply_markup: buyPremiumKeyboard
                  })
                });

                if (!resp.ok) {
                  // Fallback ke text jika foto gagal
                  await sendTelegramMessage(botToken, userId, premiumMessage, buyPremiumKeyboard);
                }
              } catch (e) {
                console.error('sendPhoto error for /target:', e);
                await sendTelegramMessage(botToken, userId, premiumMessage, buyPremiumKeyboard);
              }
            } else {
              await sendTelegramMessage(botToken, userId, premiumMessage, buyPremiumKeyboard);
            }

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
          } else if (text === '/reward') { 
              // Logika /reward saat chatting
              const rewardKeyboard = {
                  inline_keyboard: [
                      [{ text: '💸 Cek Reward & Daftar', url: 'https://fizatalk-reward.app' }]
                  ]
              };
              await sendTelegramMessage(
                  botToken, 
                  userId, 
                  '✨ <b>Dapatkan Reward dengan Membuat Konten Fizatalk!</b>\n\nYuk, buat video tentang pengalaman chat seru kamu di Fizatalk dan dapatkan penghasilan berdasarkan jumlah *views* yang kamu dapatkan!\n\n💰 <b>Skema Reward:</b>\n• 10k views = Rp 10.000\n• 50k views = Rp 50.000\n• 100k views = Rp 100.000\n\nKlik tombol di bawah untuk info lebih lanjut dan cara klaim reward!',
                  rewardKeyboard
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
      }
    
          // Tambahkan command lain yang diizinkan saat chatting di sini

          // JANGAN FORWARD JIKA ITU ADALAH COMMAND YANG DIKENAL
          if (isCommand) {
              return new Response('OK', { status: 200 }); 
          }
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
                    await sendTelegramMessage(botToken, partnerId, finalMessage);
                } else {
                    // Copy message biasa
                    await copyTelegramMessage(botToken, partnerId, userId, message.message_id);
                }
            }
            // B. Jika USER MENGIRIM STICKER (Handling Khusus)
            else if (message.sticker) {
                // Sticker tidak support caption/quote di dalamnya
                if (isReply) {
                    // Kirim quote sebagai pesan teks terpisah DULUAN
                    await sendTelegramMessage(botToken, partnerId, visualQuote + "(membalas dengan sticker)");
                }
                // Lalu kirim stickernya (tanpa caption override)
                await copyTelegramMessage(botToken, partnerId, userId, message.message_id);
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
        else if (text === '/reward') { // <-- IMPLEMENTASI COMMAND /REWARD BARU
            const rewardKeyboard = {
                inline_keyboard: [
                    [{ text: '💸 Cek Reward & Daftar', url: 'https://fizatalk-reward.app' }]
                ]
            };

            await sendTelegramMessage(
                botToken, 
                userId, 
                '✨ <b>Dapatkan Reward dengan Membuat Konten Fizatalk!</b>\n\nYuk, buat video tentang pengalaman chat seru kamu di Fizatalk dan dapatkan penghasilan berdasarkan jumlah *views* yang kamu dapatkan!\n\n💰 <b>Skema Reward:</b>\n• 10k views = Rp 10.000\n• 50k views = Rp 50.000\n• 100k views = Rp 100.000\n\nKlik tombol di bawah untuk info lebih lanjut dan cara klaim reward!',
                rewardKeyboard
            );
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
        else if (text.startsWith('/topup ')) {
          const amount = parseInt(text.split(' ')[1]);
          
          // Validasi minimal 1000 koin
          if (isNaN(amount) || amount < 1000) {
            await sendTelegramMessage(botToken, userId, '❌ Jumlah tidak valid. Minimum top-up 1000 koin (Rp 1.000).\n\nContoh: /topup 1000');
            return new Response('OK', { status: 200 });
          }

          // ** PERUBAHAN UTAMA DI SINI **
          // 1. Batalkan semua request 'pending' yang belum memiliki bukti pembayaran
          await supabase
              .from('topup_requests')
              .update({ status: 'cancelled' })
              .eq('user_id', userId)
              .eq('status', 'pending')
              .is('payment_proof', null); // HANYA batalkan yang belum dibayar

          // 2. Cek apakah ada request pending DENGAN BUKTI PEMBAYARAN
          const { count: paymentPendingCount } = await supabase
              .from('topup_requests')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', userId)
              .eq('status', 'pending')
              .not('payment_proof', 'is', null); // Cari yang sudah ada bukti bayar

          if (paymentPendingCount && paymentPendingCount > 0) {
              await sendTelegramMessage(
                botToken, 
                userId, 
                '⚠️ Anda memiliki transaksi yang sudah dibayar dan sedang menunggu konfirmasi admin. Mohon tunggu verifikasi sebelum membuat transaksi baru.'
              );
              return new Response('OK', { status: 200 });
          }
          // ** END PERUBAHAN UTAMA **

          const COIN_PRICE = 1; // 1 koin = Rp 1 (Sesuai perhitungan di file ini)
          // Generate unique code (1-999)
          const uniqueCode = Math.floor(Math.random() * 999) + 1;
          const totalAmount = (amount * COIN_PRICE) + uniqueCode;

          
          // Buat request top-up baru dengan unique code
          const { data: topupRequest, error: insertError } = await supabase
            .from('topup_requests')
            .insert({
              user_id: userId,
              amount: amount,
              unique_code: uniqueCode,
              status: 'pending', // Status 'pending' menandakan WAITING PAYMENT
              payment_proof: null // JANGAN UBAH INI
            })
            .select()
            .single();

          if (insertError) {
            console.error('Error creating topup request:', insertError);
            await sendTelegramMessage(botToken, userId, '❌ Terjadi kesalahan. Silakan coba lagi.');
            return new Response('OK', { status: 200 });
          }

          // Update user state untuk menunggu bukti pembayaran (partner_id tetap)
          await supabase
            .from('telegram_users')
            .update({ 
              state: 'awaiting_payment', // State ini yang harus di-clear jika batal atau bukti bayar dikirim
              // partner_id tidak diubah
            })
            .eq('id', userId);

          // Kirim QRIS menggunakan file_id dari database
          const qrisFileId = await getBotSetting(supabase, 'qris_file_id');
          
          const cancelKeyboard = {
              inline_keyboard: [
                  [{ text: '❌ Batalkan Transaksi', callback_data: 'cancel_topup' }] 
              ]
          };

          const caption = `💳 <b>TOP-UP ${amount} KOIN</b>\n\n📝 <b>ID Transaksi:</b> <code>${topupRequest.id}</code>\n\n💰 <b>Rincian Pembayaran:</b>\n• Harga: Rp ${(amount * COIN_PRICE).toLocaleString('id-ID')}\n• Kode Unik: <b>Rp ${uniqueCode}</b>\n• <b>Total Bayar: Rp ${totalAmount.toLocaleString('id-ID')}</b>\n\n⚠️ <b>PENTING:</b> Transfer HARUS sesuai total + kode unik!\n\n📸 <b>Langkah selanjutnya:</b>\n1. Scan QRIS di atas\n2. Transfer <b>Rp ${totalAmount.toLocaleString('id-ID')}</b>\n3. <b>Kirim foto bukti bayar ke chat ini</b>\n4. Tunggu konfirmasi admin (1-5 menit)\n\n💎 1 koin = Rp 1`;

          if (qrisFileId) {
            try {
              const resp = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: userId,
                  photo: qrisFileId,
                  caption,
                  parse_mode: 'HTML',
                  reply_markup: cancelKeyboard 
                })
              });

              if (!resp.ok) {
                const errText = await resp.text();
                console.error('sendPhoto failed:', errText);
                await sendTelegramMessage(botToken, userId, `❌ Gagal mengirim QRIS.\n\n${caption}`, cancelKeyboard);
              }
            } catch (e) {
              console.error('sendPhoto exception:', e);
              await sendTelegramMessage(botToken, userId, `❌ Gagal mengirim QRIS.\n\n${caption}`, cancelKeyboard);
            }
          } else {
            await sendTelegramMessage(botToken, userId, `⚠️ QRIS belum diatur admin.\n\n${caption}`, cancelKeyboard);
          }

          return new Response('OK', { status: 200 });
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
        // CS Commands untuk approve/reject topup
        else if (text.startsWith('/approve ') || text.startsWith('/reject ')) {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          
          // Cek apakah user adalah CS
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }

          const isApprove = text.startsWith('/approve ');
          const command = isApprove ? '/approve ' : '/reject ';
          const requestId = text.substring(command.length).trim();
          
          if (!requestId) {
            await sendTelegramMessage(botToken, userId, `❌ Format salah. Gunakan: ${command}<request_id>`);
            return new Response('OK', { status: 200 });
          }

          // Get topup request
          const { data: topupRequest, error: fetchError } = await supabase
            .from('topup_requests')
            .select('*')
            .eq('id', requestId)
            .eq('status', 'pending')
            .single();

          if (fetchError || !topupRequest) {
            await sendTelegramMessage(botToken, userId, '❌ Transaksi tidak ditemukan atau sudah diproses.');
            return new Response('OK', { status: 200 });
          }

          if (isApprove) {
            // Logika Approve
            const COIN_PRICE = 1; // 1 koin = Rp 1
            const coinsFromUniqueCode = topupRequest.unique_code / COIN_PRICE;
            const totalCoinsToAdd = topupRequest.amount + coinsFromUniqueCode;

            // Update coins
            const { data: userData } = await supabase
              .from('telegram_users')
              .select('coins')
              .eq('id', topupRequest.user_id)
              .single();

            const currentCoins = userData?.coins || 0;
            const newBalance = currentCoins + totalCoinsToAdd;

            await supabase
              .from('telegram_users')
              .update({ coins: newBalance })
              .eq('id', topupRequest.user_id);

            // Record transaction
            await supabase.from('coin_transactions').insert({
              user_id: topupRequest.user_id,
              amount: totalCoinsToAdd,
              type: 'topup',
              description: `Top-up ${totalCoinsToAdd} koin via QRIS`
            });

            // Update status topup request
            await supabase
              .from('topup_requests')
              .update({ 
                status: 'approved',
                processed_at: new Date().toISOString()
              })
              .eq('id', requestId);
              
            // Cek dan reset state user jika masih awaiting_payment
            const { data: userState } = await supabase
                .from('telegram_users')
                .select('state, partner_id')
                .eq('id', topupRequest.user_id)
                .single();
            
            if (userState?.state === 'awaiting_payment') {
                const newState = userState.partner_id ? 'chatting' : 'idle';
                await supabase
                    .from('telegram_users')
                    .update({ state: newState })
                    .eq('id', topupRequest.user_id);
            }

            // Notify user
            await sendTelegramMessage(
              botToken,
              topupRequest.user_id,
              `✅ <b>TOP-UP BERHASIL!</b>\n\n💰 ${totalCoinsToAdd} koin telah ditambahkan ke akun kamu.\n💳 Saldo baru: ${newBalance} koin\n\nTerima kasih! 🎉`
            );

            // Notify CS
            await sendTelegramMessage(
              botToken,
              userId,
              `✅ Transaksi <code>${requestId}</code> telah diapprove.\n\nUser menerima ${totalCoinsToAdd} koin.`
            );
          } else {
            // Logika Reject
            // Update status topup request
            await supabase
              .from('topup_requests')
              .update({ 
                status: 'rejected',
                processed_at: new Date().toISOString()
              })
              .eq('id', requestId);

            // Cek dan reset state user jika masih awaiting_payment
            const { data: userState } = await supabase
                .from('telegram_users')
                .select('state, partner_id')
                .eq('id', topupRequest.user_id)
                .single();
            
            if (userState?.state === 'awaiting_payment') {
                const newState = userState.partner_id ? 'chatting' : 'idle';
                await supabase
                    .from('telegram_users')
                    .update({ state: newState })
                    .eq('id', topupRequest.user_id);
            }

            // Notify user
            await sendTelegramMessage(
              botToken,
              topupRequest.user_id,
              `❌ <b>TOP-UP DITOLAK</b>\n\n😔 Maaf, transaksi top-up ${topupRequest.amount} koin kamu tidak dapat diproses.\n\nKemungkinan:\n- Bukti pembayaran tidak valid\n- Nominal tidak sesuai\n- Transfer belum diterima\n\nSilakan coba lagi dengan /topup atau hubungi admin @FizaTalkCS untuk bantuan.`
            );

            // Notify CS
            await sendTelegramMessage(
              botToken,
              userId,
              `❌ Transaksi <code>${requestId}</code> telah direject.`
            );
          }
        }
        // COMMAND /PROMO - ADMIN ONLY
        else if (text === '/promo') {

          // 1. Setup Pesan & Waktu (WIB) - Promo 5 JAM
          // Get promo premium file_id from database
          const promoFileId = await getPromoPremiumFileId(supabase);

          const expireDate = new Date();
          expireDate.setHours(expireDate.getHours() + 5); // Promo 5 jam
          const timeStringWIB = expireDate.toLocaleTimeString('id-ID', { 
              timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' 
          }) + ' WIB';

          const promoMessage = `🚨 <b>PROMO TERBATAS! HANYA 5 JAM!</b> 🚨

⏰ <b>Berakhir pukul ${timeStringWIB}</b> - Jangan sampai kelewatan!

🎁 <b>PENAWARAN EKSKLUSIF:</b>
━━━━━━━━━━━━━━━━━━━━
📦 <b>PREMIUM 5 BULAN</b>
<s>Rp 300.000</s> → <b>HANYA Rp 10.000!</b>
✨ <b>BONUS: 5.000 KOIN GRATIS!</b>
━━━━━━━━━━━━━━━━━━━━

🎯 <b>KEUNTUNGAN PREMIUM:</b>
• Pilih target gender chat
• Pilih target lokasi chat  
• ⭐ Badge Premium eksklusif
• 🚀 Prioritas matching tercepat

💥 <b>HEMAT 97%!</b> Kesempatan langka ini tidak akan terulang!

⚡ <b>Ambil sekarang sebelum kehabisan!</b>`;

          const promoKeyboard = {
            inline_keyboard: [
              [{ text: '🔥 5 Bulan + 5000 Koin - Rp 10.000', callback_data: 'buy_premium_150' }],
              [{ text: '💎 6 Bulan - Rp 25.000', callback_data: 'buy_premium_180' }],
              [{ text: '📦 1 Bulan - Rp 5.000', callback_data: 'buy_premium_30' }],
              [{ text: '📅 1 Minggu - Rp 2.000', callback_data: 'buy_premium_7' }],
              [{ text: '⚡ 3 Hari - Rp 1.000', callback_data: 'buy_premium_3' }],
              [{ text: '❌ Abaikan & Lanjut Cari Partner', callback_data: 'dismiss_promo_search' }]
            ]
          };

          // 2. OPTIMIZED: Use RPC to get eligible users (HEMAT BIAYA CLOUD)
          // RPC get_promo_eligible_users() mengembalikan:
          // - User chatting (apapun last_active nya)
          // - User idle yang aktif dalam 5 jam terakhir
          // - Exclude premium users
          
          await sendTelegramMessage(botToken, userId, '🚀 Memulai proses antrean promo dengan RPC optimized... (Mohon tunggu)');

          console.log('🚀 Memulai Promo dengan RPC get_promo_eligible_users (cost-optimized)...');
          
          // Call RPC to get eligible users in single query
          const { data: eligibleUsers, error: rpcError } = await supabase.rpc('get_promo_eligible_users');
          
          if (rpcError) {
            console.error('Error calling get_promo_eligible_users RPC:', rpcError);
            await sendTelegramMessage(botToken, userId, `❌ Error RPC: ${rpcError.message}`);
            return new Response('OK', { status: 200 });
          }
          
          if (!eligibleUsers || eligibleUsers.length === 0) {
            await sendTelegramMessage(botToken, userId, '📭 Tidak ada user eligible yang ditemukan.\n\n<i>Kriteria: User chatting ATAU user idle yang aktif dalam 5 jam terakhir (exclude premium)</i>');
            return new Response('OK', { status: 200 });
          }
          
          console.log(`📋 Found ${eligibleUsers.length} eligible users from RPC`);
          
          // Count stats
          const idleCount = eligibleUsers.filter((u: any) => u.current_state === 'idle').length;
          const chattingCount = eligibleUsers.filter((u: any) => u.current_state === 'chatting').length;
          
          // Batch insert to promo_queue (PAGE_SIZE = 1000 untuk menghindari timeout)
          const PAGE_SIZE = 1000;
          let totalQueued = 0;
          
          for (let i = 0; i < eligibleUsers.length; i += PAGE_SIZE) {
            const batch = eligibleUsers.slice(i, i + PAGE_SIZE);
            
            const queueBatch = batch.map((u: any) => ({
              user_id: u.user_id,
              message_text: promoMessage,
              photo_url: promoFileId || null,
              promo_buttons: promoKeyboard,
              // Set status berdasarkan state: idle = pending (kirim langsung), chatting = waiting_idle
              status: u.current_state === 'idle' ? 'pending' : 'waiting_idle',
              expires_at: expireDate.toISOString()
            }));
            
            const { error: insertError } = await supabase.from('promo_queue').insert(queueBatch);
            
            if (insertError) {
              console.error(`❌ Gagal insert batch ${i}:`, insertError);
            } else {
              totalQueued += queueBatch.length;
              console.log(`✅ Queued batch: ${queueBatch.length} users (Total: ${totalQueued})`);
            }
          }

          if (totalQueued > 0) {
            await sendTelegramMessage(botToken, userId, `✅ <b>Promo Dijadwalkan!</b>\n\n📊 Total Target: ${totalQueued} user\n├ 📤 Idle (kirim langsung): ${idleCount}\n└ ⏳ Chatting (kirim saat keluar chat): ${chattingCount}\n\n⏳ Expired: Pukul ${timeStringWIB}\n🤖 pg_cron akan memproses dalam 1 menit...\n\n<i>💡 Optimasi: Hanya target user aktif dalam 5 jam terakhir</i>`);
            
            // pg_cron akan otomatis memproses promo_job setiap menit

          } else {
            await sendTelegramMessage(botToken, userId, '📭 Tidak ada user target yang ditemukan (atau terjadi error).');
          }

        } // COMMAND /LANJUTKAN_PROMO - RESUME PROMO YANG TERHENTI
        else if (text === '/lanjutkan_promo') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) return new Response('OK', { status: 200 });

          // Cek berapa pending yang ada
          const { count: pendingCount } = await supabase
            .from('promo_queue')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

          if (!pendingCount || pendingCount === 0) {
            await sendTelegramMessage(botToken, userId, '✅ Tidak ada promo pending yang perlu dilanjutkan.');
            return new Response('OK', { status: 200 });
          }

          await sendTelegramMessage(botToken, userId, `🔄 <b>Melanjutkan Promo...</b>\n\n📊 Pending: ${pendingCount} user\n🤖 pg_cron akan memproses dalam 1 menit...`);
          
          // pg_cron akan otomatis memproses promo_job setiap menit

        } // COMMAND /BERSIHKAN - MAINTENANCE & CLEANUP SYSTEM
        else if (text === '/bersihkan') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) return new Response('OK', { status: 200 });

          await sendTelegramMessage(botToken, userId, '♻️ <b>Memulai Pembersihan Total...</b>\n\n1. Hapus Pesan Promo Expired\n2. Cek Transaksi > 30 Menit\n3. Hapus Database Sampah');

          const now = new Date().toISOString();
          const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          
          let deletedPromoMsgCount = 0;
          let expiredPaymentCount = 0;
          let dbCleanedCount = 0;

          // ============================================================
          // 1. HAPUS PESAN PROMO YANG SUDAH EXPIRED - BATCH OPTIMIZED
          // ============================================================
          
          // A. Promo yang status 'sent' DAN waktunya sudah lewat (perlu hapus pesan Telegram)
          const { data: expiredPromos } = await supabase
            .from('promo_queue')
            .select('id, user_id, sent_message_id')
            .eq('status', 'sent')
            .lt('expires_at', now)
            .limit(50);

          if (expiredPromos && expiredPromos.length > 0) {
            // Delete Telegram messages in parallel
            const deletePromises = expiredPromos
              .filter((p: any) => p.sent_message_id)
              .map((p: any) => deleteTelegramMessage(botToken, p.user_id, p.sent_message_id));
            const results = await Promise.allSettled(deletePromises);
            
            deletedPromoMsgCount = results.filter(r => r.status === 'fulfilled').length;
            
            // Batch delete from database
            const idsToDelete = expiredPromos.map((p: any) => p.id);
            await supabase.from('promo_queue').delete().in('id', idsToDelete);
          }
          
          // B. Batch delete promo yang tidak pernah terkirim dan sudah expired (single query)
          const { count: expiredNotSentCount } = await supabase
            .from('promo_queue')
            .delete({ count: 'exact' })
            .in('status', ['pending', 'waiting_idle', 'failed_blocked', 'expired'])
            .lt('expires_at', now)
            .is('sent_message_id', null);
          
          dbCleanedCount += expiredNotSentCount || 0;

          // ============================================================
          // 2. HANDLE TRANSAKSI PENDING > 30 MENIT - BATCH OPTIMIZED
          // ============================================================
          
          // A. TOPUP REQUESTS - Fetch all then batch process
          const { data: staleTopups } = await supabase
            .from('topup_requests')
            .select('id, user_id, message_id')
            .eq('status', 'pending')
            .lt('created_at', thirtyMinsAgo)
            .is('payment_proof', null);

          if (staleTopups && staleTopups.length > 0) {
            // Delete Telegram messages in parallel
            const deleteMsgPromises = staleTopups
              .filter((t: any) => t.message_id)
              .map((t: any) => deleteTelegramMessage(botToken, t.user_id, t.message_id));
            await Promise.allSettled(deleteMsgPromises);
            
            // Batch delete from database
            const topupIds = staleTopups.map((t: any) => t.id);
            await supabase.from('topup_requests').delete().in('id', topupIds);
            
            // Get user partner info in batch
            const userIds = [...new Set(staleTopups.map((t: any) => t.user_id))];
            const { data: usersData } = await supabase
              .from('telegram_users')
              .select('id, partner_id')
              .in('id', userIds);
            
            // Update user states and notify in parallel
            const updatePromises = (usersData || []).map(async (user: any) => {
              const newState = user.partner_id ? 'chatting' : 'idle';
              await supabase.from('telegram_users').update({ state: newState }).eq('id', user.id);
              const msg = user.partner_id 
                ? '⏳ <b>Top-up Expired</b>\nBatas waktu 30 menit habis. Kamu masih terhubung dengan partner.'
                : '⏳ <b>Top-up Expired</b>\nBatas waktu 30 menit habis.';
              await sendTelegramMessage(botToken, user.id, msg);
            });
            await Promise.allSettled(updatePromises);
            
            expiredPaymentCount += staleTopups.length;
          }

          // B. PREMIUM REQUESTS - Same batch pattern
          const { data: stalePremium } = await supabase
            .from('premium_requests')
            .select('id, user_id, message_id')
            .eq('status', 'pending')
            .lt('created_at', thirtyMinsAgo)
            .is('payment_proof', null);

          if (stalePremium && stalePremium.length > 0) {
            // Delete Telegram messages in parallel
            const deleteMsgPromises = stalePremium
              .filter((p: any) => p.message_id)
              .map((p: any) => deleteTelegramMessage(botToken, p.user_id, p.message_id));
            await Promise.allSettled(deleteMsgPromises);
            
            // Batch delete from database
            const premiumIds = stalePremium.map((p: any) => p.id);
            await supabase.from('premium_requests').delete().in('id', premiumIds);
            
            // Get user partner info in batch
            const userIds = [...new Set(stalePremium.map((p: any) => p.user_id))];
            const { data: usersData } = await supabase
              .from('telegram_users')
              .select('id, partner_id')
              .in('id', userIds);
            
            // Update user states and notify in parallel
            const updatePromises = (usersData || []).map(async (user: any) => {
              const newState = user.partner_id ? 'chatting' : 'idle';
              await supabase.from('telegram_users').update({ state: newState }).eq('id', user.id);
              const msg = user.partner_id 
                ? '⏳ <b>Premium Expired</b>\nBatas waktu 30 menit habis. Kamu masih terhubung dengan partner.'
                : '⏳ <b>Premium Expired</b>\nBatas waktu 30 menit habis.';
              await sendTelegramMessage(botToken, user.id, msg);
            });
            await Promise.allSettled(updatePromises);
            
            expiredPaymentCount += stalePremium.length;
          }

          // ============================================================
          // 3. HARD DELETE DATABASE SAMPAH - BATCH QUERIES
          // ============================================================
          
          const [cleanTopupResult, cleanPremiumResult, cleanPendingResult] = await Promise.all([
            supabase.from('topup_requests').delete({ count: 'exact' }).in('status', ['expired', 'cancelled', 'rejected']),
            supabase.from('premium_requests').delete({ count: 'exact' }).in('status', ['expired', 'cancelled', 'rejected']),
            supabase.from('pending_transactions').delete({ count: 'exact' }).eq('status', 'pending').lt('created_at', thirtyMinsAgo)
          ]);

          dbCleanedCount += (cleanTopupResult.count || 0) + (cleanPremiumResult.count || 0) + (cleanPendingResult.count || 0);

          // ============================================================
          // 4. FIX ZOMBIE USER - BATCH OPTIMIZED
          // ============================================================
          const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
          let zombieStats = {
            waitingNoQueue: 0,
            stuckAwaitingPayment: 0,
            orphanChatting: 0,
            oneSidedChat: 0,
            idleWithPartner: 0,
            inconsistentWaiting: 0,
            syncedToQueue: 0
          };

          // Fetch all relevant data in parallel (batch queries)
          const [
            waitingUsersResult,
            queueUsersResult,
            awaitingPaymentResult,
            orphanChattingResult,
            usersWithPartnerResult,
            idleWithPartnerResult,
            inconsistentResult,
            allQueueResult
          ] = await Promise.all([
            supabase.from('telegram_users').select('id').eq('state', 'waiting').is('partner_id', null).lt('last_active', oneMinuteAgo),
            supabase.from('waiting_queue').select('user_id'),
            supabase.from('telegram_users').select('id').eq('state', 'awaiting_payment').lt('last_active', oneMinuteAgo).limit(50),
            supabase.from('telegram_users').select('id').eq('state', 'chatting').is('partner_id', null).lt('last_active', oneMinuteAgo).limit(30),
            supabase.from('telegram_users').select('id, partner_id').not('partner_id', 'is', null).lt('last_active', oneMinuteAgo).limit(30),
            supabase.from('telegram_users').select('id').eq('state', 'idle').not('partner_id', 'is', null).lt('last_active', oneMinuteAgo).limit(30),
            supabase.from('telegram_users').select('id').eq('state', 'waiting').not('partner_id', 'is', null).lt('last_active', oneMinuteAgo).limit(30),
            supabase.from('waiting_queue').select('user_id, joined_at').lt('joined_at', oneMinuteAgo).limit(50)
          ]);

          const waitingUsers = waitingUsersResult.data || [];
          const queueUsers = queueUsersResult.data || [];
          const realQueueIds = new Set(queueUsers.map((u: any) => u.user_id));

          // TYPE 1: State='waiting' but not in queue - batch upsert
          const missingFromQueue = waitingUsers.filter((u: any) => !realQueueIds.has(u.id));
          if (missingFromQueue.length > 0) {
            const upsertData = missingFromQueue.map((u: any) => ({ user_id: u.id, joined_at: now }));
            await supabase.from('waiting_queue').upsert(upsertData);
            zombieStats.waitingNoQueue = missingFromQueue.length;
          }

          // TYPE 2: Awaiting payment without pending tx - batch check
          const awaitingPaymentUsers = awaitingPaymentResult.data || [];
          if (awaitingPaymentUsers.length > 0) {
            const userIds = awaitingPaymentUsers.map((u: any) => u.id);
            const [topupCheck, premiumCheck, txCheck] = await Promise.all([
              supabase.from('topup_requests').select('user_id').in('user_id', userIds).eq('status', 'pending'),
              supabase.from('premium_requests').select('user_id').in('user_id', userIds).eq('status', 'pending'),
              supabase.from('pending_transactions').select('user_id').in('user_id', userIds).eq('status', 'pending')
            ]);
            
            const hasPendingTx = new Set([
              ...(topupCheck.data || []).map((t: any) => t.user_id),
              ...(premiumCheck.data || []).map((p: any) => p.user_id),
              ...(txCheck.data || []).map((t: any) => t.user_id)
            ]);
            
            const stuckUsers = awaitingPaymentUsers.filter((u: any) => !hasPendingTx.has(u.id));
            if (stuckUsers.length > 0) {
              const stuckIds = stuckUsers.map((u: any) => u.id);
              await supabase.from('telegram_users').update({ state: 'waiting', partner_id: null }).in('id', stuckIds);
              await supabase.from('waiting_queue').upsert(stuckIds.map((id: any) => ({ user_id: id, joined_at: now })));
              zombieStats.stuckAwaitingPayment = stuckUsers.length;
            }
          }

          // TYPE 3: Orphan chatting - batch update + parallel notify
          const orphanChattingUsers = orphanChattingResult.data || [];
          if (orphanChattingUsers.length > 0) {
            const orphanIds = orphanChattingUsers.map((u: any) => u.id);
            await Promise.all([
              supabase.from('telegram_users').update({ state: 'waiting' }).in('id', orphanIds),
              supabase.from('waiting_queue').upsert(orphanIds.map((id: any) => ({ user_id: id, joined_at: now })))
            ]);
            // Notify in parallel
            await Promise.allSettled(orphanIds.map((id: any) => 
              sendTelegramMessage(botToken, id, '🔄 Sesi chat terputus. Kamu dimasukkan kembali ke antrian pencarian...')
            ));
            zombieStats.orphanChatting = orphanChattingUsers.length;
          }

          // TYPE 4: One-sided chat - need to check partners
          const usersWithPartner = usersWithPartnerResult.data || [];
          if (usersWithPartner.length > 0) {
            const partnerIds = [...new Set(usersWithPartner.map((u: any) => u.partner_id))];
            const { data: partners } = await supabase.from('telegram_users').select('id, partner_id').in('id', partnerIds);
            const partnerMap = new Map((partners || []).map((p: any) => [p.id, p.partner_id]));
            
            const oneSidedUsers = usersWithPartner.filter((u: any) => partnerMap.get(u.partner_id) !== u.id);
            if (oneSidedUsers.length > 0) {
              const oneSidedIds = oneSidedUsers.map((u: any) => u.id);
              await Promise.all([
                supabase.from('telegram_users').update({ state: 'waiting', partner_id: null }).in('id', oneSidedIds),
                supabase.from('waiting_queue').upsert(oneSidedIds.map((id: any) => ({ user_id: id, joined_at: now })))
              ]);
              await Promise.allSettled(oneSidedIds.map((id: any) => 
                sendTelegramMessage(botToken, id, '🔄 Koneksi partner tidak sinkron. Kamu dimasukkan ke antrian pencarian...')
              ));
              zombieStats.oneSidedChat = oneSidedUsers.length;
            }
          }

          // TYPE 5 & 6: Idle with partner + Inconsistent waiting - batch update
          const idleWithPartner = idleWithPartnerResult.data || [];
          const inconsistentUsers = inconsistentResult.data || [];
          const allNeedFixIds = [
            ...idleWithPartner.map((u: any) => u.id),
            ...inconsistentUsers.map((u: any) => u.id)
          ];
          
          if (allNeedFixIds.length > 0) {
            await Promise.all([
              supabase.from('telegram_users').update({ state: 'waiting', partner_id: null }).in('id', allNeedFixIds),
              supabase.from('waiting_queue').upsert(allNeedFixIds.map((id: any) => ({ user_id: id, joined_at: now })))
            ]);
            zombieStats.idleWithPartner = idleWithPartner.length;
            zombieStats.inconsistentWaiting = inconsistentUsers.length;
          }

          // SYNC: Queue users with wrong state - batch fix
          const allQueueUsers = allQueueResult.data || [];
          if (allQueueUsers.length > 0) {
            const queueUserIds = allQueueUsers.map((q: any) => q.user_id);
            const { data: queueUsersState } = await supabase.from('telegram_users').select('id, state, partner_id').in('id', queueUserIds);
            
            const needSync = (queueUsersState || []).filter((u: any) => u.state !== 'waiting' && !u.partner_id);
            if (needSync.length > 0) {
              const syncIds = needSync.map((u: any) => u.id);
              await supabase.from('telegram_users').update({ state: 'waiting' }).in('id', syncIds);
              zombieStats.syncedToQueue = needSync.length;
            }
          }

          // TOTAL ZOMBIE YANG DIPERBAIKI
          const totalZombies = zombieStats.waitingNoQueue + zombieStats.stuckAwaitingPayment + 
                               zombieStats.orphanChatting + zombieStats.oneSidedChat + 
                               zombieStats.idleWithPartner + zombieStats.inconsistentWaiting +
                               zombieStats.syncedToQueue;

          // LAPORAN DETAIL
          const report = `✅ <b>PEMBERSIHAN SELESAI</b>
          
📨 <b>Pesan Promo Dihapus:</b> ${deletedPromoMsgCount}
⏳ <b>Transaksi Expired (30m):</b> ${expiredPaymentCount}
🗑 <b>Database Sampah Dihapus:</b> ${dbCleanedCount} row

🧟 <b>ZOMBIE USER DIPERBAIKI:</b> ${totalZombies}
├ Waiting tanpa Queue: ${zombieStats.waitingNoQueue}
├ Stuck Awaiting Payment: ${zombieStats.stuckAwaitingPayment}
├ Orphan Chatting: ${zombieStats.orphanChatting}
├ One-sided Chat: ${zombieStats.oneSidedChat}
├ Idle dengan Partner: ${zombieStats.idleWithPartner}
├ Inconsistent Waiting: ${zombieStats.inconsistentWaiting}
└ Synced ke Queue: ${zombieStats.syncedToQueue}

✅ Semua zombie dimasukkan ke antrian! 🚀`;
          
          await sendTelegramMessage(botToken, userId, report);
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
            await sendPremiumOffer(supabase, botToken, userId, 'pilih target gender');
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
            await showLocationFilterPremiumOffer(supabase, botToken, userId);
            return new Response('OK', { status: 200 });
          }

          // Buat keyboard lokasi untuk premium (dengan opsi Semua di atas)
          const locationButtons = [[{ text: '🌏 Semua Lokasi', callback_data: 'target_loc_semua' }]];
          for (let i = 0; i < LOCATION_LIST.length; i += 3) {
            const row = [];
            for (let j = 0; j < 3 && i + j < LOCATION_LIST.length; j++) {
              const loc = LOCATION_LIST[i + j];
              row.push({ text: loc, callback_data: `target_loc_${loc}` });
            }
            locationButtons.push(row);
          }

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
        // COMMAND /APPROVE_PREMIUM & /REJECT_PREMIUM - ADMIN ONLY
        else if (text.startsWith('/approve_premium ') || text.startsWith('/reject_premium ')) {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }

          const isApprove = text.startsWith('/approve_premium ');
          const command = isApprove ? '/approve_premium ' : '/reject_premium ';
          const requestId = text.substring(command.length).trim();
          
          if (!requestId) {
            await sendTelegramMessage(botToken, userId, `❌ Format salah. Gunakan: ${command}<request_id>`);
            return new Response('OK', { status: 200 });
          }

          // Get premium request
          const { data: premiumRequest, error: fetchError } = await supabase
            .from('premium_requests')
            .select('*')
            .eq('id', requestId)
            .eq('status', 'pending')
            .single();

          if (fetchError || !premiumRequest) {
            await sendTelegramMessage(botToken, userId, '❌ Transaksi premium tidak ditemukan atau sudah diproses.');
            return new Response('OK', { status: 200 });
          }

          if (isApprove) {
            // Calculate premium end date
            const currentPremiumUntil = await supabase
              .from('telegram_users')
              .select('premium_until')
              .eq('id', premiumRequest.user_id)
              .single();

            let premiumEndDate: Date;
            const existingPremium = currentPremiumUntil.data?.premium_until;
            
            if (existingPremium && new Date(existingPremium) > new Date()) {
              // Extend existing premium
              premiumEndDate = new Date(existingPremium);
              premiumEndDate.setDate(premiumEndDate.getDate() + premiumRequest.duration_days);
            } else {
              // Start new premium from now
              premiumEndDate = new Date();
              premiumEndDate.setDate(premiumEndDate.getDate() + premiumRequest.duration_days);
            }

            // Update user premium status
            await supabase
              .from('telegram_users')
              .update({ premium_until: premiumEndDate.toISOString() })
              .eq('id', premiumRequest.user_id);

            // Update premium request status
            await supabase
              .from('premium_requests')
              .update({ 
                status: 'approved',
                processed_at: new Date().toISOString()
              })
              .eq('id', requestId);

            // Record transaction
            await supabase.from('coin_transactions').insert({
              user_id: premiumRequest.user_id,
              amount: -premiumRequest.price,
              type: 'premium_purchase',
              description: `Pembelian Premium ${premiumRequest.duration_days} hari`
            });

            // Notify user
            await sendTelegramMessage(
              botToken,
              premiumRequest.user_id,
              `🎉 <b>SELAMAT! KAMU SEKARANG PREMIUM!</b>\n\n✨ Premium aktif selama ${premiumRequest.duration_days} hari\n📅 Berlaku hingga: ${premiumEndDate.toLocaleDateString('id-ID')}\n\n🎯 Gunakan /target untuk memilih gender chat!\n\nTerima kasih telah bergabung dengan Fizatalk Premium! 💎`
            );

            // Notify admin
            await sendTelegramMessage(
              botToken,
              userId,
              `✅ Premium <code>${requestId}</code> telah diapprove.\n\nUser ${premiumRequest.user_id} sekarang Premium hingga ${premiumEndDate.toLocaleDateString('id-ID')}.`
            );
          } else {
            // Reject premium request
            await supabase
              .from('premium_requests')
              .update({ 
                status: 'rejected',
                processed_at: new Date().toISOString()
              })
              .eq('id', requestId);

            // Notify user
            await sendTelegramMessage(
              botToken,
              premiumRequest.user_id,
              `❌ <b>PEMBELIAN PREMIUM DITOLAK</b>\n\n😔 Maaf, pembelian Premium ${premiumRequest.duration_days} hari tidak dapat diproses.\n\nKemungkinan:\n- Bukti pembayaran tidak valid\n- Nominal tidak sesuai\n- Transfer belum diterima\n\nSilakan coba lagi atau hubungi admin @FizaTalkCS untuk bantuan.`
            );

            // Notify admin
            await sendTelegramMessage(
              botToken,
              userId,
              `❌ Premium <code>${requestId}</code> telah direject.`
            );
          }
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
        // COMMAND /SET_QRIS - ADMIN ONLY (Reply to photo to set QRIS)
        if (text === '/set_qris') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          if (message.reply_to_message?.photo) {
            const photo = message.reply_to_message.photo;
            const fileId = photo[photo.length - 1].file_id;
            await setBotSetting(supabase, 'qris_file_id', fileId, userId);
            await sendTelegramMessage(botToken, userId, `✅ <b>QRIS berhasil diperbarui!</b>\n\nFile ID: <code>${fileId.substring(0, 30)}...</code>`);
          } else {
            await sendTelegramMessage(botToken, userId, '⚠️ Reply ke foto QRIS dengan command /set_qris');
          }
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
        // COMMAND /CEK_FOTO - ADMIN ONLY (Check current photo settings)
        if (text === '/cek_foto') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          const qrisId = await getBotSetting(supabase, 'qris_file_id');
          const premiumId = await getBotSetting(supabase, 'premium_file_id');
          const promoId = await getBotSetting(supabase, 'promo_premium_file_id');
          
          await sendTelegramMessage(botToken, userId, `📷 <b>Status Foto Bot:</b>\n\n🔹 QRIS: ${qrisId ? '✅ Sudah diset' : '❌ Belum diset'}\n🔹 Premium: ${premiumId ? '✅ Sudah diset' : '❌ Belum diset'}\n🔹 Promo: ${promoId ? '✅ Sudah diset' : '❌ Belum diset'}\n\n<b>Cara set foto:</b>\n1. Kirim foto ke bot\n2. Reply foto dengan:\n   • /set_qris - untuk QRIS\n   • /set_premium - untuk Premium\n   • /set_promo - untuk Promo`);
        }
        // COMMAND /AUTOBLOCK - ADMIN ONLY (Toggle auto-blocking system)
        if (text === '/autoblock on' || text === '/autoblock off' || text === '/autoblock') {
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (userId.toString() !== csChatId) {
            await sendTelegramMessage(botToken, userId, '❌ Command ini hanya untuk admin.');
            return new Response('OK', { status: 200 });
          }
          
          if (text === '/autoblock') {
            // Tampilkan status saat ini
            const currentStatus = await getBotSetting(supabase, 'autoblock_enabled');
            const isEnabled = currentStatus !== 'off'; // Default ON jika tidak ada setting
            
            const statusText = isEnabled 
              ? '🟢 <b>AKTIF</b> - Sistem deteksi spam berjalan normal'
              : '🔴 <b>NONAKTIF</b> - Sistem deteksi spam dimatikan (hemat biaya cloud)';
            
            await sendTelegramMessage(
              botToken,
              userId,
              `🛡️ <b>Status Auto-Block</b>\n\n${statusText}\n\n<b>Penggunaan:</b>\n• <code>/autoblock on</code> - Aktifkan auto-block\n• <code>/autoblock off</code> - Nonaktifkan auto-block\n\n⚠️ <i>Menonaktifkan auto-block akan menghentikan semua operasi database terkait deteksi spam (read/insert/update/delete pada tabel spam_detection dan blocked_users).</i>`
            );
          } else {
            // Set status baru
            const newStatus = text === '/autoblock on' ? 'on' : 'off';
            await setBotSetting(supabase, 'autoblock_enabled', newStatus, userId);
            
            if (newStatus === 'on') {
              await sendTelegramMessage(
                botToken,
                userId,
                `🟢 <b>Auto-Block DIAKTIFKAN</b>\n\nSistem deteksi spam sekarang berjalan normal.\n\n⚠️ Ini akan meningkatkan penggunaan database cloud.`
              );
            } else {
              await sendTelegramMessage(
                botToken,
                userId,
                `🔴 <b>Auto-Block DINONAKTIFKAN</b>\n\nSistem deteksi spam telah dimatikan.\n\n✅ <b>Keuntungan:</b>\n• Tidak ada read/insert ke tabel spam_detection\n• Tidak ada operasi blokir otomatis\n• Hemat biaya cloud\n\n⚠️ <b>Risiko:</b>\n• Spam/promosi tidak akan terdeteksi otomatis\n• User spam tidak akan diblokir otomatis\n\n💡 Aktifkan kembali dengan <code>/autoblock on</code>`
              );
            }
          }
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
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
