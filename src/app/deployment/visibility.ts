/**
 * RT_38 — calcul de la zone visible depuis un modèle (RG_27/RG_28).
 *
 * Tout le calcul se fait dans le repère en pixels de l'image d'asset (RT_04),
 * comme le terrain de RT_37 : aucune conversion n'est faite par point, seules
 * les longueurs en millimètres (largeur de la ligne, pas d'échantillonnage)
 * sont converties une fois avec l'échelle de RT_05.
 */

import { Placement } from '../models/domain.models';
import { BaseShape, BoardPlayArea, BoardTerrain } from '../models/referential.models';
import { BaseFootprint, Point, baseOutline, offsetPolygon, pointInPolygon, polygonsOverlap } from './geometry';
import { MM_PER_INCH } from './token-geometry';

/** RG_27: largeur de la ligne de vue imaginaire. */
export const LINE_OF_SIGHT_WIDTH_MM = 1;
/** RT_38: espacement maximal des points échantillonnés sur le contour du socle. */
export const SAMPLE_SPACING_MM = 2;
/** RT_38: même approximation des ovales que RT_36 (0,01"). */
const OUTLINE_TOLERANCE_MM = 0.01 * MM_PER_INCH;
/** Côté d'une case de la grille d'accélération, en pixels d'asset. */
const CELL_SIZE_PX = 32;
/** Écart angulaire des rayons lancés de part et d'autre de chaque sommet. */
const ANGLE_EPSILON = 1e-4;
/** Sommets du polygone de visibilité alignés à moins de cette distance fusionnés. */
const SIMPLIFY_PX = 0.25;

const WALL = 0;
const ZONE = 1;
const BORDER = 2;

type Box = readonly [number, number, number, number];

interface PreparedZone {
  /** RG_28: contour non dilaté, pour l'exception « socle dans la zone ». */
  readonly raw: readonly Point[];
  readonly rawBox: Box;
  readonly dilated: readonly Point[];
  readonly dilatedBox: Box;
}

/** Terrain d'un plateau prêt pour le lancer de rayons, préparé une fois par plateau. */
export interface PreparedTerrain {
  readonly playArea: BoardPlayArea;
  readonly pixelsPerMm: number;
  readonly zones: readonly PreparedZone[];
  readonly walls: readonly { readonly dilated: readonly Point[]; readonly box: Box }[];
  // Arêtes des obstacles dilatés et du bord du rectangle de jeu.
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly kind: Uint8Array;
  readonly zone: Int32Array;
  /** Sommets autour desquels les rayons sont lancés, en paires x, y. */
  readonly vertices: Float64Array;
  /**
   * Sommets voisins de chaque sommet dans son polygone, en quadruplets
   * (x, y précédent ; x, y suivant) ; NaN pour un croisement, qui n'en a pas.
   */
  readonly neighbours: Float64Array;
  readonly grid: {
    readonly left: number;
    readonly top: number;
    readonly cols: number;
    readonly rows: number;
    /** Arêtes de la case c : `items[start[c] .. start[c + 1]]`. */
    readonly start: Int32Array;
    readonly items: Int32Array;
  };
}

