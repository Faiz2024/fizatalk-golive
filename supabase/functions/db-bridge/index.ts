// db-bridge: Antigravity ↔ Lovable Cloud SQL + logs bridge
// Auth: X-API-Key header (timing-safe compare with DB_BRIDGE_API_KEY)
// verify_jwt = false (auth handled in code)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const API_KEY = Deno.env.get('DB_BRIDGE_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ---------- rate limit (in-memory, per-IP, 120 req/min) ----------
const RL = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = RL.get(ip);
  if (!entry || now > entry.reset) {
    RL.set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= 120;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---------- schemas ----------
const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sql_query'), sql: z.string().min(1).max(20000), params: z.array(z.any()).optional() }),
  z.object({ action: z.literal('sql_execute'), sql: z.string().min(1).max(20000), params: z.array(z.any()).optional() }),
  z.object({ action: z.literal('list_tables') }),
  z.object({ action: z.literal('describe_table'), table: z.string().min(1).max(128) }),
  z.object({ action: z.literal('list_policies'), table: z.string().min(1).max(128).optional() }),
  z.object({
    action: z.literal('recent_logs'),
    limit: z.number().int().min(1).max(500).optional(),
    level: z.enum(['debug','info','warn','error','fatal']).optional(),
    source: z.string().max(128).optional(),
    since_minutes: z.number().int().min(1).max(10080).optional(),
  }),
  z.object({
    action: z.literal('user_logs'),
    user_id: z.number().int(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  z.object({ action: z.literal('log_summary'), since_minutes: z.number().int().min(1).max(10080).optional() }),
]);

// ---------- exec helper via bridge_exec_sql ----------
async function execSql(sql: string): Promise<{ ok: boolean; result?: unknown; error?: string; status: number }> {
  const { data, error } = await supabase.rpc('bridge_exec_sql', { p_sql: sql, p_params: [] });
  if (error) return { ok: false, error: error.message, status: 500 };
  const r = data as any;
  if (r?.kind === 'error') return { ok: false, error: r.message, status: 400, result: r };
  return { ok: true, result: r, status: 200 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Auth
  if (!API_KEY) return json({ error: 'bridge not configured' }, 500);
  const provided = req.headers.get('x-api-key') ?? '';
  if (!provided || !timingSafeEqual(provided, API_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (!rateLimit(ip)) return json({ error: 'rate limit exceeded' }, 429);

  // Parse + validate
  let body: unknown;
  try { body = await req.json(); }
  catch { return json({ error: 'invalid json' }, 400); }

  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid input', details: parsed.error.flatten() }, 400);

  const p = parsed.data;

  try {
    switch (p.action) {
      case 'sql_query': {
        const lower = p.sql.trim().toLowerCase();
        if (!/^(select|with|table|values|show|explain)\b/.test(lower)) {
          return json({ error: 'sql_query only allows SELECT/WITH/TABLE/VALUES/SHOW/EXPLAIN' }, 400);
        }
        const r = await execSql(p.sql);
        return json(r.result ?? { error: r.error }, r.status);
      }

      case 'sql_execute': {
        const r = await execSql(p.sql);
        return json(r.result ?? { error: r.error }, r.status);
      }

      case 'list_tables': {
        const r = await execSql(
          `SELECT table_name,
                  (SELECT count(*) FROM information_schema.columns c
                     WHERE c.table_schema='public' AND c.table_name=t.table_name) AS column_count
             FROM information_schema.tables t
            WHERE table_schema='public' AND table_type='BASE TABLE'
            ORDER BY table_name`
        );
        return json(r.result, r.status);
      }

      case 'describe_table': {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.table)) return json({ error: 'invalid table name' }, 400);
        const r = await execSql(
          `SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
            WHERE table_schema='public' AND table_name='${p.table}'
            ORDER BY ordinal_position`
        );
        return json(r.result, r.status);
      }

      case 'list_policies': {
        const where = p.table
          ? (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.table)
              ? `WHERE schemaname='public' AND tablename='${p.table}'`
              : 'WHERE false')
          : `WHERE schemaname='public'`;
        const r = await execSql(
          `SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
             FROM pg_policies ${where} ORDER BY tablename, policyname`
        );
        return json(r.result, r.status);
      }

      case 'recent_logs': {
        const limit = p.limit ?? 50;
        const since = p.since_minutes ?? 1440;
        const filters: string[] = [`created_at > (now() - interval '${since} minutes')`];
        if (p.level) filters.push(`level='${p.level}'`);
        if (p.source) {
          if (!/^[a-zA-Z0-9_-]+$/.test(p.source)) return json({ error: 'invalid source' }, 400);
          filters.push(`source='${p.source}'`);
        }
        const r = await execSql(
          `SELECT id, created_at, level, source, event, user_id, message, context
             FROM bot_logs WHERE ${filters.join(' AND ')}
            ORDER BY created_at DESC LIMIT ${limit}`
        );
        return json(r.result, r.status);
      }

      case 'user_logs': {
        const limit = p.limit ?? 100;
        const r = await execSql(
          `SELECT id, created_at, level, source, event, message, context
             FROM bot_logs WHERE user_id=${p.user_id}
            ORDER BY created_at DESC LIMIT ${limit}`
        );
        return json(r.result, r.status);
      }

      case 'log_summary': {
        const since = p.since_minutes ?? 1440;
        const r = await execSql(
          `SELECT level, source, event, count(*) AS n
             FROM bot_logs
            WHERE created_at > (now() - interval '${since} minutes')
            GROUP BY level, source, event
            ORDER BY n DESC LIMIT 200`
        );
        return json(r.result, r.status);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('[db-bridge] error:', msg);
    return json({ error: msg }, 500);
  }
});
