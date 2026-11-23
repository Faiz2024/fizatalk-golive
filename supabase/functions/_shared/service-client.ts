import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  createCircuitBreakerFetch,
  DatabaseCircuitBreaker,
} from "./database-circuit-breaker.ts";
import { DatabaseConcurrencyGate } from "./database-concurrency.ts";

// Satu client per kredensial untuk seluruh handler dalam proses Railway.
// Fetch bawaan Deno memakai connection pool dan HTTP keep-alive secara otomatis.
const serviceClients = new Map<string, SupabaseClient>();
const databaseCircuitBreakers = new Map<string, DatabaseCircuitBreaker>();
const databaseConcurrencyGates = new Map<string, DatabaseConcurrencyGate>();

export const DATABASE_TIMEOUT_MS = 5_000;
export const DATABASE_MAX_CONCURRENCY = 20;

// Batasi setiap panggilan database agar webhook selesai sebelum timeout Telegram.
// Sinyal pembatalan dari pemanggil tetap diteruskan ke fetch yang sebenarnya.
export function createDatabaseFetch(
  fetcher: typeof fetch = fetch,
  timeoutMs = DATABASE_TIMEOUT_MS,
  concurrencyGate?: DatabaseConcurrencyGate,
): typeof fetch {
  return async (input, init) => {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (init?.signal) signals.push(init.signal);
    const signal = AbortSignal.any(signals);

    // Waktu tunggu antrean termasuk dalam timeout, sehingga slot tidak menumpuk
    // ketika database melambat. release selalu berjalan setelah acquire berhasil.
    await concurrencyGate?.acquire(signal);
    try {
      return await fetcher(input, { ...init, signal });
    } finally {
      concurrencyGate?.release();
    }
  };
}

export function getServiceClient(
  url: string,
  serviceRoleKey: string,
): SupabaseClient {
  if (!url || !serviceRoleKey) {
    throw new Error("Database configuration is required");
  }
  const cacheKey = `${url}\0${serviceRoleKey}`;
  const cached = serviceClients.get(cacheKey);
  if (cached) return cached;

  let circuitBreaker = databaseCircuitBreakers.get(url);
  if (!circuitBreaker) {
    circuitBreaker = new DatabaseCircuitBreaker();
    databaseCircuitBreakers.set(url, circuitBreaker);
  }
  let concurrencyGate = databaseConcurrencyGates.get(url);
  if (!concurrencyGate) {
    concurrencyGate = new DatabaseConcurrencyGate(DATABASE_MAX_CONCURRENCY);
    databaseConcurrencyGates.set(url, concurrencyGate);
  }
  const client = createClient(url, serviceRoleKey, {
    global: {
      fetch: createCircuitBreakerFetch(
        createDatabaseFetch(fetch, DATABASE_TIMEOUT_MS, concurrencyGate),
        circuitBreaker,
      ),
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  serviceClients.set(cacheKey, client);
  return client;
}

export function clearServiceClientsForTests(): void {
  serviceClients.clear();
  databaseCircuitBreakers.clear();
  databaseConcurrencyGates.clear();
}
