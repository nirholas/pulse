// The collection cycle on D1. Mirrors src/collector/scheduler.ts: pull every
// discovery list, re-snapshot tokens still worth watching, walk Robinhood
// launches, write chain-wide aggregates, run the intel passes. The source
// clients are the shared ones; only persistence differs.
import { logger } from '../../src/lib/log.ts';
import { chunk, mapLimit } from '../../src/lib/http.ts';
import { JUP_LISTS, JUP_WINDOWS, jupList, jupLookup, jupRecent, solUsd } from '../../src/sources/jupiter.ts';
import { dexPromoted, dexTokens, ethUsd } from '../../src/sources/dexscreener.ts';
import { pumpActive, pumpCurveLeaders, pumpLive } from '../../src/sources/pumpfun.ts';
import { geckoNewPools, geckoTrending } from '../../src/sources/geckoterminal.ts';
import type { Chain, Observation } from '../../src/sources/types.ts';
import { robinhoodObservations, walkRobinhoodLaunches } from '../../src/collector/robinhood-walker.ts';
import type { SolanaStream } from '../../src/collector/solana-stream.ts';
import { HOUR, ago, insertMany, kvGet, kvSet, query } from './db.ts';
import { tokensNeedingRefresh, upsertTokens } from './store.ts';
import { classifyPending, importWallets, scoreWallets, updateStatuses } from './intel.ts';

const log = logger('collector');

export type CycleResult = { tokens: number; solana: number; robinhood: number; failures: number; transitions: number; ms: number };
export const prices = { solUsd: 0, ethUsd: 0 };

type Task = { name: string; run: () => Promise<Observation[]> };

function solanaDiscoveryTasks(): Task[] {
  const tasks: Task[] = [];
  for (const list of JUP_LISTS) for (const window of JUP_WINDOWS) tasks.push({ name: `jup:${list}:${window}`, run: () => jupList(list, window) });
  tasks.push({ name: 'jup:recent', run: () => jupRecent() });
  tasks.push({ name: 'pump:curve-leaders', run: pumpCurveLeaders });
  tasks.push({ name: 'pump:live', run: pumpLive });
  tasks.push({ name: 'pump:active', run: pumpActive });
  tasks.push({ name: 'gecko:trending', run: geckoTrending });
  tasks.push({ name: 'gecko:new-pools', run: geckoNewPools });
  return tasks;
}

async function promotedObservations(): Promise<Observation[]> {
  const promoted = await dexPromoted();
  const byChain = new Map<Chain, typeof promoted>();
  for (const p of promoted) byChain.set(p.chain, [...(byChain.get(p.chain) ?? []), p]);
  const out: Observation[] = [];
  for (const [chain, items] of byChain) {
    const addresses = [...new Set(items.map((i) => i.address))];
    const { ok } = await mapLimit(chunk(addresses, 30), 2, (batch) => dexTokens(chain, batch));
    const byAddr = new Map(ok.flat().map((o) => [o.meta.address, o]));
    for (const i of items) {
      const obs = byAddr.get(i.address);
      if (obs) out.push({ ...obs, list: { name: i.list, rank: i.rank }, meta: { ...obs.meta, description: obs.meta.description ?? i.description } });
    }
  }
  return out;
}

export async function refreshPrices(): Promise<void> {
  const [s, e] = await Promise.allSettled([solUsd(), ethUsd()]);
  if (s.status === 'fulfilled' && s.value) prices.solUsd = s.value;
  if (e.status === 'fulfilled' && e.value) prices.ethUsd = e.value;
}

