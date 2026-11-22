// Temporary, authenticated data transfer helper for the standalone Supabase target.
// It stages JSON rows, then activates all 22 tables in one target transaction.
import postgres from 'npm:postgres@3.4.5';
import { z } from 'https://esm.sh/zod@3.23.8';

const EXPECTED = {
  telegram_users: 190403,
  payment_methods: 0,
  admin_report_cards: 779,
  blocked_users: 6934,
  bot_logs: 0,
  bot_settings: 13,
  call_invitations: 0,
  coin_transactions: 8817,
  daily_user_stats: 246,
  moderation_reviews: 60,
  partner_reports: 0,
  pending_transactions: 1951,
  premium_requests: 8543,
  reconnect_requests: 9726,
  reengagement_clicks: 0,
  reengagement_daily_stats: 214,
  referral_cashouts: 41,
  referral_reward_claims: 791,
  referrals: 7847,
  sticker_packs: 17031,
  topup_requests: 980,
  waiting_queue: 3,
} as const;

const TABLES = Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>;
const TableSchema = z.enum(TABLES as [keyof typeof EXPECTED, ...Array<keyof typeof EXPECTED>]);
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('begin') }),
  z.object({
    action: z.literal('batch'),
    table: TableSchema,
    batch_id: z.string().regex(/^[a-z_]+:[0-9]+$/),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
  }),
  z.object({ action: z.literal('commit') }),
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('abort') }),
]);

const API_KEY = Deno.env.get('DB_BRIDGE_API_KEY') ?? '';
const TARGET_DATABASE_URL = Deno.env.get('TARGET_DATABASE_URL') ?? '';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[connection URI hidden]').slice(0, 1200);
}

function connect() {
  if (!TARGET_DATABASE_URL) throw new Error('TARGET_DATABASE_URL belum tersedia');
  return postgres(TARGET_DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: 'require',
    connect_timeout: 30,
    idle_timeout: 5,
  });
}

async function publicCounts(sql: ReturnType<typeof postgres>) {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await sql`SELECT count(*)::int AS count FROM ${sql('public')}.${sql(table)}`;
    counts[table] = rows[0].count;
  }
  return counts;
}

