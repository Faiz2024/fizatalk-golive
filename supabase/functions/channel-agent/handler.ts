import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.25.76";
import { getServiceClient } from "../_shared/service-client.ts";
import { validWebhookSecret } from "../_shared/telegram-webhook-auth.ts";
import {
  CHANNEL_FEEDBACK_BATCH_LIMIT,
  channelKindLabel,
  channelReviewKeyboard,
  channelAnswerButtonEnabled,
  dailyChannelKind,
  wibDateKey,
} from "../_shared/channel-agent-policy.ts";
import { channelGatewayError, generateChannelContent } from "./generator.ts";

const RequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("scheduled") }),
  z.object({
    action: z.enum(["polish", "regenerate", "generate_admin"]),
    post_id: z.string().uuid(),
  }),
]);

const PROJECT_PUBLISHABLE_KEY = "sb_publishable_Z4zdRLwzbv2EbDzQYwGh-A_Ln0afzTF";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function wibNow(): string {
  return new Date().toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  });
}

async function telegram(botToken: string, method: string, body: unknown): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) throw new Error(`Telegram ${method} gagal`);
  return result.result;
}

async function notifyAdmin(botToken: string, adminId: string, text: string): Promise<void> {
  try {
    await telegram(botToken, "sendMessage", { chat_id: Number(adminId), text });
  } catch (error) {
    console.error("[CHANNEL_AGENT] Notifikasi admin gagal:", error instanceof Error ? error.message : "unknown");
  }
}

async function sendAdminReview(
  botToken: string,
  adminId: string,
  supabase: any,
  post: any,
  content: { text: string; points: string[] },
): Promise<void> {
  const points = content.points.length
    ? `\n\nPoin masukan:\n${content.points.map((point) => `• ${point}`).join("\n")}`
    : "";
  const preview = `🤖 DRAF CHANNEL FIZATALK\nJenis: ${channelKindLabel(post.kind)}\nTombol Jawab: ${channelAnswerButtonEnabled(post) ? "Ya" : "Tidak"}\nDibuat: ${wibNow()} WIB\n\n${content.text}${points}\n\nBelum ada posting yang dikirim ke channel.`;
  const result = await telegram(botToken, "sendMessage", {
    chat_id: Number(adminId),
    text: preview,
    reply_markup: channelReviewKeyboard(post.id),
  });
  const { error } = await supabase.rpc("set_channel_post_admin_message", {
    p_post_id: post.id,
    p_message_id: result.message_id,
  });
  if (error) throw error;
}

async function pauseForFailure(
  supabase: any,
  botToken: string,
  adminId: string,
  postId: string,
  error: unknown,
): Promise<"paused" | "failed"> {
  const failure = channelGatewayError(error);
  console.error(`[CHANNEL_AGENT] ${failure.kind}: ${failure.message}`);
  await supabase.rpc("fail_channel_post_generation", { p_post_id: postId, p_error: failure.message });
  if (failure.kind === "credits" || failure.kind === "permission") {
    await supabase.rpc("pause_channel_agent", {
      p_reason: `${failure.kind}: ${failure.message}`,
      p_resume_at: null,
    });
    await notifyAdmin(
      botToken,
      adminId,
      failure.kind === "credits"
        ? "⏸️ Agen channel dijeda karena kredit/konfigurasi AI perlu dipulihkan. Tidak ada draf yang diposting."
        : "⏸️ Agen channel dijeda karena izin AI ditolak. Tidak ada draf yang diposting. Pulihkan akses sebelum mencoba lagi.",
    );
    return "paused";
  }
  if (failure.kind === "rate_limit") {
    const resumeAt = new Date(Date.now() + Math.max(failure.retryAfter ?? 86_400, 86_400) * 1_000).toISOString();
    await supabase.rpc("pause_channel_agent", {
      p_reason: `rate_limit: ${failure.message}`,
      p_resume_at: resumeAt,
    });
    await notifyAdmin(botToken, adminId, "⏸️ Agen channel menunggu jadwal berikutnya karena batas AI tercapai. Tidak ada percobaan ulang langsung.");
    return "paused";
  }
  await notifyAdmin(
    botToken,
    adminId,
    failure.kind === "refusal"
      ? "⚠️ AI menolak membuat draf ini. Tidak ada posting ke channel. Admin dapat membuat draf baru dengan instruksi yang berbeda."
      : "⚠️ Pembuatan draf channel gagal. Tidak ada posting ke channel; silakan coba dari draf admin berikutnya.",
  );
  return "failed";
}

