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
  getServiceClient,
} from "../_shared/service-client.ts";

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
