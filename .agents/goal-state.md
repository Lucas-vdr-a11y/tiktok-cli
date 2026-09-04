# Goal

## Objective
Completely reverse engineer TikTok and develop a CLI (for agents) whose main use case is posting videos for automated faceless TikTok creators. Start with the core, expand until it's expansive. Extremely easy setup; easy login/auth; clear instructions for agents; combine multiple actions into 1 tool. Develop a skill for the CLI. Test thoroughly. Publish on GitHub with commits/pushes/PRs throughout the dev process.

## Done when
- CLI exists with working login/auth + video upload tool (core loop verified)
- Agent skill for the CLI exists and is documented
- Multiple combined-action tools implemented (schedule, captions, hashtags, multi-account, analytics, download etc.)
- Tests written and passing (44)
- GitHub repo has regular commits and multiple merged PRs

active — v0.4.0; 21 commands (post flags/cover/retries, delete, trending/hashtags/comments, config/new/completion, hook/audit, bulk download, analytics+posts CSV, resumable batch, login --from); 64 tests pass; PR #5 open

- v0.4.0 NEW: `hook` (offline viral hooks, 5 niches, deterministic seed), `audit` (totals/top/flops/caption gaps), `login --from seed.json`, `posts --scheduled/--export`, `post --retries`; completion covers all commands (64/64 tests)
- v0.3.0 NEW: `delete --yes`, `trending`, `hashtags <tag>`, `comments`, `config`, `new <series>`, `completion`; post `--desc-file/--allow-*/--cover/--timeout/--dry-run`; posts `--query/--sort`; download `--all`; analytics `--export`; batch `--shuffle/--resume/--state/--stop-on-error`; doctor ffmpeg/disk/env (62/62 tests)
- PR #4 OPEN (fix/analytics-handle): analytics @handle now resolved from content dashboard fallback (the /analytics tab doesn't render @profile links). `captron analytics --json` returns handle: sim_test_runs. CI running.
- PR #3 MERGED (feat/summary): `captron posts` now uses item_list API (per-post stats + download URLs via playAddr from SSR JSON). `[scheduled YYYY-MM-DD HH:MM]` tag on scheduled posts. `--posts <n>` combined analytics+posts view in one session. Docs updated.
- PR #2 MERGED (feat/analytics): `captron analytics [account] [--days 1|7|28|60] [--posts <n>]` — reverse-engineered /tiktok/v1/analytics/insights/ batch API (no signature needed), insight_type map from probing 1..160, 8 metrics w/ daily series, ranges 1/7/28/60; 10 unit tests
- PR #1 MERGED (squash): doctor probes chromium+chrome engines w/ versions; CI matrix node 20/22; CONTRIBUTING.md; MIT LICENSE; npm publish metadata; engines >=20 (playwright), test glob fix
- NEW: Core publish pipeline WORKS end-to-end (upload→caption→modal confirm→publish RPC→verify), EXIT=0, ~8s
- NEW: `captron download [postId]` — deterministic video download via watch-page SSR `playAddr`
- NEW: `captron posts [account]` — published posts with per-post stats (views/likes/comments/shares), scheduled tags, download URLs
- Fixed: react-joyride tour overlay blocking clicks (clearTour + raw DOM click dispatch)
- Fixed: post-Post confirmation modal ("Continue posting?") must be confirmed via "Post now"/"Nu plaatsen" button — was the root cause of publish never firing
- Fixed: cli.js `r is not defined` reference error
- Fixed: batch.js scheduleDate Date/string mismatch, manifest format flexibility
- Fixed: content.js drafts/posts scraping (published cards vs draft cells), single-session combined listing
- Fixed: handle resolution (don't match video card links), byte formatting, activeAccount brace
- Reverse-engineered: full publish RPC with X-Bogus/X-Gnarly signatures, content-check flow, TOS upload
- Reverse-engineered: `POST /tiktok/creator/manage/item_list/v1/` (per-post stats + download URLs), `GET /tiktok/v1/analytics/insights/` batch (no signature), SSR `playAddr` from watch-page JSON
- newest first

## Blockers
- none

## Evidence
- `node bin/captron.js post` → EXIT=0, itemId 7681446464794414358, status published
- `node bin/captron.js content` → 4 posts visible on @sim_test_runs
- `node bin/captron.js posts` → 6 posts with stats, scheduled tags, download URLs
- `node bin/captron.js analytics` → 8 metrics, handle: sim_test_runs
- `node bin/captron.js download` → real MP4 saved (ftypisom magic)
- publish RPC: POST /tiktok/web/project/post/v1/ returns {projectId, itemId, statusCode:0}
- 64/64 unit tests pass; CI matrix: node 20 + node 22; 21 commands; v0.4.0; PR #5 (feat/v0.3-power) open
