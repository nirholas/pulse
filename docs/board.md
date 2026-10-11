# Board

`#/board` is the whole market on one screen. Every panel is an independent request: a failing source shows a retry button in its own panel and never blanks the page. Panels refresh every 30 seconds.

| Panel | Source | What it shows |
| --- | --- | --- |
| Highest volume | `GET /api/tokens?sort=volume` | Archived tokens (Solana and Robinhood Chain) by 24h volume, mcap above $10K |
| Runners | `GET /api/tokens?status=running&sort=change` | Still-running tokens with the biggest 24h move (mcap above $50K, volume above $10K) |
| Being bought right now | `GET /api/overview` (`hot`) | Live Solana firehose, last hour: buys, sells, buy share, unique traders, SOL volume. Solana only, in-memory, resets on restart |
| Newest with traction | `GET /api/tokens?sort=new` | Newly discovered tokens already above $2K 24h volume |
| Staking protocols | `GET /api/intel/staking` | Liquid staking, staking pools and restaking by TVL, 24h and 7d change; `SOL` marks protocols deployed on Solana |
| Yield pools | `GET /api/intel/defi` | Solana pools by TVL plus the highest APY anywhere (TVL above $5M) |

## Market intel API

`/api/intel/*` aggregates keyless public upstreams (CoinGecko via three.ws, DefiLlama, alternative.me, Hyperliquid, Polymarket) and trims each payload for the dashboard. Routes: `global`, `markets`, `sectors`, `liquidations`, `defi`, `staking`, `derivatives`, `predictions`, `news`, `smart-money`, `trending`, and `token/:mint`. Responses are `{ data, fetchedAt }`.

Caching lives in `src/intel/market-intel.ts`. On Workers it uses the edge cache; on Node it uses process memory. Either way the last good value is kept for six hours, so a rate-limited upstream serves stale data instead of an error.

## Limits

- Staking data is protocol-level TVL from DefiLlama, not per-validator or per-pool APR. Per-pool APY comes from the Yield pools panel.
- Flow ("what people are buying") covers Solana only. Other chains and windows longer than an hour need an aggregation over the `trades` table.
- Upstream availability is outside Pulse's control; the first load after a cold start needs the upstreams to answer.
