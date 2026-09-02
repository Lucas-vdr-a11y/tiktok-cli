'use strict';

const path = require('path');
const { URLS, SELECTORS, VISIBILITY_OPTIONS, findPublishButton, findButtonByLabel, resolveHandle } = require('./selectors');
const { verbose, warn, fail, step, ok, sleep } = require('./utils');

class NotLoggedInError extends Error {
  constructor(message) {
    super(message || 'Not logged in to TikTok. Run `captron login` first.');
    this.name = 'NotLoggedInError';
  }
}

const SCHEDULE_LABELS = ['schedule', 'plannen', 'planning', 'planificar', 'planifier', 'planifica', '定时发布', '予約', '예약'];
const DRAFT_LABELS = ['save draft', 'concept opslaan', 'bewaar concept', 'guardar borrador', 'enregistrer le brouillon', 'brouillon', 'speichern', 'salva bozza', '保存草稿', '下書きを保存', '임시저장', 'draft'];

/** Click common dismissible overlays if present (safe whitelist only). */
async function dismissOverlays(page) {
  const labels = ['got it', 'begrepen', 'ok', 'okay', 'dismiss', 'sluiten', 'close', '我知道了', 'わかった', '확인'];
  for (const label of labels) {
    const btn = await findButtonByLabel(page, [label]);
    if (btn) {
      const handles = await page.$$('button');
      if (handles[btn.idx]) {
        await handles[btn.idx].click({ timeout: 1500 }).catch(() => {});
        verbose('dismissed overlay "' + label + '"');
      }
    }
  }
}

/** Ensure the TikTok session is active before starting a flow. */
async function assertLoggedIn(context) {
  const cookies = await context.cookies('https://www.tiktok.com');
  const has = cookies.some((c) => c.name === 'sessionid' && c.value.length > 5);
  if (!has) {
    throw new NotLoggedInError('Not logged in to TikTok. Run `captron login` first.');
  }
}

async function gotoUpload(context, page) {
  await page.goto(URLS.upload, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
    verbose('goto upload failed, retrying once: ' + err.message.split('\n')[0]);
  });
  await sleep(1500);
  await assertLoggedIn(context);
  await dismissOverlays(page);
}

// ---------------------------------------------------------------------------
// Editor interactions
// ---------------------------------------------------------------------------

/** Wait until the post editor is ready (video uploaded, caption editor present). */
async function waitForEditor(page, { uploadTimeoutSec = 180 } = {}) {
  const deadline = Date.now() + uploadTimeoutSec * 1000;
  let last = 0;
  while (Date.now() < deadline) {
    const state = await page
      .evaluate(() => {
        const editor = document.querySelector('.public-DraftEditor-content');
        const replace = Array.from(document.querySelectorAll('button')).some((b) =>
          /replace|vervangen|reemplazar|替换|入れ替え|ganti/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || ''))
        );
        const body = document.body ? document.body.innerText.slice(0, 1500) : '';
        return { editor: !!editor, replace, body };
      })
      .catch(() => ({ editor: false, replace: false, body: '' }));

    // upload error / rejected file detection
    if (/maximum size|too long|exceeds|bestand is te groot|niet ondersteund|unsupported|failed to upload/i.test(state.body)) {
      throw new Error('TikTok rejected the file (check size/duration/format).');
    }

    if (state.editor && state.replace) return;

    const now = Date.now();
    if (now - last > 3000) {
      last = now;
      verbose('waiting for post editor... ' + Math.round((now - (deadline - uploadTimeoutSec * 1000)) / 1000) + 's');
    }
    await sleep(1500);
  }
  throw new Error('Timed out waiting for the editor after upload (' + uploadTimeoutSec + 's). The video may still be processing.');
}

/** Type into the Draft.js caption composer. */
async function fillCaption(page, text) {
  if (!text) return;
  const ok = await page
    .evaluate((cap) => {
      const ed = document.querySelector('.public-DraftEditor-content');
      if (!ed) return false;
      ed.focus();
      // Draft.js listens to beforeinput; insertText is the most reliable programmatic path
      document.execCommand('insertText', false, cap);
      return true;
    }, text)
    .catch(() => false);
  if (!ok) throw new Error('Could not find the caption editor on the post page.');
  await sleep(500);
  await page.evaluate(() => {
    const ed = document.querySelector('.public-DraftEditor-content');
    if (ed) ed.dispatchEvent(new Event('input', { bubbles: true }));
  }).catch(() => {});
}

