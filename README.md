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
| `login [account]` | Log in via QR code. State persists in `~/.captron/profiles/<account>`. |
| `logout [account]` | Clear a saved session. |
| `whoami [account]` | Show session status + handle. |
| `accounts` | List configured account profiles. |
| `post <video> [options]` | Upload + caption + publish (or draft) in one action. |
| `posts [account]` | List published posts. |
| `drafts [account]` | List saved drafts. |
| `drafts --publish <id>` | Publish a saved draft. |
| `drafts --delete <id>` | Delete a draft. |
| `content [account]` | Posts **and** drafts in one call. |
| `analytics [account]` | Views, likes, comments, shares, followers, viewers (last 1/7/28/60 days). |
| `batch <manifest>` | Post many videos from a JSON/CSV manifest. |
| `doctor` | Check environment, browser, profiles, session. |

### `post` options

```
-c, --caption <text>       Caption text
-t, --hashtags <tags>      Comma-separated hashtags (no # needed)
-s, --schedule <when>      Schedule: "YYYY-MM-DD HH:mm" | "tomorrow HH:mm" | "today HH:mm" | "+2h" | "+3d"
-v, --visibility <who>     everyone | friends | private
-d, --draft                Save as draft instead of publishing
--headless                 Run browser headless
--json                     Machine-readable output
-a, --account <name>       Account profile to use
```

### Batch posting

```bash
# JSON manifest
captron batch ./manifest.json

# { "items": [ ... ] } or a plain array, or single object are all accepted

# CSV: video,caption,hashtags,schedule,visibility,draft
captron batch ./manifest.csv --draft --delay 30 --max-per-day 4
```

Example `manifest.json`:

```json
[
  { "video": "./vid1.mp4", "caption": "Part 1", "hashtags": "series,ai" },
  { "video": "./vid2.mp4", "caption": "Part 2", "schedule": "tomorrow 09:00" }
]
```

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