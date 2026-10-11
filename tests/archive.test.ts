import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fromJsonl, gzipDeterministic, readJsonlGz, toJsonl, writeIfChanged } from '../src/archive/files.ts';
import { detectRunners, renderRunnersMarkdown, rollupSectors, type RunnerRow } from '../src/archive/runners.ts';
import { addDays, dayBounds, dayPath, isDay } from '../src/archive/tables.ts';

const base: RunnerRow = {
  chain: 'solana', address: 'A'.repeat(40), symbol: 'AGNT', name: 'Agent', description: 'agent payments rail', website: null, twitter: null, launchpad: 'pump',
  category: 'agents', tech_score: 0.8, status: 'running', created_at: '2026-10-01T00:00:00Z', first_seen: '2026-10-01T00:00:00Z',
  open_mcap: 50_000, close_mcap: 180_000, peak_mcap: 220_000, peak_vol_24h: 90_000, peak_liq: 20_000, open_holders: 100, close_holders: 400, lists: 3, wallet_buyers: 2, wallet_kinds: ['kol'],
};
const dayEnd = new Date('2026-10-10T00:00:00Z');

describe('files', () => {
  it('writes byte-identical gzip for identical rows, regardless of wall clock', async () => {
    const a = gzipDeterministic(toJsonl([{ a: 1 }, { b: 'x' }]));
    await new Promise((r) => setTimeout(r, 1100));
    expect(gzipDeterministic(toJsonl([{ a: 1 }, { b: 'x' }])).equals(a)).toBe(true);
    expect(fromJsonl(gunzipSync(a).toString())).toEqual([{ a: 1 }, { b: 'x' }]);
  });
  it('reports unchanged files so git sees no diff', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'pulse-files-')), 'x', 'y.txt');
    expect(writeIfChanged(p, 'hi').changed).toBe(true);
    expect(writeIfChanged(p, 'hi').changed).toBe(false);
  });
});

describe('tables helpers', () => {
  it('validates days and slices UTC bounds', () => {
    expect(isDay('2026-10-10')).toBe(true);
    expect(isDay('2026-13-40')).toBe(false);
    expect(isDay('../etc/passwd')).toBe(false);
    expect(dayBounds('2026-10-10').map((d) => d.toISOString())).toEqual(['2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z']);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(dayPath('trades', '2026-10-10')).toBe('daily/trades/2026/10/2026-10-10.jsonl.gz');
  });
});

describe('detectRunners', () => {
  it('flags a 4x token with volume as a runner and marks tech sectors', () => {
    const [r] = detectRunners([base], dayEnd);
    expect(r).toMatchObject({ kind: 'runner', multiple: 4.4, isTech: true, trackedWalletBuyers: 2 });
  });
  it('flags a fresh launch that reached size without a 2x as a breakout', () => {
    const [r] = detectRunners([{ ...base, open_mcap: 200_000, peak_mcap: 300_000, peak_vol_24h: 150_000, created_at: '2026-10-08T12:00:00Z' }], dayEnd);
    expect(r?.kind).toBe('breakout');
  });
  it('drops thin, illiquid, huge and flat tokens', () => {
    const rows = [
      { ...base, address: 'B'.repeat(40), peak_vol_24h: 10_000 },
      { ...base, address: 'C'.repeat(40), peak_liq: 1_000 },
      { ...base, address: 'D'.repeat(40), peak_mcap: 2_000_000_000, open_mcap: 100_000_000 },
      { ...base, address: 'E'.repeat(40), open_mcap: 200_000, peak_mcap: 210_000 },
    ];
    expect(detectRunners(rows, dayEnd)).toEqual([]);
  });
  it('ranks by score and treats meme sectors as non-tech', () => {
    const meme = { ...base, address: 'F'.repeat(40), symbol: 'DOG', category: 'meme', tech_score: 0.9 };
    const ranked = detectRunners([meme, base], dayEnd);
    expect(ranked[0]?.symbol).toBe('AGNT');
    expect(ranked.find((r) => r.symbol === 'DOG')?.isTech).toBe(false);
  });
  it('rolls sectors up and renders a table without breaking on pipes in names', () => {
    const runners = detectRunners([{ ...base, symbol: 'A|B\nC' }], dayEnd);
    expect(rollupSectors(runners)[0]).toMatchObject({ category: 'agents', runners: 1, isTech: true });
    const md = renderRunnersMarkdown({ schema: 'pulse.runners/1', day: '2026-10-09', rules: {} as any, counts: { runners: 1, breakouts: 0, tech: 1 }, runners, sectors: rollupSectors(runners) });
    expect(md).not.toMatch(/A\|B/);
  });
});

