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

/** TikTok-side limits (Studio web, 2026-09). Used for validation + warnings. */
const LIMITS = {
  captionMax: 2200,
  hashtagsMax: 30,
  videoExts: ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'],
  imageExts: ['.jpg', '.jpeg', '.png', '.webp', '.bmp'],
  slideshowMin: 2,
  slideshowMax: 10,
  maxVideoBytes: 10 * 1024 * 1024 * 1024,
  warnVideoBytes: 500 * 1024 * 1024,
};

/**
 * Parse a raw hashtag string into clean tags (no leading #, deduped).
 * Accepts comma/space/semicolon separated, with or without leading #.
 */
function parseHashtags(raw) {
  const tags = [];
  const seen = new Set();
  const s = raw == null ? '' : String(raw);
  for (let chunk of s.split(/[\s,;]+/)) {
    chunk = chunk.trim().replace(/^#+/, '');
    if (!chunk) continue;
    const cleaned = chunk.replace(/\s+/g, '_');
    if (!/^[a-zA-Z0-9_\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+$/.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(cleaned);
  }
  return tags;
}

/**
 * Build a TikTok-ready caption: hashtags normalized as a "#tag #tag" suffix.
 * Hashtags are deduped (case-insensitive) and invalid tokens are dropped.
 */
function buildCaption({ caption, hashtags }) {
  const parts = [];
  if (caption && String(caption).trim()) parts.push(String(caption).trim());
  const tags = parseHashtags(hashtags);
  if (tags.length) parts.push(tags.map((t) => '#' + t).join(' '));
  return parts.join('\n');
}

/**
 * Build caption + validation warnings (length, hashtag count).
 * Returns { text, tags, warnings } — warnings are non-fatal.
 */
function buildCaptionDetailed({ caption, hashtags }) {
  const text = buildCaption({ caption, hashtags });
  const tags = parseHashtags(hashtags);
  const warnings = [];
  if (text.length > LIMITS.captionMax) warnings.push('caption is ' + text.length + ' chars (TikTok limit ~' + LIMITS.captionMax + '); it will be truncated');
  if (tags.length > LIMITS.hashtagsMax) warnings.push(tags.length + ' hashtags (TikTok shows best results with far fewer); consider trimming to ~5');
  return { text, tags, warnings };
}


// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Parse a human schedule string to a Date, or null when invalid. */
function parseSchedule(input, now = new Date()) {
  if (!input) return null;
  const raw = String(input).trim();
  const s = raw.toLowerCase();
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
  // "YYYY/MM/DD HH:mm" variant
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ t](\d{1,2}):(\d{2}))?$/.exec(s);
  if (slash) {
    const d = new Date(Number(slash[1]), Number(slash[2]) - 1, Number(slash[3]), Number(slash[4] || 9), Number(slash[5] || 0), 0);
    return isNaN(d.getTime()) ? null : d;
  }
  // relative: "+2h", "+90m", "+3d"
  const rel = /^\+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2] || 'm';
    const ms = unit.startsWith('w') ? n * 7 * 86400e3 : unit.startsWith('h') ? n * 3600e3 : unit.startsWith('d') ? n * 86400e3 : n * 60e3;
    return new Date(now.getTime() + ms);
  }
  // "in 2 hours" / "in 30 minutes" / "in 3 days"
  const inRel = /^in\s+(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/.exec(s);
  if (inRel) {
    const n = Number(inRel[1]);
    const unit = inRel[2];
    const ms = unit.startsWith('w') ? n * 7 * 86400e3 : unit.startsWith('h') ? n * 3600e3 : unit.startsWith('d') ? n * 86400e3 : n * 60e3;
    return new Date(now.getTime() + ms);
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
  // bare "HH:mm" — today if still in the future, else tomorrow
  const hm = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h > 23 || m > 59) return null;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  // weekday: "monday 09:00", "fri 18:30", "next friday 18:00"
  const days = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
  const wd = /^(next\s+)?(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)(?:[ t](\d{1,2}):(\d{2}))?$/.exec(s);
  if (wd) {
    const want = days[wd[2]];
    const isNext = !!wd[1];
    const h = wd[3] != null ? Number(wd[3]) : 9;
    const m = wd[4] != null ? Number(wd[4]) : 0;
    if (h > 23 || m > 59) return null;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    let delta = (want - d.getDay() + 7) % 7;
    if (isNext) delta = delta === 0 ? 7 : delta + 7 > 7 ? delta + 7 - 7 + 7 : delta + 7;
    else if (delta === 0 && d.getTime() <= now.getTime()) delta = 7;
    if (isNext && delta === 0) delta = 7;
    if (isNext && delta <= 7 && d.getTime() > now.getTime() && (want - now.getDay() + 7) % 7 === delta - 7) delta += 0;
    d.setDate(d.getDate() + delta);
    // "next <day>" always means the week after the coming one when the plain
    // weekday would already land >7 days out — keep it simple: at least 7 days.
    if (isNext && (d.getTime() - now.getTime()) < 7 * 86400e3) d.setDate(d.getDate() + 7);
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
  const ext = path.extname(resolved).toLowerCase();
  if (ext && !LIMITS.videoExts.includes(ext) && !LIMITS.imageExts.includes(ext)) return { ok: false, error: `unsupported extension "${ext}" (expected ${LIMITS.videoExts.join('/')})` };
  if (st.size > LIMITS.maxVideoBytes) return { ok: false, error: `file is ${(st.size / 1024 / 1024 / 1024).toFixed(1)} GB (TikTok web limit ~10 GB)` };
  const res = { ok: true, path: resolved, size: st.size };
  if (st.size > LIMITS.warnVideoBytes) res.warning = `large file (${formatBytes(st.size)}); upload may take a while`;
  return res;
}

/** Validate a slideshow image list (2–10 images). */
function validateImagePaths(paths) {
  if (!Array.isArray(paths) || !paths.length) return { ok: false, error: 'no slideshow images given' };
  if (paths.length < LIMITS.slideshowMin) return { ok: false, error: `slideshow needs at least ${LIMITS.slideshowMin} images (got ${paths.length})` };
  if (paths.length > LIMITS.slideshowMax) return { ok: false, error: `slideshow supports at most ${LIMITS.slideshowMax} images (got ${paths.length})` };
  for (const p of paths) {
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved)) return { ok: false, error: `file not found: ${p}` };
    const ext = path.extname(resolved).toLowerCase();
    if (!LIMITS.imageExts.includes(ext)) return { ok: false, error: `not an image: ${p} (expected ${LIMITS.imageExts.join('/')})` };
    if (fs.statSync(resolved).size === 0) return { ok: false, error: `empty file: ${p}` };
  }
  return { ok: true, paths: paths.map((p) => path.resolve(p)) };
}

