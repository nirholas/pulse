// Market intelligence for the whole crypto market, not just the tokens Pulse
// archives. Every route aggregates keyless public upstreams (CoinGecko,
// DefiLlama, alternative.me, Hyperliquid, Polymarket) plus the three.ws
// public intel API, trims the payload to what the dashboard renders and
// caches it (edge cache on Workers, memory on Node) so a busy dashboard costs the upstreams one call per TTL.
import type { Hono } from 'hono';

const THREEWS = 'https://three.ws';
const UA = 'pulse-dashboard/1.0 (+https://github.com/nirholas/pulse)';

async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { accept: 'application/json', 'user-agent': UA, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

const STALE_SEC = 6 * 60 * 60;

/**
 * Edge-cached JSON. Every success is also kept under a long-lived `.stale`
 * key, so a rate-limited or failing upstream serves the last good value
 * instead of an error. Only a cold cache with a failing upstream throws.
 */
const edgeCache = () => (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
const memory = new Map<string, { at: number; ttl: number; body: string }>();

/** Cache backend: the Workers edge cache when present, else process memory (Node server). */
const backend = {
  async get(key: string, stale: boolean): Promise<string | null> {
    const cf = edgeCache();
    if (cf) {
      const hit = await cf.match(new Request(`https://pulse-cache.internal/${key}${stale ? '.stale' : ''}`));
      return hit ? await hit.text() : null;
    }
    const e = memory.get(stale ? `${key}.stale` : key);
    return e && Date.now() - e.at < e.ttl * 1000 ? e.body : null;
  },
  async put(key: string, ttl: number, body: string): Promise<void> {
    const cf = edgeCache();
    if (cf) {
      const headers = (t: number) => ({ 'content-type': 'application/json', 'cache-control': `public, max-age=${t}` });
      await cf.put(new Request(`https://pulse-cache.internal/${key}`), new Response(body, { headers: headers(ttl) }));
      await cf.put(new Request(`https://pulse-cache.internal/${key}.stale`), new Response(body, { headers: headers(STALE_SEC) }));
      return;
    }
    memory.set(key, { at: Date.now(), ttl, body });
    memory.set(`${key}.stale`, { at: Date.now(), ttl: STALE_SEC, body });
  },
};

export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const hit = await backend.get(key, false);
  if (hit) return JSON.parse(hit) as T;
  try {
    const value = await load();
    await backend.put(key, ttlSec, JSON.stringify(value));
    return value;
  } catch (err) {
    const stale = await backend.get(key, true);
    if (stale) return JSON.parse(stale) as T;
    throw err;
  }
}

export const loaders = {
  async global() {
    const [g, fng] = await Promise.all([getJson<any>(`${THREEWS}/api/coin/global`), getJson<any>(`${THREEWS}/api/coin/fear-greed`)]);
    const dom = (sym: string): number | null => g.market.dominance.find((d: { symbol: string }) => d.symbol === sym)?.pct ?? null;
    return {
      activeCoins: g.market.active_coins,
      marketCapUsd: g.market.market_cap_usd,
      volume24hUsd: g.market.volume_24h_usd,
      marketCapChange24h: g.market.market_cap_change_pct_24h,
      btcDominance: dom('BTC'),
      ethDominance: dom('ETH'),
      fearGreed: { value: fng.current.value, label: fng.current.label as string, previousWeek: fng.previous_week?.value ?? null, history: (fng.history as { ts: number; value: number }[]).slice(-30) },
    };
  },

  async markets() {
    const d = await getJson<{ coins: any[] }>(`${THREEWS}/api/coin/markets?per_page=100`);
    return d.coins.map((r) => ({ id: r.id, symbol: r.symbol, name: r.name, image: r.image, rank: r.rank, price: r.price, mcap: r.market_cap, volume24h: r.volume_24h, chg24h: r.change_24h, chg7d: r.change_7d, spark: Array.isArray(r.sparkline) ? r.sparkline.filter((_: unknown, i: number) => i % 4 === 0) : [] }));
  },

  async sectors() {
    const d = await getJson<{ categories: any[] }>(`${THREEWS}/api/coin/categories`);
    return d.categories.filter((c) => c.market_cap > 0).sort((a, b) => b.volume_24h - a.volume_24h).slice(0, 20).map((c) => ({ id: c.id, name: c.name, mcap: c.market_cap, chg24h: c.market_cap_change_24h, volume24h: c.volume_24h }));
  },

  /** Staking protocols (liquid staking, pools, restaking) ranked by TVL, from DefiLlama's protocol index. */
  async staking() {
    const all = await getJson<any[]>('https://api.llama.fi/protocols');
    const CATS = new Set(['Liquid Staking', 'Staking Pool', 'Restaking', 'Liquid Restaking', 'Restaked BTC']);
    const rows = all
      .filter((p) => CATS.has(p.category) && p.tvl > 0)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 40)
      .map((p) => ({ name: p.name, symbol: p.symbol && p.symbol !== '-' ? p.symbol : null, category: p.category, tvl: p.tvl, chg1d: p.change_1d ?? null, chg7d: p.change_7d ?? null, chains: (p.chains ?? []).slice(0, 4), solana: (p.chains ?? []).includes('Solana'), url: p.url ?? null }));
    return { totalTvl: rows.reduce((s, r) => s + r.tvl, 0), protocols: rows };
  },

  async liquidations() {
    const d = await getJson<{ liquidations: any[] }>(`${THREEWS}/api/coin/liquidations`);
    const bySymbol = new Map<string, { symbol: string; longs: number; shorts: number; count: number }>();
    let longs = 0;
    let shorts = 0;
    for (const l of d.liquidations) {
      const row = bySymbol.get(l.symbol) ?? { symbol: l.symbol, longs: 0, shorts: 0, count: 0 };
      if (l.side === 'LONG') (row.longs += l.value), (longs += l.value);
      else (row.shorts += l.value), (shorts += l.value);
      row.count++;
      bySymbol.set(l.symbol, row);
    }
    return {
      longs, shorts, count: d.liquidations.length,
      bySymbol: [...bySymbol.values()].sort((a, b) => b.longs + b.shorts - (a.longs + a.shorts)).slice(0, 12),
      largest: [...d.liquidations].sort((a, b) => b.value - a.value).slice(0, 8).map((l) => ({ exchange: l.exchange, symbol: l.symbol, side: l.side, value: l.value, price: l.price, time: l.time })),
    };
  },

  async defi() {
    const [chains, pools, stables, dexs, fees] = await Promise.all([
      getJson<any[]>('https://api.llama.fi/v2/chains'),
      getJson<{ data: any[] }>('https://yields.llama.fi/pools'),
      getJson<{ peggedAssets: any[] }>('https://stablecoins.llama.fi/stablecoins?includePrices=false'),
      getJson<{ protocols: any[]; total24h: number }>('https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'),
      getJson<{ protocols: any[]; total24h: number }>('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'),
    ]);
    return {
      chains: chains.filter((c) => c.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 20).map((c) => ({ name: c.name, tvl: c.tvl, symbol: c.tokenSymbol })),
      yields: pools.data
        .filter((p) => p.tvlUsd >= 5_000_000 && p.apy > 0 && p.apy < 1000 && !p.outlier)
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 40)
        .map((p) => ({ chain: p.chain, project: p.project, symbol: p.symbol, tvl: p.tvlUsd, apy: p.apy, apyBase: p.apyBase, apyReward: p.apyReward, stable: p.stablecoin, il: p.ilRisk })),
      solanaYields: pools.data
        .filter((p) => p.chain === 'Solana' && p.tvlUsd >= 1_000_000 && p.apy > 0 && p.apy < 1000 && !p.outlier)
        .sort((a, b) => b.tvlUsd - a.tvlUsd)
        .slice(0, 25)
        .map((p) => ({ project: p.project, symbol: p.symbol, tvl: p.tvlUsd, apy: p.apy, stable: p.stablecoin })),
      stablecoins: stables.peggedAssets
        .map((s) => ({ name: s.name, symbol: s.symbol, supply: s.circulating?.peggedUSD ?? 0, change7d: (s.circulating?.peggedUSD ?? 0) - (s.circulatingPrevWeek?.peggedUSD ?? 0) }))
        .sort((a, b) => b.supply - a.supply)
        .slice(0, 12),
      dexVolume24h: dexs.total24h,
      topDexs: dexs.protocols.sort((a, b) => (b.total24h ?? 0) - (a.total24h ?? 0)).slice(0, 12).map((p) => ({ name: p.displayName ?? p.name, volume24h: p.total24h, change1d: p.change_1d, chains: (p.chains ?? []).slice(0, 4) })),
      fees24h: fees.total24h,
      topFees: fees.protocols.sort((a, b) => (b.total24h ?? 0) - (a.total24h ?? 0)).slice(0, 12).map((p) => ({ name: p.displayName ?? p.name, fees24h: p.total24h, change1d: p.change_1d })),
    };
  },

  async derivatives() {
    const [meta, ctxs] = (await getJson<[{ universe: { name: string; maxLeverage: number }[] }, any[]]>('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    })) as [{ universe: { name: string; maxLeverage: number }[] }, any[]];
    const rows = meta.universe.map((u, i) => {
      const c = ctxs[i];
      const mark = Number(c.markPx);
      const prev = Number(c.prevDayPx);
      return { symbol: u.name, mark, change24h: prev ? ((mark - prev) / prev) * 100 : null, fundingHourly: Number(c.funding), fundingApr: Number(c.funding) * 24 * 365 * 100, openInterestUsd: Number(c.openInterest) * mark, volume24h: Number(c.dayNtlVlm), premium: c.premium == null ? null : Number(c.premium) * 100, maxLeverage: u.maxLeverage };
    });
    const live = rows.filter((r) => r.openInterestUsd > 1_000_000);
    return {
      venue: 'Hyperliquid',
      totalOpenInterestUsd: rows.reduce((s, r) => s + r.openInterestUsd, 0),
      totalVolume24h: rows.reduce((s, r) => s + r.volume24h, 0),
      byOpenInterest: [...live].sort((a, b) => b.openInterestUsd - a.openInterestUsd).slice(0, 25),
      mostLongCrowded: [...live].sort((a, b) => b.fundingApr - a.fundingApr).slice(0, 8),
      mostShortCrowded: [...live].sort((a, b) => a.fundingApr - b.fundingApr).slice(0, 8),
    };
  },

  async predictions() {
    const rows = await getJson<any[]>('https://gamma-api.polymarket.com/markets?limit=40&active=true&closed=false&order=volume24hr&ascending=false');
    return rows
      .map((m) => {
        const outcomes: string[] = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes ?? [];
        const prices: string[] = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices ?? [];
        return { id: m.id, question: m.question, slug: m.slug, volume24h: Number(m.volume24hr ?? 0), liquidity: Number(m.liquidityNum ?? m.liquidity ?? 0), endDate: m.endDate, outcomes: outcomes.map((name, i) => ({ name, price: Number(prices[i]) })) };
      })
      .filter((m) => m.question && m.outcomes.length >= 2 && m.outcomes.every((o) => Number.isFinite(o.price)));
  },

  async news() {
    const feed = await getJson<{ articles: any[] }>(`${THREEWS}/api/news/feed`);
    return feed.articles.slice(0, 40).map((a) => ({ id: a.id, title: a.title, link: a.link, source: a.source ?? null, publishedAt: a.pub_date ?? null, category: a.category ?? null, sentiment: a.sentiment ?? null, tickers: Array.isArray(a.tickers) ? a.tickers.slice(0, 5) : [] }));
  },

  async smartMoney() {
    const d = await getJson<{ coins: any[] }>(`${THREEWS}/api/pump/smart-money`);
    return d.coins.slice(0, 30);
  },

  async trending() {
    return getJson(`${THREEWS}/api/crypto/trending`);
  },
};

const TTL: Record<keyof typeof loaders, number> = { global: 120, markets: 90, sectors: 300, liquidations: 30, staking: 600, defi: 600, derivatives: 60, predictions: 180, news: 180, smartMoney: 60, trending: 60 };

export function mountMarketIntel(app: Hono): void {
  const route = (path: string, name: keyof typeof loaders) =>
    app.get(`/api/intel/${path}`, async (c) => {
      try {
        const data = await cached(`intel-${name}`, TTL[name], loaders[name]);
        c.header('cache-control', `public, max-age=${Math.min(TTL[name], 30)}`);
        return c.json({ data, fetchedAt: new Date().toISOString() });
      } catch (err) {
        return c.json({ error: 'upstream unavailable', detail: (err as Error).message }, 502);
      }
    });
  route('global', 'global');
  route('markets', 'markets');
  route('sectors', 'sectors');
  route('liquidations', 'liquidations');
  route('defi', 'defi');
  route('staking', 'staking');
  route('derivatives', 'derivatives');
  route('predictions', 'predictions');
  route('news', 'news');
  route('smart-money', 'smartMoney');
  route('trending', 'trending');

  app.get('/api/intel/token/:mint', async (c) => {
    const mint = c.req.param('mint');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return c.json({ error: 'a valid Solana mint is required' }, 400);
    try {
      const data = await cached(`intel-token-${mint}`, 120, async () => {
        const [coin, safety, security, holders] = await Promise.allSettled([
          getJson(`${THREEWS}/api/oracle/coin?mint=${mint}`),
          getJson(`${THREEWS}/api/pump/safety?mint=${mint}`),
          getJson(`${THREEWS}/api/crypto/security?address=${mint}`),
          getJson(`${THREEWS}/api/crypto/holders?address=${mint}`),
        ]);
        const val = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? r.value : null);
        return { coin: val(coin), safety: val(safety), security: val(security), holders: val(holders) };
      });
      return c.json({ data, fetchedAt: new Date().toISOString() });
    } catch (err) {
      return c.json({ error: 'upstream unavailable', detail: (err as Error).message }, 502);
    }
  });
}
