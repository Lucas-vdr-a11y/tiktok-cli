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

## Commands

- `captron login [account]` — log in via QR; state persists per account
- `captron whoami [account]` — session status + handle
- `captron accounts` — list profiles
- `captron post <video> [opts]` — upload + publish (or draft)
- `captron posts [account]` — list published posts
- `captron drafts [account]` — list drafts
- `captron drafts --publish <id>` / `--delete <id>`
- `captron content [account]` — posts + drafts in one call
- `captron batch <manifest>` — post many (JSON/CSV)
- `captron doctor` — environment check

## Key options for `post`

- `-c, --caption <text>`
- `-t, --hashtags <tags>` — comma-separated, no `#` needed
- `-s, --schedule <when>` — `"YYYY-MM-DD HH:mm"` | `"tomorrow HH:mm"` | `"today HH:mm"` | `"+2h"` | `"+3d"`
- `-v, --visibility <who>` — `everyone` | `friends` | `private`
- `-d, --draft` — save as draft instead of publishing
- `--headless` — run browser without a window
- `--json` — machine-readable output (use this in scripts/agents)
- `-a, --account <name>` — pick account profile

## Batch posting

```bash
captron batch ./manifest.json --delay 30 --max-per-day 4
```

Manifest can be a JSON array, `{items:[...]}`, a single object, or CSV (`video,caption,hashtags,schedule,visibility,draft`).

## Important behaviors

1. **Two-click publish**: after the first "Post" click, TikTok may show a confirmation modal ("Continue posting? Still checking the video..."). Captron confirms it automatically. Publishing can take a few seconds.
2. **Content check**: TikTok runs a server-side check (up to ~10 min). The confirmation modal lets you publish before it finishes.
3. **Persistent sessions**: login state survives between runs in `~/.captron/profiles/<name>`. Use `CAPTRON_HOME` to relocate.
4. **Exit codes**: `0` = success, `1` = failure. Check `--json` output for `ok`, `itemId`, `status`.
5. **Headless**: pass `--headless` or set `CAPTRON_HEADLESS=1` for servers (no display).

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
- Stale session → `captron logout && captron login`