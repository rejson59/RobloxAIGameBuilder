/**
 * Shared helpers: slugify, XML escaping, and the declarative
 * "property value" coercion rules used by both the .rbxmx writer and the
 * Studio plugin (server/rbxmx.js + plugin/RobloxAIGameBuilder.plugin.luau).
 */

const TRANSLITERATE = {
  ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ð: 'd', Ð: 'D',
  æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', þ: 'th', Þ: 'TH', ı: 'i',
  ą: 'a', Ą: 'A', ę: 'e', Ę: 'E', ś: 's', Ś: 'S', ź: 'z', Ź: 'Z',
};

/** Sprowadza tekst do ASCII: usuwa diakrytyki także tam, gdzie NFKD nie pomaga. */
export function foldDiacritics(input) {
  return String(input || '')
    .replace(/[\u0142\u0141\u00f8\u00d8\u0111\u0110\u00f0\u00d0\u00e6\u00c6\u0153\u0152\u00df\u00fe\u00de\u0131\u0105\u0104\u0119\u0118\u015b\u015a\u017a\u0179]/g, (c) => TRANSLITERATE[c] || c)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function slugify(input, fallback = 'ai-game') {
  const s = foldDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || fallback;
}

/** Roblox instance names: letters, digits, underscore; must not start with a digit. */
export function safeInstanceName(input, fallback = 'Item') {
  let s = foldDiacritics(input)
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s || /^[0-9]/.test(s)) s = `${fallback}_${s}`.replace(/_+$/g, '');
  if (/^(new|function|end|then|do|local|and|or|not|if|else|elseif|for|while|repeat|until|return|true|false|nil|break|in)$/.test(s)) {
    s = `${s}_`;
  }
  return s.slice(0, 100) || fallback;
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

const XML_UNESCAPES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
export function unescapeXml(value) {
  return String(value ?? '').replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m) => XML_UNESCAPES[m] ?? m);
}

/* ------------------------------------------------------------------ *
 * Property schema (the format the AI is asked to emit)
 *
 *   "Size": [8, 1, 8]              -> Vector3
 *   "Position": [0, 12, -4]        -> Vector3
 *   "Color": "#FFAA00"             -> Color3
 *   "Material": "Neon"             -> Enum.Material
 *   "Anchored": true               -> bool
 *   "Transparency": 0.25           -> float
 *   "Name": "Platform"             -> string
 *   "CFrame": {"position":[..],"rotation":[rx,ry,rz]} | 12 numbers
 *   "NumberRange": [1, 5]
 *   "UDim2": [0, 120, 0, 32]
 * ------------------------------------------------------------------ */

export const VECTOR_KEYS = new Set([
  'Position', 'Size', 'Orientation', 'Rotation', 'Velocity', 'AngularVelocity',
  'AssemblyLinearVelocity', 'AssemblyAngularVelocity', 'Gravity', 'WindDirection',
  'Ambient', 'OutdoorAmbient', 'ColorShift_Top', 'ColorShift_Bottom', 'LightColor',
]);

export const COLOR_KEYS = new Set([
  'Color', 'Color3', 'BackgroundColor3', 'TextColor3', 'BorderColor3', 'Ambient',
  'OutdoorAmbient', 'ColorShift_Top', 'ColorShift_Bottom', 'LightColor', 'FillColor',
  'OutlineColor', 'ThumbnailColor', 'SelectionColor', 'HealthColor',
]);

export const OBJECTVALUE_KEYS = new Set(['PrimaryPart', 'Part0', 'Part1', 'Adornee', 'Target']);

/** Numeric values for the enums an AI is most likely to emit, needed because
 *  .rbxmx stores enums as <token> numbers rather than names. */
