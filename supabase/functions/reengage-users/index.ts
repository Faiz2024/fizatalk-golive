import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  width: number;
  height: number;
}

interface TelegramSendPhotoResponse {
  ok: boolean;
  result?: {
    message_id: number;
    photo?: TelegramPhoto[];
  };
  description?: string;
  error_code?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

  if (!botToken) {
    return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pengamanan: Hanya izinkan jika x-cron-secret atau Authorization header valid
  const authHeader = req.headers.get("Authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");
  const expectedCronSecret = "fizatalk_reengage_cron_secret_2026_xyz";

  const isAuthorized = 
    (cronSecretHeader === expectedCronSecret) || 
    (authHeader && authHeader === `Bearer ${supabaseKey}`) ||
    (authHeader && authHeader.includes(supabaseKey));

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  try {
    // 1. Ambil cached file_ids dan base asset URL dari bot_settings (hanya key reengage_*)
    const { data: settingsData } = await supabase
      .from("bot_settings")
      .select("key, value")
      .like("key", "reengage_%");

    const settings = (settingsData ?? []).reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    // 2. Siapkan template promosi dengan fallback URL publik yang dijamin 200 OK
    const templates = [
      {
        imageKey: "cute_pleading_cat",
        imageUrl: settings["reengage_url_cute_pleading_cat"] || "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800",
        text: "Sayang!!! 🥺\n\nKangen deh, udah lama kita gak chatan bareng... Kamu kemana aja sih? 🥺👉👈\n\nYuk cari teman ngobrol atau partner seru baru sekarang! Banyak yang nyariin kamu lho...",
        buttonText: "Temui Dia Kembali 🥺",
        buttonCallback: "search_partner:promo_cute_pleading_cat"
      },
      {
        imageKey: "mysterious_gift_box",
        imageUrl: settings["reengage_url_mysterious_gift_box"] || "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800",
        text: "Ada yang mau ngirimin hadiah spesial ke kamu! 🎁✨\n\nPenasaran siapa dan apa hadiahnya? Jangan sampai terlewat lho, langsung cari tahu partner kamu sekarang juga!",
        buttonText: "Cari Hadiahnya 🎁",
        buttonCallback: "search_partner:promo_mysterious_gift_box"
      },
      {
        imageKey: "grumpy_cute_cat",
        imageUrl: settings["reengage_url_grumpy_cute_cat"] || "https://images.unsplash.com/photo-1513360309081-36f5e878fc9e?w=800",
        text: "Kamu darimana aja sih? 😤\n\nKok tega ninggalin aku sendirian di sini... Cepat kembali dan jawab aku sekarang! Aku udah siapin partner yang cocok banget buat kamu.",
        buttonText: "Jawab Sekarang 😤",
        buttonCallback: "search_partner:promo_grumpy_cute_cat"
      },
      {
        imageKey: "social_match_hearts",
        imageUrl: settings["reengage_url_social_match_hearts"] || "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=800",
        text: "Banyak partner baru yang lagi nungguin kamu nih! ⚡🔥\n\nAda yang cocok banget sama kriteria kamu. Yuk, mulai cari partner baru dan langsung ngobrol seru!",
        buttonText: "Mulai Cari Partner ⚡",
        buttonCallback: "search_partner:promo_social_match_hearts"
      }
    ];

    // Cache file_id lokal untuk loop eksekusi saat ini
    const cachedFileIds: Record<string, string> = {};
    templates.forEach(t => {
      const dbKey = `reengage_file_id_${t.imageKey}`;
      if (settings[dbKey]) {
        cachedFileIds[t.imageKey] = settings[dbKey];
      }
    });

    // 3. Ambil batch pengguna via RPC atomik (klaim + tandai, anti kirim ganda)
    // Batas baris respons API = 1000, jadi BATCH disamakan agar lanjutan otomatis terpicu.
    const BATCH = 1000;
    const MAX_HOPS = 8;
    const startedAt = Date.now();
    let users: any[] = [];
    let isTest = false;
    let hop = 0;
    try {
      const body = await req.json();
      hop = Number(body?.hop) || 0;
      if (body?.test_user_id) {
        isTest = true;
        const { data: t, error: te } = await supabase
          .from("telegram_users")
          .select("id, first_name, last_reengagement_message_id, last_reengagement_sent_at")
          .eq("id", Number(body.test_user_id));
        if (te) throw te;
        users = (t ?? []).map((u: any) => ({ ...u, prev_sent_at: u.last_reengagement_sent_at }));
      }
    } catch (_) { /* body kosong */ }

    if (!isTest) {
      const { data, error } = await supabase.rpc("claim_reengagement_batch", { p_limit: BATCH });
      if (error) throw error;
      users = data ?? [];
    }

    if (users.length === 0) {
      return new Response(JSON.stringify({ message: "No inactive users found for re-engagement" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Reengage] Processing batch of ${users.length} users...`);
    let successCount = 0, blockedCount = 0, errorCount = 0;
    const results: { id: number; status: string; message_id: number | null; prev: string | null }[] = [];

    // ~15 pesan/detik: 15 worker, tiap worker jeda ~1 detik (menjaga jalur obrolan aktif tetap lega)
    const MAX_CONCURRENT = 15;
    let currentIndex = 0;

    const processUser = async (user: any) => {
      if (user.last_reengagement_message_id) {
        fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: user.id, message_id: Number(user.last_reengagement_message_id) }),
        }).then(r => r.body?.cancel()).catch(() => {});
      }

      const template = templates[Math.floor(Math.random() * templates.length)];
      const photoSource = cachedFileIds[template.imageKey] || template.imageUrl;
      const safeName = String(user.first_name ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
      const personalizedText = template.text.replace("Sayang!!!", safeName ? `${safeName} sayang!!!` : "Sayang!!!");

      try {
        const sendResp = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: user.id,
            photo: photoSource,
            caption: personalizedText,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: template.buttonText, callback_data: template.buttonCallback }]] },
          }),
        });
        const sendResult = (await sendResp.json()) as TelegramSendPhotoResponse;

        if (sendResult.ok && sendResult.result) {
          successCount++;
          if (!cachedFileIds[template.imageKey] && sendResult.result.photo?.length) {
            const fileId = sendResult.result.photo[sendResult.result.photo.length - 1]?.file_id;
            if (fileId) {
              cachedFileIds[template.imageKey] = fileId;
              supabase.from("bot_settings").upsert({
                key: `reengage_file_id_${template.imageKey}`, value: fileId, updated_at: new Date().toISOString(),
              }).then(() => {}, () => {});
            }
          }
          results.push({ id: user.id, status: "sent", message_id: sendResult.result.message_id, prev: user.prev_sent_at });
        } else {
          const desc = sendResult.description || "";
          if (sendResult.error_code === 403 || desc.includes("blocked") || desc.includes("deactivated") || desc.includes("chat not found")) {
            blockedCount++;
            results.push({ id: user.id, status: "blocked", message_id: null, prev: user.prev_sent_at });
          } else {
            errorCount++;
            console.error(`[Reengage] sendPhoto failed for ${user.id}: ${desc}`);
            // 400 = error permanen (data/format) → lewati 30 hari; lainnya dicoba lagi
            const st = sendResult.error_code === 400 ? "permanent" : "error";
            results.push({ id: user.id, status: st, message_id: null, prev: user.prev_sent_at });
          }
        }
      } catch (err) {
        errorCount++;
        results.push({ id: user.id, status: "error", message_id: null, prev: user.prev_sent_at });
      }
    };

    const TIME_BUDGET_MS = 110_000;
    const worker = async () => {
      while (currentIndex < users.length) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        const idx = currentIndex++;
        await processUser(users[idx]);
        await new Promise(r => setTimeout(r, 1000));
      }
    };
    await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));

    // Pengguna yang diklaim tapi belum sempat diproses → kembalikan agar dikirimi di lanjutan
    for (let i = currentIndex; i < users.length; i++) {
      results.push({ id: users[i].id, status: "error", message_id: null, prev: users[i].prev_sent_at });
    }

    // 4. Simpan hasil + statistik harian WIB dalam 1 RPC
    if (results.length > 0) {
      const { error: finErr } = await supabase.rpc("finish_reengagement_batch", { p_results: results });
      if (finErr) console.error("[Reengage] finish batch failed:", finErr.message);
    }

    const logMessage = `Re-engagement batch completed. Sent: ${successCount}, Blocked: ${blockedCount}, Error: ${errorCount}`;
    console.log(`[Reengage] ${logMessage}`);
    supabase.rpc("log_bot_event", {
      p_level: "info", p_source: "reengage-users", p_event: "batch_completed",
      p_user_id: null, p_message: logMessage, p_context: { successCount, blockedCount, errorCount },
    }).then(() => {}, () => {});

    // 5. Lanjutkan sendiri jika antrean masih ada dan masih sebelum 21.00 WIB
    const wibHour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
    if (!isTest && users.length >= BATCH && wibHour < 21) {
      fetch(`${supabaseUrl}/functions/v1/reengage-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": expectedCronSecret },
        body: "{}",
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 500));
    }

    return new Response(JSON.stringify({
      success: true, processed: users.length, sent: successCount, blocked: blockedCount, errors: errorCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = (e as Error).message;
    console.error("[reengage-users] major error:", e);
    
    try {
      supabase.rpc("log_bot_event", {
        p_level: "error",
        p_source: "reengage-users",
        p_event: "exception",
        p_user_id: null,
        p_message: msg,
        p_context: { stack: (e as Error).stack ?? null }
      }).then(() => {}, () => {});
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
