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

module.exports = { isLoggedIn, login, logout, whoami, accounts };