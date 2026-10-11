// Rebuild a Pulse database from an archive tree, oldest day first so mutable
// tables end on their newest values. Safe to re-run: every insert is an upsert
// or `do nothing` on the table's primary key.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../lib/log.ts';
import { insertMany } from '../db/client.ts';
import { readJsonlGz, type Row } from './files.ts';
import { SNAPSHOT_TABLE, TABLES, statePath } from './tables.ts';

const log = logger('restore');

const MUTABLE = new Set(['tokens', 'wallets', 'wallet_positions', 'wallet_scores']);

async function load(table: string, pk: string[], json: string[], rows: Row[]): Promise<number> {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]!);
  const values = rows.map((r) => cols.map((c) => (json.includes(c) && r[c] !== null && r[c] !== undefined ? JSON.stringify(r[c]) : r[c] ?? null)));
  const set = cols.filter((c) => !pk.includes(c)).map((c) => `${c} = excluded.${c}`).join(', ');
  const conflict = MUTABLE.has(table) && set ? `on conflict (${pk.join(',')}) do update set ${set}` : 'on conflict do nothing';
  return insertMany(table, cols, values, conflict);
}

function dailyFiles(root: string, table: string): string[] {
  const base = join(root, 'daily', table);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const y of readdirSync(base).sort()) for (const m of readdirSync(join(base, y)).sort()) for (const f of readdirSync(join(base, y, m)).sort()) if (f.endsWith('.jsonl.gz')) out.push(join(base, y, m, f));
  return out;
}

export async function restoreArchive(root: string): Promise<Record<string, number>> {
  if (!existsSync(join(root, 'manifests'))) throw new Error(`${root} is not a Pulse archive (no manifests/ directory)`);
  const counts: Record<string, number> = {};
  const order = [{ ...TABLES.find((t) => t.table === 'tokens')!, json: [] as string[] }, ...TABLES.filter((t) => t.table !== 'tokens'), { table: SNAPSHOT_TABLE.table, pk: SNAPSHOT_TABLE.pk, mode: 'daily' as const, json: [] as string[], orderBy: '' }];
  for (const spec of order) {
    const files = spec.mode === 'state' ? [join(root, statePath(spec.table))].filter(existsSync) : dailyFiles(root, spec.table);
    for (const f of files) counts[spec.table] = (counts[spec.table] ?? 0) + (await load(spec.table, spec.pk, spec.json ?? [], readJsonlGz(f)));
    log.info(`${spec.table}: ${counts[spec.table] ?? 0} rows from ${files.length} file(s)`);
  }
  return counts;
}
