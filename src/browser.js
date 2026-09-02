'use strict';

const { chromium } = require('playwright');
const { profileDir, verbose } = require('./utils');

/**
 * Launch a persistent Chromium profile (per account). All cookies/localStorage
 * live in the profile directory, so login state survives between runs and
 * multiple accounts stay fully isolated.
 *
 * Browser resolution order:
 *   1. CAPTRON_CHROMIUM_PATH            (explicit executable)
 *   2. CAPTRON_BROWSER_CHANNEL          (e.g. "chrome", "msedge", "chromium")
 *   3. System Google Chrome
 *   4. Playwright-bundled Chromium
 */
async function launchProfile({ account = 'main', headless = false, userDataDir } = {}) {
  const dir = userDataDir || profileDir(account);
  const channel = process.env.CAPTRON_BROWSER_CHANNEL || 'chrome';
  const executablePath = process.env.CAPTRON_CHROMIUM_PATH;

  const base = {
    headless,
    userDataDir: dir,
    viewport: { width: 1440, height: 2200 },
    locale: 'en-US',
    timezoneId: 'Europe/Amsterdam',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-notifications',
      '--no-default-browser-check',
      '--window-size=1440,2200',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  const attempts = [];
  if (executablePath) base.executablePath = executablePath;
  else if (channel && channel !== 'bundled') base.channel = channel;

  try {
    verbose(`launching browser (channel=${channel || 'bundled'}, headless=${headless}, dir=${dir})`);
    const context = await chromium.launchPersistentContext(dir, base);
    return context;
  } catch (err) {
    if (!base.channel) throw err;
    attempts.push(String(err.message).split('\n')[0]);
    verbose(`channel launch failed: ${err.message.split('\n')[0]} — falling back to bundled chromium`);
    delete base.channel;
    const context = await chromium.launchPersistentContext(dir, base);
    return context;
  }
}

/** Open a tab and refuse to hand over a blank page. */
async function openTab(context, url, { waitUntil = 'domcontentloaded', timeout = 45000 } = {}) {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url, { waitUntil, timeout }).catch((err) => {
    verbose(`goto ${url} failed (may be blocked): ${err.message.split('\n')[0]}`);
  });
  return page;
}

module.exports = { launchProfile, openTab };