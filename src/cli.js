'use strict';

const { Command } = require('commander');
const utils = require('./utils');
const { buildCaption, parseSchedule, validateVideoPath, formatDate, humanize, printResult } = utils;
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
    account: opts.account || utils.activeAccount(),
    headless: opts.headless || process.env.CAPTRON_HEADLESS === '1',
  };
  utils.setVerbose(opts.verbose || process.env.CAPTRON_VERBOSE === '1' || false);
  utils.setJson(opts.json || false);
}

async function runPost(videoArg, opts) {
  applyGlobals();
  const video = videoArg;

  const vcheck = validateVideoPath(video);
  if (!vcheck.ok) {
    utils.fail(vcheck.error);
    process.exit(1);
  }

  let scheduleDate = parseSchedule(opts.schedule);
  if (opts.schedule && !scheduleDate) {
    utils.fail('Could not parse --schedule "' + opts.schedule + '". Use ISO "YYYY-MM-DD HH:mm", "today 18:00", "tomorrow 09:00" or "+90m"/"+3d".');
    process.exit(1);
  }
  if (scheduleDate && scheduleDate.getTime() <= Date.now()) {
    utils.fail('--schedule must be in the future (' + scheduleDate.toISOString() + ').');
    process.exit(1);
  }

  const caption = buildCaption({ caption: opts.caption, hashtags: opts.hashtags });

  utils.step('Posting "' + vcheck.path + '" (' + utils.formatBytes(vcheck.size) + ') to account "' + globalOptions.account + '"');
  if (caption) utils.step('Caption: ' + caption.replace(/\n/g, ' | '));
  if (opts.schedule) utils.step('Scheduled for: ' + formatDate(scheduleDate));
  if (opts.draft) utils.step('Mode: save DRAFT (no publish)');

  const context = await browserMod.launchProfile({ account: globalOptions.account, headless: globalOptions.headless });
  const started = Date.now();
  let result;
  try {
    result = await uploadLib.performPost({
      context,
      videoPath: vcheck.path,
      caption,
      schedule: scheduleDate,
      visibility: opts.visibility,
      saveDraft: opts.draft || false,
    });
  } catch (err) {
    uploadLib.handlePostError(err);
    return;
  } finally {
    await context.close().catch(() => {});
  }
  result.account = globalOptions.account;
  result.video = vcheck.path;
  result.durationSec = Math.round((Date.now() - started) / 1000);
  printResult(result, (r) =>
    [
      '',
      r.ok ? 'Post ' + r.status + ' ✔' : 'Post status: ' + (r.status || 'unknown'),
      '  video:     ' + r.video,
      '  account:   ' + r.account,
      r.itemId ? '  item id:   ' + r.itemId : '',
      r.projectId ? '  project:   ' + r.projectId : '',
      r.url ? '  url:       ' + r.url : '',
      '  took:      ' + humanize(r.durationSec),
      r.failed ? '  error:     ' + r.error : '',
    ]
      .filter(Boolean)
      .join('\n')
  );
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
    .description('Log in to a TikTok account (QR code). State persists for later use.')
    .option('-t, --timeout <seconds>', 'login timeout in seconds', '300')
    .action(async (account, opts) => {
      applyGlobals();
      const res = await auth.login({ account: account || globalOptions.account || 'main', timeoutSec: Number(opts.timeout), headless: globalOptions.headless });
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
    .description('Upload a video and post it (with caption, hashtags, schedule, visibility) in one action.')
    .option('-c, --caption <text>', 'video caption text')
    .option('-t, --hashtags <tags>', 'comma-separated hashtags (no # needed)')
    .option('-s, --schedule <when>', 'schedule: "YYYY-MM-DD HH:mm" | "tomorrow HH:mm" | "today HH:mm" | "+2h" | "+3d"')
    .option('-v, --visibility <who>', 'visibility: everyone | friends | private')
    .option('-d, --draft', 'save as draft instead of publishing')
    .action(runPost);

  program
    .command('posts [account]')
    .description('List published posts with stats (views, likes, comments, shares) and download URLs.')
    .option('--limit <n>', 'max posts', '20')
    .action(async (account, opts) => {
      applyGlobals();
      const { listPostsApi } = require('./posts');
      const res = await listPostsApi({ account: account || globalOptions.account || 'main', limit: Number(opts.limit), headless: globalOptions.headless });
      printResult(res, (r) => {
        const lines = ['Posts on @' + (r.handle || r.account || '?') + ' (' + r.items.length + '):'];
        for (const it of r.items) {
          const s = it.stats || {};
          const when = it.createTime ? new Date(it.createTime).toISOString().slice(0, 10) : '?';
          lines.push('  ' + it.id + '  ' + when + '  ' + (it.caption || '(no caption)').slice(0, 40));
          lines.push('      views ' + (s.views != null ? s.views : '?') + ' · likes ' + (s.likes != null ? s.likes : '?') + ' · comments ' + (s.comments != null ? s.comments : '?') + ' · shares ' + (s.shares != null ? s.shares : '?') + (it.inReview ? '  [in review]' : ''));
        }
        if (r.error) lines.push('  error: ' + r.error);
        return lines.join('\n');
      });
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
          lines.push('  ' + (it.id || '?') + '  ' + (it.caption || '').slice(0, 44) + '  ' + (it.url || ''));
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
    .action(async (account, opts) => {
      applyGlobals();
      const { analytics } = require('./analytics');
      const res = await analytics({ account: account || globalOptions.account || 'main', days: Number(opts.days), posts: Number(opts.posts), headless: globalOptions.headless });
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
    .option('--max-per-day <n>', 'hard cap on posts per run', '0')
    .option('--dry-run', 'validate the manifest and print the plan without posting')
    .action(async (manifest, opts) => {
      applyGlobals();
      const res = await batchLib.runBatch({
        manifest,
        defaultAccount: globalOptions.account,
        defaultDraft: opts.draft || false,
        delaySec: Number(opts.delay),
        dryRun: opts.dryRun || false,
        headless: globalOptions.headless,
        maxPerDay: Number(opts.maxPerDay),
      });
      printResult(res, (r) => {
        if (r.dryRun) {
          const lines = ['Dry run — ' + r.total + ' posts planned:'];
          for (const t of r.results) lines.push('  ' + t.video + '  -> @' + t.account + (t.schedule ? ' @ ' + t.schedule : '') + (t.draft ? ' [draft]' : ' [live]'));
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
    .command('doctor')
    .description('Check environment: node, browser engines, profiles, session state.')
    .action(async () => {
      applyGlobals();
      const fs = require('fs');
      const { chromium } = require('playwright');
      const info = {
        node: process.version,
        home: utils.homeDir(),
        profiles: [],
        browsers: {},
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
      const context = await browserMod.launchProfile({ account: globalOptions.account || 'main', headless: true });
      info.loggedIn = await auth.isLoggedIn(context);
      await context.close();
      printResult(info, (r) => {
        const lines = ['doctor:'];
        lines.push('  node:         ' + r.node);
        lines.push('  captron home: ' + r.home);
        lines.push('  chromium:     ' + (r.browsers.chromium || '?'));
        lines.push('  chrome:       ' + (r.browsers.chrome || '?'));
        lines.push('  profiles:     ' + (r.profiles.length ? r.profiles.map((p) => p.name).join(', ') : '(none yet — run `captron login`)'));
        lines.push('  logged in:    ' + (r.loggedIn ? 'yes' : 'NO'));
        return lines.join('\n');
      });
    });

  return program;
}

function main(argv) {
  const program = buildProgram();
  program.parse(argv);
}

module.exports = { main, buildProgram };