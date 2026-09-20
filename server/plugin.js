/**
 * Studio plugin generator.
 *
 * Emits a single .luau file that Roblox Studio installs as a plugin. The file
 * carries the whole generated game inside it (Luau source + world tree) plus a
 * full in-Studio UI:
 *   - "Buduj grę"      builds the project into the open place (one click)
 *   - "AI Builder"     dock panel: refine the game by chatting with the model,
 *                      scan for placeholder assets, insert free assets, save icon
 *   - refine talks to the local builder server (npm start) over HttpService
 * The project payload mirrors server/rbxmx.js so both export paths agree.
 */
import { PLUGIN_ENGINE, PLUGIN_UI } from './pluginRuntime.js';

const ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function luaString(value) {
  return `"${String(value ?? '').replace(/[\\"\n\r\t]/g, (c) => ESCAPES[c])}"`;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

/** JSON-ish value -> Luau literal source. */
export function toLuau(value, indent = 0) {
  const pad = '\t'.repeat(indent);
  const padInner = '\t'.repeat(indent + 1);

  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return luaString(value);

  if (Array.isArray(value)) {
    if (!value.length) return '{}';
    const items = value.map((v) => `${padInner}${toLuau(v, indent + 1)},`);
    return `{\n${items.join('\n')}\n${pad}}`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    const items = keys.map((key) => {
      const safeKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaString(key)}]`;
      return `${padInner}${safeKey} = ${toLuau(value[key], indent + 1)},`;
    });
    return `{\n${items.join('\n')}\n${pad}}`;
  }

  return luaString(String(value));
}

/** Builds the PROJECT payload embedded into the plugin. */
export function buildPluginPayload(project, { projectId = null } = {}) {
  const worldRoot = project.world?.world || project.world || { name: 'World', className: 'Folder', children: [] };
  return {
    name: project.name || 'AI Game',
    tagline: project.tagline || '',
    summary: project.summary || '',
    genre: project.genre || project.design?.genre || '',
    projectId: projectId || project.projectId || null,
    revision: project.revision ?? null,
    notes: (project.notes || []).slice(0, 12),
    files: (project.files || []).map((f) => ({ path: f.path, content: f.content })),
    design: project.design || null,
    plan: project.plan || null,
    world: {
      className: worldRoot.className || 'Folder',
      name: worldRoot.name || 'World',
      properties: worldRoot.properties || {},
      children: worldRoot.children || [],
    },
    lighting: project.world?.lighting || {},
  };
}

/**
 * @param {object} project
 * @param {object} [options]
 * @param {string} [options.serverUrl]  local builder address used by the refine feature
 * @param {string} [options.provider]   default provider for refine (pre-filled from the UI)
 * @param {string} [options.model]
 * @param {string} [options.apiKey]     only if the user explicitly wants it baked in
 * @param {string} [options.language]
 * @param {string} [options.projectId]
 * @returns {string} Luau source of the plugin
 */
export function buildPlugin(project, options = {}) {
  const payload = buildPluginPayload(project, options);
  const files = payload.files;

  const config = {
    serverUrl: (options.serverUrl || 'http://127.0.0.1:5173').replace(/\/+$/, ''),
    language: options.language || 'pl',
    model: {
      provider: options.provider || '',
      model: options.model || '',
      apiKey: options.apiKey || '',
      baseUrl: options.baseUrl || '',
    },
  };

  const bakedKeyNotice = options.apiKey
    ? 'UWAGA: w tym pliku jest zapisany Twój klucz API (na Twoją wyraźną prośbę).'
    : 'Klucz API nie jest zapisany w tym pliku – bezpieczniej.';

  return `--[[
	Roblox AI Game Builder – wtyczka Studio z wbudowaną grą i generatorem AI.

	Gra: ${payload.name}
	${payload.tagline}
	Pliki Luau: ${files.length} | Wygenerowano: ${new Date().toISOString().slice(0, 10)}
	Adres lokalnego buildera: ${config.serverUrl}
	${bakedKeyNotice}

	INSTALACJA
	  1. Zapisz ten plik jako RobloxAIGameBuilder.plugin.luau
	  2. W Roblox Studio: Plugins -> Plugins Folder (otworzy folder w eksploratorze)
	  3. Skopiuj plik do tego folderu i zrestartuj Studio
	  4. Na pasku wtyczek: "Roblox AI Game Builder"
	       - "Buduj grę"  -> wstawia mapę i skrypty w otwarte miejsce
	       - "AI Builder" -> panel: zmiany przez AI, skan zaślepek, darmowe assety, ikona

	ZMIANY PRZEZ AI wymagają uruchomionego lokalnego buildera (w folderze projektu: npm start)
	oraz włączonego "Allow HTTP Requests" w Game Settings -> Security.
]]
--!nocheck

local PROJECT = ${toLuau(payload, 0)}

local PROJECT_CONFIG = ${toLuau(config, 0)}

${PLUGIN_ENGINE}
${PLUGIN_UI}`;
}
