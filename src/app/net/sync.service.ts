import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { LibraryService } from '../data/library.service';
import { LocalStoreService } from '../data/local-store.service';
import { ArmyList, Deployment } from '../models/domain.models';
import {
  AuthUser,
  ConflictChoice,
  ConflictResolution,
  ConflictResolutionResult,
  FirstConnectionChoice,
  PendingConflict,
  RejectedRecord,
  SyncConflict,
  SyncPullResult,
  SyncPushRequest,
  SyncPushResult,
  SyncState,
  SyncSummary,
  WireArmyList,
  WireDeployment,
} from '../models/sync.models';
import { readApiFailure, syncUrl } from './api';
import { AuthService } from './auth.service';
import { ConnectivityService } from './connectivity.service';
import {
  PULL_PAGE_SIZE,
  buildPushBatches,
  fingerprint,
  fromWireDeployment,
  fromWireList,
  planPullPage,
  toWireDeployment,
  toWireList,
  uuid,
} from './sync-protocol';

/** RT_15/RT_70: révision de l'appareil — le `nextToken` du dernier pull appliqué. */
const SINCE_KEY = 'sync.since';
/** RG_51/RT_67: identifiant du dernier compte synchronisé sur cet appareil. */
const ACCOUNT_KEY = 'sync.accountId';
const LAST_SYNCED_KEY = 'sync.lastSyncedAt';
/** RT_68: clés d'idempotence des requêtes restées sans réponse, par empreinte de corps. */
const IDEMPOTENCY_KEY = 'sync.idempotencyKeys';
const IDEMPOTENCY_MAX_ENTRIES = 20;

/** RG_51: choix du joueur à la première connexion d'un appareil. */
export type FirstConnectionDecision = 'merge' | 'replace';

