// What goes into the git archive and how it is sliced. Append-only time series
// are exported per UTC day. Mutable tables are exported as the rows that
// changed that day (delta) or as one current-state file (small tables).
export type TableSpec = {
  table: string;
  /** Conflict target used when restoring. */
  pk: string[];
  /** Columns holding jsonb, which must be re-serialized on restore. */
  json?: string[];
  mode: 'daily' | 'state';
  /** Daily mode: SQL predicate over $1 (inclusive start) and $2 (exclusive end). */
  where?: string;
  orderBy: string;
};

export const TABLES: TableSpec[] = [
  { table: 'launch_events', pk: ['chain', 'kind', 'token'], json: ['data'], mode: 'daily', where: 'ts >= $1 and ts < $2', orderBy: 'ts, chain, kind, token' },
  { table: 'trades', pk: ['chain', 'tx', 'token', 'wallet', 'side', 'ts'], mode: 'daily', where: 'ts >= $1 and ts < $2', orderBy: 'ts, chain, tx, token, wallet, side' },
  { table: 'list_appearances', pk: ['chain', 'list', 'address', 'ts'], mode: 'daily', where: 'ts >= $1 and ts < $2', orderBy: 'ts, chain, list, address' },
  { table: 'market_snapshots', pk: ['chain', 'ts'], json: ['data'], mode: 'daily', where: 'ts >= $1 and ts < $2', orderBy: 'ts, chain' },
  { table: 'tokens', pk: ['chain', 'address'], mode: 'daily', where: 'last_snapshot_at >= $1 and last_snapshot_at < $2', orderBy: 'chain, address' },
  { table: 'wallet_positions', pk: ['chain', 'wallet', 'token'], mode: 'daily', where: 'last_trade_at >= $1 and last_trade_at < $2', orderBy: 'chain, wallet, token' },
  { table: 'wallets', pk: ['chain', 'address'], json: ['meta'], mode: 'state', orderBy: 'chain, address' },
  { table: 'wallet_scores', pk: ['chain', 'wallet'], mode: 'state', orderBy: 'chain, wallet' },
];

/** token_snapshots is exported separately: hourly for everyone, full resolution for runners. */
export const SNAPSHOT_TABLE = { table: 'token_snapshots', pk: ['chain', 'address', 'ts'] };

export const dayPath = (table: string, day: string) => `daily/${table}/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.jsonl.gz`;
export const statePath = (table: string) => `state/${table}.jsonl.gz`;

export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function dayBounds(day: string): [Date, Date] {
  const start = new Date(`${day}T00:00:00Z`);
  return [start, new Date(start.getTime() + 86_400_000)];
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
