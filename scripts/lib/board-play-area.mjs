// RT_05 / RT_12 — mesure de la zone de jeu dans un asset de plateau.
//
// Les images du référentiel (RT_12) ne montrent pas que le plateau : elles
// portent un bandeau de titre, un pied de légende et des repères latéraux.
// L'échelle mm <-> pixels dont RT_05 a besoin pour dimensionner les tokens ne
// peut donc pas se déduire des dimensions de l'image : il faut le rectangle du
// plateau lui-même, mesuré ici sur les pixels.
//
// Ce module est utilisé par `scripts/ingest-boards.mjs` au moment de la
// génération du référentiel (hors-ligne) — jamais à l'exécution de
// l'application (EX_05), qui lit simplement le résultat dans `boards.json`.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/**
 * Décodeur PNG minimal (8 bits/canal, non entrelacé) — suffisant ici.
 * Accepte un chemin, ou `{ buffer, path }` pour mesurer une image déjà
 * téléchargée sans repasser par le disque.
 */
export function decodePng(source) {
  const path = typeof source === 'string' ? source : source.path;
  const buf = typeof source === 'string' ? readFileSync(source) : source.buffer;
  const PNG_MAGIC = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== PNG_MAGIC) {
    throw new Error(`${path}: signature PNG absente`);
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`${path}: profondeur ${bitDepth} bits non gérée`);
  if (interlace !== 0) throw new Error(`${path}: PNG entrelacé non géré`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${path}: type de couleur ${colorType} non géré`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const current = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? current[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      let value = current[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      current[i] = value & 255;
    }
    current.copy(out, y * stride);
    previous = current;
  }

  return { width, height, channels, data: out };
}

/** Seuil de luminance en dessous duquel un pixel est considéré « trait noir ». */
const DARK_LUMINANCE = 90;
/** Le cadre du plateau couvre au moins cette fraction de la largeur d'image. */
const MIN_FRAME_WIDTH_RATIO = 0.55;

/**
 * Dimensions physiques du plateau représenté, annoncées par les images
 * elles-mêmes (pied de page « 60" x 44" BOARD ») et par les règles du jeu.
 * Elles donnent l'échelle mm <-> pixels dont RT_05 a besoin.
 */
export const BOARD_WIDTH_INCHES = 44;
export const BOARD_HEIGHT_INCHES = 60;
export const MM_PER_INCH = 25.4;

/**
 * Détecte le rectangle du plateau.
 *
 * On cherche les deux traits horizontaux du cadre — c'est le plus long segment
 * noir continu de l'image — et on en déduit `left`/`right` par les extrémités
 * de ce segment. Les repères latéraux (barres rouge/bleu des variantes à zones
 * de déploiement latérales) sont verticaux : ils ne produisent aucun long
 * segment horizontal et ne faussent donc pas la mesure.
 */
export function detectPlayArea(image) {
  const { width, height, channels, data } = image;
  const luminance = (x, y) => {
    const i = (y * width + x) * channels;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  const minRun = Math.round(width * MIN_FRAME_WIDTH_RATIO);
  const runs = [];

  for (let y = 0; y < height; y += 1) {
    let start = -1;
    let best = null;
    for (let x = 0; x <= width; x += 1) {
      const dark = x < width && luminance(x, y) < DARK_LUMINANCE;
      if (dark && start < 0) start = x;
      else if (!dark && start >= 0) {
        const length = x - start;
        if (length >= minRun && (!best || length > best.length)) {
          best = { start, end: x - 1, length };
        }
        start = -1;
      }
    }
    if (best) runs.push({ y, ...best });
  }

  if (runs.length < 2) {
    throw new Error('Cadre du plateau introuvable : aucun trait horizontal suffisamment long');
  }

  // Plusieurs éléments produisent un long trait horizontal sombre : le bord
  // biseauté du bandeau de titre, les filets de séparation de la légende, et
  // le cadre du plateau lui-même. On les regroupe par extrémités identiques,
  // puis on retient le groupe dont le rectangle a le bon rapport de forme —
  // celui d'un plateau de 44" x 60" (BOARD_WIDTH_INCHES / BOARD_HEIGHT_INCHES).
  const TOLERANCE = 4;
  const clusters = [];
  for (const run of runs) {
    const cluster = clusters.find(
      (c) => Math.abs(c.start - run.start) <= TOLERANCE && Math.abs(c.end - run.end) <= TOLERANCE,
    );
    if (cluster) {
      cluster.ys.push(run.y);
    } else {
      clusters.push({ start: run.start, end: run.end, ys: [run.y] });
    }
  }

  const expectedRatio = BOARD_WIDTH_INCHES / BOARD_HEIGHT_INCHES;
  let best = null;
  for (const cluster of clusters) {
    const top = Math.min(...cluster.ys);
    const bottom = Math.max(...cluster.ys);
    const rectWidth = cluster.end - cluster.start + 1;
    const rectHeight = bottom - top + 1;
    // Un trait isolé (bord de bandeau, filet de légende) donne un rectangle
    // dégénéré : il est éliminé par le rapport de forme.
    if (rectHeight < rectWidth * 0.5) continue;
    const error = Math.abs(rectWidth / rectHeight - expectedRatio) / expectedRatio;
    if (!best || error < best.error) {
      best = { left: cluster.start, right: cluster.end, top, bottom, error };
    }
  }

  if (!best) {
    throw new Error(
      `Cadre du plateau introuvable : aucun rectangle au rapport ` +
        `${BOARD_WIDTH_INCHES}/${BOARD_HEIGHT_INCHES} parmi ${clusters.length} candidats`,
    );
  }
  // Au-delà de quelques pour cent d'écart, ce n'est pas le cadre du plateau :
  // le gabarit des images a probablement changé (RT_12).
  if (best.error > 0.05) {
    throw new Error(
      `Cadre du plateau douteux : rapport de forme à ${(best.error * 100).toFixed(1)}% ` +
        `du ${BOARD_WIDTH_INCHES}"x${BOARD_HEIGHT_INCHES}" attendu`,
    );
  }

  return {
    left: best.left,
    top: best.top,
    right: best.right,
    bottom: best.bottom,
    width: best.right - best.left + 1,
    height: best.bottom - best.top + 1,
  };
}

/** Mesure la zone de jeu d'un fichier de plateau. */
export function measurePlayArea(path) {
  return detectPlayArea(decodePng(path));
}
