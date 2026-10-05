import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { LocalStoreService } from '../data/local-store.service';
import { InstallMode, installMode, isNativeApp, readInstallEnvironment } from './install-context';

/** Évènement `beforeinstallprompt` (Chromium), absent des typages DOM standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** RT_55: clé de configuration (RT_08) mémorisant la fermeture du bandeau. */
export const INSTALL_BANNER_DISMISSED_KEY = 'installBannerDismissed';

/**
 * RT_55 — détection du contexte et déclenchement de l'installation (RG_41).
 *
 * Service racine instancié au démarrage par `AppComponent`, avant tout écran :
 * `beforeinstallprompt` peut survenir avant l'affichage de l'accueil.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private readonly store = inject(LocalStoreService);
  private readonly destroyRef = inject(DestroyRef);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  readonly mode = signal<InstallMode>(installMode(readInstallEnvironment(false)));
  readonly bannerDismissed = signal(
    this.store.getConfig<boolean>(INSTALL_BANNER_DISMISSED_KEY) === true,
  );

  /** RG_41: le bloc « Application » des Réglages n'existe que hors APK. */
  readonly webApp = !isNativeApp();
  readonly installed = computed(() => this.mode() === 'installed');
  /** RG_41: invitation proposée — bandeau d'accueil tant qu'il n'est pas fermé. */
  readonly canInvite = computed(() => this.mode() === 'prompt' || this.mode() === 'ios-instructions');
  readonly showBanner = computed(() => this.canInvite() && !this.bannerDismissed());

  constructor() {
    if (!this.webApp) return;

    const onPrompt = (event: Event) => {
      // RT_55: la demande du navigateur est retenue pour le bouton de RG_41.
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.refresh();
    };
    const onInstalled = () => {
      this.deferredPrompt = null;
      this.mode.set('installed');
    };
    globalThis.addEventListener?.('beforeinstallprompt', onPrompt);
    globalThis.addEventListener?.('appinstalled', onInstalled);
    this.destroyRef.onDestroy(() => {
      globalThis.removeEventListener?.('beforeinstallprompt', onPrompt);
      globalThis.removeEventListener?.('appinstalled', onInstalled);
    });
  }

  /**
   * RG_41: ouvre la demande d'installation du navigateur. Un refus ne change
   * rien ; une acceptation fait disparaître l'invitation (`appinstalled`).
   */
  async promptInstall(): Promise<boolean> {
    const prompt = this.deferredPrompt;
    if (!prompt) return false;
    // Un évènement ne se rejoue pas : le navigateur en émettra un nouveau.
    this.deferredPrompt = null;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      return outcome === 'accepted';
    } catch {
      return false;
    } finally {
      this.refresh();
    }
  }

  /** RG_41: un bandeau fermé ne réapparaît plus sur cet appareil. */
  dismissBanner(): void {
    this.bannerDismissed.set(true);
    // RT_55: un échec d'écriture est absorbé par setConfig (RT_08).
    this.store.setConfig(INSTALL_BANNER_DISMISSED_KEY, true);
  }

  private refresh(): void {
    if (this.mode() === 'installed') return;
    this.mode.set(installMode(readInstallEnvironment(this.deferredPrompt !== null)));
  }
}
