export const CHANNEL_USERNAME = "@FizaTalkCh";
export const CHANNEL_FEEDBACK_BATCH_LIMIT = 100;
export const CHANNEL_POST_MAX_LENGTH = 2_800;
export const CHANNEL_FEEDBACK_MAX_LENGTH = 2_000;

export type ChannelPostKind =
  | "greeting"
  | "question"
  | "feedback_request"
  | "feedback_summary"
  | "giveaway"
  | "admin";

export interface GeneratedChannelContent {
  text: string;
  points: string[];
}

export function wibDateKey(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export function dailyChannelKind(now = new Date()): Exclude<ChannelPostKind, "feedback_summary" | "giveaway"> {
  const day = Number(wibDateKey(now).slice(-2));
  return (["greeting", "question", "feedback_request"] as const)[day % 3];
}

export function sanitizeFeedbackForPrompt(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[tautan dihapus]")
    .replace(/@[A-Za-z0-9_]{3,}/g, "[nama pengguna dihapus]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[nomor dihapus]")
    .replace(/[<>\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

export function validGiveawayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === "link.dana.id" || host === "dana.id" || host === "t.me";
  } catch {
    return false;
  }
}

export function normalizeGeneratedContent(
  value: unknown,
  allowedUrl?: string,
): GeneratedChannelContent {
  if (!value || typeof value !== "object") throw new Error("AI mengembalikan format tidak valid.");
  const candidate = value as { text?: unknown; points?: unknown };
  if (typeof candidate.text !== "string" || !Array.isArray(candidate.points)) {
    throw new Error("AI tidak mengembalikan teks dan poin yang diperlukan.");
  }
  const text = candidate.text.replace(/\r\n/g, "\n").trim();
  if (text.length < 20 || text.length > CHANNEL_POST_MAX_LENGTH) {
    throw new Error("Panjang draf AI tidak sesuai batas Telegram.");
  }
  if (/<\/?[a-z][^>]*>/i.test(text) || /@[A-Za-z0-9_]{3,}/.test(text)) {
    throw new Error("Draf mengandung markup atau nama pengguna yang tidak diizinkan.");
  }
  const urls = text.match(/https?:\/\/[^\s]+/gi) ?? [];
  if (urls.some((url) => !allowedUrl || url !== allowedUrl) || (allowedUrl && urls.length !== 1)) {
    throw new Error("Draf mengandung tautan yang tidak disetujui admin.");
  }
  const withoutUrl = allowedUrl ? text.replace(allowedUrl, "") : text;
  if (/\+?\d[\d\s().-]{7,}\d/.test(withoutUrl)) {
    throw new Error("Draf mengandung nomor telepon atau data pribadi.");
  }
  const points = candidate.points
    .filter((point): point is string => typeof point === "string")
    .map((point) => point.replace(/\s+/g, " ").trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 6);
  return { text, points };
}

export function channelKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    greeting: "Sapaan harian",
    question: "Pertanyaan komunitas",
    feedback_request: "Permintaan saran",
    feedback_summary: "Rangkuman masukan",
    giveaway: "Giveaway admin",
    admin: "Posting admin",
  };
  return labels[kind] ?? "Posting komunitas";
}

export function channelAnswerButtonEnabled(post: { kind: string; metadata?: unknown }): boolean {
  const metadata = post.metadata && typeof post.metadata === "object"
    ? post.metadata as { answer_button?: unknown }
    : {};
  if (typeof metadata.answer_button === "boolean") return metadata.answer_button;
  return post.kind === "question" || post.kind === "feedback_request";
}

export function channelPostReplyMarkup(
  post: { kind: string; metadata?: unknown },
  botUsername: string,
): { inline_keyboard: Array<Array<{ text: string; url: string }>> } | undefined {
  const username = botUsername.trim().replace(/^@/, "");
  if (!channelAnswerButtonEnabled(post) || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return undefined;
  return {
    inline_keyboard: [[{
      text: "💬 Jawab di Bot",
      url: `https://t.me/${username}?start=feedback`,
    }]],
  };
}

export function channelReviewKeyboard(postId: string) {
  return {
    inline_keyboard: [
      [{ text: "✅ Setujui & Posting", callback_data: `ca_approve_${postId}` }],
      [
        { text: "✏️ Poles Jawaban Saya", callback_data: `ca_polish_${postId}` },
        { text: "🔄 Variasi Baru", callback_data: `ca_regenerate_${postId}` },
      ],
      [{ text: "❌ Tolak Draf", callback_data: `ca_reject_${postId}` }],
    ],
  };
}
