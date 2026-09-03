'use strict';

const { launchProfile } = require('./browser');
const { URLS } = require('./selectors');
const { verbose, sleep, warn } = require('./utils');
const { isLoggedIn } = require('./auth');

const CONTENT_TAB_LABELS = {
  posts: ['posts', 'berichten', 'publicaciones', 'publications', '视频', '投稿', '게시물'],
  drafts: ['drafts', 'concepten', 'borradores', 'brouillons', '草稿', '下書き', '임시글'],
};

/** Switch the content dashboard to the requested tab (no reload). */
async function switchTab(page, tab) {
  const tabBtn = await page.$$eval(
    'button, [role="tab"]',
    (els, labels) => {
      const items = els
        .map((e, idx) => ({ text: ((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).trim(), idx }))
        .filter((i) => i.text);
      const lower = labels.map((l) => l.toLowerCase());
      return items.find((i) => lower.includes(i.text.toLowerCase())) || null;
    },
    CONTENT_TAB_LABELS[tab]
  );
  if (!tabBtn) return false;
  const handles = await page.$$('button, [role="tab"]');
  await handles[tabBtn.idx].click().catch(() => {});
  await sleep(2500);
  return true;
}

/** Open the content dashboard and switch to the requested tab. */
async function openContentPage(context, { tab = 'posts' } = {}) {
  const page = await context.newPage();
  await page.goto(URLS.content, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
    verbose('goto content failed: ' + err.message.split('\n')[0]);
  });
  await sleep(3000);
  await switchTab(page, tab);
  return page;
}

/**
 * One-pass scrape of the content dashboard grid. Published posts are cards
 * with an anchor to /video/<id>; drafts render as the same card style but
 * without an anchor (duration + optional caption + date only).
 */
async function scrapeContent(page) {
  return page.evaluate(() => {
    const results = { posts: [], drafts: [] };
    const seen = new Set();
    const cardOf = (el, minLen) => {
      let card = el;
      for (let k = 0; k < 6 && card.parentElement; k++) {
        card = card.parentElement;
        if ((card.innerText || '').length > minLen) break;
      }
      return card;
    };
    // Published posts
    for (const a of Array.from(document.querySelectorAll('a[href*="/video/"]'))) {
      const m = /\/video\/(\d+)/.exec(a.getAttribute('href') || '');
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const card = cardOf(a, 30);
      results.posts.push({
        id: m[1],
        url: a.href,
        caption: (a.getAttribute('title') || '').trim() || (card.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      });
    }
    // Drafts: post-info cells that don't belong to a published card.
    // Heuristic: published cards have an anchor; any cell whose text contains
    // a published post's caption is a published cell (info rows inside a
    // published card repeat the caption, often with a trailing date).
    const publishedCaptions = results.posts.map((p) => p.caption.trim()).filter(Boolean);
    const isPublishedCell = (text) => {
      const t = text.trim();
      return publishedCaptions.some((cap) => t.includes(cap));
    };
    const seenDrafts = new Set();
    for (const cell of Array.from(document.querySelectorAll('[data-tt="components_PostInfoCell_FlexRow"]'))) {
      const text = (cell.innerText || '').replace(/\s+/g, ' ').trim();
      if (isPublishedCell(text)) continue;
      const m = /^(\d{1,2}:\d{2})\s+(.+?)(?:\s+([A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M))?$/.exec(text);
      if (!m) continue;
      const caption = /^(no description|geen beschrijving)$/i.test(m[2].trim()) ? '' : m[2].trim();
      const key = m[1] + '|' + caption;
      if (seenDrafts.has(key)) continue;
      seenDrafts.add(key);
      results.drafts.push({
        id: null,
        caption: caption.slice(0, 120),
        duration: m[1],
        updated: m[3] || null,
      });
    }
    return results;
    return results;
  });
}

/** Legacy helper: published posts only. */
async function scrapeItems(page) {
  const res = await scrapeContent(page);
  return res.posts;
}

/** Resolve the account handle via the studio chrome (never a video card link). */
async function resolveHandleFromPage(page) {
  const handle = await page
    .evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href^="/@"]'));
      const chrome = links.find((a) => !/\/video\//.test(a.getAttribute('href') || ''));
      if (chrome) {
        const m = /^\/@([^/?]+)/.exec(chrome.getAttribute('href') || '');
        if (m) return m[1];
      }
      // Fall back to a video card URL: /@handle/video/<id>
      const any = links.find((a) => /\/video\//.test(a.getAttribute('href') || ''));
      if (any) {
        const m = /^\/@([^/?]+)\/video\//.exec(any.getAttribute('href') || '');
        if (m) return m[1];
      }
      return null;
    })
    .catch(() => null);
  return handle;
}

/**
 * Single-session combined listing: published posts + drafts (one page load).
 * `captron content`, and the engine behind `captron posts` / `captron drafts`.
 */
async function listContent({ account = 'main', limit = 20, headless = false } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) {
      return {
        ok: false,
        error: 'not logged in',
        account,
        handle: null,
        posts: { ok: false, items: [], total: 0 },
        drafts: { ok: false, items: [], total: 0 },
      };
    }
    const page = await context.newPage();
    await page.goto(URLS.content, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
      verbose('goto content failed: ' + err.message.split('\n')[0]);
    });
    // The grid (and especially draft cards) mounts late — wait for stability.
    const deadline = Date.now() + 20000;
    let prev = -1;
    let stable = 0;
    while (Date.now() < deadline && stable < 3) {
      const n = await page.evaluate(() => document.querySelectorAll('[data-tt="components_PostInfoCell_FlexRow"]').length).catch(() => -1);
      if (n >= 0) {
        if (n === prev) stable++;
        else { stable = 0; prev = n; }
      }
      await sleep(1200);
    }
    const handle = await resolveHandleFromPage(page);
    const { posts, drafts } = await scrapeContent(page);
    return {
      ok: true,
      account,
      handle,
      posts: { ok: true, items: posts.slice(0, limit), total: posts.length },
      drafts: { ok: true, items: drafts.slice(0, limit), total: drafts.length },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** `captron posts [account]` */
async function listPosts({ account = 'main', limit = 20, headless = false } = {}) {
  const res = await listContent({ account, limit, headless });
  if (!res.ok) return { ok: false, error: res.error, items: [], handle: null, account };
  return { ok: true, account, handle: res.handle, items: res.posts.items, total: res.posts.total };
}

/** `captron drafts list` */
async function listDrafts({ account = 'main', limit = 20, headless = false } = {}) {
  const res = await listContent({ account, limit, headless });
  if (!res.ok) return { ok: false, error: res.error, items: [], handle: null, account };
  return { ok: true, account, handle: res.handle, items: res.drafts.items, total: res.drafts.total };
}

module.exports = { listContent, listPosts, listDrafts, scrapeContent, openContentPage, switchTab, scrapeItems };