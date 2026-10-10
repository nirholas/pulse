-- Pulse archive schema. Everything is keyed by (chain, address) so Solana and
-- Robinhood Chain (and any chain added later) share one model. Time series
-- tables carry `ts` in their primary key so TimescaleDB can partition them.

-- Every token Pulse has ever seen, with its latest state and lifecycle.
create table if not exists tokens (
  chain              text not null,
  address            text not null,
  symbol             text,
  name               text,
  decimals           integer,
  image              text,
  description        text,
  website            text,
  twitter            text,
  telegram           text,
  launchpad          text,
  creator            text,
  created_at         text,
  first_seen         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_snapshot_at   text,
  category           text not null default 'unclassified',
  categories         text not null default '[]',
  tech_score         real not null default 0,
  classified_at      text,
  tags               text not null default '[]',
  verified           integer,
  last_price         real,
  last_mcap          real,
  last_liquidity     real,
  last_volume_24h    real,
  last_holders       integer,
  last_change_24h    real,
  first_mcap         real,
  ath_mcap           real,
  ath_at             text,
  peak_volume_24h    real,
  status             text not null default 'new',
  status_changed_at  text,
  graduated_at       text,
  died_at            text,
  primary key (chain, address)
);
create index if not exists tokens_status_idx on tokens (chain, status);
create index if not exists tokens_first_seen_idx on tokens (first_seen desc);
create index if not exists tokens_category_idx on tokens (category);
create index if not exists tokens_last_snapshot_idx on tokens (last_snapshot_at);

-- Point-in-time market state per token, one row per collection cycle.
create table if not exists token_snapshots (
  ts                 text not null,
  chain              text not null,
  address            text not null,
  price_usd          real,
  mcap               real,
  fdv                real,
  liquidity          real,
  vol_5m             real,
  vol_1h             real,
  vol_6h             real,
  vol_24h            real,
  buy_vol_24h        real,
  sell_vol_24h       real,
  organic_vol_24h    real,
  buys_1h            integer,
  sells_1h           integer,
  buys_24h           integer,
  sells_24h          integer,
  traders_1h         integer,
  traders_24h        integer,
  net_buyers_24h     integer,
  holders            integer,
  holder_change_24h  real,
  top_holders_pct    real,
  organic_score      real,
  chg_5m             real,
  chg_1h             real,
  chg_6h             real,
  chg_24h            real,
  source             text not null,
  primary key (chain, address, ts)
);
create index if not exists token_snapshots_ts_idx on token_snapshots (ts desc);

-- Which discovery list surfaced a token, at what rank, when.
create table if not exists list_appearances (
  ts       text not null,
  chain    text not null,
  list     text not null,
  rank     integer not null,
  address  text not null,
  primary key (chain, list, address, ts)
);

-- DEX pools per token.
create table if not exists pairs (
  chain          text not null,
  address        text not null,
  token_address  text not null,
  dex            text,
  quote_symbol   text,
  labels         text not null default '[]',
  created_at     text,
  url            text,
  primary key (chain, address)
);
create index if not exists pairs_token_idx on pairs (chain, token_address);

-- Launches, graduations and pool creations, straight from chain events.
create table if not exists launch_events (
  ts         text not null,
  chain      text not null,
  kind       text not null,
  token      text not null,
  launchpad  text,
  actor      text,
  tx         text,
  name       text,
  symbol     text,
  data       text,
  primary key (chain, kind, token)
);
create index if not exists launch_events_ts_idx on launch_events (ts desc);

-- Individual trades kept for watched wallets, whales and early buyers of runners.
create table if not exists trades (
  ts            text not null,
  chain         text not null,
  tx            text not null,
  token         text not null,
  wallet        text not null,
  side          text not null,
  quote_amount  real not null,
  token_amount  real not null,
  price_quote   real,
  mcap_usd      real,
  venue         text,
  reason        text,
  primary key (chain, tx, token, wallet, side, ts)
);
create index if not exists trades_wallet_idx on trades (chain, wallet, ts desc);
create index if not exists trades_token_idx on trades (chain, token, ts desc);

-- Labelled wallets: KOLs, smart money (imported and discovered), whales.
create table if not exists wallets (
  chain       text not null,
  address     text not null,
  label       text,
  kind        text not null,
  source      text not null,
  twitter     text,
  telegram    text,
  first_seen  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  meta        text not null default '{}',
  primary key (chain, address)
);
create index if not exists wallets_kind_idx on wallets (kind);

-- Running per-wallet, per-token positions, aggregated from the trade stream.
create table if not exists wallet_positions (
  chain               text not null,
  wallet              text not null,
  token               text not null,
  first_buy_at        text,
  first_buy_mcap_usd  real,
  last_trade_at       text not null,
  buys                integer not null default 0,
  sells               integer not null default 0,
  bought_quote        real not null default 0,
  sold_quote          real not null default 0,
  bought_tokens       real not null default 0,
  sold_tokens         real not null default 0,
  primary key (chain, wallet, token)
);
create index if not exists wallet_positions_token_idx on wallet_positions (chain, token);
create index if not exists wallet_positions_recent_idx on wallet_positions (last_trade_at desc);

-- Rolling wallet performance, recomputed from positions.
create table if not exists wallet_scores (
  chain             text not null,
  wallet            text not null,
  computed_at       text not null,
  window_days       integer not null,
  tokens_traded     integer not null,
  wins              integer not null,
  win_rate          real not null,
  invested_quote    real not null,
  realized_quote    real not null,
  unrealized_quote  real not null,
  pnl_quote         real not null,
  pnl_usd           real,
  early_hits        integer not null,
  best_multiple     real,
  score             real not null,
  primary key (chain, wallet)
);
create index if not exists wallet_scores_score_idx on wallet_scores (score desc);

-- Chain-wide aggregates per collection cycle.
create table if not exists market_snapshots (
  ts                  text not null,
  chain               text not null,
  native_usd          real,
  tracked_tokens      integer,
  total_mcap          real,
  total_volume_24h    real,
  launches_1h         integer,
  graduations_1h      integer,
  stream_trades_1h    integer,
  stream_volume_1h    real,
  data                text not null default '{}',
  primary key (chain, ts)
);

-- Daily newsletters: the data behind them and the rendered issue.
create table if not exists daily_reports (
  day           text primary key,
  generated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  data          text not null,
  markdown      text not null,
  html          text not null,
  telegram      text
);

-- Key/value state for cursors and checkpoints (block heights, last runs).
create table if not exists kv (
  key         text primary key,
  value       text not null,
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