function countsMatch(counts: Record<string, number>, expectedEmpty: boolean): boolean {
  return TABLES.every((table) => counts[table] === (expectedEmpty ? 0 : EXPECTED[table]));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return response({ error: 'method not allowed' }, 405);
  const provided = req.headers.get('x-api-key') ?? '';
  if (!API_KEY || !provided || !timingSafeEqual(provided, API_KEY)) {
    return response({ error: 'unauthorized' }, 401);
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return response({ error: 'invalid input', details: parsed.error.flatten() }, 400);
    body = parsed.data;
  } catch {
    return response({ error: 'invalid json' }, 400);
  }

  const sql = connect();
  try {
    if (body.action === 'begin') {
      const result = await sql.begin(async (tx) => {
        const structure = await tx`
          SELECT
            (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables,
            (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS functions,
            (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public') AS indexes
        `;
        if (structure[0].tables !== 22 || structure[0].functions !== 85 || structure[0].indexes !== 79) {
          throw new Error(`Struktur target belum sesuai: ${JSON.stringify(structure[0])}`);
        }
        for (const table of TABLES) {
          const rows = await tx`SELECT count(*)::int AS count FROM ${tx('public')}.${tx(table)}`;
          if (rows[0].count !== 0) throw new Error(`Target tidak kosong: ${table} berisi ${rows[0].count} baris`);
        }
        await tx`DROP SCHEMA IF EXISTS fizatalk_import CASCADE`;
        await tx`CREATE SCHEMA fizatalk_import`;
        await tx`
          CREATE TABLE fizatalk_import.batches (
            table_name text NOT NULL,
            batch_id text PRIMARY KEY,
            checksum text NOT NULL,
            row_count integer NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `;
        await tx`
          CREATE TABLE fizatalk_import.rows (
            seq bigint GENERATED ALWAYS AS IDENTITY,
            table_name text NOT NULL,
            payload jsonb NOT NULL
          )
        `;
        await tx`CREATE INDEX rows_table_seq_idx ON fizatalk_import.rows (table_name, seq)`;
        return { status: 'STAGING_READY', structure: structure[0], expected_rows: 254379 };
      });
      return response(result);
    }

    if (body.action === 'batch') {
      const result = await sql.begin(async (tx) => {
        const inserted = await tx`
          INSERT INTO fizatalk_import.batches (table_name, batch_id, checksum, row_count)
          VALUES (${body.table}, ${body.batch_id}, ${body.checksum}, ${body.rows.length})
          ON CONFLICT (batch_id) DO NOTHING
          RETURNING batch_id
        `;
        if (inserted.length === 0) {
          const existing = await tx`
            SELECT checksum, row_count FROM fizatalk_import.batches WHERE batch_id = ${body.batch_id}
          `;
          if (existing.length === 0 || existing[0].checksum !== body.checksum || existing[0].row_count !== body.rows.length) {
            throw new Error(`Batch ID bentrok: ${body.batch_id}`);
          }
          return { status: 'BATCH_DUPLICATE', batch_id: body.batch_id, rows: body.rows.length };
        }
        await tx`
          INSERT INTO fizatalk_import.rows (table_name, payload)
          SELECT ${body.table}, value
          FROM jsonb_array_elements(${tx.json(body.rows as unknown as Parameters<typeof tx.json>[0])})
        `;
        return { status: 'BATCH_OK', batch_id: body.batch_id, rows: body.rows.length };
      });
      return response(result);
    }

    if (body.action === 'commit') {
      const staging = await sql`SELECT to_regclass('fizatalk_import.rows') AS rows_table`;
      if (!staging[0].rows_table) {
        const counts = await publicCounts(sql);
        if (countsMatch(counts, false)) return response({ status: 'IMPORT_OK', already_committed: true, counts });
        throw new Error('Staging tidak ditemukan dan data target belum lengkap');
      }

      const result = await sql.begin(async (tx) => {
        await tx`SET LOCAL TIME ZONE 'Asia/Jakarta'`;
        for (const table of TABLES) {
          const staged = await tx`
            SELECT count(*)::int AS count FROM fizatalk_import.rows WHERE table_name = ${table}
          `;
          if (staged[0].count !== EXPECTED[table]) {
            throw new Error(`Jumlah staging ${table}=${staged[0].count}, seharusnya ${EXPECTED[table]}`);
          }
          const target = await tx`SELECT count(*)::int AS count FROM ${tx('public')}.${tx(table)}`;
          if (target[0].count !== 0) throw new Error(`Target berubah dan tidak lagi kosong: ${table}`);
        }

        await tx`ALTER TABLE public.telegram_users DISABLE TRIGGER guard_moderation_state`;
        for (const table of TABLES) {
          await tx`
            INSERT INTO ${tx('public')}.${tx(table)}
            SELECT * FROM jsonb_populate_recordset(
              NULL::${tx('public')}.${tx(table)},
              (SELECT jsonb_agg(payload ORDER BY seq) FROM fizatalk_import.rows WHERE table_name = ${table})
            )
          `;
        }
        await tx`ALTER TABLE public.telegram_users ENABLE TRIGGER guard_moderation_state`;
        await tx`SELECT setval('public.reengagement_clicks_id_seq', 109728, true)`;
        await tx`
          SELECT setval(
            'public.sticker_packs_id_seq',
            GREATEST(COALESCE((SELECT max(id) FROM public.sticker_packs), 0), 1),
            EXISTS(SELECT 1 FROM public.sticker_packs)
          )
        `;
        for (const table of TABLES) {
          const target = await tx`SELECT count(*)::int AS count FROM ${tx('public')}.${tx(table)}`;
          if (target[0].count !== EXPECTED[table]) {
            throw new Error(`Validasi ${table} gagal: ${target[0].count} <> ${EXPECTED[table]}`);
          }
        }
        await tx`DROP SCHEMA fizatalk_import CASCADE`;
        return { status: 'IMPORT_OK', total_rows: 254379 };
      });
      return response(result);
    }

    if (body.action === 'verify') {
      const counts = await publicCounts(sql);
      if (!countsMatch(counts, false)) return response({ error: 'count mismatch', counts }, 409);
      const hashes: Record<string, string | null> = {};
      for (const table of TABLES) {
        const rows = await sql`
          WITH h AS (SELECT md5(row_to_json(t)::text) AS hash FROM ${sql('public')}.${sql(table)} t)
          SELECT md5(string_agg(hash, '' ORDER BY hash)) AS hash FROM h
        `;
        hashes[table] = rows[0].hash;
      }
      const summary = await sql`
        SELECT current_setting('TimeZone') AS timezone,
          (SELECT count(*)::int FROM public.blocked_users WHERE is_active) AS active_blocks,
          (SELECT count(*)::int FROM public.telegram_users WHERE premium_until > now()) AS active_premium,
          (SELECT last_value FROM public.reengagement_clicks_id_seq) AS click_sequence,
          (SELECT last_value FROM public.sticker_packs_id_seq) AS sticker_sequence,
          NOT EXISTS (
            SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled <> 'O'
          ) AS triggers_enabled
      `;
      return response({ status: 'VERIFIKASI_OK', counts, hashes, summary: summary[0] });
    }

    await sql`DROP SCHEMA IF EXISTS fizatalk_import CASCADE`;
    return response({ status: 'STAGING_REMOVED' });
  } catch (error) {
    const message = safeError(error);
    console.error(`[target-data-import] ${body.action}: ${message}`);
    return response({ error: message }, 500);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
