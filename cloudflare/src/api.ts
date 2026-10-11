// Dashboard API on D1. Same routes and response shapes as src/server/app.ts so
// the dashboard needs no changes; the SQL is the sqlite dialect and JSON
// columns are parsed on the way out.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { STATUS_RULES } from '../../src/intel/status.ts';
import { geckoOhlcv } from '../../src/sources/geckoterminal.ts';
import { pumpCoin } from '../../src/sources/pumpfun.ts';
import { DAY, HOUR, ago, hydrate, one, query } from './db.ts';
import type { FirehoseStatus } from './firehose.ts';
import { mountMarketIntel } from './market-intel.ts';

export interface StreamPort {
  status(): Promise<FirehoseStatus>;
  heat(mint: string): Promise<unknown>;
}

const SORTS: Record<string, string> = {
  mcap: 'last_mcap desc nulls last',
  volume: 'last_volume_24h desc nulls last',
  change: 'last_change_24h desc nulls last',
  new: 'first_seen desc',
  tech: 'tech_score desc, last_volume_24h desc nulls last',
  holders: 'last_holders desc nulls last',
  ath: 'ath_mcap desc nulls last',
};

const TOKEN_COLS = `chain, address, symbol, name, image, category, tech_score, status, launchpad, last_price, last_mcap, last_liquidity, last_volume_24h, last_holders, last_change_24h, ath_mcap, ath_at, first_mcap, first_seen, created_at, graduated_at, died_at, status_changed_at`;

const clampInt = (v: string | undefined, def: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) && v ? Math.floor(Number(v)) : def));

