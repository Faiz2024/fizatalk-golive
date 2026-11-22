import { TtlCache } from "./runtime-cache.ts";

export interface PremiumFilterProfile {
  premium_until: string | null;
  target_gender: string | null;
  target_location: string | null;
}

export const PREMIUM_PROFILE_CACHE_TTL_MS = 20_000;
const profiles = new TtlCache<number, PremiumFilterProfile>(
  PREMIUM_PROFILE_CACHE_TTL_MS,
  5_000,
);
const pendingReads = new Map<number, Promise<PremiumFilterProfile | null>>();

// Hanya data Premium/filter yang di-cache; state chat, partner, dan sanksi selalu dibaca segar.
export async function getPremiumFilterProfile(
  supabase: any,
  userId: number,
): Promise<PremiumFilterProfile | null> {
  const cached = profiles.get(userId);
  if (cached) return cached;

  const pending = pendingReads.get(userId);
  if (pending) return pending;

  const read = (async () => {
    const { data, error } = await supabase
      .from("telegram_users")
      .select("premium_until, target_gender, target_location")
      .eq("id", userId)
      .single();
    if (error || !data) return null;

    const profile: PremiumFilterProfile = {
      premium_until: data.premium_until ?? null,
      target_gender: data.target_gender ?? null,
      target_location: data.target_location ?? null,
    };
    profiles.set(userId, profile);
    return profile;
  })();

  pendingReads.set(userId, read);
  try {
    return await read;
  } finally {
    if (pendingReads.get(userId) === read) pendingReads.delete(userId);
  }
}

export function invalidatePremiumFilterProfile(userId: number): void {
  profiles.delete(userId);
}

export function clearPremiumFilterProfilesForTests(): void {
  profiles.clear();
  pendingReads.clear();
}
