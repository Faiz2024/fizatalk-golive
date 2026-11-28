import { getServiceClient } from "../_shared/service-client.ts";
import { REENGAGEMENT_BATCH, reengagementWindow, runReengagementDrip } from "../_shared/reengagement-policy.ts";

let running = false;
let cooldownUntil = 0;

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
  parameters?: { retry_after?: number };
}

export async function handleReengageUsers(req: Request): Promise<Response> {
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
    false;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (running || Date.now() < cooldownUntil || !reengagementWindow()) {
    return new Response(JSON.stringify({ success: true, skipped: "busy_or_quiet_hours" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  running = true;
  const supabase = getServiceClient(supabaseUrl, supabaseKey);

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
        buttonCallback: "reengage:cute_pleading_cat"
      },
      {
        imageKey: "mysterious_gift_box",
        imageUrl: settings["reengage_url_mysterious_gift_box"] || "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800",
        text: "Ada yang mau ngirimin hadiah spesial ke kamu! 🎁✨\n\nPenasaran siapa dan apa hadiahnya? Jangan sampai terlewat lho, langsung cari tahu partner kamu sekarang juga!",
        buttonText: "Cari Hadiahnya 🎁",
        buttonCallback: "reengage:mysterious_gift_box"
      },
      {
        imageKey: "grumpy_cute_cat",
        imageUrl: settings["reengage_url_grumpy_cute_cat"] || "https://images.unsplash.com/photo-1513360309081-36f5e878fc9e?w=800",
        text: "Kamu darimana aja sih? 😤\n\nKok tega ninggalin aku sendirian di sini... Cepat kembali dan jawab aku sekarang! Aku udah siapin partner yang cocok banget buat kamu.",
        buttonText: "Jawab Sekarang 😤",
        buttonCallback: "reengage:grumpy_cute_cat"
      },
      {
        imageKey: "social_match_hearts",
        imageUrl: settings["reengage_url_social_match_hearts"] || "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=800",
        text: "Banyak partner baru yang lagi nungguin kamu nih! ⚡🔥\n\nAda yang cocok banget sama kriteria kamu. Yuk, mulai cari partner baru dan langsung ngobrol seru!",
        buttonText: "Mulai Cari Partner ⚡",
        buttonCallback: "reengage:social_match_hearts"
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

    // One bounded atomic claim; no chaining or parallel blast.
    let users: any[] = [];
    const { data, error } = await supabase.rpc("claim_reengagement_drip", { p_limit: REENGAGEMENT_BATCH });
    if (error) throw error;
    users = data ?? [];

    if (users.length === 0) {
      return new Response(JSON.stringify({ message: "No inactive users found for re-engagement" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let successCount = 0, blockedCount = 0, errorCount = 0;
    const results: { id: number; status: string; message_id: number | null; prev: string | null; claimed_at: string; last_active: string }[] = [];
    const resultFor = (user: any, status: string, messageId: number | null) => ({
      id: user.id, status, message_id: messageId, prev: user.prev_sent_at,
      claimed_at: user.claimed_at, last_active: user.last_active,
    });

    const processUser = async (user: any): Promise<boolean> => {
      const template = templates[Math.floor(Math.random() * templates.length)];
      const photoSource = cachedFileIds[template.imageKey] || template.imageUrl;
      const safeName = String(user.first_name ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
      const personalizedText = template.text.replace("Sayang!!!", safeName ? `${safeName} sayang!!!` : "Sayang!!!");

      try {
        const sendResp = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
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
          results.push(resultFor(user, "sent", sendResult.result.message_id));
          if (user.last_reengagement_message_id) {
            await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(3000),
              body: JSON.stringify({ chat_id: user.id, message_id: Number(user.last_reengagement_message_id) }),
            }).then(r => r.body?.cancel()).catch(() => {});
          }
        } else {
          const desc = sendResult.description || "";
          if (sendResult.error_code === 403 || desc.includes("blocked") || desc.includes("deactivated") || desc.includes("chat not found")) {
            blockedCount++;
            results.push(resultFor(user, "blocked", null));
          } else {
            errorCount++;
            // 400 = error permanen (data/format) → lewati 30 hari; lainnya dicoba lagi
            const st = sendResult.error_code === 400 ? "permanent" : "error";
            results.push(resultFor(user, st, null));
            if (sendResult.error_code === 429 || (sendResult.error_code ?? 0) >= 500) {
              cooldownUntil = Date.now() + Math.max(60, sendResult.parameters?.retry_after ?? 60) * 1000;
              return false;
            }
          }
        }
      } catch (err) {
        errorCount++;
        results.push(resultFor(user, "error", null));
        cooldownUntil = Date.now() + 60_000;
        return false;
      }
      return true;
    };

    const processed = await runReengagementDrip(users, processUser);
    for (const user of users.slice(processed)) {
      results.push(resultFor(user, "error", null));
    }

    // 4. Simpan hasil + statistik harian WIB dalam 1 RPC
    if (results.length > 0) {
      const { error: finErr } = await supabase.rpc("finish_reengagement_batch", { p_results: results });
      if (finErr) throw finErr;
    }

    console.log(`[Reengage] Batch completed. Sent: ${successCount}, Blocked: ${blockedCount}, Error: ${errorCount}`);

    return new Response(JSON.stringify({
      success: true, processed: users.length, sent: successCount, blocked: blockedCount, errors: errorCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const msg = (e as Error).message;
    cooldownUntil = Date.now() + 60_000;
    console.warn("[reengage-users] Batch paused: database or delivery unavailable");

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    running = false;
  }
}
