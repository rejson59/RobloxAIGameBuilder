/**
 * Project audit – cross-validation between the design, the plan and the code.
 *
 * The linter (validate.js) looks at single files. The audit asks questions that
 * only make sense for the whole project:
 *   - did every file from the plan actually get written?
 *   - is every RemoteEvent from the plan used somewhere?
 *   - does every module that is `require`d exist?
 *   - is there an entry point that actually starts the game?
 *   - does the client stay away from server-only APIs (DataStore, money)?
 *   - do the systems from the design show up in the code?
 *
 * Result: a score (0-100) plus a list of check results with hints.
 */
import { normalisePath } from './validate.js';

const SERVER_ONLY = [
  { pattern: /DataStoreService/, label: 'DataStoreService (dane tylko po stronie serwera)' },
  { pattern: /game:GetService\("ServerStorage"\)|GetService\("ServerScriptService"\)/, label: 'usługi serwerowe (ServerStorage/ServerScriptService)' },
  { pattern: /BindToClose/, label: 'game:BindToClose (tylko serwer)' },
];

const ENTRY_NAMES = /(bootstrap|init|main|start|round|game|manager)\.server\.luau$/i;

/** Collects file paths, module basenames and script kinds. */
function indexFiles(files = []) {
  const paths = new Set();
  const moduleNames = new Map();   // basename (bez .luau) -> path
  const entries = [];
  const clients = [];
  for (const file of files) {
    const filePath = normalisePath(file.path);
    paths.add(filePath);
    const base = filePath.split('/').pop().replace(/\.luau?$/, '').replace(/\.(server|client)$/, '');
    moduleNames.set(base, filePath);
    if (filePath.endsWith('.server.luau') || filePath.endsWith('.server.lua')) entries.push(filePath);
    if (filePath.endsWith('.client.luau') || filePath.endsWith('.client.lua')) clients.push(filePath);
  }
  return { paths, moduleNames, entries, clients };
}

function countMatches(text, pattern) {
  return (String(text).match(pattern) || []).length;
}

/**
 * @param {object} project
 * @returns {{score:number, checks:Array<{id:string, level:string, title:string, detail:string, hint:string}>, summary:string, counts:{errors:number,warnings:number,passed:number}}}
 */
