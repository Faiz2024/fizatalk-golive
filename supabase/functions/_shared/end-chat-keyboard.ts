// Keyboard pesan akhir chat / penilaian partner pada bot Telegram FizaTalk.
// Dipisahkan agar susunan tombol bisa diuji tanpa memuat fungsi webhook.

export const WOLA_BOT_URL = 'https://t.me/WolaChatBot';
export const SOCIAL_CONTENT_NOTE_PROBABILITY = 0.14;
export const SOCIAL_CONTENT_NOTE =
  '🎬 Abadikan momen seru/lucu di @fizatalk atau @fizavoice lalu upload ke TikTok atau sosmed lainnya. Hubungi admin @fizatalkcs jika kontenmu FYP dan raih hadiah hingga Rp300.000* <i>(menyesuaikan jumlah views)</i>.';

// Sisipkan keterangan konten medsos sesekali di footer pesan akhir chat tanpa menambah panggilan API/DB.
export function formatEndChatMessage(
  baseText: string,
  options?: { suppressPromoNote?: boolean; random?: () => number },
): string {
  if (options?.suppressPromoNote) return baseText;
  const roll = (options?.random ?? Math.random)();
  return roll < SOCIAL_CONTENT_NOTE_PROBABILITY ? `${baseText}\n\n${SOCIAL_CONTENT_NOTE}` : baseText;
}

// Tombol promosi bot chat Wola: hijau (style 'success') dan membuka bot via tautan.
export function wolaChatButton(): { text: string; style: string; url: string } {
  return { text: '🚀Coba Wola - Chat Bot!', style: 'success', url: WOLA_BOT_URL };
}

// Baris penilaian partner (lapor + dua rating positif).
export function partnerRatingRow(partnerId: number): any[] {
  return [
    { text: '🚩 Laporkan', callback_data: `report_user_${partnerId}` },
    { text: '😎 Asik', callback_data: `rate_asik_${partnerId}` },
    { text: '👍 Baik', callback_data: `rate_baik_${partnerId}` }
  ];
}

// Baris tombol untuk pesan "mencari partner baru saat Next": penilaian lalu tombol Wola di bawahnya.
export function buildNextRatingRows(partnerId: number): any[][] {
  return [partnerRatingRow(partnerId), [wolaChatButton()]];
}

// Keyboard lengkap pesan mengakhiri chat:
// 1) penilaian partner, 2) Call Acak + Cari Partner Baru, 3) Coba Wola, 4) Hubungi Kembali.
export function buildEndChatKeyboard(partnerId: number, voiceBotUsername: string | null): any {
  return {
    inline_keyboard: [
      partnerRatingRow(partnerId),
      [
        ...(voiceBotUsername
          ? [{ text: '🎙️ Call Acak', style: 'success', url: `https://t.me/${voiceBotUsername}` }]
          : []),
        { text: '🔍 Cari Partner Baru', style: 'primary', callback_data: 'search_partner' }
      ],
      [wolaChatButton()],
      [{ text: '🔄 Hubungi Kembali', callback_data: `reconnect_${partnerId}` }]
    ]
  };
}
