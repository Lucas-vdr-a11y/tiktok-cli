'use strict';

const { Command } = require('commander');
const utils = require('./utils');
const { buildCaptionDetailed, parseSchedule, validateVideoPath, validateImagePaths, formatDate, humanize, printResult, resolveAccount } = utils;
const auth = require('./auth');
const browserMod = require('./browser');
const uploadLib = require('./upload');
const contentLib = require('./content');
const batchLib = require('./batch');

let globalOptions = { account: null, headless: false };

// ---------------------------------------------------------------------------
// post command — the flagship combined action
// ---------------------------------------------------------------------------

/** Module-scoped program ref so top-level handlers can read root options. */
let programRef = null;

function applyGlobals() {
  const opts = programRef.opts();
  globalOptions = {
    account: resolveAccount(opts.account),
    headless: opts.headless || /^(1|true|yes)$/i.test(String(process.env.CAPTRON_HEADLESS || '')),
  };
  utils.setVerbose(opts.verbose || process.env.CAPTRON_VERBOSE === '1' || false);
  utils.setJson(opts.json || process.env.CAPTRON_JSON === '1' || false);
}

async function runPost(videoArg, opts) {
  applyGlobals();
  const fs = require('fs');
  // --desc-file: read caption body from a file (useful for long AI captions).
  let captionOpt = opts.caption;
  if (opts.descFile) {
    try {
      captionOpt = fs.readFileSync(opts.descFile, 'utf8').trim();
    } catch (err) {
      utils.fail('Could not read --desc-file "' + opts.descFile + '": ' + err.message);
      process.exit(1);
    }
  }
  // Slideshow mode: --slideshow takes comma-separated image paths (up to 10).
  const slideshowPaths = opts.slideshow
    ? opts.slideshow.split(',').map((p) => p.trim()).filter(Boolean)
    : [];
  const isSlideshow = slideshowPaths.length > 0 || (opts.slideshow != null && String(opts.slideshow).trim() !== '');
  let vcheck = null;
  if (isSlideshow) {
    const icheck = validateImagePaths(slideshowPaths);
    if (!icheck.ok) {
      utils.fail(icheck.error);
      process.exit(1);
    }
  } else {
    vcheck = validateVideoPath(videoArg);
    if (!vcheck.ok) {
      utils.fail(vcheck.error);
      process.exit(1);
    }
    if (vcheck.warning) utils.warn(vcheck.warning);
    // Offline media probe (fast): codec/duration hints before the upload.
    try {
      const { probeFile } = require('./media');
      const probe = probeFile(vcheck.path);
      if (probe && probe.ok) {
        vcheck.probe = probe;
        if (probe.durationSec != null) utils.step('Duration: ' + probe.durationSec + 's' + (probe.width ? ' (' + probe.width + 'x' + probe.height + ')' : ''));
        for (const w of probe.warnings || []) utils.warn(w);
      }
    } catch (_) { /* probe is advisory only */ }
  }
  let scheduleDate = parseSchedule(opts.schedule);
  if (opts.schedule && !scheduleDate) {
    utils.fail('Could not parse --schedule "' + opts.schedule + '". Try "YYYY-MM-DD HH:mm", "18:30", "today 18:00", "tomorrow 09:00", "friday 18:00", "+90m", "+3d" or "in 2 hours".');
    process.exit(1);
  }
  if (scheduleDate && scheduleDate.getTime() <= Date.now()) {
    utils.fail('--schedule must be in the future (' + scheduleDate.toISOString() + ').');
    process.exit(1);
  }
  const schedWarns = utils.scheduleWarnings(scheduleDate);
  for (const w of schedWarns) utils.warn(w);
  const { text: caption, warnings } = buildCaptionDetailed({ caption: captionOpt, hashtags: opts.hashtags });
  for (const w of warnings) utils.warn(w);
  const strictWarnings = [...warnings, ...schedWarns, ...((!isSlideshow && vcheck && vcheck.warning) ? [vcheck.warning] : []), ...((!isSlideshow && vcheck && vcheck.probe && vcheck.probe.warnings) ? vcheck.probe.warnings : [])];
  if (opts.strict && strictWarnings.length) {
    utils.fail('Strict mode: ' + strictWarnings.join('; '));
    process.exit(1);
  }
  const parseFlag = (v, nv) => (v === true || nv === false ? true : v === false || nv === true ? false : null);
  // commander --no-* gives opts.allowComments=false etc; support both spellings.
  const allowComment = opts.allowComments != null ? Boolean(opts.allowComments) : opts.allowComment != null ? Boolean(opts.allowComment) : null;
  const allowDuet = opts.allowDuet != null ? Boolean(opts.allowDuet) : null;
  const allowStitch = opts.allowStitch != null ? Boolean(opts.allowStitch) : null;
  void parseFlag;
  if (opts.dryRun) {
    printResult({ ok: true, dryRun: true, account: globalOptions.account, video: isSlideshow ? slideshowPaths.join(',') : vcheck.path, caption, schedule: scheduleDate ? scheduleDate.toISOString() : null, visibility: opts.visibility || 'everyone', saveDraft: Boolean(opts.draft) }, (r) => 'Dry run — nothing posted.\n  video: ' + r.video + '\n  caption: ' + (r.caption || '(empty)') + '\n  schedule: ' + (r.schedule || 'now'));
    return;
  }
  utils.step('Posting to account "' + globalOptions.account + '"');
  if (isSlideshow) utils.step('Mode: SLIDESHOW (' + slideshowPaths.length + ' images)');
  if (caption) utils.step('Caption: ' + caption.replace(/\n/g, ' | ').slice(0, 160));
  if (opts.schedule) utils.step('Scheduled for: ' + formatDate(scheduleDate));
  if (opts.draft) utils.step('Mode: save DRAFT (no publish)');
  const timeoutMs = opts.timeout ? Number(opts.timeout) * 1000 : 0;
  const context = await browserMod.launchProfile({ account: globalOptions.account, headless: globalOptions.headless });
  const started = Date.now();
  let result;
  try {
    const attempt = () => uploadLib.performPost({
      context,
      videoPath: isSlideshow ? null : vcheck.path,
      slideshow: isSlideshow ? slideshowPaths : undefined,
      caption,
      schedule: scheduleDate,
      visibility: opts.visibility,
      saveDraft: opts.draft || false,
      allowComment,
      allowDuet,
      allowStitch,
      cover: opts.cover != null ? Number(opts.cover) : null,
    });
    const withTimeout = (p) => (timeoutMs > 0 ? utils.withTimeout(p, timeoutMs, 'post timed out after ' + opts.timeout + 's') : p);
    const retries = Math.max(0, Number(opts.retries) || 0);
    result = retries > 0
      ? await utils.retry(async () => withTimeout(attempt()), { tries: retries + 1, delayMs: 5000, onRetry: (e) => utils.warn('retrying after: ' + String(e.message).split('\n')[0]) })
      : await withTimeout(attempt());
  } catch (err) {
    uploadLib.handlePostError(err);
    return;
  } finally {
    await context.close().catch(() => {});
  }
  result.account = globalOptions.account;
  result.video = isSlideshow ? slideshowPaths.join(',') : vcheck.path;
  result.durationSec = Math.round((Date.now() - started) / 1000);
  printResult(result, (r) => {
    const lines = [
      '',
      r.ok ? 'Post ' + r.status + ' ✔' : 'Post status: ' + (r.status || 'unknown'),
      '  ' + (r.slideshow ? 'slideshow (' + r.slideshow + ' images)' : 'video:') + ' ' + r.video,
      '  account:   ' + r.account,
      r.itemId ? '  item id:   ' + r.itemId : '',
      r.projectId ? '  project:   ' + r.projectId : '',
      r.url ? '  url:       ' + r.url : '',
      '  took:      ' + humanize(r.durationSec),
      r.failed ? '  error:     ' + r.error : '',
    ];
    return lines.filter(Boolean).join('\n');
  });
  process.exit(result.failed ? 1 : 0);
}

