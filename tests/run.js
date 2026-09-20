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
import { encodePng, readPngHeader } from '../server/png.js';
import { renderThumbnail, thumbnailFilename } from '../server/thumbnail.js';
import { startJob, getJob, jobSnapshot, cancelJob, subscribeJob, listJobs, runningJobs } from '../server/jobs.js';
import { BudgetExceededError, CostTracker, budgetFor, costOf, formatUsd, rateFor } from '../server/pricing.js';
import { auditProject } from '../server/audit.js';
import { CATALOG, assetForTag, isPlaceholderValue, searchAssets, starterAssets, tagOf, tagsUsedInProject } from '../server/assets.js';
import { studioTargetForPath } from '../server/studioPaths.js';
import { diffSince, listVersions, restoreVersion, saveFile } from '../server/projects.js';
import { chatStream } from '../server/providers.js';
import { newProjectId, saveProject, listProjects, loadProject, loadVersion, deleteProject, projectsDir } from '../server/projects.js';
import { buildRbxmx, buildRojoProject, planFileTree } from '../server/rbxmx.js';
import { buildPlugin, toLuau, buildPluginPayload } from '../server/plugin.js';
import { assembleFiles, exportAs, projectSlug } from '../server/exporters.js';
import { validateProject, normalisePath, isValidPath } from '../server/validate.js';
import { DEMOS, getDemo, listDemos } from '../server/games.js';
import { generateGame, planBatches, refineProject, autoRepairProject } from '../server/pipeline.js';
import { publicProviders, getProvider as providerById } from '../server/providers.js';
import { parseJsonLoose, slugify, safeInstanceName, eulerToMatrix, parseCFrame } from '../server/util.js';
import { createServer } from '../server/index.js';

/* ------------------------------------------------------------------ *
 * Tiny test runner
 * ------------------------------------------------------------------ */
// Izolowana biblioteka: testy nie mogą śmiecić w .projects/ użytkownika.
const TEST_LIBRARY = fs.mkdtempSync(path.join(os.tmpdir(), 'rbxai-test-lib-'));
process.env.PROJECTS_DIR = TEST_LIBRARY;

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
section('2. png.js + thumbnail.js – generator ikon');

await test('encodePng: poprawny nagłówek PNG i odczyt rozmiaru', () => {
  const rgb = Buffer.alloc(16 * 16 * 3, 128);
  const png = encodePng(16, 16, rgb);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const header = readPngHeader(png);
  assert.equal(header.width, 16);
  assert.equal(header.height, 16);
  assert.equal(header.bitDepth, 8);
  assert.equal(header.colorType, 2);
  assert.equal(png.readUInt32BE(png.length - 4), crc32(png.subarray(png.length - 8, png.length - 4)));
});

await test('encodePng: zły rozmiar bufora jest odrzucany', () => {
  assert.throws(() => encodePng(8, 8, Buffer.alloc(10)), /oczekiwano/);
});

await test('renderThumbnail: PNG 512x512, różne palety dla różnych gatunków', () => {
  const obby = renderThumbnail({ name: 'Neon Skyway Obby', genre: 'Obby' });
  const thumb = readPngHeader(obby);
  assert.equal(thumb.width, 512);
  assert.equal(thumb.height, 512);
  assert.ok(obby.length > 4000, `ikona powinna mieć sensowny rozmiar (${obby.length} B)`);

  const horror = renderThumbnail({ name: 'Blackout Ward', genre: 'Horror' }, { size: 256 });
  assert.equal(readPngHeader(horror).width, 256);
  assert.notDeepEqual(obby, horror, 'ikony różnych gatunków nie mogą być identyczne');
  assert.equal(thumbnailFilename({ name: 'Neon Skyway Obby' }), 'neon-skyway-obby-icon.png');
});

await test('renderThumbnail: radzi sobie z bardzo długim tytułem i brakiem danych', () => {
  const long = renderThumbnail({ name: 'Bardzo Długa Nazwa Gry Która Nie Zmieści Się W Jednej Linii Ani W Dwóch' });
  assert.ok(readPngHeader(long).width === 512);
  const empty = renderThumbnail({}, { size: 128 });
  assert.equal(readPngHeader(empty).width, 128);
});

