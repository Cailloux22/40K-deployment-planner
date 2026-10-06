// RT_53 — génération des icônes de l'application (manifeste, iOS, favicon,
// lanceur Android) à partir d'une image maîtresse unique.
//
// L'icône maîtresse `resources/icon.png` (carrée, 1024 px, fond uni, motif
// clair) est décodée sans dépendance, rééchantillonnée (8 × 8 échantillons par
// pixel) puis réencodée en PNG avec le zlib de Node. Le fond est lu dans le coin
// de l'image ; le motif en est extrait par son écart à ce fond, ce qui permet
// de le réduire dans les zones de sécurité (icône « maskable », icône adaptative
// Android) en gardant un fond qui couvre tout le carré.
//
// Usage : node scripts/generate-icons.mjs
// Sortie : src/assets/icon/{favicon,icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
//          android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png
//          android/app/src/main/res/values/ic_launcher_background.xml

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'resources', 'icon.png');
const WEB_DIR = join(ROOT, 'src', 'assets', 'icon');
const ANDROID_RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');

// ---------------------------------------------------------------- PNG décodage

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG 8 bits RGB ou RGBA non entrelacé → { width, height, rgba } */
function decodePng(file) {
  const buf = readFileSync(file);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`${file} : seuls les PNG 8 bits RGB/RGBA non entrelacés sont pris en charge`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = out[i * bpp + c];
    rgba[i * 4 + 3] = bpp === 4 ? out[i * bpp + 3] : 255;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------- PNG encodage

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

/** `channels` : 3 (RGB, icône opaque) ou 4 (RGBA). */
function encodePng(size, pixels, channels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = channels === 4 ? 6 : 2;
  const stride = size * channels;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filtre « none »
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- Motif

const master = decodePng(SOURCE);
if (master.width !== master.height) throw new Error(`${SOURCE} doit être carrée`);
const N = master.width;
const BACKGROUND = [0, 1, 2].map((c) => master.rgba[c]); // coin supérieur gauche

/** Couverture du motif (0 = fond, 1 = motif) : écart au fond sur le canal le plus contrasté. */
const contrastChannel = BACKGROUND.indexOf(Math.min(...BACKGROUND));
const coverage = new Float32Array(N * N);
let motifRadius = 0;
for (let i = 0; i < N * N; i++) {
  const v = master.rgba[i * 4 + contrastChannel];
  const bg = BACKGROUND[contrastChannel];
  coverage[i] = Math.min(1, Math.max(0, (v - bg) / (255 - bg)));
  if (coverage[i] > 0.1) {
    const dx = (i % N) + 0.5 - N / 2;
    const dy = Math.floor(i / N) + 0.5 - N / 2;
    motifRadius = Math.max(motifRadius, Math.hypot(dx, dy) / N);
  }
}

/** Couleur de la maîtresse en (u, v) ∈ [0, 1]², le fond au-delà. */
function sampleMaster(u, v) {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return [...BACKGROUND, 255];
  const i = (Math.floor(v * N) * N + Math.floor(u * N)) * 4;
  return [master.rgba[i], master.rgba[i + 1], master.rgba[i + 2], 255];
}

/** Motif seul en (u, v), blanc sur transparent. */
function sampleMotif(u, v) {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return [255, 255, 255, 0];
  return [255, 255, 255, 255 * coverage[Math.floor(v * N) * N + Math.floor(u * N)]];
}

// ---------------------------------------------------------------- Rendu

const SS = 8;

/**
 * `radius` : rayon du motif visé, en fraction du côté (null = image telle
 * quelle) ; `shape` : découpe du carré ('square', 'circle', 'rounded').
 */
function render(size, { sampler = sampleMaster, radius = null, shape = 'square', channels = 4 } = {}) {
  const scale = radius === null ? 1 : radius / motifRadius;
  const pixels = Buffer.alloc(size * size * channels);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          if (!insideShape(u, v, shape)) continue;
          const [r, g, b, a] = sampler(0.5 + (u - 0.5) / scale, 0.5 + (v - 0.5) / scale);
          // Moyenne prémultipliée, pour que les bords transparents ne virent pas au noir.
          acc[0] += r * a;
          acc[1] += g * a;
          acc[2] += b * a;
          acc[3] += a;
        }
      }
      const o = (py * size + px) * channels;
      for (let c = 0; c < 3; c++) pixels[o + c] = acc[3] ? Math.round(acc[c] / acc[3]) : 0;
      if (channels === 4) pixels[o + 3] = Math.round(acc[3] / (SS * SS));
    }
  }
  return encodePng(size, pixels, channels);
}

function insideShape(u, v, shape) {
  if (shape === 'circle') return (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25;
  if (shape === 'rounded') {
    const r = 0.18;
    const dx = Math.abs(u - 0.5) - (0.5 - r);
    const dy = Math.abs(v - 0.5) - (0.5 - r);
    return dx <= 0 || dy <= 0 || dx * dx + dy * dy <= r * r;
  }
  return true;
}

function write(file, png) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(file.slice(ROOT.length + 1));
}

// ---------------------------------------------------------------- Web (RT_53)

write(join(WEB_DIR, 'favicon.png'), render(64));
write(join(WEB_DIR, 'icon-192.png'), render(192));
write(join(WEB_DIR, 'icon-512.png'), render(512));
// RT_53: le motif d'une icône « maskable » doit tenir dans le cercle de
// sécurité (rayon 40 % du côté) ; le fond, lui, couvre tout le carré.
write(join(WEB_DIR, 'icon-maskable-512.png'), render(512, { radius: 0.37 }));
// iOS arrondit lui-même les coins et noircit la transparence : icône opaque.
write(join(WEB_DIR, 'apple-touch-icon.png'), render(180, { channels: 3 }));

// ---------------------------------------------------------------- Android

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, k] of Object.entries(DENSITIES)) {
  const dir = join(ANDROID_RES, `mipmap-${density}`);
  // Lanceurs antérieurs à Android 8 (API 24-25, minSdk 24).
  write(join(dir, 'ic_launcher.png'), render(48 * k, { shape: 'rounded' }));
  write(join(dir, 'ic_launcher_round.png'), render(48 * k, { shape: 'circle' }));
  // Icône adaptative (API 26+) : calque de 108 dp dont seul le disque central
  // de 66 dp est garanti visible — le motif tient dans un rayon de 30 dp.
  write(join(dir, 'ic_launcher_foreground.png'), render(108 * k, { sampler: sampleMotif, radius: 30 / 108 }));
}

const hex = '#' + BACKGROUND.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
const backgroundXml = join(ANDROID_RES, 'values', 'ic_launcher_background.xml');
writeFileSync(
  backgroundXml,
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${hex}</color>
</resources>
`,
);
console.log(`${backgroundXml.slice(ROOT.length + 1)} (${hex})`);
