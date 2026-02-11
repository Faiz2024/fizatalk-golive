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


// NOTE: Helper functions isUserBlocked, simpleUpsertUser, smartUpsertUser, shouldShowChannelJoin
// telah DIHAPUS - logika sudah terintegrasi dalam comprehensive_search_action RPC
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
💵 <b>Total Transfer: Rp ${totalAmount.toLocaleString('id-ID')}</b>

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

  💰 Harga: Rp ${price.toLocaleString('id-ID')}
  🔢 Kode Unik: ${uniqueCode}
  💵 <b>Total Transfer: Rp ${totalAmount.toLocaleString('id-ID')}</b>
  
  📸 Kirim <b>foto bukti pembayaran</b> ke chat ini.
  
  📱 <b>CARA PEMBAYARAN:</b>
  1️⃣ Screenshot/simpan gambar QRIS di atas
  2️⃣ Buka aplikasi e-wallet (GoPay/OVO/DANA/ShopeePay/dll)
  3️⃣ Pilih menu <b>Scan QR</b> atau <b>Bayar</b>
  4️⃣ Pilih dari galeri, lalu pilih gambar QRIS
  5️⃣ Masukkan nominal <b>TEPAT Rp ${totalAmount.toLocaleString('id-ID')}</b>
  6️⃣ Konfirmasi pembayaran

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
    return null;
  } catch (e) {
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
function getPremiumBenefitsText(): string {
  return `✨ <b>KEUNTUNGAN PREMIUM:</b>
• 🎯 Pilih target gender chat
• 📍 Pilih target lokasi chat
• ⭐ Badge Premium
• 🚀 Prioritas matching`;
}

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
        { text: '🔍 Cari Partner Baru', callback_data: 'search_partner' }
      ],
      [
        { text: '🔄 Hubungi Kembali', callback_data: `reconnect_${partnerId}` }
      ],
      [
        { text: '🚩 Laporkan', callback_data: `report_user_${partnerId}`},
        { text: '😎 Asik', callback_data: `rate_asik_${partnerId}` }
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
  skipIfLowPenalty: boolean = false
): string | null {
  const baseAction = isNext ? '🔄 <b>Mengakhiri chat dan mencari partner baru...</b>' : '🔍 Mencari partner untuk kamu...';
  
  // Jika tidak ada reputation atau penalty di bawah 40
  if (!reputation || reputation.penalty_points < 40) {
    // Jika skipIfLowPenalty = true, tidak perlu kirim pesan
    if (skipIfLowPenalty) {
      return null;
    }
    return `${baseAction}\n\n${isNext ? '✨ Bagaimana pengalaman chat kamu? Beri penilaian untuk partner!' : 'Mohon tunggu sebentar!'}`; 
   }
  
  // Penalty 40-69: Status Peringatan
  if (reputation.status === 'warning') {
    return `${baseAction}\n\n⚠️ <b>Status: Peringatan</b>\n\n${reputation.message || 'Anda mendapat beberapa laporan negatif dari pengguna lain.'} Harap perbaiki sikap atau akun berisiko dibatasi.\n\n<i>Anda akan lepas dari peringatan jika banyak partner yang suka berinteraksi dengan Anda</i>.`;
  }
  
  // Penalty 70-99: Status Kritis
  if (reputation.status === 'critical') {
    return `${baseAction}\n\n🔞 <b>Status: Kritis</b>\n\n${reputation.message || 'Akun Anda dalam kondisi kritis.'} Satu laporan lagi dan Anda akan dibanned.\n\n🚫 DAFTAR PELANGGARAN KERAS:

<b>NSFW / Sange:</b> Chat seks, meminta pap, atau pembahasan vulgar.

<b>Spam:</b> Mengirim pesan berulang, promosi, iklan, atau link.

<b>Toxic:</b> Kasar, menghina SARA, atau bullying.

<b>Troll:</b> Skip chat terus-menerus tanpa interaksi.

<b>Cara lepas dari peringatan dan menghindari blokir:</b>
1️⃣ Hentikan semua perilaku di atas segera.
2️⃣ Berinteraksi dengan partner secara sopan dan ramah.
3️⃣ Dapatkan feedback positif dari partner.`;
  }
  
  // Default fallback - masih tampilkan jika penalty >= 40 tapi status tidak dikenali
  return `${baseAction}\n\nMohon tunggu sebentar!`;
}