/**
 * Retry an async fn up to `tries` times with `delayMs` between attempts.
 * Re-throws the last error. `onRetry(err, attempt)` is best-effort.
 */
async function retry(fn, { tries = 3, delayMs = 1000, onRetry } = {}) {
  let last;
  for (let i = 1; i <= Math.max(1, tries); i++) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (i < tries) {
        try { if (onRetry) onRetry(err, i); } catch (_) {}
        await sleep(delayMs);
      }
    }
  }
  throw last;
}

/** Read + parse a JSON file, or return fallback. Never throws. */
function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (_) {
    return fallback;
  }
}

/** Minimal CSV serializer (quotes fields containing , " or newline). */
function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map(esc).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(','));
  return lines.join('\n') + '\n';
}

/**
 * Resolve which account profile to use.
 * Precedence: explicit CLI arg > CAPTRON_ACCOUNT env > saved active > 'main'.
 */
function resolveAccount(cliAccount) {
  if (cliAccount) return String(cliAccount);
  if (process.env.CAPTRON_ACCOUNT) return String(process.env.CAPTRON_ACCOUNT);
  try {
    const active = activeAccount();
    if (active) return active;
  } catch (_) {}
  return 'main';
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
  buildCaptionDetailed,
  parseHashtags,
  parseSchedule,
  formatDate,
  humanize,
  formatBytes,
  sleep,
  withTimeout,
  retry,
  readJsonFile,
  toCsv,
  resolveAccount,
  fileExists,
  validateVideoPath,
  validateImagePaths,
  LIMITS,
};