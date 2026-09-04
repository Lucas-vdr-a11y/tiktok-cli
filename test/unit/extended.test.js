'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const {
  parseHashtags,
  buildCaption,
  buildCaptionDetailed,
  parseSchedule,
  validateVideoPath,
  validateImagePaths,
  retry,
  toCsv,
  resolveAccount,
} = require('../../src/utils');
const { parseViewCount, normalizeTag, extractTags } = require('../../src/trending');
const { normalizeComment } = require('../../src/comments');
const { analyticsToCsv } = require('../../src/analytics');
const { buildPlan } = require('../../src/batch');

test('parseHashtags: dedupes case-insensitively, drops invalid', () => {
  assert.deepEqual(parseHashtags('#AI, ai, fyp'), ['AI', 'fyp']);
  assert.deepEqual(parseHashtags('cool_video'), ['cool_video']);
  assert.deepEqual(parseHashtags(''), []);
});

test('buildCaption: dedupes hashtags', () => {
  assert.equal(buildCaption({ caption: 'Hi', hashtags: '#ai, AI' }), 'Hi\n#ai');
});

test('buildCaptionDetailed: warns on overlong caption', () => {
  const r = buildCaptionDetailed({ caption: 'x'.repeat(2300) });
  assert.ok(r.warnings.length >= 1);
});

test('parseSchedule: "in 2 hours"', () => {
  const now = new Date('2026-01-01T10:00:00Z');
  const d = parseSchedule('in 2 hours', now);
  assert.equal(d.getTime(), now.getTime() + 2 * 3600e3);
});

test('parseSchedule: bare HH:mm rolls to tomorrow when past', () => {
  const now = new Date(2026, 0, 1, 20, 0, 0);
  const d = parseSchedule('18:30', now);
  assert.equal(d.getDate(), 2);
  assert.equal(d.getHours(), 18);
});

test('parseSchedule: weekday "friday 18:00"', () => {
  const now = new Date(2026, 0, 1, 10, 0, 0); // Thursday
  const d = parseSchedule('friday 18:00', now);
  assert.equal(d.getDay(), 5);
  assert.ok(d.getTime() > now.getTime());
});

test('parseSchedule: slash date', () => {
  const d = parseSchedule('2026/12/25 14:30');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 11);
});

test('parseSchedule: +2w', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const d = parseSchedule('+2w', now);
  assert.equal(d.getTime(), now.getTime() + 14 * 86400e3);
});

test('validateVideoPath: rejects bad extension', () => {
  const f = '/tmp/captron-ext-' + Date.now() + '.txt';
  fs.writeFileSync(f, 'hello');
  try {
    const r = validateVideoPath(f);
    assert.equal(r.ok, false);
    assert.match(r.error, /unsupported extension/);
  } finally {
    fs.unlinkSync(f);
  }
});

test('validateImagePaths: enforces 2..10', () => {
  const a = '/tmp/captron-img1-' + Date.now() + '.jpg';
  fs.writeFileSync(a, 'x');
  try {
    assert.equal(validateImagePaths([a]).ok, false);
    assert.equal(validateImagePaths([a, a]).ok, true);
    assert.equal(validateImagePaths(new Array(11).fill(a)).ok, false);
  } finally {
    fs.unlinkSync(a);
  }
});

test('retry: succeeds after failures', async () => {
  let n = 0;
  const out = await retry(async () => {
    n++;
    if (n < 3) throw new Error('flaky');
    return 'ok';
  }, { tries: 3, delayMs: 1 });
  assert.equal(out, 'ok');
  assert.equal(n, 3);
});

test('toCsv: quotes commas', () => {
  const csv = toCsv([{ a: 'x,y', b: 'z' }], ['a', 'b']);
  assert.ok(csv.includes('"x,y"'));
});

test('resolveAccount: env fallback', () => {
  const prev = process.env.CAPTRON_ACCOUNT;
  process.env.CAPTRON_ACCOUNT = 'envacct';
  try {
    assert.equal(resolveAccount(null), 'envacct');
    assert.equal(resolveAccount('cli'), 'cli');
  } finally {
    if (prev == null) delete process.env.CAPTRON_ACCOUNT;
    else process.env.CAPTRON_ACCOUNT = prev;
  }
});

test('trending: parseViewCount', () => {
  assert.equal(parseViewCount('12.3M'), 12300000);
  assert.equal(parseViewCount('45.6K views'), 45600);
  assert.equal(parseViewCount('1,234'), 1234);
  assert.equal(parseViewCount(null), null);
});

test('trending: extractTags dedupes, sorts, limits', () => {
  const items = extractTags(
    [{ tag: 'fyp', views: 10 }, { tag: '#FYP', views: 99 }, { tag: 'ai', views: 5 }],
    { limit: 2 }
  );
  assert.equal(items[0].tag, 'FYP');
  assert.equal(items.length, 2);
});

test('comments: normalizeComment', () => {
  assert.deepEqual(normalizeComment({ author: '@bob', text: ' nice! ', videoId: 123 }).author, 'bob');
  assert.equal(normalizeComment({}), null);
});

test('analytics: analyticsToCsv', () => {
  const csv = analyticsToCsv({ metrics: { views: { total: 10, series: [{ date: '2026-01-01', value: 3 }] } } });
  assert.ok(csv.startsWith('metric,date,value'));
  assert.ok(csv.includes('views,total,10'));
});

test('batch: buildPlan carries interaction flags', () => {
  const plan = buildPlan([{ index: 0, video: './a.mp4', allowComment: 'false', allowDuet: 'yes', cover: '2.5' }], { defaultAccount: 'main' });
  assert.equal(plan[0].allowComment, false);
  assert.equal(plan[0].allowDuet, true);
  assert.equal(plan[0].cover, 2.5);
});
