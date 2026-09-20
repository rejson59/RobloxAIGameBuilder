/**
 * Offline demo catalogue. Works with zero API keys, which makes the app
 * usable (and testable) on any machine – including inside this sandbox.
 */
import obby from './demos/obby.js';
import towerDefense from './demos/towerDefense.js';
import arena from './demos/arena.js';

export const DEMOS = [obby, towerDefense, arena];

export function listDemos() {
  return DEMOS.map((demo) => ({
    id: demo.id,
    name: demo.name,
    genre: demo.genre,
    tagline: demo.tagline,
    summary: demo.summary,
    files: demo.files.length,
    aliases: demo.aliases || [],
  }));
}

/** Resolve a demo by id, alias, or fuzzy match against free-form user text. */
export function getDemo(hint = 'obby') {
  const needle = String(hint || '').toLowerCase();
  const byExact = DEMOS.find((d) => d.id === needle || (d.aliases || []).includes(needle));
  if (byExact) return byExact;

  let best = null;
  let bestScore = 0;
  for (const demo of DEMOS) {
    let score = 0;
    const haystacks = [demo.id, demo.name, demo.genre, demo.tagline, ...(demo.aliases || [])].map((s) => String(s).toLowerCase());
    for (const haystack of haystacks) {
      if (needle.includes(haystack)) score += 3;
      for (const word of haystack.split(/[\s/,.-]+/)) {
        if (word.length > 3 && needle.includes(word)) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = demo;
    }
  }
  return best || obby;
}
