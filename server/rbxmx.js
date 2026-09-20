/**
 * .rbxmx (Roblox XML model) writer + Rojo project generator.
 *
 * Two inputs are supported, both produced by the AI pipeline:
 *   1. `files`  – Luau source files (Rojo layout) -> Script/LocalScript/ModuleScript tree
 *   2. `world`  – declarative instance tree      -> real parts, folders, spawns, GUIs
 *
 * The same declarative world schema is interpreted by the Studio plugin
 * (plugin/RobloxAIGameBuilder.plugin.luau), which keeps behaviour identical
 * whether you build in Studio or generate a file.
 */
import {
  ENUMS, escapeXml, hexToRgb, isHexColor, parseCFrame, safeInstanceName,
  toVector3Tuple, classifyProperty, slugify,
} from './util.js';

/* ------------------------------------------------------------------ *
 * Path -> Roblox service mapping (mirrors Rojo's conventions)
 * ------------------------------------------------------------------ */

const BUCKETS = {
  server: { service: 'ServerScriptService' },
  serverscripts: { service: 'ServerScriptService' },
  client: { service: 'StarterPlayer', nested: ['StarterPlayerScripts'] },
  starterplayerscripts: { service: 'StarterPlayer', nested: ['StarterPlayerScripts'] },
  startercharacterscripts: { service: 'StarterPlayer', nested: ['StarterCharacterScripts'] },
  shared: { service: 'ReplicatedStorage', nested: ['Shared'] },
  replicatedstorage: { service: 'ReplicatedStorage' },
  serverstorage: { service: 'ServerStorage' },
  startergui: { service: 'StarterGui' },
  workspace: { service: 'Workspace' },
  soundservice: { service: 'SoundService' },
  lighting: { service: 'Lighting' },
};

function stripSrcRoot(path) {
  const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts[0] === 'src' && parts.length > 1) parts.shift();
  return parts;
}

function instanceNameFromFile(fileName) {
  return fileName.replace(/\.(server|client)\.(luau?|lua)$/i, '').replace(/\.(luau?|lua)$/i, '');
}

function scriptClassFor(fileName, bucket) {
  if (/\.server\.(luau?|lua)$/i.test(fileName)) return 'Script';
  if (/\.client\.(luau?|lua)$/i.test(fileName)) return 'LocalScript';
  if (bucket === 'client' || bucket === 'starterplayerscripts' || bucket === 'startercharacterscripts') return 'ModuleScript';
  return 'ModuleScript';
}

function findOrCreateFolder(folder, name) {
  let child = folder.children.find((c) => c.className === 'Folder' && c.name === name);
  if (!child) {
    child = { className: 'Folder', name: safeInstanceName(name, 'Folder'), children: [] };
    folder.children.push(child);
  }
  return child;
}

/** Turn a Rojo file list into a service tree of script instances. */
export function planFileTree(files = []) {
  const services = new Map();
  const warnings = [];
  const scripts = [];

  const getService = (name, nested = []) => {
    const key = [name, ...nested].join('/');
    if (!services.has(key)) {
      services.set(key, { className: name, name, nested, children: [] });
    }
    return services.get(key);
  };

  for (const file of files) {
    const path = file.path || file.path === '' ? file.path : '';
    if (!path) continue;
    const parts = stripSrcRoot(path);
    if (!parts.length) continue;
    const fileName = parts.pop();
    const bucketKey = (parts.shift() || '').toLowerCase();
    const bucket = BUCKETS[bucketKey];
    let target;

    if (!bucket) {
      warnings.push(`Ścieżka "${path}" nie pasuje do żadnej usługi – wrzucono do ServerStorage.`);
      target = getService('ServerStorage').children;
      for (const seg of parts) target = findOrCreateFolder({ children: target }, seg).children;
    } else {
      const svc = getService(bucket.service, bucket.nested || []);
      target = svc.children;
      for (const seg of parts) target = findOrCreateFolder({ children: target }, seg).children;
    }

    const className = scriptClassFor(fileName, bucketKey);
    const name = safeInstanceName(instanceNameFromFile(fileName), 'Script');
    const existing = target.find((c) => c.name === name);
    if (existing) {
      existing.source = file.content;
      warnings.push(`Nazwa "${name}" powtórzona w kilku plikach – scalono źródła.`);
      continue;
    }
    const node = { className, name, source: file.content, properties: {} };
    target.push(node);
    scripts.push({ path, className, name });
  }

  return { services: [...services.values()], warnings, scripts };
}

/* ------------------------------------------------------------------ *
 * Property -> XML
 * ------------------------------------------------------------------ */

function vector3Xml(name, value) {
  const [x, y, z] = toVector3Tuple(value);
  return `<Vector3 name="${escapeXml(name)}"><X>${x}</X><Y>${y}</Y><Z>${z}</Z></Vector3>`;
}

