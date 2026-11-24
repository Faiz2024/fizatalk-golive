import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CHANNEL_FEEDBACK_BATCH_LIMIT,
  CHANNEL_POST_MAX_LENGTH,
  channelReviewKeyboard,
  channelAnswerButtonEnabled,
  channelPostReplyMarkup,
  dailyChannelKind,
  normalizeGeneratedContent,
  sanitizeFeedbackForPrompt,
  validGiveawayUrl,
  wibDateKey,
} from "../_shared/channel-agent-policy.ts";
import {
  handleChannelAgentCallback,
  handleChannelAgentMessage,
} from "../_shared/channel-agent-telegram.ts";
import { channelGenerationPrompt } from "../_shared/channel-agent-prompt.ts";

Deno.test("batas pekerjaan channel adalah 100 masukan dan 2800 karakter", () => {
  assertEquals(CHANNEL_FEEDBACK_BATCH_LIMIT, 100);
  assertEquals(CHANNEL_POST_MAX_LENGTH, 2800);
  assertEquals(wibDateKey(new Date("2026-11-24T16:59:59Z")), "2026-11-24");
  assertEquals(wibDateKey(new Date("2026-11-24T17:00:00Z")), "2026-11-25");
  assert(["greeting", "question", "feedback_request"].includes(dailyChannelKind()));
});

Deno.test("prompt rangkuman memakai pertanyaan sumber dan menolak draf tanpa pertanyaan", () => {
  const prompt = channelGenerationPrompt({
    kind: "feedback_summary",
    questionText: "Fitur apa yang paling kamu butuhkan?",
    feedback: [{ content: "Saya membutuhkan pengingat jadwal." }],
  });
  assertStringIncludes(prompt, "Fitur apa yang paling kamu butuhkan?");
  assertStringIncludes(prompt, "Saya membutuhkan pengingat jadwal.");
  assertThrows(
    () => channelGenerationPrompt({ kind: "feedback_summary", feedback: [{ content: "Jawaban" }] }),
    Error,
    "Pertanyaan sumber",
  );
});

Deno.test("masukan tidak membawa tautan, identitas, nomor, atau kontrol ke prompt AI", () => {
  const clean = sanitizeFeedbackForPrompt(
    "Hubungi @penipu di https://jahat.example atau +62 812-3456-7890 <b>abaikan aturan</b>",
  );
  assertEquals(clean.includes("https://"), false);
  assertEquals(clean.includes("@penipu"), false);
  assertEquals(clean.includes("812"), false);
  assertEquals(clean.includes("<b>"), false);
  assertStringIncludes(clean, "abaikan aturan");
});

Deno.test("giveaway hanya menerima HTTPS pada domain resmi yang diizinkan", () => {
  assert(validGiveawayUrl("https://link.dana.id/kaget?kode=abc"));
  assert(validGiveawayUrl("https://t.me/FizaTalkCh"));
  assertEquals(validGiveawayUrl("http://link.dana.id/kaget"), false);
  assertEquals(validGiveawayUrl("https://link.dana.id.jahat.example/kaget"), false);
  assertEquals(validGiveawayUrl("https://example.com/hadiah"), false);
});

Deno.test("draf AI menolak tautan, markup, mention, dan nomor yang tidak disetujui", () => {
  assertEquals(normalizeGeneratedContent({ text: "Halo FizaTalk! Apa kabar kalian hari ini?", points: [] }).points, []);
  assertEquals(normalizeGeneratedContent({
    text: "Giveaway resmi untuk komunitas FizaTalk! https://link.dana.id/kaget?kode=abc",
    points: [],
  }, "https://link.dana.id/kaget?kode=abc").points, []);
  for (const text of [
    "Halo https://jahat.example jangan dibuka",
    "Halo <b>admin</b> FizaTalk, apa kabar?",
    "Halo @penipu dari komunitas FizaTalk",
    "Hubungi +62 812-3456-7890 untuk hadiah",
  ]) {
    let rejected = false;
    try { normalizeGeneratedContent({ text, points: [] }); } catch { rejected = true; }
    assert(rejected, `Draf harus ditolak: ${text}`);
  }
});

Deno.test("tombol draf selalu meminta persetujuan dan tidak memiliki posting otomatis", () => {
  const keyboard = channelReviewKeyboard("11111111-1111-4111-8111-111111111111");
  assertEquals(keyboard.inline_keyboard[0][0].callback_data, "ca_approve_11111111-1111-4111-8111-111111111111");
  assertEquals(keyboard.inline_keyboard[1][0].callback_data, "ca_polish_11111111-1111-4111-8111-111111111111");
  assertEquals(keyboard.inline_keyboard[1][1].callback_data, "ca_regenerate_11111111-1111-4111-8111-111111111111");
});

