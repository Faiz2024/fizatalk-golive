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

    // 3. Query pengguna tidak aktif:
    let users: any[] = [];
    
    // Coba baca body untuk testing specific user
    try {
      const body = await req.json();
      if (body?.test_user_id) {
        const { data: testUsers, error: testError } = await supabase
          .from("telegram_users")
          .select("id, first_name, last_reengagement_message_id, username")
          .eq("id", Number(body.test_user_id));
        if (testError) throw testError;
        users = testUsers ?? [];
        console.log(`[Reengage] Testing specific user_id: ${body.test_user_id}. Found: ${users.length}`);
      }
    } catch (_) {
      // Jika body kosong atau bukan JSON, abaikan dan jalankan alur normal
    }

    if (users.length === 0) {
      // - state = 'idle'
      // - last_active < 7 hari yang lalu
      // - (last_promo_sent_at IS NULL ATAU last_promo_sent_at < 7 hari yang lalu)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const { data: normalUsers, error: usersError } = await supabase
        .from("v_eligible_reengagement_users")
        .select("id, first_name, last_reengagement_message_id, username")
        .eq("state", "idle")
        .lt("last_active", sevenDaysAgo)
        .or(`last_reengagement_sent_at.is.null,last_reengagement_sent_at.lt.${sevenDaysAgo}`)
        .order("last_active", { ascending: false }) // prioritize recently inactive users (descending)
        .limit(300); // increased batch limit from 100 to 300 to process queue faster

      if (usersError) throw usersError;
      users = normalUsers ?? [];
    }

    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ message: "No inactive users found for re-engagement" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Reengage] Processing batch of ${users.length} users...`);
    let successCount = 0;
    let blockedCount = 0;
    let errorCount = 0;

    // Kumpulkan semua update DB di memori, eksekusi bulk di akhir loop
    const bulkUpdates: { id: number; last_reengagement_sent_at: string; last_reengagement_message_id: number | null }[] = [];

    // 4. Proses pengiriman batch (loop dengan delay 100ms)
    for (const user of users) {
      // a. Hapus pesan lama jika ada
      if (user.last_reengagement_message_id) {
        try {
          const delResp = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: user.id,
              message_id: Number(user.last_reengagement_message_id)
            })
          });
          const delRes = await delResp.json();
          if (!delRes.ok) {
            console.log(`[Reengage] deleteMessage returned not ok for user ${user.id}: ${delRes.description}`);
          }
        } catch (delErr) {
          console.error(`[Reengage] Failed to delete old message for user ${user.id}:`, delErr);
        }
      }

      // b. Pilih template acak
      const template = templates[Math.floor(Math.random() * templates.length)];
      const photoSource = cachedFileIds[template.imageKey] || template.imageUrl;

      // Kustomisasi nama depan jika ada
      const personalizedText = template.text.replace("Sayang!!!", user.first_name ? `${user.first_name} sayang!!!` : "Sayang!!!");

      // c. Kirim pesan promosi baru
      try {
        const sendResp = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: user.id,
            photo: photoSource,
            caption: personalizedText,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{
                text: template.buttonText,
                callback_data: template.buttonCallback
              }]]
            }
          })
        });

        const sendResult = (await sendResp.json()) as TelegramSendPhotoResponse;

        if (sendResult.ok && sendResult.result) {
          const newMessageId = sendResult.result.message_id;
          successCount++;

          // d. Jika menggunakan URL dan mendapatkan file_id baru, simpan ke bot_settings
          if (!cachedFileIds[template.imageKey] && sendResult.result.photo && sendResult.result.photo.length > 0) {
            const photos = sendResult.result.photo;
            const largestPhoto = photos[photos.length - 1];
            if (largestPhoto && largestPhoto.file_id) {
              const fileId = largestPhoto.file_id;
              cachedFileIds[template.imageKey] = fileId; // simpan di memori lokal batch
              
              // Simpan ke database secara asinkron agar tidak memblokir loop
              supabase.from("bot_settings").upsert({
                key: `reengage_file_id_${template.imageKey}`,
                value: fileId,
                updated_at: new Date().toISOString()
              }).then(() => {
                console.log(`[Reengage] Successfully cached file_id for ${template.imageKey}: ${fileId}`);
              }).catch(err => {
                console.error(`[Reengage] Failed to save file_id cache to database:`, err);
              });
            }
          }

          // e. Kumpulkan update (akan di-bulk upsert di akhir loop)
          bulkUpdates.push({
            id: user.id,
            last_reengagement_sent_at: new Date().toISOString(),
            last_reengagement_message_id: newMessageId
          });

        } else {
          // Tangani pemblokiran bot oleh user
          const desc = sendResult.description || "";
          if (
            sendResult.error_code === 403 || 
            desc.includes("blocked") || 
            desc.includes("deactivated") || 
            desc.includes("chat not found")
          ) {
            blockedCount++;
            // Tandai dengan tanggal 2099 agar tidak di-query lagi selamanya
            bulkUpdates.push({
              id: user.id,
              last_reengagement_sent_at: "2099-12-31T00:00:00+00:00",
              last_reengagement_message_id: null
            });
            console.log(`[Reengage] User ${user.id} has blocked the bot. Marked as inactive permanently (2099).`);
          } else {
            errorCount++;
            console.error(`[Reengage] Telegram sendPhoto failed for user ${user.id}: ${desc}`);
            // Tetap update last_reengagement_sent_at agar tidak dicoba terus-menerus di batch berikutnya
            bulkUpdates.push({
              id: user.id,
              last_reengagement_sent_at: new Date().toISOString(),
              last_reengagement_message_id: null
            });
          }
        }
      } catch (err) {
        errorCount++;
        console.error(`[Reengage] Exception when sending to user ${user.id}:`, err);
      }

      // Berikan jeda acak (jitter) antar pengiriman untuk menghindari rate limit dan deteksi bot Telegram
      const delay = Math.floor(Math.random() * 100) + 80; // 80-180ms
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 5. Eksekusi bulk upsert ke database (1 panggilan menggantikan ratusan individual update)
    if (bulkUpdates.length > 0) {
      console.log(`[Reengage] Executing bulk upsert for ${bulkUpdates.length} users...`);
      const { error: bulkError } = await supabase
        .from("telegram_users")
        .upsert(bulkUpdates, { onConflict: "id", ignoreDuplicates: false });
      if (bulkError) {
        console.error("[Reengage] Bulk upsert failed:", bulkError.message);
      } else {
        console.log(`[Reengage] Bulk upsert completed successfully for ${bulkUpdates.length} users.`);
      }
    }

    // Log ringkasan eksekusi ke bot_logs
    const logMessage = `Re-engagement batch completed. Sent: ${successCount}, Blocked: ${blockedCount}, Error: ${errorCount}`;
    console.log(`[Reengage] ${logMessage}`);
    
    supabase.rpc("log_bot_event", {
      p_level: "info",
      p_source: "reengage-users",
      p_event: "batch_completed",
      p_user_id: null,
      p_message: logMessage,
      p_context: { successCount, blockedCount, errorCount }
    }).then(() => {}, () => {});

    // 6. Catat statistik harian ke reengagement_daily_stats untuk grafik dashboard
    try {
      const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
      
      // Hitung eligible count saat ini
      const sevenDaysAgoNow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: eligibleCount } = await supabase
        .from("v_eligible_reengagement_users")
        .select("id", { count: "exact", head: true })
        .eq("state", "idle")
        .lt("last_active", sevenDaysAgoNow)
        .or(`last_reengagement_sent_at.is.null,last_reengagement_sent_at.lt.${sevenDaysAgoNow}`);

      // Upsert daily stats: eligible di-overwrite (snapshot terbaru), sent/blocked/error di-akumulasi
      const { data: existingStats } = await supabase
        .from("reengagement_daily_stats")
        .select("sent_count, blocked_count, error_count")
        .eq("date", todayWIB)
        .maybeSingle();

      const newSent = (existingStats?.sent_count ?? 0) + successCount;
      const newBlocked = (existingStats?.blocked_count ?? 0) + blockedCount;
      const newError = (existingStats?.error_count ?? 0) + errorCount;

      await supabase
        .from("reengagement_daily_stats")
        .upsert({
          date: todayWIB,
          eligible_count: eligibleCount ?? 0,
          sent_count: newSent,
          blocked_count: newBlocked,
          error_count: newError,
          updated_at: new Date().toISOString()
        }, { onConflict: "date" });

      console.log(`[Reengage] Daily stats recorded for ${todayWIB}: eligible=${eligibleCount}, sent=${newSent}, blocked=${newBlocked}, error=${newError}`);
    } catch (statsErr) {
      console.error("[Reengage] Failed to record daily stats:", statsErr);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: users.length, 
      sent: successCount, 
      blocked: blockedCount, 
      errors: errorCount 
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
