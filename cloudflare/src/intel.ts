// Token lifecycle, classification and wallet scoring against D1. Same rules as
// src/intel (the thresholds come from STATUS_RULES so a status reads the same
// on both stacks); the SQL is sqlite and the arithmetic that needs math
// functions runs in JS.
import { classify, safeClassify } from '../../src/intel/classify.ts';
import { kolQuestWallets, kolscanLeaderboard, type WalletLabel } from '../../src/sources/wallets.ts';
import { logger } from '../../src/lib/log.ts';
import { DAY, ago, batch, insertMany, parseJson, query, type Param } from './db.ts';

const log = logger('intel');
export { classify };

export type StatusChange = { chain: string; address: string; symbol: string | null; from: string; to: string; mcap: number | null; ath: number | null };

export async function updateStatuses(): Promise<StatusChange[]> {
  const now = new Date();
  const rows = await query<StatusChange>(
    `select * from (
       select chain, address, symbol, status as "from", last_mcap as mcap, ath_mcap as ath,
         case
           when (ath_mcap >= 20000 and last_mcap <= ath_mcap * 0.10)
             or (last_liquidity is not null and last_liquidity < 1000 and ath_mcap >= 20000)
             or (last_snapshot_at < ?1 and coalesce(last_volume_24h, 0) < 1000 and status <> 'new')
             then 'dead'
           when (ath_mcap >= 50000 and last_mcap <= ath_mcap * 0.30)
             or (peak_volume_24h >= 100000 and coalesce(last_volume_24h, 0) < peak_volume_24h * 0.10)
             then 'dying'
           when last_mcap >= 100000 and coalesce(last_volume_24h, 0) >= 50000 and ath_at >= ?2 and last_mcap >= ath_mcap * 0.60
             then 'running'
           when graduated_at is not null and status in ('new', 'running') then 'graduated'
           else status
         end as "to"
       from tokens where status <> 'dead' and last_mcap is not null
     ) where "to" <> "from"`,
    [ago(3 * DAY, now.getTime()), ago(DAY, now.getTime())],
  );
  if (!rows.length) return rows;
  await batch(
    rows.map((r): [string, Param[]] => [
      `update tokens set status = ?3, status_changed_at = ?4, died_at = case when ?3 = 'dead' then ?4 else died_at end where chain = ?1 and address = ?2`,
      [r.chain, r.address, r.to, now],
    ]),
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.to] = (counts[r.to] ?? 0) + 1;
  log.info(`status transitions: ${JSON.stringify(counts)}`);
  return rows;
}

export async function classifyPending(limit = 500): Promise<number> {
  const rows = await query<{ chain: string; address: string; name: string | null; symbol: string | null; description: string | null; website: string | null; twitter: string | null; tags: string; verified: number | null }>(
    `select chain, address, name, symbol, description, website, twitter, tags, verified from tokens
      where (category = 'unclassified' and (name is not null or description is not null))
         or classified_at is null or classified_at < datetime(last_seen, '-6 hours')
      order by last_seen desc limit ?`,
    [limit],
  );
  if (!rows.length) return 0;
  const now = new Date();
  await batch(
    rows.map((r): [string, Param[]] => {
      const c = safeClassify({ ...r, tags: parseJson<string[]>(r.tags, []), verified: r.verified == null ? null : Boolean(r.verified) });
      return [`update tokens set category = ?3, categories = ?4, tech_score = ?5, classified_at = ?6 where chain = ?1 and address = ?2`, [r.chain, r.address, c.category, c.categories, c.techScore, now]];
    }),
  );
  return rows.length;
}

export async function importWallets(): Promise<{ kol: number; smart: number }> {
  const results = await Promise.allSettled([kolscanLeaderboard(), kolQuestWallets()]);
  const labels: WalletLabel[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') labels.push(...r.value);
    else log.warn(`wallet source failed: ${(r.reason as Error).message}`);
  }
  if (!labels.length) return { kol: 0, smart: 0 };
  const seen = new Map<string, WalletLabel>();
  for (const l of labels) {
    const prev = seen.get(l.address);
    if (!prev || (prev.kind !== 'kol' && l.kind === 'kol')) seen.set(l.address, l);
  }
  await insertMany(
    'wallets',
    ['chain', 'address', 'label', 'kind', 'source', 'twitter', 'telegram', 'meta', 'updated_at'],
    [...seen.values()].map((l) => [l.chain, l.address, l.label ?? null, l.kind, l.source, l.twitter ?? null, l.telegram ?? null, l.meta ?? {}, new Date()]),
    `on conflict (chain, address) do update set
       label = coalesce(excluded.label, wallets.label),
       kind = case when wallets.kind = 'kol' then wallets.kind else excluded.kind end,
       source = excluded.source, twitter = coalesce(excluded.twitter, wallets.twitter), telegram = coalesce(excluded.telegram, wallets.telegram),
       meta = json_patch(wallets.meta, excluded.meta), updated_at = excluded.updated_at`,
  );
  const kol = [...seen.values()].filter((l) => l.kind === 'kol').length;
  log.info(`imported ${seen.size} wallets (${kol} KOLs)`);
  return { kol, smart: seen.size - kol };
}

