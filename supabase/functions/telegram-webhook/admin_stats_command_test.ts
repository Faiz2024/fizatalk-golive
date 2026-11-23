import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatCachedDailyAdminStats } from "../_shared/admin-stats-command.ts";

Deno.test("/stats memakai hari cache terakhir dan angkanya tanpa agregasi ulang", () => {
  const message = formatCachedDailyAdminStats(JSON.stringify({
    kpis: { inactive30: 1234 },
    activity: [
      { date: "2026-11-21", baru: 10, aktif: 100, churn: 2 },
      { date: "2026-11-22", baru: 25, aktif: 250, churn: 7 },
    ],
  }));
  assertStringIncludes(message ?? "", "22 November 2026");
  assertStringIncludes(message ?? "", "Pengguna Baru:</b> 25 user");
  assertStringIncludes(message ?? "", "Pengguna Aktif:</b> 250 user");
  assertStringIncludes(message ?? "", "Tidak Aktif (>30 Hari):</b> 1234 user");
  assertStringIncludes(message ?? "", "User Churn (Tepat 30 Hari):</b> 7 user");
});

Deno.test("cache kosong atau rusak tidak menghasilkan statistik palsu", () => {
  assertEquals(formatCachedDailyAdminStats(null), null);
  assertEquals(formatCachedDailyAdminStats("not-json"), null);
  assertEquals(formatCachedDailyAdminStats(JSON.stringify({ activity: [] })), null);
});
