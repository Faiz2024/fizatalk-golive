import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createCircuitBreakerFetch,
  DATABASE_CIRCUIT_OPEN_MS,
  DATABASE_FAILURE_THRESHOLD,
  DATABASE_FAILURE_WINDOW_MS,
  DatabaseCircuitBreaker,
} from "../_shared/database-circuit-breaker.ts";

Deno.test("circuit terbuka setelah 15 kegagalan/10 detik dan memulih setelah 10 detik", () => {
  assertEquals(DATABASE_FAILURE_THRESHOLD, 15);
  assertEquals(DATABASE_FAILURE_WINDOW_MS, 10_000);
  assertEquals(DATABASE_CIRCUIT_OPEN_MS, 10_000);
  const breaker = new DatabaseCircuitBreaker();
  for (let index = 0; index < 14; index++) breaker.recordFailure(1_000 + index);
  assertEquals(breaker.isOpen(1_014), false);
  breaker.recordFailure(1_014);
  assertEquals(breaker.isOpen(11_013), true);
  assertEquals(breaker.isOpen(11_014), false);
});

Deno.test("kegagalan di luar jendela 10 detik tidak dijumlahkan", () => {
  const breaker = new DatabaseCircuitBreaker();
  for (let index = 0; index < 14; index++) breaker.recordFailure(1_000);
  breaker.recordFailure(12_000);
  assertEquals(breaker.isOpen(12_000), false);
});

Deno.test("request diblokir tanpa fetch saat circuit terbuka dan sukses menutupnya", async () => {
  const breaker = new DatabaseCircuitBreaker();
  let calls = 0;
  const fetcher = createCircuitBreakerFetch((() => {
    calls++;
    return Promise.resolve(new Response("busy", { status: 503 }));
  }) as typeof fetch, breaker);
  for (let index = 0; index < 15; index++) {
    await fetcher("https://database.example.invalid/rest/v1/");
  }
  assertEquals(calls, 15);
  let blockedName = "";
  try {
    await fetcher("https://database.example.invalid/rest/v1/");
  } catch (error) {
    blockedName = (error as Error).name;
  }
  assertEquals(blockedName, "CircuitBreakerOpenError");
  assertEquals(calls, 15);

  breaker.recordSuccess();
  await createCircuitBreakerFetch(
    (() => Promise.resolve(new Response("ok", { status: 200 }))) as typeof fetch,
    breaker,
  )("https://database.example.invalid/rest/v1/");
  assertEquals(breaker.isOpen(), false);
});

for (const status of [502, 503, 504]) {
  Deno.test(`HTTP ${status} dihitung sebagai gangguan gateway database`, async () => {
    const breaker = new DatabaseCircuitBreaker(1);
    const fetcher = createCircuitBreakerFetch(
      (() => Promise.resolve(new Response("busy", { status }))) as typeof fetch,
      breaker,
    );
    assertEquals((await fetcher("https://database.example.invalid/")).status, status);
    assertEquals(breaker.isOpen(), true);
  });
}

Deno.test("respons selain HTTP 502/503/504 tidak membuka circuit", async () => {
  for (const status of [200, 400, 401, 403, 404, 429, 500, 501, 505]) {
    const breaker = new DatabaseCircuitBreaker(1);
    const fetcher = createCircuitBreakerFetch(
      (() => Promise.resolve(new Response("response", { status }))) as typeof fetch,
      breaker,
    );
    await fetcher("https://database.example.invalid/");
    assertEquals(breaker.isOpen(), false);
  }
});

for (const name of ["TimeoutError", "AbortError", "TypeError"]) {
  Deno.test(`${name} diteruskan tanpa menambah atau mereset kegagalan gateway`, async () => {
    const breaker = new DatabaseCircuitBreaker(15);
    for (let index = 0; index < 14; index++) breaker.recordFailure();
    const failure = new Error("request failed");
    failure.name = name;
    const fetcher = createCircuitBreakerFetch(
      (() => Promise.reject(failure)) as typeof fetch,
      breaker,
    );
    for (let index = 0; index < 20; index++) {
      const error = await assertRejects(() => fetcher("https://database.example.invalid/"));
      assertEquals(error, failure);
      assertEquals(breaker.isOpen(), false);
    }
    breaker.recordFailure();
    assertEquals(breaker.isOpen(), true);
  });
}
