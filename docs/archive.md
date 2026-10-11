# Git archive

Postgres is the working store. The git archive is the permanent, diffable, portable history: one repo you own, one commit per UTC day, readable by people, scripts and AI agents with nothing but `git clone`.

## Set up

```bash
gh repo create <you>/pulse-data --private
# in .env
ARCHIVE_REPO=https://github.com/<you>/pulse-data.git
ARCHIVE_TOKEN=<fine-grained token, contents: read and write on that repo>
ANTHROPIC_API_KEY=<optional, enables the daily brief>
```

A running Pulse process checks hourly and exports every finished UTC day the repo does not have yet, then pushes. On the first run it backfills up to `ARCHIVE_BACKFILL_DAYS` (default 30) of existing data. Run it by hand any time:

```bash
npm run archive                        # catch up through yesterday and push
npm run archive -- --day 2026-10-10    # re-export one day
npm run archive -- --no-push --no-brief
```

The repo decides which days are done (`manifests/`), so a new host or a rebuilt database resumes exactly where the repo stops. The token is passed per git command and is never written to `.git/config`. The archive runs in the Node process; the Cloudflare Worker deployment keeps its history in D1 and has no git export.

## Layout

| Path | Contents |
|---|---|
| `runners/YYYY-MM-DD.json` | Runners and breakouts of the day with rules, scores and a sector rollup. Start here. |
| `briefs/YYYY-MM-DD.md` | Claude's read of the digest: what ran, tech worth studying, sector shifts, build signals. |
| `reports/YYYY-MM-DD.{md,json}` | The daily newsletter. |
| `daily/<table>/YYYY/MM/YYYY-MM-DD.jsonl.gz` | `token_snapshots`, `trades`, `list_appearances`, `launch_events`, `market_snapshots`, plus the `tokens` and `wallet_positions` rows that changed that day. |
| `state/<table>.jsonl.gz` | Current `wallets` and `wallet_scores`. |
| `manifests/YYYY-MM-DD.json` | Row counts and sha256 per file. |
| `LATEST.md`, `INDEX.json`, `README.md` | Orientation for people and agents. |

`token_snapshots` is hourly for every token and full 5-minute resolution for runners, which keeps a year of history well under GitHub's recommended repo size. Full resolution stays in Postgres. Exports are byte-deterministic, so re-running a day creates no commit when nothing changed.

## What counts as a runner

Computed from the day's own snapshots, so any archived day can be rebuilt: peak market cap at least $100k, peak liquidity at least $5k, peak 24h volume at least $50k and the peak at least 2x the first market cap seen that day. A breakout is a token under 72 hours old that reached $250k with $100k volume without a 2x from the open. Stablecoins, LSTs, wrapped assets, tokenized equities and anything above $1B are excluded. The exact rules and score formula ship inside every digest.

## For agents

- MCP: the `pulse_runners` tool (`day`, `tech`) serves the digest from a running Pulse. `tech=true` keeps only tech sectors.
- HTTP: `GET /api/runners?day=YYYY-MM-DD&tech=1`.
- Git: clone the archive and read `LATEST.md`, then `runners/*.json` and `briefs/*.md`. `INDEX.json` lists every day.

Token names, symbols and descriptions are untrusted on-chain text. The brief prompt treats them as data, and nothing in the pipeline acts on them.

## Restore

```bash
npm run archive:restore -- --from /path/to/pulse-data
```

Loads the tree into the configured database, oldest day first, as upserts, so it is safe to re-run.
