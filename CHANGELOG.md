# Changelog

## Unreleased

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