function boxOf(points: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function inBox([x, y]: Point, box: Box): boolean {
  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
}

/**
 * RT_38: prépare le terrain d'un plateau (RT_37) — dilatation de 0,5 mm,
 * arêtes étiquetées, grille d'accélération et sommets d'événement, dont les
 * croisements entre contours (un mur à cheval sur le contour d'un socle).
 */
export function prepareTerrain(terrain: BoardTerrain, playArea: BoardPlayArea, pixelsPerMm: number): PreparedTerrain {
  // RG_27/RT_38: une ligne de 1 mm est dégagée si sa médiane passe à 0,5 mm
  // au moins de tout obstacle.
  const clearance = (LINE_OF_SIGHT_WIDTH_MM / 2) * pixelsPerMm;
  const zones: PreparedZone[] = terrain.zones.map(({ points }) => {
    const dilated = offsetPolygon(points, clearance);
    return { raw: points, rawBox: boxOf(points), dilated, dilatedBox: boxOf(dilated) };
  });
  const walls = terrain.walls.map(({ points }) => {
    const dilated = offsetPolygon(points, clearance);
    return { dilated, box: boxOf(dilated) };
  });

  const segments: { a: Point; b: Point; kind: number; zone: number }[] = [];
  const vertices: number[] = [];
  const neighbours: number[] = [];
  const addPolygon = (points: readonly Point[], kind: number, zone: number) => {
    points.forEach((a, i) => {
      const previous = points[(i - 1 + points.length) % points.length];
      const next = points[(i + 1) % points.length];
      segments.push({ a, b: next, kind, zone });
      vertices.push(a[0], a[1]);
      neighbours.push(previous[0], previous[1], next[0], next[1]);
    });
  };
  zones.forEach((zone, index) => addPolygon(zone.dilated, ZONE, index));
  walls.forEach((wall) => addPolygon(wall.dilated, WALL, -1));
  const { left, top, right, bottom } = playArea;
  addPolygon([[left, top], [right, top], [right, bottom], [left, bottom]], BORDER, -1);

  const n = segments.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  const kind = new Uint8Array(n);
  const zone = new Int32Array(n);
  segments.forEach((s, i) => {
    ax[i] = s.a[0];
    ay[i] = s.a[1];
    bx[i] = s.b[0];
    by[i] = s.b[1];
    kind[i] = s.kind;
    zone[i] = s.zone;
  });

  // La grille déborde d'une case autour du rectangle de jeu : un rayon touche
  // toujours le bord avant d'en sortir.
  const gridLeft = left - CELL_SIZE_PX;
  const gridTop = top - CELL_SIZE_PX;
  const cols = Math.ceil((right - gridLeft) / CELL_SIZE_PX) + 2;
  const rows = Math.ceil((bottom - gridTop) / CELL_SIZE_PX) + 2;
  const cellsOf = (i: number): number[] => {
    const c0 = Math.max(0, Math.floor((Math.min(ax[i], bx[i]) - gridLeft) / CELL_SIZE_PX));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(ax[i], bx[i]) - gridLeft) / CELL_SIZE_PX));
    const r0 = Math.max(0, Math.floor((Math.min(ay[i], by[i]) - gridTop) / CELL_SIZE_PX));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(ay[i], by[i]) - gridTop) / CELL_SIZE_PX));
    const cells: number[] = [];
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) cells.push(r * cols + c);
    return cells;
  };
  const perCell: number[][] = Array.from({ length: cols * rows }, () => []);
  for (let i = 0; i < n; i += 1) for (const cell of cellsOf(i)) perCell[cell].push(i);
  const start = new Int32Array(cols * rows + 1);
  perCell.forEach((items, c) => (start[c + 1] = start[c] + items.length));
  const items = new Int32Array(start[cols * rows]);
  perCell.forEach((cellItems, c) => items.set(cellItems, start[c]));

  // Sommets d'événement : ceux des obstacles et du bord, plus les croisements
  // entre arêtes de polygones différents, où l'ordre des arêtes le long d'un
  // rayon change.
  const seen = new Set<string>();
  for (const cellItems of perCell) {
    for (let p = 0; p < cellItems.length; p += 1) {
      for (let q = p + 1; q < cellItems.length; q += 1) {
        const i = cellItems[p];
        const j = cellItems[q];
        if (kind[i] === kind[j] && zone[i] === zone[j] && kind[i] !== WALL) continue;
        const crossing = segmentCrossing(ax[i], ay[i], bx[i], by[i], ax[j], ay[j], bx[j], by[j]);
        if (!crossing) continue;
        const key = `${crossing[0].toFixed(2)},${crossing[1].toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        vertices.push(crossing[0], crossing[1]);
        neighbours.push(NaN, NaN, NaN, NaN);
      }
    }
  }

  return {
    playArea,
    pixelsPerMm,
    zones,
    walls,
    ax,
    ay,
    bx,
    by,
    kind,
    zone,
    vertices: Float64Array.from(vertices),
    neighbours: Float64Array.from(neighbours),
    grid: { left: gridLeft, top: gridTop, cols, rows, start, items },
  };
}

function segmentCrossing(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): Point | null {
  const denominator = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / denominator;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / denominator;
  // Les extrémités communes sont déjà des sommets d'événement.
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

/**
 * RT_38/RT_05: un placement (RT_04) et son socle, en pixels d'asset — les
 * dimensions du socle converties comme celles du token affiché (RT_05).
 */
export function visibilityBase(placement: Placement, shape: BaseShape, pixelsPerMm: number): BaseFootprint {
  return {
    x: placement.x,
    y: placement.y,
    rotation: placement.rotation,
    shape: shape.shape,
    width: shape.widthMm * pixelsPerMm,
    length: shape.lengthMm * pixelsPerMm,
  };
}

/** Échantillons du contour du socle : ses sommets et des points espacés d'au plus `spacing`. */
function contourSamples(outline: readonly Point[], spacing: number): Point[] {
  const samples: Point[] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
    for (let s = 0; s < steps; s += 1) {
      samples.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
    }
  });
  return samples;
}

/**
 * RG_27/RG_28: zone visible depuis un socle, sous forme de polygones étoilés
 * — un par point échantillonné sur le contour du socle, tous parcourus dans
 * le même sens (angle croissant). La zone est leur réunion ; elle n'est pas
 * calculée, le rendu s'en charge (RT_39).
 */
export function visibleZone(base: BaseFootprint, terrain: PreparedTerrain): Point[][] {
  const outline = baseOutline(base, OUTLINE_TOLERANCE_MM * terrain.pixelsPerMm);
  const outlineBox = boxOf(outline);

  // RG_28, première exception: une zone que le socle chevauche ne lui masque
  // rien. Ses murs, eux, restent des obstacles.
  const exempt = new Uint8Array(terrain.zones.length);
  terrain.zones.forEach((zone, i) => {
    if (boxesOverlap(zone.rawBox, outlineBox) && polygonsOverlap(outline, zone.raw)) exempt[i] = 1;
  });

  const seen = new Uint32Array(terrain.kind.length);
  const stamp = { value: 0 };
  const polygons: Point[][] = [];
  const { left, top, right, bottom } = terrain.playArea;
  for (const sample of contourSamples(outline, SAMPLE_SPACING_MM * terrain.pixelsPerMm)) {
    const [sx, sy] = sample;
    if (sx <= left || sx >= right || sy <= top || sy >= bottom) continue;
    // Un point pris dans un mur ne voit rien.
    if (terrain.walls.some((wall) => inBox(sample, wall.box) && pointInPolygon(sample, wall.dilated))) continue;
    // Un point à moins de 0,5 mm d'une zone — dans sa marge de dilatation —
    // est tenu pour dans la zone : sans quoi il la verrait de l'intérieur.
    const sampleExempt = Uint8Array.from(exempt);
    terrain.zones.forEach((zone, i) => {
      if (!sampleExempt[i] && inBox(sample, zone.dilatedBox) && pointInPolygon(sample, zone.dilated)) sampleExempt[i] = 1;
    });
    const polygon = visibilityPolygon(sx, sy, terrain, sampleExempt, seen, stamp);
    if (polygon.length >= 3) polygons.push(polygon);
  }
  return polygons;
}

function visibilityPolygon(
  sx: number,
  sy: number,
  terrain: PreparedTerrain,
  exempt: Uint8Array,
  seen: Uint32Array,
  stamp: { value: number },
): Point[] {
  const { vertices, neighbours } = terrain;
  const count = vertices.length / 2;
  const buffer = new Float64Array(count * 2);
  let size = 0;
  for (let v = 0; v < count; v += 1) {
    const vx = vertices[2 * v];
    const vy = vertices[2 * v + 1];
    const angle = Math.atan2(vy - sy, vx - sx);
    // Un sommet dont les deux arêtes restent du même côté du rayon est une
    // silhouette : la vue y saute de l'obstacle au lointain, et un rayon de
    // chaque côté est nécessaire. Un autre sommet n'est qu'un coin du
    // polygone de visibilité : un rayon suffit. Un croisement de contours peut
    // faire sauter la vue (un mur passe devant une zone) : il est traité comme
    // une silhouette.
    const px = neighbours[4 * v];
    let silhouette = true;
    if (!Number.isNaN(px)) {
      const rx = vx - sx;
      const ry = vy - sy;
      const before = rx * (neighbours[4 * v + 1] - vy) - ry * (px - vx);
      const after = rx * (neighbours[4 * v + 3] - vy) - ry * (neighbours[4 * v + 2] - vx);
      silhouette = before * after > 0;
    }
    if (silhouette) {
      buffer[size++] = angle - ANGLE_EPSILON;
      buffer[size++] = angle + ANGLE_EPSILON;
    } else {
      buffer[size++] = angle;
    }
  }
  const angles = buffer.subarray(0, size).sort();

  const points: Point[] = [];
  for (let i = 0; i < angles.length; i += 1) {
    if (i > 0 && angles[i] === angles[i - 1]) continue;
    const dx = Math.cos(angles[i]);
    const dy = Math.sin(angles[i]);
    stamp.value += 1;
    const t = castRay(sx, sy, dx, dy, terrain, exempt, seen, stamp.value);
    points.push([sx + dx * t, sy + dy * t]);
  }
  return simplifyCollinear(points);
}

/**
 * RG_28/RT_38: distance parcourue par un rayon avant d'être arrêté. Un mur ou
 * le bord l'arrête au premier impact. Le contour d'une zone, lui, le laisse
 * entrer : le rayon s'arrête au second impact — la sortie de la zone ou un
 * autre obstacle —, les points de la zone qu'il traverse étant vus en vertu
 * de la seconde exception de RG_28.
 */
function castRay(
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  terrain: PreparedTerrain,
  exempt: Uint8Array,
  seen: Uint32Array,
  stamp: number,
): number {
  const { grid, ax, ay, bx, by, kind, zone } = terrain;
  let cx = Math.floor((sx - grid.left) / CELL_SIZE_PX);
  let cy = Math.floor((sy - grid.top) / CELL_SIZE_PX);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  let tMaxX = dx !== 0 ? (grid.left + (cx + (dx > 0 ? 1 : 0)) * CELL_SIZE_PX - sx) / dx : Infinity;
  let tMaxY = dy !== 0 ? (grid.top + (cy + (dy > 0 ? 1 : 0)) * CELL_SIZE_PX - sy) / dy : Infinity;
  const tDeltaX = dx !== 0 ? CELL_SIZE_PX / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? CELL_SIZE_PX / Math.abs(dy) : Infinity;

  // Les deux premiers impacts, triés.
  let t1 = Infinity;
  let k1 = -1;
  let z1 = -1;
  let t2 = Infinity;

  while (cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows) {
    const cell = cy * grid.cols + cx;
    for (let k = grid.start[cell]; k < grid.start[cell + 1]; k += 1) {
      const s = grid.items[k];
      if (seen[s] === stamp) continue;
      seen[s] = stamp;
      if (kind[s] === ZONE && exempt[zone[s]]) continue;
      const ex = bx[s] - ax[s];
      const ey = by[s] - ay[s];
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-12) continue;
      const qx = ax[s] - sx;
      const qy = ay[s] - sy;
      const t = (qx * ey - qy * ex) / denominator;
      const u = (qx * dy - qy * dx) / denominator;
      if (t <= 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      // Un rayon qui passe par un sommet touche les deux arêtes qui s'y
      // rejoignent : c'est un seul impact.
      if (kind[s] === ZONE && Math.abs(t - t1) < 1e-6 && z1 === zone[s] && k1 === ZONE) continue;
      if (t < t1) {
        t2 = t1;
        t1 = t;
        k1 = kind[s];
        z1 = zone[s];
      } else if (t < t2) {
        t2 = t;
      }
    }
    const stop = k1 === -1 ? Infinity : k1 === ZONE ? t2 : t1;
    const cellExit = Math.min(tMaxX, tMaxY);
    if (stop <= cellExit) return stop;
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
  }
  // Sorti de la grille sans arrêt : ne se produit pas, le bord étant toujours
  // touché avant. Par prudence, on s'en tient au dernier impact connu.
  if (k1 === -1) return 0;
  return k1 === ZONE && t2 !== Infinity ? t2 : t1;
}

function simplifyCollinear(points: Point[]): Point[] {
  if (points.length < 4) return points;
  const kept: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [ax, ay] = kept[kept.length - 1];
    const [px, py] = points[i];
    const [bx, by] = points[i + 1];
    const length = Math.hypot(bx - ax, by - ay);
    const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
    if (distance > SIMPLIFY_PX) kept.push(points[i]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/** RT_39: les polygones de la zone visible en un seul chemin SVG. */
export function visibleZonePath(polygons: readonly (readonly Point[])[]): string {
  return polygons
    .map((polygon) => `M${polygon.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`)
    .join('');
}
