import { Injectable, inject } from '@angular/core';

import { LocalStoreService, STORE_BASE_OVERRIDES } from '../data/local-store.service';

/**
 * RT_25 — un socle assigné manuellement à une ligne de référentiel ([[RT_02]])
 * qui ne publie pas de socle exploitable, mémorisé pour ne plus être
 * redemandé au joueur.
 */
export interface BaseOverride {
  /** `<clé de la datasheet>::<clé de la ligne de modèle>` (RG_02). */
  readonly key: string;
  readonly baseShapeId: string;
  readonly assignedAt: string;
}

/**
 * RG_02/RT_25: aucune source externe ne documente la taille réelle des
 * socles que le référentiel Wahapedia ([[RT_02]]) laisse non publiés — le
 * joueur, qui a le modèle physique en main, en est la seule source fiable.
 * Ce service mémorise localement (RT_08) son assignation manuelle par ligne
 * de référentiel, pour qu'un import ultérieur du même modèle ne la
 * redemande pas.
 */
@Injectable({ providedIn: 'root' })
export class BaseOverrideService {
  private readonly store = inject(LocalStoreService);

  /** Clé stable d'une ligne de référentiel, indépendante du nom importé. */
  static key(datasheetKey: string, lineKey: string): string {
    return `${datasheetKey}::${lineKey}`;
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.store.get<BaseOverride>(STORE_BASE_OVERRIDES, key))?.baseShapeId;
  }

  /** RG_22: écrit dès que le joueur assigne un socle à une ligne mémorisable. */
  async remember(key: string, baseShapeId: string): Promise<void> {
    await this.store.put<BaseOverride>(STORE_BASE_OVERRIDES, {
      key,
      baseShapeId,
      assignedAt: new Date().toISOString(),
    });
  }
}
