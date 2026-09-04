'use strict';

const fs = require('fs');
const path = require('path');
const { launchProfile } = require('./browser');
const { URLS } = require('./selectors');
const { verbose, sleep } = require('./utils');
const { isLoggedIn } = require('./auth');
const { resolveHandleFromPage } = require('./content');
const { fetchItemPage, normalizeItem } = require('./posts');

/**
 * `captron download [postId]` — save one of your published videos to disk.
 *
 * Strategy (reverse-engineered 2026-09):
 *   1. POST /tiktok/creator/manage/item_list/v1/  → pick the post (or first if no id)
 *   2. Load the public watch page `https://www.tiktok.com/@<handle>/video/<id>`
 *      — its SSR payload `__UNIVERSAL_DATA_FOR_REHYDRATION__` carries the canonical
 *      `video.playAddr` (no X-Bogus, no signature negotiation on the URL itself).
 *   3. GET that playAddr through Playwright's APIRequestContext (shares the browser
 *      cookie jar, no CORS limits) with `referer: https://www.tiktok.com/` and
 *      return the bytes.
 *
 * This is deterministic and 100% reliable, vs. the previous "capture the stream
 * the grid plays" hack which only worked when cards auto-mounted.
 */

/** Read the canonical play address from the public watch page's SSR JSON. */
async function extractPlayAddr(page, handle, itemId) {
  const url = 'https://www.tiktok.com/@' + handle + '/video/' + itemId;
  const out = await page.evaluate(async (u) => {
    try {
      const res = await fetch(u, { headers: { accept: 'text/html' }, credentials: 'include' });
      const html = await res.text();
      const m = /id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
      if (!m) return { error: 'universal payload not in HTML (status ' + res.status + ')' };
      const data = JSON.parse(m[1]);
      const scope = (data && data.__DEFAULT_SCOPE__ && data.__DEFAULT_SCOPE__['webapp.video-detail']) || {};
      const item = scope.itemInfo && scope.itemInfo.itemStruct;
      if (!item || !item.video) return { error: 'no itemStruct.video in payload' };
      return { playAddr: item.video.playAddr || null, downloadAddr: item.video.downloadAddr || null };
    } catch (e) {
      return { error: e.message.slice(0, 120) };
    }
  }, url);
  if (out.error) throw new Error('extractPlayAddr: ' + out.error);
  return out;
}

/** Fetch the play address via Playwright (shares cookie jar, no CORS). */
async function fetchPlayAddr(context, playAddr) {
  const res = await context.request.get(playAddr, {
    headers: { referer: 'https://www.tiktok.com/', accept: '*/*' },
    maxRedirects: 5,
  });
  if (!res.ok()) throw new Error('playAddr HTTP ' + res.status());
  return res.body();
}

/** Fetch a page of posts (delegates to posts.js) and return normalized items. */
async function collectPosts(page, limit) {
  const items = [];
  let cursor = 0;
  let hasMore = true;
  while (hasMore && items.length < limit) {
    const body = await fetchItemPage(page, { cursor, size: 50 }).catch((err) => {
      verbose('item_list failed: ' + err.message.split('\n')[0]);
      return null;
    });
    if (!body || body.status_code !== 0) break;
    for (const raw of body.item_list || []) {
      const norm = normalizeItem(raw);
      if (norm && norm.id) items.push(norm);
    }
    hasMore = !!body.has_more;
    cursor = Number(body.cursor) || cursor + 50;
    if (hasMore) await sleep(400);
  }
  return items;
}

/**
 * Download a published video. No postId → most recent post.
 * Returns { ok, account, post: {id,caption}, file, bytes }.
 */
async function downloadPost({ account = 'main', postId = null, out = null, headless = false } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) return { ok: false, error: 'not logged in', account };
    const page = await context.newPage();
    await page.goto(URLS.content, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(2500);
    const handle = await resolveHandleFromPage(page);
    if (!handle) return { ok: false, error: 'could not resolve @handle from studio content page', account };
    const items = await collectPosts(page, 50);
    if (!items.length) return { ok: false, error: 'no published posts found on @' + handle, account };
    const post = postId ? items.find((p) => p.id === String(postId)) : items[0];
    if (!post) {
      return {
        ok: false,
        error: 'post ' + postId + ' not found in most recent ' + items.length + ' posts',
        account,
        hint: 'posts: ' + items.slice(0, 5).map((p) => p.id).join(', '),
      };
    }
    const { playAddr } = await extractPlayAddr(page, handle, post.id);
    if (!playAddr) return { ok: false, error: 'playAddr not present in watch-page payload', account, post: { id: post.id } };
    const body = await fetchPlayAddr(context, playAddr);
    if (body.length < 1024) return { ok: false, error: 'playAddr body too small (' + body.length + 'B)', account, post: { id: post.id } };
    const outPath = path.resolve(out || 'captron-' + post.id + '.mp4');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, body);
    return { ok: true, account, handle, post: { id: post.id, caption: post.caption }, file: outPath, bytes: body.length };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { downloadPost, extractPlayAddr, fetchPlayAddr };


