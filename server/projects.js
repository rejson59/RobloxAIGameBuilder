/**
 * On-disk project library (.projects/, gitignored).
 * Every generation is saved automatically, refinements create versions,
 * and the UI can reopen, restore or delete projects without touching the AI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './util.js';

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
  const version = {
    at: new Date().toISOString(),
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
    updatedAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    name: project.name,
    genre: project.genre || project.design?.genre || '',
    tagline: project.tagline || '',
    summary: project.summary || '',
    stats: project.validation?.stats || {},
    project,
    versions,
  };
  writeStore(store);
  return { id: projectId, versions: versions.length, path: fileFor(projectId) };
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
  return store ? { ...store.project, projectId: store.id, versions: store.versions?.length || 0 } : null;
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
