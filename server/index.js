/**
 * Roblox AI Game Builder – local web app + Studio bridge server.
 * Zero dependencies: node:http + node:fs only.
 *
 *   npm start                -> http://localhost:5173
 *   PORT=8080 npm start
 *
 * Endpoints (see README):
 *   web UI  : /, /app.js, /styles.css, /thumbnail.js, /studio.js
 *   ai      : /api/generate, /api/refine, /api/validate, /api/test, /api/models
 *   jobs    : /api/jobs/:id (poll for the Studio plugin), /api/jobs/:id/stream (SSE)
 *   library : /api/library, /api/library/:id, /api/library/:id/import, /api/versions/:id/:index
 *   export  : /api/export (zip | rbxmx | plugin | rojo), /api/thumbnail (PNG 512)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chat, listModels, publicProviders, testConnection, ProviderError } from './providers.js';
import { getDemo, listDemos } from './games.js';
import { assembleFiles, buildZipBuffer, exportAs } from './exporters.js';
import { validateProject } from './validate.js';
import { startJob, getJob, jobSnapshot, cancelJob, subscribeJob, listJobs, runningJobs } from './jobs.js';
import {
  deleteProject, diffSince, listProjects, listVersions, loadProject, loadVersion,
  projectsDir, restoreVersion, saveFile, saveProject,
} from './projects.js';
import { renderThumbnail, thumbnailFilename } from './thumbnail.js';
import { auditProject } from './audit.js';
import { CATALOG, ASSET_NOTE, assetForTag, searchAssets, starterAssets, tagsUsedInProject } from './assets.js';
import { PRICING_NOTE, budgetFor, costOf, rateFor } from './pricing.js';
import { slugify } from './util.js';
import { buildPlugin } from './plugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = '2.0.0';
const MAX_BODY_BYTES = 96 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Expose-Headers': 'Content-Disposition, X-Export-Warnings, X-Project-Id',
};

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...CORS });
  res.end(body);
}

function sendBuffer(res, status, buffer, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    ...CORS,
    ...extraHeaders,
  });
  res.end(buffer);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Zapytanie jest za duże (limit 96 MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Nieprawidłowy JSON w zapytaniu: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeConfig(config = {}) {
  return {
    provider: String(config.provider || 'openai'),
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
    model: typeof config.model === 'string' ? config.model.trim() : '',
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '',
  };
}

/** Saves a freshly produced project in the library and returns its id. */
function persist(project, note) {
  try {
    const { id } = saveProject(project, { id: project.projectId, note });
    project.projectId = id;
    return id;
  } catch (err) {
    console.warn(`[library] nie udało się zapisać projektu: ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * static
 * ------------------------------------------------------------------ */
function serveStatic(res, urlPath, req) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Nieprawidłowa ścieżka.' });
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, html) => {
        if (fallbackErr) {
          sendJson(res, 404, { error: 'Nie znaleziono pliku.' });
          return;
        }
        sendBuffer(res, 200, html, MIME['.html']);
      });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      // Podczas pracy nad UI nie chcemy cache'owanych plików.
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
      ...CORS,
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */
async function handleApi(req, res, url) {
  const route = url.pathname;
  const query = url.searchParams;

  /* ---- meta ---- */
  if (req.method === 'GET' && route === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      node: process.version,
      demos: listDemos().length,
      projects: listProjects().length,
      runningJobs: runningJobs(),
      jobs: listJobs().slice(0, 10),
      libraryPath: projectsDir(),
      assets: CATALOG.length,
      budgetUsd: budgetFor({}),
    });
    return true;
  }

  if (req.method === 'GET' && route === '/api/providers') {
    sendJson(res, 200, { providers: publicProviders(), version: VERSION });
    return true;
  }

  if (req.method === 'GET' && route === '/api/demos') {
    sendJson(res, 200, { demos: listDemos() });
    return true;
  }

  /* ---- demo (offline, no API key) ---- */
  if (req.method === 'POST' && route === '/api/demo') {
    const body = await readBody(req);
    const demo = getDemo(body.id || 'obby');
    const validation = validateProject(demo);
    const project = { ...demo, validation, demo: true, usage: { inputTokens: 0, outputTokens: 0, calls: 0, usd: 0 } };
    project.audit = auditProject(project);
    const projectId = body.save === false ? null : persist(project, `demo ${demo.id}`);
    sendJson(res, 200, { project, projectId });
    return true;
  }

  /* ---- models / key test / raw chat ---- */
  if (req.method === 'POST' && route === '/api/models') {
    const body = await readBody(req);
    const config = sanitizeConfig(body.config || body);
    const models = await listModels({ provider: config.provider, apiKey: config.apiKey, baseUrl: config.baseUrl });
    sendJson(res, 200, { models });
    return true;
  }

  if (req.method === 'POST' && route === '/api/test') {
    const body = await readBody(req);
    const config = sanitizeConfig(body.config || body);
    try {
      const result = await testConnection(config);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      sendJson(res, 200, {
        ok: false,
        error: err instanceof ProviderError ? err.message : `Błąd: ${err.message}`,
        status: err.status || 0,
        detail: err.detail || '',
      });
    }
    return true;
  }

  if (req.method === 'POST' && route === '/api/chat') {
    const body = await readBody(req);
    const config = sanitizeConfig(body.config || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      sendJson(res, 400, { error: 'Brak wiadomości (messages).' });
      return true;
    }
    try {
      const out = await chat({ ...config, system: body.system || 'Jesteś pomocnym asystentem Robloxa.', messages, maxTokens: 4096, temperature: 0.4 });
      sendJson(res, 200, { reply: out.text, usage: out.usage });
    } catch (err) {
      sendJson(res, 200, { error: err.message, detail: err.detail || '' });
    }
    return true;
  }

  /* ---- validation ---- */
  if (req.method === 'POST' && route === '/api/validate') {
    const body = await readBody(req);
    if (!body.project) {
      sendJson(res, 400, { error: 'Brak projektu do walidacji.' });
      return true;
    }
    sendJson(res, 200, { validation: validateProject(body.project), audit: auditProject(body.project) });
    return true;
  }

  if (req.method === 'POST' && route === '/api/audit') {
    const body = await readBody(req);
    if (!body.project) {
      sendJson(res, 400, { error: 'Brak projektu do audytu.' });
      return true;
    }
    sendJson(res, 200, { audit: auditProject(body.project) });
    return true;
  }

  /* ---- katalog darmowych assetów i wycena kosztów ---- */
  if (req.method === 'GET' && route === '/api/assets') {
    const genre = query.get('genre') || '';
    const tags = searchAssets({ q: query.get('q') || '', kind: query.get('kind') || '', genre });
    sendJson(res, 200, {
      assets: tags,
      total: tags.length,
      catalogSize: CATALOG.length,
      starter: starterAssets(genre),
      note: ASSET_NOTE,
    });
    return true;
  }

  if (req.method === 'GET' && route === '/api/assets/used') {
    const projectId = query.get('project');
    const stored = projectId ? loadProject(projectId) : null;
    if (!stored) {
      sendJson(res, 404, { error: 'Nie ma takiego projektu.' });
      return true;
    }
    sendJson(res, 200, { tags: tagsUsedInProject(stored), note: ASSET_NOTE });
    return true;
  }

  if (req.method === 'GET' && route === '/api/pricing') {
    const provider = query.get('provider') || 'openai';
    const model = query.get('model') || '';
    sendJson(res, 200, {
      rate: rateFor(provider, model),
      example: costOf({ provider, model, inputTokens: 100000, outputTokens: 40000 }),
      budgetUsd: budgetFor({}),
      note: PRICING_NOTE,
    });
    return true;
  }

  /* ---- jobs (generation + refine) ---- */
  if (req.method === 'POST' && route === '/api/generate') {
    const body = await readBody(req);
    const job = startJob({
      type: 'generate',
      idea: String(body.idea || ''),
      options: { ...(body.options || {}), demoId: body.options?.demoId || body.demoId },
      config: sanitizeConfig(body.config || {}),
    });
    sendJson(res, 200, { jobId: job.id, stream: `/api/jobs/${job.id}/stream` });
    return true;
  }

  if (req.method === 'POST' && route === '/api/refine') {
    const body = await readBody(req);
    if (!body.project) {
      sendJson(res, 400, { error: 'Brak projektu do dopracowania.' });
      return true;
    }
    const project = body.project.projectId ? (loadProject(body.project.projectId) || body.project) : body.project;
    const job = startJob({
      type: 'refine',
      instruction: String(body.instruction || ''),
      project,
      config: sanitizeConfig(body.config || {}),
      options: body.options || {},
    });
    sendJson(res, 200, { jobId: job.id, stream: `/api/jobs/${job.id}/stream` });
    return true;
  }

  const jobStreamMatch = route.match(/^\/api\/jobs\/([\w-]+)\/stream$/);
  if (req.method === 'GET' && jobStreamMatch) {
    const job = getJob(jobStreamMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: 'Nie ma takiego zadania (może już się zakończyło?).' });
      return true;
    }
    subscribeJob(job, res);
    return true;
  }

  const jobMatch = route.match(/^\/api\/jobs\/([\w-]+)$/);
  if (req.method === 'GET' && jobMatch) {
    const job = getJob(jobMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: 'Nie ma takiego zadania.' });
      return true;
    }
    const snapshot = jobSnapshot(job);
    // Zabezpieczenie: projekt zapisuje się raz, przy zakończeniu zadania (jobs.js).
    if (snapshot.status === 'done' && snapshot.project && !snapshot.projectId && query.get('save') !== 'false') {
      const projectId = persist(snapshot.project, job.type === 'refine' ? 'zmiana przez AI' : 'generowanie');
      snapshot.projectId = projectId;
      snapshot.project.projectId = projectId;
      snapshot.saved = Boolean(projectId);
      snapshot.revision = snapshot.project.revision || null;
    }
    sendJson(res, 200, snapshot);
    return true;
  }

  const jobCancelMatch = route.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
  if (req.method === 'POST' && jobCancelMatch) {
    sendJson(res, 200, { cancelled: cancelJob(jobCancelMatch[1]) });
    return true;
  }

  if (req.method === 'GET' && route === '/api/jobs') {
    sendJson(res, 200, { jobs: listJobs() });
    return true;
  }

  /* ---- project library ---- */
  if (req.method === 'GET' && route === '/api/library') {
    const projects = listProjects().map((entry) => {
      const stored = loadProject(entry.id);
      return {
        ...entry,
        usd: stored?.cost?.usd ?? stored?.usage?.usd ?? null,
        auditScore: stored ? auditProject(stored).score : null,
      };
    });
    sendJson(res, 200, { projects, libraryPath: projectsDir() });
    return true;
  }

  const libraryMatch = route.match(/^\/api\/library\/([\w.-]+)$/);
  if (req.method === 'GET' && libraryMatch) {
    const project = loadProject(libraryMatch[1]);
    if (!project) {
      sendJson(res, 404, { error: 'Nie ma takiego projektu w bibliotece.' });
      return true;
    }
    sendJson(res, 200, { project, validation: validateProject(project), audit: auditProject(project) });
    return true;
  }

  const libraryDeleteMatch = route.match(/^\/api\/library\/([\w.-]+)\/delete$/);
  if (req.method === 'POST' && libraryDeleteMatch) {
    sendJson(res, 200, { deleted: deleteProject(libraryDeleteMatch[1]) });
    return true;
  }

  const libraryImportMatch = route.match(/^\/api\/library\/([\w.-]+)\/import$/);
  if (req.method === 'POST' && libraryImportMatch) {
    const project = loadProject(libraryImportMatch[1]);
    if (!project) {
      sendJson(res, 404, { error: 'Nie ma takiego projektu.' });
      return true;
    }
    sendJson(res, 200, { project, validation: validateProject(project), audit: auditProject(project) });
    return true;
  }

  const versionMatch = route.match(/^\/api\/versions\/([\w.-]+)\/(\d+)$/);
  if (req.method === 'GET' && versionMatch) {
    const project = loadVersion(versionMatch[1], Number(versionMatch[2]));
    if (!project) {
      sendJson(res, 404, { error: 'Nie ma takiej wersji.' });
      return true;
    }
    sendJson(res, 200, { project, validation: validateProject(project), audit: auditProject(project) });
    return true;
  }

  /* ---- live sync: diff dla wtyczki i edycja plików ---- */
  const diffMatch = route.match(/^\/api\/projects\/([\w.-]+)\/diff$/);
  if (req.method === 'GET' && diffMatch) {
    const diff = diffSince(diffMatch[1], query.get('since'));
    if (!diff) {
      sendJson(res, 404, { error: 'Nie ma takiego projektu.' });
      return true;
    }
    sendJson(res, 200, diff);
    return true;
  }

  const versionsMatch = route.match(/^\/api\/library\/([\w.-]+)\/versions$/);
  if (req.method === 'GET' && versionsMatch) {
    const versions = listVersions(versionsMatch[1]);
    if (!versions.length && !loadProject(versionsMatch[1])) {
      sendJson(res, 404, { error: 'Nie ma takiego projektu.' });
      return true;
    }
    const project = loadProject(versionsMatch[1]);
    sendJson(res, 200, { id: versionsMatch[1], revision: project?.revision || 1, versions });
    return true;
  }

  const restoreMatch = route.match(/^\/api\/library\/([\w.-]+)\/restore$/);
  if (req.method === 'POST' && restoreMatch) {
    const body = await readBody(req);
    const saved = restoreVersion(restoreMatch[1], Number(body.index ?? 0));
    if (!saved) {
      sendJson(res, 404, { error: 'Nie ma takiej wersji.' });
      return true;
    }
    const project = loadProject(restoreMatch[1]);
    sendJson(res, 200, { project, validation: validateProject(project), audit: auditProject(project), ...saved });
    return true;
  }

  const fileMatch = route.match(/^\/api\/library\/([\w.-]+)\/file$/);
  if (req.method === 'POST' && fileMatch) {
    const body = await readBody(req);
    if (!body.path || typeof body.content !== 'string') {
      sendJson(res, 400, { error: 'Wymagane: path i content.' });
      return true;
    }
    // Edytować można tylko pliki projektu (żadnych ścieżek spoza src/).
    const saved = saveFile(fileMatch[1], String(body.path), body.content, { note: body.note || 'edycja w edytorze' });
    if (!saved) {
      sendJson(res, 404, { error: 'Nie ma takiego projektu.' });
      return true;
    }
    const project = loadProject(fileMatch[1]);
    sendJson(res, 200, { ...saved, project, audit: auditProject(project) });
    return true;
  }

  /* ---- export ---- */
  if (req.method === 'POST' && route === '/api/export') {
    const body = await readBody(req);
    const project = body.project;
    const format = String(body.format || 'zip');
    if (!project || !Array.isArray(project.files)) {
      sendJson(res, 400, { error: 'Brak projektu do eksportu.' });
      return true;
    }

    // Wtyczka potrzebuje adresu lokalnego buildera + ewentualnych ustawień modelu.
    if (format === 'plugin' || format === 'studio') {
      const { body: buffer, warnings } = { body: Buffer.from(buildPlugin(project, {
        serverUrl: body.serverUrl || `http://127.0.0.1:${serverPort}`,
        provider: body.provider || project.meta?.provider,
        model: body.model || project.meta?.model,
        language: body.language || project.meta?.language,
        projectId: project.projectId || null,
        revision: project.revision ?? null,
      }), 'utf8'), warnings: [] };
      const filename = `${slugify(project.name || 'ai-game', 'ai-game')}.plugin.luau`;
      sendBuffer(res, 200, buffer, 'text/plain; charset=utf-8', {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Export-Warnings': String((warnings || []).length),
      });
      return true;
    }

    const { filename, contentType, body: buffer, warnings } = exportAs(project, format);
    sendBuffer(res, 200, buffer, contentType, {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Export-Warnings': String((warnings || []).length),
    });
    return true;
  }

  if (req.method === 'POST' && route === '/api/files') {
    const body = await readBody(req);
    if (!body.project) {
      sendJson(res, 400, { error: 'Brak projektu.' });
      return true;
    }
    sendJson(res, 200, { files: assembleFiles(body.project).map((f) => ({ path: f.path, size: Buffer.byteLength(String(f.content), 'utf8') })) });
    return true;
  }

  /* ---- zip preview for the Studio plugin (no download headers) ---- */
  if (req.method === 'GET' && route === '/api/zip') {
    const projectId = query.get('project');
    const project = projectId ? loadProject(projectId) : null;
    if (!project) {
      sendJson(res, 404, { error: 'Brak projektu o tym id.' });
      return true;
    }
    sendBuffer(res, 200, buildZipBuffer(project), 'application/zip');
    return true;
  }

  /* ---- thumbnail (game icon) ---- */
  if (req.method === 'GET' && route === '/api/thumbnail') {
    const projectId = query.get('project');
    const stored = projectId ? loadProject(projectId) : null;
    const project = stored || {
      name: query.get('name') || 'AI GAME',
      genre: query.get('genre') || '',
    };
    const size = Math.max(128, Math.min(1024, Number(query.get('size')) || 512));
    const png = renderThumbnail(project, { size });
    sendBuffer(res, 200, png, 'image/png', {
      'Content-Disposition': `inline; filename="${thumbnailFilename(project)}"`,
    });
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------ *
 * server
 * ------------------------------------------------------------------ */
let serverPort = Number(process.env.PORT) || 5173;

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' });
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        const handled = await handleApi(req, res, url);
        if (!handled) sendJson(res, 404, { error: `Nieznany endpoint: ${url.pathname}` });
      } catch (err) {
        if (!res.headersSent) sendJson(res, 500, { error: err.message || 'Błąd serwera.' });
        else if (!res.writableEnded) res.end();
      }
      return;
    }

    // Wtyczka Studio pobiera swój kod z serwera – dzięki temu nie trzeba go
    // kopiować ręcznie po każdej zmianie projektu.
    if (req.method === 'GET' && url.pathname === '/studio.js') {
      const projectId = url.searchParams.get('project');
      const project = projectId ? loadProject(projectId) : null;
      if (!project) {
        sendJson(res, 404, { error: 'Nie ma projektu o tym id (wygeneruj grę najpierw).' });
        return;
      }
      const source = buildPlugin(project, {
        serverUrl: `http://127.0.0.1:${serverPort}`,
        projectId,
        revision: project.revision ?? null,
        provider: project.meta?.provider,
        model: project.meta?.model,
        language: project.meta?.language || 'pl',
      });
      sendBuffer(res, 200, Buffer.from(source, 'utf8'), 'text/plain; charset=utf-8');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Metoda niedozwolona.' });
      return;
    }

    serveStatic(res, url.pathname, req);
  });
}

export function startServer({ port = Number(process.env.PORT) || 5173, host = process.env.HOST || '0.0.0.0' } = {}) {
  serverPort = port;
  const server = createServer();
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`\n  Roblox AI Game Builder v${VERSION}`);
    console.log(`  → http://${shown}:${port}`);
    console.log(`  Biblioteka projektów: ${projectsDir()}`);
    console.log(`  Demo bez klucza API: 5 gotowych gier | Wtyczka Studio: przycisk "Wtyczka do Studio"\n`);
  });
  const shutdown = () => {
    for (const job of listJobs()) cancelJob(job.id);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const portFlag = args.indexOf('--port');
  const hostFlag = args.indexOf('--host');
  startServer({
    port: portFlag >= 0 ? Number(args[portFlag + 1]) : undefined,
    host: hostFlag >= 0 ? args[hostFlag + 1] : undefined,
  });
}

export { VERSION };
