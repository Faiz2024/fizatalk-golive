import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Satu client per kredensial untuk seluruh handler dalam proses Railway.
// Fetch bawaan Deno memakai connection pool dan HTTP keep-alive secara otomatis.
const serviceClients = new Map<string, SupabaseClient>();

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

  const client = createClient(url, serviceRoleKey, {
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
}
