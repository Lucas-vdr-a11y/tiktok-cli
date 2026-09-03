'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths / config primitives
// ---------------------------------------------------------------------------

const HOME_ENV_KEY = 'CAPTRON_HOME';

/** Root data directory for captron (profiles, config). */
function homeDir() {
  return process.env[HOME_ENV_KEY] || path.join(os.homedir(), '.captron');
}

function configPath() {
  return path.join(homeDir(), 'config.json');
}

function profilesDir() {
  return path.join(homeDir(), 'profiles');
}

function profileDir(account) {
  return path.join(profilesDir(), String(account || 'main'));
}

function logsDir() {
  return path.join(homeDir(), 'logs');
}

function ensureHome() {
  fs.mkdirSync(profilesDir(), { recursive: true });
  fs.mkdirSync(logsDir(), { recursive: true });
}

function readConfig() {
  ensureHome();
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (err) {
    return { accounts: [], activeAccount: null, settings: {} };
  }
}

function writeConfig(config) {
  ensureHome();
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configPath());
}

function activeAccount() {
  const cfg = readConfig();
  return cfg.activeAccount || (cfg.accounts && cfg.accounts.length ? cfg.accounts[0].name : null) || 'main';
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

let verboseEnabled = false;
let jsonEnabled = false;

function setVerbose(v) { verboseEnabled = Boolean(v); }
function isVerbose() { return verboseEnabled; }
function setJson(v) { jsonEnabled = Boolean(v); }
function isJson() { return jsonEnabled; }

/** Stable, human readable status line. Never mixes with --json. */
function log(msg) {
  if (!jsonEnabled) process.stdout.write(msg + '\n');
}

function ok(msg) { log('✔ ' + msg); }
function info(msg) { log('ℹ ' + msg); }
function step(msg) { log('· ' + msg); }

/** Warnings go to stderr so they never corrupt --json output. */
function warn(msg) { process.stderr.write('⚠ ' + msg + '\n'); }

function verbose(msg) {
  if (verboseEnabled) process.stderr.write('[debug] ' + msg + '\n');
}

function fail(msg) { process.stderr.write('✖ ' + msg + '\n'); }

/** Output a final structured result. Respects --json. */
function printResult(result, textFormat) {
  if (jsonEnabled) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (typeof textFormat === 'function') {
    process.stdout.write(textFormat(result) + '\n');
  } else if (typeof textFormat === 'string') {
    process.stdout.write(textFormat + '\n');
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Build a TikTok-ready caption: hashtags normalized as a "#tag #tag" suffix.
 */
function buildCaption({ caption, hashtags }) {
  const parts = [];
  if (caption && String(caption).trim()) parts.push(String(caption).trim());

  const tags = [];
  const raw = hashtags ? String(hashtags) : '';
  for (let chunk of raw.split(/[\s,;]+/)) {
    chunk = chunk.trim().replace(/^#+/, '');
    if (!chunk) continue;
    const cleaned = chunk.replace(/\s+/g, '_');
    if (/^[a-zA-Z0-9_\u00C0-\u024F]+$/.test(cleaned)) tags.push('#' + cleaned);
  }
  if (tags.length) parts.push(tags.join(' '));
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Parse a human schedule string to a Date, or null when invalid. */
function parseSchedule(input, now = new Date()) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;

  // ISO / "YYYY-MM-DD HH:mm" (assumed local time of the machine)
  const absolute = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?$/.exec(s);
  if (absolute) {
    const d = new Date(
      Number(absolute[1]),
      Number(absolute[2]) - 1,
      Number(absolute[3]),
      Number(absolute[4] || 9),
      Number(absolute[5] || 0),
      0
    );
    return isNaN(d.getTime()) ? null : d;
  }

  // relative: "+2h", "+90m", "+3d"
  const rel = /^\+(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2] || 'm';
    const ms = unit.startsWith('h') ? n * 3600e3 : unit.startsWith('d') ? n * 86400e3 : n * 60e3;
    const d = new Date(now.getTime() + ms);
    return d;
  }

  // "tomorrow HH:mm"
  const tom = /^tomorrow(?:[ t](\d{1,2}):(\d{2}))?$/.exec(s);
  if (tom) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, Number(tom[1] || 9), Number(tom[2] || 0), 0);
    return d;
  }

  // "today HH:mm"
  const today = /^today(?:[ t](\d{1,2}):(\d{2}))?$/.exec(s);
  if (today) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(today[1] || 9), Number(today[2] || 0), 0);
    return d;
  }

  return null;
}

/** Format a Date for display in results. */
function formatDate(d) {
  if (!d) return null;
  return d.toISOString();
}

/** Humanize seconds. */
function humanize(seconds) {
  if (seconds < 60) return Math.round(seconds) + 's';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m + 'm ' + s + 's';
}

/**
 * Format bytes as a human readable string ("7.2 MB").
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? Math.round(v) : Math.round(v * 10) / 10) + ' ' + units[i];
}

/** Sleep helper. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Simple async timeout race. */
async function withTimeout(promise, ms, message) {
  let timer;
  const to = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(message || `Timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  try {
    return await Promise.race([promise, to]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function fileExists(p) { return fs.existsSync(p); }

function validateVideoPath(p) {
  if (!p) return { ok: false, error: 'missing video path' };
  const resolved = path.resolve(p);
  if (!fs.existsSync(resolved)) return { ok: false, error: `file not found: ${p}` };
  const st = fs.statSync(resolved);
  if (!st.isFile()) return { ok: false, error: `not a file: ${p}` };
  if (st.size === 0) return { ok: false, error: `empty file: ${p}` };
  return { ok: true, path: resolved, size: st.size };
}

module.exports = {
  homeDir,
  configPath,
  profilesDir,
  profileDir,
  logsDir,
  ensureHome,
  readConfig,
  writeConfig,
  activeAccount,
  setVerbose,
  isVerbose,
  setJson,
  isJson,
  log,
  ok,
  info,
  step,
  warn,
  verbose,
  fail,
  printResult,
  buildCaption,
  parseSchedule,
  formatDate,
  humanize,
  formatBytes,
  sleep,
  withTimeout,
  fileExists,
  validateVideoPath,
};