export function auditProject(project = {}) {
  const files = Array.isArray(project.files) ? project.files : [];
  const plan = project.plan || {};
  const design = project.design || {};
  const { paths, moduleNames, entries, clients } = indexFiles(files);
  const allCode = files.map((f) => String(f.content || '')).join('\n');
  const checks = [];

  const add = (id, level, title, detail, hint = '') => checks.push({ id, level, title, detail, hint });

  /* 1. plan vs files -------------------------------------------------- */
  const planned = (plan.files || []).map((f) => ({
    path: normalisePath(f.path || ''),
    purpose: f.purpose || '',
    exports: f.exports || [],
  })).filter((f) => f.path);

  const missing = planned.filter((f) => !paths.has(f.path));
  const unplanned = [...paths].filter((p) => !planned.some((f) => f.path === p));

  if (!planned.length) {
    add('plan.files', 'warn', 'Brak planu plików', 'Model nie zwrócił listy plików w planie, więc nie da się sprawdzić pokrycia.', 'Wygeneruj projekt ponownie albo poproś o "uporządkuj architekturę".');
  } else if (missing.length) {
    add('plan.missing', 'error', `Brakuje ${missing.length} plik(ów) z planu`, missing.map((f) => `${f.path}${f.purpose ? ` (${f.purpose})` : ''}`).join(', '), 'Poproś o zmianę: "dokończ brakujące pliki z planu".');
  } else {
    add('plan.missing', 'pass', 'Wszystkie pliki z planu istnieją', `Plan: ${planned.length} plik(ów), w projekcie: ${paths.size}.`);
  }

  if (unplanned.length) {
    add('plan.extra', 'info', `${unplanned.length} plik(ów) poza planem`, unplanned.join(', '), 'To zwykle efekt auto-naprawy lub zmiany przez AI – upewnij się, że każdy jest gdzieś używany.');
  }

  /* 2. wymagania modułów ---------------------------------------------- */
  // Obsługujemy oba style: require(Shared:WaitForChild("Config")) i require(game.ReplicatedStorage.Shared.Config).
  const CONTAINERS = new Set([
    'game', 'script', 'workspace', 'Parent', 'ReplicatedStorage', 'ServerStorage', 'ServerScriptService',
    'StarterPlayer', 'StarterPlayerScripts', 'StarterGui', 'Players', 'Shared', 'Remotes', 'Modules',
    'Client', 'Server', 'Folder', 'World', 'Lighting', 'SoundService', 'Teams', 'Stats', 'leaderstats',
  ]);
  const requires = [...allCode.matchAll(/require\s*\(\s*([^)]+)\)/g)].map((m) => m[1]);
  const missingModules = new Set();
  for (const expr of requires) {
    const quoted = [...expr.matchAll(/["']([A-Za-z0-9_]+)["']/g)].map((m) => m[1]);
    const chain = [...expr.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*(?=\.|$)/g)].map((m) => m[1]);
    const candidates = quoted.length ? [quoted[quoted.length - 1]] : [chain[chain.length - 1]];
    for (const tail of candidates) {
      if (!tail || CONTAINERS.has(tail)) continue;
      if (moduleNames.has(tail)) continue;
      if (!/^[A-Z]/.test(tail)) continue;                        // lokalne zmienne (np. require(module))
      missingModules.add(tail);
    }
  }
  if (missingModules.size) {
    add('requires', 'error', `require() wskazuje na ${missingModules.size} nieistniejący moduł`, [...missingModules].join(', '), 'Najczęstsza przyczyna błędu w Studio po uruchomieniu. Poproś o zmianę: "napraw require do brakujących modułów".');
  } else if (requires.length) {
    add('requires', 'pass', 'Wszystkie require() mają swoje moduły', `Sprawdzono ${requires.length} wywołań.`);
  }

  /* 3. RemoteEventy z planu ------------------------------------------- */
  const remotes = (plan.remoteEvents || []).map((r) => String(r.name || '').replace(/['"]/g, '')).filter(Boolean);
  // Nazwy remotów bywają trzymane w Config (Config.Remotes.Notify), więc liczymy każdą wzmiankę.
  const mentionCount = (name) => countMatches(allCode, new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'));
  const absentRemotes = remotes.filter((name) => mentionCount(name) === 0);
  const singleRemotes = remotes.filter((name) => mentionCount(name) === 1);
  if (remotes.length) {
    if (absentRemotes.length) {
      add('remotes', 'error', `${absentRemotes.length} RemoteEvent(ów) z planu w ogóle nie ma w kodzie`, absentRemotes.join(', '), 'Klient i serwer nie mają się jak dogadać. Poproś: "dodaj brakujące RemoteEventy z planu".');
    } else if (singleRemotes.length) {
      add('remotes', 'info', `${singleRemotes.length} RemoteEvent(ów) występuje tylko raz`, singleRemotes.join(', '), 'Sprawdź, czy druga strona też go używa.');
    } else {
      add('remotes', 'pass', 'RemoteEventy z planu są używane', `Sprawdzono ${remotes.length} nazw.`);
    }
  } else if (/RemoteEvent/.test(allCode)) {
    const created = [...allCode.matchAll(/\.Name\s*=\s*["']([A-Za-z0-9_]+)["']/g)].map((m) => m[1]);
    add('remotes', 'info', 'Plan nie deklaruje RemoteEventów', `W kodzie znaleziono ${new Set(created).size} nazw instancji – sprawdź, czy strony się zgadzają.`);
  }

  /* 4. punkt startowy -------------------------------------------------- */
  const entry = entries.find((p) => ENTRY_NAMES.test(p)) || entries[0];
  if (!entry) {
    add('entry', 'error', 'Brak skryptu startowego (Script)', 'Żaden plik nie kończy się na `.server.luau`, więc po uruchomieniu miejsce będzie puste.', 'Poproś: "dodaj skrypt Bootstrap.server.luau, który startuje wszystkie systemy".');
  } else {
    const content = files.find((f) => normalisePath(f.path) === entry)?.content || '';
    const requiresCount = countMatches(content, /require\s*\(/g);
    if (requiresCount === 0 && files.length > 2) {
      add('entry', 'warn', 'Skrypt startowy nic nie uruchamia', `${entry} nie zawiera żadnego require().`, 'Serwerowe moduły nie wystartują same – poproś o podłączenie ich w skrypcie startowym.');
    } else {
      add('entry', 'pass', 'Jest skrypt startowy', `${entry} (łączy ${requiresCount} modułów).`);
    }
  }

  if (clients.length) {
    const clientRemotes = clients.filter((p) => {
      const content = files.find((f) => normalisePath(f.path) === p)?.content || '';
      return /RemoteEvent|:FireServer|:WaitForChild\("Remotes"\)/.test(content);
    });
    add('client', 'pass', 'Klient komunikuje się przez remotes', `${clientRemotes.length}/${clients.length} skryptów klienta korzysta z RemoteEventów.`);
  } else {
    add('client', 'info', 'Brak skryptów klienta', 'Gra jest w całości serwerowa – to poprawne dla tycoonów i systemów, ale nie dla gier z HUD-em.');
  }

  /* 5. autorytet serwera ---------------------------------------------- */
  const clientLeaks = [];
  for (const path of clients) {
    const content = files.find((f) => normalisePath(f.path) === path)?.content || '';
    for (const rule of SERVER_ONLY) {
      if (rule.pattern.test(content)) clientLeaks.push(`${path}: ${rule.label}`);
    }
  }
  if (clientLeaks.length) {
    add('authority', 'error', 'Klient używa API dostępnego tylko na serwerze', clientLeaks.join('; '), 'W Studio to się nie skompiluje. Poproś: "przenieś logikę DataStore na serwer".');
  } else {
    add('authority', 'pass', 'Klient nie dotyka API serwerowych', 'Brak DataStore/ServerStorage/BindToClose w plikach klienta.');
  }

  /* 6. systemy z designu w kodzie ------------------------------------- */
  // Nazwy systemów są po polsku, a kod bywa mieszany – to miękka wskazówka,
  // więc szukamy KAŻDEGO istotnego słowa nazwy, także w opisach plików z planu.
  const planText = (plan.files || []).map((f) => `${f.path} ${f.purpose || ''}`).join(' ') + ' ' + JSON.stringify(design.systems || []);
  const searchSpace = `${allCode}\n${planText}`.toLowerCase();
  const systems = (design.systems || []).map((system) => String(system.name || '')).filter((name) => name.length > 2);
  if (systems.length) {
    const unknown = systems.filter((name) => {
      const words = name.toLowerCase().split(/[^a-ząćęłńóśźż0-9]+/).filter((w) => w.length > 3);
      if (!words.length) return false;
      return !words.some((word) => searchSpace.includes(word.slice(0, 5)));
    });
    if (unknown.length) {
      add('systems', 'info', `${unknown.length} system(ów) z designu trudno znaleźć w kodzie`, unknown.join(', '), 'Nazwy są po polsku, a kod często po angielsku – sprawdź w zakładce „Pliki Luau”.');
    } else {
      add('systems', 'pass', 'Systemy z designu są widoczne w kodzie', `Sprawdzono ${systems.length} nazw.`);
    }
  }

  /* 7. rozmiar i "niedokończone" pliki -------------------------------- */
  const tiny = files.filter((f) => String(f.content || '').trim().length < 60).map((f) => f.path);
  if (tiny.length) {
    add('tiny', 'warn', `${tiny.length} plik(ów) jest praktycznie pustych`, tiny.join(', '), 'Poproś o dokończenie tych plików.');
  }
  const stubs = files.filter((f) => /(TODO|FIXME|not implemented|nie zaimplementowano)/i.test(String(f.content || ''))).map((f) => f.path);
  if (stubs.length) {
    add('stubs', 'warn', `${stubs.length} plik(ów) ma znaczniki TODO`, stubs.join(', '), 'Poproś: "dokończ funkcje oznaczone TODO".');
  }
  if (!tiny.length && !stubs.length) {
    add('stubs', 'pass', 'Brak pustych plików i TODO', 'Każdy plik ma treść, żadnych niedokończonych miejsc.');
  }

  /* 8. balans deklarowany vs użyty ------------------------------------ */
  const balancing = design.balancing || {};
  const balanceKeys = Object.keys(balancing).filter((k) => typeof balancing[k] === 'number');
  if (balanceKeys.length) {
    const configText = files.filter((f) => /config|balance|shared/i.test(f.path)).map((f) => String(f.content || '')).join('\n') || allCode;
    const missing = balanceKeys.filter((key) => !new RegExp(key.replace(/[^A-Za-z0-9_]/g, ''), 'i').test(configText));
    if (missing.length) {
      add('balance', 'info', `${missing.length} wartości balansu nie ma w plikach konfiguracji`, missing.join(', '), 'Wartości mogą być zapisane inaczej (np. skrócone) – to tylko podpowiedź.');
    } else {
      add('balance', 'pass', 'Balans z designu jest w konfiguracji', `Znaleziono ${balanceKeys.length} wartości.`);
    }
  }

  /* 9. spójność nazwy gry --------------------------------------------- */
  const name = String(project.name || '');
  if (name && !/^[\x20-\x7EąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+$/.test(name)) {
    add('name', 'info', 'Nietypowe znaki w nazwie gry', name, 'Nazwa trafia do danych miejsca – rozważ prostszą (bez emoji).');
  }

  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;
  const passed = checks.filter((c) => c.level === 'pass').length;
  const score = Math.max(0, Math.min(100, 100 - errors * 22 - warnings * 7 - checks.filter((c) => c.level === 'info').length * 1));

  const summary = errors
    ? `${errors} problem(y) krytyczne, ${warnings} ostrzeżeń — gra może się nie uruchomić w Studio.`
    : warnings
      ? `${warnings} ostrzeżeń, brak problemów krytycznych — gra powinna działać.`
      : 'Brak uwag: plan, kod i design są spójne.';

  return { score, checks, counts: { errors, warnings, passed }, summary };
}

export function auditScore(project) {
  return auditProject(project).score;
}