export function createApi(stream: () => StreamPort): Hono {
  const app = new Hono();
  app.use('/api/*', cors());
  app.onError((err, c) => c.json({ error: 'internal error', detail: err.message }, 500));

  const live = async (): Promise<FirehoseStatus | null> => {
    try {
      return await stream().status();
    } catch {
      return null;
    }
  };

  app.get('/api/health', async (c) => {
    const last = await one<{ value: string }>(`select value from kv where key = 'collector:last-cycle'`);
    const s = await live();
    return c.json({ ok: true, db: 'd1', lastCycle: last ? (JSON.parse(last.value) as { at: string }).at : null, stream: s?.stats ?? null, prices: s?.prices ?? null, running: s?.running ?? false, lastError: s?.lastError ?? null });
  });

  app.get('/api/overview', async (c) => {
    const [markets, series, status, categories, launches, s] = await Promise.all([
      query(`select m.* from market_snapshots m where m.ts = (select max(ts) from market_snapshots where chain = m.chain)`).then((r) => hydrate(r, ['data'])),
      query(`select ts, chain, total_mcap, total_volume_24h, launches_1h, graduations_1h, stream_trades_1h, stream_volume_1h, native_usd from market_snapshots where ts >= ? order by ts`, [ago(7 * DAY)]),
      query(`select chain, status, count(*) as tokens, coalesce(sum(last_mcap), 0) as mcap from tokens group by chain, status`),
      query(
        `select category, count(*) as tokens, coalesce(sum(last_volume_24h), 0) as volume_24h, coalesce(sum(last_mcap), 0) as mcap, avg(last_change_24h) as avg_change_24h
           from tokens where last_snapshot_at >= ? and last_mcap >= 25000 and last_mcap < 1000000000 group by category order by volume_24h desc`,
        [ago(2 * HOUR)],
      ),
      query(
        `select strftime('%Y-%m-%dT%H:00:00.000Z', ts) as hour, chain, sum(kind = 'launch') as launches, sum(kind = 'graduation') as graduations
           from launch_events where ts >= ? group by 1, 2 order by 1`,
        [ago(48 * HOUR)],
      ),
      live(),
    ]);
    return c.json({ markets, series, status, categories, launches, hot: s?.hot ?? [], stream: s?.stats ?? null, prices: s?.prices ?? { solUsd: 0, ethUsd: 0 }, rules: STATUS_RULES });
  });

  app.get('/api/tokens', async (c) => {
    const q = c.req.query();
    const where: string[] = [];
    const params: (string | number)[] = [];
    const add = (sql: string, v: string | number) => {
      params.push(v);
      where.push(sql.replace('?', `?${params.length}`));
    };
    if (q.chain) add('chain = ?', q.chain);
    if (q.status) add('status = ?', q.status);
    if (q.category) add('category = ?', q.category);
    if (q.launchpad) add('launchpad = ?', q.launchpad);
    if (q.tech === '1') where.push(`tech_score >= 0.6 and category not in ('meme', 'animal', 'culture', 'politics', 'celebrity', 'unclassified')`);
    if (q.minMcap) add('last_mcap >= ?', Number(q.minMcap) || 0);
    if (q.minVolume) add('last_volume_24h >= ?', Number(q.minVolume) || 0);
    if (q.q) {
      params.push(`%${q.q.toLowerCase()}%`);
      const n = params.length;
      where.push(`(lower(symbol) like ?${n} or lower(name) like ?${n} or lower(address) like ?${n})`);
    }
    const clause = where.length ? `where ${where.join(' and ')}` : '';
    const order = SORTS[q.sort ?? 'volume'] ?? SORTS.volume!;
    const limit = clampInt(q.limit, 50, 1, 200);
    const offset = clampInt(q.offset, 0, 0, 100_000);
    const [rows, total] = await Promise.all([
      query(`select ${TOKEN_COLS} from tokens ${clause} order by ${order} limit ${limit} offset ${offset}`, params),
      one<{ n: number }>(`select count(*) as n from tokens ${clause}`, params),
    ]);
    return c.json({ total: total?.n ?? 0, rows });
  });

  app.get('/api/tokens/:chain/:address', async (c) => {
    const { chain, address } = c.req.param();
    const token = await one(`select * from tokens where chain = ?1 and address = ?2`, [chain, address]);
    if (!token) return c.json({ error: 'token not found' }, 404);
    const [pairs, snapshots, lists, events, trades, positions] = await Promise.all([
      query(`select * from pairs where chain = ?1 and token_address = ?2 order by created_at desc nulls last`, [chain, address]).then((r) => hydrate(r, ['labels'])),
      query(`select ts, price_usd, mcap, liquidity, vol_1h, vol_24h, holders, buys_24h, sells_24h, traders_24h, organic_score, top_holders_pct from token_snapshots where chain = ?1 and address = ?2 order by ts desc limit 1500`, [chain, address]),
      query(`select list, min(rank) as best_rank, count(*) as appearances, min(ts) as first_ts, max(ts) as last_ts from list_appearances where chain = ?1 and address = ?2 group by list order by appearances desc`, [chain, address]),
      query(`select ts, kind, launchpad, actor, tx from launch_events where chain = ?1 and token = ?2 order by ts`, [chain, address]),
      query(
        `select t.ts, t.wallet, t.side, t.quote_amount, t.mcap_usd, t.reason, w.label, w.kind from trades t left join wallets w on w.chain = t.chain and w.address = t.wallet
          where t.chain = ?1 and t.token = ?2 order by t.ts desc limit 100`,
        [chain, address],
      ),
      query(
        `select p.wallet, p.first_buy_at, p.first_buy_mcap_usd, p.bought_quote, p.sold_quote, w.label, w.kind from wallet_positions p left join wallets w on w.chain = p.chain and w.address = p.wallet
          where p.chain = ?1 and p.token = ?2 order by p.bought_quote desc limit 25`,
        [chain, address],
      ),
    ]);
    const heat = chain === 'solana' ? await stream().heat(address).catch(() => null) : null;
    return c.json({ token: hydrate([token], ['tags', 'categories'])[0], pairs, snapshots: snapshots.reverse(), lists, events, trades, positions, heat });
  });

  app.get('/api/tokens/:chain/:address/candles', async (c) => {
    const { chain, address } = c.req.param();
    const tf = (c.req.query('tf') ?? '15m') as '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    const map = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] } as const;
    const [unit, agg] = map[tf] ?? map['15m'];
    const pair = await one<{ address: string }>(`select address from pairs where chain = ?1 and token_address = ?2 order by created_at desc nulls last limit 1`, [chain, address]);
    let geckoError: string | undefined;
    if (pair) {
      try {
        const candles = await geckoOhlcv(chain === 'solana' ? 'solana' : 'robinhood', pair.address, unit, agg, 300);
        if (candles.length) return c.json({ candles, source: 'geckoterminal', pool: pair.address });
      } catch (err) {
        geckoError = (err as Error).message;
      }
    }
    let pool = pair?.address ?? null;
    if (!pool && chain === 'solana') {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(10_000) });
        const body = (await res.json()) as { pairs?: { chainId: string; pairAddress: string; liquidity?: { usd?: number } }[] };
        pool = (body.pairs ?? []).filter((x) => x.chainId === 'solana').sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0]?.pairAddress ?? null;
      } catch (err) {
        geckoError = `${geckoError ? `${geckoError}; ` : ''}${(err as Error).message}`;
      }
    }
    return c.json({ candles: [], source: 'none', pool, error: geckoError });
  });

  app.get('/api/pump/:mint', async (c) => c.json((await pumpCoin(c.req.param('mint'))) ?? { error: 'not found' }));

  app.get('/api/launches', async (c) => {
    const limit = clampInt(c.req.query('limit'), 100, 1, 500);
    const rows = await query(
      `select e.ts, e.chain, e.kind, e.token, e.launchpad, e.actor, e.name, e.symbol, t.last_mcap, t.last_volume_24h, t.status
         from launch_events e left join tokens t on t.chain = e.chain and t.address = e.token
        where (?1 is null or e.chain = ?1) and (?2 is null or e.kind = ?2) order by e.ts desc limit ${limit}`,
      [c.req.query('chain') ?? null, c.req.query('kind') ?? null],
    );
    return c.json({ rows });
  });

  app.get('/api/wallets', async (c) => {
    const rows = await query(
      `select w.chain, w.address, w.label, w.kind, w.source, w.twitter, s.score, s.win_rate, s.tokens_traded, s.early_hits, s.best_multiple, s.pnl_usd,
              (select count(*) from trades t where t.chain = w.chain and t.wallet = w.address and t.ts >= ?2) as trades_24h
         from wallets w left join wallet_scores s on s.chain = w.chain and s.wallet = w.address where (?1 is null or w.kind = ?1)
        order by s.score desc nulls last, trades_24h desc limit 200`,
      [c.req.query('kind') ?? null, ago(DAY)],
    );
    return c.json({ rows });
  });

  app.get('/api/wallets/:address', async (c) => {
    const address = c.req.param('address');
    const [wallet, positions, trades] = await Promise.all([
      one(`select w.*, s.score, s.win_rate, s.tokens_traded, s.early_hits, s.best_multiple, s.pnl_usd from wallets w left join wallet_scores s on s.chain = w.chain and s.wallet = w.address where w.address = ?1`, [address]),
      query(`select p.*, t.symbol, t.last_mcap, t.status from wallet_positions p left join tokens t on t.chain = p.chain and t.address = p.token where p.wallet = ?1 order by p.last_trade_at desc limit 100`, [address]),
      query(`select t.*, k.symbol from trades t left join tokens k on k.chain = t.chain and k.address = t.token where t.wallet = ?1 order by t.ts desc limit 100`, [address]),
    ]);
    return c.json({ wallet: wallet ? hydrate([wallet], ['meta'])[0] : null, positions, trades });
  });

  app.get('/api/reports', async (c) => c.json({ rows: await query(`select day, generated_at, telegram is not null as sent from daily_reports order by day desc limit 120`) }));
  app.get('/api/reports/:day', async (c) => {
    const row = await one(`select day, generated_at, data, markdown, html, telegram from daily_reports where day = ?1`, [c.req.param('day')]);
    return row ? c.json(hydrate([row], ['data'])[0]) : c.json({ error: 'no report for that day' }, 404);
  });

  app.get('/api/export/:table', async (c) => {
    const allowed = ['tokens', 'token_snapshots', 'trades', 'launch_events', 'wallets', 'wallet_scores', 'wallet_positions', 'market_snapshots', 'list_appearances'];
    const table = c.req.param('table');
    if (!allowed.includes(table)) return c.json({ error: `table must be one of ${allowed.join(', ')}` }, 400);
    const limit = clampInt(c.req.query('limit'), 10_000, 1, 100_000);
    return c.json({ table, rows: await query(`select * from ${table} limit ${limit}`) });
  });

  mountMarketIntel(app);

  return app;
}