/** Score wallets from their last `windowDays` of positions: realized PnL from sells, unrealized from what is still held at the token's last price. */
export async function scoreWallets(solUsd: number, windowDays = 30): Promise<number> {
  const rows = await query<{ wallet: string; tokens_traded: number; wins: number; invested: number; realized: number; unrealized: number; early_hits: number; best_multiple: number | null }>(
    `with pos as (
       select p.wallet, p.bought_quote, p.sold_quote, p.first_buy_mcap_usd, t.ath_mcap,
              case when ?1 > 0 then max(p.bought_tokens - p.sold_tokens, 0) * coalesce(t.last_price, 0) / ?1 else 0 end as unrealized
         from wallet_positions p
         left join tokens t on t.chain = p.chain and t.address = p.token
        where p.chain = 'solana' and p.last_trade_at >= ?2
     )
     select wallet,
            count(*) as tokens_traded,
            count(*) filter (where sold_quote + unrealized > bought_quote) as wins,
            sum(bought_quote) as invested, sum(sold_quote) as realized, sum(unrealized) as unrealized,
            count(*) filter (where first_buy_mcap_usd is not null and first_buy_mcap_usd < 50000 and ath_mcap >= 500000) as early_hits,
            max(case when first_buy_mcap_usd > 0 then ath_mcap / first_buy_mcap_usd end) as best_multiple
       from pos group by wallet`,
    [solUsd || 0, ago(windowDays * DAY)],
  );
  const now = new Date();
  await insertMany(
    'wallet_scores',
    ['chain', 'wallet', 'computed_at', 'window_days', 'tokens_traded', 'wins', 'win_rate', 'invested_quote', 'realized_quote', 'unrealized_quote', 'pnl_quote', 'pnl_usd', 'early_hits', 'best_multiple', 'score'],
    rows.map((r) => {
      const winRate = r.tokens_traded > 0 ? r.wins / r.tokens_traded : 0;
      const pnl = r.realized + r.unrealized - r.invested;
      const score = winRate * 40 + Math.log(1 + Math.max(pnl, 0)) * 15 + Math.min(r.early_hits, 10) * 5 + Math.min(r.tokens_traded, 20);
      return ['solana', r.wallet, now, windowDays, r.tokens_traded, r.wins, winRate, r.invested, r.realized, r.unrealized, pnl, pnl * (solUsd || 0), r.early_hits, r.best_multiple, score];
    }),
    `on conflict (chain, wallet) do update set
       computed_at = excluded.computed_at, window_days = excluded.window_days, tokens_traded = excluded.tokens_traded, wins = excluded.wins,
       win_rate = excluded.win_rate, invested_quote = excluded.invested_quote, realized_quote = excluded.realized_quote,
       unrealized_quote = excluded.unrealized_quote, pnl_quote = excluded.pnl_quote, pnl_usd = excluded.pnl_usd,
       early_hits = excluded.early_hits, best_multiple = excluded.best_multiple, score = excluded.score`,
  );
  const promoted = await query<{ wallet: string; early_hits: number; score: number }>(
    `select s.wallet, s.early_hits, s.score from wallet_scores s
      where s.early_hits >= 3 and s.win_rate >= 0.5 and not exists (select 1 from wallets w where w.chain = s.chain and w.address = s.wallet)`,
  );
  if (promoted.length) {
    await insertMany(
      'wallets',
      ['chain', 'address', 'kind', 'source', 'meta'],
      promoted.map((p) => ['solana', p.wallet, 'smart', 'pulse:discovered', { early_hits: p.early_hits, score: p.score, promoted_at: now.toISOString() }]),
      'on conflict (chain, address) do nothing',
    );
    log.info(`promoted ${promoted.length} wallets to smart money`);
  }
  return rows.length;
}
