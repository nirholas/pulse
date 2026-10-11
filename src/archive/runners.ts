// Runner detection for one UTC day, computed from that day's snapshots rather
// than the token's current state, so the same digest can be rebuilt for any
// archived day. A runner is a token that multiplied from its day-open market
// cap with real volume behind it, or a fresh launch that reached size fast.
import { db } from '../db/client.ts';
import { dayBounds } from './tables.ts';

export const RUNNER_RULES = {
  runner: 'peak market cap at least $100k, peak liquidity at least $5k, peak 24h volume at least $50k, and the peak at least 2x the first market cap seen that day',
  breakout: 'created within 48h of the day, peak market cap at least $250k and peak 24h volume at least $100k, even without a 2x from the day open',
  excluded: 'stablecoins, liquid staking tokens, wrapped assets and tokenized equities; anything above $1B market cap',
  score: 'ln(multiple) * 40 + ln(peak volume / $10k) * 8 + tracked-wallet buyers * 5 + discovery lists * 2, plus 10 for a tech sector with a tech score of 0.6 or more',
} as const;

const TECH_EXCLUDED = new Set(['meme', 'animal', 'culture', 'politics', 'celebrity', 'unclassified']);

export type RunnerRow = {
  chain: string;
  address: string;
  symbol: string | null;
  name: string | null;
  description: string | null;
  website: string | null;
  twitter: string | null;
  launchpad: string | null;
  category: string;
  tech_score: number;
  status: string;
  created_at: string | null;
  first_seen: string;
  open_mcap: number | null;
  close_mcap: number | null;
  peak_mcap: number;
  peak_vol_24h: number | null;
  peak_liq: number | null;
  open_holders: number | null;
  close_holders: number | null;
  lists: number;
  wallet_buyers: number;
  wallet_kinds: string[] | null;
};

export type Runner = {
  chain: string;
  address: string;
  symbol: string | null;
  name: string | null;
  description: string | null;
  website: string | null;
  twitter: string | null;
  launchpad: string | null;
  category: string;
  techScore: number;
  isTech: boolean;
  status: string;
  kind: 'runner' | 'breakout';
  ageHours: number | null;
  openMcap: number | null;
  peakMcap: number;
  closeMcap: number | null;
  multiple: number | null;
  closeVsOpen: number | null;
  peakVolume24h: number | null;
  peakLiquidity: number | null;
  holdersOpen: number | null;
  holdersClose: number | null;
  discoveryLists: number;
  trackedWalletBuyers: number;
  walletKinds: string[];
  score: number;
};

export type SectorRollup = { category: string; isTech: boolean; runners: number; peakVolume24h: number; medianMultiple: number | null; symbols: string[] };

export type RunnerDigest = {
  schema: 'pulse.runners/1';
  day: string;
  rules: typeof RUNNER_RULES;
  counts: { runners: number; breakouts: number; tech: number };
  runners: Runner[];
  sectors: SectorRollup[];
};

