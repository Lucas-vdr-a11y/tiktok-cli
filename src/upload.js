'use strict';

const path = require('path');
const { URLS, SELECTORS, VISIBILITY_OPTIONS, findPublishButton, findButtonByLabel, resolveHandle } = require('./selectors');
const { verbose, warn, fail, step, ok, sleep, isVerbose } = require('./utils');

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

/**
 * Remove TikTok's onboarding tour (react-joyride). Its full-screen overlay
 * intercepts every pointer event, so any later click times out. Try the tour's
 * own skip button first (clears tour state), then force-remove the portal.
 */
async function clearTour(page) {
  const removed = await page
    .evaluate(() => {
      let count = 0;
      const btns = Array.from(document.querySelectorAll('button'));
      const skip = btns.find((b) => /^(skip tour|skip|close|sluiten|overslaan|saltar|wyniki pomijania)$/i.test((b.innerText || '').trim()));
      if (skip) skip.click();
      const portal = document.querySelector('#react-joyride-portal');
      if (portal) {
        count++;
        portal.remove();
      } else {
        document.querySelectorAll('.react-joyride__overlay, .react-joyride__tooltip').forEach((el) => {
          el.remove();
          count++;
        });
      }
      return count;
    })
    .catch(() => 0);
  if (removed) verbose('removed onboarding tour overlay (' + removed + ' node[s])');
  return removed > 0;
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
  await clearTour(page);
}

/**
 * Wait until the hidden file input exists AND the surrounding app has settled.
 * React hydration wires the input's change handler late — setting files too
 * early silently does nothing (the page just keeps showing "Select video to
 * upload"). "Settled" = input present and its DOM signature unchanged for two
 * consecutive polls.
 */
