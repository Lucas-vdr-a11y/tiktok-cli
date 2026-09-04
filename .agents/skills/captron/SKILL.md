# captron — Post TikTok videos from the command line

Use this skill when the user wants to post videos to TikTok, schedule posts, manage drafts, or batch-upload content. Captron drives the real TikTok Studio web flow through a persistent browser session.

## Quick setup

```bash
npm install -g captron && npx playwright install chromium
captron login            # opens browser — user scans QR code
```

Set `CAPTRON_BROWSER_CHANNEL=chrome` to use installed Chrome (fewer captchas).

## Core workflow

```bash
captron post <video> --caption "text" --hashtags "tag1,tag2"
```

This single command does the whole pipeline: upload → caption → (confirm modal) → publish. Returns JSON with `itemId`, `status`, `ok`.

- `captron login [account]` — log in via QR; `--from seed.json` imports a session non-interactively
- `captron whoami [--all]` — session status (`--all` sweeps every profile)
- `captron accounts` — list profiles; `captron use <account>` switches active (instant, offline)
- `captron post <video> [opts]` — upload + publish (or draft); `--to alice,bob` / `--all` fans out to many accounts, `--retries 2` retries, `--auto-fit` normalizes first, `--strict` fails on warnings
- `captron post <video> --slideshow <paths>` — upload a slideshow of images (comma-separated, up to 10)
- `captron probe <file>` — offline TikTok-readiness check (size, codec, duration, verdict)
- `captron fit <input> -o <out>` — normalize to vertical 1080x1920 H.264/AAC via ffmpeg
- `captron posts [account] --query <text> --sort top|liked --scheduled --since 2026-08-01 --export posts.csv` — posts with stats + download URLs
- `captron content [account]` — posts + drafts in one call
- `captron sync [account] --days 7 --limit 20 --comments 5 --out sync.json` — posts + analytics + comments in ONE browser session (daily digest)
- `captron calendar --days 14` — scheduled queue grouped by day
- `captron caption --hook "..." -t ai,fyp --strict` — offline caption builder
- `captron analytics [account] --days <1|7|28|60> --posts <n> --export metrics.csv` — metrics + posts in one call (now includes viewer-activity metrics)
- `captron best-time --days 28` — best posting slots from viewer activity
- `captron hook --niche <ai|money|fitness|story|tech> --count 5 --seed x` — offline viral hooks (deterministic)
- `captron audit --limit 20` — totals, averages, top/flop posts, caption gaps
- `captron download [postId] -o out.mp4` — single video; `--all --limit 10 --out-dir ./clips --query <text>` for bulk
- `captron delete <postId> --yes` — delete a published post (safety catch)
- `captron drafts` — list drafts; `--publish <id>` / `--delete <id>`
- `captron trending --limit 20` — trending hashtags (caption research)
- `captron hashtags <tag>` — hashtag detail + related tags
- `captron comments --limit 20` — recent comments (best-effort)
- `captron batch <manifest> [--delay 20 --jitter 8 --probe --auto-fit --retries 2 --state progress.json --resume progress.json --shuffle --stop-on-error --strict]` — post many; `--probe` pre-flights, `--auto-fit` normalizes, `--retries` retries each item; per-item `"account"` mixes accounts
- `captron update [--check]` — check/install latest from npm (`--check` reports only)
- `captron clean [--dry-run]` — free disk: prune Chromium caches (sessions kept)
- `captron doctor [--fix] [--offline]` — environment check (profile sizes + npm update check); `--fix` clears locks, `--offline` skips browsers

## Key options for `post`

- `-c, --caption <text>` or `--desc-file <path>` (long AI captions)
- `-t, --hashtags <tags>` — comma-separated, no `#` needed, deduped
- `-s, --schedule <when>` — `"YYYY-MM-DD HH:mm"` | `"18:30"` | `"today 18:00"` | `"tomorrow 09:00"` | `"friday 18:00"` | `"+90m"` | `"+3d"` | `"in 2 hours"` (Studio needs ~20 min lead, ~10 days max — out-of-window warns)
- `-v, --visibility <who>` — `everyone` | `friends` | `private`
- `-d, --draft` — save as draft instead of publishing
- `--slideshow <paths>` — comma-separated image paths (up to 10) for a slideshow; overrides `<video>`
- `--allow-comments/--no-allow-comments`, `--allow-duet/--no-allow-duet`, `--allow-stitch/--no-allow-stitch`
- `--cover <seconds>` — cover frame timestamp (best-effort)
- `--timeout <seconds>` / `--retries <n>` / `--dry-run` — give up after N s / retry failures / validate only
- `--auto-fit` — normalize landscape/odd codecs via `fit` first (skips when already fitting)
- `--headless` — run browser without a window (or `CAPTRON_HEADLESS=1`)
- `--json` — machine-readable output (use this in scripts/agents; or `CAPTRON_JSON=1`)
- `-a, --account <name>` — pick account profile (or `CAPTRON_ACCOUNT`)

## Batch posting

```bash
captron batch ./manifest.json --delay 30 --max-per-day 4
captron batch ./manifest.json --state progress.json --delay 20   # resumable
captron batch ./manifest.json --resume progress.json             # skip done
```

Manifest can be a JSON array, `{items:[...]}`, a single object, or CSV (`video,caption,hashtags,schedule,visibility,draft`). Items also accept `allowComment/allowDuet/allowStitch` + `cover`.

## Research loop (faceless creators)

```bash
captron trending --limit 20
captron hashtags ai --limit 10
captron posts --sort top --limit 5
captron analytics --days 28 --export metrics.csv --posts 5
```

## Important behaviors

1. **Two-click publish**: after the first "Post" click, TikTok may show a confirmation modal ("Continue posting? Still checking the video..."). Captron confirms it automatically. Publishing can take a few seconds.
2. **Content check**: TikTok runs a server-side check (up to ~10 min). The confirmation modal lets you publish before it finishes.
3. **Persistent sessions**: login state survives between runs in `~/.captron/profiles/<name>`. Use `CAPTRON_HOME` to relocate. `CAPTRON_ACCOUNT` sets the default account.
4. **Exit codes**: `0` = success, `1` = failure. Check `--json` output for `ok`, `itemId`, `status`. Batch continues past item failures unless `--stop-on-error`.
5. **Headless**: pass `--headless` or set `CAPTRON_HEADLESS=1` for servers (no display).
6. **Delete safety**: `captron delete <id>` refuses without `--yes`.

## Example: agent posting loop

```bash
for video in ./out/*.mp4; do
  captron post "$video" --caption "Faceless #$(date +%s)" --hashtags "ai,faceless,fyp" --json
done
```

## Troubleshooting

- `Not logged in` → run `captron login`
- `Could not find a clickable Post button` → the editor may not have loaded; retry
- `Timed out waiting for TikTok to confirm` → check `captron content` (the post may have gone live anyway); re-run with `--verbose` for the publish RPC details
- `refusing to delete without --yes` → re-run with `--yes`
- Stale session → `captron logout && captron login`