// Statistik dashboard admin: dibaca dari Supabase mandiri via RPC (WIB).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { createDatabaseFetch } from "../_shared/service-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        global: { fetch: createDatabaseFetch(fetch, 12_000) },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );

    // Opsi paksa hitung ulang (lewati cache 5 menit)
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch (_) { /* tanpa body */ }

    // Pembukaan biasa membaca cache langsung agar tidak memicu agregasi berat.
    // Refresh paksa tetap mencoba RPC, tetapi selalu punya cadangan hasil terakhir.
    const { data: cacheRows, error: cacheError } = await supabase
      .from("bot_settings")
      .select("key, value")
      .in("key", ["admin_dashboard_stats_cache", "referral_stats_cache"]);
    if (cacheError) throw cacheError;
    const cachedDashboardText = cacheRows?.find((row) => row.key === "admin_dashboard_stats_cache")?.value;
    const cachedReferralText = cacheRows?.find((row) => row.key === "referral_stats_cache")?.value;
    const cachedDashboard = cachedDashboardText ? JSON.parse(cachedDashboardText) : null;
    const cachedReferral = cachedReferralText ? JSON.parse(cachedReferralText) : null;

    let raw: {
      kpis: { newToday: number; activeToday: number; inactive30: number; churn: number; reengageReturns: number; revenueToday: number };
      activity: { date: string; baru: number; aktif: number; churn: number; baru30hariLalu: number }[];
      reengage_activity: {
        date: string;
        cute_pleading_cat: number;
        mysterious_gift_box: number;
        grumpy_cute_cat: number;
        social_match_hearts: number;
        total: number;
      }[];
      reengage_daily_stats: {
        date: string;
        eligible: number;
        eligible7d: number;
        eligible30d: number;
        sent: number;
        sent7d: number;
        sent30d: number;
      }[];
      reengage_summary: {
        eligible7d: number;
        eligible30d: number;
        sent7d: number;
        sent30d: number;
        sentTotal: number;
      };
      transactions: {
        date: string;
        label: string;
        premium: number;
        topup: number;
        fine: number;
        total: number;
      }[];
      special_promo: {
        eligibleToday: number;
        sentToday: number;
        purchasedToday: number;
      };
    };
    let referralRaw: unknown;

    if (!force && cachedDashboard) {
      raw = cachedDashboard;
      referralRaw = cachedReferral;
    } else {
      const [dashboardResult, referralResult] = await Promise.allSettled([
        supabase.rpc("get_admin_dashboard_stats", { p_force: force }),
        supabase.rpc("get_referral_stats"),
      ]);
      const dashboardData = dashboardResult.status === "fulfilled" ? dashboardResult.value.data : null;
      const referralData = referralResult.status === "fulfilled" ? referralResult.value.data : null;
      raw = (dashboardData ?? cachedDashboard) as typeof raw;
      referralRaw = referralData ?? cachedReferral;
      if (!raw) {
        throw dashboardResult.status === "rejected"
          ? dashboardResult.reason
          : dashboardResult.value.error ?? new Error("Statistik dashboard belum tersedia");
      }
    }

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

    // Format label tanggal Indonesia untuk statistik harian eligible vs sent
    const reengageDailyStats = (raw.reengage_daily_stats ?? []).map((row) => {
      const d = new Date(`${row.date}T00:00:00+07:00`);
      const label = d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Jakarta",
      });
      return {
        label,
        eligible: row.eligible ?? 0,
        eligible7d: row.eligible7d ?? 0,
        eligible30d: row.eligible30d ?? 0,
        sent: row.sent ?? 0,
        sent7d: row.sent7d ?? 0,
        sent30d: row.sent30d ?? 0,
      };
    });

    const transactions = (raw.transactions ?? []).map((row) => {
      const d = new Date(`${row.date}T00:00:00+07:00`);
      const label = d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Jakarta",
      });
      return {
        label,
        premium: row.premium ?? 0,
        topup: row.topup ?? 0,
        fine: row.fine ?? 0,
        total: row.total ?? 0,
      };
    });

    // Statistik referal (user baru dari undangan)
    const refRaw = (referralRaw ?? {}) as {
      newToday?: number; qualifiedToday?: number; rewardsToday?: number;
      cashoutAmount?: number;
      distribution?: {
        r1_50?: number; r51_80?: number; r81_99?: number;
        r100_no_cashout?: number; r100_cashout?: number; total?: number;
      };
      daily?: { date: string; baru: number; sah: number; hadiah: number }[];
    };
    const dist = refRaw.distribution ?? {};
    const referral = {
      newToday: refRaw.newToday ?? 0,
      qualifiedToday: refRaw.qualifiedToday ?? 0,
      rewardsToday: refRaw.rewardsToday ?? 0,
      cashoutAmount: refRaw.cashoutAmount ?? 50000,
      distribution: [
        { label: "1–50 teman", jumlah: dist.r1_50 ?? 0 },
        { label: "51–80 teman", jumlah: dist.r51_80 ?? 0 },
        { label: "81–99 teman", jumlah: dist.r81_99 ?? 0 },
        { label: "100+ belum tarik", jumlah: dist.r100_no_cashout ?? 0 },
        { label: "100+ sudah tarik", jumlah: dist.r100_cashout ?? 0 },
      ],
      distributionTotal: dist.total ?? 0,
      daily: (refRaw.daily ?? []).map((row) => ({
        label: new Date(`${row.date}T00:00:00+07:00`).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
          timeZone: "Asia/Jakarta",
        }),
        baru: row.baru ?? 0,
        sah: row.sah ?? 0,
        hadiah: row.hadiah ?? 0,
      })),
    };

    return new Response(
      JSON.stringify({ kpis: raw.kpis, activity, reengageActivity, reengageDailyStats, reengageSummary: raw.reengage_summary, transactions, special_promo: raw.special_promo, referral, referralAvailable: referralRaw != null }),

      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[admin-stats] error:", e);
    // Timeout database adalah kondisi data tidak tersedia, bukan crash aplikasi.
    // Dashboard sudah menampilkan status gagal dan tombol coba lagi dari payload ini.
    return new Response(JSON.stringify({
      error: "Statistik sementara tidak tersedia. Silakan coba lagi.",
      code: "STATS_UNAVAILABLE",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});