/* ================================================================== */
section('3. rbxmx.js – model Roblox Studio');

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
section('4. plugin.js – wtyczka Studio');

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

await test('buildPlugin: osadza projekt, konfigurację i pełne UI', () => {
  const source = buildPlugin(sampleProject, { serverUrl: 'http://127.0.0.1:5173', provider: 'openai', model: 'gpt-4.1-mini' });
  assert.match(source, /local PROJECT = \{/);
  assert.match(source, /local PROJECT_CONFIG = \{/);
  assert.match(source, /"http:\/\/127\.0\.0\.1:5173"/);
  assert.match(source, /Bootstrap\.server\.luau/);
  assert.match(source, /scriptClassFor/);
  assert.match(source, /return "Script"/);
  assert.match(source, /return "LocalScript"/);
  assert.match(source, /plugin:CreateToolbar/);
  assert.match(source, /DockWidgetPluginGuiInfo/);
  assert.match(source, /ChangeHistoryService/);
  assert.match(source, /Buduj grę/);
});

await test('buildPlugin: panel wtyczki ma generator AI, zaślepki, darmowe assety i ikonę', () => {
  const source = buildPlugin(sampleProject);
  assert.match(source, /\/api\/refine/);          // "poproś o zmianę" z wnętrza Studio
  assert.match(source, /\/api\/jobs\/\" \.\. jobId/);   // polling zadania z panelu wtyczki
  assert.match(source, /\/api\/thumbnail/);       // zapis ikony do folderu wtyczek
  assert.match(source, /findPlaceholders/);
  assert.match(source, /FREE_ASSETS/);
  assert.match(source, /insertFreeAsset/);
  assert.match(source, /projectPayloadForRefine/);
  assert.match(source, /HttpEnabled/);
});

await test('buildPluginPayload: pełny projekt (design, plan, świat, światła)', () => {
  const payload = buildPluginPayload({ ...sampleProject, design: { genre: 'Obby' }, plan: { architecture: 'x' } }, { projectId: 'abc' });
  assert.equal(payload.name, 'Test Game');
  assert.equal(payload.projectId, 'abc');
  assert.equal(payload.files.length, 4);
  assert.equal(payload.world.children.length, 4);
  assert.equal(payload.lighting.ClockTime, 15);
  assert.equal(payload.design.genre, 'Obby');
});

await test('buildPlugin: wygenerowany kod wtyczki jest poprawnym Luau', () => {
  assertLuauParses(buildPlugin(sampleProject, { serverKeyPlaceholder: true }), 'plugin');
  for (const demo of DEMOS) {
    assertLuauParses(buildPlugin(demo), `plugin/${demo.id}`);
  }
});

/* ================================================================== */
section('5. exporters.js – artefakty do pobrania');

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
section('6. validate.js – bramka jakości');

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
section('7. util.js – parsowanie odpowiedzi modelu');

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
section('8. providers.js – BYOK');

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
  assert.equal(providerById('ollama').needsKey, false);
  assert.equal(providerById('nope'), null);
});

/* ================================================================== */
section('9. pipeline.js – orkiestracja');

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
section('10. dema offline – zawartość i składnia Luau');

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
  assert.equal(getDemo('tycoon').id, 'tycoon');
  assert.equal(getDemo('horror').id, 'horror');
  assert.equal(getDemo('gra o piekarni z maszynami').id, 'tycoon');
  assert.equal(getDemo('Chcę tower defense z wieżami').id, 'td');
  assert.equal(getDemo('arena pvp shooter').id, 'arena');
  assert.equal(getDemo('nieznany tekst').id, 'obby');
  assert.equal(listDemos().length, DEMOS.length);
});

/* ================================================================== */
section('11. jobs.js + projects.js – zadania i biblioteka');

