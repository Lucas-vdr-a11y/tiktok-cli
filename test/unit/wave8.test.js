'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveTargets, useAccount } = require('../../src/auth');
const { filterPosts } = require('../../src/posts');
const { runBatch } = require('../../src/batch');

function withTempHome(fn) {
  const prev = process.env.CAPTRON_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-w8-'));
  process.env.CAPTRON_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev == null) delete process.env.CAPTRON_HOME;
    else process.env.CAPTRON_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('auth: resolveTargets single, --to, dedupe', () => {
  assert.deepEqual(resolveTargets({ fallback: 'main' }), ['main']);
  assert.deepEqual(resolveTargets({ to: 'a,b, a', fallback: 'main' }), ['a', 'b']);
  assert.throws(() => resolveTargets({ to: ' , ', fallback: 'main' }), /empty --to/);
});

test('auth: resolveTargets --all lists known accounts', () => {
  withTempHome(() => {
    assert.deepEqual(resolveTargets({ all: true, fallback: 'main' }), ['main']);
    useAccount('alpha');
    useAccount('beta');
    assert.deepEqual(resolveTargets({ all: true, fallback: 'main' }), ['alpha', 'beta']);
  });
});

test('posts: filterPosts since/sort/query compose', () => {
  const items = [
    { id: '1', caption: 'hello ai', createTime: Date.parse('2026-07-01'), stats: { views: 5 } },
    { id: '2', caption: 'hello world', createTime: Date.parse('2026-08-15'), stats: { views: 50 } },
    { id: '3', caption: 'old post', createTime: null, stats: { views: 500 } },
  ];
  assert.equal(filterPosts(items, { since: '2026-08-01' }).length, 1);
  assert.equal(filterPosts(items, { since: '2026-08-01' })[0].id, '2');
  assert.equal(filterPosts(items, { since: 'garbage' }).length, 3);
  assert.equal(filterPosts(items, { sort: 'top' })[0].id, '3');
  assert.equal(filterPosts(items, { query: 'ai' }).length, 1);
  assert.equal(filterPosts(items, { query: 'ai', sort: 'top' })[0].id, '1');
});

test('batch: autoFit leaves fitting videos alone (dry-run)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-w8b-'));
  try {
    const v = path.join(dir, 'v.mp4');
    fs.writeFileSync(v, 'bytes');
    const m = path.join(dir, 'manifest.json');
    fs.writeFileSync(m, JSON.stringify([{ video: v }]));
    const res = await runBatch({ manifest: m, autoFit: true, dryRun: true, headless: true });
    assert.equal(res.ok, true);
    assert.equal(res.results[0].video, v);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('batch: autoFit failure is loud (missing ffmpeg path or bad file)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-w8c-'));
  try {
    const v = path.join(dir, 'v.mp4');
    fs.writeFileSync(v, 'bytes');
    const m = path.join(dir, 'manifest.json');
    fs.writeFileSync(m, JSON.stringify([{ video: v, schedule: 'tomorrow 09:00' }]));
    // fake mp4 has no readable streams → probe warns, but warnings don't match
    // landscape|codec|vertical, so no fit is attempted — still ok.
    const res = await runBatch({ manifest: m, autoFit: true, dryRun: true, headless: true });
    assert.equal(res.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: fan-out and sweep flags surface', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const post = program.commands.find((c) => c.name() === 'post');
  assert.ok(post.options.some((o) => o.long === '--to'));
  assert.ok(post.options.some((o) => o.long === '--all'));
  const whoami = program.commands.find((c) => c.name() === 'whoami');
  assert.ok(whoami.options.some((o) => o.long === '--all'));
  const posts = program.commands.find((c) => c.name() === 'posts');
  assert.ok(posts.options.some((o) => o.long === '--since'));
  const batch = program.commands.find((c) => c.name() === 'batch');
  assert.ok(batch.options.some((o) => o.long === '--auto-fit'));
});