/**
 * RT_09 / RT_10 / RT_15 / RT_68 — synchronisation delta avec le serveur
 * (contrat `specification/openapi.yml` v1.1.0).
 *
 * RG_09: tout échec est absorbé en arrière-plan, sans bloquer ni interrompre
 * le travail en cours ; l'état « non synchronisé » reste visible (RG_19) mais
 * jamais bloquant.
 * RG_11/RG_54: un enregistrement en conflit n'est jamais arbitré
 * automatiquement — il est présenté au joueur, les autres enregistrements
 * continuant de se synchroniser.
 * RG_51: avant la première synchronisation d'un appareil avec un compte, les
 * données des deux côtés sont comparées et, si les deux en ont, le joueur
 * choisit entre fusion et remplacement.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly library = inject(LibraryService);
  private readonly store = inject(LocalStoreService);

  /** RT_15/RT_70: révision de l'appareil, chaîne vide tant qu'il n'a rien reçu. */
  private readonly since = signal<string>(this.store.getConfig<string>(SINCE_KEY) ?? '');

  /** RG_11/RG_54: conflits de la dernière poussée, en attente d'arbitrage. */
  readonly pendingConflicts = signal<readonly PendingConflict[]>([]);
  /** RT_68: enregistrements refusés par le serveur, conservés intacts sur l'appareil. */
  readonly rejected = signal<readonly RejectedRecord[]>([]);
  /** RG_51: comparaison présentée au joueur ; aucune synchronisation tant qu'elle est ouverte. */
  readonly firstConnectionChoice = signal<FirstConnectionChoice | null>(null);
  /** RT_69: `426 CLIENT_TOO_OLD` — synchronisation suspendue jusqu'à la mise à jour. */
  readonly upgradeRequired = signal(false);

  readonly lastError = signal<string | null>(null);
  readonly lastSyncedAt = signal<string | null>(this.store.getConfig<string>(LAST_SYNCED_KEY));
  private readonly running = signal(false);

  /** RT_69: `Retry-After` d'un 429, respecté sans bloquer le joueur. */
  private retryAt = 0;
  /** Une demande arrivée pendant une passe en relance une autre à la fin. */
  private rerun = false;

  /** RG_19: état de synchronisation affiché par l'écran Réglages. */
  readonly state = computed<SyncState>(() => {
    if (!this.auth.signedIn()) return 'localOnly';
    if (this.firstConnectionChoice()) return 'awaitingChoice';
    if (this.upgradeRequired()) return 'upgradeRequired';
    if (this.pendingConflicts().length > 0) return 'conflict';
    if (!this.connectivity.online()) return 'offline';
    if (this.running()) return 'syncing';
    if (this.lastError()) return 'error';
    if (this.rejected().length > 0) return 'rejected';
    const { lists, deployments } = this.library.dirtyRecords();
    return lists.length || deployments.length || this.library.pendingDeletions() ? 'pending' : 'synced';
  });

  constructor() {
    // RT_10: déclenchement à la reprise du réseau et à l'ouverture d'une
    // session, jamais de façon bloquante pour l'interaction en cours. La passe
    // elle-même n'est pas suivie par l'effet : les signaux qu'elle lit et
    // écrit ne doivent pas la relancer.
    effect(() => {
      this.connectivity.reconnections();
      const signedIn = this.auth.signedIn();
      const online = this.connectivity.online();
      untracked(() => {
        if (signedIn && online) void this.synchronize();
        if (!signedIn) this.resetSessionState();
      });
    });
  }

  /**
   * RT_10: retour au premier plan de l'application. Appelé par le composant
   * racine (`App.resume` de Capacitor / `visibilitychange` en web).
   */
  onAppResumed(): void {
    void this.synchronize();
  }

  /** RG_19/RG_53: l'appareil repasse en usage local — l'état de session est oublié. */
  private resetSessionState(): void {
    this.pendingConflicts.set([]);
    this.rejected.set([]);
    this.firstConnectionChoice.set(null);
    this.lastError.set(null);
  }

  private canSync(): boolean {
    return (
      this.auth.signedIn() &&
      this.connectivity.online() &&
      !this.upgradeRequired() &&
      !this.firstConnectionChoice() &&
      Date.now() >= this.retryAt
    );
  }

  private setSince(token: string): void {
    this.since.set(token);
    this.store.setConfig(SINCE_KEY, token);
  }

  /**
   * Une passe de synchronisation : première connexion (RG_51) si besoin, pull
   * paginé du delta serveur, puis poussée des modifications locales. Jamais
   * concurrente d'elle-même, et toujours silencieuse en cas d'échec (RG_09).
   */
  async synchronize(): Promise<void> {
    if (this.running()) {
      this.rerun = true;
      return;
    }
    // RG_09: hors-ligne ou sans compte, on ne tente rien.
    if (!this.canSync()) return;

    this.running.set(true);
    try {
      do {
        this.rerun = false;
        await this.pass();
      } while (this.rerun && this.canSync());
    } catch (err) {
      this.handleFailure(err);
    } finally {
      this.running.set(false);
    }
  }

  private async pass(): Promise<void> {
    await this.library.load();
    const user = this.auth.user();
    if (!user) return;
    if (this.store.getConfig<string>(ACCOUNT_KEY) !== user.id && !(await this.firstConnection(user))) return;

    await this.pull();
    await this.push();

    this.lastError.set(null);
    const now = new Date().toISOString();
    this.lastSyncedAt.set(now);
    this.store.setConfig(LAST_SYNCED_KEY, now);
  }

  /**
   * RG_09: l'échec n'est exposé que par l'indicateur de RG_19, il n'interrompt
   * aucun écran.
   */
  private handleFailure(err: unknown): void {
    const failure = readApiFailure(err);
    if (failure.status === 401 && failure.code === 'UNAUTHENTICATED') {
      // RT_67/RG_53: l'intercepteur a déjà ramené l'appareil en usage local.
      this.lastError.set(null);
      return;
    }
    if (failure.status === 426) {
      // RT_69: suspendue jusqu'à la mise à jour de l'application ; les
      // données locales restent intactes.
      this.upgradeRequired.set(true);
      return;
    }
    if (failure.status === 429) {
      this.retryAt = Date.now() + (failure.retryAfter ?? 60) * 1000;
    }
    this.lastError.set(failure.message);
  }

  // -------------------------------------------------------------------------
  // RG_51 — première connexion d'un appareil
  // -------------------------------------------------------------------------

  /**
   * RG_51/RT_67: le compte connecté n'est pas celui de la dernière
   * synchronisation de l'appareil (première connexion, ou changement de
   * compte). Renvoie `true` si la synchronisation peut continuer sans
   * question.
   */
  private async firstConnection(user: AuthUser): Promise<boolean> {
    const local = this.library.counts();
    const summary = await firstValueFrom(this.http.get<SyncSummary>(syncUrl('/sync/summary')));

    // RG_51: l'appareil n'a aucune liste — il récupère celles du compte.
    // RG_51: le compte est vide — les données de l'appareil y sont versées.
    if (local.lists === 0 || (summary.listCount === 0 && summary.deploymentCount === 0)) {
      await this.adoptAccount(user.id);
      return true;
    }

    // RG_51: les deux ont des données — le joueur choisit ; d'ici là, rien
    // n'est synchronisé.
    this.firstConnectionChoice.set({ email: user.email, local, account: summary });
    return false;
  }

  /**
   * RG_51/RT_67: l'appareil se rattache au compte. Ses données sont traitées
   * comme jamais synchronisées — créations versées au compte — et sa
   * révision repart de zéro, pour un pull complet.
   */
  private async adoptAccount(accountId: string): Promise<void> {
    await this.library.resetSyncMetadata();
    this.setSince('');
    this.store.setConfig(ACCOUNT_KEY, accountId);
  }

  /**
   * RG_51: « Ajouter ces données au compte » (fusion) ou « Les remplacer par
   * celles du compte ». Le remplacement a été confirmé explicitement par
   * l'appelant (RG_08).
   */
  async chooseFirstConnection(decision: FirstConnectionDecision): Promise<void> {
    const user = this.auth.user();
    if (!user || !this.firstConnectionChoice()) return;
    if (decision === 'replace') await this.library.clearAll();
    await this.adoptAccount(user.id);
    this.firstConnectionChoice.set(null);
    void this.synchronize();
  }

  /** RG_51: fermer le choix sans répondre déconnecte l'appareil, sans rien modifier. */
  async dismissFirstConnection(): Promise<void> {
    this.firstConnectionChoice.set(null);
    await this.auth.logout();
  }

  /** RG_52: compte supprimé — plus aucun compte n'est rattaché à l'appareil. */
  forgetAccount(): void {
    this.store.setConfig(ACCOUNT_KEY, null);
    this.setSince('');
    this.resetSessionState();
  }

  // -------------------------------------------------------------------------
  // RT_68 — pull paginé
  // -------------------------------------------------------------------------

  private async pull(): Promise<void> {
    try {
      await this.pullFrom(this.since());
    } catch (err) {
      // RT_68: `410 SYNC_TOKEN_EXPIRED` — révision antérieure aux traces de
      // suppression conservées : pull complet puis rapprochement. Un second
      // 410 pendant ce pull complet remonte en erreur plutôt que de boucler
      // (écart du contrat, voir spec.md « Suivi des écarts »).
      if (readApiFailure(err).code !== 'SYNC_TOKEN_EXPIRED') throw err;
      await this.fullResync();
    }
  }

  /**
   * RT_68: chaque page est appliquée, puis sa révision mémorisée, avant de
   * demander la suivante — une synchronisation interrompue reprend là où
   * elle s'est arrêtée.
   */
  private async pullFrom(since: string, seen?: Set<string>): Promise<void> {
    let cursor = since;
    let hasMore = true;
    while (hasMore) {
      const params: Record<string, string> = { limit: String(PULL_PAGE_SIZE) };
      if (cursor) params['since'] = cursor;
      const page = await firstValueFrom(this.http.get<SyncPullResult>(syncUrl('/sync/changes'), { params }));

      const tombstoneIds = new Set((await this.library.tombstones()).map((t) => t.id));
      const plan = planPullPage(page, {
        lists: this.library.lists(),
        deployments: this.library.deployments(),
        tombstoneIds,
      });
      await this.library.applyRemote(plan);
      for (const record of [...page.lists, ...page.deployments]) seen?.add(record.id);

      cursor = page.nextToken;
      this.setSince(cursor);
      hasMore = page.hasMore;
    }
  }

  /**
   * RT_68: après un 410, pull complet ; les enregistrements synchronisés que
   * le compte n'a plus sont supprimés localement, sauf ceux modifiés
   * localement, qui partent à la poussée suivante.
   */
  private async fullResync(): Promise<void> {
    const seen = new Set<string>();
    this.setSince('');
    await this.pullFrom('', seen);

    const gone = <T extends ArmyList | Deployment>(r: T) => r.versionToken !== null && !r.dirty && !seen.has(r.id);
    const deployments = this.library.deployments();
    const deletedDeploymentIds = deployments.filter(gone).map((d) => d.id);
    const deletedListIds = this.library
      .lists()
      .filter(gone)
      .filter((l) => !deployments.some((d) => d.listId === l.id && d.dirty))
      .map((l) => l.id);
    await this.library.applyRemote({ deletedListIds, deletedDeploymentIds });
  }

  // -------------------------------------------------------------------------
  // RT_68 — poussée
  // -------------------------------------------------------------------------

  /**
   * RT_68: chaque enregistrement modifié localement part avec son jeton de
   * base, chaque suppression avec celui de la version supprimée. Les
   * conflits et rejets remplacent ceux de la poussée précédente : un
   * enregistrement en conflit est poussé de nouveau à chaque passe (le
   * serveur n'écrit rien), ce qui présente toujours la version serveur la
   * plus récente.
   */
  private async push(): Promise<void> {
    const { lists, deployments } = this.library.dirtyRecords();
    const tombstones = await this.library.tombstones();

    const pushedUpdatedAt = new Map<string, string>(
      [...lists, ...deployments].map((r) => [r.id, r.updatedAt]),
    );
    const conflicts: PendingConflict[] = [];
    const rejected: RejectedRecord[] = [];

    for (const batch of buildPushBatches(this.since(), lists, deployments, tombstones)) {
      let result: SyncPushResult;
      try {
        result = await this.idempotentPost<SyncPushResult>('/sync/changes', batch);
      } catch (err) {
        // RT_69: `413 BATCH_TOO_LARGE` — un groupe indivisible dépasse seul
        // les bornes ; ses enregistrements restent intacts et signalés.
        if (readApiFailure(err).code !== 'BATCH_TOO_LARGE') throw err;
        rejected.push(...this.batchRejected(batch, readApiFailure(err).message));
        continue;
      }
      await this.library.markAccepted(result.accepted, pushedUpdatedAt);
      conflicts.push(...result.conflicts.map((c) => this.withLocalVersion(c, batch)));
      rejected.push(...result.rejected);
    }

    this.pendingConflicts.set(conflicts);
    this.rejected.set(rejected);
  }

  private batchRejected(batch: SyncPushRequest, message: string): RejectedRecord[] {
    return [
      ...batch.lists.map((l) => ({ resourceType: 'list' as const, id: l.id })),
      ...batch.deployments.map((d) => ({ resourceType: 'deployment' as const, id: d.id })),
      ...batch.deletions.map((d) => ({ resourceType: d.resourceType, id: d.id })),
    ].map((r) => ({ ...r, code: 'INVALID_RECORD' as const, message }));
  }

  /** RG_54: la version locale présentée à côté de la version serveur. */
  private withLocalVersion(conflict: SyncConflict, batch: SyncPushRequest): PendingConflict {
    const written =
      conflict.resourceType === 'list'
        ? batch.lists.find((l) => l.id === conflict.id)
        : batch.deployments.find((d) => d.id === conflict.id);
    if (written) return { ...conflict, local: { deleted: false, record: written, updatedAt: written.updatedAt } };

    const deletion = batch.deletions.find((d) => d.resourceType === conflict.resourceType && d.id === conflict.id);
    return { ...conflict, local: { deleted: true, updatedAt: deletion?.deletedAt ?? '' } };
  }

  /**
   * RT_68: requête rejouable. La clé d'idempotence d'un corps resté sans
   * réponse (erreur réseau) est conservée et réutilisée tant que le même
   * corps est renvoyé : une requête rejouée après une réponse perdue renvoie
   * la réponse initiale au lieu de produire des conflits contre ses propres
   * écritures.
   */
  private async idempotentPost<T>(path: string, body: unknown): Promise<T> {
    const print = fingerprint(`${path}\n${JSON.stringify(body)}`);
    const keys = this.store.getConfig<Record<string, string>>(IDEMPOTENCY_KEY) ?? {};
    const key = keys[print] ?? uuid();
    const save = (next: Record<string, string>) =>
      this.store.setConfig(IDEMPOTENCY_KEY, Object.fromEntries(Object.entries(next).slice(-IDEMPOTENCY_MAX_ENTRIES)));
    save({ ...keys, [print]: key });

    try {
      const result = await firstValueFrom(
        this.http.post<T>(syncUrl(path), body, { headers: new HttpHeaders({ 'Idempotency-Key': key }) }),
      );
      const { [print]: _done, ...rest } = this.store.getConfig<Record<string, string>>(IDEMPOTENCY_KEY) ?? {};
      save(rest);
      return result;
    } catch (err) {
      // Seule une absence de réponse justifie de rejouer la même clé : une
      // réponse du serveur, même d'erreur, est définitive pour ce corps.
      if (readApiFailure(err).status !== 0) {
        const { [print]: _done, ...rest } = this.store.getConfig<Record<string, string>>(IDEMPOTENCY_KEY) ?? {};
        save(rest);
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // RG_11 / RG_54 — résolution des conflits
  // -------------------------------------------------------------------------

  /**
   * RG_54: le joueur a comparé les deux versions — date, heure et appareil de
   * chacune — et désigné celle qui prime ; ce choix écrase l'autre pour cet
   * enregistrement et ceux qui lui sont liés.
   */
  async resolveConflict(conflict: PendingConflict, choice: ConflictChoice): Promise<void> {
    let result: ConflictResolutionResult;
    try {
      result = await this.idempotentPost<ConflictResolutionResult>(
        '/sync/conflicts/resolve',
        this.resolutionBody(conflict, choice),
      );
    } catch (err) {
      const failure = readApiFailure(err);
      // RT_68: résolution périmée — le serveur a changé depuis la version
      // présentée. On tire puis on représente le conflit : le joueur ne
      // tranche jamais contre une version qu'il n'a pas vue.
      if (failure.code === 'CONFLICT_STALE') {
        void this.synchronize();
        throw new Error(
          "La version de l'autre appareil a changé entre-temps : comparez de nouveau les deux versions",
        );
      }
      throw new Error(failure.message);
    }

    await this.applyResolution(result);
    const settled = new Set([
      `${result.resourceType}:${result.id}`,
      ...result.relatedRecords.map((r) => `${r.resourceType}:${r.record.id}`),
      ...result.relatedDeletions.map((r) => `${r.resourceType}:${r.id}`),
    ]);
    this.pendingConflicts.set(
      this.pendingConflicts().filter((c) => !settled.has(`${c.resourceType}:${c.id}`)),
    );
    // Les enregistrements liés restés en attente (suppressions de
    // déploiements d'une liste, par exemple) repartent aussitôt.
    void this.synchronize();
  }

  /** RT_68: corps de la résolution, selon la nature du conflit et le choix du joueur. */
  private resolutionBody(conflict: PendingConflict, choice: ConflictChoice): ConflictResolution {
    const local = this.currentLocalRecord(conflict);
    const body: {
      -readonly [K in keyof ConflictResolution]: ConflictResolution[K];
    } = {
      resourceType: conflict.resourceType,
      id: conflict.id,
      kind: conflict.kind,
      resolution: choice,
      serverVersionToken: conflict.serverVersionToken,
    };

    const localIsDeletion = conflict.kind === 'deletedLocally' || conflict.kind === 'listDeletedLocally';
    if (choice === 'keepLocal' && !localIsDeletion) body.localRecord = local;

    if (conflict.kind === 'listDeletedOnServer') {
      // Écart du contrat (spec.md, « Suivi des écarts ») : pour un déploiement
      // jamais écrit sur le serveur, seule la version locale désigne sa
      // liste — elle est jointe quel que soit le choix.
      body.localRecord = local;
      if (choice === 'keepLocal') {
        const listId = (local as WireDeployment | undefined)?.listId;
        const list = listId ? this.library.list(listId) : undefined;
        if (!list) throw new Error('La liste de ce déploiement est introuvable sur cet appareil');
        // RG_54: garder le déploiement conserve aussi sa liste, restaurée.
        body.localList = toWireList(list);
      }
    }
    if (conflict.kind === 'duplicateDeployment' && conflict.serverRecord) {
      body.duplicateServerDeploymentId = conflict.serverRecord.id;
    }
    return body;
  }

  /** La version locale à jour (le joueur a pu la modifier depuis la détection du conflit). */
  private currentLocalRecord(conflict: PendingConflict): WireArmyList | WireDeployment | undefined {
    if (conflict.resourceType === 'list') {
      const list = this.library.list(conflict.id);
      if (list) return toWireList(list);
    } else {
      const deployment = this.library.deployments().find((d) => d.id === conflict.id);
      if (deployment) return toWireDeployment(deployment);
    }
    return conflict.local.deleted ? undefined : conflict.local.record;
  }

  /**
   * RT_68: la version retenue devient l'état local, marquée synchronisée ;
   * les enregistrements liés sont écrits ou supprimés. Une liste supprimée
   * l'est avec ses déploiements (RG_21).
   */
  private async applyResolution(result: ConflictResolutionResult): Promise<void> {
    const lists: ArmyList[] = [];
    const deployments: Deployment[] = [];
    const deletedListIds: string[] = [];
    const deletedDeploymentIds: string[] = [];
    const clearedTombstoneIds: string[] = [result.id];

    const remove = (resourceType: 'list' | 'deployment', id: string) => {
      clearedTombstoneIds.push(id);
      if (resourceType === 'deployment') {
        deletedDeploymentIds.push(id);
        return;
      }
      deletedListIds.push(id);
      deletedDeploymentIds.push(...this.library.deploymentsOfList(id).map((d) => d.id));
    };
    const write = (resourceType: 'list' | 'deployment', record: WireArmyList | WireDeployment, token: string) => {
      clearedTombstoneIds.push(record.id);
      if (resourceType === 'list') lists.push(fromWireList(record as WireArmyList, token));
      else deployments.push(fromWireDeployment(record as WireDeployment, token));
    };

    if (result.deleted || !result.record) remove(result.resourceType, result.id);
    else write(result.resourceType, result.record, result.versionToken ?? '');
    for (const related of result.relatedRecords) write(related.resourceType, related.record, related.versionToken);
    for (const deletion of result.relatedDeletions) remove(deletion.resourceType, deletion.id);

    await this.library.applyRemote({
      lists,
      deployments,
      deletedListIds,
      deletedDeploymentIds,
      clearedTombstoneIds,
    });
  }

  // -------------------------------------------------------------------------
  // RG_19 — affichage
  // -------------------------------------------------------------------------

  /** RG_19: libellé de l'état de synchronisation affiché à l'écran. */
  stateLabel(): string {
    switch (this.state()) {
      case 'localOnly':
        return 'Usage local uniquement';
      case 'awaitingChoice':
        return 'En attente de votre choix';
      case 'offline':
        return 'Hors-ligne — synchronisation en attente';
      case 'pending':
        return 'Modifications en attente de synchronisation';
      case 'syncing':
        return 'Synchronisation en cours…';
      case 'conflict':
        return 'Conflit à arbitrer';
      case 'rejected':
        return `${this.rejected().length} élément(s) refusé(s) par le serveur`;
      case 'upgradeRequired':
        return "Mettez l'application à jour pour synchroniser";
      case 'error':
        return `Non synchronisé (${this.lastError()})`;
      case 'synced':
        return 'Synchronisé';
    }
  }
}
