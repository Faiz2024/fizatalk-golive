import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
function startOfTodayWIB(): Date {
  const now = new Date();
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  wib.setUTCHours(0, 0, 0, 0);
  return new Date(wib.getTime() - WIB_OFFSET_MS);
}
function daysAgoWIB(days: number): Date {
  return new Date(startOfTodayWIB().getTime() - days * 86400000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const todayStart = startOfTodayWIB().toISOString();
    const day30 = daysAgoWIB(30).toISOString();
    const day31 = daysAgoWIB(31).toISOString();
    const weekStart = daysAgoWIB(6).toISOString();

    const [newToday, activeToday, inactive30, churn, createdRows, activeRows] = await Promise.all([
      supabase.from("telegram_users").select("id", { count: "exact", head: true }).gte("created_at", todayStart),
      supabase.from("telegram_users").select("id", { count: "exact", head: true }).gte("last_active", todayStart),
      supabase.from("telegram_users").select("id", { count: "exact", head: true }).lt("last_active", day30),
      supabase.from("telegram_users").select("id", { count: "exact", head: true }).gte("last_active", day31).lt("last_active", day30),
      supabase.from("telegram_users").select("created_at").gte("created_at", weekStart).limit(50000),
      supabase.from("telegram_users").select("last_active").gte("last_active", weekStart).limit(50000),
    ]);

    const errs = [newToday, activeToday, inactive30, churn, createdRows, activeRows].find((r) => r.error);
    if (errs?.error) throw errs.error;

    // Bucket 7-day activity by WIB date
    const days: { key: string; label: string; baru: number; aktif: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = daysAgoWIB(i);
      const key = new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
      const label = d.toLocaleDateString("id-ID", {
        weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta",
      });
      days.push({ key, label, baru: 0, aktif: 0 });
    }
    const bucket = (iso: string) =>
      new Date(new Date(iso).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
    for (const r of createdRows.data ?? []) {
      const d = days.find((x) => x.key === bucket(r.created_at as string));
      if (d) d.baru++;
    }
    for (const r of activeRows.data ?? []) {
      const d = days.find((x) => x.key === bucket(r.last_active as string));
      if (d) d.aktif++;
    }

    return new Response(
      JSON.stringify({
        kpis: {
          newToday: newToday.count ?? 0,
          activeToday: activeToday.count ?? 0,
          inactive30: inactive30.count ?? 0,
          churn: churn.count ?? 0,
        },
        activity: days.map(({ label, baru, aktif }) => ({ label, baru, aktif })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[admin-stats] error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
