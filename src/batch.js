'use strict';

const fs = require('fs');
const path = require('path');
const { launchProfile } = require('./browser');
const { performPost, handlePostError, NotLoggedInError } = require('./upload');
const { buildCaption, buildCaptionDetailed, parseSchedule, scheduleWarnings, formatDate, warn, info, ok, fail, printResult, sleep } = require('./utils');

/** Parse a manifest file (JSON array, {items:[...]}, single object, or CSV). */
function parseManifest(file) {
  const resolved = path.resolve(file);
  const content = fs.readFileSync(resolved, 'utf8');
  let specs;
  if (/\.csv$/i.test(file)) {
    specs = parseCsv(content);
  } else {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error('manifest is not valid JSON: ' + err.message);
    }
    if (Array.isArray(parsed)) specs = parsed;
    else if (parsed && Array.isArray(parsed.items)) specs = parsed.items;
    else if (parsed && typeof parsed === 'object') specs = [parsed];
    else throw new Error('manifest must be an array of post specs, {items:[...]}, or a single spec object');
  }
  return specs.map((s, i) => ({ index: i, video: s.video || s.file || s.path, caption: s.caption, hashtags: s.hashtags, schedule: s.schedule, visibility: s.visibility, account: s.account || null, draft: s.draft === true || s.draft === 'true' || s.draft === 'draft', allowComment: s.allowComment, allowDuet: s.allowDuet, allowStitch: s.allowStitch, cover: s.cover }));
}

function parseCsv(content) {
  const lines = content.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split(',');
    const obj = {};
    header.forEach((h, idx) => (obj[h] = (cells[idx] || '').trim()));
    items.push(obj);
  }
  return items;
}

/** Validate a plan without posting anything. */
function buildPlan(specs, { defaultAccount, defaultDraft }) {
  return specs.map((s) => {
    const scheduleDate = parseSchedule(s.schedule);
    const toBool = (v) => (v === true || v === 'true' || v === 'yes' || v === '1' ? true : v === false || v === 'false' || v === 'no' || v === '0' ? false : null);
    const detailed = buildCaptionDetailed({ caption: s.caption, hashtags: s.hashtags });
    return {
      index: s.index,
      video: s.video,
      caption: detailed.text,
      warnings: [...detailed.warnings, ...scheduleWarnings(scheduleDate)],
      schedule: s.schedule,
      scheduleDate, // actual Date (used to post)
      scheduleLabel: formatDate(scheduleDate), // display only
      visibility: s.visibility || 'everyone',
      account: s.account || defaultAccount,
      draft: s.draft === true ? true : defaultDraft,
      allowComment: toBool(s.allowComment),
      allowDuet: toBool(s.allowDuet),
      allowStitch: toBool(s.allowStitch),
      cover: s.cover != null && s.cover !== '' ? Number(s.cover) : null,
      errors: validateSpec(s, scheduleDate),
    };
  });
}

function validateSpec(s, scheduleDate) {
  const errors = [];
  if (!s.video) errors.push('missing video');
  else if (!fs.existsSync(path.resolve(s.video))) errors.push('video not found: ' + s.video);
  if (s.schedule && !scheduleDate) errors.push('unparseable schedule: ' + s.schedule);
  if (s.visibility && !['everyone', 'friends', 'private'].includes(s.visibility)) errors.push('bad visibility: ' + s.visibility);
  return errors;
}