function color3Xml(name, value) {
  let rgb;
  if (typeof value === 'string' && isHexColor(value)) rgb = hexToRgb(value);
  else if (Array.isArray(value)) {
    rgb = value.every((n) => n <= 1)
      ? { r: Number(value[0]) || 0, g: Number(value[1]) || 0, b: Number(value[2]) || 0 }
      : hexToRgb(`#${value.map((n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16).padStart(2, '0')).join('')}`);
  } else if (value && typeof value === 'object') {
    rgb = { r: Number(value.r) || 0, g: Number(value.g) || 0, b: Number(value.b) || 0 };
  } else {
    rgb = { r: 0.64, g: 0.64, b: 0.64 };
  }
  return `<Color3 name="${escapeXml(name)}"><R>${rgb.r.toFixed(6)}</R><G>${rgb.g.toFixed(6)}</G><B>${rgb.b.toFixed(6)}</B></Color3>`;
}

function cframeXml(name, value) {
  const { position, rotation } = parseCFrame(value);
  const [x, y, z] = toVector3Tuple(position);
  const r = (i) => Number(rotation[i] ?? (i % 4 === 0 ? 1 : 0)).toFixed(6);
  return `<CoordinateFrame name="${escapeXml(name)}">` +
    `<X>${x}</X><Y>${y}</Y><Z>${z}</Z>` +
    `<R00>${r(0)}</R00><R01>${r(1)}</R01><R02>${r(2)}</R02>` +
    `<R10>${r(3)}</R10><R11>${r(4)}</R11><R12>${r(5)}</R12>` +
    `<R20>${r(6)}</R20><R21>${r(7)}</R21><R22>${r(8)}</R22>` +
    `</CoordinateFrame>`;
}

function enumTokenXml(propName, value, warnings, instanceHint) {
  const table = ENUMS[propName];
  if (table && typeof value === 'string' && table[value] !== undefined) {
    return `<token name="${escapeXml(propName)}">${table[value]}</token>`;
  }
  // Some emitters write {"Shape": "Cylinder"} while the XML property is "shape".
  const alt = propName === 'Shape' ? 'PartType' : propName;
  if (ENUMS[alt] && typeof value === 'string' && ENUMS[alt][value] !== undefined) {
    return `<token name="${escapeXml(propName)}">${ENUMS[alt][value]}</token>`;
  }
  if (typeof value === 'number') return `<token name="${escapeXml(propName)}">${value}</token>`;
  warnings.push(`Pominięto enum ${instanceHint}.${propName} = "${value}" (brak mapowania na zapis XML).`);
  return '';
}

function numberRangeXml(name, value) {
  const [min, max] = Array.isArray(value) ? value : [value && value.min, value && value.max];
  return `<NumberRange name="${escapeXml(name)}"><Min>${Number(min) || 0}</Min><Max>${Number(max) || 0}</Max></NumberRange>`;
}

function udim2Xml(name, value) {
  const [xs, xo, ys, yo] = Array.isArray(value) ? value : [0, 0, 0, 0];
  return `<UDim2 name="${escapeXml(name)}"><XS>${Number(xs) || 0}</XS><XO>${Number(xo) || 0}</XO>` +
    `<YS>${Number(ys) || 0}</YS><YO>${Number(yo) || 0}</YO></UDim2>`;
}

export function propertyToXml(key, value, warnings = [], instanceHint = 'Instance') {
  switch (classifyProperty(key, value)) {
    case 'bool':
      return `<bool name="${escapeXml(key)}">${value ? 'true' : 'false'}</bool>`;
    case 'int':
      return `<int name="${escapeXml(key)}">${Math.trunc(value)}</int>`;
    case 'float':
      return `<float name="${escapeXml(key)}">${Number(value)}</float>`;
    case 'vector3':
      return vector3Xml(key, value);
    case 'color3':
      return color3Xml(key, value);
    case 'cframe':
      return cframeXml(key, value);
    case 'numberrange':
      return numberRangeXml(key, value);
    case 'udim2':
      return udim2Xml(key, value);
    case 'token':
      return enumTokenXml(key, value, warnings, instanceHint);
    case 'string':
    default: {
      if (/^(Material|Shape|TopSurface|BottomSurface|FrontSurface|BackSurface|LeftSurface|RightSurface|Font|EasingStyle|Technology|RigType|Face)$/.test(key)) {
        return enumTokenXml(key, value, warnings, instanceHint);
      }
      if (key === 'BrickColor') {
        if (typeof value === 'number') return `<int name="BrickColor">${Math.trunc(value)}</int>`;
        warnings.push(`${instanceHint}.BrickColor = "${value}" pominięto – użyj właściwości Color (hex), aby zachować kolor przy eksporcie .rbxmx.`);
        return '';
      }
      if (key === 'Source') {
        return `<ProtectedString name="Source">${escapeXml(value)}</ProtectedString>`;
      }
      return `<string name="${escapeXml(key)}">${escapeXml(value)}</string>`;
    }
  }
}

