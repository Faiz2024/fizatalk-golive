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
    
    // Rentang 7 hari terakhir
    const weekStart = daysAgoWIB(6).toISOString();
    
    // Rentang untuk mengecek data 30 hari yang lalu dari 7 hari terakhir (Hari ke-37 sampai Hari ke-29)
    const week30Start = daysAgoWIB(37).toISOString();
    const week30End = daysAgoWIB(29).toISOString();

    const [
      newToday, activeToday, inactive30, churn, 
      createdRows, activeRows, 
      createdRows30, activeRows30
    ] = await Promise.all([
      // Data untuk KPI Cards
      supabase.from("telegram_users").select("id", { count: "exact", head: true }).gte("created_at", todayStart),
      supabase.from("telegram_users").select("id", { count: "exact", head: true }).gte("last_active", todayStart),
      supabase.from("telegram_users").select("id", { count: "exact", head: true }).lt("last_active", day30),
      supabase.from("telegram_users").select("id", { count: "exact", head: true }).gte("last_active", day31).lt("last_active", day30),
      
      // Data untuk Grafik (7 Hari Terakhir)
      supabase.from("telegram_users").select("created_at").gte("created_at", weekStart).limit(50000),
      supabase.from("telegram_users").select("last_active").gte("last_active", weekStart).limit(50000),
      
      // Data Historis untuk Grafik (Pengguna Baru 30 Hari Lalu & Churn 7 Hari Terakhir)
      supabase.from("telegram_users").select("created_at").gte("created_at", week30Start).lt("created_at", week30End).limit(50000),
      supabase.from("telegram_users").select("last_active").gte("last_active", week30Start).lt("last_active", week30End).limit(50000),
    ]);

    const errs = [newToday, activeToday, inactive30, churn, createdRows, activeRows, createdRows30, activeRows30].find((r) => r.error);
    if (errs?.error) throw errs.error;

    // Menyiapkan array untuk 7 hari terakhir
    const days: { key: string; key30: string; label: string; baru: number; aktif: number; churn: number; baru30hariLalu: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = daysAgoWIB(i);
      const d30 = daysAgoWIB(i + 30); // Tanggal 30 hari yang lalu dari hari 'i'
      
      const key = new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
      const key30 = new Date(d30.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
      
      const label = d.toLocaleDateString("id-ID", {
        weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta",
      });
      days.push({ key, key30, label, baru: 0, aktif: 0, churn: 0, baru30hariLalu: 0 });
    }

    const bucket = (iso: string) => new Date(new Date(iso).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);

    // Memasukkan data 7 hari terakhir (Baru & Aktif)
    for (const r of createdRows.data ?? []) {
      const d = days.find((x) => x.key === bucket(r.created_at as string));
      if (d) d.baru++;
    }
    for (const r of activeRows.data ?? []) {
      const d = days.find((x) => x.key === bucket(r.last_active as string));
      if (d) d.aktif++;
    }

    // Memasukkan data historis 30 hari yang lalu (New Users 30 days ago & Churn)
    for (const r of createdRows30.data ?? []) {
      const b = bucket(r.created_at as string);
      const d = days.find((x) => x.key30 === b);
      if (d) d.baru30hariLalu++;
    }
    for (const r of activeRows30.data ?? []) {
      const b = bucket(r.last_active as string);
      const d = days.find((x) => x.key30 === b);
      if (d) d.churn++;
    }

    return new Response(
      JSON.stringify({
        kpis: {
          newToday: newToday.count ?? 0,
          activeToday: activeToday.count ?? 0,
          inactive30: inactive30.count ?? 0,
          churn: churn.count ?? 0,
        },
        activity: days.map(({ label, baru, aktif, churn, baru30hariLalu }) => ({ 
          label, baru, aktif, churn, baru30hariLalu 
        })),
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