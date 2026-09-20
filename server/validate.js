/**
 * Static quality gate for generated projects.
 * Catches the failure modes LLMs actually hit when writing Luau: placeholder
 * code, deprecated APIs, ModuleScripts without a return, unbalanced blocks,
 * guessed asset ids and client-side misuse of server-only services.
 */

const ALLOWED_PREFIXES = ['src/server/', 'src/client/', 'src/shared/', 'src/startergui/', 'src/replicatedstorage/', 'src/workspace/'];

export function normalisePath(input) {
  let p = String(input || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/{2,}/g, '/').trim();
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

export function isValidPath(p) {
  if (!p || p.length > 160) return false;
  if (!/\.(luau?|lua)$/i.test(p)) return false;
  if (/\.\./.test(p)) return false;
  return ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * Heuristic block balance check.
 * Luau has `if ... then ... else ...` EXPRESSIONS (no `end`), so counting `if`
 * naively produced false positives on perfectly valid code – we exclude them
 * and only pair `for`/`while` with their own `do` on the same line.
 */
function checkBlockBalance(source) {
  const stripped = source
    .replace(/--\[\[[\s\S]*?\]\]/g, ' ')   // block comments
    .replace(/--[^\n]*/g, ' ')           // line comments
    .replace(/\[\[[\s\S]*?\]\]/g, ' ')   // long strings
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");

  // `local x = if test then a else b` – to wyrażenie, nie blok.
  const ifExpressions = (stripped.match(/(?:=|\breturn\b|[(,])\s*if\b[^\n]*?\bthen\b[^\n]*?\belse\b/g) || []).length;
  const functions = (stripped.match(/\bfunction\b/g) || []).length;
  const ifBlocks = (stripped.match(/\bif\b/g) || []).length - ifExpressions;
  const loops = (stripped.match(/\b(?:for|while)\b[^\n]*?\bdo\b/g) || []).length;
  const repeats = (stripped.match(/\brepeat\b/g) || []).length;
  const bareDo = Math.max(0, (stripped.match(/\bdo\b/g) || []).length - loops);
  const expected = functions + ifBlocks + loops + repeats + bareDo;

  const ends = (stripped.match(/\bend\b/g) || []).length;
  const untils = (stripped.match(/\buntil\b/g) || []).length;

  return { expected, ends: ends + untils, delta: expected - (ends + untils) };
}

const FORBIDDEN_PATTERNS = [
  // `skipComments` = nie zgłaszaj, gdy trafienie jest w komentarzu (dla placeholderów chcemy zgłaszać).
  { re: /(^|[^.\w:])wait\s*\(/, msg: 'Użyto przestarzałego wait() – zamień na task.wait().' },
  { re: /(^|[^.\w:])spawn\s*\(\s*function/, msg: 'Użyto przestarzałego spawn() – zamień na task.spawn().' },
  { re: /(^|[^.\w:])delay\s*\(/, msg: 'Użyto przestarzałego delay() – zamień na task.delay().' },
  { re: /BodyPosition|BodyGyro|BodyVelocity/, msg: 'Przestarzałe obiekty Body* – użyj LinearVelocity / AlignOrientation / VectorForce.' },
  { re: /FindPartOnRay|Ray\.new\s*\(/, msg: 'Przestarzałe raycasty – użyj workspace:Raycast().' },
  { re: /LoadLibrary|game\.Players\b(?!:)/, msg: 'Nieaktualne API (LoadLibrary / game.Players).' },
  { re: /rbxassetid:\/\/\d{1,6}\b/, msg: 'Podejrzany asset id (bardzo niski numer) – prawdopodobnie halucynacja.' },
  { re: /(--|\/\/)\s*(TODO|FIXME|XXX|implement|reszta|rest of|doko[nń]cz)/i, msg: 'Pozostawiony placeholder w kodzie.', keepComments: true },
  { re: /eslint-disable|--!nocheck/, msg: 'Wyłączone sprawdzanie typów – usuń, jeśli niepotrzebne.' },
];

export function lintFile(file) {
  const issues = [];
  const source = String(file.content || '');
  const lines = source.split('\n');

  if (!source.trim()) {
    issues.push({ level: 'error', message: 'Pusty plik.' });
    return issues;
  }

  const balance = checkBlockBalance(source);
  if (Math.abs(balance.delta) >= 3) {
    issues.push({
      level: 'warning',
      message: `Podejrzana liczba bloków: otwarte ${balance.expected}, zamknięte ${balance.ends} (różnica ${balance.delta}). Sprawdź czy kod się kompiluje.`,
    });
  }

  for (const { re, msg, keepComments } of FORBIDDEN_PATTERNS) {
    lines.forEach((line, i) => {
      if (re.test(line) && (keepComments || !/^\s*--/.test(line))) {
        issues.push({ level: 'warning', message: `${msg} (linia ${i + 1})` });
      }
    });
  }

  const isModule = /\.luau?$/i.test(file.path) && !/\.(server|client)\./i.test(file.path);
  if (isModule && !/return\s+[\w{("']/.test(source)) {
    issues.push({ level: 'error', message: 'ModuleScript bez `return` – gra nie wystartuje (require zwróci nil).' });
  }

  if (/StarterPlayerScripts|PlayerGui/.test(source) && /ServerScriptService|ServerStorage/.test(source)) {
    issues.push({ level: 'warning', message: 'Plik miesza API serwera i klienta.' });
  }

  const requirePaths = [...source.matchAll(/require\(\s*([\w.:]+)\s*\)/g)].map((m) => m[1]);
  for (const r of requirePaths) {
    if (/^game\.Workspace\./i.test(r)) {
      issues.push({ level: 'warning', message: `require(${r}) – nie używaj require na instancjach Workspace.` });
    }
  }

  return issues;
}

export function validateProject(project) {
  const warnings = [];
  const errors = [];
  const seen = new Set();
  const files = project.files || [];

  if (!files.length) errors.push('Projekt nie zawiera żadnych plików Luau.');

  for (const file of files) {
    const path = normalisePath(file.path);
    if (!isValidPath(path)) {
      errors.push(`Nieprawidłowa ścieżka pliku: ${path}`);
      continue;
    }
    if (seen.has(path)) warnings.push(`Zduplikowany plik ${path} – zostanie nadpisany.`);
    seen.add(path);
    for (const issue of lintFile({ path, content: file.content })) {
      const entry = `${path}: ${issue.message}`;
      if (issue.level === 'error') errors.push(entry);
      else warnings.push(entry);
    }
  }

  // World sanity checks
  const children = project.world?.world?.children || project.world?.children || [];
  const flat = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      flat.push(n);
      walk(n.children);
    }
  };
  walk(children);
  if (!flat.some((n) => n.className === 'SpawnLocation')) {
    warnings.push('Świat nie zawiera SpawnLocation – gracze pojawią się na domyślnym spawnie Robloxa (może być nad pustką).');
  }
  if (!flat.some((n) => n.className === 'Part' || n.className === 'Baseplate' || n.className === 'Model')) {
    warnings.push('Świat nie zawiera żadnej podłogi (Part/Baseplate) – gracz może spadać w pustkę.');
  }
  const spawnParts = flat.filter((n) => n.className === 'SpawnLocation');
  for (const s of spawnParts) {
    const pos = s.properties?.Position || s.properties?.CFrame?.position;
    if (Array.isArray(pos) && pos[2] > 4000) warnings.push(`SpawnLocation "${s.name}" jest bardzo daleko od środka mapy (Z=${pos[2]}).`);
  }

  const requiredKinds = { server: 0, client: 0, shared: 0 };
  for (const f of files) {
    if (f.path.startsWith('src/server/') && /\.server\./i.test(f.path)) requiredKinds.server++;
    else if (f.path.startsWith('src/client/') && /\.client\./i.test(f.path)) requiredKinds.client++;
    else if (f.path.startsWith('src/shared/')) requiredKinds.shared++;
  }
  if (!requiredKinds.server) warnings.push('Brak pliku *.server.luau – nie ma kodu startowego na serwerze.');
  if (!requiredKinds.client) warnings.push('Brak pliku *.client.luau – gracz nie zobaczy UI ani sterowania specyficznego dla klienta.');

  const stats = {
    files: files.length,
    lines: files.reduce((acc, f) => acc + String(f.content || '').split('\n').length, 0),
    bytes: files.reduce((acc, f) => acc + Buffer.byteLength(String(f.content || ''), 'utf8'), 0),
    worldNodes: flat.length,
    serverScripts: requiredKinds.server,
    clientScripts: requiredKinds.client,
    modules: files.length - requiredKinds.server - requiredKinds.client,
  };

  return { errors, warnings, stats, valid: errors.length === 0 };
}