async function waitForFileInput(page, { timeoutSec = 30 } = {}) {
  const deadline = Date.now() + timeoutSec * 1000;
  let prev = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const key = await page
      .evaluate(() => {
        const el = document.querySelector('input[type="file"]');
        if (!el || !el.isConnected) return null;
        const form = el.closest('form');
        return [el.accept, el.name, el.className, form ? form.className : '', el.parentElement ? el.parentElement.className : ''].join('|');
      })
      .catch(() => null);
    if (key !== null) {
      stable = key === prev ? stable + 1 : 0;
      prev = key;
      if (stable >= 2) return true;
    } else {
      stable = 0;
      prev = null;
    }
    await sleep(1500);
  }
  throw new Error('The upload page never exposed a file input (not logged in or blocked?). Try `captron login`.');
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

    // Upload error / rejected file detection. The upload page ALWAYS renders
    // static helper copy ("Maximum size: 30 GB, video duration: 60 minutes.",
    // "Recommended: .mp4", ...) — strip that before scanning for real errors.
    const cleaned = state.body
      .replace(/maximum size:\s*\d+\s*[gm]b[^.]*\.?/gi, ' ')
      .replace(/video duration:\s*\d+\s*(minutes?|minuten?|min)\.?/gi, ' ');
    const rejectMatch = cleaned.match(
      /.{0,90}(too long|exceeds|niet ondersteund|unsupported|failed to upload|upload failed|unable to upload|te groot|something went wrong).{0,90}/i
    );
    if (rejectMatch && !(state.editor && state.replace)) {
      await page.screenshot({ path: '/tmp/captron-reject.png', fullPage: false }).catch(() => {});
      throw new Error('TikTok rejected the upload — page said: "' + rejectMatch[0].replace(/\s+/g, ' ').trim() + '" (screenshot: /tmp/captron-reject.png)');
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

/** Parse a JSON RPC body (tolerant). */
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

/** Broad publish/draft RPC patterns seen across TikTok Studio versions. */
const RPC_PATTERNS = [
  /\/tiktok\/web\/project\/post\/v1\//i, // legacy
  /\/tiktok\/v1\/web\/project\/post\/v1\//i, // current studio
  /\/tiktok\/web\/project\/draft\/v1\//i,
  /\/tiktok\/v1\/web\/project\/draft\/v1\//i,
];

/** Install a response logger recording recent TikTok API calls (diagnostics). */
function installApiLog(page) {
  page._apiLog = [];
  page.on('response', (res) => {
    const url = res.url();
    if (/\/tiktok\//.test(url) && !/\.(js|css|png|jpg|webp|mp4|woff2?)/.test(url)) {
      page._apiLog.push('[' + res.status() + '] ' + url.replace('https://www.tiktok.com', ''));
      if (page._apiLog.length > 40) page._apiLog.shift();
    }
  });
}

/**
 * Click the Post (or Save draft) button and wait for TikTok's confirmation.
 * Confirmation = a publish/draft RPC response, a redirect to the content
 * dashboard / video page, or a success signal in the DOM.
 * Returns { status, itemId, projectId, url }.
 */
async function finalizePost(page, { saveDraft = false } = {}) {

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

  const rpcPromise = new Promise((resolve) => {
    const handler = (res) => {
      const url = res.url();
      if (isVerbose() && /\/tiktok\//.test(url) && !/\.(js|css|png|jpg|webp|mp4)/.test(url)) {
        verbose('api <- [' + res.status() + '] ' + url.replace('https://www.tiktok.com', ''));
      }
      if (RPC_PATTERNS.some((p) => p.test(url))) {
        page.off('response', handler);
        resolve(res);
      }
    };
    page.on('response', handler);
  });

  // Click via a raw DOM click dispatched in-page. TikTok's tour overlay
  // (`react-joyride__overlay`) intercepts pointer events, which makes
  // Playwright's actionability checks time out. A direct .click() bypasses
  // hit-testing and is what the reverse-engineered flow uses.
  const clicked = await page
    .evaluate((label) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const target = btns.find((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase() === label.toLowerCase());
      if (!target) return false;
      target.click();
      return true;
    }, action.text || action.aria)
    .catch(() => false);
  if (!clicked) {
    fail('could not dispatch click on "' + (action.text || action.aria) + '"');
  }
  verbose('clicked "' + (action.text || action.aria) + '" (raw dispatch)');

  // TikTok may show a confirmation modal ("Continue posting? We're still
  // checking the video..."). Confirm it so the publish actually proceeds.

  // TikTok may show a confirmation modal ("Continue posting? We're still
  // checking the video..."). Confirm it so the publish actually proceeds.
  await confirmPostModal(page);

  const startUrl = page.url();
  const outcome = await Promise.race([
    rpcPromise.then(async (res) => {
      const body = await parseRpcBody(res);
      const ids = extractIds(body);
      verbose('publish rpc [' + res.status() + '] ids=' + JSON.stringify(ids));
      return Object.assign({ status: saveDraft ? 'draft' : 'published', url: null, via: 'rpc' }, ids, { ok: true });
    }),
    new Promise((resolve) => {
      // URL / DOM signals -- some flows never replay the RPC within our window.
      const timer = setInterval(async () => {
        try {
          const url = page.url();
          const m = /\/video\/(\d+)/.exec(url);
          if (/\/tiktokstudio\/content/.test(url) && url !== startUrl) {
            clearInterval(timer);
            resolve({ status: saveDraft ? 'draft' : 'published', itemId: null, projectId: null, url, ok: true, via: 'redirect' });
            return;
          }
          if (m) {
            clearInterval(timer);
            resolve({ status: 'published', itemId: m[1], projectId: null, url, ok: true, via: 'redirect' });
            return;
          }
          const sig = await page
            .evaluate(() => {
              const text = document.body ? document.body.innerText.slice(0, 3000) : '';
              const success = /(your video (has been|is) (uploaded|published)|successfully (uploaded|published)|has been uploaded|video uploaded|manage posts|back to tiktok studio)/i.test(text);
              const fail = /(upload failed|failed to upload|something went wrong|please try again)/i.test(text);
              return { success, fail, snippet: text.replace(/\s+/g, ' ').slice(0, 200) };
            })
            .catch(() => null);
          if (sig && sig.fail) {
            clearInterval(timer);
            resolve({ status: 'failed', ok: false, error: 'TikTok reported an upload failure: "' + sig.snippet + '"', via: 'dom' });
          } else if (sig && sig.success) {
            clearInterval(timer);
            resolve({ status: saveDraft ? 'draft' : 'published', itemId: null, projectId: null, url: page.url(), ok: true, via: 'dom' });
          }
        } catch (err) { /* page navigating -- keep polling */ }
      }, 1000);
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('__CONFIRM_TIMEOUT__')), 120e3)),
  ]);

  if (outcome && outcome.ok === false) {
    await page.screenshot({ path: '/tmp/captron-reject.png', fullPage: false }).catch(() => {});
    throw new Error(outcome.error || 'TikTok reported a failure.');
  }
  return outcome;
}

