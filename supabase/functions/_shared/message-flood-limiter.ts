import { TtlCache } from "./runtime-cache.ts";

export const MESSAGE_FLOOD_LIMIT = 3;
export const MESSAGE_FLOOD_WINDOW_MS = 1_000;

// Maksimal 50.000 pengguna terbaru; setiap entri hanya menyimpan tiga timestamp.
const recentMessages = new TtlCache<number, number[]>(2_000, 50_000);

export function isMessageFlooding(userId: number, now = Date.now()): boolean {
  const recent = (recentMessages.get(userId, now) ?? []).filter((sentAt) =>
    sentAt <= now && now - sentAt < MESSAGE_FLOOD_WINDOW_MS
  );
  if (recent.length >= MESSAGE_FLOOD_LIMIT) return true;

  recent.push(now);
  recentMessages.set(userId, recent, now);
  return false;
}

export function clearMessageFloodLimiterForTests(): void {
  recentMessages.clear();
}
