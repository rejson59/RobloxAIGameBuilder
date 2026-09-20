/**
 * Async job queue for generation and refinement.
 *
 * The web UI subscribes over SSE (`GET /api/jobs/:id/stream`), while the
 * Roblox Studio plugin polls (`GET /api/jobs/:id`) because HttpService cannot
 * read a stream. Both see exactly the same events and progress.
 */
import { generateGame, refineProject } from './pipeline.js';
import { saveProject } from './projects.js';

const jobs = new Map();
const HISTORY_LIMIT = 40;

const STAGE_PROGRESS = {
  demo: 0.2,
  design: 0.14,
  world: 0.3,
  plan: 0.42,
  code: 0.5,
  repair: 0.88,
  refine: 0.3,
};

function makeId() {
  return `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function computeProgress(job) {
  const event = job.events[job.events.length - 1];
  if (!event) return 0.03;
  if (job.status === 'done') return 1;
  if (event.type === 'stage' && event.stage === 'code' && typeof event.batchIndex === 'number' && event.batchCount) {
    return 0.42 + 0.46 * (event.batchIndex / event.batchCount);
  }
  if (event.type === 'plan') return 0.42;
  if (event.type === 'files') return 0.8;
  return STAGE_PROGRESS[event.stage] ?? job.progress;
}

function broadcast(job, payload) {
  for (const res of job.subscribers) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function emit(job, event) {
  const enriched = { ...event, at: Date.now() };
  job.events.push(enriched);
  if (job.events.length > 500) job.events.splice(0, 200);
  job.progress = computeProgress(job);
  if (!job.subscribers.size) return;
  broadcast(job, enriched);
}

/** Zapisuje gotowy projekt w bibliotece (raz na zadanie) i zwraca jego id. */
function persistResult(job) {
  if (job.projectId || !job.result) return job.projectId;
  try {
    const { id, revision } = saveProject(job.result, {
      id: job.result.projectId,
      note: job.type === 'refine' ? 'zmiana przez AI' : 'generowanie',
    });
    job.projectId = id;
    job.revision = revision;
    job.result.projectId = id;
    job.result.revision = revision;
  } catch (err) {
    job.saveError = err.message;
    console.warn(`[library] zapis nie udał się: ${err.message}`);
  }
  return job.projectId;
}

function trimHistory() {
  if (jobs.size <= HISTORY_LIMIT) return;
  const sorted = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const job of sorted.slice(0, jobs.size - HISTORY_LIMIT)) {
    if (job.status !== 'running') jobs.delete(job.id);
  }
}

export function startJob(payload = {}) {
  const job = {
    id: makeId(),
    type: payload.type === 'refine' ? 'refine' : 'generate',
    label: String(payload.idea || payload.instruction || 'generowanie').slice(0, 120),
    status: 'running',
    progress: 0.03,
    events: [],
    result: null,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    controller: new AbortController(),
    subscribers: new Set(),
  };
  jobs.set(job.id, job);
  trimHistory();

  const onEvent = (event) => emit(job, event);

  (async () => {
    try {
      const project = job.type === 'refine'
        ? await refineProject({
          project: payload.project,
          instruction: payload.instruction,
          config: payload.config,
          options: payload.options,
          onEvent,
          signal: job.controller.signal,
        })
        : await generateGame({
          idea: payload.idea,
          options: payload.options || {},
          config: payload.config || {},
          onEvent,
          signal: job.controller.signal,
        });
      job.result = project;
      job.status = 'done';
      const projectId = persistResult(job);
      emit(job, { type: 'done', message: 'Gotowe.', stats: project.validation?.stats, auditScore: job.result?.audit?.score });
      // Projekt wysyłamy osobno, po "done": UI i wtyczka dostają go w tym samym strumieniu.
      emit(job, { type: 'project', project, projectId: projectId || null, revision: job.revision || null, saved: Boolean(projectId) });
    } catch (err) {
      const aborted = job.controller.signal.aborted || err?.name === 'CancelledError';
      job.status = aborted ? 'cancelled' : 'error';
      job.error = aborted ? 'Anulowano.' : (err?.message || 'Nieznany błąd.');
      emit(job, {
        type: 'error',
        aborted,
        message: job.error,
        detail: err?.detail || '',
        status: err?.status || 0,
      });
    } finally {
      job.finishedAt = Date.now();
      job.progress = job.status === 'done' ? 1 : job.progress;
      for (const res of job.subscribers) {
        if (!res.writableEnded) {
          broadcast(job, { type: 'end', status: job.status });
          res.end();
        }
      }
      job.subscribers.clear();
    }
  })();

  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

/** Compact view for polling clients (the Studio plugin). */
export function jobSnapshot(job, { includeProject = true } = {}) {
  if (!job) return null;
  const last = job.events[job.events.length - 1] || null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: Number(job.progress.toFixed(3)),
    label: job.label,
    message: last?.message || '',
    stage: last?.stage || '',
    events: job.events.slice(-40),
    error: job.error,
    elapsedMs: (job.finishedAt || Date.now()) - job.createdAt,
    projectId: job.projectId || null,
    revision: job.revision || null,
    saved: Boolean(job.projectId),
    saveError: job.saveError || null,
    project: includeProject && job.status === 'done' ? job.result : undefined,
  };
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'running') job.controller.abort();
  return true;
}

/** Attach an SSE response to a job: replays history, then streams live. */
export function subscribeJob(job, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`data: ${JSON.stringify({ type: 'open', jobId: job.id, jobType: job.type })}\n\n`);
  for (const event of job.events) {
    if (event.type === 'project') continue; // the result comes at the end
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (job.status !== 'running') {
    if (job.status === 'done' && job.result) {
      res.write(`data: ${JSON.stringify({ type: 'project', project: job.result, projectId: job.projectId || null, revision: job.revision || null, saved: Boolean(job.projectId) })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'end', status: job.status })}\n\n`);
    res.end();
    return;
  }
  job.subscribers.add(res);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(`: ping\n\n`);
  }, 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    job.subscribers.delete(res);
  });
}

export function listJobs() {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((job) => ({ id: job.id, type: job.type, status: job.status, label: job.label, createdAt: job.createdAt }));
}

export function runningJobs() {
  return [...jobs.values()].filter((job) => job.status === 'running').length;
}
