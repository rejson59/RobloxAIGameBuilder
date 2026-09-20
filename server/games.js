/**
 * Offline demo catalogue. Works with zero API keys, which makes the app
 * usable (and testable) on any machine – including inside this sandbox.
 */
import obby from './demos/obby.js';
import towerDefense from './demos/towerDefense.js';
import arena from './demos/arena.js';
import tycoon from './demos/tycoon.js';
import horror from './demos/horror.js';

export const DEMOS = [obby, towerDefense, arena, tycoon, horror];

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
        // Polskie odmiany: "piekarni" ma trafić w "piekarnia" (porównujemy rdzeń).
        else if (word.length > 5 && needle.includes(word.slice(0, 5))) score += 1;
      }
    }
    for (const word of needle.split(/[\s,.;:!?()]+/)) {
      if (word.length > 5) {
        for (const haystack of haystacks) {
          for (const candidate of haystack.split(/[\s/,.-]+/)) {
            if (candidate.length > 5 && candidate.slice(0, 5) === word.slice(0, 5)) score += 1;
          }
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = demo;
    }
  }
  return best || obby;
}
