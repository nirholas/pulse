// D1 data layer. Timestamps are ISO-8601 text (lexicographically ordered, so
// range filters are plain string comparisons), arrays and objects are JSON text.
import type { Env } from './env.ts';

export type Row = Record<string, any>;
export type Param = string | number | boolean | Date | null | undefined | unknown[] | Record<string, unknown>;

/** D1 binds primitives only; normalise everything else the way the schema stores it. */
export function bind(v: Param): string | number | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v as string | number;
}

/** ISO timestamp `ms` before now: the sqlite spelling of `now() - interval`. */
export const ago = (ms: number, from = Date.now()): string => new Date(from - ms).toISOString();
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const parseJson = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

/** Expand JSON text columns on rows read back from D1. */
export function hydrate<T extends Row>(rows: T[], jsonCols: string[]): T[] {
  if (!jsonCols.length) return rows;
  for (const r of rows) for (const c of jsonCols) if (c in r) (r as Row)[c] = parseJson(r[c], c === 'data' || c === 'meta' ? {} : []);
  return rows;
}

let current: D1Database | null = null;
export const useDb = (env: Env): void => {
  current = env.DB;
};
const handle = (): D1Database => {
  if (!current) throw new Error('database binding not initialised');
  return current;
};

export async function query<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T[]> {
  const res = await handle().prepare(sql).bind(...params.map(bind)).all<T>();
  return res.results;
}

export async function one<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T | null> {
  return (await query<T>(sql, params))[0] ?? null;
}

export async function run(sql: string, params: Param[] = []): Promise<void> {
  await handle().prepare(sql).bind(...params.map(bind)).run();
}

const BATCH = 100;

/** Run many statements in D1 batches (each batch is one transaction and one subrequest). */
export async function batch(statements: [string, Param[]][]): Promise<void> {
  const d = handle();
  for (let i = 0; i < statements.length; i += BATCH) {
    await d.batch(statements.slice(i, i + BATCH).map(([sql, params]) => d.prepare(sql).bind(...params.map(bind))));
  }
}

/** One statement per row, batched. D1 caps bound parameters per statement at 100, so wide rows cannot be multi-row inserts. */
export async function insertMany(table: string, columns: string[], rows: unknown[][], conflict = ''): Promise<number> {
  if (!rows.length) return 0;
  const sql = `insert into ${table} (${columns.join(',')}) values (${columns.map(() => '?').join(',')}) ${conflict}`;
  await batch(rows.map((r) => [sql, r as Param[]]));
  return rows.length;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const row = await one<{ value: string }>('select value from kv where key = ?', [key]);
  return row ? parseJson<T | null>(row.value, null) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await run(
    `insert into kv (key, value, updated_at) values (?, ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date()],
  );
}
