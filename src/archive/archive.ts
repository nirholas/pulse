// Daily export of the Postgres archive into a git working tree. One UTC day at
// a time: append-only tables as gzip JSONL, mutable tables as that day's
// changes, the newsletter, the runner digest and the AI brief. The tree is the
// source of truth for "which days are done", so a rebuilt database or a new
// host resumes exactly where the repo stops.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../lib/env.ts';
import { logger } from '../lib/log.ts';
import { db } from '../db/client.ts';
import { writeBrief, type SectorHistory } from './brief.ts';
import { writeIfChanged, writeJsonlGz, type Row } from './files.ts';
import { commitAll, openArchive, pushArchive, type GitTarget } from './git.ts';
import { buildRunnerDigest, renderRunnersMarkdown, type RunnerDigest } from './runners.ts';
import { SNAPSHOT_TABLE, TABLES, addDays, dayBounds, dayPath, isDay, statePath } from './tables.ts';

const log = logger('archive');

export type DayManifest = {
  schema: 'pulse.archive-day/1';
  day: string;
  files: Record<string, { rows?: number; bytes: number; sha256: string }>;
  runners: DigestCounts;
  brief: boolean;
};
type DigestCounts = RunnerDigest['counts'];

export const yesterdayUtc = (now = new Date()) => addDays(now.toISOString().slice(0, 10), -1);

