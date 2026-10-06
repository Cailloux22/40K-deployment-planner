import { Injectable, effect, inject, signal, untracked } from '@angular/core';

import { ConnectivityService } from '../net/connectivity.service';
import { ReferentialService } from '../referentials/referential.service';
import { fetchAsset, isAssetCached } from './asset-cache';
import { serviceWorkerControlled } from './install-context';
import { InstallService } from './install.service';

/**
 * RG_42 — état du téléchargement des plateaux :
 * - `unsupported` : pas de service worker (APK, build de développement) ;
 * - `awaiting-consent` : mode économie de données, attente de l'action des Réglages ;
 * - `downloading` : téléchargement en cours ;
 * - `paused` : hors-ligne, reprise au retour du réseau ;
 * - `incomplete` : des images ont échoué, retentées au lancement suivant ;
 * - `ready` : tous les plateaux et cartes de mission sont disponibles hors-ligne.
 */
export type BoardPrefetchStatus =
  | 'unsupported'
  | 'awaiting-consent'
  | 'downloading'
  | 'paused'
  | 'incomplete'
  | 'ready';

/**
 * RT_56 — téléchargement des images de plateaux embarquées en arrière-plan.
 *
 * Chaque image est demandée une à une en passant par le service worker : il la
 * sert depuis son groupe `boards` (RT_54) si elle y est, sinon il la télécharge
 * et l'y range — hors-ligne, une image absente échoue sans requête réseau. Le cache IndexedDB des versions
 * distantes (RT_27) n'est pas concerné : il reste prioritaire à l'affichage.
 *
 * RG_49/RT_65: les cartes de mission (groupe `missions`) sont parcourues dans
 * la même boucle, après les plateaux, et comptées avec eux.
 */
@Injectable({ providedIn: 'root' })
export class BoardPrefetchService {
  private readonly referential = inject(ReferentialService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly install = inject(InstallService);

  readonly status = signal<BoardPrefetchStatus>('unsupported');
  readonly total = signal(0);
  readonly present = signal(0);

  private running = false;
  private consented = false;

  constructor() {
    // RT_56: le retour en ligne reprend une boucle suspendue.
    effect(() => {
      this.connectivity.reconnections();
      untracked(() => {
        if (this.status() === 'paused') void this.run(true);
      });
    });

    // RT_56: à la première visite, la page n'est contrôlée qu'une fois le
    // service worker installé — le téléchargement démarre à ce moment-là.
    globalThis.navigator?.serviceWorker?.addEventListener('controllerchange', () => {
      void this.start();
    });
  }

  /** RT_56: démarrage automatique, une fois l'application stable. */
  async start(): Promise<void> {
    if (!this.install.webApp || !serviceWorkerControlled()) {
      this.status.set('unsupported');
      return;
    }
    // RG_42: en économie de données, seul l'état présent est compté.
    await this.run(this.consented || !saveDataRequested());
  }

  /** RG_42: action « Télécharger les plateaux maintenant » des Réglages. */
  downloadNow(): Promise<void> {
    this.consented = true;
    return this.start();
  }

  private async run(fetchMissing: boolean): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const paths = await this.assetPaths();
      this.total.set(paths.length);
      if (fetchMissing) this.status.set('downloading');

      let present = 0;
      let failed = false;
      for (const path of paths) {
        // RG_42: en attente d'accord, on compte sans rien télécharger.
        const available = fetchMissing ? await fetchAsset(path) : await isAssetCached(path);
        if (available) this.present.set(++present);
        else failed = true;
      }
      this.present.set(present);

      if (!failed) this.status.set('ready');
      else if (!fetchMissing) this.status.set('awaiting-consent');
      else if (!this.connectivity.online()) this.status.set('paused');
      else this.status.set('incomplete');
    } catch {
      // RG_09: un référentiel illisible ne doit jamais interrompre le joueur.
      this.status.set('incomplete');
    } finally {
      this.running = false;
    }
  }

  private async assetPaths(): Promise<string[]> {
    const [boards, missions] = await Promise.all([
      this.referential.boardReferential(),
      this.referential.missionReferential(),
    ]);
    const paths = new Set<string>();
    for (const board of boards.boards) {
      for (const variant of boards.variants) paths.add(board.assets[variant]);
    }
    // RT_65: les cartes après les plateaux, dans la même boucle séquentielle :
    // tous les rectos, puis les versos.
    for (const card of missions.missions) paths.add(card.asset);
    for (const card of missions.missions) if (card.back) paths.add(card.back.asset);
    return [...paths];
  }
}

/** RT_56: la Network Information API n'existe que sous Chromium. */
function saveDataRequested(): boolean {
  const nav = globalThis.navigator as (Navigator & { connection?: { saveData?: boolean } }) | undefined;
  return nav?.connection?.saveData === true;
}
