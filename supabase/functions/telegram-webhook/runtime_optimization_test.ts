import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BUTTON_COOLDOWN_MS,
  clearButtonClicksForTests,
  isButtonOnCooldown,
} from "../_shared/button-debounce.ts";
import {
  clearPremiumFilterProfilesForTests,
  getPremiumFilterProfile,
  invalidatePremiumFilterProfile,
  PREMIUM_PROFILE_CACHE_TTL_MS,
} from "../_shared/profile-cache.ts";
import { TtlCache } from "../_shared/runtime-cache.ts";
import {
  clearServiceClientsForTests,
  createDatabaseFetch,
  DATABASE_MAX_CONCURRENCY,
  DATABASE_TIMEOUT_MS,
  getServiceClient,
} from "../_shared/service-client.ts";
import { DatabaseConcurrencyGate } from "../_shared/database-concurrency.ts";
import {
  clearMessageFloodLimiterForTests,
  isMessageFlooding,
  MESSAGE_FLOOD_LIMIT,
  MESSAGE_FLOOD_WINDOW_MS,
} from "../_shared/message-flood-limiter.ts";

Deno.test("semua tombol memakai cooldown tepat 2 detik dan terisolasi per pengguna/aksi", () => {
  clearButtonClicksForTests();
  assertEquals(BUTTON_COOLDOWN_MS, 2000);
  assertEquals(isButtonOnCooldown(101, "search_partner", 10_000), false);
  assertEquals(isButtonOnCooldown(101, "search_partner", 11_999), true);
  assertEquals(isButtonOnCooldown(102, "search_partner", 11_999), false);
  assertEquals(isButtonOnCooldown(101, "chat_next", 11_999), false);
  assertEquals(isButtonOnCooldown(101, "search_partner", 12_000), false);
});

Deno.test("cache TTL kedaluwarsa dan jumlah entri tidak melebihi batas memori", () => {
  const cache = new TtlCache<string, number>(100, 2);
  cache.set("a", 1, 1_000);
  assertEquals(cache.get("a", 1_099), 1);
  assertEquals(cache.get("a", 1_100), undefined);
  cache.set("a", 1, 2_000);
  cache.set("b", 2, 2_000);
  cache.set("c", 3, 2_000);
  assertEquals(cache.size, 2);
  assertEquals(cache.get("a", 2_001), undefined);
  assertEquals(cache.get("c", 2_001), 3);
});

Deno.test("service client digunakan ulang tanpa mencampur kredensial", () => {
  clearServiceClientsForTests();
  const first = getServiceClient(
    "https://one.example.invalid",
    "first-test-key",
  );
  const repeated = getServiceClient(
    "https://one.example.invalid",
    "first-test-key",
  );
  const other = getServiceClient(
    "https://two.example.invalid",
    "second-test-key",
  );
  assertStrictEquals(first, repeated);
  assertNotStrictEquals(first, other);
  clearServiceClientsForTests();
});

Deno.test("profil Premium di-cache 20 detik, dibagikan saat concurrent, dan invalidasi memaksa baca baru", async () => {
  clearPremiumFilterProfilesForTests();
  assertEquals(PREMIUM_PROFILE_CACHE_TTL_MS, 20_000);
  let reads = 0;
  let target = "semua";
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            reads++;
            await Promise.resolve();
            return {
              data: {
                premium_until: "2027-01-01T00:00:00+07:00",
                target_gender: target,
                target_location: "semua",
              },
              error: null,
            };
          },
        }),
      }),
    }),
  };

  const [first, concurrent] = await Promise.all([
    getPremiumFilterProfile(db, 909),
    getPremiumFilterProfile(db, 909),
  ]);
  assertStrictEquals(first, concurrent);
  assertEquals(reads, 1);
  await getPremiumFilterProfile(db, 909);
  assertEquals(reads, 1);

  target = "cowok";
  invalidatePremiumFilterProfile(909);
  const refreshed = await getPremiumFilterProfile(db, 909);
  assertEquals(refreshed?.target_gender, "cowok");
  assertEquals(reads, 2);
  assert(first !== null);
});

