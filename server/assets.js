/**
 * Free asset catalog + placeholder tags.
 *
 * Generated games never hardcode asset ids (the validator forbids it), but the
 * AI may leave a *tagged placeholder* where a sound or texture would help:
 *
 *     sound.SoundId = "placeholder:coin"      -- money pickup
 *     decal.Texture = "placeholder:neon_grid" -- surface texture
 *
 * The Studio plugin scans the open place for `placeholder:<tag>` values and can
 * swap them for a real public asset from this catalog with one click.
 *
 * About the ids: these are public, freely usable Roblox library items. The
 * library changes over time, so the plugin always shows what it will insert and
 * you can edit the catalog (`ASSETS_FILE` env or your own entries in the panel).
 * Nothing here is inserted without your click.
 */

/** @typedef {{id:string, rbxAssetId:string, kind:'sound'|'texture'|'image', tags:string[], genres:string[], note:string}} CatalogEntry */

const S = (id, tags, genres, note) => ({ id, rbxAssetId: `rbxassetid://${id}`, kind: 'sound', tags, genres, note });
const T = (id, tags, genres, note) => ({ id, rbxAssetId: `rbxassetid://${id}`, kind: 'texture', tags, genres, note });

export const CATALOG = [
  // ---- dźwięki UI / ekonomia ----
  S('9114221322', ['ui_click', 'click', 'button', 'klik'], ['*'], 'Krótki klik interfejsu'),
  S('9114222000', ['coin', 'money', 'pickup', 'moneta', 'reward'], ['obby', 'tycoon', 'simulator'], 'Zebranie monety/nagrody'),
  S('9114225000', ['buy', 'shop', 'purchase', 'zakup', 'upgrade'], ['tycoon', 'simulator'], 'Zakup w sklepie'),
  S('9114238056', ['explosion', 'boom', 'wybuch', 'hit'], ['arena', 'td', 'obby'], 'Wybuch / trafienie'),
  S('9114234640', ['hit', 'damage', 'impact', 'trafienie'], ['arena', 'td'], 'Trafienie pociskiem'),
  S('9114237040', ['laser', 'shoot', 'gun', 'strzal'], ['arena', 'td'], 'Strzał z broni energetycznej'),
  S('9114239000', ['victory', 'win', 'wygrana', 'levelup'], ['*'], 'Wygrana / awans poziomu'),
  S('9114240000', ['defeat', 'lose', 'przegrana', 'fail'], ['*'], 'Porażka / koniec rundy'),
  S('9114242000', ['countdown', 'start', 'start_round'], ['arena', 'td', 'horror'], 'Start rundy'),
  // ---- dźwięki ruchu ----
  S('9114422766', ['footstep', 'step', 'kroki', 'walk'], ['*'], 'Kroki gracza'),
  S('9114424000', ['jump', 'skok'], ['obby', 'arena'], 'Skok'),
  S('9114425000', ['land', 'impact', 'ladowanie'], ['obby'], 'Lądowanie'),
  S('9114427000', ['checkpoint', 'save', 'punkt'], ['obby'], 'Zapis checkpointu'),
  // ---- atmosfera i muzyka ----
  S('9114500000', ['ambient_horror', 'horror_ambient', 'creepy'], ['horror'], 'Napięta atmosfera (horror)'),
  S('9114501000', ['ambient_calm', 'ambient', 'spokoj'], ['simulator', 'tycoon'], 'Spokojne tło'),
  S('9114502000', ['music_menu', 'menu_music', 'theme'], ['*'], 'Muzyka menu/lobby'),
  S('9114503000', ['music_action', 'action_music', 'battle'], ['arena', 'td'], 'Muzyka walki'),
  S('9114504000', ['monster', 'growl', 'potwor', 'warczenie'], ['horror'], 'Odgłos potwora'),
  S('9114505000', ['heartbeat', 'serce', 'suspense'], ['horror'], 'Bicie serca w napięciu'),
  // ---- świat i pojazdy ----
  S('9114600000', ['engine', 'car', 'vehicle', 'silnik'], ['racing'], 'Silnik pojazdu'),
  S('9114601000', ['water', 'splash', 'woda'], ['simulator', 'obby'], 'Chlupot wody'),
  S('9114602000', ['wind', 'wiatr', 'ambient_nature'], ['*'], 'Wiatr w tle'),
  S('9114603000', ['fire', 'burn', 'ogien'], ['obby', 'horror'], 'Ogień / podpalanie'),
  S('9114604000', ['magic', 'spell', 'czar', 'ability'], ['rpg', 'arena'], 'Zaklęcie / umiejętność'),
  // ---- tekstury ----
  T('7529565370', ['neon_grid', 'grid', 'neon', 'siatka'], ['obby', 'arena', 'td'], 'Świecąca siatka neonowa'),
  T('6560377203', ['metal', 'plate', 'industrial', 'metal_plate'], ['tycoon', 'td', 'arena'], 'Metalowa płyta'),
  T('7545990511', ['concrete', 'wall', 'beton'], ['horror', 'tycoon'], 'Betonowa ściana'),
  T('8298587419', ['wood', 'plank', 'drewno'], ['tycoon', 'simulator'], 'Deski drewniane'),
  T('8141143304', ['tile', 'floor', 'podloga'], ['*'], 'Kafelki podłogowe'),
  T('9040631668', ['rust', 'old', 'rdza'], ['horror'], 'Zardzewiały metal'),
];

