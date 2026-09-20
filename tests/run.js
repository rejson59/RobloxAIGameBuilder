#!/usr/bin/env node
/**
 * Test suite – no network, no API keys. Run with: npm test
 *
 * Covers:
 *   - ZIP writer round-trip (store + deflate, UTF-8 names)
 *   - .rbxmx writer (script placement, world tree, lighting, escaping)
 *   - Studio plugin generation (embedded project, Luau literal escaping)
 *   - exporters (file list, filenames, content types)
 *   - validator (placeholder/deprecated-API detection, world sanity)
 *   - all offline demos (files present, profiles valid, Luau parses)
 *   - pipeline batching order + offline demo generation
 *   - HTTP API end-to-end on an ephemeral port (health, demos, export, SSE)
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { createZip, readZipEntries, crc32 } from '../server/zip.js';
import { buildRbxmx, buildRojoProject, planFileTree } from '../server/rbxmx.js';
import { buildPlugin, toLuau } from '../server/plugin.js';
import { assembleFiles, exportAs, projectSlug } from '../server/exporters.js';
import { validateProject, normalisePath, isValidPath } from '../server/validate.js';
import { DEMOS, getDemo, listDemos } from '../server/games.js';
import { generateGame, planBatches } from '../server/pipeline.js';
import { publicProviders, getProvider } from '../server/providers.js';
import { parseJsonLoose, slugify, safeInstanceName, eulerToMatrix, parseCFrame } from '../server/util.js';
import { createServer } from '../server/index.js';

/* ------------------------------------------------------------------ *
 * Tiny test runner
 * ------------------------------------------------------------------ */
