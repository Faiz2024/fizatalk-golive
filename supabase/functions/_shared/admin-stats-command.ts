interface CachedAdminStats {
  kpis?: { inactive30?: number };
  activity?: Array<{
    date?: string;
    baru?: number;
    aktif?: number;
    churn?: number;
  }>;
}

// `/stats` hanya membaca hasil agregasi yang sudah dicache, tidak memindai tabel pengguna.
export function formatCachedDailyAdminStats(cacheValue: string | null | undefined): string | null {
  if (!cacheValue) return null;
  let raw: CachedAdminStats;
  try {
    raw = JSON.parse(cacheValue) as CachedAdminStats;
  } catch {
    return null;
  }
  const latest = raw.activity?.at(-1);
  if (!latest?.date) return null;
  const displayDate = new Date(`${latest.date}T00:00:00+07:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  return `📊 <b>Statistik Pengguna Harian</b>\n` +
    `📅 Tanggal: <b>${displayDate}</b>\n\n` +
    `📈 <b>Pengguna Baru:</b> ${latest.baru ?? 0} user\n` +
    `🔥 <b>Pengguna Aktif:</b> ${latest.aktif ?? 0} user\n` +
    `💤 <b>Tidak Aktif (>30 Hari):</b> ${raw.kpis?.inactive30 ?? 0} user\n` +
    `📉 <b>User Churn (Tepat 30 Hari):</b> ${latest.churn ?? 0} user`;
}
