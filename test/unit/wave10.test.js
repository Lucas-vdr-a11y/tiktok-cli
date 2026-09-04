'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { summarizePosts } = require('../../src/posts');

test('posts: summarizePosts matches legacy audit math', () => {
  const items = [
    { id: '1', caption: 'a', stats: { views: 10, likes: 5, comments: 2, shares: 1 } },
    { id: '2', caption: '  ', stats: { views: 30, likes: 1, comments: 0, shares: 0 } },
    { id: '3', caption: 'c', stats: { views: 5, likes: 0, comments: 0, shares: 0 } },
  ];
  const r = summarizePosts(items);
  assert.equal(r.scanned, 3);
  assert.deepEqual(r.totals, { views: 45, likes: 6, comments: 2, shares: 1 });
  assert.deepEqual(r.averages, { views: 15, likes: 2 });
  assert.deepEqual(r.top, ['2', '1', '3']);
  // flops: below average (15), ascending → 3 (5), 1 (10)
  assert.deepEqual(r.flops, ['3', '1']);
  assert.equal(r.noCaption, 1);
});

test('posts: summarizePosts tolerates missing stats', () => {
  const r = summarizePosts([{ id: 'x' }, null, 'junk']);
  assert.equal(r.scanned, 1);
  assert.equal(r.totals.views, 0);
});

test('cli: content/comments/calendar/audit have --all', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  for (const name of ['content', 'comments', 'calendar', 'audit', 'posts', 'analytics', 'sync']) {
    const cmd = program.commands.find((c) => c.name() === name);
    assert.ok(cmd, name + ' exists');
    assert.ok(cmd.options.some((o) => o.long === '--all'), name + ' has --all');
  }
});
