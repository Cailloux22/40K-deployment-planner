/**
 * RT_40 — sélection multiple de tokens (RG_30, RG_31).
 *
 * Fonctions pures, en pixels d'asset (RT_04) : le test d'appartenance à un
 * rectangle de sélection porte sur le polygone du socle, pas sur son centre.
 */

import { BaseFootprint, Point, baseOutline, polygonsOverlap } from './geometry';

/** Rectangle de sélection, coins opposés quelconques. */
export interface SelectionRect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Écart maximal, en pixels d'asset, entre un ovale et le polygone qui l'approche. */
const OUTLINE_TOLERANCE_PX = 1;

/** RT_40: délai maximal entre les deux appuis d'un double clic. */
export const DOUBLE_TAP_MS = 300;
/** RT_40: écart maximal, en pixels CSS, entre les deux appuis d'un double clic. */
export const DOUBLE_TAP_DISTANCE_PX = 10;

/** RG_30: le socle est-il touché, même partiellement, par le rectangle ? */
export function rectTouchesBase(rect: SelectionRect, base: BaseFootprint): boolean {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  const corners: Point[] = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  return polygonsOverlap(corners, baseOutline(base, OUTLINE_TOLERANCE_PX));
}

/** RG_30: identifiants des tokens dont le socle est touché par le rectangle. */
export function idsTouchedByRect(
  items: readonly { readonly id: string; readonly base: BaseFootprint }[],
  rect: SelectionRect,
): string[] {
  return items.filter((item) => rectTouchesBase(rect, item.base)).map((item) => item.id);
}

/**
 * RT_40: deux appuis successifs forment-ils un double clic ? Même token, moins
 * de 300 ms et moins de 10 px d'écart.
 */
export function isDoubleTap(
  previous: { readonly id: string; readonly time: number; readonly x: number; readonly y: number } | null,
  current: { readonly id: string; readonly time: number; readonly x: number; readonly y: number },
): boolean {
  return (
    !!previous &&
    previous.id === current.id &&
    current.time - previous.time <= DOUBLE_TAP_MS &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <= DOUBLE_TAP_DISTANCE_PX
  );
}

/**
 * RG_15/RT_40: unité commune à tous les tokens sélectionnés, sur laquelle le
 * bandeau bascule ; nulle si la sélection est vide ou mêle plusieurs unités.
 */
export function soleSelectedUnit(
  placements: readonly { readonly idUnite: string; readonly idModele: string }[],
  selection: ReadonlySet<string>,
): string | null {
  const unitIds = new Set(placements.filter((p) => selection.has(p.idModele)).map((p) => p.idUnite));
  return unitIds.size === 1 ? [...unitIds][0] : null;
}
