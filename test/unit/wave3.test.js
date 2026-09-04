'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { probeFile, buildFitArgs, fitFile, fixStaleLocks, ffmpegAvailable } = require('../../src/media');
const { buildPlan, runBatch } = require('../../src/batch');

function tmpFile(ext, content = 'x') {
  const f = path.join(os.tmpdir(), 'captron-w3-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + ext);
  fs.writeFileSync(f, content);
  return f;
}

test('media: probeFile rejects missing/empty/unsupported', () => {
  assert.equal(probeFile(null).ok, false);
  assert.equal(probeFile('/nope-' + Date.now() + '.mp4').ok, false);
  const f = tmpFile('.txt', 'hello');
  try {
    const r = probeFile(f);
    assert.equal(r.ok, false);
    assert.match(r.issues.join(';'), /unsupported extension/);
    assert.equal(r.kind, 'other');
  } finally {
    fs.unlinkSync(f);
  }
});

test('media: probeFile accepts a real mp4 (duration may be null without ffmpeg)', () => {
  const f = tmpFile('.mp4', 'fake-bytes');
  try {
    const r = probeFile(f);
    assert.equal(r.kind, 'video');
    assert.equal(r.ok, true);
    assert.equal(r.fitsTikTok, true);
  } finally {
    fs.unlinkSync(f);
  }
});

test('media: buildFitArgs shapes a vertical H264 command', () => {
  const args = buildFitArgs({ input: 'a.mp4', output: 'b.mp4' });
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.ok(args.join(' ').includes('scale=1080:1920'));
  assert.ok(args.join(' ').includes('+faststart'));
});

test('media: fitFile refuses without input or ffmpeg', () => {
  assert.equal(fitFile({}).ok, false);
  assert.equal(fitFile({ input: '/nope.mp4' }).ok, false);
  const f = tmpFile('.mp4', 'x');
  try {
    const r = fitFile({ input: f, output: f + '.out.mp4' });
    if (!ffmpegAvailable().ok) assert.match(r.error, /ffmpeg not found/);
    else assert.ok('ok' in r);
  } finally {
    fs.unlinkSync(f);
    try { fs.unlinkSync(f + '.out.mp4'); } catch (_) {}
  }
});

test('media: fixStaleLocks removes fake locks under CAPTRON_HOME', () => {
  const prev = process.env.CAPTRON_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-home-'));
  process.env.CAPTRON_HOME = home;
  try {
    const dir = path.join(home, 'profiles', 'main');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SingletonLock'), 'x');
    const r = fixStaleLocks();
    assert.equal(r.ok, true);
    assert.ok(r.removed.includes('main/SingletonLock'));
    assert.ok(!fs.existsSync(path.join(dir, 'SingletonLock')));
  } finally {
    if (prev == null) delete process.env.CAPTRON_HOME;
    else process.env.CAPTRON_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('batch: buildPlan exposes caption warnings', () => {
  const plan = buildPlan([{ index: 0, video: './a.mp4', caption: 'x'.repeat(2300) }], { defaultAccount: 'main' });
  assert.ok(plan[0].warnings.length >= 1);
});

test('batch: strict mode rejects warned manifests without posting', async () => {
  const v = tmpFile('.mp4', 'bytes');
  const m = tmpFile('.json', JSON.stringify([{ video: v, caption: 'x'.repeat(2300) }]));
  try {
    const res = await runBatch({ manifest: m, strict: true, dryRun: false, headless: true });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid specs');
    const dry = await runBatch({ manifest: m, dryRun: true, headless: true });
    assert.equal(dry.ok, true);
  } finally {
    fs.unlinkSync(v);
    fs.unlinkSync(m);
  }
});

test('batch: jitter passes through on dry runs', async () => {
  const v = tmpFile('.mp4', 'bytes');
  const m = tmpFile('.json', JSON.stringify([{ video: v }]));
  try {
    const res = await runBatch({ manifest: m, dryRun: true, delaySec: 1, jitterSec: 5, headless: true });
    assert.equal(res.ok, true);
  } finally {
    fs.unlinkSync(v);
    fs.unlinkSync(m);
  }
});

test('cli: probe/fit/strict/jitter surface', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const names = program.commands.map((c) => c.name());
  assert.ok(names.includes('probe'));
  assert.ok(names.includes('fit'));
  const post = program.commands.find((c) => c.name() === 'post');
  const batch = program.commands.find((c) => c.name() === 'batch');
  const doctor = program.commands.find((c) => c.name() === 'doctor');
  assert.ok(post.options.some((o) => o.long === '--strict'));
  assert.ok(batch.options.some((o) => o.long === '--jitter'));
  assert.ok(batch.options.some((o) => o.long === '--strict'));
  assert.ok(doctor.options.some((o) => o.long === '--fix'));
});
