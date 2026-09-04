'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sweepAccounts, useAccount } = require('../../src/auth');
const { exportPath } = require('../../src/utils');

function withTempHome(fn) {
  const prev = process.env.CAPTRON_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-w9-'));
  process.env.CAPTRON_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev == null) delete process.env.CAPTRON_HOME;
    else process.env.CAPTRON_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('auth: sweepAccounts runs fn per account, isolates failures', async () => {
  await withTempHome(async () => {
    const empty = await sweepAccounts(async (name) => ({ ok: true, account: name }), { fallback: 'main' });
    assert.equal(empty.length, 1);
    assert.equal(empty[0].account, 'main');
    useAccount('a');
    useAccount('b');
    const rows = await sweepAccounts(async (name) => {
      if (name === 'b') throw new Error('boom');
      return { ok: true, account: name };
    }, { fallback: 'main' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].ok, true);
    assert.equal(rows[1].ok, false);
    assert.match(rows[1].error, /boom/);
  });
});

test('utils: exportPath per-account names', () => {
  assert.equal(exportPath('out.csv', 'alice'), 'out-alice.csv');
  assert.equal(exportPath('dir/metrics.csv', 'bob!'), 'dir/metrics-bob-.csv');
  assert.equal(exportPath('noext', 'a'), 'noext-a.csv');
});

test('cli: sweep flags surface on posts/analytics/sync/logout', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  for (const name of ['posts', 'analytics', 'sync', 'logout']) {
    const cmd = program.commands.find((c) => c.name() === name);
    assert.ok(cmd, name + ' exists');
    assert.ok(cmd.options.some((o) => o.long === '--all'), name + ' has --all');
  }
});
