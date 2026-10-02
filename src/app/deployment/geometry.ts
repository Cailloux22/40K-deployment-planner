/**
 * Géométrie plane partagée par la cohésion d'unité (RT_36) et la zone visible
 * (RT_38). Unités libres : chaque appelant fournit des coordonnées et une
 * tolérance exprimées dans la même unité (pouces pour RT_36, pixels d'asset
 * pour RT_38).
 */

import { BaseShapeKind } from '../models/referential.models';

export type Point = readonly [number, number];

/** Un socle posé : centre, forme, dimensions et rotation. */
export interface BaseFootprint {
  readonly x: number;
  readonly y: number;
  /** RG_20: rotation en degrés, même sens que le rendu SVG (RT_22). */
  readonly rotation: number;
  readonly shape: BaseShapeKind;
  /** Étendue sur l'axe x du token avant rotation (RT_05 : `widthMm`). */
  readonly width: number;
  /** Étendue sur l'axe y du token avant rotation (RT_05 : `lengthMm`). */
  readonly length: number;
}

/**
 * RT_36: nombre de côtés du polygone inscrit dans une ellipse de plus grand
 * demi-axe `radius` pour que l'écart à la courbe reste sous `tolerance`.
 * L'ellipse étant l'image affine d'un cercle, cet écart est au plus celui du
 * polygone inscrit dans le cercle de rayon `radius`, soit `r·(1 − cos(π/n))`.
 */
export function ellipseSides(radius: number, tolerance: number): number {
  if (radius <= tolerance) return 8;
  return Math.max(8, Math.ceil(Math.PI / Math.acos(1 - tolerance / radius)));
}

/** RT_36: contour convexe du socle, tourné et placé sur le plateau. */
export function baseOutline(base: BaseFootprint, tolerance: number): Point[] {
  const a = base.width / 2;
  const b = base.length / 2;
  let local: Point[];
  if (base.shape === 'rectangle') {
    local = [[-a, -b], [a, -b], [a, b], [-a, b]];
  } else {
    const sides = ellipseSides(Math.max(a, b), tolerance);
    local = Array.from({ length: sides }, (_, i) => {
      const t = (2 * Math.PI * i) / sides;
      return [a * Math.cos(t), b * Math.sin(t)] as Point;
    });
  }
  // Même rotation que `rotate(θ)` en SVG, dans un repère à y descendant.
  const angle = (base.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return local.map(([x, y]) => [base.x + x * cos - y * sin, base.y + x * sin + y * cos]);
}

/** Point dans un polygone simple, convexe ou non (règle pair-impair). */
export function pointInPolygon([px, py]: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function cross(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/** Deux segments se coupent-ils (contact compris) ? */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const onSegment = (p: Point, q: Point, r: Point) =>
    Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (
    (d1 === 0 && onSegment(c, d, a)) ||
    (d2 === 0 && onSegment(c, d, b)) ||
    (d3 === 0 && onSegment(a, b, c)) ||
    (d4 === 0 && onSegment(a, b, d))
  );
}

/** Deux polygones simples, convexes ou non, se chevauchent-ils (contact compris) ? */
export function polygonsOverlap(p: readonly Point[], q: readonly Point[]): boolean {
  if (p.some((point) => pointInPolygon(point, q)) || q.some((point) => pointInPolygon(point, p))) return true;
  for (let i = 0; i < p.length; i += 1) {
    for (let j = 0; j < q.length; j += 1) {
      if (segmentsIntersect(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length])) return true;
    }
  }
  return false;
}

/**
 * Polygone agrandi de `distance` vers l'extérieur, sommet par sommet (onglet
 * borné). Les sommets très aigus sont écrêtés à trois fois la distance : pour
 * la faible dilatation de RT_38 (0,5 mm), l'écart qui en résulte est
 * négligeable.
 */
export function offsetPolygon(points: readonly Point[], distance: number): Point[] {
  const n = points.length;
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  // Pour une aire positive, la normale extérieure d'une arête (dx, dy) est (dy, −dx).
  const sign = area >= 0 ? 1 : -1;
  const normal = (a: Point, b: Point): Point => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    return [(sign * dy) / length, (-sign * dx) / length];
  };
  return points.map((point, i) => {
    const previous = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const [n1x, n1y] = normal(previous, point);
    const [n2x, n2y] = normal(point, next);
    const denominator = 1 + n1x * n2x + n1y * n2y;
    let mx = n1x + n2x;
    let my = n1y + n2y;
    const mLength = Math.hypot(mx, my);
    if (mLength < 1e-9) return [point[0] + n1x * distance, point[1] + n1y * distance] as Point;
    // Onglet : la longueur qui place le sommet à `distance` des deux arêtes décalées.
    const miter = denominator > 1e-9 ? (distance * mLength) / denominator : Infinity;
    const length = Math.min(miter, 3 * distance);
    mx /= mLength;
    my /= mLength;
    return [point[0] + mx * length, point[1] + my * length] as Point;
  });
}

/** Nombre de millimètres dans un pouce (RT_05). */
const MILLIMETRES_PER_INCH = 25.4;

/**
 * RG_33/RT_42: longueur en pouces du segment de la règle. Les deux points sont
 * en pixels d'asset (RT_04) ; l'échelle de RT_05 les convertit en millimètres
 * réels. Vue de dessus, sans relief (comme RG_26) : distance en ligne droite.
 */
export function measureInches(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  pixelsPerMm: number,
): number {
  return Math.hypot(to.x - from.x, to.y - from.y) / pixelsPerMm / MILLIMETRES_PER_INCH;
}

/** RG_33: mesure énoncée au dixième de pouce, virgule décimale (« 6,3" »). */
export function formatInches(inches: number): string {
  return `${(Math.round(inches * 10) / 10).toFixed(1).replace('.', ',')}"`;
}

/**
 * RT_47: décalage de vue borné, en pixels CSS. La surface du plateau est
 * centrée dans la zone : sur chaque axe, elle peut glisser d'au plus la moitié
 * de ce qui dépasse, pour couvrir toujours la zone là où elle la dépasse, et
 * reste centrée (décalage nul) là où elle y tient.
 */
export function clampViewOffset(
  offset: { readonly dx: number; readonly dy: number },
  surface: { readonly width: number; readonly height: number },
  area: { readonly width: number; readonly height: number },
): { dx: number; dy: number } {
  const bound = (value: number, overflow: number) => {
    const max = Math.max(0, overflow / 2);
    // `+ 0` ramène un éventuel -0 à 0.
    return Math.min(max, Math.max(-max, value)) + 0;
  };
  return {
    dx: bound(offset.dx, surface.width - area.width),
    dy: bound(offset.dy, surface.height - area.height),
  };
}
