import { Injectable } from '@angular/core';

/**
 * RT_08 — stockage local du terminal.
 *
 * Les listes importées et les déploiements sauvegardés sont persistés en
 * IndexedDB (RT_06: enregistrements indexés par identifiant), lus et écrits
 * systématiquement avant toute tentative de synchronisation réseau (RT_10) :
 * l'application reste donc pleinement utilisable hors-ligne (EX_05).
 *
 * Les données de configuration légères (session, jeton de synchronisation)
 * passent par `getConfig`/`setConfig`, adossées à `localStorage` en
 * environnement web. C'est le point de substitution prévu par RT_08 pour
 * `@capacitor/preferences` sur mobile natif : seules ces deux méthodes sont à
 * réimplémenter, aucun appelant n'a à changer.
 */

export const STORE_LISTS = 'lists';
export const STORE_DEPLOYMENTS = 'deployments';
/** RT_15: identifiants supprimés localement, à pousser au prochain sync. */
export const STORE_TOMBSTONES = 'tombstones';
/** RT_27: cache des images de plateau obtenues par le réseau (RT_12). */
export const STORE_BOARD_IMAGES = 'boardImages';
/** RT_65: cache des images de carte de mission obtenues par le réseau (RT_64). */
export const STORE_MISSION_IMAGES = 'missionImages';

const DB_NAME = 'windfall-planner';
const DB_VERSION = 5;
const CONFIG_PREFIX = 'wfp.';

export interface Tombstone {
  readonly id: string;
  readonly resourceType: 'list' | 'deployment';
  readonly deletedAt: string;
  /**
   * RT_68: jeton de la version supprimée, pour qu'une modification faite
   * ailleurs entre-temps produise un conflit au lieu d'être perdue. `null`
   * pour un enregistrement jamais synchronisé ; absent d'une trace antérieure.
   */
  readonly versionToken?: string | null;
  /** RT_68: liste d'un déploiement supprimé — une liste et ses déploiements partent dans la même poussée. */
  readonly listId?: string;
}

/** Référence d'un enregistrement supprimé, avec son jeton de base (RT_68). */
export interface DeletedRef {
  readonly id: string;
  readonly versionToken: string | null;
}

/** RT_09/RT_68: changements venus du serveur, appliqués en une transaction. */
export interface StoreChanges {
  readonly putLists?: readonly unknown[];
  readonly putDeployments?: readonly unknown[];
  readonly deleteListIds?: readonly string[];
  readonly deleteDeploymentIds?: readonly string[];
  readonly deleteTombstoneIds?: readonly string[];
}

