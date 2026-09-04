'use strict';

const { launchProfile } = require('./browser');
const { URLS } = require('./selectors');
const { verbose, sleep } = require('./utils');
const { isLoggedIn } = require('./auth');
const { resolveHandleFromPage } = require('./content');

/**
 * Published-posts listing — reverse engineered.
 *
 * The Studio "Content" tab loads posts from `POST /tiktok/creator/manage/item_list/v1/`:
 *
 *   body: {"cursor":0,"size":50,"query":{"sort_orders":[{"field_name":"post_time","order":2}],"conditions":[],"is_recent_posts":false}}
 *   headers: content-type: application/json, agw-js-conv: str   (no signature!)
 *
 * Response: {item_list: [...], cursor, has_more, status_code}. Each item carries
 * per-post stats (play/like/comment/share/favorite counts), review state,
 * cover art and direct download URLs — far richer than the DOM cards.
 */
async function fetchItemPage(page, { cursor = 0, size = 50 } = {}) {
  return page.evaluate(
    async ({ cursor, size }) => {
      const res = await fetch('/tiktok/creator/manage/item_list/v1/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'agw-js-conv': 'str' },
        body: JSON.stringify({
          cursor,
          size,
          query: {
            sort_orders: [{ field_name: 'post_time', order: 2 }],
            conditions: [],
            is_recent_posts: false,
          },
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    },
    { cursor, size }
  );
}

/** Normalize one raw item_list entry into the captron post shape. */
function normalizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const downloadUrls = (it.download_info && Array.isArray(it.download_info.download_urls)) ? it.download_info.download_urls : [];
  return {
    id: String(it.item_id || ''),
    caption: String(it.desc || '').trim(),
    createTime: it.create_time ? Number(it.create_time) * 1000 : null,
    durationMs: it.duration != null ? Number(it.duration) : null,
    stats: {
      views: Number(it.play_count) || 0,
      likes: Number(it.like_count) || 0,
      comments: Number(it.comment_count) || 0,
      shares: Number(it.share_count) || 0,
      favorites: Number(it.favorite_count) || 0,
    },
        visibility: it.visibility === 1 ? 'public' : it.visibility === 0 ? 'private' : String(it.visibility),
    inReview: !!it.in_review,
    pinned: !!it.is_pinned,
    status: it.status != null ? Number(it.status) : null,
    scheduledTime: (it.schedule_time && Number(it.schedule_time) > 0) ? Number(it.schedule_time) * 1000 : null,
    coverUrl: Array.isArray(it.cover_url) && it.cover_url[0] ? it.cover_url[0] : null,
    // pre-signed CDN urls first (time-limited but directly fetchable), play-API url last
    downloadUrls: downloadUrls.length ? downloadUrls : [],
    downloadUrl: downloadUrls.length ? downloadUrls[0] : null,
  };
}

/** Fetch up to `limit` posts with stats (auto-paginates in size-50 batches). */
async function listPostsApi({ account = 'main', limit = 20, headless = false } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) return { ok: false, error: 'not logged in', account, handle: null, items: [] };
    const page = await context.newPage();
    await page.goto(URLS.content, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
      verbose('goto content failed: ' + err.message.split('\n')[0]);
    });
    await sleep(2500);
    const handle = await resolveHandleFromPage(page);
    const items = [];
    let cursor = 0;
    let hasMore = true;
    while (hasMore && items.length < limit) {
      const body = await fetchItemPage(page, { cursor, size: 50 }).catch((err) => {
        verbose('item_list failed: ' + err.message.split('\n')[0]);
        return null;
      });
      if (!body || body.status_code !== 0) {
        if (!items.length) return { ok: false, error: 'item_list status_code ' + (body && body.status_code), account, handle, items: [] };
        break; // keep what we have
      }
      for (const raw of body.item_list || []) {
        const norm = normalizeItem(raw);
        if (norm && norm.id) items.push(norm);
      }
      hasMore = !!body.has_more;
      cursor = Number(body.cursor) || cursor + 50;
      if (hasMore) await sleep(600);
    }
    return { ok: true, account, handle, items: items.slice(0, limit), total: items.length };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Downloading lives in `download.js` (`captron download [postId]`) — it captures
 * the video stream the Studio grid plays, because the pre-signed `download_info`
 * URLs can 403 for non-browser clients and the play-API URL needs session cookies.
 */
module.exports = { listPostsApi, fetchItemPage, normalizeItem };

