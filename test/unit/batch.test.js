'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { parseManifest, buildPlan } = require('../../src/batch');

test('parseManifest: JSON array', () => {
  const file = '/tmp/captron-m-' + Date.now() + '.json';
  fs.writeFileSync(file, JSON.stringify([{ video: '/tmp/a.mp4', caption: 'hi' }]));
  try {
    const specs = parseManifest(file);
    assert.equal(specs.length, 1);
    assert.equal(specs[0].video, '/tmp/a.mp4');
    assert.equal(specs[0].caption, 'hi');
    assert.equal(specs[0].index, 0);
  } finally {
    fs.unlinkSync(file);
  }
});

test('parseManifest: {items:[...]} wrapper', () => {
  const file = '/tmp/captron-m-' + Date.now() + '.json';
  fs.writeFileSync(file, JSON.stringify({ items: [{ video: '/tmp/a.mp4' }, { video: '/tmp/b.mp4' }] }));
  try {
    const specs = parseManifest(file);
    assert.equal(specs.length, 2);
  } finally {
    fs.unlinkSync(file);
  }
});

test('parseManifest: single object', () => {
  const file = '/tmp/captron-m-' + Date.now() + '.json';
  fs.writeFileSync(file, JSON.stringify({ video: '/tmp/a.mp4' }));
  try {
    const specs = parseManifest(file);
    assert.equal(specs.length, 1);
  } finally {
    fs.unlinkSync(file);
  }
});

test('parseManifest: CSV', () => {
  const file = '/tmp/captron-m-' + Date.now() + '.csv';
  fs.writeFileSync(file, 'video,caption,hashtags\n/tmp/a.mp4,hi there,ai fun\n/tmp/b.mp4,world,fyp\n');
  try {
    const specs = parseManifest(file);
    assert.equal(specs.length, 2);
    assert.equal(specs[0].video, '/tmp/a.mp4');
    assert.equal(specs[0].caption, 'hi there');
    assert.equal(specs[0].hashtags, 'ai fun');
  } finally {
    fs.unlinkSync(file);
  }
});

test('parseManifest: rejects non-array non-object JSON', () => {
  const file = '/tmp/captron-m-' + Date.now() + '.json';
  fs.writeFileSync(file, '"just a string"');
  try {
    assert.throws(() => parseManifest(file), /array|items|object/);
  } finally {
    fs.unlinkSync(file);
  }
});

test('buildPlan: validates and preserves schedule Date', () => {
  const tmp = '/tmp/captron-plan-test.mp4';
  fs.writeFileSync(tmp, Buffer.from('x'));
  try {
    const specs = [{ index: 0, video: tmp, caption: 'hi', hashtags: 'ai', schedule: 'tomorrow 09:00' }];
    const plan = buildPlan(specs, { defaultAccount: 'main', defaultDraft: false });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].errors.length, 0);
    assert.equal(plan[0].caption, 'hi\n#ai');
    assert.ok(plan[0].scheduleDate instanceof Date, 'scheduleDate should be a Date');
    assert.equal(plan[0].draft, false);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('buildPlan: flags missing video', () => {
  const specs = [{ index: 0, video: '', caption: 'hi' }];
  const plan = buildPlan(specs, { defaultAccount: 'main' });
  assert.ok(plan[0].errors.some((e) => /missing video/.test(e)));
});

test('buildPlan: flags bad visibility', () => {
  const tmp = '/tmp/captron-plan-vis.mp4';
  fs.writeFileSync(tmp, Buffer.from('x'));
  try {
    const specs = [{ index: 0, video: tmp, visibility: 'nobody' }];
    const plan = buildPlan(specs, { defaultAccount: 'main' });
    assert.ok(plan[0].errors.some((e) => /visibility/.test(e)));
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('buildPlan: default draft propagates', () => {
  const tmp = '/tmp/captron-plan-draft.mp4';
  fs.writeFileSync(tmp, Buffer.from('x'));
  try {
    const specs = [{ index: 0, video: tmp }];
    const plan = buildPlan(specs, { defaultAccount: 'main', defaultDraft: true });
    assert.equal(plan[0].draft, true);
  } finally {
    fs.unlinkSync(tmp);
  }
});