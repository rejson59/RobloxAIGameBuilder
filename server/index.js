/**
 * Roblox AI Game Builder – local web app server.
 * Zero dependencies: node:http + node:fs only.
 *
 *   npm start             -> http://localhost:5173
 *   PORT=8080 npm start
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chat, listModels, publicProviders, testConnection, ProviderError } from './providers.js';
import { generateGame } from './pipeline.js';
import { getDemo, listDemos } from './games.js';
import { exportAs, assembleFiles } from './exporters.js';
import { validateProject } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = '1.0.0';
const MAX_BODY_BYTES = 32 * 1024 * 1024;

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
};

const jobs = new Map(); // jobId -> AbortController

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Zapytanie jest za duże (limit 32 MB).'));
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

/* ------------------------------------------------------------------ *
 * Static files
 * ------------------------------------------------------------------ */
function serveStatic(res, urlPath) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Nieprawidłowa ścieżka.' });
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, html) => {
        if (fallbackErr) {
          sendJson(res, 404, { error: 'Nie znaleziono pliku.' });
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */
async function handleApi(req, res, url) {
  const route = url.pathname;

  if (req.method === 'GET' && route === '/api/health') {
    sendJson(res, 200, { ok: true, version: VERSION, node: process.version, demos: listDemos().length });
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

  if (req.method === 'POST' && route === '/api/demo') {
    const body = await readBody(req);
    const project = getDemo(body.id || 'obby');
    const validation = validateProject(project);
    sendJson(res, 200, { project: { ...project, validation, demo: true, usage: { inputTokens: 0, outputTokens: 0, calls: 0 } } });
    return true;
  }

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

  if (req.method === 'POST' && route === '/api/validate') {
    const body = await readBody(req);
    if (!body.project) {
      sendJson(res, 400, { error: 'Brak projektu do walidacji.' });
      return true;
    }
    sendJson(res, 200, { validation: validateProject(body.project) });
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

  if (req.method === 'POST' && route === '/api/export') {
    const body = await readBody(req);
    const project = body.project;
    const format = String(body.format || 'zip');
    if (!project || !Array.isArray(project.files)) {
      sendJson(res, 400, { error: 'Brak projektu do eksportu.' });
      return true;
    }
    const { filename, contentType, body: buffer, warnings } = exportAs(project, format);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Export-Warnings': String((warnings || []).length),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Export-Warnings',
    });
    res.end(buffer);
    return true;
  }

  // Cancellation: /api/jobs/<id>/cancel
  const cancelMatch = route.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    const controller = jobs.get(cancelMatch[1]);
    if (controller) controller.abort();
    sendJson(res, 200, { cancelled: Boolean(controller) });
    return true;
  }

  /* SSE generation stream ------------------------------------------ */
  if (req.method === 'POST' && route === '/api/generate') {
    const body = await readBody(req);
    const jobId = String(body.jobId || `job-${Date.now()}`);
    const controller = new AbortController();
    jobs.set(jobId, controller);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'open', jobId })}\n\n`);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    const sse = (event) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const options = { ...(body.options || {}) };
      const project = await generateGame({
        idea: String(body.idea || ''),
        options,
        config: sanitizeConfig(body.config || {}),
        onEvent: sse,
        signal: controller.signal,
      });
      sse({ type: 'project', project });
    } catch (err) {
      const aborted = controller.signal.aborted || err.name === 'CancelledError';
      sse({
        type: 'error',
        aborted,
        message: aborted ? 'Generowanie przerwane.' : err.message,
        detail: err.detail || '',
        status: err.status || 0,
      });
    } finally {
      clearInterval(heartbeat);
      jobs.delete(jobId);
      if (!res.writableEnded) res.end();
    }
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */
export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        const handled = await handleApi(req, res, url);
        if (!handled) sendJson(res, 404, { error: `Nieznany endpoint: ${url.pathname}` });
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 500, { error: err.message || 'Błąd serwera.' });
        } else if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Metoda niedozwolona.' });
      return;
    }
    serveStatic(res, url.pathname);
  });
}

export function startServer({ port = Number(process.env.PORT) || 5173, host = process.env.HOST || '0.0.0.0' } = {}) {
  const server = createServer();
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`\n  Roblox AI Game Builder v${VERSION}`);
    console.log(`  → http://${shown}:${port}`);
    console.log(`  Tryb demo (bez klucza API): wybierz "Demo" w interfejsie.\n`);
  });
  const shutdown = () => {
    for (const controller of jobs.values()) controller.abort();
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
