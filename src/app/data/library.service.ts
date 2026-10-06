import { Injectable, inject, signal } from '@angular/core';

import { ArmyList, ArmyUnit, Deployment } from '../models/domain.models';
import { remapAttachments } from '../deployment/attachments';
import { normalizeGameplanNote } from '../deployment/gameplan-note';
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
  /** RT_15/RG_19: suppressions locales pas encore poussées — l'état « en attente » en tient compte. */
  readonly pendingDeletions = signal(0);

  private loading?: Promise<void>;

  /** Charge la bibliothèque locale une seule fois par session applicative. */
  load(): Promise<void> {
    return (this.loading ??= (async () => {
      const [lists, deployments] = await Promise.all([
        this.store.getAll<ArmyList>(STORE_LISTS),
        this.store.getAll<Deployment>(STORE_DEPLOYMENTS),
      ]);
      this.lists.set(this.sortLists(lists));
      this.deployments.set(deployments.map((d) => this.normalizeDeployment(d)));
      this.loaded.set(true);
      void this.refreshPendingDeletions();
    })());
  }

  /**
   * RT_35: un déploiement enregistré avant la mise en réserve (RG_25) n'a pas
   * de champ `reservedUnitIds`. Il est normalisé à la lecture plutôt que
   * migré : le stockage local (RT_08) n'a pas de schéma à faire évoluer, et
   * tout code en aval reçoit un tableau, jamais `undefined`.
   */
  private normalizeDeployment(deployment: Deployment): Deployment {
    // RT_60: même principe pour la note de plan de jeu (EX_13) — absente
    // d'un enregistrement antérieur ou d'un client antérieur, elle vaut `""`.
    const note = normalizeGameplanNote(deployment.note);
    return deployment.reservedUnitIds && deployment.note === note
      ? deployment
      : { ...deployment, reservedUnitIds: deployment.reservedUnitIds ?? [], note };
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
   * plateau). Il en existe au plus un par triplet : les actions
   * « Nouveau »/« Éditer » le mettent à jour en place plutôt que d'empiler
   * des entrées, et aucune copie n'est proposée.
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
    const list = this.list(listId);
    // RT_68: la suppression de la liste et celle de chacun de ses déploiements
    // partent au serveur, chacune avec son jeton de base.
    await this.store.deleteListCascade(
      { id: listId, versionToken: list?.versionToken ?? null },
      this.deploymentsOfList(listId).map((d) => ({ id: d.id, versionToken: d.versionToken })),
    );
    this.lists.set(this.lists().filter((l) => l.id !== listId));
    this.deployments.set(this.deployments().filter((d) => d.listId !== listId));
    void this.refreshPendingDeletions();
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
      units: this.cloneUnits(source.units),
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versionToken: null,
      dirty: true,
    };
    return this.saveList(copy);
  }

  private cloneUnits(units: readonly ArmyUnit[]): ArmyUnit[] {
    const newIdOf = new Map(units.map((unit) => [unit.id, newId('unit')]));
    const clones = units.map((unit) => {
      const unitId = newIdOf.get(unit.id)!;
      return {
        ...unit,
        id: unitId,
        modelGroups: unit.modelGroups.map((group, index) => ({
          ...group,
          id: `${unitId}_g${index}`,
        })),
      };
    });
    // RG_21/RT_45: les attachements suivent les nouveaux identifiants dans la
    // même opération — la copie ne pointe jamais sur les unités de l'original.
    return remapAttachments(clones, newIdOf);
  }

  // -------------------------------------------------------------------------
  // Déploiements
  // -------------------------------------------------------------------------

  /**
   * EX_04/RG_07: enregistre l'état courant du déploiement, rempli ou en cours
   * de remplissage. Appelée en continu au fil de la saisie — la sauvegarde
   * n'est pas une action de fin de parcours.
   *
   * RT_60: c'est aussi le point de passage unique de toute écriture de la
   * note de plan de jeu : la normalisation y ramène une note blanche à `""`
   * et en contrôle la longueur, quel que soit l'appelant.
   */
  async saveDeployment(deployment: Deployment): Promise<Deployment> {
    const persisted: Deployment = {
      ...this.normalizeDeployment(deployment),
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
   * jour en place).
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
      // RG_14/RG_25: « Nouveau » remet à zéro les placements *et* les
      // unités en réserve — la réserve est une décision de déploiement.
      // RG_45/RT_60: la note de plan de jeu, elle, est recopiée telle quelle.
      return this.saveDeployment({ ...existing, placements: [], reservedUnitIds: [], note: existing.note });
    }

    const now = new Date().toISOString();
    return this.saveDeployment({
      id: newId('depl'),
      name: params.defaultName,
      listId: params.listId,
      opponentDispositionId: params.opponentDispositionId,
      boardId: params.boardId,
      placements: [],
      reservedUnitIds: [],
      note: '',
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
    const deployment = this.deployments().find((d) => d.id === deploymentId);
    if (!deployment) return;
    await this.store.deleteDeployment({
      id: deploymentId,
      versionToken: deployment.versionToken,
      listId: deployment.listId,
    });
    this.deployments.set(this.deployments().filter((d) => d.id !== deploymentId));
    void this.refreshPendingDeletions();
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

  private async refreshPendingDeletions(): Promise<void> {
    try {
      this.pendingDeletions.set((await this.tombstones()).length);
    } catch {
      // RG_09: un indicateur d'état ne doit jamais interrompre le joueur.
    }
  }

  /** RG_51: nombre de listes et de déploiements de l'appareil, présenté au choix fusion/remplacement. */
  counts(): { lists: number; deployments: number } {
    return { lists: this.lists().length, deployments: this.deployments().length };
  }

  /**
   * RT_09/RT_68: applique localement des changements venus du serveur (page
   * de pull, résolution de conflit). Les enregistrements reçus sont marqués
   * synchronisés (`dirty: false`) avec leur jeton (RT_15) ; les suppressions
   * reçues ne laissent aucune trace à pousser.
   */
  async applyRemote(changes: {
    lists?: readonly ArmyList[];
    deployments?: readonly Deployment[];
    deletedListIds?: readonly string[];
    deletedDeploymentIds?: readonly string[];
    clearedTombstoneIds?: readonly string[];
  }): Promise<void> {
    const lists = (changes.lists ?? []).map((l) => ({ ...l, dirty: false }));
    const deployments = (changes.deployments ?? []).map((d) => ({
      ...this.normalizeDeployment(d),
      dirty: false,
    }));
    const deletedListIds = changes.deletedListIds ?? [];
    const deletedDeploymentIds = changes.deletedDeploymentIds ?? [];
    if (
      !lists.length &&
      !deployments.length &&
      !deletedListIds.length &&
      !deletedDeploymentIds.length &&
      !changes.clearedTombstoneIds?.length
    ) {
      return;
    }

    await this.store.applyChanges({
      putLists: lists,
      putDeployments: deployments,
      deleteListIds: deletedListIds,
      deleteDeploymentIds: deletedDeploymentIds,
      deleteTombstoneIds: changes.clearedTombstoneIds,
    });
    this.lists.set(this.sortLists(mergeById(this.lists(), lists, deletedListIds)));
    this.deployments.set(mergeById(this.deployments(), deployments, deletedDeploymentIds));
    void this.refreshPendingDeletions();
  }

  /**
   * RT_15/RT_68: une poussée acceptée. Chaque enregistrement prend sa propre
   * révision comme jeton de base ; il n'est marqué synchronisé que s'il n'a
   * pas été modifié de nouveau pendant la poussée (`updatedAt` inchangé) —
   * sinon il garde sa modification en attente, sur la nouvelle base. Une
   * suppression acceptée efface sa trace.
   */
  async markAccepted(
    accepted: readonly { resourceType: 'list' | 'deployment'; id: string; deleted: boolean; versionToken?: string }[],
    pushedUpdatedAt: ReadonlyMap<string, string>,
  ): Promise<void> {
    const tokens = new Map(
      accepted.filter((a) => !a.deleted && a.versionToken).map((a) => [`${a.resourceType}:${a.id}`, a.versionToken!]),
    );
    const accept = <T extends ArmyList | Deployment>(record: T, type: 'list' | 'deployment'): T => {
      const versionToken = tokens.get(`${type}:${record.id}`);
      if (!versionToken) return record;
      return { ...record, versionToken, dirty: record.updatedAt !== pushedUpdatedAt.get(record.id) };
    };

    const lists = this.lists().map((l) => accept(l, 'list'));
    const deployments = this.deployments().map((d) => accept(d, 'deployment'));
    await this.store.applyChanges({
      putLists: lists.filter((l) => tokens.has(`list:${l.id}`)),
      putDeployments: deployments.filter((d) => tokens.has(`deployment:${d.id}`)),
      deleteTombstoneIds: accepted.filter((a) => a.deleted).map((a) => a.id),
    });
    this.lists.set(this.sortLists(lists));
    this.deployments.set(deployments);
    void this.refreshPendingDeletions();
  }

  /**
   * RG_51/RT_67: données de l'appareil versées dans un compte qui ne les a
   * jamais vues (premier compte, ou changement de compte) — tout redevient
   * une création : plus de jeton de base, tout est à pousser, et les traces
   * de suppression de l'ancien compte n'ont plus d'objet.
   */
  async resetSyncMetadata(): Promise<void> {
    const lists = this.lists().map((l) => ({ ...l, versionToken: null, dirty: true }));
    const deployments = this.deployments().map((d) => ({ ...d, versionToken: null, dirty: true }));
    const tombstoneIds = (await this.tombstones()).map((t) => t.id);
    await this.store.applyChanges({
      putLists: lists,
      putDeployments: deployments,
      deleteTombstoneIds: tombstoneIds,
    });
    this.lists.set(this.sortLists(lists));
    this.deployments.set(deployments);
    void this.refreshPendingDeletions();
  }

  /** RG_51: « Les remplacer par celles du compte » — efface les listes et déploiements de l'appareil. */
  async clearAll(): Promise<void> {
    await this.store.clearRecords();
    this.lists.set([]);
    this.deployments.set([]);
    this.pendingDeletions.set(0);
  }
}

function mergeById<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
  removed: readonly string[],
): T[] {
  const map = new Map(current.map((r) => [r.id, r]));
  for (const record of incoming) map.set(record.id, record);
  for (const id of removed) map.delete(id);
  return [...map.values()];
}
