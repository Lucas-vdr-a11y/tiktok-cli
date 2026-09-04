# Captron — Post TikTok videos from the command line

**Captron** is a CLI for AI agents and automated faceless TikTok creators. It drives the real TikTok Studio web flow (fully reverse-engineered) through a persistent browser session, so posts go through TikTok's official pipeline — no brittle private-API hacks, no signatures to maintain.

## Why captron?

- **One command, full pipeline**: upload + caption + hashtags + schedule + publish (or save draft).
- **Built for agents**: `--json` output, exit codes, manifest-based batch posting, multi-account profiles.
- **Easy auth**: log in once with a QR code (or import a browser session); state persists.
- **Honest automation**: it drives the *real* TikTok web app the same way a human would, so it survives UI tweaks and carries valid anti-bot signatures (`X-Bogus`, `X-Gnarly`) automatically.

## Install

```bash
npm install -g captron
# ensure a Chromium/Chrome is available for Playwright
npx playwright install chromium
```

> Set `CAPTRON_BROWSER_CHANNEL=chrome` to use your installed Google Chrome (recommended — fewer captchas, real cookies).

## Quick start

```bash
# 1. Log in (opens a browser — scan the QR code with the TikTok app)
captron login

# 2. Post a video
captron post ./my-video.mp4 --caption "Made with AI #faceless" --hashtags "ai,creator,fyp"

# 3. Check it worked
captron whoami
captron content          # lists posts + drafts
```

## Commands

| Command | What it does |
|---|---|
| `login [account]` | Log in via QR code, or `login --from seed.json` to import a browser session non-interactively. State persists in `~/.captron/profiles/<account>`. |
| `accounts` | List configured account profiles. |
| `use <account>` | Switch the active profile (instant, offline). |
| `post <video> [options]` | Upload + caption + publish (or draft) in one action. `--retries 2` retries failures, `--auto-fit` normalizes video first, `--strict` fails on warnings. Use `--slideshow` for images. |
| `post <video> --slideshow <paths>` | Upload a slideshow of images (comma-separated, up to 10). |
| `probe <file>` | Offline TikTok-readiness check (size, codec, duration, verdict). |
| `fit <input> -o <out>` | Normalize to vertical 1080x1920 H.264/AAC via ffmpeg (offline). |
| `posts [account]` | Published posts **with stats** + download URLs. `--query` filters, `--sort top` ranks, `--scheduled` only scheduled, `--export posts.csv`. |
| `download [postId]` | Download one of your published videos (default: most recent). `--all --limit 10 --out-dir ./clips` for bulk. |
| `content [account]` | Posts + drafts in one call. |
| `sync [account]` | One-session digest: posts + analytics + comments snapshot (`--days 7 --limit 20 --comments 5 --out sync.json`). Replaces 3 browser launches with 1. |
| `calendar [account]` | Scheduled queue grouped by day (`--days 14`). |
| `caption` | Offline caption builder (`--hook "..." --cta "..." -t tags --strict`). |
| `analytics [account]` | Account metrics (+ recent posts w/ stats via `--posts <n>`, CSV via `--export out.csv`, viewer-activity via `best-time`). |
| `best-time [account]` | Best posting slots from viewer activity (`--days 28`). |
| `audit [account]` | Health check: totals, averages, top + flop posts, caption gaps. |
| `hook` | Offline viral hook generator (`--niche ai|money|fitness|story|tech --count 5 --seed x`). |
| `drafts [account]` | List drafts; `--publish <id>` / `--delete <id>`. |
| `delete <postId> --yes` | Delete a published post (safety catch required). |
| `trending` | Trending hashtags from Explore (caption research). |
| `hashtags <tag>` | Hashtag detail + related tags. |
| `comments [account]` | Recent comments on your posts (best-effort). |
| `batch <manifest>` | Post many videos from a JSON/CSV manifest. `--delay 20 --jitter 8` spaces posts, `--probe` pre-flights media, `--retries 2` retries each item, `--strict` fails warned items. |
| `config [key] [value]` | Get/set config (no args lists all). |
| `new <name>` | Scaffold a `<name>.manifest.json` series template (`--count 5 --niche money --seed x` fills hook captions). |
| `clean [--dry-run]` | Free disk: prune disposable Chromium caches (sessions kept). |
| `completion` | Print bash/zsh completion (`eval "$(captron completion)"`). |
| `doctor [--fix] [--offline]` | Check environment, browser, ffmpeg, disk, profile sizes, session + update check. `--fix` clears stale locks; `--offline` skips browsers (fast). |
| `update [--check]` | Check npm for a newer captron (`--check` reports only). |

### `post` options

