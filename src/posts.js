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

/**
 * Pure post filtering/sorting (unit-tested). `since` accepts anything
 * Date.parse understands ("2026-08-01", ISO datetime); invalid → ignored.
 */
function filterPosts(items, { query = null, sort = 'new', scheduledOnly = false, since = null } = {}) {
  let out = items || [];
  if (scheduledOnly) out = out.filter((it) => it.scheduledTime);
  if (since) {
    const ts = Date.parse(since);
    if (Number.isFinite(ts)) out = out.filter((it) => it.createTime && it.createTime >= ts);
  }
  if (query) {
    const q = String(query).toLowerCase();
    out = out.filter((it) => (it.caption || '').toLowerCase().includes(q) || String(it.id).includes(q));
  }
  if (sort === 'top') out = [...out].sort((a, b) => (b.stats.views || 0) - (a.stats.views || 0));
  else if (sort === 'liked') out = [...out].sort((a, b) => (b.stats.likes || 0) - (a.stats.likes || 0));
  return out;
}

/** Fetch up to `limit` posts with stats (auto-paginates in size-50 batches). */
async function listPostsApi({ account = 'main', limit = 20, headless = false, query = null, sort = 'new', scheduledOnly = false, since = null } = {}) {
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
    const need = query ? Math.max(Number(limit) || 20, 50) : Number(limit) || 20;
    while (hasMore && items.length < need) {
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
    const out = filterPosts(items, { query, sort, scheduledOnly, since }).slice(0, Number(limit) || 20);
    return { ok: true, account, handle, items: out, total: items.length };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Delete a published post by id through the Studio UI (best-effort).
 * TikTok has no documented delete API — captron clicks the card's
 * "More/Delete" flow on the content dashboard and confirms.
 * Requires { yes: true } as a safety catch. Returns { ok, id }.
 */
async function deletePost({ account = 'main', postId, headless = false, yes = false } = {}) {
  if (!postId) return { ok: false, error: 'missing post id' };
  if (!yes) return { ok: false, error: 'refusing to delete without --yes (pass --yes to confirm)', id: String(postId) };
  const { openContentPage } = require('./content');
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) return { ok: false, error: 'not logged in', account, id: String(postId) };
    const page = await openContentPage(context, { tab: 'posts' });
    await sleep(2000);
    const found = await page.evaluate((id) => {
      const cards = Array.from(document.querySelectorAll('a[href*="/video/"]'));
      const a = cards.find((x) => (x.getAttribute('href') || '').includes(String(id)));
      if (a) { a.scrollIntoView({ block: 'center' }); return true; }
      return false;
    }, String(postId)).catch(() => false);
    if (!found) return { ok: false, error: 'post not found on the content dashboard (wrong account or id?)', id: String(postId) };
    // Open the card menu (⋯) near the post link, then click Delete, then confirm.
    const clicked = await page.evaluate((id) => {
      const cards = Array.from(document.querySelectorAll('a[href*="/video/"]'));
      const a = cards.find((x) => (x.getAttribute('href') || '').includes(String(id)));
      if (!a) return null;
      const card = a.closest('div')?.parentElement || a.parentElement;
      const scope = card || document;
      const btns = Array.from(scope.querySelectorAll('button'));
      const more = btns.find((b) => /^(…|\.\.\.|more|meer|más|plus|mehr|更多|その他|더보기)$/i.test((b.textContent || '').trim()) || (b.getAttribute('aria-label') || '').toLowerCase().includes('more'));
      if (more) { more.click(); return 'menu'; }
      return null;
    }, String(postId)).catch(() => null);
    await sleep(1200);
    const delLabels = ['delete', 'verwijderen', 'eliminar', 'supprimer', 'löschen', '删除', '削除', '삭제', 'excluir'];
    let deleted = false;
    for (let i = 0; i < 3 && !deleted; i++) {
      deleted = await page.evaluate((labels) => {
        const btns = Array.from(document.querySelectorAll('button, [role="menuitem"], li'));
        const b = btns.find((x) => labels.includes((x.textContent || '').trim().toLowerCase()));
        if (b) { b.click(); return true; }
        return false;
      }, delLabels).catch(() => false);
      await sleep(1000);
      // confirm dialog
      const confirmed = await page.evaluate((labels) => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find((x) => ['confirm', 'bevestigen', 'confirmar', 'confirmer', 'bestätigen', '确认', '確認', '확인', 'delete'].includes((x.textContent || '').trim().toLowerCase()));
        if (b) { b.click(); return true; }
        return false;
      }, delLabels).catch(() => false);
      if (confirmed) { await sleep(2000); deleted = true; }
    }
    void clicked;
    return deleted
      ? { ok: true, id: String(postId), account }
      : { ok: false, error: 'delete flow did not complete — TikTok may have changed the menu; delete manually in Studio', id: String(postId) };
  } finally {
    await context.close().catch(() => {});
  }
}
/**
 * Account health summary over normalized post items (pure, tested).
 * Powers `captron audit` for one account or a whole fleet sweep.
 */
function summarizePosts(items) {
  const list = (items || []).filter((it) => it && typeof it === 'object');
  const sum = (f) => list.reduce((a, it) => a + ((it.stats && it.stats[f]) || 0), 0);
  const avg = (f) => (list.length ? Math.round(sum(f) / list.length) : 0);
  const top = [...list].sort((a, b) => ((b.stats && b.stats.views) || 0) - ((a.stats && a.stats.views) || 0)).slice(0, 3);
  const flops = [...list].sort((a, b) => ((a.stats && a.stats.views) || 0) - ((b.stats && b.stats.views) || 0)).slice(0, 3).filter((it) => ((it.stats && it.stats.views) || 0) < avg('views'));
  const noCaption = list.filter((it) => !(it.caption || '').trim());
  return { scanned: list.length, totals: { views: sum('views'), likes: sum('likes'), comments: sum('comments'), shares: sum('shares') }, averages: { views: avg('views'), likes: avg('likes') }, top: top.map((t) => t.id), flops: flops.map((t) => t.id), noCaption: noCaption.length };
}

/**
 * Downloading lives in `download.js` (`captron download [postId]`) — it captures
 * the video stream the Studio grid plays, because the pre-signed `download_info`
 * URLs can 403 for non-browser clients and the play-API URL needs session cookies.
 */
module.exports = { listPostsApi, fetchItemPage, normalizeItem, filterPosts, summarizePosts, deletePost };