/**
 * TikTok sometimes shows a confirmation modal after the first "Post" click
 * ("Continue with posting? We're still checking the video..."). The publish
 * only proceeds after clicking the modal's confirm button (e.g. "Nu plaatsen",
 * "Post now", "Publier maintenant"). This polls for the modal and clicks it.
 * Returns true when the modal was confirmed.
 */
async function confirmPostModal(page, { waitMs = 30000 } = {}) {
  const cancelRe = /cancel|annuleren|annuler|cancelar|abbrechen|取消|キャンセル|취소/i;
  const confirmRe = /post now|nu plaatsen|publi|plaats|publish|trotzdem|veröffentlich|publicar|de todos modos|continue|doorgaan|confirm|posted/i;
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    const btnTexts = await page
      .evaluate(() => {
        const roots = Array.from(document.querySelectorAll('[role="dialog"], [data-testid*="modal" i], [class*="modal" i], [class*="dialog" i]'));
        const bs = [];
        if (roots.length) {
          for (const r of roots) for (const b of r.querySelectorAll('button')) bs.push((b.innerText || b.getAttribute('aria-label') || '').trim());
        } else {
          for (const b of document.querySelectorAll('button')) bs.push((b.innerText || b.getAttribute('aria-label') || '').trim());
        }
        return bs.filter(Boolean);
      })
      .catch(() => []);

    const nonCancel = btnTexts.filter((t) => !cancelRe.test(t) && confirmRe.test(t));
    if (nonCancel.length) {
      const clicked = await page
        .evaluate((confirmLabel) => {
          const cancelRe2 = /cancel|annuleren|annuler|cancelar|abbrechen|取消|キャンセル|취소/i;
          const candidates = Array.from(document.querySelectorAll('[role="dialog"] button, [class*="modal" i] button, [class*="dialog" i] button'));
          const pool = candidates.length ? candidates : Array.from(document.querySelectorAll('button'));
          const target = pool.find((b) => {
            const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
            return t.toLowerCase() === confirmLabel.toLowerCase() && !cancelRe2.test(t);
          });
          if (!target) return false;
          target.click();
          return true;
        }, nonCancel[0])
        .catch(() => false);
      if (clicked) {
        verbose('confirmed post via modal button "' + nonCancel[0] + '"');
        return true;
      }
    }
    await sleep(800);
  }
  return false;
}
/** Wrap confirmation timeouts with the recorded API log for diagnosis. */
async function finalizePostWithDiagnostics(page, opts) {
  try {
    return await finalizePost(page, opts);
  } catch (err) {
    if (err && /__CONFIRM_TIMEOUT__/.test(err.message)) {
      await page.screenshot({ path: '/tmp/captron-confirm-timeout.png', fullPage: false }).catch(() => {});
      const seen = (page._apiLog || []).slice(-12).join('\n  ');
      throw new Error(
        'Timed out waiting for TikTok to confirm the post (120s).\n' +
        'Last TikTok API calls:\n  ' + (seen || '(none recorded)') +
        '\nScreenshot: /tmp/captron-confirm-timeout.png. ' +
        'If the post actually went live (check `captron content`), this is cosmetic — please report it.'
      );
    }
    throw err;
  }
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
  installApiLog(page);
  try {
    await gotoUpload(context, page);
    await waitForFileInput(page);
    step('Uploading ' + path.basename(videoPath) + ' ...');
    await page.setInputFiles(SELECTORS.fileInput, videoPath);

    // Rare: React hydration can drop the first setInputFiles. If the editor
    // never starts, re-arm the input and set the file once more.
    try {
      await waitForEditor(page, { uploadTimeoutSec: 300, onProgress });
    } catch (err) {
      const alive = await page
        .evaluate(() => !!document.querySelector('input[type="file"]'))
        .catch(() => false);
      if (alive && !/rejected/i.test(err.message || '')) {
        warn('Editor did not start — retrying the file input once.');
        await page.setInputFiles(SELECTORS.fileInput, videoPath).catch(() => {});
        await waitForEditor(page, { uploadTimeoutSec: 300, onProgress });
      } else {
        throw err;
      }
    }
    await clearTour(page); // the tour often starts right after the editor mounts
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

    const final = await finalizePostWithDiagnostics(page, { saveDraft });
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
