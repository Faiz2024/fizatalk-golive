import { privateBotMembership } from './reengagement-policy.ts';

export async function handleBotMembership(
  update: unknown,
  supabase: any,
  notifyPartner: (id: number) => Promise<unknown>,
): Promise<void> {
  const membership = privateBotMembership(update);
  if (!membership) return;
  const { data, error } = await supabase.rpc('set_bot_membership', {
    p_user_id: membership.userId, p_blocked: membership.blocked,
  });
  if (error) throw error;
  if (data?.changed && data.partner_id) await notifyPartner(Number(data.partner_id));
}