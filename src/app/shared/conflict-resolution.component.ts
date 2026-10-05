import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { normalizeGameplanNote } from '../deployment/gameplan-note';
import { ArmyList, Deployment } from '../models/domain.models';
import { PendingConflict } from '../models/sync.models';
import { SyncService } from '../net/sync.service';

/**
 * RG_11 / RT_15 — résolution de conflit de synchronisation.
 *
 * Présente explicitement au joueur les deux versions du même enregistrement
 * (locale et serveur) avec leur horodatage respectif ; l'application ne choisit
 * jamais à sa place. Les enregistrements non conflictuels continuent de se
 * synchroniser sans attendre cette décision (RT_15) : ce panneau ne bloque que
 * l'enregistrement concerné.
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
            Cet élément a été modifié sur deux appareils avant la resynchronisation. Choisissez la
            version à conserver : l'autre sera écrasée, pour cet élément uniquement.
          </p>

          <ion-radio-group [value]="choice()" (ionChange)="choice.set($any($event.detail.value))">
            <ion-item>
              <ion-radio value="keepLocal" justify="start" labelPlacement="end">
                <div class="version">
                  <strong>Version de cet appareil</strong>
                  <small>Modifiée le {{ formatDate(localUpdatedAt(current)) }}</small>
                  <small>{{ describe(current.localRecord) }}</small>
                </div>
              </ion-radio>
            </ion-item>
            <ion-item lines="none">
              <ion-radio value="keepServer" justify="start" labelPlacement="end">
                <div class="version">
                  <strong>Version du serveur</strong>
                  <small>Modifiée le {{ formatDate(serverUpdatedAt(current)) }}</small>
                  <small>{{ describe(current.serverRecord) }}</small>
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

  readonly choice = signal<'keepLocal' | 'keepServer'>('keepLocal');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** RG_11: un conflit est arbitré à la fois, les autres restent en attente. */
  readonly conflict = computed(() => this.sync.pendingConflicts()[0]);
  readonly remaining = computed(() => Math.max(this.sync.pendingConflicts().length - 1, 0));

  label(conflict: PendingConflict): string {
    const record = conflict.localRecord;
    return conflict.resourceType === 'list'
      ? `Liste « ${(record as ArmyList).name} »`
      : `Déploiement « ${(record as Deployment).name} »`;
  }

  localUpdatedAt(conflict: PendingConflict): string {
    return conflict.localRecord.updatedAt;
  }

  serverUpdatedAt(conflict: PendingConflict): string {
    return conflict.serverRecord.updatedAt;
  }

  describe(record: ArmyList | Deployment): string {
    if ('units' in record) {
      const units = record.units.length;
      const models = record.units.reduce((sum, unit) => sum + unit.modelCount, 0);
      return `${units} unité(s), ${models} modèle(s)`;
    }
    // RG_25/RT_35: la réserve fait partie de ce que le joueur arbitre.
    const reserved = record.reservedUnitIds?.length ?? 0;
    const placements = `${record.placements.length} placement(s)`;
    const summary = reserved > 0 ? `${placements}, ${reserved} unité(s) en réserve` : placements;
    // RT_60: la note de plan de jeu fait partie de chaque version arbitrée ;
    // son début suffit à distinguer les deux versions.
    const note = normalizeGameplanNote(record.note).trim();
    if (!note) return summary;
    const excerpt = note.length > 80 ? `${note.slice(0, 80).trimEnd()}…` : note;
    return `${summary} — plan de jeu : « ${excerpt.replace(/\s+/g, ' ')} »`;
  }

  formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('fr-FR');
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