Deno.test("database dibatasi 5 detik dan pembatalan pemanggil tetap diteruskan", async () => {
  assertEquals(DATABASE_TIMEOUT_MS, 5_000);
  const observedSignals: AbortSignal[] = [];
  const hangingFetch = ((_input: Request | URL | string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("Abort signal is required"));
        return;
      }
      observedSignals.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;

  const timedRequest = createDatabaseFetch(hangingFetch, 5)(
    "https://database.example.invalid/rest/v1/test",
  );
  let timeoutName = "";
  try {
    await timedRequest;
  } catch (error) {
    timeoutName = (error as Error).name;
  }
  assertEquals(timeoutName, "TimeoutError");
  assertEquals(observedSignals[0]?.aborted, true);

  const caller = new AbortController();
  const cancelledRequest = createDatabaseFetch(hangingFetch)(
    "https://database.example.invalid/rest/v1/test",
    { signal: caller.signal },
  );
  caller.abort();
  let cancellationName = "";
  try {
    await cancelledRequest;
  } catch (error) {
    cancellationName = (error as Error).name;
  }
  assertEquals(cancellationName, "AbortError");
});

Deno.test("maksimal 20 panggilan database berjalan bersamaan dan sisanya menunggu", async () => {
  assertEquals(DATABASE_MAX_CONCURRENCY, 20);
  const gate = new DatabaseConcurrencyGate(DATABASE_MAX_CONCURRENCY);
  const completions: (() => void)[] = [];
  let active = 0;
  let maximumActive = 0;
  const controlledFetch = (() => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    return new Promise<Response>((resolve) => {
      completions.push(() => {
        active--;
        resolve(new Response("ok"));
      });
    });
  }) as typeof fetch;
  const limitedFetch = createDatabaseFetch(controlledFetch, 5_000, gate);
  const requests = Array.from(
    { length: DATABASE_MAX_CONCURRENCY + 5 },
    () => limitedFetch("https://database.example.invalid/rest/v1/test"),
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(completions.length, 20);
    assertEquals(maximumActive, 20);
    for (const complete of completions.splice(0)) complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(completions.length, 5);
    assertEquals(maximumActive, 20);
  } finally {
    for (const complete of completions.splice(0)) complete();
  }
  await Promise.all(requests);
});

Deno.test("pembatalan antrean database tidak menghilangkan slot berikutnya", async () => {
  const gate = new DatabaseConcurrencyGate(1);
  const completions: (() => void)[] = [];
  const controlledFetch = (() => new Promise<Response>((resolve) => {
    completions.push(() => resolve(new Response("ok")));
  })) as typeof fetch;
  const limitedFetch = createDatabaseFetch(controlledFetch, 5_000, gate);

  const first = limitedFetch("https://database.example.invalid/first");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const caller = new AbortController();
  const cancelled = limitedFetch("https://database.example.invalid/cancelled", {
    signal: caller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  caller.abort();
  let cancellationName = "";
  try {
    await cancelled;
  } catch (error) {
    cancellationName = (error as Error).name;
  }
  assertEquals(cancellationName, "AbortError");

  completions.shift()!();
  await first;
  const third = limitedFetch("https://database.example.invalid/third");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(completions.length, 1);
  completions.shift()!();
  await third;
});

Deno.test("pesan keempat dalam satu detik dibatasi tanpa memblokir pengguna lain", () => {
  clearMessageFloodLimiterForTests();
  assertEquals(MESSAGE_FLOOD_LIMIT, 3);
  assertEquals(MESSAGE_FLOOD_WINDOW_MS, 1_000);
  assertEquals(isMessageFlooding(501, 10_000), false);
  assertEquals(isMessageFlooding(501, 10_001), false);
  assertEquals(isMessageFlooding(501, 10_002), false);
  assertEquals(isMessageFlooding(501, 10_003), true);
  assertEquals(isMessageFlooding(502, 10_003), false);
  assertEquals(isMessageFlooding(501, 10_999), true);
  assertEquals(isMessageFlooding(501, 11_000), false);
  clearMessageFloodLimiterForTests();
});
