'use strict';

const fs = require('fs');
const path = require('path');
const { launchProfile } = require('./browser');
const { performPost, handlePostError, NotLoggedInError } = require('./upload');
const { buildCaption, parseSchedule, formatDate, warn, info, ok, fail, printResult, sleep } = require('./utils');

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
  return specs.map((s, i) => ({ index: i, video: s.video || s.file || s.path, caption: s.caption, hashtags: s.hashtags, schedule: s.schedule, visibility: s.visibility, account: s.account || null, draft: s.draft === true || s.draft === 'true' || s.draft === 'draft' }));
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
    return {
      index: s.index,
      video: s.video,
      caption: buildCaption({ caption: s.caption, hashtags: s.hashtags }),
      schedule: s.schedule,
      scheduleDate, // actual Date (used to post)
      scheduleLabel: formatDate(scheduleDate), // display only
      visibility: s.visibility || 'everyone',
      account: s.account || defaultAccount,
      draft: s.draft === true ? true : defaultDraft,
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
async function runBatch({ manifest, defaultAccount = 'main', defaultDraft = false, delaySec = 0, dryRun = false, headless = false, maxPerDay = 0 } = {}) {
  const specs = parseManifest(manifest);
  const plan = buildPlan(specs, { defaultAccount, defaultDraft });

  const bad = plan.filter((p) => p.errors.length);
  if (bad.length) {
    for (const b of bad) fail('spec #' + (b.index + 1) + ': ' + b.errors.join('; ') + '  => ' + b.video);
    return { ok: false, total: specs.length, invalid: bad.length, planned: 0, results: [], reason: 'invalid specs' };
  }

  if (maxPerDay > 0 && plan.length > maxPerDay) {
    plan.length = maxPerDay; // defensive cap for volume runs
    warn('Capped batch to ' + maxPerDay + ' posts (--max-per-day).');
  }

  if (dryRun) {
    const table = plan.map((p) => ({ video: p.video, caption: p.caption, schedule: p.schedule, account: p.account, draft: p.draft }));
    return { ok: true, dryRun: true, total: table.length, results: table };
  }

  info('Batch: ' + plan.length + ' posts (' + (defaultDraft ? 'DRAFT MODE' : 'LIVE PUBLISH') + ')');
  const contexts = {};
  const results = [];
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
        });
        Object.assign(result, r);
        ok('  -> ' + (r.itemId || r.url || 'done'));
      } catch (err) {
        result.error = err.message;
        result.failed = true;
        if (!(err instanceof NotLoggedInError)) fail('  error: ' + err.message);
        throw err; // stop on first hard failure (login etc)
      } finally {
        results.push(result);
        if (delaySec > 0 && spec.index < specs.length - 1) {
          info('  waiting ' + delaySec + 's before next…');
          await sleep(delaySec * 1000);
        }
      }
    }
  } finally {
    for (const cx of Object.values(contexts)) await cx.close().catch(() => {});
  }
  const okCount = results.filter((r) => r.ok).length;
  return { ok: okCount === results.length, total: specs.length, okCount, results };
}

module.exports = { parseManifest, buildPlan, runBatch };