// HELPER: Kirim pesan pencarian dengan reputasi (1 pesan gabungan)
// skipIfLowPenalty: jika true dan penalty < 40, tidak kirim pesan sama sekali
async function sendSearchingMessage(
  botToken: string, 
  userId: number, 
  reputation?: ComprehensiveSearchResult['reputation'], 
  isNext: boolean = false,
  skipIfLowPenalty: boolean = false,
  replyMarkup?: any // Tambahkan parameter ini
): Promise<void> {
  const message = buildSearchMessageWithReputation(reputation, isNext, skipIfLowPenalty);
  if (message) {
    await sendTelegramMessage(botToken, userId, message, replyMarkup);
  }
}



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
  'report_user': 3000,       // 3 detik - lapor user
  'rate_asik': 3000,         // 3 detik - rate asik
  'reconnect': 4000,         // 4 detik - reconnect partner
  'pay_fine': 4000,          // 4 detik - bayar denda
  'cancel_topup': 2000,      // 2 detik - cancel topup
  'cancel_premium': 2000,    // 2 detik - cancel premium
  'cancel_fine': 2000,       // 2 detik - cancel fine
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
  if (callbackData === 'search_partner') return 'search_partner';
  if (callbackData === 'chat_next') return 'chat_next';
  if (callbackData === 'chat_stop') return 'chat_stop';
  if (callbackData.startsWith('send_gift_')) return 'send_gift';
  if (callbackData.startsWith('init_topup_')) return 'init_topup';
  if (callbackData.startsWith('buy_premium_')) return 'buy_premium';
  if (callbackData.startsWith('report_user_')) return 'report_user';
  if (callbackData.startsWith('rate_asik_')) return 'rate_asik';
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
  return 'default';
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
          { text: '💎 Upgrade Premium (Anti-Banned)', callback_data: 'buy_premium_30' }
        ]
      ]
    };

    const blockedMessage = `🚫 <b>AKUN ANDA DIBLOKIR</b>

  ⚠️ <b>Alasan:</b> Kami menerima terlalu banyak laporan negatif terkait aktivitas chat Anda. Demi kenyamanan komunitas, akses chat Anda <b>dinonaktifkan sampai batas waktu yang tidak ditentukan.</b>

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
  
  // Handle jika user banned via penalty points
  // Handle jika user banned via penalty points
  if (!result.success && result.error === 'user_banned') {
    const blockedKeyboard = {
      inline_keyboard: [
        [
          { text: '💸 Bayar Denda - Rp 10.000', callback_data: 'pay_fine' }
        ],
        [
          { text: '💎 Upgrade Premium (Anti-Banned)', callback_data: 'buy_premium_7' }
        ]
      ]
    };

    const blockedMessage = `🚫 <b>AKUN ANDA DIBLOKIR</b>

  ⚠️ <b>Alasan:</b> Kami menerima terlalu banyak laporan negatif terkait aktivitas chat Anda. Demi kenyamanan komunitas, akses chat Anda <b>dinonaktifkan sampai batas waktu yang tidak ditentukan.</b>

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
async function handleComprehensiveSearchResult(
  supabase: any,
  botToken: string,
  userId: number,
  result: ComprehensiveSearchResult,
  isNext: boolean = false
): Promise<void> {
  const penaltyPoints = result.reputation?.penalty_points || 0;

  // Buat keyboard "Laporkan" & "Asik" jika user menekan Next dan penalti < 40
  let endChatKeyboard = undefined;
  if (isNext && result.old_partner_id && penaltyPoints < 40) {
    endChatKeyboard = {
      inline_keyboard: [
        [
          { text: '🚩 Laporkan', callback_data: `report_user_${result.old_partner_id}` },
          { text: '😎 Asik', callback_data: `rate_asik_${result.old_partner_id}` }
        ]
      ]
    };
  }
  
  if (!result.matched) {
    // Tidak ada partner yang cocok, user sudah dimasukkan ke antrian oleh RPC
    
    // Untuk tombol Next: selalu tampilkan pesan "Mengakhiri chat..." (dengan peringatan jika >= 40)
    // Untuk tombol Cari Partner: tampilkan pesan mencari (dengan peringatan jika >= 40)
    await sendSearchingMessage(botToken, userId, result.reputation, isNext, false, endChatKeyboard);
    return;
  }
  
  // Partner ditemukan!
  const partnerId = result.partner_id!;
  
  // Jika penalty >= 40: TETAP tampilkan pesan pencarian + peringatan walaupun langsung dapat partner
  // skipIfLowPenalty = true: jika penalty < 40 dan matched, lewati pesan pencarian
  if (isNext || penaltyPoints >= 40) {
    await sendSearchingMessage(botToken, userId, result.reputation, isNext, false, endChatKeyboard);
  }
  // Jika penalty < 40 dan matched: langsung ke notifikasi pairing (lewati pesan pencarian)
  
  // Kirim notifikasi pairing berhasil
  const { data: myself } = await supabase.from('telegram_users').select('premium_until').eq('id', userId).single();
  const myPremiumUntil = myself?.premium_until;

  // 2. Status Premium Partner
  // INI PENTING: Kita pakai data dari RPC result, JANGAN query DB lagi.
  const partnerPremiumUntil = result.partner_premium_until;

  // Kirim notifikasi pairing (Tanpa Query Tambahan)
  await sendPairingNotifications(botToken, userId, partnerId, myPremiumUntil ?? null, partnerPremiumUntil ?? null);
}

