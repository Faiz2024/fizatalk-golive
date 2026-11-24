import {
  CHANNEL_FEEDBACK_MAX_LENGTH,
  CHANNEL_USERNAME,
  channelReviewKeyboard,
  validGiveawayUrl,
} from "./channel-agent-policy.ts";

interface ChannelCallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
  message?: { message_id: number; chat: { id: number }; text?: string };
}

interface ChannelMessage {
  from: { id: number };
  chat: { id: number };
  text?: string;
}

interface ChannelTelegramContext {
  db: any;
  botToken: string;
  adminChatId?: string;
  onDatabaseError: () => Response;
}

function responseOk(): Response {
  return new Response("OK", { status: 200 });
}

async function call(botToken: string, method: string, body: unknown): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  return { httpOk: response.ok, ...result };
}

async function send(botToken: string, chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
  await call(botToken, "sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });
}

function dispatch(postId: string, action: "polish" | "regenerate" | "generate_admin"): void {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  const task = fetch(`${url}/functions/v1/channel-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ action, post_id: postId }),
  }).then(async (response) => {
    await response.body?.cancel();
    if (!response.ok) console.error(`[CHANNEL_AGENT] Dispatch gagal: ${response.status}`);
  }).catch((error) => console.error("[CHANNEL_AGENT] Dispatch error:", error instanceof Error ? error.message : "unknown"));
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(task); } catch { /* Railway menjaga promise tetap berjalan */ }
}

function validPostId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function authorizedAdmin(query: ChannelCallbackQuery, adminChatId?: string): boolean {
  return Boolean(
    adminChatId &&
    String(query.from.id) === adminChatId &&
    String(query.message?.chat.id) === adminChatId
  );
}

async function editAdminMessage(query: ChannelCallbackQuery, botToken: string, text: string, replyMarkup?: unknown): Promise<void> {
  if (!query.message) return;
  await call(botToken, "editMessageText", {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text,
    reply_markup: replyMarkup,
  });
}

export async function handleChannelAgentCallback(
  query: ChannelCallbackQuery,
  context: ChannelTelegramContext,
): Promise<Response | null> {
  const data = query.data ?? "";
  const match = data.match(/^ca_(approve|polish|regenerate|reject|back)_([0-9a-f-]{36})$/i);
  if (!match) return null;
  const [, action, postId] = match;
  if (!validPostId(postId)) return responseOk();
  if (!authorizedAdmin(query, context.adminChatId)) {
    await call(context.botToken, "answerCallbackQuery", { callback_query_id: query.id, text: "⛔ Hanya admin.", show_alert: true });
    return responseOk();
  }
  const adminId = query.from.id;
  const original = query.message?.text ?? "Draf channel";

  if (action === "approve") {
    await call(context.botToken, "answerCallbackQuery", { callback_query_id: query.id, text: "⏳ Memproses persetujuan..." });
    const { data: result, error } = await context.db.rpc("channel_post_action", {
      p_post_id: postId, p_admin_id: adminId, p_action: "approve",
    });
    if (error) return context.onDatabaseError();
    if (!result?.success) {
      await editAdminMessage(query, context.botToken, `${original}\n\n⚠️ Draf sudah diproses atau tidak dapat disetujui.`);
      return responseOk();
    }
    const posted = await call(context.botToken, "sendMessage", {
      chat_id: CHANNEL_USERNAME,
      text: result.post.content,
      disable_web_page_preview: false,
    });
    if (!posted?.ok) {
      await context.db.rpc("channel_post_action", {
        p_post_id: postId, p_admin_id: adminId, p_action: "release_approval",
      });
      await editAdminMessage(query, context.botToken, `${original}\n\n⚠️ Posting gagal. Pastikan bot admin channel dengan izin Post Messages, lalu coba lagi.`, channelReviewKeyboard(postId));
      return responseOk();
    }
    await context.db.rpc("mark_channel_post_posted", { p_post_id: postId, p_channel_message_id: posted.result.message_id });
    await editAdminMessage(query, context.botToken, `${original}\n\n✅ DISSETUJUI & BERHASIL DIPOSTING KE ${CHANNEL_USERNAME}`);
    return responseOk();
  }

  if (action === "polish") {
    const { data: result, error } = await context.db.rpc("channel_post_action", {
      p_post_id: postId, p_admin_id: adminId, p_action: "begin_polish",
    });
    if (error) return context.onDatabaseError();
    if (result?.success) {
      await editAdminMessage(
        query,
        context.botToken,
        `${original}\n\n✏️ Kirim satu pesan berisi jawaban kasar Anda. AI akan memolesnya dan meminta persetujuan lagi sebelum posting.`,
        { inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: `ca_back_${postId}` }]] },
      );
    }
    await call(context.botToken, "answerCallbackQuery", { callback_query_id: query.id, text: result?.success ? "Silakan tulis jawaban Anda." : "Draf sudah diproses." });
    return responseOk();
  }

  if (action === "back") {
    const { data: result, error } = await context.db.rpc("channel_post_action", {
      p_post_id: postId, p_admin_id: adminId, p_action: "cancel_polish",
    });
    if (error) return context.onDatabaseError();
    if (result?.success) await editAdminMessage(query, context.botToken, original.replace(/\n\n✏️ Kirim satu pesan[\s\S]*$/, ""), channelReviewKeyboard(postId));
    await call(context.botToken, "answerCallbackQuery", { callback_query_id: query.id });
    return responseOk();
  }

  const rpcAction = action === "regenerate" ? "queue_regenerate" : "reject";
  const { data: result, error } = await context.db.rpc("channel_post_action", {
    p_post_id: postId, p_admin_id: adminId, p_action: rpcAction,
  });
  if (error) return context.onDatabaseError();
  if (result?.success && action === "regenerate") {
    dispatch(postId, "regenerate");
    await editAdminMessage(query, context.botToken, `${original}\n\n⏳ Sedang membuat variasi baru. Tidak ada posting yang dikirim.`);
  } else if (result?.success) {
    await editAdminMessage(query, context.botToken, `${original}\n\n❌ Draf ditolak dan tidak diposting.`);
  }
  await call(context.botToken, "answerCallbackQuery", {
    callback_query_id: query.id,
    text: result?.success ? (action === "regenerate" ? "Variasi sedang dibuat." : "Draf ditolak.") : "Draf sudah diproses atau agen sedang dijeda.",
  });
  return responseOk();
}

export async function handleChannelAgentMessage(
  message: ChannelMessage,
  context: ChannelTelegramContext,
): Promise<Response | null> {
  const text = message.text?.trim() ?? "";
  const userId = message.from.id;
  const isAdmin = Boolean(context.adminChatId && String(userId) === context.adminChatId && String(message.chat.id) === context.adminChatId);

  const feedbackMatch = text.match(/^\/feedback(?:@\S+)?(?:\s+([\s\S]+))?$/i);
  if (feedbackMatch) {
    const feedback = feedbackMatch[1]?.trim() ?? "";
    if (feedback.length < 5 || feedback.length > CHANNEL_FEEDBACK_MAX_LENGTH) {
      await send(context.botToken, userId, `💡 Kirim saran 5–${CHANNEL_FEEDBACK_MAX_LENGTH} karakter dengan format:\n/feedback saran atau masukan kamu`);
      return responseOk();
    }
    const { data: result, error } = await context.db.rpc("submit_channel_feedback", { p_user_id: userId, p_text: feedback });
    if (error) return context.onDatabaseError();
    const errorMessages: Record<string, string> = {
      rate_limited: "⏳ Kamu sudah mengirim 3 masukan dalam 24 jam. Coba lagi nanti.",
      duplicate: "Masukan yang sama sudah tersimpan. Kirim masukan lain, ya.",
      user_not_found: "Tekan /start terlebih dahulu sebelum mengirim masukan.",
    };
    await send(context.botToken, userId, result?.success
      ? "✅ Terima kasih! Masukanmu sudah tersimpan tanpa nama di daftar rangkuman channel. Admin meninjau setiap jawaban sebelum diposting."
      : errorMessages[result?.error] ?? "⚠️ Masukan belum dapat disimpan. Coba lagi nanti.");
    return responseOk();
  }

  const giveawayMatch = text.match(/^\/giveaway(?:@\S+)?\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (giveawayMatch || /^\/giveaway(?:@\S+)?$/i.test(text)) {
    if (!isAdmin) {
      await send(context.botToken, userId, "⛔ Perintah ini hanya untuk admin.");
      return responseOk();
    }
    const url = giveawayMatch?.[1] ?? "";
    if (!validGiveawayUrl(url)) {
      await send(context.botToken, userId, "Format: /giveaway https://link.dana.id/... catatan opsional\nGunakan tautan HTTPS resmi DANA atau t.me yang Anda buat sendiri.");
      return responseOk();
    }
    const rough = giveawayMatch?.[2]?.trim() || "Giveaway DANA Kaget untuk komunitas FizaTalk.";
    const { data: result, error } = await context.db.rpc("create_channel_admin_post", {
      p_admin_id: userId,
      p_kind: "giveaway",
      p_rough_text: rough,
      p_metadata: { giveaway_url: url },
    });
    if (error) return context.onDatabaseError();
    if (result?.success) {
      dispatch(result.post.id, "generate_admin");
      await send(context.botToken, userId, "⏳ Draf giveaway sedang dipoles. Anda akan menerima pratinjau; tautan tidak diposting sebelum Anda menyetujuinya.");
    } else {
      await send(context.botToken, userId, "⏸️ Agen channel sedang dijeda. Belum ada draf atau posting yang dibuat.");
    }
    return responseOk();
  }

  if (isAdmin && text && !text.startsWith("/")) {
    const { data: draft, error } = await context.db
      .from("channel_agent_posts")
      .select("id")
      .eq("admin_id", userId)
      .eq("status", "awaiting_admin_input")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return context.onDatabaseError();
    if (draft?.id) {
      const { data: result, error: queueError } = await context.db.rpc("channel_post_action", {
        p_post_id: draft.id,
        p_admin_id: userId,
        p_action: "queue_polish",
        p_rough_text: text,
      });
      if (queueError) return context.onDatabaseError();
      if (result?.success) {
        dispatch(draft.id, "polish");
        await send(context.botToken, userId, "⏳ Jawaban Anda sedang dipoles. Pratinjau baru akan dikirim untuk persetujuan akhir.");
      }
      return responseOk();
    }
  }
  return null;
}
