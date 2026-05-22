import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Semua agregasi dihitung di DB via RPC (hemat biaya cloud, akurat WIB)
    const { data, error } = await supabase.rpc("get_admin_dashboard_stats");
    if (error) throw error;

    const raw = data as {
      kpis: { newToday: number; activeToday: number; inactive30: number; churn: number; reengageReturns: number };
      activity: { date: string; baru: number; aktif: number; churn: number; baru30hariLalu: number }[];
      reengage_activity: {
        date: string;
        cute_pleading_cat: number;
        mysterious_gift_box: number;
        grumpy_cute_cat: number;
        social_match_hearts: number;
        total: number;
      }[];
    };

    // Format label tanggal Indonesia (di edge agar client tetap ringan)
    const activity = (raw.activity ?? []).map((row) => {
      const d = new Date(`${row.date}T00:00:00+07:00`);
      const label = d.toLocaleDateString("id-ID", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "Asia/Jakarta",
      });
      return {
        label,
        baru: row.baru ?? 0,
        aktif: row.aktif ?? 0,
        churn: row.churn ?? 0,
        baru30hariLalu: row.baru30hariLalu ?? 0,
      };
    });

    // Format label tanggal Indonesia untuk aktivitas re-engagement
    const reengageActivity = (raw.reengage_activity ?? []).map((row) => {
      const d = new Date(`${row.date}T00:00:00+07:00`);
      const label = d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Jakarta",
      });
      return {
        label,
        cute_pleading_cat: row.cute_pleading_cat ?? 0,
        mysterious_gift_box: row.mysterious_gift_box ?? 0,
        grumpy_cute_cat: row.grumpy_cute_cat ?? 0,
        social_match_hearts: row.social_match_hearts ?? 0,
        total: row.total ?? 0,
      };
    });

    return new Response(
      JSON.stringify({ kpis: raw.kpis, activity, reengageActivity }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[admin-stats] error:", e);
    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      sb.rpc("log_bot_event", {
        p_level: "error", p_source: "admin-stats", p_event: "exception",
        p_user_id: null, p_message: msg, p_context: { stack: (e as Error).stack ?? null },
      }).then(() => {}, () => {});
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
