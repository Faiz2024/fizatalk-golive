export const REENGAGEMENT_BATCH = 50;
export const REENGAGEMENT_PACING_MS = 1500;
export const REENGAGEMENT_BLOCKED_AT = '2099-12-31T00:00:00+07:00';

export function reengagementWindow(now = Date.now()): boolean {
  const hour = new Date(now + 7 * 3600_000).getUTCHours();
  return hour >= 11 && hour < 22;
}

export function privateBotMembership(update: any): { userId: number; blocked: boolean } | null {
  const event = update?.my_chat_member;
  if (event?.chat?.type !== 'private') return null;
  const status = event.new_chat_member?.status;
  if (status !== 'kicked' && status !== 'member') return null;
  const userId = event.chat.id;
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return { userId, blocked: status === 'kicked' };
}

/** One sender, bounded runtime; rate limits/transport errors stop the batch. */
export async function runReengagementDrip<T>(
  users: T[],
  send: (user: T) => Promise<boolean>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => number = Date.now,
): Promise<number> {
  const started = now();
  let processed = 0;
  for (const user of users.slice(0, REENGAGEMENT_BATCH)) {
    if (now() - started >= 100_000 || !reengagementWindow(now())) break;
    const keepGoing = await send(user);
    processed++;
    if (!keepGoing) break;
    if (processed < users.length) await wait(REENGAGEMENT_PACING_MS);
  }
  return processed;
}