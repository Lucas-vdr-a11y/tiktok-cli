'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('path');

const { runPool } = require('../../src/utils');
const { buildBashCompletion, buildZshCompletion, buildFishCompletion } = require('../../src/completion');
const { buildProgram, readJobsFlag } = require('../../src/cli');

const BIN = path.resolve(__dirname, '../../bin/captron.js');
const run = (args, env = {}) => execFileSync('node', [BIN, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CAPTRON_HOME: '/tmp/captron-wave12-test', ...env },
});

// -- runPool ----------------------------------------------------------------

test('runPool: sequential by default, order preserved', async () => {
  const order = [];
  const out = await runPool(['a', 'b', 'c'], async (x) => { order.push(x); return x.toUpperCase(); });
  assert.deepEqual(out, ['A', 'B', 'C']);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('runPool: bounds concurrency and keeps order', async () => {
  let live = 0; let max = 0;
  const out = await runPool([1, 2, 3, 4, 5], async (n) => {
    live++; max = Math.max(max, live);
    await new Promise((r) => setTimeout(r, 15));
    live--;
    return n * 10;
  }, 2);
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.equal(max, 2);
});

test('runPool: jobs>=items all run at once, rejections propagate', async () => {
  let live = 0; let max = 0;
  await runPool([1, 2, 3], async () => { live++; max = Math.max(max, live); await new Promise((r) => setTimeout(r, 10)); live--; }, 3);
  assert.equal(live, 0);
  assert.equal(max, 3);
  await assert.rejects(runPool([1], async () => { throw new Error('nope'); }, 2));
});

// -- sweepAccounts with jobs -------------------------------------------------

test('sweepAccounts: parallel, ordered, error-isolated', async () => {
  process.env.CAPTRON_HOME = '/tmp/captron-wave12-test';
  require('node:fs').rmSync('/tmp/captron-wave12-test', { recursive: true, force: true });
  const { execSync } = require('node:child_process');
  execSync(`node "${BIN}" use w1 >/dev/null; node "${BIN}" use w2 >/dev/null; node "${BIN}" use w3 >/dev/null`, {
    env: { ...process.env, CAPTRON_HOME: '/tmp/captron-wave12-test' },
  });
  const auth = require('../../src/auth');
  let live = 0; let max = 0;
  const out = await auth.sweepAccounts(async (n) => {
    live++; max = Math.max(max, live);
    await new Promise((r) => setTimeout(r, 20));
    live--;
    if (n === 'w2') throw new Error('bad-w2');
    return { ok: true, account: n };
  }, { fallback: 'main', jobs: 3 });
  assert.deepEqual(out.map((r) => r.account), ['w1', 'w2', 'w3']);
  assert.equal(max, 3);
  assert.equal(out.find((r) => r.account === 'w2').error, 'bad-w2');
  assert.equal(out.filter((r) => r.ok).length, 2);
});

// -- readJobsFlag ------------------------------------------------------------

test('readJobsFlag: parsed, argv, =form, env, default', () => {
  assert.equal(readJobsFlag(['node', 'x', 'sync'], 3), 3);
  assert.equal(readJobsFlag(['node', 'x', 'sync', '--all', '--jobs', '4'], undefined), 4);
  assert.equal(readJobsFlag(['node', 'x', '--jobs=5', 'sync'], undefined), 5);
  assert.equal(readJobsFlag(['node', 'x', 'sync'], undefined), 1);
  assert.equal(readJobsFlag(['node', 'x', 'sync'], 0), 1);
  process.env.CAPTRON_JOBS = '6';
  try {
    assert.equal(readJobsFlag(['node', 'x', 'sync'], undefined), 6);
  } finally {
    delete process.env.CAPTRON_JOBS;
  }
});

// -- dynamic completion ------------------------------------------------------

test('completion: every command + global --jobs in all shells', () => {
  const program = buildProgram();
  const names = program.commands.map((c) => c.name()).filter(Boolean);
  assert.ok(names.length > 20, 'expected 20+ commands, got ' + names.length);
  for (const sh of ['bash', 'zsh', 'fish']) {
    const out = run(['completion', sh]);
    for (const n of names) assert.ok(out.includes(n), `${sh} missing command ${n}`);
    if (sh === 'fish') assert.ok(out.includes("-l 'jobs'"), 'fish missing global --jobs');
    else assert.ok(out.includes('--jobs'), `${sh} missing global --jobs`);
  }
  const bash = run(['completion', 'bash']);
  assert.ok(bash.includes('_captron_flags_post='), 'bash missing per-command flags');
  assert.ok(bash.includes('--caption'), 'bash post flags missing --caption');
  const fish = run(['completion', 'fish']);
  assert.ok(fish.includes('__fish_seen_subcommand_from post'), 'fish missing per-command entries');
});

test('completion: defaults to bash, rejects unknown shells', () => {
  const def = run(['completion']);
  assert.ok(def.includes('_captron_cmds='), 'default should be bash script');
  assert.throws(() => run(['completion', 'powershell']), /unknown shell/);
});

test('completion builders: quote-safe outputs', () => {
  const cmds = [{ name: 'x', desc: "it's [bracketed] $dollar", flags: [{ long: '--f', short: '-f', desc: "don't `tick`", takesValue: true }] }];
  const bash = buildBashCompletion(cmds, []);
  assert.ok(!bash.includes('$dollar') || bash.includes('\\$dollar'), 'bash must escape $');
  const zsh = buildZshCompletion(cmds, []);
  assert.ok(!/\[bracketed\]/.test(zsh.split('\n').find((l) => l.includes('--f'))), 'zsh specs must strip []');
  const fish = buildFishCompletion(cmds, []);
  assert.ok(fish.includes("-d 'don\\'t `tick`'") || fish.includes("don't"), 'fish desc present');
});
