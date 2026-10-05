import { Injectable, inject, signal } from '@angular/core';

import { InstallService } from './install.service';

/**
 * RT_58 — demande de stockage persistant (RG_44).
 *
 * `persisted` vaut `true` quand le navigateur s'engage à ne pas effacer les
 * données de l'application ; une API absente est traitée comme « non protégé ».
 */
@Injectable({ providedIn: 'root' })
export class StoragePersistenceService {
  private readonly install = inject(InstallService);

  readonly persisted = signal(false);

  /**
   * RT_58: au lancement, la persistance n'est demandée d'office qu'en mode
   * installé — Chrome et WebKit l'y accordent sans demande au joueur.
   */
  async init(): Promise<void> {
    if (!this.install.webApp) return;
    const persisted = await this.readPersisted();
    this.persisted.set(persisted);
    if (!persisted && this.install.installed()) await this.request();
  }

  /**
   * RT_58: hors installation, sur l'action « Protéger mes données » seulement :
   * Firefox présente alors sa propre demande d'autorisation.
   */
  async request(): Promise<boolean> {
    const storage = globalThis.navigator?.storage;
    if (!storage?.persist) return false;
    const granted = await storage.persist().catch(() => false);
    this.persisted.set(granted);
    return granted;
  }

  private async readPersisted(): Promise<boolean> {
    const storage = globalThis.navigator?.storage;
    if (!storage?.persisted) return false;
    return storage.persisted().catch(() => false);
  }
}