async function generateAndReview(
  supabase: any,
  botToken: string,
  adminId: string,
  post: any,
  feedback: Array<{ content: string }> = [],
): Promise<"sent" | "paused" | "failed"> {
  try {
    const content = await generateChannelContent({
      kind: post.kind,
      currentText: post.content || undefined,
      adminRoughText: post.admin_rough_text || undefined,
      feedback,
      questionText: post.metadata?.source_question,
      giveawayUrl: post.metadata?.giveaway_url,
    });
    const { data: completed, error: completeError } = await supabase.rpc("complete_channel_post_generation", {
      p_post_id: post.id,
      p_content: content.text,
      p_summary: content.points,
    });
    if (completeError) throw completeError;
    if (!completed) return "failed";
    await sendAdminReview(botToken, adminId, supabase, post, content);
    return "sent";
  } catch (error) {
    return await pauseForFailure(supabase, botToken, adminId, post.id, error);
  }
}

async function runScheduled(supabase: any, botToken: string, adminId: string): Promise<Response> {
  const { data: claim, error: claimError } = await supabase.rpc("claim_channel_agent_schedule", {
    p_lease_seconds: 180,
  });
  if (claimError) throw claimError;
  if (!claim?.claimed) return json({ ok: true, skipped: claim?.reason ?? "not_claimed" });
  const leaseToken = claim.lease_token;
  let outcome = "completed";
  try {
    const { data: summary, error: summaryError } = await supabase.rpc("create_channel_feedback_post", {
      p_lease_token: leaseToken,
      p_limit: CHANNEL_FEEDBACK_BATCH_LIMIT,
    });
    if (summaryError) throw summaryError;
    if (summary?.created) {
      outcome = await generateAndReview(supabase, botToken, adminId, summary.post, summary.feedback ?? []);
    } else if (["summary_pending", "not_enough", "cooldown"].includes(summary?.reason)) {
      outcome = `waiting_${summary.reason}`;
    }

    if (outcome === "completed") {
      const kind = dailyChannelKind();
      const dedupeKey = `daily:${wibDateKey()}`;
      const { data: daily, error: dailyError } = await supabase.rpc("create_channel_daily_post", {
        p_lease_token: leaseToken,
        p_dedupe_key: dedupeKey,
        p_kind: kind,
      });
      if (dailyError) throw dailyError;
      if (daily?.created) {
        outcome = await generateAndReview(supabase, botToken, adminId, daily.post);
      } else if (daily?.reason) {
        outcome = `waiting_${daily.reason}`;
      }
    }
    return json({ ok: true, outcome });
  } catch (error) {
    console.error("[CHANNEL_AGENT] Scheduled failure:", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, outcome: "failed" });
  } finally {
    await supabase.rpc("finish_channel_agent_schedule", { p_lease_token: leaseToken });
  }
}

async function runQueuedAction(supabase: any, botToken: string, adminId: string, postId: string): Promise<Response> {
  const { data: claimed, error: claimError } = await supabase.rpc("claim_queued_channel_post", { p_post_id: postId });
  if (claimError) throw claimError;
  if (!claimed?.success) {
    if (claimed?.error === "paused") {
      await notifyAdmin(botToken, adminId, "⏸️ Agen channel sedang dijeda. Belum ada draf baru atau posting ke channel.");
    }
    return json({ ok: true, skipped: claimed?.error ?? "not_queued" });
  }
  const post = claimed.post;
  let feedback: Array<{ content: string }> = [];
  if (post.kind === "feedback_summary") {
    const { data, error } = await supabase
      .from("channel_feedback")
      .select("content")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true })
      .limit(CHANNEL_FEEDBACK_BATCH_LIMIT);
    if (error) throw error;
    feedback = data ?? [];
  }
  const outcome = await generateAndReview(supabase, botToken, adminId, post, feedback);
  return json({ ok: outcome !== "failed", outcome });
}

export async function handleChannelAgent(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const serviceAuthorized = validWebhookSecret(req.headers.get("authorization"), `Bearer ${serviceKey}`);
  const scheduledAuthorized = validWebhookSecret(req.headers.get("apikey"), PROJECT_PUBLISHABLE_KEY);
  if (!serviceAuthorized && !scheduledAuthorized) return json({ error: "Unauthorized" }, 401);

  let parsed: z.infer<typeof RequestSchema>;
  try {
    parsed = RequestSchema.parse(await req.json());
  } catch {
    return json({ error: "Payload tidak valid" }, 400);
  }
  if (!serviceAuthorized && parsed.action !== "scheduled") return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const adminId = Deno.env.get("TELEGRAM_CS_CHAT_ID") ?? "";
  if (!supabaseUrl || !serviceKey || !botToken || !adminId) {
    return json({ error: "Konfigurasi agen channel belum lengkap" }, 500);
  }
  const supabase = getServiceClient(supabaseUrl, serviceKey);
  try {
    if (parsed.action === "scheduled") return await runScheduled(supabase, botToken, adminId);
    return await runQueuedAction(supabase, botToken, adminId, parsed.post_id);
  } catch (error) {
    console.error("[CHANNEL_AGENT] Request failure:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Agen channel gagal memproses pekerjaan" }, 500);
  }
}
