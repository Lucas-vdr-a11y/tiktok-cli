'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { useAccount, removeAccount, accounts } = require('../../src/auth');

function withTempHome(fn) {
  const prev = process.env.CAPTRON_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-w11-'));
  process.env.CAPTRON_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prev == null) delete process.env.CAPTRON_HOME;
    else process.env.CAPTRON_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('auth: removeAccount refuses without --yes, deletes with it', () => {
  withTempHome((home) => {
    useAccount('keeper');
    useAccount('junk');
    assert.equal(accounts().accounts.length, 2);
    const no = removeAccount('junk', { yes: false });
    assert.equal(no.ok, false);
    assert.match(no.error, /--yes/);
    assert.equal(accounts().accounts.length, 2);
    // profile dir with junk in it is removed too
    fs.mkdirSync(path.join(home, 'profiles', 'junk'), { recursive: true });
    fs.writeFileSync(path.join(home, 'profiles', 'junk', 'blob'), 'x');
    const yes = removeAccount('junk', { yes: true });
    assert.equal(yes.ok, true);
    assert.equal(yes.activeAccount, 'keeper');
    assert.ok(!fs.existsSync(path.join(home, 'profiles', 'junk')));
    assert.equal(accounts().accounts.length, 1);
    assert.equal(removeAccount('ghost', { yes: true }).ok, false);
    assert.equal(removeAccount('', { yes: true }).ok, false);
  });
});

test('auth: removing the active account falls back', () => {
  withTempHome(() => {
    useAccount('only');
    const r = removeAccount('only', { yes: true });
    assert.equal(r.ok, true);
    assert.equal(accounts().activeAccount, null);
  });
});

test('cli: accounts --remove and drafts --all surface', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const accountsCmd = program.commands.find((c) => c.name() === 'accounts');
  assert.ok(accountsCmd.options.some((o) => o.long === '--remove'));
  assert.ok(accountsCmd.options.some((o) => o.long === '--yes'));
  const drafts = program.commands.find((c) => c.name() === 'drafts');
  assert.ok(drafts.options.some((o) => o.long === '--all'));
});
