'use strict';

const { launchProfile } = require('./browser');
const { sleep, verbose } = require('./utils');

/**
 * Hashtag / trend research for faceless creators.
 *
 * Strategy (reverse-engineered 2026-09, no signatures needed):
 *   - Trending: load https://www.tiktok.com/explore and collect /tag/<name>
 *     anchors with their view-count labels.
 *   - Hashtag detail: load https://www.tiktok.com/tag/<name> and read the
 *     SSR payload `__UNIVERSAL_DATA_FOR_REHYDRATION__` for the canonical
 *     view count, then collect co-occurring /tag/ links as "related".
 * Pure parsers (parseViewCount, normalizeTag, extractTags) are unit-tested.
 */

/** "12.3M" / "45.6K" / "1,234" -> number. */
function parseViewCount(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, '').replace(/views?$/i, '').trim();
  const m = /^([\d.]+)\s*([KMB])?$/i.exec(s);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const mult = !m[2] ? 1 : /^k$/i.test(m[2]) ? 1e3 : /^m$/i.test(m[2]) ? 1e6 : 1e9;
  return Math.round(base * mult);
}

function normalizeTag(name) {
  const t = String(name || '').trim().replace(/^#+/, '').replace(/\s+/g, '');
  if (!t) return null;
  if (!/^[\w\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+$/.test(t)) return null;
  return t;
}

/** Dedupe raw {tag, views?, url?} rows, keeping the highest view count. */
function extractTags(rows, { limit = 20 } = {}) {
  const map = new Map();
  for (const r of rows || []) {
    const tag = normalizeTag(r && r.tag);
    if (!tag) continue;
    const views = r && r.views != null ? Number(r.views) : null;
    const prev = map.get(tag);
    if (!prev || (views != null && (prev.views == null || views > prev.views))) {
      map.set(tag, { tag, views, url: (r && r.url) || 'https://www.tiktok.com/tag/' + tag });
    }
  }
  return [...map.values()]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, Math.max(1, Number(limit) || 20));
}

async function trendingTags({ limit = 20, headless = false, account = 'main' } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    const page = await context.newPage();
    await page.goto('https://www.tiktok.com/explore', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
      verbose('goto explore failed: ' + String(err.message).split('\n')[0]);
    });
    await sleep(3000);
    const rows = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll('a[href*="/tag/"]')) {
        const href = a.getAttribute('href') || '';
        const m = /\/tag\/([^\/?#]+)/.exec(href);
        if (!m) continue;
        const card = a.closest('div');
        const txt = ((card && card.textContent) || a.textContent || '').slice(0, 200);
        const vm = /([\d.,]+\s*[KMB]?)\s*(?:views|videos|posts)?/i.exec(txt);
        out.push({ tag: decodeURIComponent(m[1]), views: null, viewLabel: vm ? vm[1] : null, url: new URL(href, location.origin).href });
      }
      return out;
    }).catch(() => []);
    const withViews = rows.map((r) => ({ ...r, views: parseViewCount(r.viewLabel) }));
    const items = extractTags(withViews, { limit });
    return { ok: items.length > 0, items, total: items.length };
  } finally {
    await context.close().catch(() => {});
  }
}

async function hashtagInfo({ tag, limit = 10, headless = false, account = 'main' } = {}) {
  const clean = normalizeTag(tag);
  if (!clean) return { ok: false, error: 'invalid hashtag: ' + tag };
  const context = await launchProfile({ account, headless });
  try {
    const page = await context.newPage();
    await page.goto('https://www.tiktok.com/tag/' + encodeURIComponent(clean), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
      verbose('goto tag failed: ' + String(err.message).split('\n')[0]);
    });
    await sleep(2500);
    const detail = await page.evaluate(() => {
      try {
        const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
        if (!el) return { found: false };
        const json = JSON.parse(el.textContent || '{}');
        const str = JSON.stringify(json).slice(0, 20000);
        const vm = /"viewCount"\s*:\s*"?([\d.,KMB]+)"?|"videoCount"\s*:\s*(\d+)/i.exec(JSON.stringify(json));
        void str;
        return { found: true, viewHint: vm ? vm[1] || vm[2] : null };
      } catch (err) {
        return { found: false, error: String(err.message).slice(0, 120) };
      }
    }).catch(() => ({ found: false }));
    const related = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll('a[href*="/tag/"]')) {
        const href = a.getAttribute('href') || '';
        const m = /\/tag\/([^\/?#]+)/.exec(href);
        if (m) out.push({ tag: decodeURIComponent(m[1]), url: new URL(href, location.origin).href });
      }
      return out;
    }).catch(() => []);
    const items = extractTags(related.filter((r) => r.tag.toLowerCase() !== clean.toLowerCase()), { limit });
    return { ok: true, tag: clean, url: 'https://www.tiktok.com/tag/' + clean, views: parseViewCount(detail.viewHint), related: items };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { trendingTags, hashtagInfo, parseViewCount, normalizeTag, extractTags };
