'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { currentVersion, getLatest, checkUpdate } = require('../../src/update');
const { useAccount, accounts } = require('../../src/auth');

function withTempHome(fn) {
  const prev = process.env.CAPTRON_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-w7-'));
  process.env.CAPTRON_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev == null) delete process.env.CAPTRON_HOME;
    else process.env.CAPTRON_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('update: currentVersion matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.equal(currentVersion(), pkg.version);
});

test('update: getLatest returns null when registry unreachable', async () => {
  const v = await getLatest({ registry: 'http://127.0.0.1:1/', timeoutMs: 800 });
  assert.equal(v, null);
});

test('update: checkUpdate degrades gracefully offline', async () => {
  const st = await checkUpdate({ registry: 'http://127.0.0.1:1/', timeoutMs: 800 });
  assert.equal(st.ok, true);
  assert.equal(st.latest, null);
  assert.equal(st.available, false);
});

test('auth: useAccount switches active profile without browser', () => {
  withTempHome(() => {
    const r = useAccount('creator2');
    assert.equal(r.ok, true);
    assert.equal(r.activeAccount, 'creator2');
    const list = accounts();
    assert.equal(list.activeAccount, 'creator2');
    assert.ok(list.accounts.some((a) => a.name === 'creator2'));
    assert.equal(useAccount('').ok, false);
    assert.equal(useAccount('creator2').activeAccount, 'creator2');
  });
});

test('cli: use/update/batch-retries/post-auto-fit surface', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const names = program.commands.map((c) => c.name());
  assert.ok(names.includes('use'));
  assert.ok(names.includes('update'));
  const batch = program.commands.find((c) => c.name() === 'batch');
  assert.ok(batch.options.some((o) => o.long === '--retries'));
  const post = program.commands.find((c) => c.name() === 'post');
  assert.ok(post.options.some((o) => o.long === '--auto-fit'));
  const update = program.commands.find((c) => c.name() === 'update');
  assert.ok(update.options.some((o) => o.long === '--check'));
});

test('cli: completion still covers every command', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const names = program.commands.map((c) => c.name());
  const src = fs.readFileSync(path.join(__dirname, '../../src/cli.js'), 'utf8');
  const m = /_captron_cmds="([^"]+)"/.exec(src);
  assert.ok(m);
  for (const n of names) {
    assert.ok(m[1].split(' ').includes(n), 'completion misses ' + n);
  }
});
