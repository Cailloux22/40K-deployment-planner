import { Injectable, inject, signal } from '@angular/core';

import { ArmyList, ArmyUnit, Deployment, Placement } from '../models/domain.models';
import {
  LocalStoreService,
  STORE_DEPLOYMENTS,
  STORE_LISTS,
  STORE_TOMBSTONES,
  Tombstone,
} from './local-store.service';

/** Identifiant stable, indépendant du contenu (RT_07). */
export function newId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

/**
 * Bibliothèque locale des listes importées et des déploiements sauvegardés
 * (RT_06). Toute lecture/écriture passe par le stockage local (RT_08) avant
 * toute synchronisation (RT_10) : l'écran d'accueil et le parcours de
 * déploiement fonctionnent donc hors-ligne (EX_05).
 *
 * Les deux signaux exposés sont la source de vérité des écrans : ils sont
 * rechargés depuis IndexedDB au démarrage puis maintenus à jour à chaque
 * écriture, ce qui permet à RT_11 de recalculer les indicateurs de RG_12/RG_14
 * à chaque affichage sans requête supplémentaire.
 */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private readonly store = inject(LocalStoreService);

  readonly lists = signal<readonly ArmyList[]>([]);
  readonly deployments = signal<readonly Deployment[]>([]);
  readonly loaded = signal(false);

  private loading?: Promise<void>;

  /** Charge la bibliothèque locale une seule fois par session applicative. */
  load(): Promise<void> {
    return (this.loading ??= (async () => {
      const [lists, deployments] = await Promise.all([
        this.store.getAll<ArmyList>(STORE_LISTS),
        this.store.getAll<Deployment>(STORE_DEPLOYMENTS),
      ]);
      this.lists.set(this.sortLists(lists));
      this.deployments.set(deployments);
      this.loaded.set(true);
    })());
  }

  private sortLists(lists: readonly ArmyList[]): ArmyList[] {
    return [...lists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  list(listId: string): ArmyList | undefined {
    return this.lists().find((l) => l.id === listId);
  }

  /** RT_07: les déploiements d'une liste, retrouvés par son identifiant. */
  deploymentsOfList(listId: string): readonly Deployment[] {
    return this.deployments().filter((d) => d.listId === listId);
  }

  /**
   * RG_07/RG_14: le déploiement du triplet (liste, disposition adverse,
   * plateau). Il en existe au plus un « courant » par triplet : les actions
   * « Nouveau »/« Éditer » le mettent à jour en place plutôt que d'empiler
   * des entrées, sauf enregistrement explicite sous un nouveau nom.
   */
  deploymentFor(listId: string, opponentDispositionId: string, boardId: string): Deployment | undefined {
    return this.deployments().find(
      (d) =>
        d.listId === listId &&
        d.opponentDispositionId === opponentDispositionId &&
        d.boardId === boardId,
    );
  }

  // -------------------------------------------------------------------------
  // Listes d'armée
  // -------------------------------------------------------------------------

  /** RG_22: persistance d'un import, après validation explicite du joueur. */
  async saveList(list: ArmyList): Promise<ArmyList> {
    const persisted: ArmyList = { ...list, updatedAt: new Date().toISOString(), dirty: true };
    await this.store.put(STORE_LISTS, persisted);
    this.lists.set(this.sortLists([...this.lists().filter((l) => l.id !== persisted.id), persisted]));
    return persisted;
  }

  /**
   * RG_21: suppression d'une liste, en cascade sur ses déploiements — jamais
   * d'entrée orpheline. L'appelant a confirmé explicitement au préalable.
   */
  async deleteList(listId: string): Promise<void> {
    const impacted = this.deploymentsOfList(listId).map((d) => d.id);
    await this.store.deleteListCascade(listId, impacted);
    this.lists.set(this.lists().filter((l) => l.id !== listId));
    this.deployments.set(this.deployments().filter((d) => d.listId !== listId));
  }

  /**
   * RG_21: duplication — copie indépendante, identifiant stable propre
   * (RT_07), sans aucun déploiement associé, au même titre qu'un nouvel
   * import.
   */
  async duplicateList(listId: string): Promise<ArmyList | undefined> {
    const source = this.list(listId);
    if (!source) return undefined;

    const copy: ArmyList = {
      ...source,
      id: newId('list'),
      name: `${source.name} (copie)`,
      // Les unités reçoivent aussi de nouveaux identifiants : les placements
      // d'un déploiement de la liste d'origine ne doivent jamais pointer sur
      // les unités de la copie.
      units: source.units.map((unit) => this.cloneUnit(unit)),
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versionToken: null,
      dirty: true,
    };
    return this.saveList(copy);
  }

  private cloneUnit(unit: ArmyUnit): ArmyUnit {
    const unitId = newId('unit');
    return {
      ...unit,
      id: unitId,
      modelGroups: unit.modelGroups.map((group, index) => ({
        ...group,
        id: `${unitId}_g${index}`,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Déploiements
  // -------------------------------------------------------------------------

  /**
   * EX_04/RG_07: enregistre l'état courant du déploiement, rempli ou en cours
   * de remplissage. Appelée en continu au fil de la saisie — la sauvegarde
   * n'est pas une action de fin de parcours.
   */
  async saveDeployment(deployment: Deployment): Promise<Deployment> {
    const persisted: Deployment = {
      ...deployment,
      updatedAt: new Date().toISOString(),
      dirty: true,
    };
    await this.store.put(STORE_DEPLOYMENTS, persisted);
    this.deployments.set([...this.deployments().filter((d) => d.id !== persisted.id), persisted]);
    return persisted;
  }

  /**
   * RG_07/RG_14: ouvre le déploiement du triplet — celui déjà enregistré, ou
   * un nouveau. `reset` correspond à l'action « Nouveau » : les placements
   * repartent de zéro mais l'identifiant du déploiement est conservé (mise à
   * jour en place), une entrée distincte n'étant créée que par un
   * enregistrement explicite sous un nouveau nom.
   */
  async openDeployment(params: {
    listId: string;
    opponentDispositionId: string;
    boardId: string;
    defaultName: string;
    reset: boolean;
  }): Promise<Deployment> {
    const existing = this.deploymentFor(params.listId, params.opponentDispositionId, params.boardId);
    if (existing && !params.reset) return existing;

    if (existing && params.reset) {
      return this.saveDeployment({ ...existing, placements: [] });
    }

    const now = new Date().toISOString();
    return this.saveDeployment({
      id: newId('depl'),
      name: params.defaultName,
      listId: params.listId,
      opponentDispositionId: params.opponentDispositionId,
      boardId: params.boardId,
      placements: [],
      createdAt: now,
      updatedAt: now,
      versionToken: null,
      dirty: true,
    });
  }

  /** RG_07: « enregistrer sous un nouveau nom » — crée une entrée distincte. */
  async saveDeploymentAs(deployment: Deployment, name: string): Promise<Deployment> {
    const now = new Date().toISOString();
    return this.saveDeployment({
      ...deployment,
      id: newId('depl'),
      name,
      placements: deployment.placements.map((p: Placement) => ({ ...p })),
      createdAt: now,
      updatedAt: now,
      versionToken: null,
      dirty: true,
    });
  }

  /**
   * RG_08: suppression d'un déploiement, confirmée par l'appelant. Ne touche
   * jamais à la liste d'armée associée, réutilisable pour d'autres plateaux.
   */
  async deleteDeployment(deploymentId: string): Promise<void> {
    await this.store.deleteDeployment(deploymentId);
    this.deployments.set(this.deployments().filter((d) => d.id !== deploymentId));
  }

  /** RG_07: nom par défaut d'un déploiement — liste + plateau + date. */
  defaultDeploymentName(listName: string, boardLabel: string): string {
    const date = new Date().toLocaleDateString('fr-FR');
    return `${listName} — ${boardLabel} — ${date}`;
  }

  // -------------------------------------------------------------------------
  // RT_15 — support de la synchronisation
  // -------------------------------------------------------------------------

  /** Enregistrements modifiés localement depuis le dernier sync réussi. */
  dirtyRecords(): { lists: readonly ArmyList[]; deployments: readonly Deployment[] } {
    return {
      lists: this.lists().filter((l) => l.dirty),
      deployments: this.deployments().filter((d) => d.dirty),
    };
  }

  tombstones(): Promise<Tombstone[]> {
    return this.store.getAll<Tombstone>(STORE_TOMBSTONES);
  }

  async clearTombstones(ids: readonly string[]): Promise<void> {
    for (const id of ids) await this.store.delete(STORE_TOMBSTONES, id);
  }

  /**
   * Applique le delta serveur (RT_09) au stockage local, en marquant les
   * enregistrements comme synchronisés (`dirty: false`) avec leur nouveau
   * jeton de version (RT_15).
   */
  async applyServerDelta(delta: {
    lists: readonly ArmyList[];
    deployments: readonly Deployment[];
    deletedListIds: readonly string[];
    deletedDeploymentIds: readonly string[];
  }): Promise<void> {
    const lists = delta.lists.map((l) => ({ ...l, dirty: false }));
    const deployments = delta.deployments.map((d) => ({ ...d, dirty: false }));

    if (lists.length) await this.store.putMany(STORE_LISTS, lists);
    if (deployments.length) await this.store.putMany(STORE_DEPLOYMENTS, deployments);
    for (const id of delta.deletedListIds) await this.store.delete(STORE_LISTS, id);
    for (const id of delta.deletedDeploymentIds) await this.store.delete(STORE_DEPLOYMENTS, id);

    const byId = <T extends { id: string }>(current: readonly T[], incoming: readonly T[], removed: readonly string[]) => {
      const map = new Map(current.map((r) => [r.id, r]));
      for (const record of incoming) map.set(record.id, record);
      for (const id of removed) map.delete(id);
      return [...map.values()];
    };

    this.lists.set(this.sortLists(byId(this.lists(), lists, delta.deletedListIds)));
    this.deployments.set(byId(this.deployments(), deployments, delta.deletedDeploymentIds));
  }

  /** Marque comme synchronisés les enregistrements acceptés par le serveur. */
  async markSynced(
    acceptedListIds: readonly string[],
    acceptedDeploymentIds: readonly string[],
    versionToken: string,
  ): Promise<void> {
    const lists = this.lists().map((l) =>
      acceptedListIds.includes(l.id) ? { ...l, dirty: false, versionToken } : l,
    );
    const deployments = this.deployments().map((d) =>
      acceptedDeploymentIds.includes(d.id) ? { ...d, dirty: false, versionToken } : d,
    );

    await this.store.putMany(
      STORE_LISTS,
      lists.filter((l) => acceptedListIds.includes(l.id)),
    );
    await this.store.putMany(
      STORE_DEPLOYMENTS,
      deployments.filter((d) => acceptedDeploymentIds.includes(d.id)),
    );
    this.lists.set(this.sortLists(lists));
    this.deployments.set(deployments);
  }
}
