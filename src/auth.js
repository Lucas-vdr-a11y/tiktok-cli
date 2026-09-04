'use strict';

const { launchProfile } = require('./browser');
const { resolveHandle, URLS } = require('./selectors');
const {
  readConfig,
  writeConfig,
  profileDir,
  verbose,
  step,
  ok,
  warn,
  sleep,
  withTimeout,
} = require('./utils');

const TIKTOK_DOMAINS = [
  'https://www.tiktok.com',
  'https://tiktok.com',
  'https://www.tiktokv.com',
  'https://tiktokv.com',
  'https://www.bytedance.com',
];

/** Returns true when the persistent context holds a live TikTok session. */
async function isLoggedIn(context) {
  const cookies = await context.cookies('https://www.tiktok.com');
  return cookies.some((c) => c.name === 'sessionid' && c.value.length > 5);
}

/**
 * `captron login [account]`
 * Opens a real, visible browser window with the account's persistent profile,
 * where the user scans the QR code (or signs in). The moment TikTok issues a
 * session cookie we consider login complete; state persists for later runs.
 */
async function login({ account = 'main', timeoutSec = 300, headless = false } = {}) {
  const dir = profileDir(account);
  step(`Launching profile for account "${account}" (${dir})`);
  const context = await launchProfile({ account, headless });

  // Already logged in?
  if (await isLoggedIn(context)) {
    const page = await context.newPage();
    await page.goto(URLS.creatorCenter, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(2500);
    const handle = await resolveHandle(page).catch(() => null);
    await persistSession(context, account, handle);
    await context.close();
    ok(`Already logged in${handle ? ` as ${handle}` : ''}. Account "${account}" is ready.`);
    return { account, loggedIn: true, handle };
  }

  step('Opening TikTok. Scan the QR code with the TikTok app (Me → QR code icon) or log in manually.');
  const page = await context.newPage();
  await page.goto(URLS.login, { waitUntil: 'domcontentloaded' }).catch(() => {});
  step(`Waiting for login on https://www.tiktok.com/login (timeout ${timeoutSec}s)...`);

  const result = await withTimeout(
    (async () => {
      for (;;) {
        await sleep(1500);
        if (await isLoggedIn(context)) return true;
        // Bail out when the user closes the window.
        if (context.pages().length === 0) return false;
      }
    })(),
    timeoutSec * 1000,
    'Login timed out. Run `captron login` again when you are ready.'
  );

  if (result === false) {
    await context.close();
    throw new Error('Browser window closed before login completed.');
  }

  // Grab handle for metadata.
  try {
    const p = await context.newPage();

    await p.goto(URLS.creatorCenter, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(2500);
  } catch (err) { verbose('handle resolve failed: ' + err.message); }

  await persistSession(context, account);
  await context.close();
  ok(`Login successful for account "${account}". Session saved to ${dir}`);
  return { account, loggedIn: true };
}

/** Record account metadata + activate it. */
async function persistSession(context, account, handle = null) {
  const cfg = readConfig();
  const existing = (cfg.accounts || []).find((a) => a.name === account);
  const entry = Object.assign({}, existing || {}, {
    name: account,
    profileDir: profileDir(account),
    loginAt: new Date().toISOString(),
    handle: handle ? handle.replace(/^\/@?/, '') : null,
  });
  const accounts = (cfg.accounts || []).filter((a) => a.name !== account);
  accounts.unshift(entry);
  cfg.accounts = accounts;
  cfg.activeAccount = account;
  writeConfig(cfg);
}

/** `captron whoami [account]` */
async function whoami({ account = 'main' } = {}) {
  const context = await launchProfile({ account });
  if (!(await isLoggedIn(context))) {
    await context.close();
    return { account, loggedIn: false, handle: null };
  }
  const page = await context.newPage();
  await page.goto(URLS.creatorCenter, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(2500);
  const handle = await resolveHandle(page).catch(() => null);
  const cookies = await context.cookies('https://www.tiktok.com');
  const uid = cookies.find((c) => c.name === 'uid_tt');
  await context.close();
  return { account, loggedIn: true, handle: handle ? handle.replace(/^\/@?/, '') : null, uid: uid ? uid.value : null };
}

/**
 * `captron whoami --all` — session status for every known account.
 * Sequential launches (one context at a time); a broken profile reports
 * ok:false for that row instead of failing the whole sweep.
 */
async function whoamiAll({ headless = true } = {}) {
  const list = accounts();
  const rows = [];
  for (const a of list.accounts) {
    try {
      const context = await launchProfile({ account: a.name, headless });
      try {
        if (!(await isLoggedIn(context))) {
          rows.push({ account: a.name, loggedIn: false, handle: null });
          continue;
        }
        const page = await context.newPage();
        await page.goto(URLS.creatorCenter, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(2500);
        const handle = await resolveHandle(page).catch(() => null);
        rows.push({ account: a.name, loggedIn: true, handle: handle ? handle.replace(/^\/@?/, '') : null });
      } finally {
        await context.close().catch(() => {});
      }
    } catch (err) {
      rows.push({ account: a.name, loggedIn: false, handle: null, error: String(err.message).split('\n')[0] });
    }
  }
  return { ok: true, activeAccount: list.activeAccount, accounts: rows };
}

/**
 * Resolve fan-out target accounts for `post --to a,b --all`.
 * Pure apart from reading config for `--all`. Returns deduped names.
 * `fallback` is used when neither flag is given (default single account).
 */
function resolveTargets({ to = null, all = false, fallback = 'main' } = {}) {
  if (all) {
    const list = accounts().accounts.map((a) => a.name);
    return [...new Set(list.length ? list : [fallback || 'main'])];
  }
  if (to) {
    const names = String(to).split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.length) throw new Error('empty --to list (usage: --to alice,bob)');
    return [...new Set(names)];
  }
  return [fallback || 'main'];
}

/**
 * Run an async per-account fn over every known profile (sequential).
 * A throwing account resolves as { ok:false, account, error } so one
 * broken profile never kills a fleet sweep. Used by --all read commands.
 */
async function sweepAccounts(fn, { fallback = 'main' } = {}) {
  const names = resolveTargets({ all: true, fallback });
  const out = [];
  for (const name of names) {
    try {
      out.push(await fn(name));
    } catch (err) {
      out.push({ ok: false, account: name, error: String((err && err.message) || err).split('\n')[0] });
    }
  }
  return out;
}

/** `captron logout [--account]` */
async function logout({ account = 'main' } = {}) {
  const context = await launchProfile({ account });
  if (await isLoggedIn(context)) {
    await context.clearCookies({ domain: '.tiktok.com' });
    await context.clearCookies({ domain: '.tiktokv.com' });
    warn(`Cleared TikTok cookies for account "${account}".`);
  } else {
    warn(`Account "${account}" had no session.`);
  }
  await context.close();
  const cfg = readConfig();
  cfg.accounts = (cfg.accounts || []).map((a) => (a.name === account ? Object.assign({}, a, { handle: null, loginAt: null }) : a));
  if (cfg.activeAccount === account) cfg.activeAccount = null;
  writeConfig(cfg);
  return { account, loggedOut: true };
}

/** `captron accounts` */
function accounts() {
  const cfg = readConfig();
  return {
    activeAccount: cfg.activeAccount || null,
    accounts: (cfg.accounts || []).map((a) => ({ name: a.name, handle: a.handle, loginAt: a.loginAt, profileDir: a.profileDir })),
  };
}

/**
 * `captron use <account>` — switch the active profile (no browser needed).
 * Creates the profile dir lazily so the next login/post just works.
 */
function useAccount(name) {
  const { ensureHome } = require('./utils');
  if (!name || !String(name).trim()) return { ok: false, error: 'missing account name (usage: captron use <account>)' };
  const account = String(name).trim();
  ensureHome();
  const cfg = readConfig();
  if (!(cfg.accounts || []).some((a) => a.name === account)) {
    cfg.accounts = [...(cfg.accounts || []), { name: account, profileDir: profileDir(account), handle: null, loginAt: null }];
  }
  cfg.activeAccount = account;
  writeConfig(cfg);
  return { ok: true, account, activeAccount: account };
}

/**
 * `captron accounts --remove <name> --yes` — forget a profile entirely:
 * deletes its browser dir (cookies/session gone) and its config entry.
 * Requires { yes:true } — re-login is the only way back. Offline.
 */
function removeAccount(name, { yes = false } = {}) {
  if (!name || !String(name).trim()) return { ok: false, error: 'missing account name (usage: captron accounts --remove <name> --yes)' };
  if (!yes) return { ok: false, error: 'refusing to delete "' + String(name).trim() + '" without --yes (sessions cannot be recovered)', account: String(name).trim() };
  const fs = require('fs');
  const account = String(name).trim();
  const cfg = readConfig();
  if (!(cfg.accounts || []).some((a) => a.name === account)) return { ok: false, error: 'unknown account "' + account + '"', account };
  try {
    fs.rmSync(profileDir(account), { recursive: true, force: true });
  } catch (_) { /* dir may not exist on disk */ }
  cfg.accounts = (cfg.accounts || []).filter((a) => a.name !== account);
  if (cfg.activeAccount === account) cfg.activeAccount = (cfg.accounts[0] && cfg.accounts[0].name) || null;
  writeConfig(cfg);
  return { ok: true, account, removed: true, activeAccount: cfg.activeAccount };
}

/**
 * Import a session exported from another browser into a captron profile.
 * Accepts `{ cookies: [...], localStorage: {...} }` or a bare cookie array.
 * Same format as `scripts/seed-session.js`. Returns { ok, account, cookies }.
 */
async function importSession({ account = 'main', file } = {}) {
  const fs = require('fs');
  const path = require('path');
  if (!file) return { ok: false, error: 'missing --from <seed.json>' };
  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (err) {
    return { ok: false, error: 'could not read ' + file + ': ' + err.message };
  }
  const rawCookies = Array.isArray(seed) ? seed : seed.cookies || [];
  const cookies = rawCookies
    .filter((c) => c && c.name && c.value)
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: c.expires === undefined ? -1 : Math.min(2147483647, c.expires || Math.floor(Date.now() / 1000) + 60 * 60 * 24),
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
    }));
  if (!cookies.length) return { ok: false, error: 'no cookies in ' + file };
  const context = await launchProfile({ account, headless: true });
  try {
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto('https://www.tiktok.com', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    const ls = seed.localStorage || {};
    if (ls && typeof ls === 'object') {
      await page.evaluate((obj) => {
        for (const k of Object.keys(obj)) {
          try { localStorage.setItem(k, obj[k]); } catch (_) {}
        }
      }, ls).catch(() => {});
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(2500);
    }
    const loggedIn = await isLoggedIn(context);
    let handle = null;
    if (loggedIn) {
      await page.goto(URLS.creatorCenter, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(2500);
      handle = await resolveHandle(page).catch(() => null);
      await persistSession(context, account, handle);
    }
    return loggedIn
      ? { ok: true, account, cookies: cookies.length, handle: handle ? handle.replace(/^\/@?/, '') : null }
      : { ok: false, error: 'cookies imported but session is not logged in (expired?)', account, cookies: cookies.length };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { isLoggedIn, login, logout, whoami, whoamiAll, accounts, useAccount, removeAccount, resolveTargets, sweepAccounts, importSession };