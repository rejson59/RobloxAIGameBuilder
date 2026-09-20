/**
 * Generation pipeline: idea -> design -> world skeleton -> file plan -> Luau code.
 *
 * Files are written in dependency order across several model calls so that
 * large projects do not hit the output-token ceiling of a single response:
 *   shared interfaces -> server modules -> bootstrap wiring -> client.
 */
import { chat, ProviderError } from './providers.js';
import {
  DESIGN_SYSTEM, PLAN_SYSTEM, SCRIPTS_SYSTEM, WORLD_SYSTEM,
  designPrompt, planPrompt, repairPrompt, scriptsPrompt, worldPrompt,
} from './prompts.js';
import { parseJsonLoose } from './util.js';
import { normalisePath, isValidPath, validateProject } from './validate.js';
import { getDemo } from './games.js';

const SCALE_PRESETS = {
  quick: { files: '4-6', batches: 1, modelHint: 'mały projekt na jeden raz' },
  standard: { files: '7-11', batches: 3, modelHint: 'pełny, grywalny projekt' },
  epic: { files: '12-18', batches: 6, modelHint: 'duży, rozbudowany projekt' },
};

class CancelledError extends Error {
  constructor() { super('Generowanie przerwane przez użytkownika.'); this.name = 'CancelledError'; }
}

function assertNotCancelled(signal) {
  if (signal?.aborted) throw new CancelledError();
}

/* ------------------------------------------------------------------ *
 * Model call with JSON parsing + one repair round-trip
 * ------------------------------------------------------------------ */
async function callJson({ config, system, user, maxTokens, temperature = 0.6, onEvent, signal, stage, label }) {
  assertNotCancelled(signal);
  const messages = [{ role: 'user', content: user }];
  let usage = { inputTokens: 0, outputTokens: 0 };
  let text = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    onEvent?.({ type: 'stage', stage, message: attempt === 0 ? label : `${label} (poprawianie formatu JSON)` });
    const res = await chat({
      provider: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      system,
      messages,
      maxTokens,
      temperature,
      jsonMode: true,
      signal,
    });
    text = res.text;
    usage.inputTokens += res.usage?.inputTokens || 0;
    usage.outputTokens += res.usage?.outputTokens || 0;
    try {
      const parsed = parseJsonLoose(text);
      return { data: parsed, usage, raw: text };
    } catch (err) {
      if (attempt === 1) {
        throw new ProviderError(`Model nie zwrócił poprawnego JSON-a w etapie "${stage}". ${err.message}`, { detail: text.slice(-500) });
      }
      messages.push({ role: 'assistant', content: text.slice(0, 30000) });
      messages.push({ role: 'user', content: repairPrompt(text, err.message) });
    }
  }
  /* istanbul ignore next */
  throw new Error('unreachable');
}

/* ------------------------------------------------------------------ *
 * Batching
 * ------------------------------------------------------------------ */
const KIND_ORDER = (file) => {
  if (file.path.startsWith('src/shared/')) return 0;
  if (file.kind === 'module' && file.path.startsWith('src/server/')) return 1;
  if (/bootstrap|init|main/i.test(file.path)) return 2;
  if (file.kind === 'server') return 3;
  if (file.kind === 'client') return 4;
  return 5;
};

export function planBatches(planFiles, batchCount) {
  const sorted = [...planFiles].sort((a, b) => KIND_ORDER(a) - KIND_ORDER(b));
  const count = Math.max(1, Math.min(batchCount, sorted.length));
  const batches = [];
  const per = Math.ceil(sorted.length / count);
  for (let i = 0; i < sorted.length; i += per) {
    const group = sorted.slice(i, i + per);
    batches.push({
      files: group.map((f) => f.path),
      reason: describeGroup(group),
    });
  }
  return batches;
}

function describeGroup(group) {
  const kinds = new Set(group.map((f) => f.kind));
  if (kinds.size === 1 && kinds.has('shared')) return 'Fundament: konfiguracja i współdzielone moduły (na nich polegają pozostałe pliki).';
  if (kinds.has('server') && kinds.has('shared')) return 'Warstwa serwerowa: autorytatywna logika gry.';
  if (kinds.size === 1 && kinds.has('client')) return 'Warstwa kliencka: sterowanie, HUD, efekty.';
  return 'Kolejne moduły projektu.';
}

/* ------------------------------------------------------------------ *
 * Main entry
 * ------------------------------------------------------------------ */
