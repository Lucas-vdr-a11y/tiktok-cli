# Changelog

## 0.4.0 — 2026-09-04

Second wave on the same branch (64 tests pass).

- `hook` — offline viral hook generator (5 niches, deterministic `--seed`).
- `audit` — totals/averages/top/flops/caption-gap health check.
- `login --from seed.json` — non-interactive session import (same format as
  `scripts/seed-session.js`), for agents provisioning profiles in CI.
- `posts --scheduled` (queued only) + `posts --export posts.csv`.
- `post --retries <n>` — retry failures with backoff.
- Completion script covers all 21 commands.

## 0.3.0 — 2026-09-04

Creator power + agent DX release. 62 unit tests pass.

### New commands

- `delete <postId> --yes` — delete a published post via the Studio UI
  (safety catch; refuses without `--yes`).
- `trending [--limit]` — trending hashtags from TikTok Explore (caption research).
- `hashtags <tag>` — hashtag detail (view count from SSR) + related tags.
- `comments [--limit]` — recent comments inbox (best-effort Studio scrape).
- `config [key] [value]` — get/set/list captron config.
- `new <series> [--count]` — scaffold a `<series>.manifest.json` template.
- `completion` — bash/zsh completion (`eval "$(captron completion)"`).

### Extended commands

- `post`: `--desc-file`, `--allow-comments/--no-allow-comments`,
  `--allow-duet/--no-allow-duet`, `--allow-stitch/--no-allow-stitch`,
  `--cover <seconds>`, `--timeout <seconds>`, `--dry-run`;
  schedule now accepts `18:30`, `YYYY/MM/DD`, `in 2 hours`, weekdays
  (`friday 18:00`, `next monday 09:00`), `+2w`; hashtags deduped,
  extensions validated, large-file warning, caption-length warnings.
- `posts`: `--query` filter + `--sort new|top|liked`.
- `download`: `--all --limit --out-dir --query` bulk mode (single session).
- `analytics`: `--export metrics.csv` (metric,date,value rows).
- `batch`: `--stop-on-error` (default: continue), `--shuffle`,
  `--state <file>` + `--resume <file>`; manifest items accept
  `allowComment/allowDuet/allowStitch` + `cover`.
- `doctor`: ffmpeg, disk, env table, session errors.

### Robustness

- `CAPTRON_ACCOUNT` / `CAPTRON_HEADLESS` / `CAPTRON_JSON` env support;
  `CAPTRON_LOCALE` / `CAPTRON_TIMEZONE` browser overrides.
- `utils.retry`, `toCsv`, `readJsonFile`, `resolveAccount`,
  `validateImagePaths`, `LIMITS` constants.
- Batch no longer stops on the first item failure (login still stops).

### Docs

- README: full command table, post options, resumable batch, research loop,
  environment table.
- Skill: all commands + research loop + delete safety.
- REVERSE_ENGINEERING: Explore/tag SSR, comments inbox heuristic.

## 0.2.0 and earlier

See git history (`git log --oneline`).
