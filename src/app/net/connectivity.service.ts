import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * RT_14 — détection de connectivité côté client.
 *
 * Surveille l'état réseau pour piloter les points d'entrée qui l'exigent, sans
 * attendre l'échec d'un appel : l'import de liste (RG_13) et les actions de
 * compte (RT_21) sont désactivés et accompagnés d'un message explicite tant
 * que l'application est détectée hors-ligne.
 *
 * Implémentation web : évènements `online`/`offline` du navigateur. Sur mobile
 * natif, c'est ici que `@capacitor/network` se substitue — les appelants
 * n'observent que le signal `online`.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly destroyRef = inject(DestroyRef);

  readonly online = signal(this.readNavigatorState());

  /** RT_10: nombre de retours en ligne, déclencheur de la synchronisation. */
  readonly reconnections = signal(0);

  constructor() {
    const goOnline = () => {
      this.online.set(true);
      this.reconnections.update((n) => n + 1);
    };
    const goOffline = () => this.online.set(false);

    globalThis.addEventListener?.('online', goOnline);
    globalThis.addEventListener?.('offline', goOffline);
    this.destroyRef.onDestroy(() => {
      globalThis.removeEventListener?.('online', goOnline);
      globalThis.removeEventListener?.('offline', goOffline);
    });
  }

  private readNavigatorState(): boolean {
    // `navigator.onLine` absent (environnement de test, webview exotique) :
    // on suppose en ligne plutôt que de bloquer l'import à tort (RG_13).
    return typeof navigator === 'undefined' || navigator.onLine === undefined
      ? true
      : navigator.onLine;
  }

  /** RG_13/RT_21: message affiché quand une action réseau est bloquée. */
  offlineMessage(action: string): string {
    return (
      `${action} nécessite une connexion réseau. Vous êtes actuellement hors-ligne : ` +
      `réessayez une fois reconnecté. Vos listes déjà importées et vos déploiements ` +
      `sauvegardés restent utilisables sans réseau.`
    );
  }
}