export async function generateGame({ idea, options = {}, config, onEvent, signal }) {
  const started = Date.now();
  const scale = SCALE_PRESETS[options.scale] ? options.scale : 'standard';
  const preset = SCALE_PRESETS[scale];
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const addUsage = (u) => {
    usage.inputTokens += u?.inputTokens || 0;
    usage.outputTokens += u?.outputTokens || 0;
    usage.calls++;
  };
  const emit = (event) => onEvent?.({ ...event, elapsedMs: Date.now() - started });

  if (options.demo) {
    emit({ type: 'stage', stage: 'demo', message: 'Tryb offline: buduję gotowy projekt demo (bez użycia klucza API).' });
    const demo = getDemo(options.demoId || idea || 'obby');
    const validation = validateProject(demo);
    emit({ type: 'done', message: 'Projekt demo gotowy.', stats: validation.stats });
    return { ...demo, validation, usage, demo: true };
  }

  /* 1. Design ------------------------------------------------------ */
  const design = await callJson({
    config, system: DESIGN_SYSTEM, stage: 'design', label: 'Projektuję grę (mechaniki, balans, dokumentacja)...',
    user: designPrompt(idea, { ...options, scale: preset.modelHint }),
    maxTokens: 8192, temperature: 0.8, onEvent: emit, signal,
  });
  addUsage(design.usage);
  const designData = design.data;

  /* 2. World ------------------------------------------------------- */
  const world = await callJson({
    config, system: WORLD_SYSTEM, stage: 'world', label: 'Buduję szkielet mapy (części, spawn, oświetlenie)...',
    user: worldPrompt(designData, options),
    maxTokens: 8192, temperature: 0.5, onEvent: emit, signal,
  });
  addUsage(world.usage);

  /* 3. File plan --------------------------------------------------- */
  const plan = await callJson({
    config, system: PLAN_SYSTEM, stage: 'plan', label: 'Planuję architekturę plików Luau...',
    user: planPrompt(designData, world.data, { ...options, scale }),
    maxTokens: 6144, temperature: 0.4, onEvent: emit, signal,
  });
  addUsage(plan.usage);

  let plannedFiles = Array.isArray(plan.data?.files) ? plan.data.files : [];
  plannedFiles = plannedFiles
    .map((f) => ({ ...f, path: normalisePath(f.path) }))
    .filter((f) => {
      const ok = isValidPath(f.path);
      if (!ok) emit({ type: 'warn', message: `Pominięto plik o niedozwolonej ścieżce: ${f.path}` });
      return ok;
    });
  if (!plannedFiles.length) {
    throw new ProviderError('Model nie zaplanował żadnego poprawnego pliku Luau. Spróbuj ponownie lub użyj mocniejszego modelu.');
  }

  const batches = planBatches(plannedFiles, preset.batches);
  emit({ type: 'plan', message: `Plan gotowy: ${plannedFiles.length} plików w ${batches.length} paczkach.`, plan: { files: plannedFiles, architecture: plan.data.architecture, remoteEvents: plan.data.remoteEvents } });

  /* 4. Code -------------------------------------------------------- */
  const files = [];
  const notes = [];
  const failedBatches = [];

  for (let i = 0; i < batches.length; i++) {
    assertNotCancelled(signal);
    const batch = batches[i];
    emit({
      type: 'stage', stage: 'code', batchIndex: i, batchCount: batches.length,
      progress: i / batches.length,
      message: `Piszę kod (${i + 1}/${batches.length}): ${batch.files.map((f) => f.split('/').pop()).join(', ')}...`,
    });
    try {
      const out = await callJson({
        config,
        system: SCRIPTS_SYSTEM,
        stage: 'code',
        label: `Piszę kod paczki ${i + 1}/${batches.length} (${batch.reason})`,
        user: scriptsPrompt({
          design: designData,
          plan: { ...plan.data, files: plannedFiles },
          batch,
          alreadyWritten: files.map((f) => f.path),
          batchIndex: i,
          batchCount: batches.length,
          language: options.language,
        }),
        maxTokens: 8192,
        temperature: 0.35,
        onEvent: emit,
        signal,
      });
      addUsage(out.usage);
      const produced = Array.isArray(out.data?.files) ? out.data.files : [];
      if (!produced.length) {
        failedBatches.push(batch.files.join(', '));
        emit({ type: 'warn', message: `Model nie zwrócił plików dla paczki ${i + 1} – pomijam.` });
        continue;
      }
      for (const file of produced) {
        const path = normalisePath(file.path);
        if (!isValidPath(path)) {
          emit({ type: 'warn', message: `Pominięto wygenerowany plik o złej ścieżce: ${file.path}` });
          continue;
        }
        const content = typeof file.content === 'string' ? file.content : String(file.content ?? '');
        if (!content.trim()) {
          emit({ type: 'warn', message: `Pusty plik ${path} – pomijam.` });
          continue;
        }
        const existing = files.findIndex((f) => f.path === path);
        if (existing >= 0) files[existing] = { path, content };
        else files.push({ path, content });
      }
      if (Array.isArray(out.data?.notes)) notes.push(...out.data.notes.map((n) => `[${i + 1}] ${n}`));
      emit({ type: 'files', message: `Gotowe: ${files.length} plików.`, files: files.map((f) => f.path) });
    } catch (err) {
      if (err instanceof CancelledError || signal?.aborted) throw err;
      failedBatches.push(batch.files.join(', '));
      emit({ type: 'warn', message: `Paczka ${i + 1} nie udała się: ${err.message}` });
    }
  }

  if (!files.length) {
    throw new ProviderError('Model nie wygenerował żadnego pliku Luau. Zmień model (np. na mocniejszy) i spróbuj ponownie.');
  }

  /* 5. Assemble + validate ---------------------------------------- */
  const project = {
    name: designData.name || 'AI Game',
    tagline: designData.tagline || '',
    summary: designData.summary || '',
    genre: designData.genre || '',
    design: designData,
    plan: plan.data,
    world: world.data?.world ? { world: world.data.world, lighting: world.data.lighting || {} } : { world: { name: 'World', className: 'Folder', children: [] } },
    files,
    notes,
    usage,
    failedBatches,
    meta: { createdAt: new Date().toISOString(), scale, provider: config.provider, model: config.model, idea },
  };

  const validation = validateProject(project);
  project.validation = validation;
  emit({ type: 'done', message: 'Projekt gotowy.', stats: validation.stats, warnings: validation.warnings, errors: validation.errors });
  return project;
}

export { SCALE_PRESETS, CancelledError, describeGroup };
