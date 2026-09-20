/**
 * One source of truth for "which Studio instance does this Luau file become".
 *
 * Used by the live-sync diff (server) and mirrored by the Studio plugin, so a
 * changed file can be written straight into the right script without rebuilding
 * the whole place.
 */

const BUCKETS = {
  server: { service: 'ServerScriptService', folders: [] },
  client: { service: 'StarterPlayer', folders: ['StarterPlayerScripts'] },
  shared: { service: 'ReplicatedStorage', folders: ['Shared'] },
  startergui: { service: 'StarterGui', folders: [] },
  replicatedstorage: { service: 'ReplicatedStorage', folders: [] },
  serverstorage: { service: 'ServerStorage', folders: [] },
  workspace: { service: 'Workspace', folders: [] },
  soundservice: { service: 'SoundService', folders: [] },
};

/** ['src','server','sub','File.server.luau'] -> { bucket, folders, name } */
export function splitPath(filePath) {
  const parts = String(filePath || '').split('/').filter(Boolean);
  if (parts[0] === 'src') parts.shift();
  const fileName = parts.pop() || 'Script';
  const bucket = String(parts.shift() || 'server').toLowerCase();
  let name = fileName.replace(/\.luau?$/, '');
  let className = 'ModuleScript';
  if (/\.server$/i.test(name)) {
    className = 'Script';
    name = name.replace(/\.server$/i, '');
  } else if (/\.client$/i.test(name)) {
    className = 'LocalScript';
    name = name.replace(/\.client$/i, '');
  }
  return { bucket, folders: parts, name, className, fileName };
}

/**
 * @returns {{service:string, folders:string[], name:string, className:string, studioPath:string}}
 *          `studioPath` is a readable dotted path, e.g. `ServerScriptService.Economy`.
 *          The field is deliberately NOT called `path`, so it cannot clash with
 *          the project file path when the two are merged into one object.
 */
export function studioTargetForPath(filePath) {
  const { bucket, folders, name, className } = splitPath(filePath);
  const mapping = BUCKETS[bucket] || BUCKETS.server;
  const allFolders = [...mapping.folders, ...folders];
  return {
    service: mapping.service,
    folders: allFolders,
    name,
    className,
    studioPath: [mapping.service, ...allFolders, name].join('.'),
  };
}