await test('startJob (demo): status done, snapshot dla wtyczki zawiera projekt', async () => {
  const job = startJob({ type: 'generate', idea: 'obby', options: { demo: true, demoId: 'obby' }, config: {} });
  assert.ok(job.id.startsWith('job_'));
  assert.equal(getJob(job.id).status, 'running');
  for (let i = 0; i < 60 && job.status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(job.status, 'done', job.error || '');
  const snapshot = jobSnapshot(job);
  assert.equal(snapshot.progress, 1);
  assert.ok(snapshot.events.some((e) => e.type === 'done'));
  assert.ok(snapshot.project, 'snapshot po zakończeniu musi zawierać projekt');
  assert.ok(snapshot.elapsedMs >= 0);
});

await test('jobSnapshot: wtyczka może pobrać projekt tylko raz na żądanie', async () => {
  const job = startJob({ type: 'generate', idea: 'td', options: { demo: true, demoId: 'td' }, config: {} });
  for (let i = 0; i < 60 && job.status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(jobSnapshot(job, { includeProject: false }).project, undefined);
  assert.ok(jobSnapshot(job, { includeProject: true }).project);
});

await test('cancelJob zatrzymuje generowanie bez klucza API', async () => {
  const job = startJob({ type: 'generate', idea: 'gra', config: { provider: 'custom', baseUrl: 'http://127.0.0.1:1', model: 'x' } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(cancelJob(job.id), true);
  for (let i = 0; i < 40 && job.status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(job.status, 'error');           // brak serwera -> błąd połączenia
  assert.equal(cancelJob('nie-ma-takiego'), false);
  assert.ok(listJobs().length >= 1);
  assert.ok(runningJobs() >= 0);
});

await test('subscribeJob: SSE odtwarza historię i kończy strumień', async () => {
  const job = startJob({ type: 'generate', idea: 'arena', options: { demo: true, demoId: 'arena' }, config: {} });
  for (let i = 0; i < 60 && job.status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
  const fake = {
    chunks: [],
    writeHead() {},
    write(chunk) { this.chunks.push(chunk); },
    end() { this.ended = true; },
    on() {},
    get writableEnded() { return Boolean(this.ended); },
  };
  subscribeJob(job, fake);
  const text = fake.chunks.join('');
  assert.match(text, /"type":"open"/);
  assert.match(text, /"type":"project"/);
  assert.match(text, /"type":"end"/);
  assert.equal(fake.ended, true);
});

await test('zakończone zadanie zapisuje projekt w bibliotece i publikuje je w strumieniu', async () => {
  const job = startJob({ type: 'generate', idea: 'arena', options: { demo: true, demoId: 'arena' }, config: {} });
  const chunks = [];
  const fake = {
    chunks, writeHead() {}, write(c) { chunks.push(c); },
    end() { this.ended = true; }, on() {},
    get writableEnded() { return Boolean(this.ended); },
  };
  // Subskrypcja od razu po starcie: albo strumień na żywo, albo odtworzenie historii –
  // w obu przypadkach UI musi dostać zdarzenie "project" i "end".
  subscribeJob(job, fake);
  for (let i = 0; i < 60 && job.status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(job.status, 'done');
  const text = chunks.join('');
  assert.match(text, /"type":"project"/);
  assert.match(text, /"type":"end"/);
  assert.ok(job.projectId, 'brak id zapisanego projektu');
  assert.ok(loadProject(job.projectId), 'projekt nie został zapisany');
  assert.equal(jobSnapshot(job).projectId, job.projectId);
  assert.equal(jobSnapshot(job).saved, true);
});

await test('biblioteka projektów: zapis, wersje, listowanie, wczytanie, usuwanie', () => {
  const previous = process.env.PROJECTS_DIR;
  process.env.PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rbxai-lib-'));
  try {
    assert.ok(projectsDir().includes('rbxai-lib-'));
    const id = newProjectId('Testowa Gra');
    assert.match(id, /^testowa-gra-\d{4}-\d{2}-\d{2}-[a-z0-9]{4}$/);

    const saved = saveProject(structuredClone(sampleProject), { id, note: 'pierwsza wersja' });
    assert.equal(saved.id, id);
    assert.equal(saved.versions, 1);

    const second = structuredClone(sampleProject);
    second.files[0].content = 'print("zmienione")\n';
    saveProject(second, { id, note: 'druga wersja' });

    const listed = listProjects();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].versions, 2);
    assert.equal(listed[0].files, 4);

    const loaded = loadProject(id);
    assert.equal(loaded.files[0].content, 'print("zmienione")\n');
    const restored = loadVersion(id, 1);
    assert.equal(restored.files[0].content, 'print("sample")\n'.replace('sample', 'server'));
    assert.equal(restored.restoredFrom, 1);

    assert.equal(deleteProject(id), true);
    assert.equal(listProjects().length, 0);
    assert.equal(loadProject(id), null);
    assert.equal(loadVersion(id, 0), null);
  } finally {
    if (previous === undefined) delete process.env.PROJECTS_DIR;
    else process.env.PROJECTS_DIR = previous;
  }
});

await test('refineProject wymaga projektu i instrukcji (bez wywołań API)', async () => {
  await assert.rejects(() => refineProject({ project: null, instruction: 'cokolwiek', config: {} }), /Brak projektu/);
  await assert.rejects(
    () => refineProject({ project: sampleProject, instruction: '   ', config: {} }),
    /Opisz, co chcesz zmienić/,
  );
});

await test('autoRepairProject: czysty projekt nie potrzebuje naprawy', async () => {
  const project = structuredClone(sampleProject);
  project.validation = validateProject(project);
  const { rounds, validation } = await autoRepairProject(project, { provider: 'openai', apiKey: '', model: 'x' }, {});
  assert.equal(rounds, 0);
  assert.equal(validation.errors.length, 0);
});

/* ================================================================== */
section('12. koszty, audyt i katalog assetów');

await test('rateFor/costOf: znane modele, darmowe lokalne i nieznane (szacunek)', () => {
  const mini = rateFor('openai', 'gpt-4.1-mini');
  assert.equal(mini.known, true);
  assert.equal(mini.input, 0.4);
  assert.equal(rateFor('openai', 'o4-mini').known, true);
  assert.equal(rateFor('anthropic', 'claude-sonnet-4-5').output, 15);
  assert.equal(rateFor('ollama', 'qwen2.5-coder:14b').known, true);
  assert.equal(rateFor('openai', 'model-ktory-nie-istnieje').known, false);
  assert.equal(rateFor('custom', 'cokolwiek').known, true);      // lokalny endpoint = bez opłat

  const cost = costOf({ provider: 'openai', model: 'gpt-4.1-mini', inputTokens: 100000, outputTokens: 50000 });
  assert.ok(Math.abs(cost.usd - 0.12) < 1e-9, `oczekiwano $0.12, jest ${cost.usd}`);
  assert.equal(costOf({ provider: 'ollama', model: 'x', inputTokens: 1e6, outputTokens: 1e6 }).usd, 0);
  assert.equal(formatUsd(0), '$0');
  assert.equal(formatUsd(0.0004), '$0.0004');
  assert.equal(formatUsd(0.42), '$0.420');
});

await test('CostTracker: kumuluje zużycie i twardo egzekwuje budżet', () => {
  const tracker = new CostTracker({ provider: 'openai', model: 'gpt-4.1-mini' });
  tracker.add({ inputTokens: 10000, outputTokens: 10000 });
  tracker.add({ inputTokens: 10000, outputTokens: 10000 });
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.calls, 2);
  assert.equal(snapshot.inputTokens, 20000);
  assert.ok(snapshot.usd > 0);

  const limited = new CostTracker({ provider: 'openai', model: 'gpt-4.1-mini', budget: 0.01 });
  assert.throws(() => limited.add({ inputTokens: 1000000, outputTokens: 0 }), BudgetExceededError);

  const previous = process.env.MAX_COST_USD;
  process.env.MAX_COST_USD = '0.25';
  assert.equal(budgetFor({}), 0.25);
  assert.equal(budgetFor({ maxCostUsd: 3 }), 3);
  if (previous === undefined) delete process.env.MAX_COST_USD;
  else process.env.MAX_COST_USD = previous;
  assert.equal(budgetFor({}), null);
});

await test('auditProject: zdrowe dema mają wysoką ocenę i brak błędów', () => {
  for (const demo of DEMOS) {
    const audit = auditProject(demo);
    assert.equal(audit.counts.errors, 0, `${demo.id}: ${JSON.stringify(audit.checks.filter((c) => c.level === 'error'))}`);
    assert.ok(audit.score >= 90, `${demo.id} ma tylko ${audit.score}/100`);
    assert.ok(audit.checks.some((c) => c.id === 'entry' && c.level === 'pass'), `${demo.id}: brak wykrytego skryptu startowego`);
  }
});

await test('auditProject: łapie typowe błędy całego projektu', () => {
  const broken = {
    name: 'Broken Game',
    files: [
      { path: 'src/server/Game.server.luau', content: 'local X = require(game.ReplicatedStorage.Shared.NieMa)\nprint("start")\n' },
      { path: 'src/client/Hud.client.luau', content: 'local store = game:GetService("DataStoreService")\nlocal remotes = game:GetService("ReplicatedStorage")' },
    ],
    plan: { files: [{ path: 'src/shared/Config.luau' }], remoteEvents: [{ name: 'Damage' }] },
    design: { systems: [{ name: 'Ekonomia' }] },
  };
  const audit = auditProject(broken);
  const ids = audit.checks.filter((c) => c.level !== 'pass').map((c) => `${c.id}:${c.level}`);
  assert.ok(ids.includes('plan.missing:error'), 'nie wykryto brakującego pliku z planu');
  assert.ok(ids.includes('requires:error'), 'nie wykryto require() do nieistniejącego modułu');
  assert.ok(ids.includes('remotes:error'), 'nie wykryto brakującego RemoteEventu');
  assert.ok(ids.includes('authority:error'), 'nie wykryto DataStore na kliencie');
  assert.ok(audit.score < 60, `zepsuty projekt nie powinien dostać ${audit.score}/100`);
});

await test('auditProject: brak skryptu startowego to błąd krytyczny', () => {
  const audit = auditProject({ name: 'X', files: [{ path: 'src/shared/Config.luau', content: 'return {}\n' }], plan: { files: [{ path: 'src/shared/Config.luau' }] } });
  const entry = audit.checks.find((c) => c.id === 'entry');
  assert.equal(entry.level, 'error');
});

await test('assets: znaczniki placeholder:<tag> i dopasowanie do katalogu', () => {
  assert.ok(CATALOG.length >= 25, 'katalog assetów jest za mały');
  assert.equal(tagOf('placeholder:coin'), 'coin');
  assert.equal(tagOf('rbxassetid://123'), null);
  assert.equal(isPlaceholderValue('placeholder:ui_click'), true);
  assert.equal(isPlaceholderValue('rbxassetid://0'), true);
  assert.equal(isPlaceholderValue('rbxassetid://9114222000'), false);

  assert.match(assetForTag('coin').rbxAssetId, /^rbxassetid:\/\/\d+$/);
  assert.equal(assetForTag('coin').kind, 'sound');
  assert.equal(assetForTag('neon_grid').kind, 'texture');
  assert.ok(assetForTag('ui_click'), 'klik UI musi mieć asset');
  assert.equal(assetForTag('totalnie-nieznany-tag'), null, 'nieznany tag nie może losowo dopasować assetu');

  const horror = starterAssets('horror').map((a) => a.tags[0]);
  assert.ok(horror.includes('ambient_horror'), 'starter horrora bez atmosfery');
  assert.ok(horror.includes('monster'));
  assert.ok(starterAssets('obby').length >= 3);
  assert.ok(searchAssets({ q: 'laser' }).length >= 1);
  assert.ok(searchAssets({ kind: 'texture' }).every((a) => a.kind === 'texture'));

  const used = tagsUsedInProject({
    genre: 'obby',
    files: [{ path: 'src/server/A.server.luau', content: 'sound.SoundId = "placeholder:coin"\nimg.Image = "placeholder:neon_grid"\n' }],
  });
  assert.equal(used.length, 2);
  assert.ok(used.find((entry) => entry.tag === 'coin').asset);
});

await test('studioPaths: pliki trafiają do właściwych instancji', () => {
  const cases = [
    ['src/server/Bootstrap.server.luau', 'ServerScriptService', 'Script', 'ServerScriptService.Bootstrap'],
    ['src/client/Hud.client.luau', 'StarterPlayer', 'LocalScript', 'StarterPlayer.StarterPlayerScripts.Hud'],
    ['src/shared/Config.luau', 'ReplicatedStorage', 'ModuleScript', 'ReplicatedStorage.Shared.Config'],
    ['src/server/systems/Economy.luau', 'ServerScriptService', 'ModuleScript', 'ServerScriptService.systems.Economy'],
  ];
  for (const [path, service, className, full] of cases) {
    const target = studioTargetForPath(path);
    assert.equal(target.service, service, path);
    assert.equal(target.className, className, path);
    assert.equal(target.studioPath, full, path);
    assert.equal(target.path, undefined, `${path}: pole "path" musi zostać wolne dla ścieżki pliku`);
  }
});

/* ================================================================== */
section('13. live sync: rewizje, diff, edycja plików, rollback');

await test('saveProject/saveFile: każdy zapis podbija rewizję i tworzy wersję', () => {
  const id = newProjectId('Sync Test');
  const first = saveProject(structuredClone(sampleProject), { id, note: 'start' });
  assert.equal(first.revision, 1);
  const second = saveFile(id, 'src/shared/Config.luau', 'return { Version = 2 }\n');
  assert.equal(second.revision, 2);
  assert.equal(loadProject(id).revision, 2);
  assert.equal(loadProject(id).files.find((f) => f.path === 'src/shared/Config.luau').content, 'return { Version = 2 }\n');
  const third = saveFile(id, 'src/client/Extra.client.luau', '-- nowy plik\n');
  assert.equal(third.revision, 3);
  assert.equal(loadProject(id).files.length, sampleProject.files.length + 1);
  assert.equal(saveFile('nie-ma-takiego', 'x', 'y'), null);
  deleteProject(id);
});

await test('diffSince: zwraca tylko zmienione pliki i potrafi kazać przebudować wszystko', () => {
  const id = newProjectId('Diff Test');
  saveProject(structuredClone(sampleProject), { id });
  saveFile(id, 'src/shared/Config.luau', 'return { Changed = true }\n');

  const diff = diffSince(id, 1);
  assert.equal(diff.full, false);
  assert.equal(diff.revision, 2);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].path, 'src/shared/Config.luau');
  assert.equal(diff.changed[0].action, 'replace');
  assert.equal(diff.changed[0].service, 'ReplicatedStorage');
  assert.equal(diff.changed[0].studioPath, 'ReplicatedStorage.Shared.Config');
  assert.equal(diff.changed[0].className, 'ModuleScript');
  assert.ok(diff.changed[0].content.includes('Changed'));
  assert.equal(diff.unchanged, sampleProject.files.length - 1);

  // Usunięcie pliku też jest widoczne.
  saveFile(id, 'src/client/Hud.client.luau', null);
  const diff2 = diffSince(id, 1);
  assert.ok(diff2.removed.some((entry) => entry.path === 'src/client/Hud.client.luau'), 'brak informacji o usuniętym pliku');
  assert.equal(diff2.removed[0].className, 'LocalScript');

  // Nieznana rewizja → pełna synchronizacja (klient musi przebudować wszystko).
  const full = diffSince(id, 999);
  assert.equal(full.full, true);
  assert.ok(full.changed.length >= 3);
  assert.equal(diffSince('nie-ma-takiego', 1), null);
  deleteProject(id);
});

await test('restoreVersion: rollback tworzy nową wersję i zachowuje historię', () => {
  const id = newProjectId('Rollback Test');
  saveProject(structuredClone(sampleProject), { id });
  saveFile(id, 'src/shared/Config.luau', 'return { Broken = true }\n');

  const versions = listVersions(id);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].revision, 2);

  const restored = restoreVersion(id, 1);
  assert.equal(restored.revision, 3, 'rollback ma dodać nową rewizję, nie kasować historii');
  assert.equal(restored.restoredFrom, 1);
  const project = loadProject(id);
  assert.ok(!project.files.find((f) => f.path === 'src/shared/Config.luau').content.includes('Broken'));
  assert.equal(listVersions(id).length, 3);
  assert.equal(restoreVersion(id, 99), null);
  deleteProject(id);
});

