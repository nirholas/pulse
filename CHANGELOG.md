# Changelog

## Unreleased

- Board page (`#/board`): one screen of leaderboards (highest volume, runners, being bought right now, newest with traction, staking protocols, yield pools). Each panel loads, fails and refreshes (30s) independently. See `docs/board.md`.
- Market intel API (`/api/intel/*`) now runs on the Node server as well as the Worker. The module moved to `src/intel/market-intel.ts`; the cache uses the edge cache on Workers and process memory on Node. Before this, the Command and Markets panels had no data when run locally.
- New `GET /api/intel/staking`: liquid staking, staking pools and restaking protocols ranked by TVL (DefiLlama), with Solana flagged.
- Token page header: logo, market cap and 24h change up front, one compact stat strip (price, volume, liquidity, holders, ATH, from ATH, peak volume), copy-address button. The chart now sits higher on the page.
- Git archive: every finished UTC day is exported to compressed JSONL, a runner digest and an AI brief, committed to a git repo you own (`docs/archive.md`). `pulse archive`, `pulse archive --restore`, `GET /api/runners` and the `pulse_runners` MCP tool.
- Cloudflare deployment: Worker, D1, Durable Object firehose and static dashboard (`cloudflare/README.md`).
- New Command home page: market ticker, 100-coin heatmap, sentiment gauge, breadth histogram, market map, sector treemap, live market TV, Solana band, derivatives band, DeFi band, prediction markets and news. Each panel loads and refreshes on its own.
- Solana overview moved to `#/solana`; Markets page fixed (news sentiment, source list).
- Token page: conviction gauge, pillar radar, top-holder donut, risk checks, and GeckoTerminal candles when the archive has none.
- Tokens, Launches and Wallets pages gain charts. Wallet X links are fixed and unscored wallets are hidden by default.
- Dollar amounts now print negatives as `-$1.5K` and trillions as `$2.81T`.
- Edge cache serves the last good value when an upstream fails.

## 0.1.1

- `npx pulse-trenches` now runs the CLI directly.

## 0.1.0

- Collector for Jupiter, DexScreener, pump.fun, GeckoTerminal, Solana program logs and Robinhood Chain.
- Postgres/Timescale or embedded PGlite archive.
- Dashboard, JSON API, daily Telegram newsletter, MCP server and `pulse` CLI.
