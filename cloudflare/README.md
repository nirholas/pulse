# Pulse on Cloudflare

The dashboard and API run as one Worker: Hono routes, a D1 database, a SQLite Durable Object for the Solana firehose, and the Vite build served as Static Assets.

| Piece | Where |
| --- | --- |
| API routes (archive reads) | `src/api.ts` |
| Whole-market intel routes | `src/market-intel.ts` |
| Firehose (Solana `logsSubscribe`, 5 minute alarm) | `src/firehose.ts` |
| D1 schema | `migrations/` |
| Dashboard | `../web/src` (built to `../dist/web`) |

## Market intel routes

`/api/intel/*` aggregates keyless upstreams (the three.ws intel API, DefiLlama, Hyperliquid, Polymarket), trims each payload to what the dashboard renders and caches it at the edge. A successful load is also kept for six hours under a `.stale` key, so a rate limited upstream serves the last good value instead of an error.

| Route | Source | TTL |
| --- | --- | --- |
| `global`, `markets`, `sectors` | three.ws `/api/coin/*` | 120s, 90s, 300s |
| `liquidations` | three.ws `/api/coin/liquidations` | 30s |
| `derivatives` | Hyperliquid `/info` | 60s |
| `defi` | DefiLlama chains, yields, stablecoins, dexs, fees | 600s |
| `predictions` | Polymarket gamma | 180s |
| `news`, `smart-money`, `trending` | three.ws | 180s, 60s, 60s |
| `token/:mint` | three.ws risk, holders and oracle | per request |

Cloudflare egress IPs are rate limited by CoinGecko, CoinPaprika, Binance, GeckoTerminal and the Sperax gateway, so none of them are called from the Worker. The token page loads GeckoTerminal candles in the browser (iframe fallback) when the archive has none.

## Deploy

```sh
npx vite build
node scripts/build-worker.mjs
cd cloudflare
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx wrangler deploy
```

Keep the token in the shell only. `scripts/shoot.mjs` loads a route in headless Chromium and reports console errors and failed requests.

## Tests

`npm test` covers the loaders (mocked upstream responses), the edge cache and its stale fallback, and the chart option builders in `web/src/viz.ts`.
