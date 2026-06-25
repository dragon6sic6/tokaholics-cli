# tokaholics CLI

Measures your **Claude Code** token burn and pushes it to the Tokaholics
leaderboard. It reads **only usage numbers** (token counts, model, timestamp)
from `~/.claude/projects/**/*.jsonl` — never your prompts, code, file names, or
project names.

The CLI is MIT-licensed and open source — read it before you run it.

## What it touches on your machine

`setup` is explicit about everything it does and asks before changing anything:

| Action | Default | Notes |
|--------|:-------:|-------|
| Read `~/.claude/projects/**/*.jsonl` | ✅ | usage fields only — see [Privacy](#privacy) |
| Upload daily `(day, model)` token totals | ✅ | via the `ingest` endpoint |
| Store a device token | ✅ | macOS **Keychain**, never plaintext on disk |
| Background sync agent (launchd, every 5 min) | ✅ | opt out with `--no-agent` |
| Claude Code **Stop hook** in `~/.claude/settings.json` | ❌ | opt in with `--hook` |

Nothing is installed silently, and everything is reversible (see
[Uninstall](#uninstall)).

## Get started

```bash
npx tokaholics setup <code>            # code from the iOS app: You → Connect a computer
npx tokaholics setup <code> --hook     # …and also sync instantly after each session
```

`setup` pairs this Mac, backfills your history, and turns on background sync.
It prints exactly what it will do and waits for your confirmation. That's it —
open the app.

## Commands

| Command | What it does |
|---------|--------------|
| `tokaholics setup <code> [--hook] [--no-agent] [-y]` | Pair + backfill + background sync (the one-liner above) |
| `tokaholics login <code>` | Pair only (no sync/agent/hook) |
| `tokaholics stats` | Show your local 7-day burn (**no upload**) |
| `tokaholics projects` | Burn by project, last 30 days (**local only**) |
| `tokaholics sync [--full]` | Parse new log lines and push changed days |
| `tokaholics start [--interval 300]` | Install background sync (launchd, macOS) |
| `tokaholics stop` | Remove background sync |
| `tokaholics install-hook` / `uninstall-hook` | Add / remove the instant Stop hook |
| `tokaholics status` | Show pairing/config |
| `tokaholics logout` | Unpair this machine + remove the background agent |

Try it with **no account** first — `npx tokaholics stats` runs fully offline.

## Uninstall

```bash
tokaholics uninstall-hook   # if you added --hook
tokaholics logout           # unpairs + removes the launchd agent
```

That removes the launchd agent, the Stop hook, and the Keychain token. The
config dir `~/.tokaholics` can then be deleted.

## How it works

1. Streams every `.jsonl` session log line-by-line (memory-safe).
2. Keeps only assistant `usage` rows, **deduped by `message.id`** (the same id
   repeats across streaming rows).
3. Aggregates **absolute** totals per `(day, model)` → idempotent upserts, so
   re-running `sync` never double-counts.
4. Pushes via a per-device token (only its SHA-256 hash is stored server-side).
   Row-Level Security limits you to your own rows; others' numbers are only ever
   visible as aggregates. Cost (USD) is computed server-side from a pricing table.

The client holds no secret keys — only the public `publishable` key, which is
safe to embed.

## Privacy

The only fields ever read from your logs are:
`message.id`, `message.model`, `timestamp`, and the four `usage` token counts.
No prompt text, file contents, file names, or project names leave your machine.

## Dev (from the repo)

```bash
cd cli
npm install
node bin/tokaholics.js stats     # works offline, no account needed
npm test                         # RPC smoke test (needs Supabase env vars)
```
