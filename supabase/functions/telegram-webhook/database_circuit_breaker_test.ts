import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createCircuitBreakerFetch,
  DATABASE_CIRCUIT_OPEN_MS,
  DATABASE_FAILURE_THRESHOLD,
  DATABASE_FAILURE_WINDOW_MS,
  DatabaseCircuitBreaker,
} from "../_shared/database-circuit-breaker.ts";

Deno.test("circuit terbuka setelah 5 kegagalan/10 detik dan memulih setelah 10 detik", () => {
  assertEquals(DATABASE_FAILURE_THRESHOLD, 5);
  assertEquals(DATABASE_FAILURE_WINDOW_MS, 10_000);
  assertEquals(DATABASE_CIRCUIT_OPEN_MS, 10_000);
  const breaker = new DatabaseCircuitBreaker();
  for (let index = 0; index < 4; index++) breaker.recordFailure(1_000 + index);
  assertEquals(breaker.isOpen(1_004), false);
  breaker.recordFailure(1_004);
  assertEquals(breaker.isOpen(11_003), true);
  assertEquals(breaker.isOpen(11_004), false);
});

Deno.test("kegagalan di luar jendela 10 detik tidak dijumlahkan", () => {
  const breaker = new DatabaseCircuitBreaker();
  for (let index = 0; index < 4; index++) breaker.recordFailure(1_000);
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
  for (let index = 0; index < 5; index++) {
    await fetcher("https://database.example.invalid/rest/v1/");
  }
  assertEquals(calls, 5);
  let blockedName = "";
  try {
    await fetcher("https://database.example.invalid/rest/v1/");
  } catch (error) {
    blockedName = (error as Error).name;
  }
  assertEquals(blockedName, "CircuitBreakerOpenError");
  assertEquals(calls, 5);

  breaker.recordSuccess();
  await createCircuitBreakerFetch(
    (() => Promise.resolve(new Response("ok", { status: 200 }))) as typeof fetch,
    breaker,
  )("https://database.example.invalid/rest/v1/");
  assertEquals(breaker.isOpen(), false);
});