// HELPER: Panggil RPC find_and_pair_partner dan kirim notifikasi jika berhasil (LEGACY)
async function searchPartnerWithRPC(supabase: any, botToken: string, userId: number): Promise<boolean> {
  
    // Panggil RPC function di database - semua logika matching dilakukan di sini
    const { data, error } = await supabase.rpc('find_and_pair_partner', {
      p_user_id: userId
  
    });
    
    if (error) {
      // Fallback: masukkan user ke antrian secara manual
      await supabase.from('waiting_queue').upsert({
        user_id: userId,
        joined_at: new Date().toISOString()
      });
      await supabase.from('telegram_users').update({ state: 'waiting' }).eq('id', userId);
      return false;
    }
    
    // Cek hasil RPC
    if (!data.success) {
      // Error dari RPC (user_not_found, user_already_chatting, dll)
      if (data.error === 'user_already_chatting') {
        await sendTelegramMessage(botToken, userId, '⚠️ Kamu sudah dalam sesi chat!');
      }
      return false;
    }
    
    if (!data.matched) {
      // Tidak ada partner yang cocok, user sudah dimasukkan ke antrian oleh RPC
      // Kirim pesan mencari dengan reputasi (1 pesan gabungan)
      await sendSearchingMessage(botToken, userId, data.reputation, false);
      return false;
    }
    
    // Partner ditemukan! Kirim notifikasi ke kedua user
    const matchedPartnerId = data.partner_id;
    
    // Kirim notifikasi pairing berhasil
    await sendPairingNotifications(botToken, userId, matchedPartnerId, null, null);
    return true;
    
  }