// ---------------------------------------------------------------------------
// program wiring
// ---------------------------------------------------------------------------

function buildProgram() {
  const program = new Command();
  programRef = program;

  program
    .name('captron')
    .description('Post TikTok videos from the command line — built for AI agents & faceless TikTok creators.')
    .version(require('../package.json').version)
    .showSuggestionAfterError();
  // global options (attached to every command)
  program
    .option('-a, --account <name>', 'account profile to use (default: active)')
    .option('--headless', 'run browser headless')
    .option('--json', 'emit machine-readable JSON')
    .option('-v, --verbose', 'verbose debug output');

  program
    .command('login [account]')
    .description('Log in to a TikTok account (QR code). State persists for later use. Use --from <seed.json> to import a browser session non-interactively.')
    .option('-t, --timeout <seconds>', 'login timeout in seconds', '300')
    .option('--from <file>', 'import session cookies from a JSON file (same format as scripts/seed-session.js)', null)
    .action(async (account, opts) => {
      applyGlobals();
      const acct = account || globalOptions.account || 'main';
      if (opts.from) {
        const res = await auth.importSession({ account: acct, file: opts.from });
        printResult(res, (r) => (r.ok ? 'Imported session for "' + r.account + '"' + (r.handle ? ' as @' + r.handle : '') + ' ✔' : 'Import failed: ' + r.error));
        process.exit(res.ok ? 0 : 1);
        return;
      }
      const res = await auth.login({ account: acct, timeoutSec: Number(opts.timeout), headless: globalOptions.headless });
      printResult(res, (r) => 'Logged in' + (r.handle ? ' as @' + r.handle : '') + ' ✔');
    });

  program
    .command('logout [account]')
    .description('Log out an account (clears its saved TikTok session).')
    .action(async (account) => {
      applyGlobals();
      const res = await auth.logout({ account: account || globalOptions.account || 'main' });
      printResult(res, (r) => 'Logged out ✔');
    });

  program
    .command('whoami [account]')
    .description('Show session status for an account.')
    .action(async (account) => {
      applyGlobals();
      const res = await auth.whoami({ account: account || globalOptions.account || 'main' });
      printResult(res, (r) => (r.loggedIn ? 'Logged in as @' + (r.handle || '?') + (r.uid ? ' (uid ' + r.uid + ')' : '') : 'Not logged in'));
    });

  program
    .command('accounts')
    .description('List configured account profiles.')
    .action(() => {
      applyGlobals();
      const res = auth.accounts();
      printResult(res, (r) => {
        const lines = ['Accounts:'];
        for (const a of r.accounts) {
          lines.push('  ' + a.name + (a.name === r.activeAccount ? ' *' : '') + (a.handle ? '  @' + a.handle : '  (no session)'));
        }
        return lines.join('\n');
      });
    });

  program
    .command('post <video>')
    .description('Upload a video (or slideshow of images) and post it in one action. Use --slideshow for images.')
    .option('-c, --caption <text>', 'video/image caption text')
    .option('--desc-file <path>', 'read caption text from a file')
    .option('-t, --hashtags <tags>', 'comma-separated hashtags (no # needed)')
    .option('-s, --schedule <when>', 'schedule: "YYYY-MM-DD HH:mm" | "18:30" | "today 18:00" | "tomorrow 09:00" | "friday 18:00" | "+90m" | "+3d" | "in 2 hours"')
    .option('-v, --visibility <who>', 'visibility: everyone | friends | private')
    .option('-d, --draft', 'save as draft instead of publishing')
    .option('--slideshow <paths>', 'comma-separated image paths for a slideshow (up to 10 images, overrides <video>)')
    .option('--allow-comments', 'allow comments on this post')
    .option('--no-allow-comments', 'disable comments on this post')
    .option('--allow-duet', 'allow duets on this post')
    .option('--no-allow-duet', 'disable duets on this post')
    .option('--allow-stitch', 'allow stitches on this post')
    .option('--no-allow-stitch', 'disable stitches on this post')
    .option('--cover <seconds>', 'cover frame timestamp in seconds (best-effort)', null)
    .option('--timeout <seconds>', 'give up after N seconds (default: no timeout)', null)
    .option('--retries <n>', 'retry failed posts up to N times (default: 0)', '0')
    .option('--strict', 'fail on validation warnings (long caption, large file)')
    .option('--dry-run', 'validate inputs and print the plan without posting')
    .action(runPost);

  program
    .command('posts [account]')
    .description('List published posts with stats (views, likes, comments, shares) and download URLs.')
    .option('--limit <n>', 'max posts', '20')
    .option('-q, --query <text>', 'filter by caption text or post id', null)
    .option('--sort <mode>', 'sort: new | top | liked', 'new')
    .option('--scheduled', 'only show scheduled posts')
    .option('--export <file>', 'write posts as CSV to <file>', null)
    .action(async (account, opts) => {
      applyGlobals();
      const { listPostsApi } = require('./posts');
      const res = await listPostsApi({ account: account || globalOptions.account || 'main', limit: Number(opts.limit), query: opts.query, sort: opts.sort, scheduledOnly: Boolean(opts.scheduled), headless: globalOptions.headless });
      if (res.ok && opts.export) {
        try {
          const rows = res.items.map((it) => ({ id: it.id, date: it.createTime ? new Date(it.createTime).toISOString().slice(0, 10) : '', caption: it.caption, views: it.stats.views, likes: it.stats.likes, comments: it.stats.comments, shares: it.stats.shares, url: 'https://www.tiktok.com/@' + (res.handle || '') + '/video/' + it.id }));
          require('fs').writeFileSync(opts.export, utils.toCsv(rows, ['id', 'date', 'caption', 'views', 'likes', 'comments', 'shares', 'url']));
          res.exported = opts.export;
        } catch (err) { res.exportError = err.message; }
      }
      printResult(res, (r) => {
        const lines = ['Posts on @' + (r.handle || r.account || '?') + ' (' + r.items.length + '):'];
        for (const it of r.items) {
          const s = it.stats || {};
                    const when = it.createTime ? new Date(it.createTime).toISOString().slice(0, 10) : '?';
          const sched = it.scheduledTime ? '  [scheduled ' + new Date(it.scheduledTime).toISOString().slice(0, 16).replace('T', ' ') + ']' : '';
          lines.push('  ' + it.id + '  ' + when + '  ' + (it.caption || '(no caption)').slice(0, 40) + sched);
          lines.push('      views ' + (s.views != null ? s.views : '?') + ' · likes ' + (s.likes != null ? s.likes : '?') + ' · comments ' + (s.comments != null ? s.comments : '?') + ' · shares ' + (s.shares != null ? s.shares : '?') + (it.inReview ? '  [in review]' : ''));
        }
        if (r.exported) lines.push('  csv: ' + r.exported);
        if (r.exportError) lines.push('  export error: ' + r.exportError);
        if (r.error) lines.push('  error: ' + r.error);
        return lines.join('\n');
      });
      if (!res.ok) process.exit(1);
    });

  program
    .command('download [postId]')
    .description('Download one of your published videos (default: most recent). Use --all for bulk.')
    .option('-o, --out <path>', 'output .mp4 path (single download)', null)
    .option('--all', 'download the N most recent posts instead of one')
    .option('--limit <n>', 'how many to download with --all', '5')
    .option('--out-dir <dir>', 'directory for --all downloads', '.')
    .option('-q, --query <text>', 'only download posts matching caption/id', null)
    .action(async (postId, opts) => {
      applyGlobals();
      const { downloadPost, downloadMany } = require('./download');
      if (opts.all) {
        const res = await downloadMany({ account: globalOptions.account || 'main', limit: Number(opts.limit), outDir: opts.outDir, query: opts.query, headless: globalOptions.headless });
        printResult(res, (r) => (r.ok ? 'Downloaded ' + r.downloaded + '/' + r.total + ' to ' + opts.outDir : 'Download failed: ' + r.error));
        if (!res.ok) process.exit(1);
        return;
      }
      const res = await downloadPost({ account: globalOptions.account || 'main', postId: postId || null, out: opts.out, headless: globalOptions.headless });
      printResult(res, (r) => (r.ok ? 'Saved ' + r.file + ' (' + Math.round(r.bytes / 1024) + ' KB) — post ' + r.post.id + ' "' + (r.post.caption || '').slice(0, 40) + '"' : 'Download failed: ' + r.error));
      if (!res.ok) process.exit(1);
    });

  program
    .command('content [account]')
    .description('List published posts AND saved drafts in one call.')
    .option('--limit <n>', 'max posts', '20')
    .action(async (account, opts) => {
      applyGlobals();
      const res = await contentLib.listContent({ account: account || globalOptions.account || 'main', limit: Number(opts.limit), headless: globalOptions.headless });
      printResult(res, (r) => {
        const lines = ['Content on @' + (r.handle || r.account || '?') + ':'];
        lines.push('');
        lines.push('Posts (' + r.posts.items.length + (r.posts.total > r.posts.items.length ? '/' + r.posts.total : '') + '):');
        for (const it of r.posts.items) {
          const s = it.stats;
          const statsTxt = s ? '  · ' + s.views + 'v ' + s.likes + 'l ' + s.comments + 'c' + (it.inReview ? ' [review]' : '') : '';
          lines.push('  ' + (it.id || '?') + '  ' + (it.caption || '').slice(0, 44) + (it.url ? '  ' + it.url : '') + statsTxt);
        }
        lines.push('');
        lines.push('Drafts (' + r.drafts.items.length + (r.drafts.total > r.drafts.items.length ? '/' + r.drafts.total : '') + '):');
        for (const it of r.drafts.items) {
          lines.push('  ' + (it.caption || '(untitled)') + (it.duration ? '  [' + it.duration + ']' : '') + (it.updated ? '  ' + it.updated : ''));
        }
        if (r.error) lines.push('  error: ' + r.error);
        return lines.join('\n');
      });
      if (!res.ok) process.exit(1);
    });

  program
    .command('analytics [account]')
    .description('Account analytics: views, likes, comments, shares, followers, viewers — last N days. Add --posts to include recent posts with stats.')
    .option('-d, --days <n>', 'range: 1, 7, 28 or 60 days', '7')
    .option('-p, --posts <n>', 'also include N most recent posts with per-post stats', '0')
    .option('--export <file>', 'write metrics as CSV to <file>', null)
    .action(async (account, opts) => {
      applyGlobals();
      const { analytics, analyticsToCsv } = require('./analytics');
      const res = await analytics({ account: account || globalOptions.account || 'main', days: Number(opts.days), posts: Number(opts.posts), headless: globalOptions.headless });
      if (res.ok && opts.export) {
        try {
          require('fs').writeFileSync(opts.export, analyticsToCsv(res));
          res.exported = opts.export;
        } catch (err) { res.exportError = err.message; }
      }
      printResult(res, (r) => {
        const lines = ['Analytics for @' + (r.handle || r.account || '?') + ' (last ' + r.range_days + ' days):'];
        for (const [name, m] of Object.entries(r.metrics || {})) {
          if (!m) continue;
          const delta = m.delta != null ? (m.delta >= 0 ? '+' : '') + m.delta : '';
          const pct = m.percent_change != null ? ' (' + (m.percent_change >= 0 ? '+' : '') + m.percent_change + '%)' : '';
          lines.push('  ' + name.padEnd(14) + String(m.total != null ? m.total : '—') + (delta ? '  ' + delta : '') + pct);
        }
        if (r.posts && r.posts.length) {
          lines.push('');
          lines.push('Recent posts (' + r.posts.length + '):');
          for (const it of r.posts) {
            const s = it.stats || {};
            const when = it.createTime ? new Date(it.createTime).toISOString().slice(0, 10) : '?';
            lines.push('  ' + it.id + '  ' + when + '  ' + (it.caption || '(no caption)').slice(0, 36));
            lines.push('      views ' + s.views + ' · likes ' + s.likes + ' · comments ' + s.comments + ' · shares ' + s.shares);
          }
        }
        if (r.exported) lines.push('  csv: ' + r.exported);
        if (r.exportError) lines.push('  export error: ' + r.exportError);
        if (r.posts_error) lines.push('  posts error: ' + r.posts_error);
        if (r.error) lines.push('  error: ' + r.error);
        return lines.join('\n');
      });
      if (!res.ok) process.exit(1);
    });

  program
    .command('batch <manifest>')
    .description('Post (or draft) many videos from a JSON/CSV manifest — one command for a whole content pipeline.')
    .option('-d, --draft', 'save every item as draft instead of publishing')
    .option('--delay <seconds>', 'seconds to wait between posts', '0')
    .option('--jitter <seconds>', 'random extra delay 0..N between posts (rate-limit friendly)', '0')
    .option('--max-per-day <n>', 'hard cap on posts per run', '0')
    .option('--dry-run', 'validate the manifest and print the plan without posting')
    .option('--strict', 'fail manifests with validation warnings')
    .option('--stop-on-error', 'stop at the first failed post (default: continue)')
    .option('--shuffle', 'post manifest items in random order')
    .option('--resume <file>', 'skip items already posted per a previous --state file', null)
    .option('--state <file>', 'write progress after every post (enables resume)', null)
    .action(async (manifest, opts) => {
      applyGlobals();
      const res = await batchLib.runBatch({
        manifest,
        defaultAccount: globalOptions.account,
        defaultDraft: opts.draft || false,
        delaySec: Number(opts.delay),
        jitterSec: Number(opts.jitter),
        strict: Boolean(opts.strict),
        dryRun: opts.dryRun || false,
        headless: globalOptions.headless,
        maxPerDay: Number(opts.maxPerDay),
        stopOnError: Boolean(opts.stopOnError),
        shuffle: Boolean(opts.shuffle),
        resumeFrom: opts.resume,
        stateFile: opts.state,
      });
      printResult(res, (r) => {
        if (r.dryRun) {
          const lines = ['Dry run — ' + r.total + ' posts planned:'];
          for (const t of r.results) lines.push('  ' + t.video + '  -> @' + t.account + (t.schedule ? ' @ ' + t.schedule : '') + (t.draft ? ' [draft]' : ' [live]') + (t.warnings && t.warnings.length ? '  (! ' + t.warnings.join('; ') + ')' : ''));
          return lines.join('\n');
        }
        const okCount = r.okCount || 0;
        const lines = ['Batch: ' + okCount + '/' + r.total + ' ok'];
        for (const it of r.results) {
          lines.push('  ' + (it.ok ? '✔' : '✖') + ' ' + it.video + (it.itemId ? '  -> /video/' + it.itemId : ''));
          if (it.error) lines.push('      ' + it.error);
        }
        return lines.join('\n');
      });
      process.exit(res.ok ? 0 : 1);
    });

  program
    .command('drafts')
    .description('Manage saved drafts.')
    .option('-l, --list', 'list drafts')
    .option('-p, --publish <id>', 'publish a draft by id')
    .option('-d, --delete <id>', 'delete a draft by id')
    .action(async (opts) => {
      applyGlobals();
      if (opts.list || (!opts.publish && !opts.delete)) {
        const res = await contentLib.listDrafts({ account: globalOptions.account, headless: globalOptions.headless });
        printResult(res, (r) => {
          const lines = ['Drafts (' + r.items.length + '):'];
          for (const it of r.items) lines.push('  ' + it.id + '  ' + it.caption.slice(0, 60));
          return lines.join('\n');
        });
        return;
      }
      if (opts.publish) {
        const { publishDraft } = require('./drafts');
        const res = await publishDraft({ account: globalOptions.account, id: opts.publish, headless: globalOptions.headless });
        printResult(res, (x) => 'Draft ' + x.id + (x.ok ? ' published -> ' + x.url : ' failed: ' + x.error));
        process.exit(res.ok ? 0 : 1);
      }
      if (opts.delete) {
        const { deleteDraft } = require('./drafts');
        const res = await deleteDraft({ account: globalOptions.account, id: opts.delete, headless: globalOptions.headless });
        printResult(res, (x) => 'Draft ' + x.id + (x.ok ? ' deleted' : ' failed: ' + x.error));
        process.exit(res.ok ? 0 : 1);
      }
    });

  program
    .command('hook')
    .description('Generate viral hooks for a niche (offline, for faceless scripts).')
    .option('--niche <name>', 'ai | money | fitness | story | tech', 'ai')
    .option('--count <n>', 'how many hooks', '5')
    .option('--seed <s>', 'seed for reproducible output', 'captron')
    .action((opts) => {
      applyGlobals();
      const { generateHooks, hookCaption } = require('./hooks');
      const items = generateHooks({ niche: opts.niche, count: Number(opts.count), seed: opts.seed });
      printResult({ ok: true, niche: opts.niche, items }, (r) => {
        const lines = ['Hooks (' + r.niche + '):'];
        r.items.forEach((h, i) => lines.push('  ' + (i + 1) + '. ' + h.hook + '\n     caption: ' + hookCaption({ hook: h.hook }).replace(/\n/g, ' ')));
        return lines.join('\n');
      });
    });

  program
    .command('audit [account]')
    .description('Account health check: totals, averages, top + flop posts.')
    .option('--limit <n>', 'posts to scan', '20')
    .action(async (account, opts) => {
      applyGlobals();
      const { listPostsApi } = require('./posts');
      const res = await listPostsApi({ account: account || globalOptions.account || 'main', limit: Number(opts.limit), headless: globalOptions.headless });
      if (!res.ok) { printResult(res, (r) => 'Audit failed: ' + r.error); process.exit(1); }
      const items = res.items;
      const sum = (f) => items.reduce((a, it) => a + ((it.stats && it.stats[f]) || 0), 0);
      const avg = (f) => (items.length ? Math.round(sum(f) / items.length) : 0);
      const top = [...items].sort((a, b) => b.stats.views - a.stats.views).slice(0, 3);
      const flops = [...items].sort((a, b) => a.stats.views - b.stats.views).slice(0, 3).filter((it) => it.stats.views < avg('views'));
      const noCaption = items.filter((it) => !(it.caption || '').trim());
      const out = { ok: true, account: res.account, handle: res.handle, scanned: items.length, totals: { views: sum('views'), likes: sum('likes'), comments: sum('comments'), shares: sum('shares') }, averages: { views: avg('views'), likes: avg('likes') }, top: top.map((t) => t.id), flops: flops.map((t) => t.id), noCaption: noCaption.length };
      printResult(out, (r) => {
        const lines = ['Audit @' + (r.handle || r.account) + ' (' + r.scanned + ' posts):', '  totals:   ' + r.totals.views + ' views · ' + r.totals.likes + ' likes · ' + r.totals.comments + ' comments', '  averages: ' + r.averages.views + ' views/post', '  top:      ' + (r.top.join(', ') || '—'), '  flops:    ' + (r.flops.join(', ') || '—') + (r.noCaption ? '   (' + r.noCaption + ' posts have no caption!)' : '')];
        return lines.join('\n');
      });
    });

  program
    .command('best-time [account]')
    .description('Best posting slots from viewer-activity analytics (best-effort).')
    .option('-d, --days <n>', 'range: 1, 7, 28 or 60 days', '28')
    .action(async (account, opts) => {
      applyGlobals();
      const { analytics, summarizeBestTimes } = require('./analytics');
      const res = await analytics({ account: account || globalOptions.account || 'main', days: Number(opts.days), headless: globalOptions.headless });
      if (!res.ok) { printResult(res, (r) => 'Best-time failed: ' + r.error); process.exit(1); }
      const best = summarizeBestTimes(res.metrics);
      printResult({ ok: true, account: res.account, handle: res.handle, range_days: res.range_days, ...best }, (r) => {
        const lines = ['Best time @' + (r.handle || r.account || '?') + ' (last ' + r.range_days + 'd):'];
        if (r.hours.length) {
          lines.push('  peak hours:');
          for (const h of r.hours) lines.push('    ' + h.date + '  (score ' + h.value + ')');
        }
        if (r.days.length) {
          lines.push('  active days:');
          for (const d of r.days) lines.push('    ' + d.date + '  (score ' + d.value + ')');
        }
        if (r.suggestion) lines.push('  → ' + r.suggestion);
        else lines.push('  (no viewer-activity data yet — post first, then check back)');
        return lines.join('\n');
      });
    });

  program
    .command('delete <postId>')
    .description('Delete a published post by id (requires --yes).')
    .option('--yes', 'confirm deletion')
    .action(async (postId, opts) => {
      applyGlobals();
      const { deletePost } = require('./posts');
      const res = await deletePost({ account: globalOptions.account || 'main', postId, headless: globalOptions.headless, yes: Boolean(opts.yes) });
      printResult(res, (r) => (r.ok ? 'Deleted post ' + r.id + ' ✔' : 'Delete failed: ' + r.error));
      process.exit(res.ok ? 0 : 1);
    });

  program
    .command('trending')
    .description('Trending hashtags from TikTok Explore (research for captions).')
    .option('--limit <n>', 'max tags', '20')
    .action(async (opts) => {
      applyGlobals();
      const { trendingTags } = require('./trending');
      const res = await trendingTags({ limit: Number(opts.limit), headless: globalOptions.headless, account: globalOptions.account || 'main' });
      printResult(res, (r) => {
        const lines = ['Trending hashtags (' + r.items.length + '):'];
        for (const t of r.items) lines.push('  #' + t.tag + (t.views != null ? '  ' + t.views + ' views' : '') + '  ' + t.url);
        return lines.join('\n');
      });
      if (!res.ok) process.exit(1);
    });

  program
    .command('hashtags <tag>')
    .description('Hashtag detail + related tags (research for reach).')
    .option('--limit <n>', 'max related tags', '10')
    .action(async (tag, opts) => {
      applyGlobals();
      const { hashtagInfo } = require('./trending');
      const res = await hashtagInfo({ tag, limit: Number(opts.limit), headless: globalOptions.headless, account: globalOptions.account || 'main' });
      printResult(res, (r) => {
        const lines = ['#' + r.tag + (r.views != null ? ' — ' + r.views + ' views' : '') + '  ' + r.url, '', 'Related:'];
        for (const t of r.related || []) lines.push('  #' + t.tag + '  ' + t.url);
        return lines.join('\n');
      });
      if (!res.ok) process.exit(1);
    });

  program
    .command('comments [account]')
    .description('Recent comments on your posts (best-effort inbox scrape).')
    .option('--limit <n>', 'max comments', '20')
    .action(async (account, opts) => {
      applyGlobals();
      const { listComments } = require('./comments');
      const res = await listComments({ account: account || globalOptions.account || 'main', limit: Number(opts.limit), headless: globalOptions.headless });
      printResult(res, (r) => {
        const lines = ['Comments (' + r.items.length + '):'];
        for (const c of r.items) lines.push('  @' + (c.author || '?') + ': ' + (c.text || '').slice(0, 100) + (c.videoId ? '  [video ' + c.videoId + ']' : ''));
        return lines.join('\n');
      });
      if (!res.ok) process.exit(1);
    });

  program
    .command('config [key] [value]')
    .description('Get/set captron config (default account, homes). No args lists all.')
    .action((key, value) => {
      applyGlobals();
      const cfg = utils.readConfig();
      if (!key) {
        printResult({ ok: true, config: cfg }, (r) => 'Config (' + utils.configPath() + '):\n' + JSON.stringify(r.config, null, 2));
        return;
      }
      if (value == null) {
        printResult({ ok: true, key, value: cfg[key] != null ? cfg[key] : null }, (r) => r.key + ' = ' + JSON.stringify(r.value));
        return;
      }
      cfg[key] = value;
      utils.writeConfig(cfg);
      printResult({ ok: true, key, value }, (r) => 'Set ' + r.key + ' = ' + JSON.stringify(r.value));
    });

  program
    .command('new <name>')
    .description('Scaffold a batch manifest + caption file for a new series.')
    .option('--count <n>', 'number of episode stubs', '5')
    .option('--niche <name>', 'fill captions with generated hooks (ai|money|fitness|story|tech)', null)
    .option('--seed <s>', 'seed for --niche hooks', 'captron')
    .action((name, opts) => {
      applyGlobals();
      const fs = require('fs');
      const n = Math.max(1, Math.min(Number(opts.count) || 5, 50));
      let hooks = [];
      if (opts.niche) {
        try {
          hooks = require('./hooks').generateHooks({ niche: opts.niche, count: n, seed: opts.seed || name });
        } catch (_) { hooks = []; }
      }
      const items = [];
      for (let i = 1; i <= n; i++) {
        const hook = hooks[i - 1];
        items.push(hook
          ? { video: './ep' + i + '.mp4', caption: hook.hook, hashtags: 'series,faceless,fyp', visibility: 'everyone' }
          : { video: './ep' + i + '.mp4', caption: name + ' — part ' + i, hashtags: 'series,faceless,fyp', visibility: 'everyone' });
      }
      const file = name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() + '.manifest.json';
      fs.writeFileSync(file, JSON.stringify(items, null, 2));
      printResult({ ok: true, file, count: n, niche: opts.niche || null }, (r) => 'Wrote ' + r.file + ' (' + r.count + ' episodes' + (r.niche ? ', niche ' + r.niche : '') + '). Edit captions, then `captron batch ' + r.file + ' --dry-run`.');
    });

  program
    .command('completion')
    .description('Print a bash/zsh completion script.')
    .action(() => {
      const script = [
        '# captron completion (bash + zsh)',
        '# usage: eval "$(captron completion)"',
        '_captron_cmds="login logout whoami accounts post probe fit posts content sync calendar caption analytics best-time audit hook download drafts batch delete trending hashtags comments config new clean doctor completion"',
        'if [ -n "$BASH_VERSION" ]; then',
        '  _captron() { local cur="${COMP_WORDS[COMP_CWORD]}"; COMPREPLY=($(compgen -W "$_captron_cmds" -- "$cur")); }',
        '  complete -F _captron captron',
        'elif [ -n "$ZSH_VERSION" ]; then',
        '  _captron() { local -a cmds; cmds=(${(s: :)_captron_cmds}); _describe "captron" cmds; }',
        '  compdef _captron captron',
        'fi',
        '',
      ].join('\n');
      process.stdout.write(script);
    });

  program
    .command('probe <file>')
    .description('Inspect a video/image for TikTok-readiness (offline: size, codec, duration, fit verdict).')
    .action((file) => {
      applyGlobals();
      const { probeFile } = require('./media');
      const res = probeFile(file);
      printResult(res, (r) => {
        if (!r.ok && r.error) return 'Probe failed: ' + r.error;
        const lines = ['Probe ' + r.file + ' (' + r.sizeHuman + ', ' + r.kind + '):'];
        if (r.durationSec != null) lines.push('  duration: ' + r.durationSec + 's');
        if (r.width) lines.push('  video:    ' + r.width + 'x' + r.height + ' ' + (r.vcodec || '') + (r.acodec ? ' + ' + r.acodec : ''));
        lines.push('  verdict:  ' + (r.fitsTikTok ? 'fits TikTok ✔' : 'needs work ✖'));
        for (const i of r.issues) lines.push('  issue:    ' + i);
        for (const w of r.warnings) lines.push('  warning:  ' + w);
        return lines.join('\n');
      });
      process.exit(res.fitsTikTok ? 0 : 1);
    });

  program
    .command('fit <input>')
    .description('Normalize a video to vertical 1080x1920 H.264/AAC MP4 via ffmpeg (offline).')
    .option('-o, --out <path>', 'output path (default: <input>.tiktok.mp4)', null)
    .option('--width <n>', 'target width', '1080')
    .option('--height <n>', 'target height', '1920')
    .option('--fps <n>', 'target fps', '30')
    .action((input, opts) => {
      applyGlobals();
      const { fitFile } = require('./media');
      const res = fitFile({ input, output: opts.out, width: Number(opts.width), height: Number(opts.height), fps: Number(opts.fps) });
      printResult(res, (r) => (r.ok ? 'Fitted ' + r.output + ' (' + utils.formatBytes(r.bytes) + ') ✔' : 'Fit failed: ' + r.error));
      process.exit(res.ok ? 0 : 1);
    });

  program
    .command('doctor')
    .description('Check environment: node, browser engines, ffmpeg, disk, profiles, session state.')
    .option('--fix', 'remove stale Chromium lock files from profiles')
    .action(async (opts) => {
      applyGlobals();
      if (opts.fix) {
        const { fixStaleLocks } = require('./media');
        const fixed = fixStaleLocks();
        utils.ok(fixed.removed.length ? 'Removed ' + fixed.removed.length + ' stale lock(s): ' + fixed.removed.join(', ') : 'No stale locks found.');
      }
      const fs = require('fs');
      const { execSync } = require('child_process');
      const { chromium } = require('playwright');
      const info = {
        node: process.version,
        home: utils.homeDir(),
        profiles: [],
        browsers: {},
        ffmpeg: 'missing (optional — only needed for local transcoding)',
        disk: null,
        env: {
          CAPTRON_ACCOUNT: process.env.CAPTRON_ACCOUNT || null,
          CAPTRON_HEADLESS: process.env.CAPTRON_HEADLESS || null,
          CAPTRON_BROWSER_CHANNEL: process.env.CAPTRON_BROWSER_CHANNEL || 'chrome',
          CAPTRON_HOME: process.env.CAPTRON_HOME || null,
        },
        loggedIn: false,
      };
      try {
        info.profiles = fs.readdirSync(utils.profilesDir()).map((d) => ({ name: d }));
      } catch (err) {}
      // Detect browser availability without launching a full session.
      for (const channel of ['chromium', 'chrome']) {
        try {
          const b = await chromium.launch({ headless: true, channel: channel === 'chrome' ? 'chrome' : undefined });
          const v = b.version();
          await b.close();
          info.browsers[channel] = 'ok (' + v + ')';
        } catch (err) {
          info.browsers[channel] = 'unavailable';
        }
      }
      try {
        const v = execSync('ffmpeg -version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n')[0];
        info.ffmpeg = v.slice(0, 80);
      } catch (_) {}
      try {
        const st = fs.statfsSync ? fs.statfsSync(utils.homeDir()) : null;
        if (st) info.disk = utils.formatBytes(Number(st.bavail) * Number(st.bsize)) + ' free';
      } catch (_) {}
      try {
        const { profileSizes } = require('./maintain');
        info.sizes = profileSizes();
      } catch (_) { info.sizes = []; }
      try {
        const context = await browserMod.launchProfile({ account: globalOptions.account || 'main', headless: true });
        info.loggedIn = await auth.isLoggedIn(context);
        await context.close();
      } catch (err) {
        info.sessionError = String(err.message).split('\n')[0];
      }
      printResult(info, (r) => {
        const lines = ['doctor:'];
        lines.push('  node:         ' + r.node);
        lines.push('  captron home: ' + r.home);
        lines.push('  chromium:     ' + (r.browsers.chromium || '?'));
        lines.push('  chrome:       ' + (r.browsers.chrome || '?'));
        lines.push('  ffmpeg:       ' + r.ffmpeg);
        if (r.disk) lines.push('  disk:        ' + r.disk);
        lines.push('  profiles:     ' + (r.profiles.length ? r.profiles.map((p) => p.name).join(', ') : '(none yet — run `captron login`)'));
        if (r.sizes && r.sizes.length) lines.push('  sizes:        ' + r.sizes.map((s) => s.name + ' ' + s.human).join(', ') + '  (free with `captron clean`)');
        lines.push('  logged in:    ' + (r.loggedIn ? 'yes' : 'NO'));
        if (r.sessionError) lines.push('  session err:  ' + r.sessionError);
        lines.push('  env:          ' + Object.entries(r.env).map(([k, v]) => k + '=' + (v || '—')).join(' '));
        return lines.join('\n');
      });
    });

  program
    .command('clean')
    .description('Free disk: prune disposable Chromium caches in profiles (sessions kept).')
    .option('--dry-run', 'report only, delete nothing')
    .action((opts) => {
      applyGlobals();
      const { cleanCaches } = require('./maintain');
      const res = cleanCaches({ dryRun: Boolean(opts.dryRun) });
      printResult(res, (r) => {
        const lines = [(r.dryRun ? 'Would free ' : 'Freed ') + r.freedHuman + ' (' + r.removed.length + ' dirs):'];
        for (const x of r.removed.slice(0, 20)) lines.push('  ' + x.profile + '/' + x.dir + '  ' + utils.formatBytes(x.bytes));
        if (r.removed.length > 20) lines.push('  … +' + (r.removed.length - 20) + ' more');
        return lines.join('\n');
      });
    });

  program
    .command('sync [account]')
    .description('One-session digest: posts + analytics + comments snapshot (daily agent cron).')
    .option('-d, --days <n>', 'analytics range: 1, 7, 28 or 60', '7')
    .option('--limit <n>', 'max posts', '20')
    .option('--comments <n>', 'max comments', '5')
    .option('--out <file>', 'write snapshot JSON to <file>', null)
    .action(async (account, opts) => {
      applyGlobals();
      const { syncAccount } = require('./sync');
      const res = await syncAccount({ account: account || globalOptions.account || 'main', days: Number(opts.days), limit: Number(opts.limit), commentsLimit: Number(opts.comments), headless: globalOptions.headless });
      if (res.ok && opts.out) {
        try {
          require('fs').writeFileSync(opts.out, JSON.stringify(res, null, 2));
          res.snapshot = opts.out;
        } catch (err) { res.snapshotError = err.message; }
      }
      printResult(res, (r) => {
        const lines = ['Sync @' + (r.handle || r.account || '?') + ' (' + r.syncedAt + '):'];
        lines.push('  posts:    ' + (r.posts ? r.posts.length : 0) + ' (totals ' + (r.totals ? r.totals.views : '?') + ' views)');
        lines.push('  metrics:  ' + Object.keys(r.metrics || {}).length + ' (last ' + r.range_days + 'd)');
        lines.push('  comments: ' + (r.comments ? r.comments.length : 0));
        if (r.snapshot) lines.push('  snapshot: ' + r.snapshot);
        if (r.snapshotError) lines.push('  snapshot error: ' + r.snapshotError);
        if (r.error) lines.push('  error: ' + r.error);
        return lines.join('\n');
      });
      if (!res.ok) process.exit(1);
    });

  program
    .command('calendar [account]')
    .description('Scheduled posts grouped by day (next N days queue view).')
    .option('--days <n>', 'lookahead window', '14')
    .option('--limit <n>', 'posts to scan', '50')
    .action(async (account, opts) => {
      applyGlobals();
      const { listPostsApi } = require('./posts');
      const res = await listPostsApi({ account: account || globalOptions.account || 'main', limit: Number(opts.limit), scheduledOnly: true, headless: globalOptions.headless });
      printResult(res, (r) => {
        const { groupScheduled } = require('./sync');
        const { days, groups, upcoming } = groupScheduled(r.items, Number(opts.days) || 14);
        const lines = ['Queue @' + (r.handle || r.account || '?') + ' (next ' + days + 'd, ' + upcoming.length + ' scheduled):'];
        for (const g of groups) {
          lines.push('  ' + g.day + ':');
          for (const it of g.items) {
            const d = new Date(it.scheduledTime);
            lines.push('    ' + d.toISOString().slice(11, 16) + '  ' + (it.caption || '(no caption)').slice(0, 44) + '  [' + it.id + ']');
          }
        }
        if (!upcoming.length) lines.push('  (empty — schedule with `captron post --schedule "..."`)');
        return lines.join('\n');
      });
      if (!res.ok) process.exit(1);
    });

  program
    .command('caption')
    .description('Build a TikTok caption offline (hook + CTA + hashtags, length-checked).')
    .option('--hook <text>', 'hook line', null)
    .option('--cta <text>', 'call to action', 'Follow for part 2')
    .option('-t, --hashtags <tags>', 'comma-separated hashtags', 'fyp')
    .option('--strict', 'exit 1 on length/hashtag warnings')
    .action((opts) => {
      applyGlobals();
      const { hookCaption } = require('./hooks');
      const { buildCaptionDetailed } = utils;
      const text = hookCaption({ hook: opts.hook || '', hashtags: opts.hashtags, cta: opts.cta });
      const { warnings } = buildCaptionDetailed({ caption: (opts.hook || '') + (opts.cta ? '\n' + opts.cta : ''), hashtags: opts.hashtags });
      if (opts.strict && warnings.length) {
        printResult({ ok: false, error: warnings.join('; ') }, (r) => 'Caption invalid: ' + r.error);
        process.exit(1);
      }
      printResult({ ok: true, caption: text, warnings }, (r) => r.caption + (r.warnings.length ? '\n  warnings: ' + r.warnings.join('; ') : ''));
    });

  return program;
}

function main(argv) {
  const program = buildProgram();
  program.parse(argv);
}

module.exports = { main, buildProgram };