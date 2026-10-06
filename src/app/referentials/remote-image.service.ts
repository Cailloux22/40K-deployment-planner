import { Injectable, inject } from '@angular/core';

import { LocalStoreService } from '../data/local-store.service';
import { ConnectivityService } from '../net/connectivity.service';
import { fetchAsset } from '../pwa/asset-cache';
import { serviceWorkerControlled } from '../pwa/install-context';

/** RT_27/RT_65: une image distante en cache. */
export interface CachedRemoteImage {
  readonly id: string;
  readonly blob: Blob;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
}

/** RT_27/RT_65: délai au-delà duquel la source est jugée injoignable. */
export const REMOTE_TIMEOUT_MS = 8000;

/** RT_27/RT_65: ce qu'il faut savoir d'une image pour la résoudre. */
export interface RemoteImageRequest {
  /** Store IndexedDB du cache : `boardImages` (RT_27) ou `missionImages` (RT_65). */
  readonly store: string;
  /** Clé de l'entrée dans ce store. */
  readonly id: string;
  /** URL de la source, appelée directement en ligne ; absente = jamais de réseau. */
  readonly remoteUrl?: string;
  /** Dimensions exactes exigées d'une image distante. */
  readonly width: number;
  readonly height: number;
  /** Version embarquée, dernier recours. */
  readonly asset: string;
  /** RG_42/RG_49: image de remplacement quand la version embarquée manque hors-ligne. */
  readonly unavailable: () => string;
}

/**
 * RT_12 / RT_27 / RT_65 — chaîne de résolution commune aux images de plateau
 * et de carte de mission.
 *
 * Réseau d'abord : en ligne, l'URL distante est appelée directement ; une
 * image acceptée remplace l'entrée du cache. Hors-ligne ou en cas d'échec :
 * la dernière version en cache, puis la version embarquée. Le résultat est
 * gardé en mémoire pour la session, si bien que la source n'est interrogée
 * qu'une fois par image et par lancement.
 */
@Injectable({ providedIn: 'root' })
export class RemoteImageService {
  private readonly localStore = inject(LocalStoreService);
  private readonly connectivity = inject(ConnectivityService);

  private readonly resolved = new Map<string, Promise<string>>();

  /** URL affichable (URL d'objet ou chemin d'asset) ; ne rejette jamais. */
  imageUrl(request: RemoteImageRequest): Promise<string> {
    const key = `${request.store}/${request.id}`;
    let url = this.resolved.get(key);
    if (!url) {
      url = this.resolve(request);
      this.resolved.set(key, url);
      // RG_42/RG_49: une image indisponible n'est pas retenue pour la session —
      // elle est redemandée au prochain affichage, une fois téléchargée ou en ligne.
      void url.then((resolved) => {
        if (resolved.startsWith(UNAVAILABLE_PREFIX)) this.resolved.delete(key);
      });
    }
    return url;
  }

  private async resolve(request: RemoteImageRequest): Promise<string> {
    const { store, id, remoteUrl } = request;

    // RT_27/RT_65 étape 1: réseau direct, sans relais serveur (RT_12).
    if (remoteUrl && this.connectivity.online()) {
      const blob = await this.fetchRemote(remoteUrl, request);
      if (blob) {
        await this.localStore
          .put<CachedRemoteImage>(store, {
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

    // RT_27/RT_65 étape 2: dernière version obtenue en ligne sur cet appareil.
    const cached = await this.localStore.get<CachedRemoteImage>(store, id).catch(() => undefined);
    if (cached?.blob) return URL.createObjectURL(cached.blob);

    // RG_23/RG_49 étape 3: version livrée avec l'application.
    // RG_42 / RT_54: dans le navigateur, elle n'est sur l'appareil hors-ligne
    // que si le service worker l'a déjà rangée (affichage ou RT_56).
    if (!this.connectivity.online() && serviceWorkerControlled() && !(await fetchAsset(request.asset))) {
      return request.unavailable();
    }
    return request.asset;
  }

  /**
   * RT_12/RT_65: l'image distante n'est retenue que si c'est un PNG aux
   * dimensions du référentiel. Tout échec rend `null` (RG_09).
   */
  private async fetchRemote(url: string, request: RemoteImageRequest): Promise<Blob | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    try {
      // RT_27: revalidation du cache HTTP (la source publie un ETag).
      const res = await fetch(url, { cache: 'no-cache', signal: controller.signal });
      if (!res.ok) return null;
      const blob = await res.blob();
      const size = pngDimensions(new Uint8Array(await blob.slice(0, 24).arrayBuffer()));
      if (!size || size.width !== request.width || size.height !== request.height) return null;
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
 * RG_42/RG_49: image de remplacement d'une image non disponible hors-ligne,
 * aux dimensions de l'asset — les écrans la cadrent comme l'image réelle. Le
 * message est centré sur `(cx, cy)`, aux couleurs de la scène (RT_29).
 */
export function unavailableImage(
  size: { width: number; height: number },
  center: { x: number; y: number; fontSize: number },
  lines: readonly [string, string],
): string {
  const { x, y, fontSize } = center;
  const svg =
    `<svg data-unavailable="true" xmlns="http://www.w3.org/2000/svg" width="${size.width}" ` +
    `height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">` +
    `<rect width="100%" height="100%" fill="#11131a"/>` +
    `<text fill="#f2f2f3" font-family="sans-serif" font-size="${fontSize}" text-anchor="middle">` +
    `<tspan x="${x}" y="${y}" dy="-0.2em">${lines[0]}</tspan>` +
    `<tspan x="${x}" dy="1.3em">${lines[1]}</tspan>` +
    `</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
