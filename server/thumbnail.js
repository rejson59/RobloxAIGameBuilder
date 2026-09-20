/**
 * Procedural game thumbnail generator (512x512 PNG) – no external assets,
 * no AI image model: gradient + geometry + a hand-made 5x7 bitmap font.
 * The result can be uploaded straight to Roblox as a game icon.
 */
import { encodePng } from './png.js';
import { slugify } from './util.js';

/* ------------------------------------------------------------------ *
 * Tiny 5x7 bitmap font (readable enough at 5x scaled = 25 px tall)
 * ------------------------------------------------------------------ */
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['####.', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#...#', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/* ------------------------------------------------------------------ *
 * Palettes per genre
 * ------------------------------------------------------------------ */
const PALETTES = {
  obby: { top: [10, 16, 38], bottom: [6, 44, 58], accent: [0, 229, 160], secondary: [79, 195, 247] },
  'tower defense': { top: [20, 12, 40], bottom: [58, 22, 74], accent: [255, 196, 0], secondary: [126, 87, 194] },
  'pvp shooter': { top: [26, 8, 18], bottom: [60, 14, 26], accent: [255, 82, 82], secondary: [79, 195, 247] },
  tycoon: { top: [18, 16, 8], bottom: [52, 40, 8], accent: [255, 196, 0], secondary: [0, 229, 160] },
  simulator: { top: [8, 18, 34], bottom: [16, 52, 66], accent: [0, 229, 160], secondary: [255, 82, 182] },
  horror: { top: [8, 8, 12], bottom: [30, 10, 14], accent: [220, 40, 60], secondary: [140, 140, 160] },
  racing: { top: [12, 12, 24], bottom: [40, 18, 60], accent: [255, 120, 0], secondary: [0, 229, 160] },
  rpg: { top: [16, 10, 26], bottom: [48, 24, 60], accent: [200, 160, 255], secondary: [255, 196, 0] },
  default: { top: [10, 14, 30], bottom: [40, 24, 70], accent: [0, 229, 160], secondary: [126, 87, 194] },
};

function paletteFor(genre) {
  const key = String(genre || '').toLowerCase();
  for (const name of Object.keys(PALETTES)) {
    if (name !== 'default' && key.includes(name)) return PALETTES[name];
  }
  for (const [name, palette] of Object.entries(PALETTES)) {
    for (const word of name.split(' ')) {
      if (word.length > 3 && key.includes(word)) return palette;
    }
  }
  return PALETTES.default;
}

/* ------------------------------------------------------------------ *
 * Tiny software rasteriser
 * ------------------------------------------------------------------ */
class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 3);
  }

  set(x, y, [r, g, b], alpha = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 3;
    this.data[index] = Math.round(this.data[index] * (1 - alpha) + r * alpha);
    this.data[index + 1] = Math.round(this.data[index + 1] * (1 - alpha) + g * alpha);
    this.data[index + 2] = Math.round(this.data[index + 2] * (1 - alpha) + b * alpha);
  }

  blendPixel(x, y, colour, alpha = 1) {
    this.set(Math.round(x), Math.round(y), colour, alpha);
  }

  verticalGradient(top, bottom) {
    for (let y = 0; y < this.height; y++) {
      const t = y / (this.height - 1);
      const colour = [
        top[0] + (bottom[0] - top[0]) * t,
        top[1] + (bottom[1] - top[1]) * t,
        top[2] + (bottom[2] - top[2]) * t,
      ];
      for (let x = 0; x < this.width; x++) this.set(x, y, colour);
    }
  }

  glow(cx, cy, radius, colour, strength = 0.5) {
    const r2 = radius * radius;
    for (let y = Math.max(0, cy - radius); y < Math.min(this.height, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x < Math.min(this.width, cx + radius); x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = Math.pow(1 - Math.sqrt(d2) / radius, 2.2);
        this.set(x, y, colour, falloff * strength);
      }
    }
  }

  rect(x, y, w, h, colour, alpha = 1) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) this.blendPixel(px, py, colour, alpha);
    }
  }

  roundRect(x, y, w, h, radius, colour, alpha = 1) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const dx = Math.max(x + radius - px, 0, px - (x + w - radius - 1));
        const dy = Math.max(y + radius - py, 0, py - (y + h - radius - 1));
        if (dx * dx + dy * dy > radius * radius) continue;
        this.blendPixel(px, py, colour, alpha);
      }
    }
  }

  line(x0, y0, x1, y1, colour, alpha = 1, thickness = 1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let ox = 0; ox < thickness; ox++) {
        for (let oy = 0; oy < thickness; oy++) this.blendPixel(x + ox, y + oy, colour, alpha);
      }
    }
  }

  diamond(cx, cy, size, colour, alpha = 0.5) {
    for (let y = -size; y <= size; y++) {
      const halfWidth = size - Math.abs(y);
      for (let x = -halfWidth; x <= halfWidth; x++) this.blendPixel(cx + x, cy + y, colour, alpha);
    }
  }

  /** Draws uppercase text; returns the width in pixels. */
  text(content, x, y, scale, colour, alpha = 1) {
    let cursor = x;
    for (const rawChar of String(content).toUpperCase()) {
      const glyph = FONT[rawChar] || FONT['?'];
      for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
        for (let gx = 0; gx < GLYPH_WIDTH; gx++) {
          if (glyph[gy][gx] !== '#') continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              this.blendPixel(cursor + gx * scale + sx, y + gy * scale + sy, colour, alpha);
            }
          }
        }
      }
      cursor += (GLYPH_WIDTH + 1) * scale;
    }
    return cursor - x;
  }

  textWidth(content, scale) {
    return String(content).length * (GLYPH_WIDTH + 1) * scale - scale;
  }
}

