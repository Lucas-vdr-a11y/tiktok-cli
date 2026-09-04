# Changelog

## 0.14.0 — 2026-09-04

Speed + shell-polish wave (116 tests pass).

- `--jobs <n>` — parallel fleet runs. Works on every `--all` sweep,
  `whoami --all`, and `post --to/--all` fan-out, in any flag position
  (plus `CAPTRON_JOBS=n`). Order-preserving worker pool with per-account
  error isolation; default 1 = previous sequential behavior. Verified:
  4 accounts sweep at max-live 4, order kept, one broken profile
  reports its error without killing the sweep.
- `completion [bash|zsh|fish]` — rewritten as a runtime generator over
  the live commander program: new commands/flags complete automatically,
  per-command flags included, fish support added. `bash -n` and `zsh -n`
  pass on generated scripts.

## 0.13.0 — 2026-09-04

Account-management wave (108 tests pass).

- `accounts --remove <name> --yes` — forget a profile entirely
  (browser dir + config entry gone, active falls back; `--yes`
  safety catch like `delete`). Verified live against temp profiles.
- `drafts --all` — drafts list sweeps every account (publish/delete
  stay single-account by design — drafts have no global ids).

## 0.12.0 — 2026-09-04

Complete-the-sweep wave (105 tests pass).

- `content --all` / `comments --all` / `calendar --all` / `audit --all` —
  every read command now sweeps the fleet. Only truly per-account
  (`download`, `drafts`, `config`, `new`) and public (`trending`,
  `hashtags`) commands stay single-scope.
- `posts.summarizePosts` — audit math extracted to a pure, tested,
  null-tolerant helper; `audit` (single + sweep) reuses it.


## 0.11.0 — 2026-09-04

Fleet-sweep wave (102 tests pass).

- `posts --all` / `analytics --all` / `sync --all` — read sweeps across
  every profile (sequential, per-account results, combined summary;
  full detail in `--json`). `--export` becomes per-account
  (`metrics-alice.csv`…) via `utils.exportPath`; `sync --all --out`
  writes one combined fleet snapshot.
- `logout --all` — clear every saved session in one command.
- `auth.sweepAccounts` — shared helper: a throwing account resolves as
  `{ ok:false, account, error }` instead of killing the sweep.

## 0.10.0 — 2026-09-04

Multi-account fan-out wave (99 tests pass).

- `post --to alice,bob` / `post --all` — publish one video to many
  accounts in a single command (sequential launches, per-account
  results, fan-out summary; single-account output unchanged).
- `whoami --all` — session status sweep across every profile
  (`auth.whoamiAll`, per-row errors instead of one failure).
- `posts --since YYYY-MM-DD` — date filtering via a pure tested
  `filterPosts` helper (query/sort/scheduled/since compose).
- `batch --auto-fit` — normalize landscape/odd codecs per item before
  posting (runs pre-plan, so fitted paths validate cleanly).
- `auth.resolveTargets` — shared, tested fan-out resolution
  (dedupes, rejects empty `--to`, falls back to active account).

## 0.9.0 — 2026-09-04

Resilience + flow wave (93 tests pass).

- `batch --retries <n>` — per-item retry with 10s backoff (login failures
  still stop the run immediately, never retried).
- `post --auto-fit` — when `probe` flags landscape/odd codecs, normalize
  via `fit` automatically before uploading; skips when already fitting,
  fails loudly when ffmpeg is missing.
- `use <account>` — instant offline active-profile switch (creates the
  entry lazily; `auth.useAccount`, tested with isolated CAPTRON_HOME).
- `update [--check]` — npm self-update built on a shared `src/update.js`
  (`getLatest`/`checkUpdate` with short-timeout graceful degradation);
  `doctor` reuses it instead of inline fetch code.

## 0.8.0 — 2026-09-04

Pre-flight + fast doctor wave (87 tests pass).

- `batch --probe` — pre-flights every video (codec/duration via ffprobe)
  into plan warnings: visible in `--dry-run`, fatal under `--strict`.
  Catches corrupt files before a 10-minute upload dies server-side.
- `doctor --offline` — fully offline check (~instant): skips browser
  launches and session probe for CI/containers.
- `doctor` now reports installed vs latest npm version (4s-timeout
  advisory check) so agents notice updates.
- `probe` warning is honest now: distinguishes "ffprobe missing" from
  "media streams unreadable (corrupt/partial/fake extension)".

## 0.7.0 — 2026-09-04

Care + timing wave (83 tests pass).

- `clean [--dry-run]` — prune disposable Chromium caches across profiles
  (cookies/sessions kept; ~190 MB reclaimable on a lived-in profile).
  `doctor` now prints per-profile sizes with a `clean` hint.
- `best-time [--days 28]` — posting slots from viewer-activity metrics.
  `analytics`/`sync` now also fetch active_days/active_hours; pure
  `summarizeBestTimes` ranks the peaks (best-effort, shapes vary).
- Schedule window warnings: ~20 min lead, ~10 days max. Warn in
  `post`, `batch` plan + dry-run output, and fail under `--strict`.
- `new --niche <name> --seed <s>` — fill series manifests with
  generated hooks instead of "part N" stubs.

## 0.6.0 — 2026-09-04

One-session sync wave (77 tests pass).

- `sync` — posts + analytics metrics + recent comments in ONE browser
  session (`--days/--limit/--comments/--out sync.json`). Replaces three
  launches for the daily agent digest; shares `fetchInsights`,
  `fetchItemPage`, and a newly extracted `openInbox/scrapeCommentRows`.
- `calendar` — scheduled queue grouped by day (`--days 14`), powered by
  a pure tested `groupScheduled` helper.
- `caption` — offline caption builder (`--hook/--cta/-t/--strict`).
- `post` auto-runs `probe` on the video first: duration/codec hints
  surface as warnings (hard errors only under `--strict`).

## 0.5.0 — 2026-09-04

Media prep + strictness wave (73 tests pass).

- `probe <file>` — offline TikTok-readiness verdict (size, codec via
  ffprobe, duration, landscape/vertical hints). Exit 1 when unfit.
- `fit <input> -o <out>` — normalize to vertical 1080x1920 H.264/AAC +
  faststart via ffmpeg (pure argv builder, graceful without ffmpeg).
- `doctor --fix` — removes stale Chromium Singleton locks from profiles
  (the classic "profile in use" failure after a crash).
- `post --strict` / `batch --strict` — fail on validation warnings
  (overlong caption, large file) instead of posting anyway.
- `batch --jitter <sec>` — random 0..N extra delay between posts
  (rate-limit friendly on top of `--delay`).

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