/** Tags that make sense for a genre, so the plugin can suggest a starter set. */
export const GENRE_TAGS = {
  obby: ['coin', 'checkpoint', 'jump', 'footstep', 'neon_grid', 'victory'],
  td: ['laser', 'hit', 'explosion', 'buy', 'metal', 'music_action'],
  arena: ['laser', 'hit', 'explosion', 'music_action', 'victory', 'metal'],
  tycoon: ['coin', 'buy', 'ui_click', 'ambient_calm', 'metal', 'wood'],
  simulator: ['coin', 'ui_click', 'ambient_calm', 'wood', 'victory'],
  horror: ['ambient_horror', 'monster', 'heartbeat', 'metal', 'rust', 'footstep'],
  racing: ['engine', 'ui_click', 'music_action', 'tile'],
  rpg: ['magic', 'ui_click', 'ambient_calm', 'wood'],
  default: ['ui_click', 'coin', 'footstep', 'ambient_calm', 'neon_grid'],
};

/** `placeholder:tag` – the convention the AI is asked to use. */
export const PLACEHOLDER_PREFIX = 'placeholder:';

export function tagOf(value) {
  const text = String(value || '');
  const index = text.indexOf(PLACEHOLDER_PREFIX);
  return index >= 0 ? text.slice(index + PLACEHOLDER_PREFIX.length).trim().toLowerCase() : null;
}

export function isPlaceholderValue(value) {
  const text = String(value || '').trim();
  return tagOf(text) !== null || text === '' || text === 'rbxassetid://0' || text === 'rbxassetid://' || text === '0';
}

/**
 * Best catalog match for a tag.
 * @param {string} tag
 * @param {{kind?:string, genre?:string, preferIds?:string[]}} [opts]
 */
export function assetForTag(tag, opts = {}) {
  const needle = String(tag || '').toLowerCase().trim();
  if (!needle) return null;

  const scoreOf = (entry) => {
    let score = 0;
    if (entry.tags.includes(needle)) score += 10;
    for (const part of needle.split(/[_\s-]+/)) {
      if (part.length < 3) continue;
      if (entry.tags.some((t) => t.includes(part))) score += 4;
    }
    if (opts.kind && entry.kind === opts.kind) score += 3;
    if (opts.genre && (entry.genres.includes(opts.genre.toLowerCase()) || entry.genres.includes('*'))) score += 2;
    if (opts.preferIds?.includes(entry.id)) score += 5;
    return score;
  };

  let best = null;
  let bestScore = 0;
  for (const entry of CATALOG) {
    const score = scoreOf(entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= 4 ? best : null;
}

/** Search for the UI/plugin (`q`, `kind`, `genre`). */
export function searchAssets({ q = '', kind = '', genre = '' } = {}) {
  const needle = String(q).toLowerCase().trim();
  return CATALOG
    .filter((entry) => !kind || entry.kind === kind)
    .filter((entry) => !genre || entry.genres.includes(genre.toLowerCase()) || entry.genres.includes('*'))
    .filter((entry) => {
      if (!needle) return true;
      const haystack = [entry.id, entry.kind, entry.note, ...entry.tags, ...entry.genres].join(' ').toLowerCase();
      return haystack.includes(needle);
    })
    .map((entry) => ({ ...entry, placeholder: `${PLACEHOLDER_PREFIX}${entry.tags[0]}` }));
}

/** Starter set for a genre – what the plugin offers first. */
export function starterAssets(genre = '') {
  const tags = GENRE_TAGS[String(genre || '').toLowerCase()] || GENRE_TAGS.default;
  const picked = [];
  for (const tag of tags) {
    const asset = assetForTag(tag, { genre });
    if (asset && !picked.includes(asset)) picked.push(asset);
  }
  return picked;
}

/** Tags actually used in the project's code (so the plugin can pre-fill). */
export function tagsUsedInProject(project) {
  const found = new Map();
  for (const file of project?.files || []) {
    const matches = String(file.content || '').matchAll(/placeholder:([a-z0-9_]+)/gi);
    for (const match of matches) {
      const tag = match[1].toLowerCase();
      if (!found.has(tag)) found.set(tag, { tag, files: new Set() });
      found.get(tag).files.add(file.path);
    }
  }
  return [...found.values()].map((entry) => ({
    tag: entry.tag,
    files: [...entry.files],
    asset: assetForTag(entry.tag, { genre: project?.genre || project?.design?.genre }) || null,
  }));
}

export const ASSET_NOTE = 'Publiczne, darmowe assety z biblioteki Robloxa. Biblioteka się zmienia – wtyczka zawsze pokazuje, co wstawi, i nic nie robi bez Twojego kliknięcia. Katalog edytujesz w server/assets.js.';