function wrapText(canvas, content, maxWidth, scale) {
  const words = String(content).toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (canvas.textWidth(candidate, scale) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */
export function renderThumbnail(project = {}, { size = 512 } = {}) {
  const canvas = new Canvas(size, size);
  const palette = paletteFor(project.genre || project.design?.genre);
  const title = String(project.name || 'AI GAME').slice(0, 40);
  const genre = String(project.genre || project.design?.genre || 'ROBLOX').slice(0, 22);

  canvas.verticalGradient(palette.top, palette.bottom);

  // Diagonal neon grid.
  for (let i = -size; i < size * 2; i += 56) {
    canvas.line(i, 0, i - size, size, palette.secondary, 0.10, 1);
  }

  // Glow behind the title + decorative diamonds seeded from the name.
  canvas.glow(size * 0.5, size * 0.44, size * 0.42, palette.accent, 0.30);
  const seed = [...title].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 99991, 7);
  for (let i = 0; i < 7; i++) {
    const x = ((seed * (i + 3) * 37) % size);
    const y = ((seed * (i + 5) * 53) % size);
    const s = 10 + ((seed + i * 17) % 26);
    canvas.diamond(x, y, s, i % 2 ? palette.accent : palette.secondary, 0.16);
  }

  // Border frame.
  canvas.roundRect(14, 14, size - 28, size - 28, 28, palette.accent, 0.10);
  canvas.roundRect(14, 14, size - 28, 3, 2, palette.accent, 0.85);
  canvas.roundRect(14, size - 17, size - 28, 3, 2, palette.secondary, 0.75);

  // Title (max 3 lines, auto-scaled).
  let scale = 9;
  let lines = wrapText(canvas, title, size - 90, scale);
  while (lines.length > 3 && scale > 5) {
    scale -= 1;
    lines = wrapText(canvas, title, size - 90, scale);
  }
  if (lines.length > 3) lines = lines.slice(0, 3);

  const lineHeight = (GLYPH_HEIGHT + 3) * scale;
  const blockHeight = lines.length * lineHeight;
  let y = Math.round(size * 0.42 - blockHeight / 2);
  for (const line of lines) {
    const width = canvas.textWidth(line, scale);
    const x = Math.round((size - width) / 2);
    canvas.text(line, x + 3, y + 3, scale, [0, 0, 0], 0.55);       // drop shadow
    canvas.text(line, x, y, scale, [255, 255, 255], 1);
    y += lineHeight;
  }

  // Genre badge.
  const badgeScale = 3;
  const badgeText = genre.toUpperCase();
  const badgeWidth = canvas.textWidth(badgeText, badgeScale) + 44;
  const badgeX = Math.round((size - badgeWidth) / 2);
  const badgeY = size - 84;
  canvas.roundRect(badgeX, badgeY, badgeWidth, 44, 22, [8, 10, 20], 0.78);
  canvas.roundRect(badgeX, badgeY, badgeWidth, 3, 2, palette.accent, 1);
  canvas.text(badgeText, badgeX + 22, badgeY + 13, badgeScale, palette.accent, 1);

  // Watermark.
  canvas.text('AI BUILT', size - 22 - canvas.textWidth('AI BUILT', 2), 26, 2, palette.secondary, 0.85);

  return encodePng(size, size, canvas.data);
}

export function thumbnailFilename(project) {
  return `${slugify(project?.name || 'ai-game', 'ai-game')}-icon.png`;
}
