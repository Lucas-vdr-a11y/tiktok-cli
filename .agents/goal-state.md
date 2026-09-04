# Goal

## Objective
Completely reverse engineer TikTok and develop a CLI (for agents) whose main use case is posting videos for automated faceless TikTok creators. Start with the core, expand until it's expansive. Extremely easy setup; easy login/auth; clear instructions for agents; combine multiple actions into 1 tool. Develop a skill for the CLI. Test thoroughly. Publish on GitHub with commits/pushes/PRs throughout the dev process.

## Done when
- CLI exists with working login/auth + video upload tool (core loop verified)
- Agent skill for the CLI exists and is documented
- Multiple combined-action tools implemented (schedule, captions, hashtags, multi-account etc. as feasible)
- Tests written and passing
- GitHub repo has regular commits and at least one PR merged

## Status
active

## Progress
- PR #1 open (feat/ci-and-doctor): doctor probes chromium+chrome engines w/ versions; CI matrix node 18/20/22 (syntax check + unit tests + CLI smoke); CONTRIBUTING.md
- LICENSE (MIT) added — package.json declared MIT but file was missing (publish blocker)
- NEW: Core publish pipeline WORKS end-to-end (upload→caption→modal confirm→publish RPC→verify), EXIT=0, ~8s
- Fixed: react-joyride tour overlay blocking clicks (clearTour + raw DOM click dispatch)
- Fixed: post-Post confirmation modal ("Continue posting?") must be confirmed via "Post now"/"Nu plaatsen" button — was the root cause of publish never firing
- Fixed: cli.js `r is not defined` reference error
- Fixed: batch.js scheduleDate Date/string mismatch, manifest format flexibility
- Fixed: content.js drafts/posts scraping (published cards vs draft cells), single-session combined listing
- Fixed: handle resolution (don't match video card links), byte formatting, activeAccount brace
- Reverse-engineered: full publish RPC with X-Bogus/X-Gnarly signatures, content-check flow, TOS upload
- newest first

## Blockers
- none

## Evidence
- `node bin/captron.js post` → EXIT=0, itemId 7681446464794414358, status published
- `node bin/captron.js content` → 4 posts visible on @sim_test_runs
- publish RPC: POST /tiktok/web/project/post/v1/ returns {projectId, itemId, statusCode:0}
- repo: github.com/Lucas-vdr-a11y/tiktok-cli (main)
