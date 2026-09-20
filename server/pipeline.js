/**
 * Generation pipeline: idea -> design -> world skeleton -> file plan -> Luau code.
 *
 * Files are written in dependency order across several model calls so that
 * large projects do not hit the output-token ceiling of a single response:
 *   shared interfaces -> server modules -> bootstrap wiring -> client.
 */
import { chat, chatStream, ProviderError } from './providers.js';
import { CostTracker, budgetFor, formatUsd } from './pricing.js';
import { auditProject } from './audit.js';
import {
  DESIGN_SYSTEM, PLAN_SYSTEM, REFINE_SYSTEM, REPAIR_SYSTEM, SCRIPTS_SYSTEM, WORLD_SYSTEM,
  designPrompt, planPrompt, refinePrompt, repairFilesPrompt, repairPrompt, scriptsPrompt, worldPrompt,
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
  const wantStream = config.stream !== false && config.provider !== 'demo';

  for (let attempt = 0; attempt < 2; attempt++) {
    onEvent?.({ type: 'stage', stage, message: attempt === 0 ? label : `${label} (poprawianie formatu JSON)` });

    // Podgląd na żywo: strumień modelu trafia do UI jako zdarzenia "delta".
    let lastDeltaAt = 0;
    const onDelta = wantStream
      ? (_piece, full) => {
        const now = Date.now();
        if (now - lastDeltaAt < 450 && full.length < 200000) return;
        lastDeltaAt = now;
        onEvent?.({ type: 'delta', stage, chars: full.length, tail: full.slice(-320), streaming: true });
      }
      : undefined;

    let res;
    try {
      res = wantStream
        ? await chatStream({
          provider: config.provider,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          system,
          messages,
          maxTokens,
          temperature,
          signal,
          onDelta,
        })
        : await chat({
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
    } catch (err) {
      // Strumień bywa blokowany przez bramki – wtedy wracamy do zwykłego zapytania.
      if (wantStream && err instanceof ProviderError && err.status && err.status >= 400 && err.status < 500) {
        onEvent?.({ type: 'warn', message: 'Strumieniowanie niedostępne u tego dostawcy – przechodzę na zwykłe zapytanie.' });
        res = await chat({
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
      } else {
        throw err;
      }
    }
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
  const budget = budgetFor(options);
  const tracker = new CostTracker({ provider: config?.provider, model: config?.model, budget });
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0, usd: 0 };
  const addUsage = (u) => {
    usage.inputTokens += u?.inputTokens || 0;
    usage.outputTokens += u?.outputTokens || 0;
    usage.calls++;
    // Koszt liczymy po każdej odpowiedzi modelu – dzięki temu budżet działa w trakcie.
    const { total } = tracker.add(u || {});
    usage.usd = Number(total.toFixed(6));
    usage.rate = tracker.rate;
  };
  const emit = (event) => onEvent?.({ ...event, elapsedMs: Date.now() - started });

  if (options.demo) {
    emit({ type: 'stage', stage: 'demo', message: 'Tryb offline: buduję gotowy projekt demo (bez użycia klucza API).' });
    const demo = getDemo(options.demoId || idea || 'obby');
    const validation = validateProject(demo);
    const demoProject = { ...demo, validation, usage, demo: true };
    demoProject.audit = auditProject(demoProject);
    emit({ type: 'done', message: 'Projekt demo gotowy.', stats: validation.stats, auditScore: demoProject.audit.score });
    return demoProject;
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
    cost: tracker.snapshot(),
    failedBatches,
    meta: { createdAt: new Date().toISOString(), scale, provider: config.provider, model: config.model, idea },
  };

  project.validation = validateProject(project);
  const repaired = await autoRepairProject(project, config, {
    onEvent: emit, signal, tracker,
    maxRounds: options.autoRepair === false ? 0 : 2,
  });
  project.validation = repaired.validation;
  project.repairs = repaired.rounds;
  project.usage = tracker.snapshot();
  project.cost = tracker.snapshot();
  project.audit = auditProject(project);
  emit({
    type: 'done',
    message: repaired.rounds ? `Projekt gotowy (auto-naprawa: ${repaired.rounds} runda/y).` : 'Projekt gotowy.',
    stats: project.validation.stats,
    warnings: project.validation.warnings,
    errors: project.validation.errors,
    auditScore: project.audit.score,
    cost: project.cost,
    costLabel: formatUsd(project.cost.usd),
  });
  if (project.audit.counts.errors) {
    emit({ type: 'warn', message: `Audyt projektu: ${project.audit.summary}` });
  }
  return project;
}

/* ------------------------------------------------------------------ *
 * Auto-naprawa: walidator wskazuje błędy, model poprawia pliki.
 * Pętla kończy się, gdy walidacja jest czysta (albo po maxRounds).
 * ------------------------------------------------------------------ */
export async function autoRepairProject(project, config, { onEvent, signal, maxRounds = 2, tracker = null } = {}) {
  let validation = project.validation || validateProject(project);
  if (maxRounds <= 0 || !validation.errors.length) return { validation, rounds: 0 };

  const usage = project.usage || (project.usage = { inputTokens: 0, outputTokens: 0, calls: 0 });

  for (let round = 1; round <= maxRounds; round++) {
    assertNotCancelled(signal);
    const targets = [...new Set(validation.errors.map((entry) => String(entry).split(':')[0]))]
      .filter((filePath) => project.files.some((file) => file.path === filePath));
    if (!targets.length) break;

    onEvent?.({
      type: 'stage',
      stage: 'repair',
      message: `Naprawiam ${validation.errors.length} błędów (runda ${round}/${maxRounds}): ${targets.map((t) => t.split('/').pop()).join(', ')}`,
    });

    try {
      const brokenFiles = project.files.filter((file) => targets.includes(file.path));
      const out = await callJson({
        config,
        system: REPAIR_SYSTEM,
        stage: 'repair',
        label: `Poprawiam kod (runda ${round})`,
        user: repairFilesPrompt({ project, brokenFiles, issues: validation.errors.slice(0, 25) }),
        maxTokens: 8192,
        temperature: 0.2,
        onEvent,
        signal,
      });
      usage.inputTokens += out.usage.inputTokens;
      usage.outputTokens += out.usage.outputTokens;
      usage.calls++;
      if (tracker) {
        const { total } = tracker.add(out.usage);
        usage.usd = Number(total.toFixed(6));
        usage.rate = tracker.rate;
      }

      const produced = Array.isArray(out.data?.files) ? out.data.files : [];
      let changed = 0;
      for (const file of produced) {
        const filePath = normalisePath(file.path);
        const index = project.files.findIndex((f) => f.path === filePath);
        const content = typeof file.content === 'string' ? file.content : '';
        if (index >= 0 && content.trim() && !isValidPath(filePath)) continue;
        if (index >= 0 && content.trim()) {
          project.files[index] = { path: filePath, content };
          changed++;
        }
      }
      validation = validateProject(project);
      onEvent?.({
        type: changed ? 'warn' : 'warn',
        message: changed
          ? `Auto-naprawa: zaktualizowano ${changed} plik(ów), pozostało błędów: ${validation.errors.length}.`
          : 'Auto-naprawa: model nie zwrócił poprawnych plików.',
      });
      if (!validation.errors.length) break;
    } catch (err) {
      if (err instanceof CancelledError || signal?.aborted) throw err;
      onEvent?.({ type: 'warn', message: `Auto-naprawa nie udała się: ${err.message}` });
      break;
    }
  }
  return { validation, rounds: maxRounds };
}

/* ------------------------------------------------------------------ *
 * Dopracowanie istniejącego projektu ("poproś o zmianę").
 * Model zwraca tylko zmienione/nowe pliki; reszta zostaje nietknięta.
 * ------------------------------------------------------------------ */
export async function refineProject({ project, instruction, config, options = {}, onEvent, signal }) {
  if (!project || !Array.isArray(project.files) || !project.files.length) {
    throw new ProviderError('Brak projektu do dopracowania.');
  }
  if (!String(instruction || '').trim()) {
    throw new ProviderError('Opisz, co chcesz zmienić (np. "dodaj sklep i ranking graczy").');
  }
  const usage = project.usage || (project.usage = { inputTokens: 0, outputTokens: 0, calls: 0 });
  const tracker = new CostTracker({
    provider: config?.provider,
    model: config?.model,
    budget: budgetFor(options),
  });
  const emit = (event) => onEvent?.(event);

  emit({ type: 'stage', stage: 'refine', message: `Wprowadzam zmianę: ${String(instruction).slice(0, 120)}` });

  const out = await callJson({
    config,
    system: REFINE_SYSTEM,
    stage: 'refine',
    label: 'Przepisuję zmienione pliki...',
    user: refinePrompt({ project, instruction, options }),
    maxTokens: 8192,
    temperature: 0.4,
    jsonMode: true,
    onEvent,
    signal,
  });
  usage.inputTokens += out.usage.inputTokens;
  usage.outputTokens += out.usage.outputTokens;
  usage.calls++;
  tracker.add(out.usage);

  const changed = [];
  for (const file of out.data?.files || []) {
    const filePath = normalisePath(file.path);
    const content = typeof file.content === 'string' ? file.content : '';
    if (!content.trim()) continue;
    if (!isValidPath(filePath)) {
      emit({ type: 'warn', message: `Pominięto plik o niedozwolonej ścieżce: ${file.path}` });
      continue;
    }
    const index = project.files.findIndex((f) => f.path === filePath);
    if (index >= 0) project.files[index] = { path: filePath, content };
    else project.files.push({ path: filePath, content });
    changed.push(filePath);
  }

  for (const removedPath of out.data?.removed || []) {
    const filePath = normalisePath(removedPath);
    const index = project.files.findIndex((f) => f.path === filePath);
    if (index >= 0) {
      project.files.splice(index, 1);
      changed.push(`-${filePath}`);
    }
  }

  if (!changed.length) {
    emit({ type: 'warn', message: 'Model nie zmienił żadnego pliku — spróbuj opisać zmianę inaczej.' });
  } else {
    emit({ type: 'files', message: `Zmienione pliki: ${changed.join(', ')}`, files: project.files.map((f) => f.path) });
  }

  project.notes = [...(project.notes || []), ...(out.data?.notes || []).map((n) => `[zmiana] ${n}`)];
  if (out.data?.summary) project.refinements = [...(project.refinements || []), { at: new Date().toISOString(), instruction, summary: out.data.summary }];

  const repaired = await autoRepairProject(project, config, { onEvent: emit, signal, maxRounds: 2, tracker });
  project.validation = repaired.validation;
  project.usage = tracker.snapshot();
  project.cost = tracker.snapshot();
  project.audit = auditProject(project);
  emit({
    type: 'done',
    message: out.data?.summary ? `Zmiana gotowa: ${out.data.summary}` : 'Zmiana gotowa.',
    stats: project.validation.stats,
    auditScore: project.audit.score,
    costLabel: formatUsd(project.cost.usd),
  });
  return project;
}

export { callJson };

export { SCALE_PRESETS, CancelledError, describeGroup };