/** Set who-can-watch. Best effort: TikTok defaults to "everyone". */
async function setVisibility(page, visibility) {
  if (!visibility) return false;
  const options = VISIBILITY_OPTIONS[visibility];
  if (!options) {
    warn('Unknown visibility "' + visibility + '". Supported: ' + Object.keys(VISIBILITY_OPTIONS).join(', '));
    return false;
  }
  const current = await findButtonByLabel(page, VISIBILITY_OPTIONS[visibility]);
  if (current) return true; // already correct
  const control = await findButtonByLabel(page, ['everyone', 'iedereen', 'público', 'public', 'alle', '公开', 'すべてのユーザー']);
  if (!control) { warn('Visibility control not found; leaving default.'); return false; }
  const handles = await page.$$('button');
  await handles[control.idx].click().catch(() => {});
  await sleep(800);
  const target = await findButtonByLabel(page, options);
  if (!target) { warn('Visibility option not found in the menu.'); return false; }
  const h2 = await page.$$('button');
  await h2[target.idx].click().catch(() => {});
  await sleep(500);
  return true;
}

// ---------------------------------------------------------------------------
// Finalize: publish now / schedule / save draft
// ---------------------------------------------------------------------------

/** Resolve once a response matches the publish RPC URL pattern. */
function nextRpcResponse(page, pattern) {
  return new Promise((resolve) => {
    const handler = (res) => {
      if (pattern.test(res.url())) {
        page.off('response', handler);
        resolve(res);
      }
    };
    page.on('response', handler);
  });
}

async function parseRpcBody(res) {
  try {
    const body = await res.json();
    return body;
  } catch (err) {
    return { raw: true };
  }
}

/** Extract item id / project id from the project/post RPC body. */
function extractIds(body) {
  const out = { projectId: null, itemId: null };
  if (!body || typeof body !== 'object') return out;
  if (body.project_id) out.projectId = String(body.project_id);
  const list = body.single_post_resp_list;
  if (Array.isArray(list) && list[0]) {
    if (list[0].item_id) out.itemId = String(list[0].item_id);
    if (list[0].status_code !== undefined) out.statusCode = list[0].status_code;
  } else if (body.item_id) {
    out.itemId = String(body.item_id);
  }
  return out;
}

/**
 * Click the Post (or Save draft) button and wait for TikTok's confirmation.
 * Returns { status, itemId, projectId, url }.
 */