export function archivedDays(root: string): string[] {
  const dir = join(root, 'manifests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) => f.replace(/\.json$/, '')).filter(isDay).sort();
}

function recentSectors(root: string, before: string, n = 7): SectorHistory {
  const out: SectorHistory = [];
  for (const day of archivedDays(root).filter((d) => d < before).slice(-n)) {
    const p = join(root, 'runners', `${day}.json`);
    if (existsSync(p)) out.push({ day, sectors: (JSON.parse(readFileSync(p, 'utf8')) as RunnerDigest).sectors.slice(0, 8) });
  }
  return out;
}

async function exportSnapshots(root: string, day: string, runnerKeys: string[]) {
  const [start, end] = dayBounds(day);
  const rows = await (await db()).query<Row>(
    `select * from (
       select s.*, row_number() over (partition by chain, address, date_trunc('hour', ts) order by ts desc) as rn
       from token_snapshots s where ts >= $1 and ts < $2
     ) x where rn = 1 or (chain || ':' || address) = any($3::text[]) order by ts, chain, address`,
    [start, end, runnerKeys],
  );
  for (const r of rows) delete r.rn;
  return { rows, ...writeJsonlGz(join(root, dayPath(SNAPSHOT_TABLE.table, day)), rows) };
}

/** Export one UTC day into `root`. Pure file output; git is handled by the caller. */
export async function exportDay(root: string, day: string, opts: { brief?: boolean } = {}): Promise<DayManifest> {
  if (!isDay(day)) throw new Error(`invalid day: ${day}`);
  const [start, end] = dayBounds(day);
  const d = await db();
  const files: DayManifest['files'] = {};

  const digest = await buildRunnerDigest(day);
  const runnerKeys = digest.runners.filter((r) => r.kind === 'runner').map((r) => `${r.chain}:${r.address}`);
  const snaps = await exportSnapshots(root, day, runnerKeys);
  files[dayPath(SNAPSHOT_TABLE.table, day)] = { rows: snaps.rows.length, bytes: snaps.bytes, sha256: snaps.sha };

  for (const spec of TABLES) {
    const path = spec.mode === 'daily' ? dayPath(spec.table, day) : statePath(spec.table);
    const rows = await d.query<Row>(`select * from ${spec.table} ${spec.mode === 'daily' ? `where ${spec.where}` : ''} order by ${spec.orderBy}`, spec.mode === 'daily' ? [start, end] : []);
    const w = writeJsonlGz(join(root, path), rows);
    files[path] = { rows: rows.length, bytes: w.bytes, sha256: w.sha };
  }

  const [report] = await d.query<{ data: unknown; markdown: string }>(`select data, markdown from daily_reports where day = $1`, [day]);
  if (report) {
    const a = writeIfChanged(join(root, 'reports', `${day}.md`), report.markdown);
    const b = writeIfChanged(join(root, 'reports', `${day}.json`), JSON.stringify(report.data, null, 1) + '\n');
    files[`reports/${day}.md`] = { bytes: a.bytes, sha256: a.sha };
    files[`reports/${day}.json`] = { bytes: b.bytes, sha256: b.sha };
  }

  const json = writeIfChanged(join(root, 'runners', `${day}.json`), JSON.stringify(digest, null, 1) + '\n');
  const md = writeIfChanged(join(root, 'runners', `${day}.md`), renderRunnersMarkdown(digest));
  files[`runners/${day}.json`] = { bytes: json.bytes, sha256: json.sha };
  files[`runners/${day}.md`] = { bytes: md.bytes, sha256: md.sha };

  const briefPath = join(root, 'briefs', `${day}.md`);
  let brief = existsSync(briefPath);
  if (!brief && opts.brief !== false) {
    const text = await writeBrief(digest, recentSectors(root, day));
    if (text) {
      const b = writeIfChanged(briefPath, `# Brief, ${day}\n\n${text}\n`);
      files[`briefs/${day}.md`] = { bytes: b.bytes, sha256: b.sha };
      brief = true;
    }
  }

  const manifest: DayManifest = { schema: 'pulse.archive-day/1', day, files, runners: digest.counts, brief };
  mkdirSync(join(root, 'manifests'), { recursive: true });
  writeFileSync(join(root, 'manifests', `${day}.json`), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

const README = `# Pulse archive

Permanent, git-versioned history of the Solana and Robinhood Chain trenches, written daily by [Pulse](https://github.com/nirholas/pulse). Everything is UTC.

| Path | Contents |
|---|---|
| \`runners/YYYY-MM-DD.json\` | The day's runners and breakouts with rules, scores and a sector rollup. Start here. |
| \`runners/YYYY-MM-DD.md\` | The same digest as a table. |
| \`briefs/YYYY-MM-DD.md\` | AI brief on what ran, tech worth studying, sector shifts and build signals. |
| \`reports/YYYY-MM-DD.{md,json}\` | The daily newsletter. |
| \`daily/<table>/YYYY/MM/YYYY-MM-DD.jsonl.gz\` | Raw rows. \`token_snapshots\` is hourly for every token and full resolution for runners. \`tokens\` and \`wallet_positions\` hold the rows that changed that day. |
| \`state/<table>.jsonl.gz\` | Current \`wallets\` and \`wallet_scores\`. |
| \`manifests/YYYY-MM-DD.json\` | Row counts and sha256 for every file of the day. |
| \`LATEST.md\` | The most recent digest and brief. |

Read a file: \`zcat daily/trades/2026/10/2026-10-10.jsonl.gz | head\`. Rebuild a database: \`npm run archive:restore -- --from <this repo>\` in Pulse.
`;

function writeIndexes(root: string): void {
  const days = archivedDays(root);
  writeIfChanged(join(root, 'README.md'), README);
  writeIfChanged(join(root, 'INDEX.json'), JSON.stringify({ schema: 'pulse.archive-index/1', days, latest: days.at(-1) ?? null }, null, 1) + '\n');
  const latest = days.at(-1);
  if (!latest) return;
  const parts = [`# Latest: ${latest}`];
  for (const p of [`briefs/${latest}.md`, `runners/${latest}.md`]) if (existsSync(join(root, p))) parts.push(readFileSync(join(root, p), 'utf8'));
  writeIfChanged(join(root, 'LATEST.md'), parts.join('\n\n'));
}

export function target(): GitTarget {
  return { dir: config.archiveDir, repo: config.archiveRepo, token: config.archiveToken, branch: config.archiveBranch };
}

async function firstDataDay(): Promise<string | null> {
  const [row] = await (await db()).query<{ day: string | null }>(`select to_char(min(ts) at time zone 'UTC', 'YYYY-MM-DD') as day from token_snapshots`);
  return row?.day ?? null;
}

export type ArchiveResult = { days: string[]; committed: number; pushed: boolean };

/** Export every finished UTC day the repo does not have yet, commit one per day, push once. */
export async function archivePending(opts: { days?: string[]; push?: boolean; brief?: boolean; now?: Date } = {}): Promise<ArchiveResult> {
  const t = target();
  if (!t.repo) throw new Error('ARCHIVE_REPO is not set. Create a private repo (gh repo create <you>/pulse-data --private) and set ARCHIVE_REPO=https://github.com/<you>/pulse-data.git');
  await openArchive(t);
  const last = yesterdayUtc(opts.now);
  let days = opts.days;
  if (!days) {
    const done = archivedDays(t.dir);
    const first = done.length ? addDays(done.at(-1)!, 1) : await firstDataDay();
    days = [];
    if (first) {
      const floor = done.length ? first : [first, addDays(last, -(config.archiveBackfillDays - 1))].sort().at(-1)!;
      for (let day = floor; day <= last; day = addDays(day, 1)) days.push(day);
    }
  }
  let committed = 0;
  for (const day of days) {
    const m = await exportDay(t.dir, day, { brief: opts.brief });
    writeIndexes(t.dir);
    const rows = Object.values(m.files).reduce((s, f) => s + (f.rows ?? 0), 0);
    const msg = `data(${day}): ${m.runners.runners} runners, ${m.runners.breakouts} breakouts, ${m.runners.tech} tech; ${rows.toLocaleString('en-US')} rows${m.brief ? ', AI brief' : ''}`;
    if (await commitAll(t, msg)) committed++;
    log.info(msg);
  }
  let pushed = false;
  if (committed && opts.push !== false) {
    await pushArchive(t);
    pushed = true;
    log.info(`pushed ${committed} commit(s) to ${t.branch}`);
  }
  return { days, committed, pushed };
}

let inFlight = false;
let lastTry = 0;

/** Scheduler hook: cheap when nothing is due, never throws, never blocks the collection loop. */
export function archiveIfDue(): void {
  if (!config.archiveRepo || inFlight || Date.now() - lastTry < 3_600_000) return;
  lastTry = Date.now();
  inFlight = true;
  archivePending()
    .catch((err) => log.error(`archive failed, will retry within the hour: ${(err as Error).message}`))
    .finally(() => {
      inFlight = false;
    });
}
