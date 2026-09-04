'use strict';

const { launchProfile } = require('./browser');
const { URLS } = require('./selectors');
const { verbose, sleep } = require('./utils');
const { isLoggedIn } = require('./auth');

/**
 * TikTok Studio analytics — reverse engineered.
 *
 * The dashboard hydrates from one endpoint, `GET /tiktok/v1/analytics/insights/`,
 * which accepts a *batch* of metric requests:
 *
 *   type_requests=[{"insight_type":121,"data_date_range":7},...]
 *   &time_offset=<seconds from UTC>
 *   &is_dark_mode=false
 *
 * No X-Bogus / X-Gnarly signature is required (unlike most other /tiktok/v1
 * APIs) — session cookies alone authorize it, and `data_date_range` is 1, 7,
 * 28 or 60. Metric ids discovered by probing 1..160 (2026-09):
 *   121 views · 122 profile views · 123 likes · 124 comments · 125 shares
 *   126 creator rewards · 127 traffic sources · 140 new viewers
 *   141 total viewers · 145 viewer active days · 146 viewer active hours
 *   160 followers
 *
 * Every metric comes back wrapped as
 *   { value, delta_change, percent_change, total, list, key_value, message }
 * where each field is `{ message: {data_source, status, timestamp}, value? }`.
 * status: 1 = ok, 2 = no data / empty, 7/9/10 = not applicable.
 */
const METRICS = {
  views: 121,
  profile_views: 122,
  likes: 123,
  comments: 124,
  shares: 125,
  rewards: 126,
  traffic_source: 127,
  new_viewers: 140,
  total_viewers: 141,
  active_days: 145,
  active_hours: 146,
  followers: 160,
};

const VALID_RANGES = [1, 7, 28, 60];

/** Response body keys are semantic names keyed by insight_type (from the web app). */
const RESPONSE_KEYS = {
  [METRICS.views]: 'analytics_overview_views',
  [METRICS.profile_views]: 'analytics_overview_profile_views',
  [METRICS.likes]: 'analytics_overview_likes',
  [METRICS.comments]: 'analytics_overview_comments',
  [METRICS.shares]: 'analytics_overview_shares',
  [METRICS.rewards]: 'analytics_overview_rewards',
  [METRICS.traffic_source]: 'analytics_overview_traffic_source',
  [METRICS.new_viewers]: 'analytics_viewer_new_viewer',
  [METRICS.total_viewers]: 'analytics_viewer_total_viewer',
  [METRICS.active_days]: 'analytics_viewer_active_days',
  [METRICS.active_hours]: 'analytics_viewer_active_hours',
  [METRICS.followers]: 'analytics_follower_total_followers',
};

/** Strip the `{message:{...}}` wrapper; return the plain value or null. */
function unwrap(wrapped) {
  if (!wrapped || typeof wrapped !== 'object') return null;
  const status = wrapped.message ? wrapped.message.status : undefined;
  if ('value' in wrapped) {
    const v = wrapped.value;
    if (Array.isArray(v)) {
      // list of wrapped day-values -> unwrap each element
      return { value: v.map((el) => (el && typeof el === 'object' && 'value' in el ? el.value : el)), status };
    }
    if (v === null || typeof v !== 'object') return { value: v, status };
    if ('message' in v || 'value' in v) {
      // nested wrapper (e.g. a list field embedding its own message/value)
      const inner = unwrap(v);
      return { value: inner ? inner.value : v, status: v.message ? v.message.status : status };
    }
    return { value: v, status };
  }
  if ('key_value' in wrapped) {
    return { value: wrapped.key_value, status };
  }
  return { value: null, status };
}
/** Total + delta + percent + daily series for an overview metric. */
function parseSeries(metric) {
  const m = metric || {};
  const total = unwrap(m.total);
  const delta = unwrap(m.delta_change);
  const pct = unwrap(m.percent_change);
  const list = m.list ? unwrap(m.list) : null;
  return {
    total: total && total.value != null ? total.value : null,
    delta: delta && delta.value != null ? delta.value : null,
    percent_change: pct && pct.value != null ? pct.value : null,
    series: list && Array.isArray(list.value)
      ? list.value.map((v, i) => {
          const u = unwrap(v);
          return {
            date: new Date(((m.list.value[i] && m.list.value[i].message && m.list.value[i].message.timestamp) || 0) * 1000).toISOString().slice(0, 10),
            value: u ? u.value : v,
          };
        })
      : [],
    ok: !!(total && total.value != null),
  };
}

/** One in-page fetch of many insight types at once. */
async function fetchInsights(page, types, dateRange) {
  return page.evaluate(
    async ({ types, dateRange, tzOffsetSeconds }) => {
      const tr = encodeURIComponent(JSON.stringify(types.map((t) => ({ insight_type: t, data_date_range: dateRange }))));
      const res = await fetch('/tiktok/v1/analytics/insights/?type_requests=' + tr + '&time_offset=' + tzOffsetSeconds + '&is_dark_mode=false', {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    },
    { types, dateRange, tzOffsetSeconds: -new Date().getTimezoneOffset() * 60 }
  );
}

/**
 * `captron analytics` — account-level metrics for the last N days.
 * With `posts > 0`, also returns the most recent posts with per-post stats
 * (from /tiktok/creator/manage/item_list/v1/) in the same session.
 * Returns { ok, account, handle, range_days, metrics, posts? }.
 */
async function analytics({ account = 'main', days = 7, posts = 0, headless = false } = {}) {
  const range = VALID_RANGES.includes(Number(days)) ? Number(days) : 7;
  const overviewTypes = [METRICS.views, METRICS.profile_views, METRICS.likes, METRICS.comments, METRICS.shares, METRICS.followers, METRICS.new_viewers, METRICS.total_viewers];
  const names = ['views', 'profile_views', 'likes', 'comments', 'shares', 'followers', 'new_viewers', 'total_viewers'];
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) return { ok: false, error: 'not logged in', account };
    const page = await context.newPage();
    await page.goto(URLS.analytics, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => {
      verbose('goto analytics failed: ' + err.message.split('\n')[0]);
    });
    await sleep(2500);
    const body = await fetchInsights(page, overviewTypes, range);
    if (body.status_code !== 0) return { ok: false, error: 'analytics status_code ' + body.status_code, account };
    const metrics = {};
    overviewTypes.forEach((type, i) => {
      const key = RESPONSE_KEYS[type] || 'insight_type_' + type;
      metrics[names[i]] = parseSeries(body[key]);
    });
    // Handle from studio chrome (same heuristic as content.js)
    const handle = await page
      .evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href^="/@"]'));
        const chrome = links.find((a) => !/\/video\//.test(a.getAttribute('href') || ''));
        const m = chrome && /^\/@([^/?]+)/.exec(chrome.getAttribute('href') || '');
        return m ? m[1] : null;
      })
      .catch(() => null);
    const out = { ok: true, account, handle, range_days: range, metrics };
    if (Number(posts) > 0) {
      const { fetchItemPage, normalizeItem } = require('./posts');
      const postBody = await fetchItemPage(page, { cursor: 0, size: Math.min(Number(posts), 50) }).catch((err) => {
        verbose('item_list failed: ' + err.message.split('\n')[0]);
        return null;
      });
      if (postBody && postBody.status_code === 0) {
        out.posts = (postBody.item_list || []).slice(0, Number(posts)).map(normalizeItem);
      } else {
        out.posts = [];
        out.posts_error = 'item_list status_code ' + (postBody && postBody.status_code);
      }
    }
    return out;
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { analytics, METRICS, VALID_RANGES, RESPONSE_KEYS, unwrap, parseSeries };

