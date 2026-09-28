/**
 * RT_36 — calcul de la cohésion d'unité (RG_26).
 *
 * Tout le calcul se fait en pouces réels, sur des socles décrits par leur
 * centre, leur forme, leurs dimensions et leur rotation : il ne dépend ni de
 * l'affichage ni du plateau, seulement de la conversion de RT_05 faite une
 * fois par `coherencyBase`.
 */

import { Placement } from '../models/domain.models';
import { BaseShape } from '../models/referential.models';
import { BaseFootprint, Point, baseOutline } from './geometry';
import { MM_PER_INCH } from './token-geometry';

/** RG_26: contiguïté — chaque modèle à 2" au plus d'au moins un autre. */
export const COHERENCY_LINK_INCHES = 2;
/** RG_26: étendue — chaque modèle à 9" au plus de chacun des autres. */
export const COHERENCY_SPAN_INCHES = 9;
/**
 * RT_36: tolérance des seuils, et écart maximal admis entre un ovale et le
 * polygone qui l'approche — un token posé pile au seuil n'est pas refusé.
 */
export const COHERENCY_TOLERANCE_INCHES = 0.01;

/** Un socle posé, en pouces réels, prêt pour le calcul de distance. */
export interface CoherencyBase extends BaseFootprint {
  readonly id: string;
}

/**
 * RT_36/RT_05: un placement (RT_04, en pixels d'asset) et son socle (en mm),
 * ramenés en pouces réels.
 */
export function coherencyBase(placement: Placement, shape: BaseShape, pixelsPerMm: number): CoherencyBase {
  const inchesPerPixel = 1 / (pixelsPerMm * MM_PER_INCH);
  return {
    id: placement.idModele,
    x: placement.x * inchesPerPixel,
    y: placement.y * inchesPerPixel,
    rotation: placement.rotation,
    shape: shape.shape,
    width: shape.widthMm / MM_PER_INCH,
    length: shape.lengthMm / MM_PER_INCH,
  };
}

/** RT_36: contour convexe du socle, l'ovale approché à la tolérance près. */
function outline(base: CoherencyBase): Point[] {
  return baseOutline(base, COHERENCY_TOLERANCE_INCHES);
}

/** Test de l'axe séparateur : deux polygones convexes se chevauchent-ils ? */
function overlaps(p: readonly Point[], q: readonly Point[]): boolean {
  for (const polygon of [p, q]) {
    for (let i = 0; i < polygon.length; i += 1) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[(i + 1) % polygon.length];
      const nx = y1 - y2;
      const ny = x2 - x1;
      let minP = Infinity, maxP = -Infinity, minQ = Infinity, maxQ = -Infinity;
      for (const [x, y] of p) {
        const d = x * nx + y * ny;
        minP = Math.min(minP, d);
        maxP = Math.max(maxP, d);
      }
      for (const [x, y] of q) {
        const d = x * nx + y * ny;
        minQ = Math.min(minQ, d);
        maxQ = Math.max(maxQ, d);
      }
      if (maxP < minQ || maxQ < minP) return false;
    }
  }
  return true;
}

function pointToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Plus courte distance entre deux polygones convexes disjoints ou non. */
function polygonGap(p: readonly Point[], q: readonly Point[]): number {
  if (overlaps(p, q)) return 0;
  let best = Infinity;
  for (const [from, to] of [[p, q], [q, p]] as const) {
    for (const point of from) {
      for (let i = 0; i < to.length; i += 1) {
        best = Math.min(best, pointToSegment(point, to[i], to[(i + 1) % to.length]));
      }
    }
  }
  return best;
}

/**
 * RG_26/RT_36: plus courte distance, en pouces, entre les bords de deux
 * socles — nulle s'ils se touchent ou se chevauchent.
 */
export function baseGap(a: CoherencyBase, b: CoherencyBase): number {
  // RT_36: deux socles ronds — calcul exact.
  if (a.shape === 'round' && b.shape === 'round') {
    return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.width / 2 - b.width / 2);
  }
  return polygonGap(outline(a), outline(b));
}

function circumradius(base: CoherencyBase): number {
  return base.shape === 'rectangle'
    ? Math.hypot(base.width, base.length) / 2
    : Math.max(base.width, base.length) / 2;
}

function inradius(base: CoherencyBase): number {
  return Math.min(base.width, base.length) / 2;
}

/**
 * RT_36: `baseGap(a, b) ≤ limit`, tolérance comprise. Les cercles circonscrit
 * et inscrit de chaque socle encadrent la distance : le calcul exact n'est
 * fait que lorsque cet encadrement ne suffit pas à trancher.
 */
function withinGap(a: CoherencyBase, b: CoherencyBase, limit: number): boolean {
  const bound = limit + COHERENCY_TOLERANCE_INCHES;
  const centers = Math.hypot(a.x - b.x, a.y - b.y);
  if (centers - circumradius(a) - circumradius(b) > bound) return false;
  if (centers - inradius(a) - inradius(b) <= bound) return true;
  return baseGap(a, b) <= bound;
}

/**
 * RT_36: composantes connexes du graphe « à 2" au plus », chacune donnée par
 * les rangs de ses socles. Le parcours part toujours du plus petit rang non
 * visité : les composantes sortent dans l'ordre de leur socle le plus ancien.
 */
function linkComponents(bases: readonly CoherencyBase[]): number[][] {
  const neighbours = bases.map(() => [] as number[]);
  for (let i = 0; i < bases.length; i += 1) {
    for (let j = i + 1; j < bases.length; j += 1) {
      if (withinGap(bases[i], bases[j], COHERENCY_LINK_INCHES)) {
        neighbours[i].push(j);
        neighbours[j].push(i);
      }
    }
  }
  const visited = new Set<number>();
  const components: number[][] = [];
  for (let start = 0; start < bases.length; start += 1) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of neighbours[current]) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * RG_26: les socles posés d'une unité sont-ils en cohésion ? Un seul socle
 * (ou aucun) l'est toujours.
 */
export function isCoherent(bases: readonly CoherencyBase[]): boolean {
  if (bases.length <= 1) return true;
  // RG_26: étendue de 9" sur toutes les paires.
  for (let i = 0; i < bases.length; i += 1) {
    for (let j = i + 1; j < bases.length; j += 1) {
      if (!withinGap(bases[i], bases[j], COHERENCY_SPAN_INCHES)) return false;
    }
  }
  // RG_26: contiguïté — une seule chaîne continue.
  return linkComponents(bases).length === 1;
}

/**
 * RG_26/RT_36: après le retrait d'un token, identifiants des socles à retirer
 * en plus pour rétablir la contiguïté. Le groupe gardant le plus de socles est
 * conservé ; à égalité, celui qui contient le socle le plus ancien — `bases`
 * étant dans l'ordre des placements, donc des dépôts. Retirer un socle ne
 * peut pas faire dépasser l'étendue de 9" : seule la contiguïté est rétablie.
 */
export function detachedAfterRemoval(bases: readonly CoherencyBase[]): string[] {
  const components = linkComponents(bases);
  if (components.length <= 1) return [];
  // Composantes dans l'ordre de leur socle le plus ancien : la première des
  // plus grandes est celle à conserver en cas d'égalité.
  const kept = components.reduce((best, component) => (component.length > best.length ? component : best));
  return components
    .filter((component) => component !== kept)
    .flat()
    .map((index) => bases[index].id);
}
