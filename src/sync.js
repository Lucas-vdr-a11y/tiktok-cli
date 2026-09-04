'use strict';

const { launchProfile } = require('./browser');
const { URLS } = require('./selectors');
const { verbose, sleep } = require('./utils');
const { isLoggedIn } = require('./auth');
const { resolveHandleFromPage } = require('./content');
const { fetchItemPage, normalizeItem } = require('./posts');
const { fetchInsights, METRICS, RESPONSE_KEYS, parseSeries } = require('./analytics');
const { openInbox, scrapeCommentRows, normalizeComment } = require('./comments');

const OVERVIEW = [
  ['views', METRICS.views],
  ['profile_views', METRICS.profile_views],
  ['likes', METRICS.likes],
  ['comments', METRICS.comments],
  ['shares', METRICS.shares],
  ['followers', METRICS.followers],
  ['new_viewers', METRICS.new_viewers],
  ['total_viewers', METRICS.total_viewers],
];

/**
 * One-session daily digest: handle + posts w/ stats + analytics metrics +
 * recent comments, sharing a single browser context (3 launches → 1).
 * Comments are best-effort and never fail the sync.
 * Returns { ok, account, handle, syncedAt, range_days, metrics, posts, comments, totals }.
 */
async function syncAccount({ account = 'main', days = 7, limit = 20, commentsLimit = 5, headless = false } = {}) {
  const range = [1, 7, 28, 60].includes(Number(days)) ? Number(days) : 7;
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) return { ok: false, error: 'not logged in', account };
    // 1. Content page: handle + posts.
    const contentPage = await context.newPage();
    await contentPage.goto(URLS.content, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
      verbose('goto content failed: ' + String(err.message).split('\n')[0]);
    });
    await sleep(2500);
    const handle = await resolveHandleFromPage(contentPage).catch(() => null);
    const posts = [];
    let cursor = 0;
    let hasMore = true;
    while (hasMore && posts.length < (Number(limit) || 20)) {
      const body = await fetchItemPage(contentPage, { cursor, size: 50 }).catch((err) => {
        verbose('item_list failed: ' + String(err.message).split('\n')[0]);
        return null;
      });
      if (!body || body.status_code !== 0) break;
      for (const raw of body.item_list || []) {
        const norm = normalizeItem(raw);
        if (norm && norm.id) posts.push(norm);
      }
      hasMore = !!body.has_more;
      cursor = Number(body.cursor) || cursor + 50;
      if (hasMore) await sleep(600);
    }
    const clipped = posts.slice(0, Number(limit) || 20);
    // 2. Analytics page: metrics batch.
    const metrics = {};
    try {
      const apage = await context.newPage();
      await apage.goto(URLS.analytics, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(2500);
      const body = await fetchInsights(
        apage,
        OVERVIEW.map(([, t]) => t),
        range
      );
      if (body && body.status_code === 0) {
        OVERVIEW.forEach(([name, type]) => {
          metrics[name] = parseSeries(body[RESPONSE_KEYS[type]]);
        });
      }
      await apage.close().catch(() => {});
    } catch (err) {
      verbose('sync metrics failed: ' + String(err.message).split('\n')[0]);
    }
    // 3. Comments inbox (best-effort, same session).
    let comments = [];
    let commentsPartial = true;
    try {
      const cpage = await context.newPage();
      if (await openInbox(cpage)) {
        const rows = await scrapeCommentRows(cpage);
        comments = rows
          .map((r) => normalizeComment(r))
          .filter(Boolean)
          .slice(0, Math.max(1, Number(commentsLimit) || 5));
        commentsPartial = rows.length === 0;
      }
      await cpage.close().catch(() => {});
    } catch (err) {
      verbose('sync comments failed: ' + String(err.message).split('\n')[0]);
    }
    const sum = (f) => clipped.reduce((a, it) => a + ((it.stats && it.stats[f]) || 0), 0);
    return {
      ok: true,
      account,
      handle,
      syncedAt: new Date().toISOString(),
      range_days: range,
      metrics,
      posts: clipped,
      posts_total: posts.length,
      comments,
      commentsPartial,
      totals: { views: sum('views'), likes: sum('likes'), comments: sum('comments'), shares: sum('shares') },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Group scheduled posts by day within a lookahead window (pure, tested). */
function groupScheduled(items, days = 14) {
  const d = Math.max(1, Number(days) || 14);
  const cutoff = Date.now() + d * 86400e3;
  const upcoming = (items || [])
    .filter((it) => it && it.scheduledTime && it.scheduledTime <= cutoff)
    .sort((a, b) => a.scheduledTime - b.scheduledTime);
  const groups = [];
  for (const it of upcoming) {
    const label = new Date(it.scheduledTime).toISOString().slice(0, 10);
    let g = groups.find((x) => x.day === label);
    if (!g) { g = { day: label, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  return { days: d, upcoming, groups };
}

module.exports = { syncAccount, groupScheduled };
