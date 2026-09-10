import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { LibraryService } from '../data/library.service';
import { LocalStoreService } from '../data/local-store.service';
import { ArmyList, Deployment } from '../models/domain.models';
import {
  ConflictResolution,
  ConflictResolutionResult,
  PendingConflict,
  SyncPullResult,
  SyncPushRequest,
  SyncPushResult,
  SyncState,
} from '../models/sync.models';
import { AuthService, describeHttpError } from './auth.service';
import { ConnectivityService } from './connectivity.service';

const TOKEN_KEY = 'sync.versionToken';

/**
 * RT_09 / RT_10 / RT_15 — synchronisation delta avec le backend.
 *
 * RG_09: tout échec est absorbé en arrière-plan, sans bloquer ni interrompre
 * le travail en cours ; l'état « non synchronisé » reste visible (RG_19) mais
 * jamais bloquant.
 * RG_11: un enregistrement en conflit n'est jamais arbitré automatiquement —
 * il est mis en attente et présenté au joueur, les autres enregistrements
 * continuant de se synchroniser.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly library = inject(LibraryService);
  private readonly store = inject(LocalStoreService);

  /** RT_15: jeton de la dernière synchronisation réussie de cet appareil. */
  private readonly versionToken = signal<string | null>(this.store.getConfig<string>(TOKEN_KEY));

  /** RG_11: conflits en attente d'arbitrage explicite du joueur. */
  readonly pendingConflicts = signal<readonly PendingConflict[]>([]);

  readonly lastError = signal<string | null>(null);
  readonly lastSyncedAt = signal<string | null>(this.store.getConfig<string>('sync.lastSyncedAt'));
  private readonly running = signal(false);

  /** RG_19: état de synchronisation affiché par l'écran Réglages. */
  readonly state = computed<SyncState>(() => {
    if (!this.auth.signedIn()) return 'localOnly';
    if (this.pendingConflicts().length > 0) return 'conflict';
    if (!this.connectivity.online()) return 'offline';
    if (this.running()) return 'syncing';
    if (this.lastError()) return 'error';
    const { lists, deployments } = this.library.dirtyRecords();
    return lists.length || deployments.length ? 'pending' : 'synced';
  });

  constructor() {
    // RT_10: déclenchement à la reprise du réseau et à l'ouverture d'une
    // session, jamais de façon bloquante pour l'interaction en cours.
    effect(() => {
      this.connectivity.reconnections();
      const signedIn = this.auth.signedIn();
      const online = this.connectivity.online();
      if (signedIn && online) void this.synchronize();
    });
  }

  /**
   * RT_10: retour au premier plan de l'application. Appelé par le composant
   * racine (`App.resume` de Capacitor / `visibilitychange` en web).
   */
  onAppResumed(): void {
    if (this.auth.signedIn() && this.connectivity.online()) void this.synchronize();
  }

  private url(path: string): string {
    return `${environment.syncApiBaseUrl}${path}`;
  }

  private setToken(token: string): void {
    this.versionToken.set(token);
    this.store.setConfig(TOKEN_KEY, token);
  }

  /**
   * Une passe de synchronisation : pull du delta serveur, puis push des
   * enregistrements modifiés localement. Jamais concurrente d'elle-même, et
   * toujours silencieuse en cas d'échec (RG_09).
   */
  async synchronize(): Promise<void> {
    if (this.running()) return;
    if (!this.auth.signedIn()) return;
    // RG_09: hors-ligne, on ne tente rien — l'état reste simplement « offline ».
    if (!this.connectivity.online()) return;

    this.running.set(true);
    try {
      await this.library.load();
      await this.pull();
      await this.push();
      this.lastError.set(null);
      const now = new Date().toISOString();
      this.lastSyncedAt.set(now);
      this.store.setConfig('sync.lastSyncedAt', now);
    } catch (err) {
      // RG_09: échec silencieux en arrière-plan. Le message n'est exposé que
      // par l'indicateur de RG_19, il n'interrompt aucun écran.
      this.lastError.set(describeHttpError(err));
    } finally {
      this.running.set(false);
    }
  }

  /** RT_09: récupération des changements serveur depuis le jeton local. */
  private async pull(): Promise<void> {
    const since = this.versionToken();
    const result = await firstValueFrom(
      this.http.get<SyncPullResult>(this.url('/sync/changes'), {
        params: since ? { since } : {},
      }),
    );

    // RT_15: on n'écrase jamais localement un enregistrement modifié depuis
    // le dernier sync — il partira au push et, si le serveur a bougé aussi,
    // reviendra en conflit (RG_11).
    const dirty = this.library.dirtyRecords();
    const dirtyListIds = new Set(dirty.lists.map((l) => l.id));
    const dirtyDeploymentIds = new Set(dirty.deployments.map((d) => d.id));

    await this.library.applyServerDelta({
      lists: result.lists.filter((l) => !dirtyListIds.has(l.id)),
      deployments: result.deployments.filter((d) => !dirtyDeploymentIds.has(d.id)),
      deletedListIds: result.deletedListIds.filter((id) => !dirtyListIds.has(id)),
      deletedDeploymentIds: result.deletedDeploymentIds.filter((id) => !dirtyDeploymentIds.has(id)),
    });
    this.setToken(result.nextToken);
  }

  /** RT_09/RT_15: poussée des modifications locales et collecte des conflits. */
  private async push(): Promise<void> {
    const { lists, deployments } = this.library.dirtyRecords();
    const tombstones = await this.library.tombstones();
    if (!lists.length && !deployments.length && !tombstones.length) return;

    const request: SyncPushRequest = {
      since: this.versionToken() ?? '',
      // `dirty` est un état d'appareil (RT_15), pas une donnée partagée : il
      // ne fait pas partie du contrat et n'est pas transmis.
      lists: lists.map(({ dirty: _dirty, ...list }) => list as ArmyList),
      deployments: deployments.map(({ dirty: _dirty, ...deployment }) => deployment as Deployment),
      // RG_08/RG_21: suppressions déjà confirmées explicitement par le joueur.
      deletedListIds: tombstones.filter((t) => t.resourceType === 'list').map((t) => t.id),
      deletedDeploymentIds: tombstones
        .filter((t) => t.resourceType === 'deployment')
        .map((t) => t.id),
    };

    const result = await firstValueFrom(
      this.http.post<SyncPushResult>(this.url('/sync/changes'), request),
    );

    await this.library.markSynced(
      result.acceptedListIds,
      result.acceptedDeploymentIds,
      result.nextToken,
    );
    await this.library.clearTombstones([
      ...(request.deletedListIds ?? []),
      ...(request.deletedDeploymentIds ?? []),
    ]);
    this.setToken(result.nextToken);

    // RG_11/RT_15: les enregistrements en conflit sont mis en attente avec
    // leurs deux versions ; les autres viennent d'être acceptés normalement.
    this.registerConflicts(result, lists, deployments);
  }

  private registerConflicts(
    result: SyncPushResult,
    lists: readonly ArmyList[],
    deployments: readonly Deployment[],
  ): void {
    if (result.conflicts.length === 0) return;

    const pending: PendingConflict[] = [];
    for (const conflict of result.conflicts) {
      const localRecord =
        conflict.resourceType === 'list'
          ? lists.find((l) => l.id === conflict.id)
          : deployments.find((d) => d.id === conflict.id);
      if (localRecord) pending.push({ ...conflict, localRecord });
    }

    const known = new Set(this.pendingConflicts().map((c) => `${c.resourceType}:${c.id}`));
    this.pendingConflicts.set([
      ...this.pendingConflicts(),
      ...pending.filter((c) => !known.has(`${c.resourceType}:${c.id}`)),
    ]);
  }

  /**
   * RG_11: le joueur a comparé les deux versions horodatées et choisi celle à
   * conserver ; ce choix écrase l'autre pour ce seul enregistrement.
   */
  async resolveConflict(
    conflict: PendingConflict,
    resolution: 'keepLocal' | 'keepServer',
  ): Promise<void> {
    const payload: ConflictResolution = {
      resourceType: conflict.resourceType,
      id: conflict.id,
      resolution,
      localRecord: resolution === 'keepLocal' ? conflict.localRecord : undefined,
    };

    const result = await firstValueFrom(
      this.http.post<ConflictResolutionResult>(this.url('/sync/conflicts/resolve'), payload),
    );

    // La version retenue devient l'état local courant, marquée synchronisée.
    await this.library.applyServerDelta({
      lists: result.resourceType === 'list' ? [result.record as ArmyList] : [],
      deployments: result.resourceType === 'deployment' ? [result.record as Deployment] : [],
      deletedListIds: [],
      deletedDeploymentIds: [],
    });
    this.setToken(result.versionToken);

    this.pendingConflicts.set(
      this.pendingConflicts().filter(
        (c) => !(c.resourceType === conflict.resourceType && c.id === conflict.id),
      ),
    );
  }

  /** RG_19: libellé de l'état de synchronisation affiché à l'écran. */
  stateLabel(): string {
    switch (this.state()) {
      case 'localOnly':
        return 'Usage local uniquement';
      case 'offline':
        return 'Hors-ligne — synchronisation en attente';
      case 'pending':
        return 'Modifications en attente de synchronisation';
      case 'syncing':
        return 'Synchronisation en cours…';
      case 'conflict':
        return 'Conflit à arbitrer';
      case 'error':
        return `Non synchronisé (${this.lastError()})`;
      case 'synced':
        return 'Synchronisé';
    }
  }
}
