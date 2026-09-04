'use strict';

/**
 * TikTok web (TikTok Studio) UI selectors + localized labels.
 *
 * These were reverse-engineered by driving the real TikTok web app
 * (see docs/REVERSE_ENGINEERING.md). Where TikTok localizes the UI, we match
 * on stable attributes first and fall back to a table of common labels.
 */

const URLS = {
  upload: 'https://www.tiktok.com/tiktokstudio/upload',
  creatorCenter: 'https://www.tiktok.com/tiktokstudio',
  content: 'https://www.tiktok.com/tiktokstudio/content',
  analytics: 'https://www.tiktok.com/tiktokstudio/analytics',
  login: 'https://www.tiktok.com/login',
};

/** Common localized labels for the main "Post now" button. */
const PUBLISH_LABELS = ['post', 'plaatsen', 'publicar', 'publier', 'veröffentlichen', 'pubblica', 'publicar agora', '发布', '投稿', '投稿する', '게시', '公開'];

/** Labels for "Save draft". */
const DRAFT_LABELS = ['save draft', 'concept opslaan', 'bewaar concept', 'guardar borrador', 'enregistrer le brouillon', 'speichern', 'salva bozza', '保存草稿', '下書きを保存', '임시저장'];

/** Visibility control labels (currently selected visibility button). */
const VISIBILITY_LABELS = ['everyone', 'iedereen', 'público', 'public', 'tout le monde', 'alle', '公开', 'すべてのユーザー', '전체 공개'];

/** Option labels inside the visibility menu. */
const VISIBILITY_OPTIONS = {
  everyone: ['everyone', 'iedereen', 'público', 'public', 'tout le monde', 'öffentlich', '公开', 'すべてのユーザー', '전체 공개'],
  friends: ['friends', 'vrienden', 'amigos', 'amis', 'freunde', '互相关注的好友', '友達', '친구'],
  private: ['private', 'privé', 'privado', 'privé', 'privat', '私密', '非公開', '비공개'],
};

/** Base query selectors (locale independent, stable attributes). */
const SELECTORS = {
  // The hidden file input used by the upload page.
  fileInput: 'input[type="file"]',

  // Draft.js caption editor in the post editor.
  captionEditor: '.public-DraftEditor-content',

  // A "Replace" button is rendered after the file has been accepted/uploaded.
  replaceButton: 'button[aria-label*="Vervangen"], button[aria-label*="Replace"], button[aria-label*="Reemplazar"], button[aria-label*="替换"], button[aria-label*="入れ替え"]',

  // Link back to TikTok / handle link on the studio chrome.
  handleLink: 'a[href^="/@"]',

  // progress text areas
  uploadProgressText: 'text=/Geüpload|Uploaded|Percentage|%|Bezig|Upload/',
};

/** Extract the publish candidate buttons from a page. */
async function findPublishButton(page) {
  const candidates = await page.$$eval('button', (btns) =>
    btns
      .filter((b) => {
        const t = (b.innerText || '').trim();
        const aria = (b.getAttribute('aria-label') || '').trim();
        return t || aria;
      })
      .map((b) => ({
        text: (b.innerText || '').trim().slice(0, 40),
        aria: (b.getAttribute('aria-label') || '').trim().slice(0, 40),
        disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true',
        idx: btns.indexOf(b),
      }))
      .filter((c) => c.text || c.aria)
  );
  // exact label match wins
  const byLabel = candidates.find((c) => PUBLISH_LABELS.includes(c.text.toLowerCase()) || PUBLISH_LABELS.includes(c.aria.toLowerCase()));
  if (byLabel) return byLabel;
  return null;
}

/** Find a button carrying one of the given labels (case-insensitive). */
async function findButtonByLabel(page, labels) {
  return page.$$eval(
    'button',
    (btns, labels) => {
      const items = btns
        .map((b, idx) => ({
          text: (b.innerText || '').trim(),
          aria: (b.getAttribute('aria-label') || '').trim(),
          disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true',
          idx,
        }))
        .filter((i) => i.text || i.aria);
      const lower = (s) => s.toLowerCase();
      return (
        items.find((i) => labels.map(lower).includes(lower(i.text))) ||
        items.find((i) => labels.map(lower).includes(lower(i.aria))) ||
        null
      );
    },
    labels
  );
}

/** Guess the current account handle from the studio chrome (not video cards). */
async function resolveHandle(page) {
  const handle = await page
    .evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href^="/@"]'));
      const chrome = links.find((a) => !/\/video\//.test(a.getAttribute('href') || ''));
      if (chrome) {
        const m = /^\/@([^/?]+)/.exec(chrome.getAttribute('href') || '');
        if (m) return m[1];
      }
      const any = links.find((a) => /\/video\//.test(a.getAttribute('href') || ''));
      if (any) {
        const m = /^\/@([^/?]+)\/video\//.exec(any.getAttribute('href') || '');
        if (m) return m[1];
      }
      return null;
    })
    .catch(() => null);
  return handle || null;
}

module.exports = {
  URLS,
  SELECTORS,
  PUBLISH_LABELS,
  DRAFT_LABELS,
  VISIBILITY_LABELS,
  VISIBILITY_OPTIONS,
  findPublishButton,
  findButtonByLabel,
  resolveHandle,
};