describe('archive end to end (PGlite + a local git remote)', () => {
  const work = mkdtempSync(join(tmpdir(), 'pulse-archive-'));
  const remote = join(work, 'remote.git');
  const DAY = '2026-10-09';
  const env = { ...process.env };

  beforeAll(async () => {
    execFileSync('git', ['init', '--bare', '--quiet', '-b', 'main', remote]);
    process.env.PGLITE_DIR = join(work, 'db1');
    process.env.DATABASE_URL = '';
    process.env.ARCHIVE_REPO = remote;
    process.env.ARCHIVE_DIR = join(work, 'tree');
    process.env.ANTHROPIC_API_KEY = '';
    vi.resetModules();
    const { migrate } = await import('../src/db/migrate.ts');
    const { db } = await import('../src/db/client.ts');
    await migrate();
    const d = await db();
    await d.query(`insert into tokens (chain, address, symbol, name, description, category, tech_score, status, created_at, last_snapshot_at, last_mcap) values
      ('solana', $1, 'AGNT', 'Agent', 'agent payments rail', 'agents', 0.8, 'running', '2026-10-01', '2026-10-09T23:00:00Z', 180000),
      ('solana', $2, 'FLAT', 'Flat', null, 'meme', 0.1, 'new', '2026-10-01', '2026-10-09T23:00:00Z', 60000)`, ['A'.repeat(40), 'B'.repeat(40)]);
    const snap = (addr: string, ts: string, mcap: number) =>
      d.query(`insert into token_snapshots (ts, chain, address, mcap, liquidity, vol_24h, holders, source) values ($1, 'solana', $2, $3, 20000, 90000, 100, 'test')`, [ts, addr, mcap]);
    await snap('A'.repeat(40), '2026-10-09T01:00:00Z', 50_000);
    await snap('A'.repeat(40), '2026-10-09T01:05:00Z', 55_000);
    await snap('A'.repeat(40), '2026-10-09T12:00:00Z', 220_000);
    await snap('B'.repeat(40), '2026-10-09T01:00:00Z', 60_000);
    await d.query(`insert into wallets (chain, address, kind, source, meta) values ('solana', 'W1', 'kol', 'test', '{"x":1}')`);
    await d.query(`insert into trades (ts, chain, tx, token, wallet, side, quote_amount, token_amount) values ('2026-10-09T05:00:00Z', 'solana', 'tx1', $1, 'W1', 'buy', 1, 100)`, ['A'.repeat(40)]);
    await d.query(`insert into daily_reports (day, data, markdown, html) values ($1, '{"k":1}', '# issue', '<p/>')`, [DAY]);
  }, 60_000);

  afterAll(() => {
    Object.assign(process.env, env);
  });

  it('exports a day, finds the runner, commits and pushes, and resumes without duplicating', async () => {
    const { archivePending, archivedDays } = await import('../src/archive/archive.ts');
    const res = await archivePending({ now: new Date('2026-10-10T02:00:00Z') });
    expect(res).toMatchObject({ committed: 1, pushed: true, days: [DAY] });
    const tree = process.env.ARCHIVE_DIR!;
    expect(archivedDays(tree)).toEqual([DAY]);

    const digest = JSON.parse(readFileSync(join(tree, 'runners', `${DAY}.json`), 'utf8'));
    expect(digest.runners.map((r: any) => r.symbol)).toEqual(['AGNT']);
    expect(digest.runners[0]).toMatchObject({ kind: 'runner', isTech: true, trackedWalletBuyers: 1 });

    // hourly downsample for everyone, full resolution for the runner: 3 AGNT rows + 1 FLAT row
    expect(readJsonlGz(join(tree, dayPath('token_snapshots', DAY)))).toHaveLength(4);
    expect(readJsonlGz(join(tree, dayPath('trades', DAY)))).toHaveLength(1);
    expect(readFileSync(join(tree, 'reports', `${DAY}.md`), 'utf8')).toBe('# issue');
    expect(readFileSync(join(tree, 'LATEST.md'), 'utf8')).toContain('AGNT');
    expect(existsSync(join(tree, 'briefs'))).toBe(false); // no API key, no fabricated brief

    expect(execFileSync('git', ['-C', remote, 'log', '--format=%s', 'main']).toString()).toContain(`data(${DAY}): 1 runners, 0 breakouts, 1 tech`);

    const again = await archivePending({ now: new Date('2026-10-10T03:00:00Z') });
    expect(again).toMatchObject({ days: [], committed: 0, pushed: false });
    const rerun = await archivePending({ days: [DAY], now: new Date('2026-10-10T03:00:00Z') });
    expect(rerun.committed).toBe(0); // deterministic bytes: re-exporting an unchanged day changes nothing
  }, 60_000);

  it('restores the tree into a fresh database', async () => {
    process.env.PGLITE_DIR = join(work, 'db2');
    vi.resetModules();
    const { migrate } = await import('../src/db/migrate.ts');
    const { db } = await import('../src/db/client.ts');
    const { restoreArchive } = await import('../src/archive/restore.ts');
    await migrate();
    const counts = await restoreArchive(process.env.ARCHIVE_DIR!);
    expect(counts).toMatchObject({ tokens: 2, trades: 1, wallets: 1, token_snapshots: 4 });
    const d = await db();
    expect((await d.query(`select meta from wallets`))[0]?.meta).toEqual({ x: 1 });
    await restoreArchive(process.env.ARCHIVE_DIR!);
    expect((await d.query(`select count(*)::int as n from token_snapshots`))[0]?.n).toBe(4);
    expect(readdirSync(process.env.ARCHIVE_DIR!)).toContain('manifests');
  }, 60_000);
});
