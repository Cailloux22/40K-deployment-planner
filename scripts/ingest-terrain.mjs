#!/usr/bin/env node
// RT_37: script d'extraction du référentiel de terrain.
//
// Génère `src/assets/referentials/terrain.json` à partir des images
// `no-measurements` des plateaux déjà présentes dans le dépôt (RT_12). Exécuté
// HORS-LIGNE, jamais à l'exécution de l'application (EX_05).
//
// RG_28: les images dessinent le terrain dans les couleurs franches de leur
// légende — socles de ruine gris hachurés cerclés de noir (zones
// obscurcissantes), murs de ruine verts (murs). Les obstacles orange ne sont
// pas extraits : ils ne bloquent pas la vue.
//
// RT_37: le script échoue explicitement (exit != 0) plutôt que de produire un
// référentiel partiel dès qu'un plateau s'écarte de ce qui est attendu.
//
// Usage: node scripts/ingest-terrain.mjs [--out <fichier>] [--preview <dossier>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

import { decodePng } from './lib/board-play-area.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const BOARDS_JSON = join(PROJECT_ROOT, 'src/assets/referentials/boards.json');

/** Retrait appliqué au rectangle de jeu pour écarter le cadre noir du plateau. */
const FRAME_INSET_PX = 4;
/** Épaisseur maximale d'un contour noir de socle, rattachée au socle qu'il cerne. */
const OUTLINE_GROW_PX = 8;
/** Plus petit socle de ruine plausible, en pixels d'asset (~2 x 2,5 pouces). */
const MIN_ZONE_AREA_PX = 2500;
/** Plus petite région retenue comme morceau de socle : en dessous, de l'anticrénelage. */
const MIN_SEED_AREA_PX = 30;
/** Part minimale de gris de socle dans une région pour la tenir pour un morceau de socle. */
const MIN_ZONE_FILL_RATIO = 0.3;
/** Part minimale de gris de socle dans les morceaux d'un socle reconstitué. */
const MIN_ZONE_GREY_RATIO = 0.1;
/** Épaisseur maximale du liseré noir qui cerne un mur ou un obstacle, anticrénelage compris (2–3 px de noir, 1–2 px de gris). */
const BAR_OUTLINE_MAX_PX = 5;
/** Distance à une barre en deçà de laquelle un contact noir entre deux morceaux ne les sépare pas. */
const BAR_CLEARANCE_PX = 6;
/** Portée de la recherche de voisins à travers un trait noir (contours de deux socles accolés : jusqu'à ~26 px). */
const BORDER_REACH_PX = 16;
/**
 * Frontière noire commune, loin de toute barre, au-delà de laquelle deux
 * morceaux sont deux socles distincts. Loin des barres, deux morceaux d'un
 * même socle ne se touchent jamais à travers du noir seul ; une fente ou deux
 * socles accolés se touchent, eux, sur des dizaines de pixels.
 */
const SHARED_BORDER_MIN_PX = 10;
/** Plus petit mur retenu : en dessous, ce sont des pixels d'anticrénelage. */
const MIN_WALL_AREA_PX = 60;
/** Tolérances de simplification des contours (Douglas-Peucker), en pixels. */
const ZONE_SIMPLIFY_PX = 2.5;
const WALL_SIMPLIFY_PX = 1.5;
/** Plus petit disque blanc tenu pour une icône d'objectif (~80 px de diamètre). */
const MIN_ICON_AREA_PX = 800;
/** Épaisseur du cercle de couleur autour du disque blanc d'une icône. */
const ICON_RING_PX = 7;
/** Nombre plausible de socles de ruine par plateau. */
const ZONE_COUNT_RANGE = [4, 30];
/** Pixels verts attendus dans la légende (« Ruin walls ») sous le plateau. */
const MIN_LEGEND_WALL_PX = 100;

const SOURCE = {
  name: 'Battlemaster',
  attribution: 'Deployment maps by Battlemaster (battlemaster.online), via gdmissions.app',
  url: 'https://battlemaster.online',
};

