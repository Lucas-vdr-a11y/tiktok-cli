'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { syncAccount, groupScheduled } = require('../../src/sync');
const { openInbox, scrapeCommentRows } = require('../../src/comments');
const { fetchInsights } = require('../../src/analytics');

test('sync: module surface', () => {
  assert.equal(typeof syncAccount, 'function');
  assert.equal(typeof openInbox, 'function');
  assert.equal(typeof scrapeCommentRows, 'function');
  assert.equal(typeof fetchInsights, 'function');
});

test('sync: groupScheduled groups by day within window', () => {
  const now = Date.now();
  const items = [
    { id: 'a', scheduledTime: now + 3600e3, caption: 'one' },
    { id: 'b', scheduledTime: now + 2 * 86400e3, caption: 'two' },
    { id: 'c', scheduledTime: now + 30 * 86400e3, caption: 'far' },
    { id: 'd', scheduledTime: null, caption: 'live' },
  ];
  const r = groupScheduled(items, 14);
  assert.equal(r.upcoming.length, 2);
  assert.equal(r.groups.length, 2);
  const far = groupScheduled([{ id: 'z', scheduledTime: now + 30 * 86400e3 }], 14);
  assert.equal(far.upcoming.length, 0);
});

test('sync: groupScheduled sorts ascending', () => {
  const now = Date.now();
  const r = groupScheduled(
    [
      { id: 'b', scheduledTime: now + 5000 },
      { id: 'a', scheduledTime: now + 1000 },
    ],
    14
  );
  assert.equal(r.upcoming[0].id, 'a');
});

test('cli: sync/calendar/caption surface', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const names = program.commands.map((c) => c.name());
  for (const need of ['sync', 'calendar', 'caption', 'probe', 'fit']) {
    assert.ok(names.includes(need), 'missing command ' + need);
  }
  const sync = program.commands.find((c) => c.name() === 'sync');
  assert.ok(sync.options.some((o) => o.long === '--out'));
  const caption = program.commands.find((c) => c.name() === 'caption');
  assert.ok(caption.options.some((o) => o.long === '--strict'));
});