/* ================================================================== */
section('14. strumieniowanie odpowiedzi (atrapa dostawców)');

await test('chatStream: OpenAI, Anthropic i Gemini (różne dialekty SSE)', async () => {
  const http2 = (await import('node:http')).default;
  const server = http2.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (req.url.includes('/messages')) {
      assert.equal(body.stream, true, 'Anthropic musi dostać stream: true');
      res.write('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 111 } } }) + '\n\n');
      for (const piece of ['{"files"', ': [{"path"', ':"a.luau"}]}']) {
        res.write('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { text: piece } }) + '\n\n');
      }
      res.write('data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 77 } }) + '\n\n');
    } else if (req.url.includes(':streamGenerateContent')) {
      res.write('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok"' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 } }) + '\n\n');
      res.write('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: ':true}' }] } }] }) + '\n\n');
    } else {
      assert.equal(body.stream, true, 'protokół OpenAI musi dostać stream: true');
      for (const piece of ['{"a"', ':1}']) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n');
      }
      res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 500, completion_tokens: 25 } }) + '\n\n');
      res.write('data: [DONE]\n\n');
    }
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const openai = await chatStream({ provider: 'openai', apiKey: 'k', model: 'gpt-4.1-mini', baseUrl: `${base}/v1`, system: 's', messages: [{ role: 'user', content: 'u' }] });
  assert.equal(openai.text, '{"a":1}');
  assert.equal(openai.usage.inputTokens, 500);
  assert.equal(openai.usage.outputTokens, 25);
  assert.equal(openai.streamed, true);

  const claude = await chatStream({ provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-5', baseUrl: base, system: 's', messages: [{ role: 'user', content: 'u' }] });
  assert.equal(claude.text, '{"files": [{"path":"a.luau"}]}');
  assert.equal(claude.usage.inputTokens, 111);
  assert.equal(claude.usage.outputTokens, 77);

  const gemini = await chatStream({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash', baseUrl: `${base}/v1beta`, system: 's', messages: [{ role: 'user', content: 'u' }] });
  assert.equal(gemini.text, '{"ok":true}');
  assert.equal(gemini.usage.inputTokens, 20);

  // Delty trafiają do UI w kolejności.
  const collected = [];
  await chatStream({ provider: 'openai', apiKey: 'k', model: 'gpt-4.1-mini', baseUrl: `${base}/v1`, system: 's', messages: [{ role: 'user', content: 'u' }], onDelta: (piece, full) => collected.push(full) });
  assert.deepEqual(collected, ['{"a"', '{"a":1}']);

  server.close();
});

await test('chatStream: brak zużycia tokenów -> szacunek z długości tekstu', async () => {
  const http2 = (await import('node:http')).default;
  const server = http2.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(400) } }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const out = await chatStream({
    provider: 'custom', apiKey: 'k', model: 'm',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    system: 'y'.repeat(200), messages: [{ role: 'user', content: 'z'.repeat(200) }],
  });
  assert.equal(out.usage.approximated, true);
  assert.equal(out.usage.outputTokens, 100);
  assert.equal(out.usage.inputTokens, 100);
  server.close();
});

