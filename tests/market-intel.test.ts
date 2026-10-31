import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cached, loaders } from '../src/intel/market-intel.ts';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as any).caches = {
    default: {
      match: async (r: Request) => (store.has(r.url) ? new Response(store.get(r.url)) : undefined),
      put: async (r: Request, res: Response) => void store.set(r.url, await res.text()),
    },
  };
});
afterEach(() => vi.unstubAllGlobals());

const stubFetch = (routes: Record<string, unknown>) =>
  vi.stubGlobal('fetch', async (url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    return hit ? new Response(JSON.stringify(hit[1])) : new Response('nope', { status: 404 });
  });

describe('cached', () => {
  it('loads once per ttl', async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    await cached('k', 60, load);
    await cached('k', 60, load);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('serves the last good value when the upstream starts failing', async () => {
    await cached('k2', 60, async () => ({ n: 7 }));
    for (const k of [...store.keys()]) if (!k.endsWith('.stale')) store.delete(k);
    const out = await cached('k2', 60, async () => {
      throw new Error('429');
    });
    expect(out).toEqual({ n: 7 });
  });
  it('still throws when nothing was ever cached', async () => {
    await expect(cached('k3', 60, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

describe('cached without an edge cache (Node server)', () => {
  it('falls back to process memory', async () => {
    delete (globalThis as any).caches;
    const load = vi.fn(async () => ({ n: 3 }));
    expect(await cached('mem-k', 60, load)).toEqual({ n: 3 });
    expect(await cached('mem-k', 60, load)).toEqual({ n: 3 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cached('mem-k2', 60, async () => ({ n: 9 }))).toEqual({ n: 9 });
  });
});

describe('loaders', () => {
  it('staking keeps only staking categories, ranks by TVL and flags Solana', async () => {
    stubFetch({
      'api.llama.fi/protocols': [
        { name: 'Small', category: 'Liquid Staking', tvl: 10, symbol: '-', chains: ['Ethereum'] },
        { name: 'Big', category: 'Liquid Staking', tvl: 500, symbol: 'BIG', chains: ['Ethereum', 'Solana'], change_1d: 1.5 },
        { name: 'Dex', category: 'Dexs', tvl: 9999, chains: ['Solana'] },
        { name: 'Empty', category: 'Restaking', tvl: 0, chains: [] },
      ],
    });
    const d = await loaders.staking();
    expect(d.protocols.map((p: any) => p.name)).toEqual(['Big', 'Small']);
    expect(d.protocols[0]).toMatchObject({ solana: true, symbol: 'BIG', chg1d: 1.5 });
    expect(d.protocols[1]).toMatchObject({ solana: false, symbol: null });
    expect(d.totalTvl).toBe(510);
  });
  it('liquidations aggregates sides per symbol and ranks the largest', async () => {
    stubFetch({
      '/api/coin/liquidations': { liquidations: [
        { symbol: 'BTC', side: 'LONG', value: 100, exchange: 'a', price: 1, time: 1 },
        { symbol: 'BTC', side: 'SHORT', value: 40, exchange: 'a', price: 1, time: 2 },
        { symbol: 'ETH', side: 'LONG', value: 500, exchange: 'b', price: 1, time: 3 },
      ] },
    });
    const r = await loaders.liquidations();
    expect(r.longs).toBe(600);
    expect(r.shorts).toBe(40);
    expect(r.bySymbol[0]).toMatchObject({ symbol: 'ETH', longs: 500 });
    expect(r.bySymbol[1]).toMatchObject({ symbol: 'BTC', longs: 100, shorts: 40, count: 2 });
    expect(r.largest[0]!.value).toBe(500);
  });

  it('predictions parses stringified outcomes and drops malformed markets', async () => {
    stubFetch({
      'gamma-api.polymarket.com': [
        { id: '1', question: 'Will X?', slug: 'x', volume24hr: '10', liquidityNum: 5, outcomes: '["Yes","No"]', outcomePrices: '["0.7","0.3"]' },
        { id: '2', question: 'Broken', outcomes: '["Yes","No"]', outcomePrices: '["abc","0.3"]' },
        { id: '3', question: 'One outcome', outcomes: '["Yes"]', outcomePrices: '["1"]' },
      ],
    });
    const r = await loaders.predictions();
    expect(r).toHaveLength(1);
    expect(r[0]!.outcomes).toEqual([{ name: 'Yes', price: 0.7 }, { name: 'No', price: 0.3 }]);
  });

  it('derivatives converts hourly funding to APR and ranks crowded sides', async () => {
    stubFetch({
      'api.hyperliquid.xyz': [
        { universe: [{ name: 'AAA', maxLeverage: 20 }, { name: 'BBB', maxLeverage: 10 }, { name: 'DUST', maxLeverage: 3 }] },
        [
          { markPx: '10', prevDayPx: '8', funding: '0.0001', openInterest: '1000000', dayNtlVlm: '5', premium: '0.001' },
          { markPx: '2', prevDayPx: '2', funding: '-0.0002', openInterest: '2000000', dayNtlVlm: '7', premium: null },
          { markPx: '1', prevDayPx: '1', funding: '0.5', openInterest: '10', dayNtlVlm: '1', premium: '0' },
        ],
      ],
    });
    const r = await loaders.derivatives();
    expect(r.byOpenInterest.map((x) => x.symbol)).toEqual(['AAA', 'BBB']);
    expect(r.mostLongCrowded[0]!.symbol).toBe('AAA');
    expect(r.mostShortCrowded[0]!.symbol).toBe('BBB');
    expect(r.byOpenInterest[0]!.fundingApr).toBeCloseTo(0.0001 * 24 * 365 * 100);
    expect(r.byOpenInterest[0]!.change24h).toBeCloseTo(25);
  });

  it('global reads dominance by symbol', async () => {
    stubFetch({
      '/api/coin/global': { market: { active_coins: 1, market_cap_usd: 2, volume_24h_usd: 3, market_cap_change_pct_24h: 4, dominance: [{ symbol: 'BTC', pct: 56 }] } },
      '/api/coin/fear-greed': { current: { value: 61, label: 'Greed' }, previous_week: { value: 50 }, history: [{ ts: 1, value: 1 }] },
    });
    const r = await loaders.global();
    expect(r.btcDominance).toBe(56);
    expect(r.ethDominance).toBeNull();
    expect(r.fearGreed).toMatchObject({ value: 61, previousWeek: 50 });
  });
});
