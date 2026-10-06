import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { normalizeGameplanNote } from '../deployment/gameplan-note';
import {
  ConflictChoice,
  ConflictKind,
  PendingConflict,
  WireArmyList,
  WireDeployment,
  WireRecord,
} from '../models/sync.models';
import { DeviceService } from '../net/device.service';
import { SyncService } from '../net/sync.service';

/** RG_54: ce qui s'est passé, dit au joueur pour chaque nature de conflit. */
const EXPLANATIONS: Record<ConflictKind, string> = {
  bothModified: 'Cet élément a été modifié sur deux appareils sans synchronisation entre les deux.',
  deletedOnServer: 'Cet élément a été modifié sur cet appareil, et supprimé sur un autre.',
  deletedLocally: 'Cet élément a été supprimé sur cet appareil, et modifié sur un autre.',
  listDeletedOnServer:
    'Ce déploiement a été modifié sur cet appareil, mais sa liste a été supprimée sur un autre. ' +
    'Garder la suppression supprime aussi ce déploiement ; garder le déploiement conserve aussi sa liste.',
  listDeletedLocally:
    "Cette liste a été supprimée sur cet appareil, mais un autre appareil a créé ou modifié de ses déploiements. " +
    'Garder la suppression les supprime aussi ; garder la liste les conserve.',
  duplicateDeployment:
    'Ce plateau a été préparé sur deux appareils sans que l’un voie le déploiement de l’autre. ' +
    'Gardez l’un des deux : l’autre sera supprimé.',
};

/**
 * RG_11 / RG_54 / RT_15 — résolution de conflit de synchronisation.
 *
 * Présente explicitement au joueur les deux versions du même enregistrement,
 * chacune avec la date et l'heure de la modification et l'appareil qui l'a
 * faite ; l'application ne choisit jamais à sa place, et les horodatages
 * sont affichés, jamais comparés. Les enregistrements non conflictuels
 * continuent de se synchroniser sans attendre cette décision : ce panneau ne
 * bloque que l'enregistrement concerné.
 */
