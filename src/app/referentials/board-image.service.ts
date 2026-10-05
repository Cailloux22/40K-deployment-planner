import { Injectable, inject } from '@angular/core';

import { LocalStoreService, STORE_BOARD_IMAGES } from '../data/local-store.service';
import { Board, BoardVariant } from '../models/referential.models';
import { ConnectivityService } from '../net/connectivity.service';
import { fetchAsset } from '../pwa/asset-cache';
import { serviceWorkerControlled } from '../pwa/install-context';

/** RT_27: une image de plateau en cache, par variante. */
export interface CachedBoardImage {
  /** `{variante}/{nom de fichier}` — même nom pour les deux variantes (RT_12). */
  readonly id: string;
  readonly blob: Blob;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
}

/** RT_27: délai au-delà duquel la source est jugée injoignable. */
export const REMOTE_TIMEOUT_MS = 8000;

/**
 * RT_12 / RT_27 / RG_23 — résolution de l'image affichée pour un plateau.
 *
 * Réseau d'abord : en ligne, l'URL gdmissions.app du référentiel est appelée
 * directement ; une image acceptée remplace l'entrée du cache. Hors-ligne ou
 * en cas d'échec : la dernière version en cache, puis la version embarquée.
 * Le résultat est gardé en mémoire pour la session, si bien que la source
 * n'est interrogée qu'une fois par image et par lancement.
 */
@Injectable({ providedIn: 'root' })
export class BoardImageService {
  private readonly store = inject(LocalStoreService);
  private readonly connectivity = inject(ConnectivityService);

  private readonly resolved = new Map<string, Promise<string>>();

  /** URL affichable (URL d'objet ou chemin d'asset) ; ne rejette jamais. */
  imageUrl(board: Board, variant: BoardVariant): Promise<string> {
    const id = `${variant}/${board.sourceFileName}`;
    let url = this.resolved.get(id);
    if (!url) {
      url = this.resolve(id, board, variant);
      this.resolved.set(id, url);
      // RG_42: un plateau indisponible n'est pas retenu pour la session —
      // il est redemandé au prochain affichage, une fois téléchargé ou en ligne.
      void url.then((resolved) => {
        if (resolved.startsWith(UNAVAILABLE_PREFIX)) this.resolved.delete(id);
      });
    }
    return url;
  }

  private async resolve(id: string, board: Board, variant: BoardVariant): Promise<string> {
    // RT_27 étape 1: réseau direct, sans relais serveur (RT_12).
    const remoteUrl = board.remoteAssets?.[variant];
    if (remoteUrl && this.connectivity.online()) {
      const blob = await this.fetchRemote(remoteUrl, board);
      if (blob) {
        await this.store
          .put<CachedBoardImage>(STORE_BOARD_IMAGES, {
            id,
            blob,
            sourceUrl: remoteUrl,
            fetchedAt: new Date().toISOString(),
          })
          // RT_27: un cache inscriptible n'est pas une condition d'affichage.
          .catch(() => undefined);
        return URL.createObjectURL(blob);
      }
    }

    // RT_27 étape 2: dernière version obtenue en ligne sur cet appareil.
    const cached = await this.store
      .get<CachedBoardImage>(STORE_BOARD_IMAGES, id)
      .catch(() => undefined);
    if (cached?.blob) return URL.createObjectURL(cached.blob);

    // RG_23 / RT_27 étape 3: version livrée avec l'application.
    // RG_42 / RT_54: dans le navigateur, elle n'est sur l'appareil hors-ligne
    // que si le service worker l'a déjà rangée (affichage ou RT_56).
    if (
      !this.connectivity.online() &&
      serviceWorkerControlled() &&
      !(await fetchAsset(board.assets[variant]))
    ) {
      return unavailableBoardImage(board);
    }
    return board.assets[variant];
  }

  /**
   * RT_12: l'image distante n'est retenue que si c'est un PNG aux dimensions
   * du plateau mesuré — placements, `playArea` (RT_05) et terrain (RT_37) sont
   * exprimés dans le repère de cette image. Tout échec rend `null` (RG_09).
   */
  private async fetchRemote(url: string, board: Board): Promise<Blob | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    try {
      // RT_27: revalidation du cache HTTP (la source publie un ETag).
      const res = await fetch(url, { cache: 'no-cache', signal: controller.signal });
      if (!res.ok) return null;
      const blob = await res.blob();
      const size = pngDimensions(new Uint8Array(await blob.slice(0, 24).arrayBuffer()));
      if (!size || size.width !== board.width || size.height !== board.height) return null;
      return blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Dimensions lues dans l'en-tête IHDR d'un PNG, ou `null` si ce n'en est pas un. */
export function pngDimensions(header: Uint8Array): { width: number; height: number } | null {
  if (header.length < 24 || PNG_SIGNATURE.some((byte, i) => header[i] !== byte)) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const UNAVAILABLE_PREFIX = 'data:image/svg+xml;charset=utf-8,%3Csvg%20data-unavailable';

/**
 * RG_42: image de remplacement d'un plateau non disponible hors-ligne, aux
 * dimensions de l'asset — les écrans la cadrent et la rognent comme l'image
 * réelle. Le message est centré sur le plateau mesuré (`playArea`, RT_05),
 * aux couleurs de la scène (RT_29), sombre dans les deux thèmes.
 */
export function unavailableBoardImage(board: Board): string {
  const cx = board.playArea.left + board.playArea.width / 2;
  const cy = board.playArea.top + board.playArea.height / 2;
  const fontSize = Math.round(board.playArea.width / 14);
  const svg =
    `<svg data-unavailable="true" xmlns="http://www.w3.org/2000/svg" width="${board.width}" ` +
    `height="${board.height}" viewBox="0 0 ${board.width} ${board.height}">` +
    `<rect width="100%" height="100%" fill="#11131a"/>` +
    `<text fill="#f2f2f3" font-family="sans-serif" font-size="${fontSize}" text-anchor="middle">` +
    `<tspan x="${cx}" y="${cy}" dy="-0.2em">Plateau non disponible</tspan>` +
    `<tspan x="${cx}" dy="1.3em">hors-ligne</tspan>` +
    `</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