```
-c, --caption <text>       Caption text (or --desc-file <path> for long captions)
-t, --hashtags <tags>      Comma-separated hashtags (no # needed, deduped)
-s, --schedule <when>      Schedule: "YYYY-MM-DD HH:mm" | "18:30" | "today 18:00" | "tomorrow 09:00" | "friday 18:00" | "+90m" | "+3d" | "in 2 hours"
-v, --visibility <who>     everyone | friends | private
-d, --draft                Save as draft instead of publishing
--slideshow <paths>        Comma-separated image paths for a slideshow (up to 10). Overrides <video>.
--allow-comments / --no-allow-comments      Toggle comments (default: TikTok default)
--allow-duet / --no-allow-duet              Toggle duets
--allow-stitch / --no-allow-stitch          Toggle stitches
--cover <seconds>          Cover frame timestamp (best-effort)
--timeout <seconds>        Give up after N seconds
--retries <n>              Retry failed posts up to N times
--auto-fit                 Normalize landscape/odd codecs via `fit` before uploading (skips when already fitting)
--strict                   Fail on warnings (long caption, large file) instead of posting
--dry-run                  Validate inputs without posting
--headless                 Run browser headless (or CAPTRON_HEADLESS=1)
--json                     Machine-readable output (or CAPTRON_JSON=1)
`post` auto-runs `probe` on the video first (duration/codec warnings are
advisory unless `--strict`).

Scheduling window: TikTok Studio needs ~20 min lead and allows ~10 days
max — out-of-window schedules warn (and fail under `--strict`).

### Media prep (offline, before posting)

```bash
captron probe ./clip.mp4        # verdict: fits TikTok? codec/duration/size issues?
captron fit ./clip.mp4 -o ./ready.mp4   # vertical 1080x1920 H.264/AAC + faststart
captron post ./ready.mp4 --strict       # refuse to post when anything warns
captron batch ./manifest.json --probe --dry-run   # pre-flight every video, print warnings
captron doctor --fix                    # clear stale Chromium locks ("profile in use")
```

### Batch posting

```bash
# JSON manifest
captron batch ./manifest.json

# { "items": [ ... ] } or a plain array, or single object are all accepted

# CSV: video,caption,hashtags,schedule,visibility,draft
captron batch ./manifest.csv --draft --delay 30 --max-per-day 4

# Long runs: progress file + resume + shuffle + stop-on-error
captron batch ./manifest.json --state ./progress.json --delay 20
captron batch ./manifest.json --resume ./progress.json   # skips already-posted
captron batch ./manifest.json --shuffle                  # random order
captron batch ./manifest.json --stop-on-error             # default: continue past failures
```

Manifest items also accept `allowComment`, `allowDuet`, `allowStitch` (`true`/`false`) and `cover` (seconds).

Example `manifest.json`:

```json
[
  { "video": "./vid1.mp4", "caption": "Part 1", "hashtags": "series,ai" },
  { "video": "./vid2.mp4", "caption": "Part 2", "schedule": "tomorrow 09:00" }
]
```

## Research (for faceless creators)

```bash
captron hook --niche money --count 5 --seed ep1   # offline viral hooks for scripts
captron caption --hook "POV: ..." -t ai,fyp       # length-checked caption
captron trending --limit 20        # what's hot on Explore right now
captron hashtags ai --limit 10     # view count + related tags for #ai
captron posts --sort top --limit 5 # your best performers first
captron calendar --days 14         # what's queued, by day
captron analytics --days 28 --export metrics.csv --posts 5
captron audit --limit 20           # totals, top/flops, caption gaps
captron comments --limit 20        # who replied to you
# ...or all three online reads in one browser session:
captron sync --days 7 --limit 20 --comments 5 --out sync.json
```

## Environment

| Variable | Effect |
|---|---|
| `CAPTRON_HOME` | Relocate all data (profiles + config). |
| `CAPTRON_ACCOUNT` | Default account when `-a` is not passed. |
| `CAPTRON_HEADLESS=1` | Same as `--headless`. |
| `CAPTRON_JSON=1` | Same as `--json`. |
| `CAPTRON_VERBOSE=1` | Same as `--verbose`. |
| `CAPTRON_BROWSER_CHANNEL` | `chrome` (default), `chromium`, `msedge`, or `bundled`. |
| `CAPTRON_CHROMIUM_PATH` | Explicit browser executable. |
| `CAPTRON_LOCALE` / `CAPTRON_TIMEZONE` | Browser locale/timezone (defaults `en-US` / `Europe/Amsterdam`). |

## Sessions & multi-account

Each account gets its own persistent browser profile (cookies + localStorage) under `~/.captron/profiles/<name>`. Log in once and reuse. Use `CAPTRON_HOME` to relocate all data.

Import an existing browser session (e.g. from a manual Chrome login) with:

```bash
node -e "require('fs').writeFileSync('/tmp/seed.json', JSON.stringify({cookies: [...], localStorage: {...}}))"
node scripts/seed-session.js /tmp/seed.json my-account
```

## Reverse-engineering notes

See [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md) for the full breakdown of the upload pipeline, endpoints, and modal flows.

## License

MIT