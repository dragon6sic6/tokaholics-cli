# tokaholics CLI

Measures your **Claude Code** token burn and pushes it to the Tokaholics
leaderboard. It reads **only the usage numbers** (token counts, model, timestamp)
from `~/.claude/projects/**/*.jsonl` — never your prompts, code, or filenames.

## Get started (new users)

```bash
npm install -g tokaholics
tokaholics setup <code>     # code from the iOS app: You → Connect a computer
```

`setup` pairs this Mac, backfills your full history, and turns on both background
sync (every 5 min) and the instant Stop-hook. That's it — open the app.

## Dev (from the repo)

```bash
cd cli
npm install
node bin/tokaholics.js stats     # works offline, no account needed
```

## Commands

| Command | What it does |
|---------|--------------|
| `tokaholics stats` | Show your local 7-day burn (no upload) |
| `tokaholics login <code> [--url ... --anon ...]` | Pair with your account using the 6-digit code from the iOS app |
| `tokaholics sync [--days 3] [--full]` | Parse logs and push usage |
| `tokaholics start [--interval 300]` | Install background sync (launchd, macOS) |
| `tokaholics stop` | Remove background sync |
| `tokaholics status` | Show pairing/config |
| `tokaholics logout` | Unpair this machine |

## How it works

1. Streams every `.jsonl` session log line-by-line (memory-safe).
2. Keeps only assistant `usage` rows, **deduped by `message.id`** (the same id
   repeats across streaming rows).
3. Aggregates **absolute** totals per `(day, model)` → idempotent upserts, so
   re-running `sync` never double-counts.
4. Pushes to Supabase as a device-JWT; Row-Level Security limits it to your rows.
   Cost (USD) is computed server-side from a pricing table.

## Privacy

The only fields ever read from your logs are:
`message.id`, `message.model`, `timestamp`, and the four `usage` token counts.
No prompt text, file contents, or project names leave your machine.