await test('getProvider: aliasy (gemini, claude, lokalny) i nieznane id', () => {
  assert.equal(providerById('gemini').id, 'google');
  assert.equal(providerById('claude').id, 'anthropic');
  assert.equal(providerById('GPT').id, 'openai');
  assert.equal(providerById('local').id, 'ollama');
  assert.equal(providerById('nieznany-provider'), null);
});

/* ================================================================== */
section('15. serwer HTTP – pełny przepływ');

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

await test('POST /api/demo zwraca projekt z walidacją i zapisuje go w bibliotece', async () => {
  const { json } = await getJson('/api/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'arena', save: false }),
  });
  assert.equal(json.project.id, 'arena');
  assert.equal(json.project.validation.errors.length, 0);
  assert.equal(json.projectId, null);
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

await test('POST /api/export: rbxmx, rbxlx (miejsce) i wtyczka Studio', async () => {
  for (const [format, pattern] of [['rbxmx', /test-game\.rbxmx/], ['place', /test-game\.rbxlx/]]) {
    const res = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: sampleProject, format }),
    });
    const xml = await res.text();
    assert.match(xml, /<roblox /);
    assert.match(res.headers.get('content-disposition'), pattern);
  }

  const plugin = await fetch(`${base}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: sampleProject, format: 'plugin', serverUrl: 'http://127.0.0.1:9999' }),
  });
  const source = await plugin.text();
  assert.ok(source.includes('local PROJECT'), 'wtyczka nie zawiera osadzonego projektu');
  assert.ok(source.includes('http://127.0.0.1:9999'), 'adres serwera nie trafił do wtyczki');
  assert.ok(source.includes('DockWidgetPluginGuiInfo'), 'wtyczka bez panelu UI');
  assert.match(plugin.headers.get('content-disposition'), /test-game\.plugin\.luau/);
  assertLuauParses(source, 'plugin z API');
});

await test('GET /api/thumbnail zwraca PNG 512x512', async () => {
  const res = await fetch(`${base}/api/thumbnail?name=Neon%20Obby&genre=Obby`);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buffer = Buffer.from(await res.arrayBuffer());
  const header = readPngHeader(buffer);
  assert.equal(header.width, 512);
  assert.equal(header.height, 512);
});

await test('biblioteka przez HTTP: generate (demo) -> jobs -> library -> delete', async () => {
  const start = await getJson('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idea: 'obby', options: { demo: true, demoId: 'obby' }, config: {} }),
  });
  const jobId = start.json.jobId;
  assert.ok(jobId, 'brak jobId');

  let snapshot = null;
  for (let i = 0; i < 80; i++) {
    const poll = await getJson(`/api/jobs/${jobId}`);
    snapshot = poll.json;
    if (snapshot.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(snapshot.status, 'done', snapshot.error || '');
  assert.ok(snapshot.project, 'snapshot bez projektu');
  assert.ok(snapshot.projectId, 'projekt nie został zapisany w bibliotece');

  const library = await getJson('/api/library');
  assert.ok(library.json.projects.some((p) => p.id === snapshot.projectId), 'brak projektu w bibliotece');

  const opened = await getJson(`/api/library/${snapshot.projectId}`);
  assert.equal(opened.json.project.files.length, snapshot.project.files.length);
  assert.equal(opened.json.validation.errors.length, 0);

  const versions = await getJson(`/api/versions/${snapshot.projectId}/0`);
  assert.ok(versions.json.project.files.length > 0);

  const deleted = await getJson(`/api/library/${snapshot.projectId}/delete`, { method: 'POST' });
  assert.equal(deleted.json.deleted, true);

  const missing = await fetch(`${base}/api/library/${snapshot.projectId}`);
  assert.equal(missing.status, 404);
});

await test('GET /api/jobs/:id/stream (SSE) w trybie demo emituje zdarzenia i projekt', async () => {
  const start = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idea: 'obby', options: { demo: true, demoId: 'obby' }, config: {} }),
  });
  const { jobId } = await start.json();
  const res = await fetch(`${base}/api/jobs/${jobId}/stream`);
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
  assert.ok(projectEvent.project.files.length >= 6);
  assert.ok(events.some((e) => e.type === 'end'));
});

await test('POST /api/refine bez klucza API zwraca błąd w zadaniu (nie wywala serwera)', async () => {
  const start = await getJson('/api/refine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: sampleProject, instruction: 'dodaj sklep', config: { provider: 'openai', model: 'gpt-4.1-mini', apiKey: '' } }),
  });
  const jobId = start.json.jobId;
  assert.ok(jobId);
  let snapshot = null;
  for (let i = 0; i < 80; i++) {
    snapshot = (await getJson(`/api/jobs/${jobId}`)).json;
    if (snapshot.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(snapshot.status, 'error');
  assert.match(snapshot.error, /klucz API/i);
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
section('16. CLI – eksport offline do katalogu');

await test('npm run demo:export produkuje kompletny zestaw plików', async () => {
  const { execFileSync } = await import('node:child_process');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbxai-'));
  execFileSync(process.execPath, [
    path.join(import.meta.dirname, '..', 'server', 'cli.js'),
    '--demo', 'obby',
    '--out', outDir,
    '--formats', 'zip,rbxmx,place,plugin,rojo',
    '--quiet',
  ], { stdio: 'pipe' });

  const listing = fs.readdirSync(outDir).sort();
  const zipName = listing.find((f) => f.endsWith('-rojo.zip'));
  assert.ok(zipName, `brak ZIP-a (jest: ${listing.join(', ')})`);
  assert.ok(listing.includes('neon-skyway-obby.rbxmx'), `brak .rbxmx (jest: ${listing.join(', ')})`);
  assert.ok(listing.includes('neon-skyway-obby.rbxlx'), 'brak .rbxlx (miejsce)');
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
fs.rmSync(TEST_LIBRARY, { recursive: true, force: true });

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
