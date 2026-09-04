'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runBatch } = require('../../src/batch');

function tmpManifest(items) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captron-w6-'));
  const files = [];
  const specs = items.map((extra, i) => {
    const v = path.join(dir, 'v' + i + '.mp4');
    fs.writeFileSync(v, 'bytes');
    files.push(v);
    return { video: v, ...extra };
  });
  const m = path.join(dir, 'manifest.json');
  fs.writeFileSync(m, JSON.stringify(specs));
  return { dir, manifest: m };
}

test('batch: --probe adds media warnings to dry-run plan', async () => {
  const { manifest, dir } = tmpManifest([{ caption: 'fine' }]);
  try {
    const plain = await runBatch({ manifest, dryRun: true, headless: true });
    const probed = await runBatch({ manifest, dryRun: true, probe: true, headless: true });
    assert.equal(plain.ok, true);
    assert.equal(probed.ok, true);
    assert.ok(Array.isArray(probed.results[0].warnings));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('batch: probe warnings fail under strict when media warns', async () => {
  const { manifest, dir } = tmpManifest([{ caption: 'x'.repeat(2300) }]);
  try {
    const res = await runBatch({ manifest, probe: true, strict: true, headless: true });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid specs');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: batch --probe and doctor --offline surface', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const batch = program.commands.find((c) => c.name() === 'batch');
  const doctor = program.commands.find((c) => c.name() === 'doctor');
  assert.ok(batch.options.some((o) => o.long === '--probe'));
  assert.ok(doctor.options.some((o) => o.long === '--offline'));
  assert.ok(doctor.options.some((o) => o.long === '--fix'));
});

test('cli: completion covers all commands', () => {
  const { buildProgram } = require('../../src/cli');
  const program = buildProgram();
  const names = program.commands.map((c) => c.name());
  const src = fs.readFileSync(path.join(__dirname, '../../src/cli.js'), 'utf8');
  const m = /_captron_cmds="([^"]+)"/.exec(src);
  assert.ok(m, 'completion string found');
  for (const n of names) {
    if (n === 'help') continue;
    assert.ok(m[1].split(' ').includes(n), 'completion misses ' + n);
  }
});