/** Run a batch: post every spec, respecting per-account sessions + delay. */
async function runBatch({ manifest, defaultAccount = 'main', defaultDraft = false, delaySec = 0, jitterSec = 0, strict = false, dryRun = false, headless = false, maxPerDay = 0, stopOnError = false, shuffle = false, resumeFrom = null, stateFile = null } = {}) {
  let specs = parseManifest(manifest);
  if (shuffle) {
    for (let i = specs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [specs[i], specs[j]] = [specs[j], specs[i]];
    }
    specs.forEach((s, i) => (s.index = i));
  }
  let plan = buildPlan(specs, { defaultAccount, defaultDraft });
  if (strict) {
    for (const p of plan) {
      if (p.warnings && p.warnings.length) p.errors.push('strict: ' + p.warnings.join('; '));
    }
  }
  const bad = plan.filter((p) => p.errors.length);
  if (bad.length) {
    for (const b of bad) fail('spec #' + (b.index + 1) + ': ' + b.errors.join('; ') + '  => ' + b.video);
    return { ok: false, total: specs.length, invalid: bad.length, planned: 0, results: [], reason: 'invalid specs' };
  }
  if (maxPerDay > 0 && plan.length > maxPerDay) {
    plan = plan.slice(0, maxPerDay); // defensive cap for volume runs
    warn('Capped batch to ' + maxPerDay + ' posts (--max-per-day).');
  }
  // Resume: skip items already recorded as ok in a previous state file.
  let doneSet = new Set();
  if (resumeFrom || stateFile) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.resolve(resumeFrom || stateFile), 'utf8'));
      const arr = Array.isArray(prev) ? prev : prev.results || [];
      for (const r of arr) if (r && r.ok && r.video) doneSet.add(path.resolve(r.video));
    } catch (_) { /* fresh start */ }
    const before = plan.length;
    plan = plan.filter((p) => !doneSet.has(path.resolve(p.video || '')));
    if (plan.length !== before) info('Resuming: skipped ' + (before - plan.length) + ' already-posted items.');
  }
  if (dryRun) {
    const table = plan.map((p) => ({ video: p.video, caption: p.caption, schedule: p.schedule, account: p.account, draft: p.draft, warnings: p.warnings }));
    return { ok: true, dryRun: true, total: table.length, results: table };
  }
  info('Batch: ' + plan.length + ' posts (' + (defaultDraft ? 'DRAFT MODE' : 'LIVE PUBLISH') + ')');
  const contexts = {};
  const results = [];
  let failed = 0;
  try {
    for (const spec of plan) {
      const acct = spec.account || defaultAccount;
      if (!contexts[acct]) contexts[acct] = await launchProfile({ account: acct, headless });
      const result = { index: spec.index, video: spec.video, account: acct, ok: false };
      try {
        if (spec.draft) info('[' + (spec.index + 1) + '/' + specs.length + '] saving draft: ' + spec.video);
        else info('[' + (spec.index + 1) + '/' + specs.length + '] posting: ' + spec.video);
        const r = await performPost({
          context: contexts[acct],
          videoPath: path.resolve(spec.video),
          caption: spec.caption,
          schedule: spec.scheduleDate, // real Date
          visibility: spec.visibility,
          saveDraft: Boolean(spec.draft),
          allowComment: spec.allowComment,
          allowDuet: spec.allowDuet,
          allowStitch: spec.allowStitch,
          cover: spec.cover,
        });
        Object.assign(result, r);
        ok('  -> ' + (r.itemId || r.url || 'done'));
      } catch (err) {
        result.error = err.message;
        result.failed = true;
        failed++;
        if (err instanceof NotLoggedInError) {
          fail('  error: ' + err.message);
          throw err; // login failures always stop the run
        }
        fail('  error: ' + err.message);
        if (stopOnError) throw err;
        // default: continue with the next item (batch is for volume)
      } finally {
        results.push(result);
        if (stateFile) {
          try { fs.writeFileSync(path.resolve(stateFile), JSON.stringify({ manifest, results }, null, 2)); } catch (_) {}
        }
        const waitSec = Number(delaySec) || 0;
        const jitSec = Math.max(0, Number(jitterSec) || 0);
        const total = waitSec + (jitSec > 0 ? Math.random() * jitSec : 0);
        if (total > 0 && spec.index < specs.length - 1) {
          info('  waiting ' + Math.round(total) + 's before next…');
          await sleep(total * 1000);
        }
      }
    }
  } finally {
    for (const cx of Object.values(contexts)) await cx.close().catch(() => {});
  }
  const okCount = results.filter((r) => r.ok).length;
  return { ok: failed === 0 && okCount === results.length, total: specs.length, posted: plan.length, skipped: specs.length - plan.length, okCount, failed, results };
}

module.exports = { parseManifest, buildPlan, runBatch };