'use strict';

/**
 * Self-update helpers (offline-safe, best-effort network).
 * `getLatest` hits the npm registry with a short timeout and returns the
 * version string or null (never throws). `checkUpdate` compares against the
 * installed package version. `runUpdate` shells out to npm.
 */

function currentVersion() {
  try {
    return require('../package.json').version;
  } catch (_) {
    return null;
  }
}

async function getLatest({ registry = 'https://registry.npmjs.org/captron/latest', timeoutMs = 4000 } = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.max(500, Number(timeoutMs) || 4000));
    try {
      const res = await fetch(registry, { signal: ctrl.signal });
      if (!res || !res.ok) return null;
      const data = await res.json().catch(() => null);
      return data && typeof data.version === 'string' ? data.version : null;
    } finally {
      clearTimeout(t);
    }
  } catch (_) {
    return null;
  }
}

async function checkUpdate(opts = {}) {
  const current = currentVersion();
  const latest = await getLatest(opts);
  if (!current || !latest) return { ok: true, current, latest, available: false, unknown: !latest };
  return { ok: true, current, latest, available: latest !== current };
}

function runUpdate({ tag = 'latest' } = {}) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('npm', ['install', '-g', 'captron@' + tag], { stdio: 'inherit' });
  if (r.error) return { ok: false, error: r.error.message };
  return { ok: r.status === 0, code: r.status };
}

module.exports = { currentVersion, getLatest, checkUpdate, runUpdate };
