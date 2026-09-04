'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scheduleWarnings } = require('../../src/utils');
const { dirSize, profileSizes, cleanCaches } = require('../../src/maintain');
const { summarizeBestTimes } = require('../../src/analytics');
const { buildPlan } = require('../../src/batch');

function withTempHome(fn) {
  const prev = process.env.CAPTRON_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-w5-'));
  process.env.CAPTRON_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev == null) delete process.env.CAPTRON_HOME;
    else process.env.CAPTRON_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('utils: scheduleWarnings flags tight and far schedules', () => {
  const now = new Date('2026-01-01T10:00:00Z');
  assert.equal(scheduleWarnings(null, now).length, 0);
  assert.equal(scheduleWarnings(new Date('2026-01-01T12:00:00Z'), now).length, 0);
  const tight = scheduleWarnings(new Date(now.getTime() + 5 * 60e3), now);
  assert.ok(tight.join(' ').includes('20 min'));
  const far = scheduleWarnings(new Date(now.getTime() + 20 * 86400e3), now);
  assert.ok(far.join(' ').includes('10 days'));
});

test('maintain: dirSize sums files, profileSizes lists accounts', () => {
  withTempHome((home) => {
    assert.deepEqual(profileSizes(), []);
    const dir = path.join(home, 'profiles', 'main', 'Default', 'Cache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'blob'), Buffer.alloc(1024));
    const sizes = profileSizes();
    assert.equal(sizes.length, 1);
    assert.equal(sizes[0].name, 'main');
    assert.ok(sizes[0].bytes >= 1024);
    assert.equal(dirSize(path.join(home, 'nope')), 0);
  });
});

test('maintain: cleanCaches dry-run reports, real run keeps sessions', () => {
  withTempHome((home) => {
    const prof = path.join(home, 'profiles', 'main');
    fs.mkdirSync(path.join(prof, 'Default', 'Cache'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'Default', 'Cache', 'blob'), Buffer.alloc(2048));
    fs.writeFileSync(path.join(prof, 'Preferences'), '{}'); // session-ish, must survive
    const dry = cleanCaches({ dryRun: true });
    assert.ok(dry.freed >= 2048);
    assert.ok(fs.existsSync(path.join(prof, 'Default', 'Cache', 'blob')));
    const real = cleanCaches({ dryRun: false });
    assert.ok(real.freed >= 2048);
    assert.ok(!fs.existsSync(path.join(prof, 'Default', 'Cache')));
    assert.ok(fs.existsSync(path.join(prof, 'Preferences')));
  });
});

test('analytics: summarizeBestTimes ranks activity', () => {
  const m = {
    active_days: { series: [{ date: '2026-01-01', value: 5 }, { date: '2026-01-02', value: 9 }] },
    active_hours: { series: [{ date: '18:00', value: 3 }, { date: '20:00', value: 12 }] },
  };
  const r = summarizeBestTimes(m);
  assert.equal(r.days[0].date, '2026-01-02');
  assert.equal(r.hours[0].date, '20:00');
  assert.ok(r.suggestion.includes('20:00'));
  const empty = summarizeBestTimes({});
  assert.equal(empty.suggestion, null);
  assert.deepEqual(empty.days, []);
});

test('batch: plan carries schedule-window warnings', () => {
  const plan = buildPlan([{ index: 0, video: './a.mp4', schedule: '2030-01-01 09:00' }], { defaultAccount: 'main' });
  assert.ok(plan[0].warnings.join(' ').includes('10 days'));
  const fine = buildPlan([{ index: 0, video: './a.mp4', schedule: 'tomorrow 09:00' }], { defaultAccount: 'main' });
  assert.ok(!fine[0].warnings.join(' ').includes('10 days'));
});

test('cli: best-time/clean/new-niche surface', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const names = program.commands.map((c) => c.name());
  for (const need of ['best-time', 'clean', 'sync', 'calendar', 'caption']) {
    assert.ok(names.includes(need), 'missing command ' + need);
  }
  const nw = program.commands.find((c) => c.name() === 'new');
  assert.ok(nw.options.some((o) => o.long === '--niche'));
});