const SKIP_PROPERTIES = new Set(['Parent', 'ClassName', 'Tags', 'Attributes', 'Referent', 'archivable']);

/* ------------------------------------------------------------------ *
 * World tree -> <Item> tree
 * ------------------------------------------------------------------ */

function nodeToXml(node, referent, warnings, depth = 0) {
  if (!node || typeof node !== 'object') return '';
  const className = safeInstanceName(node.className || node.className === '' ? node.className : 'Folder', 'Folder');
  const name = node.name || node.Name || className;
  const props = [];
  props.push(`<string name="Name">${escapeXml(name)}</string>`);

  const properties = node.properties && typeof node.properties === 'object' ? node.properties : {};
  for (const [key, value] of Object.entries(properties)) {
    if (SKIP_PROPERTIES.has(key) || key === 'Name') continue;
    if (value === undefined || value === null) continue;
    const xml = propertyToXml(key, value, warnings, `${className}.${name}`);
    if (xml) props.push(xml);
  }
  if (node.source) props.push(`<ProtectedString name="Source">${escapeXml(node.source)}</ProtectedString>`);

  const children = Array.isArray(node.children) ? node.children : [];
  let out = `\n${'  '.repeat(depth + 1)}<Item class="${escapeXml(className)}" referent="RBX${referent.id++}">`;
  out += `\n${'  '.repeat(depth + 2)}<Properties>${props.map((p) => `\n${'  '.repeat(depth + 3)}${p}`).join('')}\n${'  '.repeat(depth + 2)}</Properties>`;
  for (const child of children) out += nodeToXml(child, referent, warnings, depth + 2);
  out += `\n${'  '.repeat(depth + 1)}</Item>`;
  return out;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function buildRbxmx(project) {
  const warnings = [];
  const referent = { id: 0 };
  const services = new Map();

  /** Service nodes can carry their own properties (e.g. Lighting.ClockTime). */
  const getServiceItem = (className, nestedPath = []) => {
    const key = [className, ...nestedPath].join('/');
    if (!services.has(key)) {
      services.set(key, { className, nestedPath, properties: {}, children: [] });
    }
    return services.get(key);
  };

  // 1) Luau files (Rojo layout) -> Script / LocalScript / ModuleScript
  const plan = planFileTree(project.files || []);
  warnings.push(...plan.warnings);
  for (const svc of plan.services) {
    getServiceItem(svc.className, svc.nested).children.push(...svc.children);
  }

  // 2) Declarative world tree -> Workspace
  const worldRoot = project.world?.world || project.world;
  if (worldRoot && (worldRoot.children?.length || worldRoot.className)) {
    getServiceItem('Workspace').children.push({
      className: worldRoot.className || 'Folder',
      name: worldRoot.name || 'World',
      properties: worldRoot.properties || {},
      children: worldRoot.children || [],
    });
  }

  // 3) Lighting settings -> properties of the Lighting service itself
  const lighting = project.world?.lighting;
  if (lighting && Object.keys(lighting).length) {
    Object.assign(getServiceItem('Lighting').properties, lighting);
  }

  const meta = `<Meta name="ExplicitAutoJoints">true</Meta>`;
  let body = '';
  for (const svc of services.values()) {
    // e.g. StarterPlayer -> StarterPlayerScripts -> LocalScripts
    //      ReplicatedStorage -> Shared -> ModuleScripts
    const root = {
      className: svc.className,
      name: svc.className,
      properties: svc.properties,
      children: [],
    };
    let cursor = root;
    for (const segment of svc.nestedPath) {
      const nested = { className: segment, name: segment, properties: {}, children: [] };
      cursor.children.push(nested);
      cursor = nested;
    }
    cursor.children.push(...svc.children);
    body += nodeToXml(root, referent, warnings, 0);
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n` +
    `  <!-- ${escapeXml(project.name || 'AI Game')} – wygenerowane przez Roblox AI Game Builder -->\n` +
    `  ${meta}${body}\n</roblox>\n`;

  return { xml, warnings, scripts: plan.scripts };
}

export function buildRojoProject(project) {
  const name = safeInstanceName(project.name || 'AIGame', 'AIGame');
  const has = (prefix) => (project.files || []).some((f) => String(f.path).replace(/\\/g, '/').startsWith(prefix));
  const tree = {
    name: slugify(project.name || 'ai-game'),
    tree: {
      $className: 'DataModel',
      ServerScriptService: {},
      ReplicatedStorage: {},
      StarterPlayer: {
        $className: 'StarterPlayer',
        StarterPlayerScripts: { $className: 'StarterPlayerScripts' },
      },
      Workspace: { $properties: { FilteringEnabled: true } },
      Lighting: {},
    },
  };

  if (has('src/shared')) tree.tree.ReplicatedStorage.Shared = { $path: 'src/shared' };
  if (has('src/server')) tree.tree.ServerScriptService = { $path: 'src/server' };
  if (has('src/client')) {
    tree.tree.StarterPlayer.StarterPlayerScripts = { $className: 'StarterPlayerScripts', $path: 'src/client' };
  }
  if (has('src/workspace')) tree.tree.Workspace = { ...tree.tree.Workspace, $path: 'src/workspace' };
  if (has('src/startergui')) tree.tree.StarterGui = { $path: 'src/startergui' };
  if (has('src/replicatedstorage')) tree.tree.ReplicatedStorage = { ...tree.tree.ReplicatedStorage, $path: 'src/replicatedstorage' };
  delete tree.tree.ServerScriptService.$className;
  void name;
  return tree;
}

/** README that ships inside every generated project. */
export function buildProjectReadme(project) {
  const name = project.name || 'AI Game';
  const files = project.files || [];
  const scriptCount = files.length;
  const rojoConfigured = files.some((f) => /^src\//.test(f.path));
  return `# ${name}

${project.summary || project.description || 'Gra wygenerowana przez Roblox AI Game Builder.'}

* Pliki Luau: **${scriptCount}**
* Gatunek: **${project.design?.genre || '—'}**
* Wygenerowano: ${new Date().toISOString().slice(0, 10)} (Roblox AI Game Builder)

---

## 1. Otwarcie w Roblox Studio (bez Rojo – najprościej)

1. W tym folderze znajdziesz plik \`${slugify(name)}.rbxmx\` (jeśli użyłeś eksportu "Model .rbxmx").
2. Otwórz Roblox Studio → nowy Baseplate.
3. Przeciągnij plik \`.rbxmx\` do okna Studio (albo **Model → Import from file**).
4. Wszystkie skrypty i świat wylądują w odpowiednich usługach:
   * \`Script\` → ServerScriptService
   * \`LocalScript\` → StarterPlayer → StarterPlayerScripts
   * \`ModuleScript\` → ReplicatedStorage.Shared
5. Włącz **Game Settings → Security → Allow HTTP Requests** jeśli skrypty korzystają z HttpService.
6. Naciśnij **Play** (F5).

## 2. Otwarcie w Roblox Studio (Rojo – dla programistów)

\`\`\`bash
# 1. Zainstaluj Rojo: https://rojo.space
aftman install   # lub: cargo install rojo
# 2. W tym folderze:
rojo serve
# 3. W Studio doinstaluj wtyczkę Rojo i kliknij "Connect".
\`\`\`

Struktura katalogów pokrywa się z konfiguracją Rojo z \`default.project.json\`:

\`\`\`
${rojoConfigured ? 'default.project.json' : '(brak plików src/)'}
src/
  server/   -> ServerScriptService   (*.server.luau = Script, *.luau = ModuleScript)
  client/   -> StarterPlayerScripts  (*.client.luau = LocalScript)
  shared/   -> ReplicatedStorage.Shared (ModuleScript)
\`\`\`

## 3. Szybka edycja w VS Code

1. \`rojo serve\` w tym folderze.
2. VS Code + rozszerzenie **Rojo** (lub **Luau LSP**) → *.luau ma podpowiedzi typów.
3. Zapisz plik → Studio dostaje zmianę natychmiast.

## 4. Checklist przed publikacją

- [ ] Sprawdź czy nie ma \`print\` debugowych (Ctrl+Shift+F: \`print(\`).
- [ ] Ustaw \`Workspace.FilteringEnabled = true\` (jest w \`default.project.json\`).
- [ ] Sprawdź \`StarterGui.ResetPlayerGuiOnSpawn\`, \`Workspace.StreamingEnabled\`.
- [ ] Przetestuj w trybie **Play → Server & Clients** (testy anty-exploitowe).
- [ ] Dodaj własne ikony, dźwięki i animacje (AI generuje geometrię z prymitywów).
- [ ] Uzupełnij ustawienia miejsca: **Game Settings → Avatar → Rig Type**, wiek odbiorcy.
${project.notes?.length ? `\n## Notatki wygenerowane przez model\n\n${project.notes.map((n) => `- ${n}`).join('\n')}\n` : ''}`;
}

export { BUCKETS, instanceNameFromFile, scriptClassFor, stripSrcRoot };