async function finalizePost(page, { saveDraft = false, rpcPattern } = {}) {
  const pattern = rpcPattern || /\/tiktok\/web\/project\/post\/v1\//;

  // The publish button is often disabled until content checks finish; poll.
  const deadline = Date.now() + 150e3;
  let action = null;
  while (Date.now() < deadline) {
    if (saveDraft) action = await findButtonByLabel(page, DRAFT_LABELS);
    if (!action) action = await findPublishButton(page);
    if (action && !action.disabled) break;
    action = null;
    await sleep(1500);
  }
  if (!action) throw new Error('Could not find a clickable Post / Save draft button.');

  const rpcPromise = nextRpcResponse(page, pattern);
  const handles = await page.$$('button');
  await handles[action.idx].click().catch((err) => {
    fail('click failed: ' + err.message);
  });
  verbose('clicked "' + (action.text || action.aria) + '"');

  // Wait for the RPC response or a redirect to the content dashboard.
  const outcome = await Promise.race([
    rpcPromise.then(async (res) => {
      const body = await parseRpcBody(res);
      const ids = extractIds(body);
      return Object.assign({ status: saveDraft ? 'draft' : 'published', url: null }, ids, { ok: true });
    }),
    new Promise((resolve) => {
      const timer = setInterval(() => {
        const url = page.url();
        const m = /\/video\/(\d+)/.exec(url);
        if (/\/tiktokstudio\/content/.test(url)) {
          clearInterval(timer);
          resolve({ status: saveDraft ? 'draft' : 'published', itemId: null, projectId: null, url: url, ok: true });
        } else if (m) {
          clearInterval(timer);
          resolve({ status: 'published', itemId: m[1], projectId: null, url: url, ok: true });
        }
      }, 500);
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out waiting for TikTok to confirm the post.')), 60e3)),
  ]);

  return outcome;
}

/** Try to open the schedule picker. Returns true when the picker opened. */
async function openScheduler(page) {
  const btn = await findButtonByLabel(page, SCHEDULE_LABELS);
  if (!btn) return false;
  const handles = await page.$$('button');
  await handles[btn.idx].click().catch(() => {});
  await sleep(800);
  return true;
}

/**
 * Best-effort scheduler. The schedule panel varies per locale; when the exact
 * controls cannot be found we warn and fall back to publishing now.
 * Returns true when a schedule was set.
 */
async function configureSchedule(page, date) {
  if (!date) return false;
  const opened = await openScheduler(page);
  if (!opened) {
    warn('Schedule control not found; posting immediately instead (use --draft to build a queue safely).');
    return false;
  }
  await sleep(1200);

  const filled = await page
    .evaluate((iso) => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const dateIn = inputs.find((i) => i.type === 'date' || i.type === 'datetime-local');
      if (dateIn) {
        dateIn.value = iso.slice(0, 10);
        dateIn.dispatchEvent(new Event('input', { bubbles: true }));
        dateIn.dispatchEvent(new Event('change', { bubbles: true }));
        return 'date';
      }
      return null;
    }, date.toISOString())
    .catch(() => null);

  const timeSet = await page
    .evaluate((hhmm) => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const timeIn = inputs.find((i) => i.type === 'time');
      if (timeIn) {
        timeIn.value = hhmm;
        timeIn.dispatchEvent(new Event('input', { bubbles: true }));
        timeIn.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, (String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')))
    .catch(() => false);

  return filled === 'date' || timeSet;
}

/**
 * Full combined action: upload a video, write the caption, set options and
 * publish (or save as draft) — everything an agent needs in one call.
 */
async function performPost({ context, videoPath, caption, schedule, visibility, saveDraft = false, onProgress } = {}) {
  const page = await context.newPage();
  try {
    await gotoUpload(context, page);
    step('Uploading ' + path.basename(videoPath) + ' ...');
    await page.setInputFiles(SELECTORS.fileInput, videoPath);

    await waitForEditor(page, { uploadTimeoutSec: 300, onProgress });
    ok('Video uploaded — editor ready');

    if (caption) {
      await fillCaption(page, caption);
      ok('Caption set');
    }

    if (visibility) {
      await setVisibility(page, visibility);
    }

    let scheduledAt = null;
    if (schedule) {
      const did = await configureSchedule(page, schedule);
      if (did) {
        scheduledAt = schedule;
        ok('Scheduled for ' + schedule.toISOString());
      }
    }

    const final = await finalizePost(page, { saveDraft });
    const handle = await resolveHandle(page).catch(() => null);

    return {
      ok: true,
      status: saveDraft ? 'draft' : 'published',
      itemId: final.itemId,
      projectId: final.projectId,
      url: final.url || (handle ? 'https://www.tiktok.com/@' + handle.replace(/^\//, '') + '/video/' + (final.itemId || '') : null),
      handle,
      scheduledAt,
    };
  } finally {
    // tidy up extra pages
    const pages = context.pages();
    for (const p of pages) if (p !== page) await p.close().catch(() => {});
  }
}

/** Central error handling for post-like flows. */
function handlePostError(err) {
  if (err instanceof NotLoggedInError) {
    fail(err.message);
    fail('Run `captron login` (or `captron login <account>`) and try again.');
  } else {
    fail('Posting failed: ' + err.message);
  }
  process.exit(1);
}

module.exports = {
  assertLoggedIn,
  gotoUpload,
  waitForEditor,
  fillCaption,
  setVisibility,
  openScheduler,
  configureSchedule,
  performPost,
  handlePostError,
  dismissOverlays,
  NotLoggedInError,
};