const num = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/** Pure: turn aggregated day rows into ranked runners. Exported for tests. */
export function detectRunners(rows: RunnerRow[], dayEnd: Date): Runner[] {
  const out: Runner[] = [];
  for (const r of rows) {
    const open = num(r.open_mcap);
    const peak = Number(r.peak_mcap);
    const vol = num(r.peak_vol_24h);
    const liq = num(r.peak_liq);
    if (!(peak >= 100_000) || peak >= 1_000_000_000 || !((liq ?? 0) >= 5_000)) continue;
    const created = Date.parse(r.created_at ?? r.first_seen);
    const ageHours = Number.isFinite(created) ? (dayEnd.getTime() - created) / 3_600_000 : null;
    const multiple = open && open > 0 ? peak / open : null;
    const isRunner = (multiple ?? 0) >= 2 && (vol ?? 0) >= 50_000;
    const isBreakout = !isRunner && ageHours !== null && ageHours <= 72 && peak >= 250_000 && (vol ?? 0) >= 100_000;
    if (!isRunner && !isBreakout) continue;
    const techScore = Number(r.tech_score) || 0;
    const isTech = techScore >= 0.6 && !TECH_EXCLUDED.has(r.category);
    const buyers = Number(r.wallet_buyers) || 0;
    const lists = Number(r.lists) || 0;
    const score =
      Math.log(Math.max(multiple ?? peak / 100_000, 1)) * 40 +
      Math.log(Math.max((vol ?? 10_000) / 10_000, 1)) * 8 +
      buyers * 5 +
      lists * 2 +
      (isTech ? 10 : 0);
    out.push({
      chain: r.chain, address: r.address, symbol: r.symbol, name: r.name,
      description: r.description ? r.description.slice(0, 280) : null,
      website: r.website, twitter: r.twitter, launchpad: r.launchpad, category: r.category,
      techScore, isTech, status: r.status, kind: isRunner ? 'runner' : 'breakout',
      ageHours: ageHours === null ? null : Math.round(ageHours),
      openMcap: open, peakMcap: peak, closeMcap: num(r.close_mcap),
      multiple: multiple === null ? null : Math.round(multiple * 100) / 100,
      closeVsOpen: open && open > 0 && num(r.close_mcap) !== null ? Math.round((Number(r.close_mcap) / open) * 100) / 100 : null,
      peakVolume24h: vol, peakLiquidity: liq, holdersOpen: num(r.open_holders), holdersClose: num(r.close_holders),
      discoveryLists: lists, trackedWalletBuyers: buyers, walletKinds: r.wallet_kinds ?? [],
      score: Math.round(score * 10) / 10,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function rollupSectors(runners: Runner[]): SectorRollup[] {
  const by = new Map<string, Runner[]>();
  for (const r of runners) by.set(r.category, [...(by.get(r.category) ?? []), r]);
  return [...by.entries()]
    .map(([category, rs]) => {
      const mults = rs.map((r) => r.multiple).filter((m): m is number => m !== null).sort((a, b) => a - b);
      return {
        category,
        isTech: rs.some((r) => r.isTech),
        runners: rs.length,
        peakVolume24h: Math.round(rs.reduce((s, r) => s + (r.peakVolume24h ?? 0), 0)),
        medianMultiple: mults.length ? mults[Math.floor(mults.length / 2)]! : null,
        symbols: rs.slice(0, 6).map((r) => r.symbol ?? r.address.slice(0, 6)),
      };
    })
    .sort((a, b) => b.peakVolume24h - a.peakVolume24h);
}

export async function buildRunnerDigest(day: string, limit = 60): Promise<RunnerDigest> {
  const [start, end] = dayBounds(day);
  const rows = await (await db()).query<RunnerRow>(
    `with s as (
       select chain, address,
         (array_agg(mcap order by ts asc) filter (where mcap > 0))[1] as open_mcap,
         (array_agg(mcap order by ts desc) filter (where mcap > 0))[1] as close_mcap,
         max(mcap) as peak_mcap, max(vol_24h) as peak_vol_24h, max(liquidity) as peak_liq,
         (array_agg(holders order by ts asc) filter (where holders > 0))[1] as open_holders,
         (array_agg(holders order by ts desc) filter (where holders > 0))[1] as close_holders
       from token_snapshots where ts >= $1 and ts < $2 group by chain, address
     )
     select s.chain, s.address, t.symbol, t.name, t.description, t.website, t.twitter, t.launchpad, t.category, t.tech_score, t.status,
       t.created_at, t.first_seen, s.open_mcap, s.close_mcap, s.peak_mcap, s.peak_vol_24h, s.peak_liq, s.open_holders, s.close_holders,
       (select count(distinct a.list)::int from list_appearances a where a.chain = s.chain and a.address = s.address and a.ts >= $1 and a.ts < $2) as lists,
       (select count(distinct tr.wallet)::int from trades tr join wallets w on w.chain = tr.chain and w.address = tr.wallet
          where tr.chain = s.chain and tr.token = s.address and tr.side = 'buy' and tr.ts >= $1 and tr.ts < $2) as wallet_buyers,
       (select array_agg(distinct w.kind) from trades tr join wallets w on w.chain = tr.chain and w.address = tr.wallet
          where tr.chain = s.chain and tr.token = s.address and tr.side = 'buy' and tr.ts >= $1 and tr.ts < $2) as wallet_kinds
     from s join tokens t on t.chain = s.chain and t.address = s.address
     where s.peak_mcap >= 100000 and s.peak_mcap < 1000000000 and coalesce(s.peak_liq, 0) >= 5000
       and not (t.tags && array['stablecoin', 'lst', 'equities', 'xstocks', 'wrapped'])`,
    [start, end],
  );
  const runners = detectRunners(rows, end).slice(0, limit);
  return {
    schema: 'pulse.runners/1',
    day,
    rules: RUNNER_RULES,
    counts: { runners: runners.filter((r) => r.kind === 'runner').length, breakouts: runners.filter((r) => r.kind === 'breakout').length, tech: runners.filter((r) => r.isTech).length },
    runners,
    sectors: rollupSectors(runners),
  };
}

const usd = (n: number | null) => (n === null ? 'n/a' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`);

export function renderRunnersMarkdown(d: RunnerDigest): string {
  const lines = [`# Runners, ${d.day}`, '', `${d.counts.runners} runners, ${d.counts.breakouts} breakouts, ${d.counts.tech} in a tech sector. Rules: ${d.rules.runner}.`, ''];
  lines.push('| # | Token | Chain | Sector | Open | Peak | x | Peak vol | Wallets | Score |', '|---|---|---|---|---|---|---|---|---|---|');
  d.runners.forEach((r, i) => {
    const tag = r.isTech ? ' (tech)' : '';
    lines.push(`| ${i + 1} | ${(r.symbol ?? r.address.slice(0, 6)).replace(/[|\n]/g, ' ')}${r.kind === 'breakout' ? ' (breakout)' : ''} | ${r.chain} | ${r.category}${tag} | ${usd(r.openMcap)} | ${usd(r.peakMcap)} | ${r.multiple ?? 'n/a'} | ${usd(r.peakVolume24h)} | ${r.trackedWalletBuyers} | ${r.score} |`);
  });
  lines.push('', '## Sectors', '', '| Sector | Runners | Peak volume | Median x | Tokens |', '|---|---|---|---|---|');
  for (const s of d.sectors) lines.push(`| ${s.category}${s.isTech ? ' (tech)' : ''} | ${s.runners} | ${usd(s.peakVolume24h)} | ${s.medianMultiple ?? 'n/a'} | ${s.symbols.join(', ').replace(/[|\n]/g, ' ')} |`);
  return lines.join('\n') + '\n';
}
