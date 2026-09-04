'use strict';

const fs = require('fs');
const path = require('path');
const { profilesDir, formatBytes } = require('./utils');

/**
 * Profile care: disk usage + safe cache pruning (cookies/sessions untouched).
 * Chromium cache dirs are disposable — deleting them only makes the next
 * launch re-fetch assets. Never touches Local Storage / cookies / Preferences.
 * Caches live both top-level and under Default/ in persistent contexts.
 */

const SAFE_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'Crash Reports'];
const PROFILE_ROOTS = ['', 'Default'];

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      try {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) total += fs.statSync(p).size;
      } catch (_) {}
    }
  }
  return total;
}

/** [{ name, bytes, human }] per account profile. Empty list when none. */
function profileSizes() {
  let profiles = [];
  try {
    profiles = fs.readdirSync(profilesDir());
  } catch (_) {
    return [];
  }
  return profiles.map((name) => {
    const bytes = dirSize(path.join(profilesDir(), name));
    return { name, bytes, human: formatBytes(bytes) };
  });
}

/**
 * Delete disposable Chromium cache dirs in every profile.
 * `dryRun` only reports. Returns { ok, dryRun, removed[], freed, freedHuman }.
 */
function cleanCaches({ dryRun = false } = {}) {
  let profiles = [];
  try {
    profiles = fs.readdirSync(profilesDir());
  } catch (_) {
    return { ok: true, dryRun, removed: [], freed: 0, freedHuman: formatBytes(0) };
  }
  const removed = [];
  let freed = 0;
  for (const profile of profiles) {
    for (const root of PROFILE_ROOTS) {
      for (const cache of SAFE_CACHE_DIRS) {
        const rel = path.join(root, cache);
        const dir = path.join(profilesDir(), profile, rel);
        let size = 0;
        try {
          if (!fs.existsSync(dir)) continue;
          size = dirSize(dir);
        } catch (_) {
          continue;
        }
        if (dryRun) {
          removed.push({ profile, dir: rel, bytes: size });
          freed += size;
          continue;
        }
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          removed.push({ profile, dir: rel, bytes: size });
          freed += size;
        } catch (_) {}
      }
    }
  }
  return { ok: true, dryRun, removed, freed, freedHuman: formatBytes(freed) };
}

module.exports = { profileSizes, cleanCaches, dirSize, SAFE_CACHE_DIRS, PROFILE_ROOTS };
