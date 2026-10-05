// RT_53 — génération des icônes de l'application (manifeste, iOS, favicon).
//
// Dessin géométrique simple — un plateau vu de dessus, deux zones de
// déploiement et leurs socles — rendu sans dépendance : chaque pixel est
// suréchantillonné (4 × 4) puis encodé en PNG avec le zlib de Node.
//
// Usage : node scripts/generate-icons.mjs
// Sortie : src/assets/icon/{favicon,icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'icon');

const BACKGROUND = [17, 19, 26]; // --app-surface-stage (RT_29)
const BOARD = [64, 78, 60];
const RUIN = [36, 42, 34];
const ZONE_TOP = [120, 44, 44];
const ZONE_BOTTOM = [38, 66, 112];
const TOKEN_TOP = [226, 84, 76];
const TOKEN_BOTTOM = [92, 150, 236];
const RIM = [242, 242, 243];

/** Scène en coordonnées normalisées [0, 1], centrée en (0,5 ; 0,5). */
function scene() {
  const board = { cx: 0.5, cy: 0.5, w: 0.5, h: 0.68, r: 0.035 };
  const top = board.cy - board.h / 2;
  const bottom = board.cy + board.h / 2;
  const zoneH = 0.15;
  const shapes = [
    { kind: 'rect', cx: 0.5, cy: 0.5, w: 1, h: 1, r: 0, color: BACKGROUND },
    { kind: 'rect', ...board, color: BOARD },
    { kind: 'rect', cx: 0.5, cy: top + zoneH / 2, w: board.w, h: zoneH, r: 0, color: ZONE_TOP, clip: board },
    { kind: 'rect', cx: 0.5, cy: bottom - zoneH / 2, w: board.w, h: zoneH, r: 0, color: ZONE_BOTTOM, clip: board },
    { kind: 'rect', cx: 0.4, cy: 0.45, w: 0.09, h: 0.07, r: 0.008, color: RUIN },
    { kind: 'rect', cx: 0.6, cy: 0.55, w: 0.09, h: 0.07, r: 0.008, color: RUIN },
  ];
  for (const x of [0.37, 0.5, 0.63]) {
    shapes.push({ kind: 'circle', cx: x, cy: top + zoneH / 2, r: 0.042, color: RIM });
    shapes.push({ kind: 'circle', cx: x, cy: top + zoneH / 2, r: 0.032, color: TOKEN_TOP });
    shapes.push({ kind: 'circle', cx: x, cy: bottom - zoneH / 2, r: 0.042, color: RIM });
    shapes.push({ kind: 'circle', cx: x, cy: bottom - zoneH / 2, r: 0.032, color: TOKEN_BOTTOM });
  }
  return shapes;
}

function insideRoundRect(x, y, s) {
  const dx = Math.abs(x - s.cx) - (s.w / 2 - s.r);
  const dy = Math.abs(y - s.cy) - (s.h / 2 - s.r);
  if (dx <= 0 || dy <= 0) return dx <= s.r && dy <= s.r;
  return dx * dx + dy * dy <= s.r * s.r;
}

function inside(x, y, s) {
  if (s.clip && !insideRoundRect(x, y, s.clip)) return false;
  if (s.kind === 'circle') return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
  return insideRoundRect(x, y, s);
}

/** `scale` < 1 réduit le dessin autour du centre (zone de sécurité « maskable »). */
function render(size, scale = 1) {
  const shapes = scene();
  const SS = 4;
  const pixels = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Le fond couvre toujours tout le carré ; seul le dessin est réduit.
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          const x = 0.5 + (u - 0.5) / scale;
          const y = 0.5 + (v - 0.5) / scale;
          let color = BACKGROUND;
          for (const s of shapes.slice(1)) if (inside(x, y, s)) color = s.color;
          for (let c = 0; c < 3; c++) acc[c] += color[c];
        }
      }
      const o = (py * size + px) * 3;
      for (let c = 0; c < 3; c++) pixels[o + c] = Math.round(acc[c] / (SS * SS));
    }
  }
  return encodePng(size, pixels);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filtre « none »
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const OUTPUTS = [
  ['favicon.png', 64, 1.3],
  ['icon-192.png', 192, 1.25],
  ['icon-512.png', 512, 1.25],
  // RT_53: le motif d'une icône « maskable » doit tenir dans le cercle de
  // sécurité (rayon 40 % du côté) — le coin du plateau en sort dès l'échelle 1.
  ['icon-maskable-512.png', 512, 0.9],
  ['apple-touch-icon.png', 180, 1.25],
];

for (const [name, size, scale] of OUTPUTS) {
  writeFileSync(join(OUT_DIR, name), render(size, scale));
  console.log(`${name} (${size} px)`);
}
