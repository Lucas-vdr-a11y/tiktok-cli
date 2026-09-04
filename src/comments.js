'use strict';

const { launchProfile } = require('./browser');
const { sleep, verbose } = require('./utils');
const { isLoggedIn } = require('./auth');

/**
 * Comment inbox (best-effort DOM scrape of TikTok Studio comments).
 * TikTok moves this UI often — captron scrapes whatever rows look like
 * comments (author + text + date + video link) and returns them with
 * `partial: true` when the layout is unrecognized so agents can adapt.
 * Pure `normalizeComment` is unit-tested.
 */

const COMMENT_URLS = [
  'https://www.tiktok.com/tiktokstudio/comments',
  'https://www.tiktok.com/tiktokstudio/inbox',
];

function normalizeComment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const author = String(raw.author || '').replace(/^@/, '').trim() || null;
  const text = String(raw.text || '').trim() || null;
  if (!author && !text) return null;
  return {
    author,
    text,
    date: raw.date || null,
    videoId: raw.videoId ? String(raw.videoId) : null,
    videoUrl: raw.videoUrl || (raw.videoId ? 'https://www.tiktok.com/video/' + raw.videoId : null),
  };
}

async function listComments({ account = 'main', limit = 20, headless = false } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) return { ok: false, error: 'not logged in', account, items: [] };
    const page = await context.newPage();
    let loaded = false;
    for (const url of COMMENT_URLS) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
        verbose('goto ' + url + ' failed: ' + String(err.message).split('\n')[0]);
      });
      await sleep(2500);
      const hasRows = await page.evaluate(() => document.body && document.body.textContent && document.body.textContent.length > 500).catch(() => false);
      if (hasRows) { loaded = true; break; }
    }
    if (!loaded) return { ok: false, error: 'comments inbox did not load', account, items: [] };
    const rows = await page.evaluate(() => {
      const out = [];
      // Heuristic: any block with an @handle link + text + optional video link.
      const blocks = Array.from(document.querySelectorAll('div')).slice(0, 400);
      for (const b of blocks) {
        const handleEl = b.querySelector('a[href^="/@"]');
        if (!handleEl) continue;
        const href = handleEl.getAttribute('href') || '';
        if (/\/video\//.test(href)) continue;
        const m = /^\/@([^/?]+)/.exec(href);
        if (!m) continue;
        const text = (b.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        if (text.length < 2) continue;
        const vid = b.querySelector('a[href*="/video/"]');
        const vidM = vid && /\/video\/(\d+)/.exec(vid.getAttribute('href') || '');
        out.push({
          author: m[1],
          text: text.slice(1, 4).join(' ').slice(0, 300),
          date: text.find((l) => /\d{4}-\d{2}-\d{2}|\d+\s*(h|d|w|hour|day|week)/i.test(l)) || null,
          videoId: vidM ? vidM[1] : null,
          videoUrl: vid ? vid.getAttribute('href') : null,
        });
        if (out.length >= 60) break;
      }
      return out;
    }).catch(() => []);
    const items = rows.map(normalizeComment).filter(Boolean).slice(0, Math.max(1, Number(limit) || 20));
    return { ok: true, account, items, total: items.length, partial: rows.length === 0 };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { listComments, normalizeComment, COMMENT_URLS };