const results = { passed: 0, failed: 0, skipped: 0 };
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (err) {
    if (err && err.message === 'SKIP') {
      results.skipped++;
      process.stdout.write(`  \x1b[33m○\x1b[0m ${name} (pominięto)\n`);
      return;
    }
    results.failed++;
    failures.push({ name, error: err });
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

/* ------------------------------------------------------------------ *
 * Optional Luau parser (devDependency) – skips when not installed
 * ------------------------------------------------------------------ */
let luauParse = null;
try {
  const mod = await import('luau-parser');
  luauParse = mod.parse || mod.default;
} catch {
  luauParse = null;
}

function assertLuauParses(source, label) {
  if (!luauParse) throw new Error('SKIP');
  try {
    luauParse(source);
  } catch (err) {
    throw new Error(`${label}: błąd składni Luau → ${err.message.slice(0, 300)}`);
  }
}

/* ================================================================== */
section('1. zip.js – archiwum ZIP');

await test('crc32 zgadza się ze znaną wartością ("123456789" -> 0xCBF43926)', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

await test('createZip -> readZipEntries: 5 plików, treść i rozmiary bez zmian', () => {
  const files = [
    { path: 'src/server/a.server.luau', content: 'print("hello ąćęłńóśźż")\n' },
    { path: 'src/shared/Config.luau', content: 'return { Speed = 16 }\n' },
    { path: 'docs/nested/deep/file.md', content: '# Tytuł\n' },
    { path: 'binary.bin', content: Buffer.from([0, 1, 2, 250, 255, 128]) },
    { path: 'duplicate-of-large.txt', content: 'x'.repeat(20000) },
  ];
  const zip = createZip(files);
  const entries = readZipEntries(zip);
  assert.equal(entries.length, files.length);
  for (const file of files) {
    const entry = entries.find((e) => e.path === file.path);
    assert.ok(entry, `brak wpisu ${file.path}`);
    const expected = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    assert.deepEqual(entry.content, expected, `treść ${file.path} różni się`);
  }
});

await test('duże, dobrze kompresowalne pliki są deflate-owane (mniejszy rozmiar)', () => {
  const content = 'local x = 1\n'.repeat(2000);
  const zip = createZip([{ path: 'big.luau', content }]);
  assert.ok(zip.length < content.length / 5, `zip powinien być znacznie mniejszy (${zip.length} vs ${content.length})`);
});

/* ================================================================== */
section('2. rbxmx.js – model Roblox Studio');

const sampleProject = {
  name: 'Test Game',
  summary: 'projekt testowy',
  files: [
    { path: 'src/server/Bootstrap.server.luau', content: 'print("server")\n' },
    { path: 'src/server/Util.luau', content: 'return {}\n' },
    { path: 'src/client/Hud.client.luau', content: 'print("client")\n' },
    { path: 'src/shared/Config.luau', content: 'return { A = 1 }\n' },
  ],
  world: {
    lighting: { ClockTime: 15, Ambient: '#6E7B94', Technology: 'ShadowMap', GlobalShadows: true },
    world: {
      name: 'World',
      className: 'Folder',
      children: [
        { className: 'Part', name: 'Floor', properties: { Size: [40, 2, 40], Position: [0, -1, 0], Anchored: true, Color: '#FFAA00', Material: 'Neon' } },
        { className: 'SpawnLocation', name: 'Spawn', properties: { Position: [0, 1, 0], Duration: 0 } },
        { className: 'Part', name: 'Rot', properties: { CFrame: { position: [0, 5, 0], rotation: [0, 45, 0] } } },
        { className: 'Folder', name: 'Decor', children: [{ className: 'PointLight', name: 'L', properties: { Brightness: 2, Range: 20, Color: '#00E5A0' } }] },
      ],
    },
  },
};

await test('planFileTree: .server -> Script, .client -> LocalScript, reszta -> ModuleScript', () => {
  const { scripts, warnings } = planFileTree(sampleProject.files);
  assert.equal(warnings.length, 0);
  const byName = Object.fromEntries(scripts.map((s) => [s.name, s.className]));
  assert.equal(byName.Bootstrap, 'Script');
  assert.equal(byName.Hud, 'LocalScript');
  assert.equal(byName.Util, 'ModuleScript');
  assert.equal(byName.Config, 'ModuleScript');
});

await test('buildRbxmx: poprawne usługi, zagnieżdżenia i brak ostrzeżeń', () => {
  const { xml, warnings } = buildRbxmx(sampleProject);
  assert.deepEqual(warnings, []);
  assert.match(xml, /<Item class="ServerScriptService"/);
  assert.match(xml, /<Item class="StarterPlayer"/);
  assert.match(xml, /<Item class="StarterPlayerScripts"/);
  assert.match(xml, /<Item class="ReplicatedStorage"/);
  assert.match(xml, /<Item class="Workspace"/);
  assert.match(xml, /<Item class="Lighting"/);
  assert.match(xml, /<ProtectedString name="Source">/);
  assert.equal((xml.match(/<Item /g) || []).length, (xml.match(/<\/Item>/g) || []).length);
  assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>/);
  assert.match(xml, /<\/roblox>\n$/);
});

await test('buildRbxmx: właściwości (Vector3, Color3, enum, CFrame) i escapowanie XML', () => {
  const project = structuredClone(sampleProject);
  project.files[0].content = 'print("a < b & c > d")\n';
  const { xml } = buildRbxmx(project);
  assert.match(xml, /<Vector3 name="Size"><X>40<\/X><Y>2<\/Y><Z>40<\/Z><\/Vector3>/);
  assert.match(xml, /<Color3 name="Color"><R>1\.000000<\/R>/);
  assert.match(xml, /<token name="Material">288<\/token>/);
  assert.match(xml, /<CoordinateFrame name="CFrame">/);
  assert.match(xml, /0\.707107/);
  assert.match(xml, /a &lt; b &amp; c &gt; d/);
  assert.match(xml, /<int name="Duration">0<\/int>/);
});

await test('buildRojoProject: poprawna konfiguracja Rojo', () => {
  const tree = buildRojoProject(sampleProject);
  assert.equal(tree.name, 'test-game');
  assert.equal(tree.tree.ReplicatedStorage.Shared.$path, 'src/shared');
  assert.equal(tree.tree.ServerScriptService.$path, 'src/server');
  assert.equal(tree.tree.StarterPlayer.StarterPlayerScripts.$path, 'src/client');
  assert.equal(tree.tree.Workspace.$properties.FilteringEnabled, true);
});

await test('planFileTree: ścieżki spoza src/ trafiają do ServerStorage z ostrzeżeniem', () => {
  const { warnings } = planFileTree([{ path: 'random/Thing.luau', content: 'return {}\n' }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ServerStorage/);
});

/* ================================================================== */
section('3. plugin.js – wtyczka Studio');

await test('toLuau: poprawne escapowanie stringów Luau', () => {
  const output = toLuau({ a: 'linia\n"cudzysłów"\t\\backslash', b: [1, 2, 3], c: true, d: null });
  assert.match(output, /"linia\\n\\"cudzysłów\\"\\t\\\\backslash"/);
  assert.match(output, /b = \{/);
  assert.match(output, /c = true/);
  assert.match(output, /d = nil/);
});

await test('toLuau: klucze niebędące identyfikatorami są cytowane', () => {
  const output = toLuau({ 'my-key': 1, 'normal': 2 });
  assert.match(output, /\["my-key"\] = 1/);
  assert.match(output, /normal = 2/);
});

await test('buildPlugin: osadza wszystkie pliki i mapuje klasy skryptów', () => {
  const source = buildPlugin(sampleProject);
  assert.match(source, /local PROJECT = \{/);
  assert.match(source, /src\/server\/Bootstrap\.server\.luau/);
  assert.match(source, /Bootstrap\.server\.luau/);
  assert.match(source, /className = "Script"/);
  assert.match(source, /className = "LocalScript"/);
  assert.match(source, /plugin:CreateToolbar/);
  assert.match(source, /ChangeHistoryService/);
  assert.match(source, /Buduj grę/);
});

await test('buildPlugin: wygenerowany kod wtyczki jest poprawnym Luau', () => {
  assertLuauParses(buildPlugin(sampleProject), 'plugin');
});

/* ================================================================== */
section('4. exporters.js – artefakty do pobrania');

await test('assembleFiles: dołącza README, default.project.json, .gitignore, docs i ai-builder.json', () => {
  const project = {
    ...structuredClone(sampleProject),
    design: { designDoc: '## Koncept\ntreść' },
    plan: { architecture: 'opis architektury' },
  };
  const files = assembleFiles(project);
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes('README.md'));
  assert.ok(paths.includes('default.project.json'));
  assert.ok(paths.includes('.gitignore'));
  assert.ok(paths.includes('docs/DESIGN.md'));
  assert.ok(paths.includes('docs/ARCHITECTURE.md'));
  assert.ok(paths.includes('ai-builder.json'));
  assert.equal(paths.length, sampleProject.files.length + 7);
  const manifest = JSON.parse(files.find((f) => f.path === 'ai-builder.json').content);
  assert.equal(manifest.name, 'Test Game');
  assert.equal(manifest.files.length, 4);
});

await test('exportAs: nazwy plików i typy MIME dla każdego formatu', () => {
  const zip = exportAs(sampleProject, 'zip');
  assert.equal(zip.filename, 'test-game-rojo.zip');
  assert.equal(zip.contentType, 'application/zip');
  assert.ok(readZipEntries(zip.body).length >= 4);

  const rbxmx = exportAs(sampleProject, 'rbxmx');
  assert.equal(rbxmx.filename, 'test-game.rbxmx');
  assert.match(rbxmx.contentType, /xml/);
  assert.match(rbxmx.body.toString('utf8'), /<roblox /);

  const plugin = exportAs(sampleProject, 'plugin');
  assert.equal(plugin.filename, 'test-game.plugin.luau');
  assert.match(plugin.body.toString('utf8'), /local PROJECT/);

  assert.equal(exportAs(sampleProject, 'rojo').filename, 'test-game-rojo.zip');
  assert.equal(projectSlug({ name: 'Zażółć Gęślą Jaźń!' }), 'zazolc-gesla-jazn');
});

/* ================================================================== */
section('5. validate.js – bramka jakości');

await test('normalisePath / isValidPath', () => {
  assert.equal(normalisePath('./src\\server\\A.luau'), 'src/server/A.luau');
  assert.equal(isValidPath('src/server/A.server.luau'), true);
  assert.equal(isValidPath('src/client/B.client.luau'), true);
  assert.equal(isValidPath('src/shared/C.luau'), true);
  assert.equal(isValidPath('../evil.luau'), false);
  assert.equal(isValidPath('src/server/A.txt'), false);
  assert.equal(isValidPath('other/D.luau'), false);
});

await test('lintProject wykrywa placeholdery, przestarzałe API i brak return w module', () => {
  const result = validateProject({
    files: [
      { path: 'src/server/Bad.server.luau', content: 'wait(2)\nlocal x = 1\n-- TODO dokoncz\n' },
      { path: 'src/shared/Broken.luau', content: 'local t = {}\n' },
    ],
    world: { children: [] },
  });
  assert.ok(result.errors.length >= 1, 'brak return w ModuleScript powinien być błędem');
  assert.ok(result.warnings.some((w) => /wait\(\)/.test(w)), 'wait() powinien być ostrzeżeniem');
  assert.ok(result.warnings.some((w) => /placeholder/i.test(w)), 'placeholder powinien być ostrzeżeniem');
  assert.ok(result.warnings.some((w) => /SpawnLocation/.test(w)));
  assert.equal(result.valid, false);
});

await test('poprawny projekt przechodzi bez błędów', () => {
  const result = validateProject(sampleProject);
  assert.equal(result.errors.length, 0, result.errors.join('; '));
  assert.equal(result.stats.files, 4);
  assert.equal(result.stats.serverScripts, 1);
  assert.equal(result.stats.clientScripts, 1);
  assert.equal(result.stats.modules, 2);
  assert.ok(result.stats.worldNodes >= 4);
});

/* ================================================================== */
section('6. util.js – parsowanie odpowiedzi modelu');

await test('parseJsonLoose: obsługuje fence, śmieci przed JSON-em i trailing commas', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Oto wynik:\n{"a": [1,2,],}\nDzięki!'), { a: [1, 2] });
  assert.deepEqual(parseJsonLoose('{"code":"local x = 1\\nprint(x)"}').code, 'local x = 1\nprint(x)');
  assert.throws(() => parseJsonLoose('to nie jest json'));
});

await test('slugify / safeInstanceName', () => {
  assert.equal(slugify('Wielka Gra! O Smokach'), 'wielka-gra-o-smokach');
  assert.equal(safeInstanceName('1 zły'), 'Item_1_zly');
  assert.equal(safeInstanceName('end'), 'end_');
  assert.equal(safeInstanceName('Dobra_Nazwa'), 'Dobra_Nazwa');
});

await test('eulerToMatrix / parseCFrame: 90° wokół Y', () => {
  const matrix = eulerToMatrix([0, 90, 0]);
  assert.ok(Math.abs(matrix[0][0]) < 1e-6);
  assert.ok(Math.abs(matrix[0][2] + 1) < 1e-6);
  const parsed = parseCFrame({ position: [1, 2, 3], rotation: [0, 0, 0] });
  assert.deepEqual(parsed.position, [1, 2, 3]);
  assert.equal(parsed.rotation.length, 9);
});

/* ================================================================== */
section('7. providers.js – BYOK');

await test('rejestr dostawców jest kompletny i spójny', () => {
  const providers = publicProviders();
  assert.ok(providers.length >= 9);
  const ids = providers.map((p) => p.id);
  for (const expected of ['openai', 'anthropic', 'google', 'openrouter', 'deepseek', 'groq', 'mistral', 'xai', 'ollama', 'custom']) {
    assert.ok(ids.includes(expected), `brak dostawcy ${expected}`);
  }
  for (const provider of providers) {
    assert.ok(['openai', 'anthropic', 'gemini'].includes(provider.protocol), `${provider.id}: zły protokół`);
    if (provider.id !== 'custom') assert.ok(provider.baseUrl.length > 0, `${provider.id}: brak baseUrl`);
    if (provider.needsKey) assert.ok(provider.keyUrl || provider.id === 'custom', `${provider.id}: brak linku do kluczy`);
  }
  assert.equal(getProvider('ollama').needsKey, false);
  assert.equal(getProvider('nope'), null);
});

/* ================================================================== */
section('8. pipeline.js – orkiestracja');

await test('planBatches: kolejność shared -> moduły serwera -> bootstrap -> server -> client', () => {
  const files = [
    { path: 'src/client/Hud.client.luau', kind: 'client' },
    { path: 'src/server/Bootstrap.server.luau', kind: 'server' },
    { path: 'src/server/EnemyService.luau', kind: 'module' },
    { path: 'src/shared/Config.luau', kind: 'module' },
    { path: 'src/client/Controller.client.luau', kind: 'client' },
  ];
  const batches = planBatches(files, 3);
  const flat = batches.flatMap((b) => b.files);
  assert.equal(flat.length, files.length);
  assert.equal(flat[0], 'src/shared/Config.luau');
  assert.equal(flat[1], 'src/server/EnemyService.luau');
  assert.equal(flat[2], 'src/server/Bootstrap.server.luau');
  assert.equal(flat[3], 'src/client/Hud.client.luau');
  for (const batch of batches) assert.ok(batch.reason.length > 5, 'paczka bez opisu');
});

await test('generateGame w trybie demo nie wykonuje żadnych wywołań API', async () => {
  const events = [];
  const project = await generateGame({
    idea: 'td',
    options: { demo: true, demoId: 'td' },
    config: { provider: 'openai', apiKey: '', model: '' },
    onEvent: (event) => events.push(event),
  });
  assert.equal(project.demo, true);
  assert.equal(project.usage.calls, 0);
  assert.ok(project.files.length >= 7);
  assert.equal(project.validation.errors.length, 0, project.validation.errors.join('; '));
  assert.ok(events.some((e) => e.type === 'done'));
});

await test('generateGame bez demo i bez klucza zwraca czytelny błąd', async () => {
  await assert.rejects(
    () => generateGame({
      idea: 'gra',
      options: {},
      config: { provider: 'openai', apiKey: '', model: 'gpt-4.1-mini' },
    }),
    /klucz API/i,
  );
});

/* ================================================================== */
section('9. dema offline – zawartość i składnia Luau');

for (const demo of DEMOS) {
  await test(`demo "${demo.id}" (${demo.name}): pliki, walidacja, składnia Luau`, () => {
    assert.ok(demo.files.length >= 6, 'demo powinno mieć min. 6 plików');
    assert.ok(demo.design?.designDoc?.length > 200, 'brak dokumentu projektowego');
    assert.ok(demo.plan?.architecture?.length > 50, 'brak opisu architektury');
    assert.ok(demo.world?.world?.children?.length > 0, 'brak świata');

    const result = validateProject(demo);
    assert.equal(result.errors.length, 0, `błędy walidacji: ${result.errors.join('; ')}`);

    let filesParsed = 0;
    for (const file of demo.files) {
      assert.ok(file.content.trim().length > 100, `${file.path} jest podejrzanie krótki`);
      assertLuauParses(file.content, `${demo.id}/${file.path}`);
      filesParsed++;
    }
    assert.equal(filesParsed, demo.files.length);

    const { xml, warnings } = buildRbxmx(demo);
    assert.equal(warnings.length, 0, `rbxmx: ${warnings.join('; ')}`);
    assert.match(xml, /Instance|<Item/);
  });
}

await test('getDemo: aliasy, id i dopasowanie do opisu', () => {
  assert.equal(getDemo('obby').id, 'obby');
  assert.equal(getDemo('tower-defense').id, 'td');
  assert.equal(getDemo('pvp').id, 'arena');
  assert.equal(getDemo('Chcę tower defense z wieżami').id, 'td');
  assert.equal(getDemo('arena pvp shooter').id, 'arena');
  assert.equal(getDemo('nieznany tekst').id, 'obby');
  assert.equal(listDemos().length, DEMOS.length);
});

/* ================================================================== */
section('10. serwer HTTP – pełny przepływ');

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function getJson(pathname, options) {
  const res = await fetch(base + pathname, options);
  return { res, json: await res.json() };
}

await test('GET /api/health', async () => {
  const { res, json } = await getJson('/api/health');
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.ok(json.version);
});

await test('GET /api/providers i /api/demos', async () => {
  const providers = await getJson('/api/providers');
  assert.ok(providers.json.providers.length >= 9);
  const demos = await getJson('/api/demos');
  assert.equal(demos.json.demos.length, DEMOS.length);
});

await test('POST /api/demo zwraca projekt z walidacją', async () => {
  const { json } = await getJson('/api/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'arena' }),
  });
  assert.equal(json.project.id, 'arena');
  assert.equal(json.project.validation.errors.length, 0);
});

await test('POST /api/export?format=zip zwraca prawdziwy ZIP w nagłówku attachment', async () => {
  const res = await fetch(`${base}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: sampleProject, format: 'zip' }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="test-game-rojo\.zip"/);
  const buffer = Buffer.from(await res.arrayBuffer());
  const entries = readZipEntries(buffer);
  assert.ok(entries.some((e) => e.path === 'README.md'));
  assert.ok(entries.some((e) => e.path === 'default.project.json'));
});

await test('POST /api/export?format=rbxmx|plugin zwraca pliki do pobrania', async () => {
  const rbxmx = await fetch(`${base}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: sampleProject, format: 'rbxmx' }),
  });
  const xml = await rbxmx.text();
  assert.match(xml, /<roblox /);
  assert.match(rbxmx.headers.get('content-disposition'), /test-game\.rbxmx/);

  const plugin = await fetch(`${base}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: sampleProject, format: 'plugin' }),
  });
  const source = await plugin.text();
  assert.ok(source.includes('local PROJECT'), 'wtyczka nie zawiera osadzonego projektu');
  assert.match(plugin.headers.get('content-disposition'), /test-game\.plugin\.luau/);
});

await test('POST /api/generate (SSE) w trybie demo emituje zdarzenia i projekt', async () => {
  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'test-job', idea: 'obby', options: { demo: true, demoId: 'obby' }, config: {} }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  const events = text
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((l) => l.startsWith('data: ')))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
  assert.ok(events.some((e) => e.type === 'open'));
  assert.ok(events.some((e) => e.type === 'done'));
  const projectEvent = events.find((e) => e.type === 'project');
  assert.ok(projectEvent, 'brak zdarzenia project');
  assert.equal(projectEvent.project.name.length > 3, true);
  assert.ok(projectEvent.project.files.length >= 6);
});

await test('nieznany endpoint zwraca 404 JSON, a statyki działają', async () => {
  const missing = await fetch(`${base}/api/nope`);
  assert.equal(missing.status, 404);
  assert.ok((await missing.json()).error);

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /Roblox AI Game Builder/);

  const app = await fetch(`${base}/app.js`);
  assert.equal(app.status, 200);
  assert.match(app.headers.get('content-type'), /javascript/);
});

await new Promise((resolve) => server.close(resolve));

/* ================================================================== */
section('11. CLI – eksport offline do katalogu');

await test('npm run demo:export produkuje kompletny zestaw plików', async () => {
  const { execFileSync } = await import('node:child_process');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbxai-'));
  execFileSync(process.execPath, [
    path.join(import.meta.dirname, '..', 'server', 'cli.js'),
    '--demo', 'obby',
    '--out', outDir,
    '--formats', 'zip,rbxmx,plugin,rojo',
    '--quiet',
  ], { stdio: 'pipe' });

  const listing = fs.readdirSync(outDir).sort();
  const zipName = listing.find((f) => f.endsWith('-rojo.zip'));
  assert.ok(zipName, `brak ZIP-a (jest: ${listing.join(', ')})`);
  assert.ok(listing.includes('neon-skyway-obby.rbxmx'), `brak .rbxmx (jest: ${listing.join(', ')})`);
  assert.ok(listing.some((f) => f.endsWith('.plugin.luau')), 'brak wtyczki');
  assert.ok(fs.existsSync(path.join(outDir, 'src', 'shared', 'Config.luau')), 'brak plików źródłowych');
  assert.ok(fs.existsSync(path.join(outDir, 'default.project.json')), 'brak default.project.json');
  assert.ok(fs.existsSync(path.join(outDir, 'README.md')), 'brak README.md');

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'ai-builder.json'), 'utf8'));
  assert.equal(manifest.files.length, 6);

  const zipEntries = readZipEntries(fs.readFileSync(path.join(outDir, zipName)));
  assert.ok(zipEntries.some((e) => e.path === 'src/server/LevelBuilder.server.luau'));

  fs.rmSync(outDir, { recursive: true, force: true });
});

/* ================================================================== */
process.stdout.write(`\n\x1b[1mWynik:\x1b[0m ${results.passed} przeszło, ${results.failed} nie przeszło, ${results.skipped} pominięto\n`);
if (!luauParse) {
  process.stdout.write('\x1b[33mUwaga:\x1b[0m brak pakietu luau-parser (npm install) – pominięto sprawdzanie składni Luau.\n');
}
if (results.failed) {
  process.stdout.write('\nSzczegóły błędów:\n');
  for (const { name, error } of failures) {
    process.stdout.write(`- ${name}\n  ${error.stack?.split('\n').slice(0, 4).join('\n  ') || error.message}\n`);
  }
  process.exit(1);
}
process.exit(0);