@Component({
  selector: 'app-conflict-resolution',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (conflict(); as current) {
      <ion-card class="conflict">
        <ion-card-header>
          <ion-card-subtitle>Conflit de synchronisation</ion-card-subtitle>
          <ion-card-title>{{ label(current) }}</ion-card-title>
        </ion-card-header>

        <ion-card-content>
          <p class="explain">
            {{ explanation(current) }} Choisissez la version qui prime : l'autre sera écrasée.
          </p>

          @if (current.relatedServerRecords?.length) {
            <!-- RG_54: les déploiements concernés sont listés avec le conflit. -->
            <p class="related">Déploiements concernés :</p>
            <ul class="related">
              @for (deployment of current.relatedServerRecords; track deployment.id) {
                <li>{{ deployment.name }}</li>
              }
            </ul>
          }

          <ion-radio-group [value]="choice()" (ionChange)="choice.set($any($event.detail.value))">
            <ion-item>
              <ion-radio value="keepLocal" justify="start" labelPlacement="end">
                <div class="version">
                  <strong>Version de cet appareil</strong>
                  <small>{{ localWhen(current) }}</small>
                  @if (!current.local.deleted) {
                    <small>{{ describe(current.local.record) }}</small>
                  }
                </div>
              </ion-radio>
            </ion-item>
            <ion-item lines="none">
              <ion-radio value="keepServer" justify="start" labelPlacement="end">
                <div class="version">
                  <strong>Version de {{ serverDevice(current) }}</strong>
                  <small>{{ serverWhen(current) }}</small>
                  @if (current.serverRecord) {
                    <small>{{ describe(current.serverRecord) }}</small>
                  }
                </div>
              </ion-radio>
            </ion-item>
          </ion-radio-group>

          @if (error()) {
            <ion-note color="danger">{{ error() }}</ion-note>
          }

          <ion-button expand="block" [disabled]="busy()" (click)="resolve(current)">
            Conserver cette version
          </ion-button>

          @if (remaining() > 0) {
            <ion-note class="remaining">
              {{ remaining() }} autre(s) conflit(s) à arbitrer ensuite.
            </ion-note>
          }
        </ion-card-content>
      </ion-card>
    }
  `,
  styles: [
    `
      .conflict {
        margin: 12px;
      }
      .explain {
        margin-top: 0;
        font-size: var(--app-font-sm);
      }
      .related {
        margin: 4px 0;
        font-size: var(--app-font-sm);
      }
      ul.related {
        padding-left: 20px;
      }
      .version {
        display: flex;
        flex-direction: column;
        gap: 2px;
        white-space: normal;
      }
      .version small {
        color: var(--app-text-secondary);
      }
      ion-button {
        margin-top: 12px;
      }
      .remaining {
        display: block;
        margin-top: 8px;
        font-size: var(--app-font-sm);
      }
    `,
  ],
})
export class ConflictResolutionComponent {
  private readonly sync = inject(SyncService);
  private readonly device = inject(DeviceService);

  readonly choice = signal<ConflictChoice>('keepLocal');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** RG_11: un conflit est arbitré à la fois, les autres restent en attente. */
  readonly conflict = computed(() => this.sync.pendingConflicts()[0]);
  readonly remaining = computed(() => Math.max(this.sync.pendingConflicts().length - 1, 0));

  label(conflict: PendingConflict): string {
    const record = (conflict.local.deleted ? null : conflict.local.record) ?? conflict.serverRecord;
    const name = record?.name ?? 'sans nom';
    return conflict.resourceType === 'list' ? `Liste « ${name} »` : `Déploiement « ${name} »`;
  }

  explanation(conflict: PendingConflict): string {
    return EXPLANATIONS[conflict.kind];
  }

  /** RG_54: date et heure de la version locale — modification ou suppression. */
  localWhen(conflict: PendingConflict): string {
    const verb = conflict.local.deleted ? 'Supprimée' : 'Modifiée';
    return `${verb} le ${this.formatDate(conflict.local.updatedAt)} sur cet appareil`;
  }

  /** RG_54: « Cet appareil », ou le nom de l'appareil auteur de la version serveur. */
  serverDevice(conflict: PendingConflict): string {
    return this.device.label(conflict.serverDevice);
  }

  serverWhen(conflict: PendingConflict): string {
    const device = this.serverDevice(conflict);
    const when = this.formatDate(conflict.serverUpdatedAt);
    if (conflict.kind === 'listDeletedOnServer') return `Liste supprimée le ${when} sur ${device}`;
    const verb = conflict.serverRecord ? 'Modifiée' : 'Supprimée';
    return `${verb} le ${when} sur ${device}`;
  }

  describe(record: WireRecord): string {
    if ('units' in record) {
      const list = record as WireArmyList;
      const units = list.units.length;
      const models = list.units.reduce((sum, unit) => sum + unit.modelCount, 0);
      return `${units} unité(s), ${models} modèle(s)`;
    }
    const deployment = record as WireDeployment;
    // RG_25/RT_35: la réserve fait partie de ce que le joueur arbitre.
    const reserved = deployment.reservedUnitIds?.length ?? 0;
    const placements = `${deployment.placements.length} placement(s)`;
    const summary = reserved > 0 ? `${placements}, ${reserved} unité(s) en réserve` : placements;
    // RT_60: la note de plan de jeu fait partie de chaque version arbitrée ;
    // son début suffit à distinguer les deux versions.
    const note = normalizeGameplanNote(deployment.note).trim();
    if (!note) return summary;
    const excerpt = note.length > 80 ? `${note.slice(0, 80).trimEnd()}…` : note;
    return `${summary} — plan de jeu : « ${excerpt.replace(/\s+/g, ' ')} »`;
  }

  formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso || 'date inconnue' : date.toLocaleString('fr-FR');
  }

  async resolve(conflict: PendingConflict): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.sync.resolveConflict(conflict, this.choice());
      this.choice.set('keepLocal');
    } catch (err) {
      this.error.set(
        `Arbitrage impossible pour le moment : ${err instanceof Error ? err.message : 'erreur réseau'}.`,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