class IngestError extends Error {}

function fail(message) {
  throw new IngestError(message);
}

function parseArgs(argv) {
  const args = { out: join(PROJECT_ROOT, 'src/assets/referentials/terrain.json'), preview: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = resolve(argv[++i] ?? fail('--out attend un chemin'));
    else if (argv[i] === '--preview') args.preview = resolve(argv[++i] ?? fail('--preview attend un dossier'));
    else fail(`Argument inconnu: ${argv[i]}`);
  }
  return args;
}

// Trait noir des contours de socle (~13,17,22). Les trois canaux sont bornés :
// la grille de la zone de déploiement bleue (~16,40,64) est presque aussi
// sombre, mais bleutée, et ne doit pas fermer de région.
function isOutline(r, g, b) {
  return r < 50 && g < 50 && b < 50;
}

// RG_28: « Ruin walls » (~46,105,75). La teinte sarcelle des icônes
// d'objectif a g ≈ b et reste donc écartée.
function isWall(r, g, b) {
  return g - r >= 35 && g - b >= 15 && g >= 70 && g <= 160;
}

// Gris du socle de ruine (~228,221,214), distinct du crème du fond (~239,236,227).
function isZoneFill(r, g, b) {
  return Math.abs(r - 228) <= 10 && Math.abs(g - 221) <= 10 && Math.abs(b - 214) <= 10;
}

// « Obstacles » orange (~214,129,20) : jamais extraits (RG_28), mais posés sur
// les socles, dont ils signalent la présence au même titre que leur gris.
function isObstacle(r, g, b) {
  return r >= 180 && g >= 100 && g <= 160 && b <= 70;
}

// Intérieur blanc des icônes d'objectif (~248,248,248), plus clair que le crème du fond.
function isIconWhite(r, g, b) {
  return r >= 245 && g >= 245 && b >= 245;
}

/** Vue d'une image restreinte à un rectangle, avec un accès RVB par coordonnée locale. */
function window(image, rect) {
  const { width, channels, data } = image;
  const w = rect.right - rect.left + 1;
  const h = rect.bottom - rect.top + 1;
  const rgb = (x, y) => {
    const i = ((y + rect.top) * width + (x + rect.left)) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return { w, h, rgb };
}

function neighbours4(i, w, h) {
  const x = i % w;
  return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i + w < w * h ? i + w : -1];
}