export const ENUMS = {
  Material: {
    Plastic: 256, SmoothPlastic: 272, Neon: 288, Wood: 512, WoodPlanks: 528, Marble: 784,
    Basalt: 788, Slate: 800, CrackedLava: 804, Concrete: 816, Granite: 832, Brick: 848,
    Pebble: 864, Cobblestone: 880, Rock: 896, Sandstone: 912, CorrodedMetal: 1040,
    DiamondPlate: 1056, Foil: 1072, Metal: 1088, Grass: 1280, LeafyGrass: 1284, Sand: 1296,
    Fabric: 1312, Snow: 1328, Mud: 1344, Ground: 1360, Asphalt: 1376, Salt: 1392,
    Limestone: 1408, Pavement: 1424, Ice: 1536, Glacier: 1552, Glass: 1568, ForceField: 1584,
    Air: 1792, Water: 2048,
  },
  PartType: { Ball: 0, Block: 1, Cylinder: 2, Wedge: 3, CornerWedge: 4 },
  Shape: { Ball: 0, Block: 1, Cylinder: 2, Wedge: 3, CornerWedge: 4 },
  SurfaceType: {
    Smooth: 0, Glue: 1, Weld: 2, Studs: 3, Inlet: 4, Universal: 5, Hinge: 6, Motor: 7,
    SteppingMotor: 8,
  },
  Face: { Right: 0, Top: 1, Back: 2, Left: 3, Bottom: 4, Front: 5 },
  Font: {
    Legacy: 0, Arial: 1, ArialBold: 2, SourceSans: 3, SourceSansBold: 4, SourceSansLight: 5,
    SourceSansItalic: 6, Bodoni: 7, Garamond: 8, Cartoon: 9, Code: 10, Highway: 11,
    SciFi: 12, Arcade: 13, Fantasy: 14, Antique: 15, SourceSansSemibold: 16, Gotham: 17,
    GothamMedium: 18, GothamBold: 19, GothamBlack: 20, AmaticSC: 21, Bangers: 22,
    Creepster: 23, DenkOne: 24, Fondamento: 25, FredokaOne: 26, GrenzeGotisch: 27,
    IndieFlower: 28, JosefinSans: 29, Jura: 30, Kalam: 31, LuckiestGuy: 32, Merriweather: 33,
    Michroma: 34, Nunito: 35, Oswald: 36, PatrickHand: 37, PermanentMarker: 38,
    Roboto: 39, RobotoCondensed: 40, RobotoMono: 41, Sarpanch: 42, SpecialElite: 43,
    TitilliumWeb: 44, Ubuntu: 45,
  },
  EasingStyle: {
    Linear: 0, Sine: 1, Back: 2, Quad: 3, Quart: 4, Quint: 5, Bounce: 6, Elastic: 7,
    Exponential: 8, Circular: 9, Cubic: 10,
  },
  HumanoidRigType: { R6: 0, R15: 1 },
  Technology: { Legacy: 0, Voxel: 1, Compatibility: 2, ShadowMap: 3, Future: 4 },
  NormalId: { Right: 0, Top: 1, Back: 2, Left: 3, Bottom: 4, Front: 5 },
};

export function isHexColor(value) {
  return typeof value === 'string' && /^#?[0-9a-fA-F]{6}$/.test(value.trim());
}

export function isColorTuple(value) {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number');
}

/** "#FF8800" -> { r, g, b } in 0..1 */
export function hexToRgb(hex) {
  const h = String(hex).replace('#', '').trim();
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }) {
  const part = (v) => Math.max(0, Math.min(255, Math.round(Number(v) * 255)))
    .toString(16).padStart(2, '0').toUpperCase();
  return `#${part(r)}${part(g)}${part(b)}`;
}

export const NUMERIC_TYPES = /^(int|float|double|number)$/i;

