import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { ToastController } from '@ionic/angular/lazy';
import { filter } from 'rxjs';

/** RT_57: chemin de l'écran de placement, où l'annonce est mise en attente. */
export function isPlacementUrl(url: string): boolean {
  return /\/placement(?:[/?#]|$)/.test(url);
}

/**
 * RT_57 — détection et application des mises à jour (RG_43).
 *
 * Une version prête est annoncée par un toast non bloquant « Recharger » ;
 * l'annonce attend que le joueur quitte l'écran de placement. Sans action de
 * sa part, le service worker sert la nouvelle version au lancement suivant.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  readonly updateReady = signal(false);

  private toast: HTMLIonToastElement | null = null;
  private started = false;

  start(): void {
    // RT_54: inactif hors build de production et dans l'APK.
    if (this.started || !this.updates.isEnabled) return;
    this.started = true;

    this.updates.versionUpdates.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event.type === 'VERSION_READY') {
        this.updateReady.set(true);
        void this.announce();
      }
      // RG_09: VERSION_INSTALLATION_FAILED est ignoré, la version courante reste servie.
    });

    // RT_57: cache du service worker incohérent — rechargement, aucune donnée
    // n'est en jeu (RT_08).
    this.updates.unrecoverable.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.reloadAfterNotice();
    });

    // RT_57: l'annonce différée est présentée en sortant du placement, et
    // retirée si le joueur y entre pendant qu'elle est affichée.
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        if (isPlacementUrl(event.urlAfterRedirects)) void this.toast?.dismiss();
        else if (this.updateReady()) void this.announce();
      });

    // RT_57: vérification au retour au premier plan.
    const onVisible = () => {
      if (globalThis.document?.visibilityState === 'visible') {
        this.updates.checkForUpdate().catch(() => undefined);
      }
    };
    globalThis.document?.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() =>
      globalThis.document?.removeEventListener('visibilitychange', onVisible),
    );
  }

  /** RG_43: recharger ne perd rien, listes et placements étant déjà enregistrés. */
  async applyUpdate(): Promise<void> {
    await this.updates.activateUpdate().catch(() => undefined);
    globalThis.location.reload();
  }

  private async announce(): Promise<void> {
    if (this.toast || isPlacementUrl(this.router.url)) return;
    const toast = await this.toasts.create({
      message: 'Nouvelle version disponible',
      position: 'bottom',
      buttons: [
        { text: 'Recharger', handler: () => void this.applyUpdate() },
        { text: 'Plus tard', role: 'cancel' },
      ],
    });
    this.toast = toast;
    void toast.onDidDismiss().then((detail) => {
      this.toast = null;
      // RG_43: « Plus tard » vaut jusqu'au lancement suivant.
      if (detail.role === 'cancel') this.updateReady.set(false);
    });
    await toast.present();
  }

  private async reloadAfterNotice(): Promise<void> {
    const toast = await this.toasts.create({
      message: "L'application doit être rechargée pour continuer.",
      duration: 2500,
      position: 'bottom',
    });
    await toast.present();
    await toast.onDidDismiss();
    globalThis.location.reload();
  }
}
