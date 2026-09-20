/**
 * On-disk project library (.projects/, gitignored).
 * Every generation is saved automatically, refinements create versions,
 * and the UI can reopen, restore or delete projects without touching the AI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './util.js';
import { studioTargetForPath } from './studioPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(__dirname, '..', '.projects');
const MAX_VERSIONS = 5;

/** Katalog biblioteki – czytany z env przy każdym użyciu (testy i CLI mogą go zmieniać). */
export function projectsDir() {
  const dir = process.env.PROJECTS_DIR || DEFAULT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(id) {
  return path.join(projectsDir(), `${id}.json`);
}

function readStore(id) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
  } catch {
    return null;
  }
}

function writeStore(store) {
  fs.writeFileSync(fileFor(store.id), JSON.stringify(store, null, 1));
}

export function newProjectId(name) {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slugify(name, 'ai-game')}-${stamp}-${suffix}`;
}

/**
 * Saves (or updates) a project.
 * @returns {{id: string, versions: number, path: string}}
 */
export function saveProject(project, { id, note = 'nowa wersja' } = {}) {
  const projectId = id || newProjectId(project.name);
  const existing = readStore(projectId);
  const revision = (existing?.revision || 0) + 1;
  const version = {
    at: new Date().toISOString(),
    revision,
    note,
    files: project.files,
    world: project.world,
    design: project.design,
    plan: project.plan,
    name: project.name,
    summary: project.summary,
  };
  const versions = [version, ...(existing?.versions || [])].slice(0, MAX_VERSIONS);
  const store = {
    id: projectId,
    revision,
    updatedAt: version.at,
    createdAt: existing?.createdAt || version.at,
    name: project.name,
    genre: project.genre || project.design?.genre || '',
    tagline: project.tagline || '',
    summary: project.summary || '',
    stats: project.validation?.stats || {},
    cost: project.cost || project.usage || null,
    auditScore: project.audit?.score ?? null,
    project,
    versions,
  };
  writeStore(store);
  return { id: projectId, revision, versions: versions.length, path: fileFor(projectId) };
}

/** Wersje projektu (do panelu „historia” i rollbacku we wtyczce). */
export function listVersions(id) {
  const store = readStore(id);
  if (!store) return [];
  return (store.versions || []).map((version, index) => ({
    index,
    revision: version.revision ?? null,
    at: version.at,
    note: version.note || '',
    files: version.files?.length || 0,
    name: version.name || store.name,
  }));
}

/**
 * Zapisuje pojedynczy plik projektu (edytor w UI / zewnętrzna synchronizacja).
 * Tworzy nową wersję i podbija rewizję, więc wtyczka może dociągnąć zmianę.
 */
export function saveFile(id, path, content, { note = 'edycja pliku' } = {}) {
  const store = readStore(id);
  if (!store) return null;
  const project = store.project;
  const files = Array.isArray(project.files) ? [...project.files] : [];
  const index = files.findIndex((file) => file.path === path);
  if (content === null || content === undefined) {
    if (index >= 0) files.splice(index, 1);
  } else if (index >= 0) {
    files[index] = { path, content };
  } else {
    files.push({ path, content });
  }
  project.files = files;
  const saved = saveProject(project, { id, note });
  return { ...saved, path };
}

/**
 * Przywraca wcześniejszą wersję jako NOWĄ wersję (historia pozostaje nienaruszona).
 */
export function restoreVersion(id, versionIndex) {
  const store = readStore(id);
  if (!store) return null;
  const version = store.versions?.[versionIndex];
  if (!version) return null;
  const restored = {
    ...store.project,
    files: version.files,
    world: version.world || store.project.world,
    design: version.design || store.project.design,
    plan: version.plan || store.project.plan,
    name: version.name || store.project.name,
    summary: version.summary ?? store.project.summary,
  };
  const saved = saveProject(restored, { id, note: `przywrócono wersję ${versionIndex} (rewizja ${version.revision ?? '?'})` });
  return { ...saved, restoredFrom: versionIndex };
}

/**
 * Różnica między rewizją `since` a obecnym stanem – dla live sync we wtyczce.
 * Gdy `since` nie istnieje w historii (albo jest starsze niż MAX_VERSIONS),
 * zwracamy `full: true`, czyli „przebuduj wszystko”.
 */
export function diffSince(id, since) {
  const store = readStore(id);
  if (!store) return null;
  const revision = store.revision || 1;
  const project = store.project;
  const currentFiles = Array.isArray(project.files) ? project.files : [];
  const base = Number(since);
  const history = store.versions || [];
  const known = Number.isFinite(base) ? history.find((version) => (version.revision ?? -1) === base) : null;

  const decorate = (file, action) => ({
    ...studioTargetForPath(file.path),
    path: file.path,
    action,
    content: file.content,
  });

  if (!known) {
    return {
      id,
      revision,
      since: Number.isFinite(base) ? base : null,
      full: true,
      reason: Number.isFinite(base) ? `rewizja ${base} nie jest już w historii` : 'brak rewizji klienta',
      changed: currentFiles.map((file) => decorate(file, 'replace')),
      removed: [],
      unchanged: 0,
    };
  }

  const previous = new Map((known.files || []).map((file) => [file.path, String(file.content || '')]));
  const current = new Map(currentFiles.map((file) => [file.path, String(file.content || '')]));
  const changed = [];
  for (const file of currentFiles) {
    const before = previous.get(file.path);
    if (before === undefined) changed.push(decorate(file, 'create'));
    else if (before !== String(file.content || '')) changed.push(decorate(file, 'replace'));
  }
  const removed = [];
  for (const path of previous.keys()) {
    if (!current.has(path)) {
      removed.push({ ...studioTargetForPath(path), path, action: 'remove' });
    }
  }
  return {
    id,
    revision,
    since: base,
    full: false,
    changed,
    removed,
    unchanged: currentFiles.length - changed.length,
  };
}

export function listProjects() {
  const directory = projectsDir();
  const entries = [];
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith('.json')) continue;
    try {
      const store = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      entries.push({
        id: store.id,
        name: store.name,
        genre: store.genre,
        tagline: store.tagline,
        files: store.project?.files?.length || 0,
        lines: store.stats?.lines || 0,
        versions: store.versions?.length || 0,
        updatedAt: store.updatedAt,
        createdAt: store.createdAt,
        demo: Boolean(store.project?.demo),
      });
    } catch {
      /* pomijamy uszkodzone wpisy */
    }
  }
  return entries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function loadProject(id) {
  const store = readStore(id);
  if (!store) return null;
  return {
    ...store.project,
    projectId: store.id,
    revision: store.revision || 1,
    versions: store.versions?.length || 0,
    auditScore: store.auditScore ?? null,
  };
}

export function loadVersion(id, index) {
  const store = readStore(id);
  if (!store || !store.versions?.[index]) return null;
  return { ...store.project, ...store.versions[index], projectId: id, restoredFrom: index };
}

export function deleteProject(id) {
  try {
    fs.unlinkSync(fileFor(id));
    return true;
  } catch {
    return false;
  }
}
