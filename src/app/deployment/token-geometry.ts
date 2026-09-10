/**
 * RT_05 — échelle des tokens.
 *
 * La taille d'un token est calculée à partir du diamètre réel du socle (en
 * millimètres) et de l'échelle du plateau affiché, pour que deux socles de
 * tailles différentes restent proportionnellement corrects à tout niveau de
 * zoom (RG_17 sur l'écran de placement, RT_16 en consultation plein écran).
 *
 * Toutes les coordonnées de placement (RT_04) sont exprimées dans le repère
 * de l'image du référentiel (RT_12), en pixels d'asset : elles sont donc
 * indépendantes de la taille d'affichage et survivent à un changement de
 * zoom, de terminal ou d'orientation.
 */

import { BaseShape, Board, BoardReferential } from '../models/referential.models';

export const MM_PER_INCH = 25.4;

/**
 * Pixels d'asset par millimètre réel, déduits du rectangle mesuré du plateau
 * (`board.playArea`) et de sa taille physique (`referential.boardInches`).
 */
export function assetPixelsPerMm(board: Board, referential: BoardReferential): number {
  const horizontal = board.playArea.width / (referential.boardInches.width * MM_PER_INCH);
  const vertical = board.playArea.height / (referential.boardInches.height * MM_PER_INCH);
  // Les deux axes ne diffèrent que du rendu du trait de cadre (< 0,5 %) : la
  // moyenne évite de privilégier arbitrairement une direction.
  return (horizontal + vertical) / 2;
}

/** Dimensions d'un token en pixels d'asset, avant mise à l'échelle d'affichage. */
export interface TokenSize {
  readonly width: number;
  readonly height: number;
}

/**
 * RT_05/EX_03: dimensions du token respectant la forme et la taille réelle du
 * socle. Un socle rond donne un cercle, un ovale une ellipse dont le grand
 * axe est orienté par la rotation du placement (RG_20) ; un gabarit
 * rectangulaire (RT_26) partage les mêmes dimensions, le rendu (cercle/ellipse
 * ou rectangle) étant décidé par les composants d'affichage sur `shape.shape`.
 */
export function tokenSize(shape: BaseShape, pixelsPerMm: number): TokenSize {
  return {
    width: shape.widthMm * pixelsPerMm,
    height: shape.lengthMm * pixelsPerMm,
  };
}

/** Bornes du plateau, pour empêcher un token de sortir de l'aire de jeu. */
export function clampToPlayArea(board: Board, x: number, y: number): { x: number; y: number } {
  const { left, top, right, bottom } = board.playArea;
  return {
    x: Math.min(Math.max(x, left), right),
    y: Math.min(Math.max(y, top), bottom),
  };
}

/**
 * RT_19 — zoom fixe de l'écran de placement : ajustement « contenir »
 * (contain-fit), c'est-à-dire un ratio unique
 * `min(largeur dispo / largeur image, hauteur dispo / hauteur image)`.
 *
 * Comme tous les assets du référentiel partagent les mêmes dimensions, ce
 * facteur ne dépend pas du plateau chargé : il n'est recalculé que lorsque
 * l'espace disponible change (rotation de l'écran, redimensionnement).
 */
export function containFitScale(
  available: { width: number; height: number },
  asset: { width: number; height: number },
): number {
  if (available.width <= 0 || available.height <= 0) return 0;
  return Math.min(available.width / asset.width, available.height / asset.height);
}