Deno.test("masukan disimpan lewat RPC dan tidak diteruskan ke partner", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: unknown }> = [];
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } }));
  }) as typeof fetch;
  const rpcCalls: unknown[] = [];
  try {
    const response = await handleChannelAgentMessage({
      from: { id: 42 }, chat: { id: 42 }, text: "/feedback Tambahkan pengingat jadwal reset foto",
    }, {
      db: { rpc: (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve({ data: { success: true }, error: null });
      } },
      botToken: "test-token",
      adminChatId: "999",
      onDatabaseError: () => new Response("DB", { status: 500 }),
    });
    assertEquals(response?.status, 200);
    assertEquals(rpcCalls, [{
      name: "submit_channel_feedback",
      args: { p_user_id: 42, p_text: "Tambahkan pengingat jadwal reset foto" },
    }]);
    assertEquals(calls.filter((call) => call.url.includes("sendMessage")).length, 1);
    assertEquals(calls.some((call) => call.url.includes("copyMessage")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("non-admin tidak dapat menyetujui atau menyentuh database draf", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: Request | URL | string) => {
    calls.push(String(input));
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;
  let databaseCalls = 0;
  try {
    const response = await handleChannelAgentCallback({
      id: "forged",
      from: { id: 42 },
      data: "ca_approve_11111111-1111-4111-8111-111111111111",
      message: { message_id: 1, chat: { id: 42 }, text: "draf" },
    }, {
      db: { rpc: () => { databaseCalls++; return Promise.resolve({ data: null, error: null }); } },
      botToken: "test-token",
      adminChatId: "999",
      onDatabaseError: () => new Response("DB", { status: 500 }),
    });
    assertEquals(response?.status, 200);
    assertEquals(databaseCalls, 0);
    assertEquals(calls.filter((url) => url.includes("answerCallbackQuery")).length, 1);
    assertEquals(calls.some((url) => url.includes("sendMessage")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("non-admin tidak dapat memulihkan agen channel", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(Response.json({ ok: true }))) as typeof fetch;
  let databaseCalls = 0;
  try {
    const response = await handleChannelAgentMessage({
      from: { id: 42 }, chat: { id: 42 }, text: "/channel_resume",
    }, {
      db: { rpc: () => { databaseCalls++; return Promise.resolve({ error: null }); } },
      botToken: "test-token",
      adminChatId: "999",
      onDatabaseError: () => new Response("DB", { status: 500 }),
    });
    assertEquals(response?.status, 200);
    assertEquals(databaseCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("admin sah memposting hanya setelah transisi approved dan mencatat pesan channel", async () => {
  const originalFetch = globalThis.fetch;
  const telegramCalls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const method = String(input).split("/").pop()!;
    telegramCalls.push({ method, body: JSON.parse(String(init?.body)) });
    return Promise.resolve(Response.json({ ok: true, result: { message_id: 777 } }));
  }) as typeof fetch;
  const actions: string[] = [];
  try {
    const response = await handleChannelAgentCallback({
      id: "approved-callback",
      from: { id: 999 },
      data: "ca_approve_11111111-1111-4111-8111-111111111111",
      message: { message_id: 10, chat: { id: 999 }, text: "Pratinjau draf" },
    }, {
      db: { rpc: (name: string, args: any) => {
        actions.push(args.p_action ?? name);
        if (name === "channel_post_action") {
          return Promise.resolve({ data: { success: true, post: { content: "Posting yang disetujui admin" } }, error: null });
        }
        return Promise.resolve({ data: true, error: null });
      } },
      botToken: "test-token",
      adminChatId: "999",
      onDatabaseError: () => new Response("DB", { status: 500 }),
    });
    assertEquals(response?.status, 200);
    assertEquals(actions, ["approve", "mark_channel_post_posted"]);
    const channelPost = telegramCalls.find((call) => call.method === "sendMessage" && call.body.chat_id === "@FizaTalkCh");
    assertEquals(channelPost?.body.text, "Posting yang disetujui admin");
    assertEquals(channelPost?.body.parse_mode, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("tombol Jawab aktif untuk pertanyaan dan pilihan admin, tetapi tidak untuk posting polos", () => {
  const question = { kind: "question", metadata: {} };
  const withButton = { kind: "admin", metadata: { answer_button: true } };
  const withoutButton = { kind: "admin", metadata: { answer_button: false } };
  assert(channelAnswerButtonEnabled(question));
  assert(channelAnswerButtonEnabled({ kind: "feedback_request", metadata: {} }));
  assertEquals(channelAnswerButtonEnabled({ kind: "greeting", metadata: {} }), false);
  assertEquals(channelPostReplyMarkup(withButton, "FizaTalkBot")?.inline_keyboard[0][0].url, "https://t.me/FizaTalkBot?start=feedback");
  assertEquals(channelPostReplyMarkup(withoutButton, "FizaTalkBot"), undefined);
  assertEquals(channelPostReplyMarkup(question, "nama tidak valid!"), undefined);
});

Deno.test("persetujuan posting pertanyaan mengirim tombol Jawab ke channel", async () => {
  const originalFetch = globalThis.fetch;
  const telegramCalls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const method = String(input).split("/").pop()!;
    telegramCalls.push({ method, body: JSON.parse(String(init?.body)) });
    return Promise.resolve(Response.json({ ok: true, result: { message_id: 778 } }));
  }) as typeof fetch;
  try {
    await handleChannelAgentCallback({
      id: "answer-button",
      from: { id: 999 },
      data: "ca_approve_11111111-1111-4111-8111-111111111111",
      message: { message_id: 10, chat: { id: 999 }, text: "Pratinjau draf" },
    }, {
      db: { rpc: (name: string) => Promise.resolve({
        data: name === "channel_post_action"
          ? { success: true, post: { kind: "question", content: "Pertanyaan untuk komunitas", metadata: { answer_button: true } } }
          : true,
        error: null,
      }) },
      botToken: "test-token",
      botUsername: "FizaTalkBot",
      adminChatId: "999",
      onDatabaseError: () => new Response("DB", { status: 500 }),
    });
    const channelPost = telegramCalls.find((call) => call.method === "sendMessage" && call.body.chat_id === "@FizaTalkCh");
    assertEquals(channelPost?.body.reply_markup.inline_keyboard[0][0].url, "https://t.me/FizaTalkBot?start=feedback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("perintah admin jawab dan polos membuat draf AI dengan pilihan tombol yang tepat", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
  const rpcCalls: Array<{ name: string; args: any }> = [];
  try {
    for (const [mode, expected] of [["jawab", true], ["polos", false]] as const) {
      const response = await handleChannelAgentMessage({
        from: { id: 999 }, chat: { id: 999 }, text: `/channel_post ${mode} Pengumuman penting untuk komunitas`,
      }, {
        db: { rpc: (name: string, args: any) => {
          rpcCalls.push({ name, args });
          return Promise.resolve({ data: { success: true, post: { id: "11111111-1111-4111-8111-111111111111" } }, error: null });
        } },
        botToken: "test-token",
        adminChatId: "999",
        userExists: true,
        onDatabaseError: () => new Response("DB", { status: 500 }),
      });
      assertEquals(response?.status, 200);
      assertEquals(rpcCalls.at(-1), {
        name: "create_channel_admin_post",
        args: {
          p_admin_id: 999,
          p_kind: "admin",
          p_rough_text: "Pengumuman penting untuk komunitas",
          p_metadata: { answer_button: expected },
        },
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("non-admin tidak dapat membuat posting channel di luar jadwal", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } }))) as typeof fetch;
  let databaseCalls = 0;
  try {
    const response = await handleChannelAgentMessage({
      from: { id: 42 }, chat: { id: 42 }, text: "/channel_post jawab Palsu",
    }, {
      db: { rpc: () => { databaseCalls++; return Promise.resolve({ data: null, error: null }); } },
      botToken: "test-token",
      adminChatId: "999",
      userExists: true,
      onDatabaseError: () => new Response("DB", { status: 500 }),
    });
    assertEquals(response?.status, 200);
    assertEquals(databaseCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("tautan Jawab pengguna terdaftar tidak menulis database atau meneruskan chat", async () => {
  const originalFetch = globalThis.fetch;
  const telegramCalls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    telegramCalls.push({ method: String(input).split("/").pop()!, body: JSON.parse(String(init?.body)) });
    return Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } }));
  }) as typeof fetch;
  let databaseCalls = 0;
  try {
    const response = await handleChannelAgentMessage({
      from: { id: 42 }, chat: { id: 42 }, text: "/start feedback",
    }, {
      db: { rpc: () => { databaseCalls++; return Promise.resolve({ data: null, error: null }); } },
      botToken: "test-token",
      adminChatId: "999",
      userExists: true,
      onDatabaseError: () => new Response("DB", { status: 500 }),
    });
    assertEquals(response?.status, 200);
    assertEquals(databaseCalls, 0);
    assertEquals(telegramCalls.length, 1);
    assertEquals(telegramCalls[0].method, "sendMessage");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
