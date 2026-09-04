'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  buildCaption,
  parseSchedule,
  formatBytes,
  validateVideoPath,
  withTimeout,
} = require('../../src/utils');

test('buildCaption: plain caption only', () => {
  assert.equal(buildCaption({ caption: 'Hello world' }), 'Hello world');
});

test('buildCaption: caption + hashtags normalized', () => {
  const out = buildCaption({ caption: 'Hello', hashtags: 'ai, agent, fyp' });
  assert.equal(out, 'Hello\n#ai #agent #fyp');
});

test('buildCaption: hashtags with leading # are deduped', () => {
  const out = buildCaption({ caption: 'Hi', hashtags: '#ai #agent' });
  assert.equal(out, 'Hi\n#ai #agent');
});

test('buildCaption: space-separated words become separate tags', () => {
  const out = buildCaption({ caption: 'Hi', hashtags: 'cool video' });
  assert.equal(out, 'Hi\n#cool #video');
});

test('buildCaption: explicit underscore preserved in single token', () => {
  const out = buildCaption({ caption: 'Hi', hashtags: 'cool_video' });
  assert.equal(out, 'Hi\n#cool_video');
});

test('buildCaption: empty/blank returns empty string', () => {
  assert.equal(buildCaption({}), '');
  assert.equal(buildCaption({ hashtags: '   ,  ' }), '');
});

test('parseSchedule: ISO datetime', () => {
  const d = parseSchedule('2026-12-25 14:30');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 11); // December = 11
  assert.equal(d.getDate(), 25);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getMinutes(), 30);
});

test('parseSchedule: ISO date defaults to 09:00', () => {
  const d = parseSchedule('2026-12-25');
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 0);
});

test('parseSchedule: relative +90m', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const d = parseSchedule('+90m', now);
  assert.equal(d.getTime() - now.getTime(), 90 * 60 * 1000);
});

test('parseSchedule: relative +3d', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const d = parseSchedule('+3d', now);
  assert.equal(d.getTime() - now.getTime(), 3 * 86400 * 1000);
});

test('parseSchedule: tomorrow HH:mm', () => {
  const now = new Date('2026-01-01T10:00:00Z');
  const d = parseSchedule('tomorrow 08:30', now);
  assert.equal(d.getDate(), 2);
  assert.equal(d.getHours(), 8);
  assert.equal(d.getMinutes(), 30);
});

test('parseSchedule: invalid input returns null', () => {
  assert.equal(parseSchedule('not a date'), null);
  assert.equal(parseSchedule(''), null);
  assert.equal(parseSchedule(null), null);
});

test('formatBytes: human readable', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1 MB');
  assert.equal(formatBytes(69092), '67.5 KB');
});

test('validateVideoPath: rejects missing file', () => {
  const r = validateVideoPath('/tmp/does-not-exist-xyz.mp4');
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});

test('validateVideoPath: accepts real file', () => {
  const fs = require('fs');
  const path = '/tmp/captron-test-' + Date.now() + '.mp4';
  fs.writeFileSync(path, Buffer.from('x'));
  try {
    const r = validateVideoPath(path);
    assert.equal(r.ok, true);
    assert.equal(r.path, path);
  } finally {
    fs.unlinkSync(path);
  }
});

test('withTimeout: resolves before timeout', async () => {
  const r = await withTimeout(Promise.resolve('ok'), 1000, 'too slow');
  assert.equal(r, 'ok');
});

test('withTimeout: rejects on timeout', async () => {
  await assert.rejects(
    () => withTimeout(new Promise((r) => setTimeout(r, 500)), 50, 'timed out'),
    /timed out/
  );
});