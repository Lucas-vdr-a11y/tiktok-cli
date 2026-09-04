'use strict';

/**
 * Offline viral hook + caption helpers for faceless creators.
 * Pure functions (no browser) — deterministic given a seed so agents
 * get reproducible series scaffolds. Unit-tested.
 */

const NICHES = {
  ai: ['AI tool', 'AI side hustle', 'AI automation', 'ChatGPT trick', 'AI faceless channel'],
  money: ['side hustle', 'passive income trick', 'money habit', 'budget flip', 'faceless store'],
  fitness: ['home workout', 'fat-loss habit', 'morning routine', 'gym mistake', 'protein hack'],
  story: ['true story', 'reddit story', 'unsolved mystery', 'history fact', 'scary story'],
  tech: ['iPhone trick', 'hidden setting', 'free tool', 'app you missed', 'tech mistake'],
};

const HOOK_FRAMES = [
  'Stop doing {topic} wrong — do this instead',
  'I tried {topic} for 30 days, here is what happened',
  'Nobody talks about this {topic} trick',
  '{n} {topic} mistakes keeping you at zero views',
  'POV: you finally found a {topic} that works',
  'This {topic} made me {n}k in a week',
  'Reply with "{word}" and I will send the {topic} guide',
  'The {topic} nobody wants you to know',
  'Day {n} of posting {topic} until it pays',
  '{n} seconds to fix your {topic} forever',
];

/** Deterministic PRNG (mulberry32) from a numeric/string seed. */
function rng(seed) {
  let h = 1779033703;
  const s = String(seed != null ? seed : 'captron');
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}

/**
 * Generate `count` hooks for a niche.
 * Returns [{ hook, niche, topic }]. Deterministic for the same seed.
 */
function generateHooks({ niche = 'ai', count = 5, seed = 'captron' } = {}) {
  const key = String(niche || 'ai').toLowerCase();
  const topics = NICHES[key] || NICHES.ai;
  const n = Math.max(1, Math.min(Number(count) || 5, 50));
  const r = rng(seed + ':' + key);
  const out = [];
  const seen = new Set();
  let guard = 0;
  while (out.length < n && guard++ < n * 20) {
    const frame = HOOK_FRAMES[Math.floor(r() * HOOK_FRAMES.length)];
    const topic = pick(r, topics);
    const hook = frame
      .replace('{topic}', topic)
      .replace('{n}', String(1 + Math.floor(r() * 9)))
      .replace('{word}', pick(r, ['GUIDE', 'PART2', 'TOOL', 'LIST', 'SECRET']));
    if (seen.has(hook)) continue;
    seen.add(hook);
    out.push({ hook, niche: key, topic });
  }
  return out;
}

/** Build a full caption from a hook + hashtags (respects the 2200 limit). */
function hookCaption({ hook, hashtags = 'fyp,faceless', cta = 'Follow for part 2' } = {}) {
  const { buildCaption } = require('./utils');
  return buildCaption({ caption: (hook || '') + (cta ? '\n' + cta : ''), hashtags });
}

module.exports = { generateHooks, hookCaption, NICHES, HOOK_FRAMES };
