import { Injectable, inject } from '@angular/core';

import { STORE_BOARD_IMAGES } from '../data/local-store.service';
import { Board, BoardVariant } from '../models/referential.models';
import { CachedRemoteImage, RemoteImageService, unavailableImage } from './remote-image.service';

export { REMOTE_TIMEOUT_MS, pngDimensions } from './remote-image.service';

/** RT_27: une image de plateau en cache, par variante. */
export interface CachedBoardImage extends CachedRemoteImage {
  /** `{variante}/{nom de fichier}` — même nom pour les deux variantes (RT_12). */
  readonly id: string;
}

/**
 * RT_12 / RT_27 / RG_23 — résolution de l'image affichée pour un plateau.
 *
 * RT_65: la chaîne réseau → cache → embarquée est celle de
 * `RemoteImageService`, partagée avec les cartes de mission ; ce service n'en
 * fixe que les paramètres propres aux plateaux.
 */
@Injectable({ providedIn: 'root' })
export class BoardImageService {
  private readonly images = inject(RemoteImageService);

  /** URL affichable (URL d'objet ou chemin d'asset) ; ne rejette jamais. */
  imageUrl(board: Board, variant: BoardVariant): Promise<string> {
    return this.images.imageUrl({
      store: STORE_BOARD_IMAGES,
      id: `${variant}/${board.sourceFileName}`,
      remoteUrl: board.remoteAssets?.[variant],
      // RT_12: placements, `playArea` (RT_05) et terrain (RT_37) sont
      // exprimés dans le repère de cette image — dimensions exactes exigées.
      width: board.width,
      height: board.height,
      asset: board.assets[variant],
      unavailable: () => unavailableBoardImage(board),
    });
  }
}

/**
 * RG_42: image de remplacement d'un plateau non disponible hors-ligne, aux
 * dimensions de l'asset — les écrans la cadrent et la rognent comme l'image
 * réelle. Le message est centré sur le plateau mesuré (`playArea`, RT_05),
 * aux couleurs de la scène (RT_29), sombre dans les deux thèmes.
 */
export function unavailableBoardImage(board: Board): string {
  return unavailableImage(
    board,
    {
      x: board.playArea.left + board.playArea.width / 2,
      y: board.playArea.top + board.playArea.height / 2,
      fontSize: Math.round(board.playArea.width / 14),
    },
    ['Plateau non disponible', 'hors-ligne'],
  );
}