// HELPER: Kirim notifikasi setelah pairing berhasil
async function sendPairingNotifications(
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

  // Send notifications in parallel
  await Promise.all([
    sendTelegramMessage(
      botToken, 
      user1Id, 
      `✅ <b>Partner ditemukan!</b> Mulai ngobrol sekarang.\n\nHarap sopan dan patuhi aturan.`,
      buildChatKeyboard(user1IsPremium)
    ),
    sendTelegramMessage(
      botToken, 
      user2Id, 
      `✅ <b>Partner ditemukan!</b> Mulai ngobrol sekarang.\n\nHarap sopan dan patuhi aturan.`,
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

// Helper Global untuk mengirim promo agar sinkron di semua fitur
async function executePromoAction(supabase: any, botToken: string, userId: number) {
  const promoFileId = await getPromoPremiumFileId(supabase);
  
  const promoMessage = `🚨 <b>PROMO TERBATAS! HANYA 5 JAM!</b> 🚨

⏰ <b>Berakhir dalam 5 jam dari sekarang!</b> - Jangan sampai kelewatan!

🎁 <b>PENAWARAN EKSKLUSIF:</b>
━━━━━━━━━━━━━━━━━━━━
📦 <b>PREMIUM 5 BULAN</b>
<s>Rp 300.000</s> → <b>HANYA Rp 10.000!</b>
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
      [{ text: '🔥 5 Bulan / Rp10.000', callback_data: 'buy_premium_150' }],
      [{ text: '💎 6 Bulan / Rp 25.000', callback_data: 'buy_premium_180' }],
      [{ text: '📦 1 Bulan / Rp 5.000', callback_data: 'buy_premium_30' }],
      [{ text: '📅 1 Minggu / Rp 2.000', callback_data: 'buy_premium_7' }],
      [{ text: '⚡ 3 Hari / Rp 1.000', callback_data: 'buy_premium_3' }],
      [{ text: '🔍 Abaikan & Lanjut Cari Partner', callback_data: 'dismiss_promo_search' }]
    ]
  };

  return await sendPromoToUser(botToken, userId, promoMessage, promoFileId, promoKeyboard);
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
      // STEP 3: CEK STATE AWAITING_PAYMENT
      // ============================================
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
            '⚠️ <b>Kamu sedang dalam proses pembayaran!</b>\n\nSelesaikan pembayaran dan <b>kirim bukti transfer ke chat ini</b> atau tekan tombol "Batalkan" pada pesan QRIS untuk membatalkan transaksi.'
          );
          return new Response('OK', { status: 200 });
        }
      }

      if (callbackData === 'cancel_topup') {
          // SATU RPC: Batalkan topup + reset state
          const { data: cancelResult } = await supabase.rpc('cancel_topup_transaction', {
            p_user_id: userId
          });

          await answerCallbackQuery(botToken, query.id, '🚫 Transaksi dibatalkan!');
          
          // Hapus pesan QRIS
          if (message) {
              await deleteTelegramMessage(botToken, message.chat.id, message.message_id);
          }
          
          // Kirim pesan konfirmasi pembatalan
          const newState = cancelResult?.new_state || 'idle';
          const nextActionText = newState === 'chatting' ? 'Anda dapat melanjutkan chat Anda.' : 'Anda dapat memulai chat baru dengan /start.';
          await sendTelegramMessage(
            botToken,
            userId,
            `🚫 <b>TRANSAKSI TOP-UP DIBATALKAN</b>\n\n${nextActionText}\n\nGunakan /topup untuk top-up koin lagi.`
          );
          
          return new Response('OK', { status: 200 });
      }

      // --- LOGIKA BAYAR DENDA (BUKA BLOKIR) - SATU RPC ---
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
        
        // SATU RPC: Update state user ke awaiting_payment
        await supabase.rpc('set_user_payment_state', { p_user_id: userId });
        
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

      // --- LOGIKA PEMBATALAN DENDA DARI INLINE BUTTON (SATU RPC) ---
      if (callbackData === 'cancel_fine') {
        // SATU RPC: Batalkan fine + reset state
        await supabase.rpc('cancel_fine_transaction', { p_user_id: userId });

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

        // Jika sudah set lokasi, langsung cari partner dengan logika baru
        // Cek antrian dulu, jika tidak ada yang cocok baru masuk antrian
        await searchPartnerWithQueueCheck(supabase, botToken, userId);

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

        // SATU RPC: Set state ke awaiting_payment
        await supabase.rpc('set_user_payment_state', { p_user_id: userId });

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

      // --- LOGIKA SEARCH PARTNER (INLINE BUTTON) - SATU PANGGILAN RPC ---
      if (callbackData === 'search_partner') {
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
              // Sudah join tapi ditahan db -> masukkan ke antrean
              await searchPartnerWithQueueCheck(supabase, botToken, userId);
              return new Response('OK', { status: 200 });
            }
          }
          // -
          
          // Handle hasil pencarian partner (isNext = false untuk tombol Cari Partner)
          await handleComprehensiveSearchResult(supabase, botToken, userId, result, false);
        }

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

      // --- LOGIKA CHAT NEXT (INLINE BUTTON) - SATU PANGGILAN RPC ---
      if (callbackData === 'chat_next') {
        await answerCallbackQuery(botToken, query.id, '⏭️ Mencari partner baru...');
        
        // SATU PANGGILAN RPC: handles upsert, blocked check, end chat, reputation, search
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
          // Cek channel join HANYA jika should_check_channel = true
          if (searchResult.should_check_channel) {
            const { isMember, botNotAdmin } = await checkChannelMembership(botToken, userId, REQUIRED_CHANNEL);
            if (!isMember) {
              // Untuk tombol Next: tetap tampilkan pesan "Mengakhiri chat..." dengan peringatan jika >= 40
              await sendSearchingMessage(botToken, userId, searchResult.reputation, true, false);
              await sendJoinChannelMessage(botToken, userId, botNotAdmin);
              return new Response('OK', { status: 200 });
            }
          }
          
          // Cek apakah user dapat promo
          if (searchResult.chat_ended) {
            const { data: promoUser } = await supabase.rpc('handle_end_chat_promo_logic', { p_user_id: userId });
            
            if (promoUser?.should_send) {
              // Untuk tombol Next: tetap tampilkan pesan "Mengakhiri chat..." dengan peringatan jika >= 40
              await sendSearchingMessage(botToken, userId, searchResult.reputation, true, false);
              // JIKA DAPAT PROMO: Tampilkan promo dan BERHENTI
              await executePromoAction(supabase, botToken, userId);
              return new Response('OK', { status: 200 });
            }
          }
          
          // Handle hasil pencarian partner (isNext = true untuk tombol Next)
          await handleComprehensiveSearchResult(supabase, botToken, userId, searchResult, true);
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
        if (!reportResult?.success) {
          if (reportResult?.error === 'already_reported') {
            await answerCallbackQuery(botToken, query.id, '⚠️ Kamu sudah memberi rating ke partner ini!', true);
          } else if (reportResult?.error === 'rate_limit_exceeded') {
            await answerCallbackQuery(botToken, query.id, '⚠️ Batas 3 rating per jam tercapai!', true);
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
        } else if (rateType === 'asik') {
          ratingEmoji = '😎';
          ratingLabel = 'Asik';
        }
        
        await answerCallbackQuery(botToken, query.id, `✅ Rating ${ratingEmoji} ${ratingLabel} terkirim!`);
        
        // Update pesan dengan menghapus tombol rating
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
          
          try {
            await fetch(`${TELEGRAM_API}${botToken}/editMessageReplyMarkup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                reply_markup: updatedKeyboard
              })
            });
          } catch (e) {
            console.error('Failed to edit rating message:', e);
          }
        }
        
        // Jika user di-ban karena penalty >= 100, kirim notifikasi
        if (reportResult?.is_banned) {
          // Kirim notifikasi ke admin
          const csChatId = Deno.env.get('TELEGRAM_CS_CHAT_ID');
          if (csChatId) {
            await sendTelegramMessage(
              botToken,
              parseInt(csChatId),
              `🚨 <b>USER DIBLOKIR OTOMATIS (PENALTY 100+)</b>\n\n🆔 User ID: <code>${reportedId}</code>\n⚠️ Alasan: Terlalu banyak laporan negatif dari pengguna lain\n📊 Penalty: ${reportResult.new_penalty} poin\n\n⏰ Waktu: ${formatDateTimeWIB(new Date())}`
            );
          }
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

      // --- LOGIKA PEMBELIAN PREMIUM 5 BULAN (150 HARI) + BONUS 5000 KOIN ---
      if (callbackData === 'buy_premium_150') {
        const durationDays = 150; // 5 bulan
        const price = 10000;
        
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
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${formatDateWIB(new Date(userData.premium_until))}\n\nGunakan /target untuk memilih gender chat!`
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
          title: `PREMIUM 5 BULAN (PROMO SPESIAL)`,
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
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${formatDateWIB(new Date(userData.premium_until))}\n\nGunakan /target untuk memilih gender chat!`
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
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${formatDateWIB(new Date(userData.premium_until))}\n\nGunakan /target untuk memilih gender chat!`
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
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${formatDateWIB(new Date(userData.premium_until))}\n\nGunakan /target untuk memilih gender chat!`
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
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${formatDateWIB(new Date(userData.premium_until))}\n\nGunakan /target untuk memilih gender chat!`
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
            `✨ Kamu sudah menjadi user Premium!\n\n📅 Berlaku hingga: ${formatDateWIB(new Date(userData.premium_until))}\n\nGunakan /target untuk memilih gender chat!`
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
      // --- LOGIKA PEMBATALAN PREMIUM (SATU RPC) ---
      if (callbackData === 'cancel_premium') {
        // SATU RPC: Batalkan premium + reset state
        await supabase.rpc('cancel_premium_transaction', { p_user_id: userId });

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
            .update({ 
                premium_until: premiumEndDate.toISOString(),
                penalty_points: 0 
            })
            .eq('id', premiumRequest.user_id);

          await supabase
            .from('blocked_users')
            .update({ is_active: false })
            .eq('user_id', premiumRequest.user_id);

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
            type: 'purchase',
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
          
          await supabase
            .from('telegram_users')
            .update({ penalty_points: 0 }) 
            .eq('id', fineRequest.user_id);

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
    }
    // --- END LOGIKA CALLBACK ---

    // NOTE: Message reaction handler DIHAPUS untuk hemat biaya cloud
    // Setiap reaction memicu 2 query database (blocked check + state check)

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


    // Photo received - log for debugging only
    if (message.photo && message.photo.length > 0) {
      // Photo logging dihapus untuk hemat biaya
    }

    let currentUser: { state: string; partner_id: number | null } | null = null;
    
    const { data: dbUser, error: dbError } = await supabase
      .from('telegram_users')
      .select('state, partner_id')
      .eq('id', userId)
      .maybeSingle();

    if (!dbError && dbUser) {
      currentUser = dbUser;
    }
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
                      [{ text: '💸 Cek Reward & Daftar', url: '' }]
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
              type: 'purchase',
              description: `Pembelian Premium ${premiumRequest.duration_days} hari`
            });

            // Notify user
            await sendTelegramMessage(
              botToken,
              premiumRequest.user_id,
              `🎉 <b>SELAMAT! KAMU SEKARANG PREMIUM!</b>\n\n✨ Premium aktif selama ${premiumRequest.duration_days} hari\n📅 Berlaku hingga: ${formatDateWIB(premiumEndDate)}\n\n🎯 Gunakan /target untuk memilih gender chat!\n\nTerima kasih telah bergabung dengan Fizatalk Premium! 💎`
            );

            // Notify admin
            await sendTelegramMessage(
              botToken,
              userId,
              `✅ Premium <code>${requestId}</code> telah diapprove.\n\nUser ${premiumRequest.user_id} sekarang Premium hingga ${formatDateWIB(premiumEndDate)}.`
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
