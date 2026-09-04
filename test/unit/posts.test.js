'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeItem } = require('../../src/posts');

const RAW = {
  item_id: '7681446464794414358',
  desc: 'Clean E2E #captron',
  create_time: '1788476135',
  duration: 3019,
  play_count: '123',
  like_count: '4',
  comment_count: '0',
  share_count: '5',
  favorite_count: '9',
  visibility: 1,
  in_review: true,
  is_pinned: false,
  status: 102,
  cover_url: ['https://cdn.example/cover.jpg', 'https://cdn.example/cover2.jpg'],
  download_info: { allow_download: true, download_urls: ['https://cdn.example/a.mp4', 'https://cdn.example/b.mp4'] },
};

test('normalizeItem: full raw item', () => {
  const out = normalizeItem(RAW);
  assert.equal(out.id, '7681446464794414358');
  assert.equal(out.caption, 'Clean E2E #captron');
  assert.equal(out.createTime, 1788476135000);
  assert.equal(out.durationMs, 3019);
  assert.deepEqual(out.stats, { views: 123, likes: 4, comments: 0, shares: 5, favorites: 9 });
  assert.equal(out.visibility, 'public');
  assert.equal(out.inReview, true);
  assert.equal(out.pinned, false);
  assert.equal(out.coverUrl, 'https://cdn.example/cover.jpg');
  // download prefers the FIRST url — the pre-signed CDN variant is directly
  // fetchable; the trailing aweme/v1/play/ url rejects anonymous/other-UA clients
  assert.equal(out.downloadUrl, 'https://cdn.example/a.mp4');
  assert.deepEqual(out.downloadUrls, ['https://cdn.example/a.mp4', 'https://cdn.example/b.mp4']);
});

test('normalizeItem: private visibility maps to private', () => {
  const out = normalizeItem({ ...RAW, visibility: 0 });
  assert.equal(out.visibility, 'private');
});

test('normalizeItem: missing fields are safe', () => {
  const out = normalizeItem({ item_id: '42' });
  assert.equal(out.id, '42');
  assert.equal(out.caption, '');
  assert.deepEqual(out.stats, { views: 0, likes: 0, comments: 0, shares: 0, favorites: 0 });
  assert.equal(out.downloadUrl, null);
  assert.equal(out.coverUrl, null);
  assert.equal(out.createTime, null);
});

test('normalizeItem: garbage returns null', () => {
  assert.equal(normalizeItem(null), null);
  assert.equal(normalizeItem('x'), null);
});
