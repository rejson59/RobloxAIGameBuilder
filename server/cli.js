#!/usr/bin/env node
/**
 * Roblox AI Game Builder – CLI.
 *
 * Przykłady:
 *   node server/cli.js --demo obby --out examples/sky-parkour-obby
 *   node server/cli.js --demo td --formats zip,rbxmx,plugin,rojo --out examples/td
 *   OPENAI_API_KEY=sk-... node server/cli.js --idea "gra o sklepie z petardami" --out myshop \
 *        --provider openai --model gpt-4.1-mini --scale standard
 *
 * Flagi:
 *   --idea <tekst>        opis gry (albo --idea-file <plik>)
 *   --demo <id>           tryb offline: obby | td | arena (bez klucza API)
 *   --out <katalog>       gdzie zapisać pliki (domyślnie ./ai-game)
 *   --formats <lista>     zip,rbxmx,plugin,rojo (domyślnie zip,rbxmx,plugin)
 *   --provider <id>       openai | anthropic | google | openrouter | deepseek | groq | mistral | xai | ollama | custom
 *   --model <nazwa>
 *   --base-url <url>      dla --provider custom
 *   --api-key <klucz>     (albo zmienna środowiskowa, patrz niżej)
 *   --scale <quick|standard|epic>
 *   --language <pl|en>    język tekstów w grze
 *   --must-have <lista>   np. "sklep,ranking" (rozdzielone przecinkami)
 *   --quiet               tylko najważniejsze komunikaty
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { generateGame } from './pipeline.js';
import { exportAs, assembleFiles, projectSlug } from './exporters.js';
import { validateProject } from './validate.js';

const API_KEY_ENV = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  custom: 'AI_API_KEY',
};

function parseArgs(argv) {
  const args = { formats: 'zip,rbxmx,place,plugin,rojo' };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'quiet' || key === 'help' || key === 'h') {
      args[key === 'h' ? 'help' : key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) continue;
    args[key] = value;
    i++;
  }
  return args;
}

const HELP = `Roblox AI Game Builder – generator gier Roblox (Luau) z opisu w języku naturalnym.

Użycie:
  node server/cli.js --idea "opis gry" --out folder [opcje]
  node server/cli.js --demo obby --out folder [opcje]

Opcje:
  --idea <tekst>       opis gry (w cudzysłowie)
  --idea-file <plik>   wczytaj opis z pliku
  --demo <id>          obby | td | arena (offline, bez klucza API)
  --out <katalog>      katalog docelowy (domyślnie ./ai-game)
  --formats <lista>    zip,rbxmx,plugin,rojo (domyślnie wszystkie)
  --provider <id>      openai | anthropic | google | openrouter | deepseek | groq | mistral | xai | ollama | custom
  --model <nazwa>      np. gpt-4.1-mini, claude-sonnet-4-5, gemini-2.5-flash
  --base-url <url>     własny endpoint (OpenAI-compatible)
  --api-key <klucz>    klucz API (albo zmienna środowiskowa OPENAI_API_KEY itd.)
  --scale <skala>      quick | standard | epic
  --language <kod>     pl | en (język tekstów w grze)
  --must-have <lista>  wymagane elementy, np. "sklep,ranking"
  --quiet              mniej logów

Przykłady:
  node server/cli.js --demo td --out examples/tower-defense
  OPENAI_API_KEY=sk-xxx node server/cli.js --idea "parkour nad lawą dla 2 graczy" --out moj-obby
  node server/cli.js --idea-file pomysl.txt --provider ollama --model qwen2.5-coder:14b --out gra
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const provider = args.provider || 'openai';
  const apiKey = args['api-key'] || process.env[API_KEY_ENV[provider] || 'AI_API_KEY'] || process.env.AI_API_KEY || '';
  const model = args.model || '';
  const outDir = path.resolve(args.out || 'ai-game');
  const quiet = Boolean(args.quiet);

  const idea = args.demo
    ? String(args.demo)
    : (args.idea || (args['idea-file'] ? fs.readFileSync(path.resolve(args['idea-file']), 'utf8').trim() : ''));

  if (!idea) {
    console.error('Brak opisu gry. Użyj --idea "..." albo --demo obby|td|arena.\n');
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  if (!args.demo && !model) {
    console.error('Brak --model. Przykład: --provider openai --model gpt-4.1-mini');
    process.exitCode = 1;
    return;
  }

  if (!args.demo && !apiKey && provider !== 'ollama' && provider !== 'custom') {
    console.error(`Brak klucza API. Ustaw ${API_KEY_ENV[provider] || 'AI_API_KEY'} albo podaj --api-key.`);
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  const log = (message) => {
    if (!quiet) console.log(message);
  };

  log(`\n  Roblox AI Game Builder`);
  log(`  Tryb: ${args.demo ? `demo (${idea})` : `${provider} / ${model}`}`);
  log(`  Katalog docelowy: ${outDir}\n`);

  const project = await generateGame({
    idea,
    options: {
      demo: Boolean(args.demo),
      demoId: args.demo,
      scale: args.scale || 'standard',
      language: args.language || 'pl',
      mustHave: args['must-have'] ? String(args['must-have']).split(',').map((s) => s.trim()).filter(Boolean) : [],
    },
    config: { provider, apiKey, model, baseUrl: args['base-url'] || '' },
    onEvent: (event) => {
      if (event.type === 'stage') log(`  → ${event.message}`);
      else if (event.type === 'plan') log(`  → ${event.message}`);
      else if (event.type === 'warn') log(`  ! ${event.message}`);
    },
  });

  const validation = project.validation || validateProject(project);
  const files = assembleFiles(project);

  fs.mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const target = path.join(outDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }

  const formats = String(args.formats || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const written = [];
  const slug = projectSlug(project);

  for (const format of formats) {
    if (format === 'rojo') continue; // pliki Rojo są już zapisane na dysku
    const { filename, body } = exportAs(project, format);
    fs.writeFileSync(path.join(outDir, filename), body);
    written.push(filename);
  }
  if (formats.includes('zip')) {
    const { filename, body } = exportAs(project, 'zip');
    fs.writeFileSync(path.join(outDir, filename), body);
    written.push(filename);
  }

  if (!quiet) {
    log(`\n  Projekt: ${project.name}`);
    log(`  Pliki Luau: ${validation.stats.files} (${validation.stats.lines} linii)`);
    log(`  Instancje świata: ${validation.stats.worldNodes}`);
    if (project.usage && project.usage.calls) {
      log(`  Wywołania modelu: ${project.usage.calls} (tokeny: ${project.usage.inputTokens} in / ${project.usage.outputTokens} out)`);
    }
    log(`  Czas: ${((Date.now() - started) / 1000).toFixed(1)} s`);
    if (validation.warnings.length) {
      log(`\n  Ostrzeżenia (${validation.warnings.length}):`);
      for (const warning of validation.warnings.slice(0, 10)) log(`   - ${warning}`);
    }
    log(`\n  Zapisano w: ${outDir}`);
    log(`  Otwórz Studio → nowy Baseplate → przeciągnij ${slug}.rbxmx, albo użyj Rojo: rojo serve`);
    log(`  Wtyczka: ${slug}.plugin.luau (Plugins → Plugins Folder)\n`);
  }
}

main().catch((err) => {
  console.error(`\n  Błąd: ${err.message}`);
  if (err.detail) console.error(`  Szczegóły: ${String(err.detail).slice(0, 800)}`);
  process.exitCode = 1;
});