/** Dilatation d'un masque binaire de `radius` pixels (distance de Manhattan). */
function dilate(mask, w, h, radius) {
  const out = Uint8Array.from(mask);
  let frontier = [];
  for (let i = 0; i < w * h; i += 1) if (mask[i]) frontier.push(i);
  for (let step = 0; step < radius; step += 1) {
    const next = [];
    for (const i of frontier) {
      for (const n of neighbours4(i, w, h)) {
        if (n >= 0 && !out[n]) {
          out[n] = 1;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/** Étiquette les composantes 4-connexes des pixels où `inside(i)` est vrai. */
function components(w, h, inside) {
  const labels = new Int32Array(w * h).fill(-1);
  const result = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start += 1) {
    if (labels[start] !== -1 || !inside(start)) continue;
    const id = result.length;
    const pixels = [];
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const i = stack[--top];
      pixels.push(i);
      const x = i % w;
      const y = (i - x) / w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of neighbours) {
        if (n >= 0 && labels[n] === -1 && inside(n)) {
          labels[n] = id;
          stack[top++] = n;
        }
      }
    }
    result.push(pixels);
  }
  return { labels, list: result };
}

/**
 * Trace le contour extérieur d'une région (suivi de Moore), en coordonnées de
 * centres de pixels. Les trous de la région sont ignorés.
 */
function traceOutline(mask, w, h) {
  let start = -1;
  for (let i = 0; i < w * h; i += 1) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Voisins dans le sens horaire, en partant de l'ouest.
  const dirs = [
    [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1],
  ];
  const sx = start % w;
  const sy = (start - sx) / w;
  const points = [];
  let cx = sx;
  let cy = sy;
  // Le pixel de départ est le plus haut-gauche : son voisin ouest est vide.
  let backtrack = 0;
  let firstDir = -1;
  for (let guard = 0; guard < 4 * w * h; guard += 1) {
    let d = -1;
    for (let k = 1; k <= 8; k += 1) {
      const candidate = (backtrack + k) % 8;
      if (at(cx + dirs[candidate][0], cy + dirs[candidate][1])) {
        d = candidate;
        break;
      }
    }
    if (d < 0) return [[sx, sy]]; // pixel isolé
    // Critère de Jacob : on s'arrête en repassant par le départ dans la même direction.
    if (cx === sx && cy === sy) {
      if (firstDir === d) break;
      if (firstDir < 0) firstDir = d;
    }
    points.push([cx, cy]);
    cx += dirs[d][0];
    cy += dirs[d][1];
    // Le balayage suivant repart juste après le pixel d'où l'on vient.
    backtrack = (d + 4) % 8;
  }
  return points;
}

/** Simplification de Douglas-Peucker d'un contour fermé. */
function simplify(points, epsilon) {
  if (points.length < 4) return points;
  const distance = ([px, py], [ax, ay], [bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(px - ax, py - ay);
    return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
  };
  const run = (pts) => {
    let index = -1;
    let max = 0;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const d = distance(pts[i], pts[0], pts[pts.length - 1]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max <= epsilon) return [pts[0], pts[pts.length - 1]];
    const left = run(pts.slice(0, index + 1));
    const right = run(pts.slice(index));
    return [...left.slice(0, -1), ...right];
  };
  // Un contour fermé se coupe en deux au point le plus éloigné du départ.
  let far = 0;
  let farDistance = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  const first = run(points.slice(0, far + 1));
  const second = run([...points.slice(far), points[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function polygonOf(pixels, w, h, rect, epsilon) {
  const mask = new Uint8Array(w * h);
  for (const i of pixels) mask[i] = 1;
  const outline = traceOutline(mask, w, h);
  // +0,5 : centre du pixel ; les coordonnées sont rendues dans le repère de l'asset (RT_04/RT_05).
  return simplify(outline, epsilon).map(([x, y]) => [
    Math.round((x + rect.left + 0.5) * 10) / 10,
    Math.round((y + rect.top + 0.5) * 10) / 10,
  ]);
}

function pointInPolygon([px, py], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Vrai si tous les sommets de `inner` sont dans `outer`. */
function contains(outer, inner) {
  return inner.every((p) => pointInPolygon(p, outer));
}

/** Vérifie la présence du vert « Ruin walls » dans la légende, sous le plateau. */
function assertLegend(image, board) {
  const legend = window(image, {
    left: 0,
    right: image.width - 1,
    top: board.playArea.bottom + 1,
    bottom: image.height - 1,
  });
  let count = 0;
  for (let y = 0; y < legend.h; y += 1) {
    for (let x = 0; x < legend.w; x += 1) {
      if (isWall(...legend.rgb(x, y))) count += 1;
    }
  }
  if (count < MIN_LEGEND_WALL_PX) {
    fail(`${board.id}: vert « Ruin walls » absent de la légende (${count} px) — format des images changé ?`);
  }
}

export function extractTerrain(image, board) {
  assertLegend(image, board);
  const rect = {
    left: board.playArea.left + FRAME_INSET_PX,
    top: board.playArea.top + FRAME_INSET_PX,
    right: board.playArea.right - FRAME_INSET_PX,
    bottom: board.playArea.bottom - FRAME_INSET_PX,
  };
  const { w, h, rgb } = window(image, rect);
  const outline = new Uint8Array(w * h);
  const wall = new Uint8Array(w * h);
  const bar = new Uint8Array(w * h);
  const grey = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = rgb(x, y);
      const i = y * w + x;
      outline[i] = isOutline(r, g, b) ? 1 : 0;
      wall[i] = isWall(r, g, b) ? 1 : 0;
      // Murs et obstacles sont des barres de couleur posées sur les socles,
      // cernées d'un même liseré noir fin : pour reconstituer les socles, ils
      // jouent le même rôle, même si seuls les murs bloquent la vue (RG_28).
      bar[i] = wall[i] || isObstacle(r, g, b) ? 1 : 0;
      grey[i] = isZoneFill(r, g, b) ? 1 : 0;
    }
  }

  // Les icônes d'objectif (disque blanc cerclé de couleur) sont souvent posées
  // à cheval sur le bord d'un socle : leur cercle, rouge, bleu ou sarcelle
  // mais pas noir, ouvrirait le socle sur le fond. Chaque icône — disque et
  // cercle — est traitée comme une barre.
  const white = components(w, h, (i) => {
    const [r, g, b] = rgb(i % w, Math.floor(i / w));
    return isIconWhite(r, g, b);
  }).list;
  for (const pixels of white) {
    if (pixels.length < MIN_ICON_AREA_PX) continue;
    const xs = pixels.map((i) => i % w);
    const ys = pixels.map((i) => Math.floor(i / w));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const radius = Math.max(x1 - x0, y1 - y0) / 2 + ICON_RING_PX;
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(h - 1, Math.ceil(cy + radius)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(w - 1, Math.ceil(cx + radius)); x += 1) {
        if (Math.hypot(x - cx, y - cy) <= radius) bar[y * w + x] = 1;
      }
    }
  }

  // RG_28: les morceaux de socle sont les régions grises fermées par les traits
  // noirs et par les barres. Le fond du plateau (grille, zones de déploiement)
  // est lui aussi une région fermée, mais sans gris ; une icône d'objectif
  // aussi, mais blanche.
  const all = components(w, h, (i) => outline[i] === 0 && bar[i] === 0).list;
  const regions = all.filter((pixels) => {
    if (pixels.length < MIN_SEED_AREA_PX) return false;
    let filled = 0;
    for (const i of pixels) filled += grey[i];
    return filled / pixels.length >= MIN_ZONE_FILL_RATIO;
  });
  // Un trait noir est bordé de pixels d'anticrénelage (ni noirs ni colorés) :
  // ils en font partie.
  const line = Uint8Array.from(outline);
  for (const pixels of all) if (pixels.length < MIN_SEED_AREA_PX) for (const i of pixels) line[i] = 1;
  const barComponents = components(w, h, (i) => bar[i] === 1);
  const walls = components(w, h, (i) => wall[i] === 1).list.filter((pixels) => pixels.length >= MIN_WALL_AREA_PX);

  // Chaque morceau s'étend sur les traits noirs voisins, en notant la
  // profondeur atteinte : le contour d'un socle lui appartient, et deux
  // morceaux qui se rejoignent dans un trait sont voisins de part et d'autre.
  const owner = new Int32Array(w * h).fill(-1);
  const depth = new Uint8Array(w * h);
  let frontier = [];
  regions.forEach((pixels, id) => {
    for (const i of pixels) {
      owner[i] = id;
      frontier.push(i);
    }
  });
  for (let step = 1; step <= BORDER_REACH_PX; step += 1) {
    const next = [];
    for (const i of frontier) {
      for (const n of neighbours4(i, w, h)) {
        if (n >= 0 && owner[n] === -1 && line[n] === 1) {
          owner[n] = owner[i];
          depth[n] = step;
          next.push(n);
        }
      }
    }
    frontier = next;
  }

  // Longueur de frontière noire commune entre deux morceaux : une fente entre
  // deux demi-socles, ou le contour commun de deux socles qui se touchent.
  // Près d'une barre, deux morceaux d'un même socle se rejoignent aussi dans
  // le contour du socle, autour de l'extrémité de la barre : ces contacts-là
  // ne comptent pas. Deux socles qu'une barre chevauche se rejoignent donc
  // (RT_37 : le mur les réunit).
  const nearBar = dilate(bar, w, h, BAR_CLEARANCE_PX);
  const shared = new Map();
  const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  // Contact de chaque morceau avec chaque barre, à travers le seul liseré de
  // la barre, en nombre de pixels.
  const touching = regions.map(() => new Map());
  for (let i = 0; i < w * h; i += 1) {
    if (owner[i] < 0) continue;
    for (const n of neighbours4(i, w, h)) {
      if (n < 0) continue;
      if (owner[n] >= 0 && owner[n] !== owner[i]) {
        if (nearBar[i]) continue;
        const key = pairKey(owner[i], owner[n]);
        shared.set(key, (shared.get(key) ?? 0) + 1);
      } else if (bar[n] === 1 && depth[i] <= BAR_OUTLINE_MAX_PX) {
        const label = barComponents.labels[n];
        touching[owner[i]].set(label, (touching[owner[i]].get(label) ?? 0) + 1);
      }
    }
  }
  const byBar = new Map();
  touching.forEach((contacts, region) =>
    contacts.forEach((_, label) => byBar.set(label, [...(byBar.get(label) ?? []), region])),
  );

  // Le liseré noir d'une barre découpe son socle en morceaux (de part et
  // d'autre de la barre, dans un cadre) : les morceaux qu'une même barre
  // touche sont un même socle. Deux morceaux séparés par du noir seul sont en
  // revanche deux socles, même si une barre les chevauche tous deux — et cette
  // interdiction vaut pour les socles reconstitués tout entiers, pas seulement
  // pour la paire. Les contacts les plus longs sont fusionnés d'abord : une
  // barre borde son propre socle sur toute sa longueur, et ne mord sur un
  // socle voisin que par son extrémité.
  const candidates = [];
  for (const [label, members] of byBar) {
    for (let a = 0; a < members.length; a += 1) {
      for (let b = a + 1; b < members.length; b += 1) {
        const strength = Math.min(touching[members[a]].get(label), touching[members[b]].get(label));
        candidates.push({ a: members[a], b: members[b], strength });
      }
    }
  }
  candidates.sort((x, y) => y.strength - x.strength);
  const separated = (a, b) => (shared.get(pairKey(a, b)) ?? 0) >= SHARED_BORDER_MIN_PX;
  const parent = regions.map((_, i) => i);
  const members = regions.map((_, i) => [i]);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const { a, b } of candidates) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) continue;
    if (members[ra].some((x) => members[rb].some((y) => separated(x, y)))) continue;
    parent[rb] = ra;
    members[ra].push(...members[rb]);
  }

  const groups = new Map();
  regions.forEach((pixels, region) => {
    const root = find(region);
    if (!groups.has(root)) groups.set(root, { pixels: [], grey: 0, surface: 0 });
    const group = groups.get(root);
    for (const i of pixels) {
      group.pixels.push(i);
      group.grey += grey[i];
    }
    group.surface += pixels.length;
  });
  for (let i = 0; i < w * h; i += 1) {
    if (owner[i] >= 0 && depth[i] > 0 && depth[i] <= OUTLINE_GROW_PX) groups.get(find(owner[i])).pixels.push(i);
  }
  // Une barre fait partie du socle qu'elle borde le plus longuement : une
  // barre qui mord sur un socle voisin reste à celui qu'elle traverse. C'est
  // aussi elle qui relie entre eux les morceaux de ce socle, pour le tracé de
  // son contour.
  barComponents.list.forEach((pixels, label) => {
    const contact = new Map();
    for (const region of byBar.get(label) ?? []) {
      const root = find(region);
      contact.set(root, (contact.get(root) ?? 0) + touching[region].get(label));
    }
    if (contact.size === 0) return;
    const [root] = [...contact].sort((a, b) => b[1] - a[1])[0];
    groups.get(root).pixels.push(...pixels);
  });

  // L'aire est celle du socle entier, barres comprises : un socle étroit est
  // presque entièrement couvert par son mur.
  const traced = [...groups.values()]
    .filter((g) => g.pixels.length >= MIN_ZONE_AREA_PX && g.grey / g.surface >= MIN_ZONE_GREY_RATIO)
    .map((g) => polygonOf(g.pixels, w, h, rect, ZONE_SIMPLIFY_PX));
  // Une région enclose dans un socle (l'intérieur d'un cercle d'icône) n'est
  // qu'un morceau de ce socle.
  const zones = traced
    .filter((points, index) => !traced.some((other, j) => j !== index && contains(other, points)))
    .map((points, index) => ({ id: `zone-${index + 1}`, points }));

  const wallPolygons = walls.map((pixels, index) => ({
    id: `wall-${index + 1}`,
    points: polygonOf(pixels, w, h, rect, WALL_SIMPLIFY_PX),
  }));

  if (zones.length < ZONE_COUNT_RANGE[0] || zones.length > ZONE_COUNT_RANGE[1]) {
    fail(`${board.id}: ${zones.length} socles de ruine extraits, hors de la plage ${ZONE_COUNT_RANGE.join('–')}`);
  }
  if (wallPolygons.length === 0) fail(`${board.id}: aucun mur de ruine extrait`);
  for (const item of [...zones, ...wallPolygons]) {
    if (item.points.length < 3) fail(`${board.id}: contour dégénéré pour ${item.id}`);
  }
  return { zones, walls: wallPolygons };
}

/**
 * Image de contrôle : le rectangle de jeu, contours des socles en magenta et
 * des murs en cyan, pour relire l'extraction à l'œil.
 */
function previewPng(image, board, terrain) {
  const { left, top, width, height } = board.playArea;
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((y + top) * image.width + (x + left)) * image.channels;
      out.set([image.data[src], image.data[src + 1], image.data[src + 2]], (y * width + x) * 3);
    }
  }
  const plot = (x, y, color) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = Math.round(x - left) + dx;
        const py = Math.round(y - top) + dy;
        if (px >= 0 && py >= 0 && px < width && py < height) out.set(color, (py * width + px) * 3);
      }
    }
  };
  const stroke = (points, color) => {
    points.forEach(([ax, ay], i) => {
      const [bx, by] = points[(i + 1) % points.length];
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
      for (let s = 0; s <= steps; s += 1) plot(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, color);
    });
  };
  // Une couleur par socle, pour voir d'un coup d'œil deux socles fusionnés à tort.
  const palette = [[255, 0, 255], [255, 220, 0], [0, 230, 60], [255, 90, 0], [150, 0, 255], [255, 255, 255]];
  terrain.zones.forEach((z, i) => stroke(z.points, palette[i % palette.length]));
  terrain.walls.forEach((z) => stroke(z.points, [0, 200, 255]));
  return encodePng(width, height, out);
}

