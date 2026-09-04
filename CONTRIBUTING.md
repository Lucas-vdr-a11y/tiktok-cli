# Contributing to captron

Thanks for your interest in improving captron! This project exists to give AI
agents (and the humans behind automated faceless-TikTok pipelines) a reliable
scriptable way to post videos to TikTok.

## Project layout

```
bin/captron.js        entrypoint
src/cli.js            commander program: all subcommands & options
src/auth.js           login (QR), session checks, logout, accounts
src/browser.js        persistent-profile launch (anti-automation flags)
src/selectors.js      TikTok DOM selectors (single source of truth)
src/upload.js         upload → caption/hashtags → options → publish flow
src/content.js        combined posts + drafts listing (single session)
src/drafts.js         draft delete
src/batch.js          manifest-driven bulk posting
src/utils.js          paths, JSON emit, logging, env (CAPTRON_* / CAPTRON_HOME)
scripts/seed-session.js
test/unit/            node:test unit tests (no network needed)
docs/REVERSE_ENGINEERING.md  how the TikTok web flow actually works
```

## Development workflow

1. Fork / branch (`feat/...`, `fix/...`).
2. Make changes; keep selectors in `src/selectors.js` and flow logic in the
   matching module — avoid hardcoding selectors in `src/cli.js`.
3. Run checks locally:

   ```sh
   npm install
   npm test                       # unit tests
   node bin/captron.js --help     # CLI loads
   node bin/captron.js doctor     # environment + live session check
   ```

4. Test against real TikTok **only** with videos you have the rights to, and
   prefer `--dry-run` while iterating on the upload flow.
5. Commit with concise messages (`feat:`, `fix:`, `docs:`, `chore:` …) and open
   a PR. CI runs unit tests + CLI smoke tests on Node 18/20/22.

## Conventions

- **CommonJS**, Node ≥ 18, no build step.
- Errors go to stderr with a non-zero exit code; JSON mode (`--json`) must emit
  parseable JSON and nothing else on stdout.
- Never log or commit session cookies. Login state lives only in
  `~/.captron/profiles/<account>` (override with `CAPTRON_HOME`).
- Keep dependencies minimal (currently: `commander`, `playwright`).

## Reporting broken selectors

TikTok ships UI changes frequently. If a command suddenly fails:

1. Re-run with `--verbose` and note which step stalled.
2. Check `docs/REVERSE_ENGINEERING.md` for the documented flow — if the UI
   changed, the fix is usually a selector update in `src/selectors.js`.
3. Open an issue with the verbose log (redact any personal data) — or better,
   a PR updating the selector.
