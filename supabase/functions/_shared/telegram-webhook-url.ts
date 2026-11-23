export function railwayTelegramWebhookUrl(domain: string): string {
  const normalized = domain.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("RAILWAY_PUBLIC_DOMAIN is required");
  const baseUrl = /^https:\/\//.test(normalized)
    ? normalized
    : `https://${normalized}`;
  return `${baseUrl}/telegram-webhook`;
}