@Injectable({ providedIn: 'root' })
export class LocalStoreService {
  private db?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        // RT_06: un store par type d'enregistrement, indexé par identifiant.
        if (!db.objectStoreNames.contains(STORE_LISTS)) {
          db.createObjectStore(STORE_LISTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_DEPLOYMENTS)) {
          const store = db.createObjectStore(STORE_DEPLOYMENTS, { keyPath: 'id' });
          // RT_07/RT_11: les indicateurs de RG_12/RG_14 filtrent les
          // déploiements par liste, puis par disposition adverse et plateau.
          store.createIndex('listId', 'listId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_TOMBSTONES)) {
          db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'id' });
        }
        // RT_27: store dédié aux blobs d'images, distinct des enregistrements
        // métier synchronisés.
        if (!db.objectStoreNames.contains(STORE_BOARD_IMAGES)) {
          db.createObjectStore(STORE_BOARD_IMAGES, { keyPath: 'id' });
        }
        // RT_65: même principe pour les cartes de mission, dans leur propre store.
        if (!db.objectStoreNames.contains(STORE_MISSION_IMAGES)) {
          db.createObjectStore(STORE_MISSION_IMAGES, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Ouverture IndexedDB impossible'));
    }));
  }

  /** Une transaction, ses stores, et l'attente de son `oncomplete`. */
  private async transact(
    storeNames: readonly string[],
    mode: IDBTransactionMode,
    work: (stores: IDBObjectStore[]) => void,
  ): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...storeNames], mode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée'));
      try {
        work(storeNames.map((name) => tx.objectStore(name)));
      } catch (err) {
        tx.abort();
        reject(err);
      }
    });
  }

  private static request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll<T>(store: string): Promise<T[]> {
    const db = await this.open();
    const tx = db.transaction(store, 'readonly');
    return LocalStoreService.request<T[]>(tx.objectStore(store).getAll() as IDBRequest<T[]>);
  }

  async get<T>(store: string, id: string): Promise<T | undefined> {
    const db = await this.open();
    const tx = db.transaction(store, 'readonly');
    return LocalStoreService.request<T | undefined>(
      tx.objectStore(store).get(id) as IDBRequest<T | undefined>,
    );
  }

  async put<T>(store: string, value: T): Promise<void> {
    await this.transact([store], 'readwrite', ([s]) => s.put(value));
  }

  async putMany<T>(store: string, values: readonly T[]): Promise<void> {
    await this.transact([store], 'readwrite', ([s]) => {
      for (const value of values) s.put(value);
    });
  }

  async delete(store: string, id: string): Promise<void> {
    await this.transact([store], 'readwrite', ([s]) => s.delete(id));
  }

  /**
   * RG_21: la suppression d'une liste et celle de ses déploiements doivent
   * être atomiques — une liste supprimée ne doit jamais laisser derrière elle
   * des déploiements orphelins. RT_68: chaque trace garde le jeton de base de
   * la version supprimée.
   */
  async deleteListCascade(list: DeletedRef, deployments: readonly DeletedRef[]): Promise<void> {
    await this.transact(
      [STORE_LISTS, STORE_DEPLOYMENTS, STORE_TOMBSTONES],
      'readwrite',
      ([lists, deploymentStore, tombstones]) => {
        const deletedAt = new Date().toISOString();
        lists.delete(list.id);
        tombstones.put({
          id: list.id,
          resourceType: 'list',
          deletedAt,
          versionToken: list.versionToken,
        } satisfies Tombstone);
        for (const deployment of deployments) {
          deploymentStore.delete(deployment.id);
          tombstones.put({
            id: deployment.id,
            resourceType: 'deployment',
            deletedAt,
            versionToken: deployment.versionToken,
            listId: list.id,
          } satisfies Tombstone);
        }
      },
    );
  }

  /** RG_08: suppression d'un déploiement seul, la liste associée est conservée. */
  async deleteDeployment(deployment: DeletedRef & { listId: string }): Promise<void> {
    await this.transact([STORE_DEPLOYMENTS, STORE_TOMBSTONES], 'readwrite', ([deployments, tombstones]) => {
      deployments.delete(deployment.id);
      tombstones.put({
        id: deployment.id,
        resourceType: 'deployment',
        deletedAt: new Date().toISOString(),
        versionToken: deployment.versionToken,
        listId: deployment.listId,
      } satisfies Tombstone);
    });
  }

  /**
   * RT_09/RT_68: application atomique de changements venus du serveur — une
   * page de pull, une poussée acceptée, une résolution de conflit. Les
   * suppressions reçues ne laissent aucune trace à pousser : elles viennent
   * déjà du serveur.
   */
  async applyChanges(changes: StoreChanges): Promise<void> {
    await this.transact(
      [STORE_LISTS, STORE_DEPLOYMENTS, STORE_TOMBSTONES],
      'readwrite',
      ([lists, deployments, tombstones]) => {
        for (const value of changes.putLists ?? []) lists.put(value);
        for (const value of changes.putDeployments ?? []) deployments.put(value);
        for (const id of changes.deleteListIds ?? []) lists.delete(id);
        for (const id of changes.deleteDeploymentIds ?? []) deployments.delete(id);
        for (const id of changes.deleteTombstoneIds ?? []) tombstones.delete(id);
      },
    );
  }

  /** RG_51: « Les remplacer par celles du compte » — listes, déploiements et traces effacés. */
  async clearRecords(): Promise<void> {
    await this.transact([STORE_LISTS, STORE_DEPLOYMENTS, STORE_TOMBSTONES], 'readwrite', (stores) => {
      for (const store of stores) store.clear();
    });
  }

  // -------------------------------------------------------------------------
  // RT_08 — configuration légère (session RT_21, jeton de sync RT_15)
  // -------------------------------------------------------------------------

  getConfig<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(CONFIG_PREFIX + key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      // Stockage indisponible (mode privé, quota) : l'application reste
      // utilisable en usage local (RG_10), simplement sans session mémorisée.
      return null;
    }
  }

  setConfig<T>(key: string, value: T | null): void {
    try {
      if (value === null) localStorage.removeItem(CONFIG_PREFIX + key);
      else localStorage.setItem(CONFIG_PREFIX + key, JSON.stringify(value));
    } catch {
      // Idem : l'échec d'écriture ne doit jamais interrompre le joueur (RG_09).
    }
  }
}
