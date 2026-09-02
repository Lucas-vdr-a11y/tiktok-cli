'use strict';

const { launchProfile } = require('./browser');
const { URLS } = require('./selectors');
const { verbose, sleep, warn } = require('./utils');
const { isLoggedIn } = require('./auth');

const CONTENT_TAB_LABELS = {
  posts: ['posts', 'berichten', 'publicaciones', 'publications', '视频', '投稿', '게시물'],
  drafts: ['drafts', 'concepten', 'borradores', 'brouillons', '草稿', '下書き', '임시글'],
};

/** Open the content dashboard and switch to the requested tab. */
async function openContentPage(context, { tab = 'posts' } = {}) {
  const page = await context.newPage();
  await page.goto(URLS.content, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
    verbose('goto content failed: ' + err.message.split('\n')[0]);
  });
  await sleep(3000);
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
  if (tabBtn) {
    const handles = await page.$$('button, [role="tab"]');
    await handles[tabBtn.idx].click().catch(() => {});
    await sleep(2500);
  }
  return page;
}

/** Scrape post items from the current content page DOM. */
async function scrapeItems(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/video/"]'));
    const items = [];
    for (const a of links) {
      const m = /\/video\/(\d+)/.exec(a.getAttribute('href') || '');
      if (!m) continue;
      if (items.some((it) => it.id === m[1])) continue;
      const card = a.closest('div') && a.closest('div').parentElement;
      items.push({
        id: m[1],
        url: a.href,
        caption: (a.getAttribute('title') || '').trim() || (card ? card.innerText.slice(0, 120) : ''),
      });
    }
    return items;
  });
}

/** Resolve the account handle via the studio chrome. */
async function resolveHandleFromPage(page) {
  const handle = await page
    .$eval('a[href^="/@"]', (a) => a.getAttribute('href'))
    .catch(() => null);
  return handle ? handle.replace(/^\//, '') : null;
}

/** `captron posts [account]` */
async function listPosts({ account = 'main', limit = 20, headless = false } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) {
      return { ok: false, error: 'not logged in', items: [], handle: null, account };
    }
    const page = await openContentPage(context, { tab: 'posts' });
    const handle = await resolveHandleFromPage(page);
    const raw = await scrapeItems(page);
    const items = raw.slice(0, limit);
    return { ok: true, account, handle, items, total: raw.length };
  } finally {
    await context.close().catch(() => {});
  }
}

/** `captron drafts list` */
async function listDrafts({ account = 'main', limit = 20, headless = false } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) {
      return { ok: false, error: 'not logged in', items: [], handle: null, account };
    }
    const page = await openContentPage(context, { tab: 'drafts' });
    const handle = await resolveHandleFromPage(page);
    const raw = await scrapeItems(page);
    return { ok: true, account, handle, items: raw.slice(0, limit), total: raw.length };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { listPosts, listDrafts, openContentPage, scrapeItems };