export async function collectCycle(stream: SolanaStream | null): Promise<CycleResult> {
  const started = Date.now();
  const ts = new Date();
  await refreshPrices();
  if (stream) stream.solUsd = prices.solUsd;

  const observations: Observation[] = [];
  let failures = 0;
  const discovery = await mapLimit(solanaDiscoveryTasks(), 4, async (t) => {
    try {
      return await t.run();
    } catch (err) {
      failures++;
      log.warn(`${t.name}: ${(err as Error).message}`);
      return [] as Observation[];
    }
  });
  for (const batch of discovery.ok) observations.push(...batch);

  try {
    observations.push(...(await promotedObservations()));
  } catch (err) {
    failures++;
    log.warn(`dex promoted: ${(err as Error).message}`);
  }

  const discovered = new Set(observations.filter((o) => o.meta.chain === 'solana').map((o) => o.meta.address));
  const refresh = new Set<string>(await tokensNeedingRefresh('solana', 400));
  for (const h of stream?.hot(150) ?? []) refresh.add(h.mint);
  for (const a of discovered) refresh.delete(a);
  if (refresh.size) {
    try {
      observations.push(...(await jupLookup([...refresh])));
    } catch (err) {
      failures++;
      log.warn(`jup lookup: ${(err as Error).message}`);
    }
  }

  let robinhood = 0;
  try {
    await walkRobinhoodLaunches();
    const rh = await robinhoodObservations();
    robinhood = rh.length;
    observations.push(...rh);
  } catch (err) {
    failures++;
    log.warn(`robinhood: ${(err as Error).message}`);
  }

  const tokens = await upsertTokens(observations, ts);
  const solana = observations.filter((o) => o.meta.chain === 'solana').length;
  await writeMarketSnapshots(ts, stream);
  const transitions = await updateStatuses();
  for (const t of transitions) if (t.to === 'running' && stream) stream.flushEarlyBuyers(t.address, 'early:runner');
  await classifyPending();
  await kvSet('collector:last-cycle', { at: ts.toISOString(), tokens, failures });

  const result = { tokens, solana, robinhood, failures, transitions: transitions.length, ms: Date.now() - started };
  log.info(`cycle: ${tokens} tokens (${solana} solana obs, ${robinhood} robinhood obs), ${transitions.length} transitions, ${failures} source failures, ${result.ms}ms`);
  return result;
}

async function writeMarketSnapshots(ts: Date, stream: SolanaStream | null): Promise<void> {
  const rows: unknown[][] = [];
  for (const chain of ['solana', 'robinhood'] as Chain[]) {
    const [agg] = await query<{ tracked: number; mcap: number; vol: number }>(
      `select count(*) as tracked, coalesce(sum(last_mcap), 0) as mcap, coalesce(sum(last_volume_24h), 0) as vol
         from tokens where chain = ? and status <> 'dead' and last_snapshot_at >= ? and last_mcap < 1000000000
          and not exists (select 1 from json_each(tokens.tags) where value in ('stablecoin', 'lst', 'equities', 'xstocks', 'wrapped'))`,
      [chain, ago(2 * HOUR)],
    );
    const [ev] = await query<{ launches: number; grads: number }>(
      `select count(*) filter (where kind = 'launch') as launches, count(*) filter (where kind = 'graduation') as grads from launch_events where chain = ? and ts >= ?`,
      [chain, ago(HOUR)],
    );
    const s = chain === 'solana' ? stream?.stats() : null;
    rows.push([
      ts, chain, chain === 'solana' ? prices.solUsd || null : prices.ethUsd || null, agg?.tracked ?? 0, agg?.mcap ?? 0, agg?.vol ?? 0,
      ev?.launches ?? 0, ev?.grads ?? 0, s?.trades1h ?? null, s?.volume1h ?? null,
      s ? { tradersSeen1h: s.tradersSeen1h, pools1h: s.pools1h, trackedTokens: s.trackedTokens, connected: s.connected } : {},
    ]);
  }
  await insertMany('market_snapshots', ['ts', 'chain', 'native_usd', 'tracked_tokens', 'total_mcap', 'total_volume_24h', 'launches_1h', 'graduations_1h', 'stream_trades_1h', 'stream_volume_1h', 'data'], rows, 'on conflict do nothing');
}

/** Jobs on their own cadence: wallet import daily, scoring hourly. */
export async function periodicJobs(stream: SolanaStream | null, force = false): Promise<void> {
  const now = new Date();
  const lastImport = await kvGet<{ at: string }>('wallets:last-import');
  if (force || !lastImport || Date.now() - Date.parse(lastImport.at) > 24 * HOUR) {
    try {
      await importWallets();
      await kvSet('wallets:last-import', { at: now.toISOString() });
      await stream?.reloadWallets();
    } catch (err) {
      log.warn(`wallet import: ${(err as Error).message}`);
    }
  }
  const lastScore = await kvGet<{ at: string }>('wallets:last-score');
  if (force || !lastScore || Date.now() - Date.parse(lastScore.at) > HOUR) {
    try {
      const n = await scoreWallets(prices.solUsd);
      await kvSet('wallets:last-score', { at: now.toISOString(), wallets: n });
    } catch (err) {
      log.warn(`wallet scoring: ${(err as Error).message}`);
    }
  }
}

