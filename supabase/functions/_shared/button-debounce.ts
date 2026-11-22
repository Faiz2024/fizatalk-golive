import { TtlCache } from "./runtime-cache.ts";

export const BUTTON_COOLDOWN_MS = 2000;

// Timestamp disimpan 60 detik; maksimal 20.000 kombinasi pengguna/aksi.
const buttonClicks = new TtlCache<string, number>(60_000, 20_000);

export function isButtonOnCooldown(
  userId: number,
  action: string,
  now = Date.now(),
): boolean {
  const key = `${userId}_${action}`;
  const previousClick = buttonClicks.get(key, now);
  if (previousClick !== undefined && now - previousClick < BUTTON_COOLDOWN_MS) {
    return true;
  }
  buttonClicks.set(key, now, now);
  return false;
}

export function clearButtonClicksForTests(): void {
  buttonClicks.clear();
}