export function isNumericValue(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Classify one property value so that the rbxmx writer and the Luau plugin
 * behave identically.
 * @returns {'vector3'|'color3'|'cframe'|'bool'|'int'|'float'|'string'|'token'|'numberrange'|'udim2'|'raw'}
 */
export function classifyProperty(key, value) {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') {
    // "#FF8800" to kolor, nie tekst – inaczej .rbxmx zapisałby string zamiast Color3.
    if (isHexColor(value) && !/^(Source|Text|Name)$/.test(key)) return 'color3';
    return 'string';
  }
  if (Array.isArray(value)) {
    if (isHexColorLike(value)) return 'token';
    if (value.length === 3) {
      if (key === 'NumberRange') return 'numberrange';
      if (isUnitRange(value)) return 'color3';
      return 'vector3';
    }
    if (value.length === 2 && key === 'NumberRange') return 'numberrange';
    if (value.length === 4 && /^UDim2?/.test(key)) return 'udim2';
    if (value.length === 12) return 'cframe';
    if (value.length === 3) return 'vector3';
    return 'raw';
  }
  if (value && typeof value === 'object') {
    if (key === 'CFrame' || value.position || value.Position) return 'cframe';
    if (value.r !== undefined && value.g !== undefined) return 'color3';
    if (value.x !== undefined && value.y !== undefined) return 'vector3';
    return 'raw';
  }
  return 'raw';
}

function isHexColorLike(arr) {
  return arr.every((v) => typeof v === 'string' && isHexColor(v));
}
function isUnitRange(arr) {
  return arr.every((n) => typeof n === 'number' && n >= 0 && n <= 1) && !arr.every((n) => Number.isInteger(n));
}

export function toVector3Tuple(value) {
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  if (value && typeof value === 'object') {
    return [Number(value.x ?? value.X) || 0, Number(value.y ?? value.Y) || 0, Number(value.z ?? value.Z) || 0];
  }
  return [0, 0, 0];
}

/** Euler degrees (Roblox convention, YXZ) -> 3x3 rotation matrix rows. */
export function eulerToMatrix([rx = 0, ry = 0, rz = 0]) {
  const cx = Math.cos((rx * Math.PI) / 180), sx = Math.sin((rx * Math.PI) / 180);
  const cy = Math.cos((ry * Math.PI) / 180), sy = Math.sin((ry * Math.PI) / 180);
  const cz = Math.cos((rz * Math.PI) / 180), sz = Math.sin((rz * Math.PI) / 180);
  return [
    [cy * cz, cy * sz, -sy],
    [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy],
    [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy],
  ];
}

export function parseCFrame(value) {
  if (Array.isArray(value) && value.length === 12) {
    return { position: value.slice(0, 3), rotation: value.slice(3, 12) };
  }
  if (Array.isArray(value) && value.length === 3) {
    return { position: value, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  }
  if (value && typeof value === 'object') {
    const position = toVector3Tuple(value.position ?? value.Position ?? [0, 0, 0]);
    const rot = value.rotation ?? value.Rotation ?? value.orientation;
    if (Array.isArray(rot) && rot.length === 9) return { position, rotation: rot };
    return { position, rotation: eulerToMatrix(Array.isArray(rot) ? rot : [0, 0, 0]).flat() };
  }
  return { position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
}

/** Strip markdown code fences an LLM may wrap JSON in, then parse leniently. */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new Error('parseJsonLoose oczekuje stringa');
  let base = text.trim();
  const fence = base.match(/```(?:json|luau|lua)?\s*([\s\S]*?)```/i);
  if (fence && /^\s*[[{]/.test(fence[1])) base = fence[1].trim();
  const firstBrace = base.search(/[[{]/);
  if (firstBrace > 0) base = base.slice(firstBrace);

  const candidates = [base];
  const lastBrace = Math.max(base.lastIndexOf('}'), base.lastIndexOf(']'));
  if (lastBrace > 0 && lastBrace < base.length - 1) candidates.push(base.slice(0, lastBrace + 1));

  const repair = (value) => value
    .replace(/,\s*([}\]])/g, '$1')                                   // trailing commas
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')     // surowe znaki kontrolne
    .replace(/("(?:[^"\\]|\\.)*")/gs, (m) => m.replace(/\n/g, '\\n')); // surowe newline w stringu

  for (const candidate of candidates) {
    for (const attempt of [candidate, repair(candidate)]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* próbujemy dalej */
      }
    }
  }
  throw new Error('Odpowiedź modelu nie jest poprawnym JSON-em (nie udało się naprawić).');
}