function encodePng(width, height, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits par canal
  header[9] = 2; // RVB
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const referential = JSON.parse(readFileSync(BOARDS_JSON, 'utf8'));
  const boards = {};
  let zoneCount = 0;
  let wallCount = 0;
  if (args.preview) mkdirSync(args.preview, { recursive: true });

  for (const board of referential.boards) {
    const imagePath = join(PROJECT_ROOT, 'src', board.assets['no-measurements']);
    let image;
    try {
      image = decodePng(imagePath);
    } catch (err) {
      fail(`${board.id}: image illisible — ${err.message}`);
    }
    const terrain = extractTerrain(image, board);
    boards[board.id] = terrain;
    zoneCount += terrain.zones.length;
    wallCount += terrain.walls.length;
    console.log(`${board.id}: ${terrain.zones.length} socles, ${terrain.walls.length} murs`);
    if (args.preview) writeFileSync(join(args.preview, `${board.id}.png`), previewPng(image, board, terrain));
  }

  const output = {
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    stats: { boards: Object.keys(boards).length, zones: zoneCount, walls: wallCount },
    boards,
  };
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(output) + '\n');
  console.log(`${args.out}: ${output.stats.boards} plateaux, ${zoneCount} socles, ${wallCount} murs`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof IngestError ? `Échec de l'ingestion : ${err.message}` : err);
    process.exit(1);
  });
}
