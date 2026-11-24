/**
 * RG_61/RT_80 — géométrie du cercle de portée d'un token.
 *
 * Le contour est l'ensemble des points situés à X" exactement du bord du
 * socle, dans la vue de dessus — la même mesure bord à bord que RG_26. Il est
 * exprimé en pixels d'asset (RT_04/RT_05), dans le repère local du token :
 * centré sur son centre, avant sa rotation (le rendu applique la même
 * translation et la même rotation que le token, RT_81).
 */

import { BaseShape } from '../models/referential.models';
import { MM_PER_INCH } from './token-geometry';

/** RG_60/RT_80: rayons proposés, dans l'ordre de la colonne. */
export const RANGE_RING_RADII = [3, 6, 8, 9, 12] as const;
export type RangeRingRadius = (typeof RANGE_RING_RADII)[number];

/** RT_80: écart maximal toléré entre le polygone d'un ovale et la courbe réelle. */
const OVAL_TOLERANCE_INCHES = 0.01;
const MIN_OVAL_VERTICES = 32;
const MAX_OVAL_VERTICES = 4096;

/** RT_81: forme SVG du contour, en pixels d'asset, repère local du token. */
export type RangeRingOutline =
  | { readonly kind: 'circle'; readonly r: number }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly r: number;
    }
  | { readonly kind: 'path'; readonly d: string };

/**
 * RG_61/RT_80: contour à `radiusInches` du bord du socle.
 * - rond : cercle de rayon D/2 + X ;
 * - rectangle (RT_28) : rectangle (L + 2X) × (l + 2X) à coins arrondis de rayon X ;
 * - ovale : courbe parallèle à l'ellipse à la distance X, en polygone fermé.
 *
 * Les axes suivent ceux du token (RT_05) : `widthMm` horizontal, `lengthMm`
 * vertical, avant rotation.
 */
export function rangeRingOutline(shape: BaseShape, radiusInches: number, pixelsPerMm: number): RangeRingOutline {
  const offset = radiusInches * MM_PER_INCH * pixelsPerMm;
  const a = (shape.widthMm * pixelsPerMm) / 2;
  const b = (shape.lengthMm * pixelsPerMm) / 2;

  if (shape.shape === 'rectangle') {
    return { kind: 'rect', x: -a - offset, y: -b - offset, width: 2 * (a + offset), height: 2 * (b + offset), r: offset };
  }
  if (a === b) return { kind: 'circle', r: a + offset };

  const points = ovalOffsetPolygon(a, b, offset, OVAL_TOLERANCE_INCHES * MM_PER_INCH * pixelsPerMm);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`).join('') + 'Z';
  return { kind: 'path', d };
}

/**
 * RT_80: courbe parallèle à l'ellipse de demi-axes `a` (x) et `b` (y), à la
 * distance `offset`, échantillonnée en polygone. Chaque sommet est le point de
 * paramètre `t` de l'ellipse décalé de `offset` le long de la normale
 * extérieure ; le nombre de sommets borne la flèche de chaque corde sous
 * `tolerance` (pixels d'asset).
 */
export function ovalOffsetPolygon(
  a: number,
  b: number,
  offset: number,
  tolerance: number,
): { x: number; y: number }[] {
  const major = Math.max(a, b);
  const minor = Math.min(a, b);
  // Plus petit rayon de courbure de la courbe parallèle (extrémités du grand axe).
  const minCurvatureRadius = (minor * minor) / major + offset;
  // Vitesse maximale du point courant : |e'| ≤ grand axe, et le décalage
  // l'étire au plus du rapport des axes.
  const maxSpeed = major + (offset * major) / minor;
  // Flèche d'une corde de longueur s sur un rayon ρ : s² / 8ρ ≤ tolérance.
  const maxChord = Math.sqrt(8 * minCurvatureRadius * Math.max(tolerance, 1e-9));
  // Multiple de 4 : les extrémités des deux axes sont des sommets exacts.
  const count =
    4 *
    Math.ceil(
      Math.min(MAX_OVAL_VERTICES, Math.max(MIN_OVAL_VERTICES, Math.ceil((2 * Math.PI * maxSpeed) / maxChord))) / 4,
    );

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = (2 * Math.PI * i) / count;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    // Normale extérieure de l'ellipse au point (a cos t, b sin t) : (b cos t, a sin t).
    const nx = b * cos;
    const ny = a * sin;
    const norm = Math.hypot(nx, ny);
    points.push({ x: a * cos + (offset * nx) / norm, y: b * sin + (offset * ny) / norm });
  }
  return points;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
