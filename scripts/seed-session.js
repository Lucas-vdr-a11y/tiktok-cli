#!/usr/bin/env node
'use strict';

/**
 * Dev/test helper: seed a captron profile with a session exported from another
 * browser (e.g. `{ cookies: [...], localStorage: {...} }`).
 *
 * Usage: node scripts/seed-session.js <seed.json> [profileName]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { profileDir } = require('../src/utils');

function cookiesToPlaywright(cookies) {
  return cookies
    .filter((c) => c.name && c.value)
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
}

(async () => {
  const seedPath = process.argv[2];
  const account = process.argv[3] || 'main';
  if (!seedPath) {
    console.error('usage: node scripts/seed-session.js <seed.json> [profile]');
    process.exit(1);
  }
  const seed = JSON.parse(fs.readFileSync(path.resolve(seedPath), 'utf8'));
  const dir = profileDir(account);
  console.log('seeding profile ' + account + ' at ' + dir);

  const ctx = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true });
  await ctx.addCookies(cookiesToPlaywright(seed.cookies || []));
  console.log('added ' + (seed.cookies || []).length + ' cookies');

  const page = await ctx.newPage();
  await page.goto('https://www.tiktok.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate((ls) => {
    for (const k of Object.keys(ls)) {
      try { localStorage.setItem(k, ls[k]); } catch (e) {}
    }
  }, seed.localStorage || {});
  console.log('set ' + Object.keys(seed.localStorage || {}).length + ' localStorage keys');
  await page.evaluate(() => { location.reload(); });
  await new Promise((r) => setTimeout(r, 4000));
  await ctx.close();
  console.log('profile seeded. Run `captron doctor` to verify.');
})().catch((e) => { console.error(e); process.exit(1); });