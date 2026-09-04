'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { unwrap, parseSeries, METRICS, VALID_RANGES, RESPONSE_KEYS } = require('../../src/analytics');

const TS = 1787788800; // 2026-08-27 (matches live fixtures)

test('unwrap: plain scalar value', () => {
  const out = unwrap({ value: 5, message: { status: 1, timestamp: TS } });
  assert.deepEqual(out, { value: 5, status: 1 });
});

test('unwrap: null value with status', () => {
  const out = unwrap({ message: { status: 2, timestamp: TS } });
  assert.equal(out.value, null);
  assert.equal(out.status, 2);
});

test('unwrap: list of wrapped day values', () => {
  const wrapped = {
    message: { status: 1, timestamp: TS },
    value: [
      { message: { status: 1, timestamp: TS }, value: 0 },
      { message: { status: 1, timestamp: TS + 86400 }, value: 7 },
    ],
  };
  const out = unwrap(wrapped);
  assert.deepEqual(out.value, [0, 7]);
  assert.equal(out.status, 1);
});

test('unwrap: key_value map (active days)', () => {
  const wrapped = {
    key_value: [{ key: '20260827', value: 3 }],
    message: { status: 1, timestamp: TS },
  };
  const out = unwrap(wrapped);
  assert.deepEqual(out.value, [{ key: '20260827', value: 3 }]);
});

test('unwrap: garbage input returns null', () => {
  assert.equal(unwrap(null), null);
  assert.equal(unwrap('x'), null);
  assert.equal(unwrap(undefined), null);
});

test('parseSeries: full overview metric', () => {
  const metric = {
    total: { message: { status: 1, timestamp: TS }, value: 100 },
    delta_change: { message: { status: 1, timestamp: TS }, value: -4 },
    percent_change: { message: { status: 1, timestamp: TS }, value: -3.8 },
    list: {
      message: { status: 1, timestamp: TS },
      value: [
        { message: { status: 1, timestamp: TS }, value: 10 },
        { message: { status: 1, timestamp: TS + 86400 }, value: 90 },
      ],
    },
  };
  const out = parseSeries(metric);
  assert.equal(out.ok, true);
  assert.equal(out.total, 100);
  assert.equal(out.delta, -4);
  assert.equal(out.percent_change, -3.8);
  assert.equal(out.series.length, 2);
  assert.equal(out.series[0].date, '2026-08-27');
  assert.equal(out.series[0].value, 10);
  assert.equal(out.series[1].value, 90);
});

test('parseSeries: empty metric (status 2, no data)', () => {
  const out = parseSeries({ total: { message: { status: 2 } }, list: { message: { status: 2 } } });
  assert.equal(out.ok, false);
  assert.equal(out.total, null);
  assert.deepEqual(out.series, []);
});

test('parseSeries: null/undefined metric is safe', () => {
  const out = parseSeries(null);
  assert.equal(out.ok, false);
  assert.equal(out.total, null);
});

test('METRICS: known reverse-engineered ids', () => {
  assert.equal(METRICS.views, 121);
  assert.equal(METRICS.followers, 160);
  assert.equal(METRICS.new_viewers, 140);
  assert.equal(RESPONSE_KEYS[METRICS.views], 'analytics_overview_views');
  assert.equal(RESPONSE_KEYS[METRICS.followers], 'analytics_follower_total_followers');
});

test('VALID_RANGES: TikTok only accepts 1/7/28/60', () => {
  assert.deepEqual(VALID_RANGES, [1, 7, 28, 60]);
});
