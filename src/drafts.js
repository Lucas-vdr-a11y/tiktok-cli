'use strict';

const { launchProfile } = require('./browser');
const { URLS } = require('./selectors');
const { isLoggedIn } = require('./auth');
const { verbose, sleep, warn, fail } = require('./utils');
const uploadLib = require('./upload');
const { openContentPage } = require('./content');

/**
 * Draft management. The Drafts tab in TikTok Studio is a list of private items;
 * we drive the real UI to list, publish and delete.
 */

const DELETE_LABELS = ['delete', 'verwijderen', 'eliminar', 'supprimer', 'löschen', '删除', '削除', '삭제'];
const CONFIRM_LABELS = ['confirm', 'bevestigen', 'confirmar', 'confirmer', 'bestätigen', '确认', '確認', '확인'];

/** Open the drafts tab and return the page. */
async function openDrafts(context) {
  const page = await openContentPage(context, { tab: 'drafts' });
  return page;
}

/** Scrape draft rows from the drafts tab. Drafts are cards; ids may be embedded. */
async function scrapeDrafts(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    const cards = Array.from(document.querySelectorAll('button, div[role="button"]')).filter((el) => {
      const t = (el.innerText || '').trim();
      return t && t.length < 200;
    });
    const seen = new Set();
    const items = [];
    for (const c of cards) {
      const t = (c.innerText || '').trim();
      // every video gets a placeholder time; pick cards that look like draft items
      const m = /(?:video\/)?(\d{10,})/.exec(t);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({ id, caption: t.slice(0, 80) });
    }
    void text;
    return items;
  });
}

async function findDraftElement(page, id) {
  // search any element whose text/href contains the id
  const found = await page.evaluateHandle((targetId) => {
    const all = Array.from(document.querySelectorAll('a, button, div[role="button"], [data-e2e]'));
    return (
      all.find((el) => {
        const hay = ((el.getAttribute('href') || '') + ' ' + (el.getAttribute('data-e2e') || '') + ' ' + (el.innerText || '')).slice(0, 400);
        return hay.includes(targetId);
      }) || null
    );
  }, id);
  if (found) {
    const asElement = found.asElement();
    if (asElement) return asElement;
    return null;
  }
  return null;
}

/** `captron drafts publish <id>` */
async function publishDraft({ account = 'main', id, headless = false } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) return { ok: false, id, error: 'not logged in' };
    const page = await openDrafts(context);
    const el = await findDraftElement(page, id);
    if (!el) return { ok: false, id, error: `draft ${id} not found in drafts list` };
    await el.click();
    await sleep(3000);

    // wait for the editor
    let ready = false;
    for (let i = 0; i < 15; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('.public-DraftEditor-content').length);
      if (n > 0) { ready = true; break; }
      await sleep(1500);
    }
    if (!ready) return { ok: false, id, error: 'editor did not load for draft' };

    const final = await uploadLib.finalizePost(page, { saveDraft: false });
    return { ok: true, id, itemId: final.itemId, projectId: final.projectId, url: final.url || 'https://www.tiktok.com/tiktokstudio/content' };
  } finally {
    await context.close().catch(() => {});
  }
}

/** `captron drafts delete <id>` */
async function deleteDraft({ account = 'main', id, headless = false } = {}) {
  const context = await launchProfile({ account, headless });
  try {
    if (!(await isLoggedIn(context))) return { ok: false, id, error: 'not logged in' };
    const page = await openDrafts(context);
    const el = await findDraftElement(page, id);
    if (!el) return { ok: false, id, error: `draft ${id} not found in drafts list` };
    await el.click();
    await sleep(800);
    // context menu / delete button
    const delBtn = await page.$eval('button', (b, labels) => {
      const items = Array.from(document.querySelectorAll('button')).map((x, idx) => ({ t: (x.innerText || '').trim(), idx }));
      const found = items.find((i) => labels.some((l) => l === i.t.toLowerCase()));
      return found ? found.idx : -1;
    }, DELETE_LABELS);
    if (delBtn >= 0) {
      const btns = await page.$$('button');
      await btns[delBtn].click();
      await sleep(800);
      const okBtn = await page.$$eval('button', (bs, labels) => {
        const idx = bs.findIndex((b) => labels.includes((b.innerText || '').trim().toLowerCase()));
        return idx;
      }, CONFIRM_LABELS);
      if (okBtn >= 0) {
        const bs = await page.$$('button');
        await bs[okBtn].click();
      }
      await sleep(1200);
      return { ok: true, id };
    }
    return { ok: false, id, error: 'could not find the delete action for draft' };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { publishDraft, deleteDraft, scrapeDrafts };