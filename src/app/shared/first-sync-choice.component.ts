import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AlertController } from '@ionic/angular/lazy';

import { FirstConnectionChoice } from '../models/sync.models';
import { FirstConnectionDecision, SyncService } from '../net/sync.service';

/**
 * RG_51 — première connexion d'un appareil dont les données et celles du
 * compte ne sont ni l'une ni l'autre vides.
 *
 * Le joueur voit le nombre de listes et de déploiements de chaque côté et
 * choisit entre la fusion et le remplacement ; tant qu'il n'a pas choisi,
 * aucune synchronisation n'a lieu. Le remplacement, destructeur, est confirmé
 * explicitement (RG_08) en rappelant ce qui sera perdu. Fermer le choix sans
 * répondre déconnecte l'appareil, sans rien modifier.
 */
@Component({
  selector: 'app-first-sync-choice',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (choice(); as current) {
      <ion-card class="first-sync">
        <ion-card-header>
          <ion-card-subtitle>Première synchronisation</ion-card-subtitle>
          <ion-card-title>Que faire des données de cet appareil ?</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p>Cet appareil et le compte {{ current.email }} contiennent déjà des données :</p>
          <ul>
            <li>
              <strong>Cet appareil</strong> : {{ current.local.lists }} liste(s),
              {{ current.local.deployments }} déploiement(s)
            </li>
            <li>
              <strong>Le compte</strong> : {{ current.account.listCount }} liste(s),
              {{ current.account.deploymentCount }} déploiement(s)
              @if (current.account.lastChangeAt) {
                — dernière modification le {{ formatDate(current.account.lastChangeAt) }}
              }
            </li>
          </ul>

          <ion-button expand="block" [disabled]="busy()" (click)="decide('merge')">
            Ajouter ces données au compte
          </ion-button>
          <p class="hint">
            Les listes et déploiements de cet appareil rejoignent ceux du compte. Une même liste
            importée sur deux appareils apparaîtra en double : supprimez le doublon si vous le
            souhaitez.
          </p>

          <ion-button expand="block" fill="outline" color="danger" [disabled]="busy()" (click)="confirmReplace(current)">
            Les remplacer par celles du compte
          </ion-button>

          <ion-button expand="block" fill="clear" [disabled]="busy()" (click)="dismiss()">
            Ne pas synchroniser (se déconnecter)
          </ion-button>
        </ion-card-content>
      </ion-card>
    }
  `,
  styles: [
    `
      .first-sync {
        margin: 12px;
      }
      ul {
        padding-left: 20px;
      }
      .hint {
        margin: 4px 0 12px;
        font-size: var(--app-font-sm);
        color: var(--app-text-secondary);
      }
    `,
  ],
})
export class FirstSyncChoiceComponent {
  private readonly sync = inject(SyncService);
  private readonly alerts = inject(AlertController);

  readonly choice = this.sync.firstConnectionChoice;
  readonly busy = signal(false);

  formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('fr-FR');
  }

  async decide(decision: FirstConnectionDecision): Promise<void> {
    this.busy.set(true);
    try {
      await this.sync.chooseFirstConnection(decision);
    } finally {
      this.busy.set(false);
    }
  }

  /** RG_51/RG_08: action destructrice, confirmée en rappelant ce qui sera perdu. */
  async confirmReplace(current: FirstConnectionChoice): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Remplacer les données de cet appareil ?',
      message:
        `Les ${current.local.lists} liste(s) et ${current.local.deployments} déploiement(s) de cet ` +
        `appareil seront définitivement supprimés, puis remplacés par ceux du compte.`,
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        { text: 'Remplacer', role: 'destructive', handler: () => void this.decide('replace') },
      ],
    });
    await alert.present();
  }

  async dismiss(): Promise<void> {
    this.busy.set(true);
    try {
      await this.sync.dismissFirstConnection();
    } finally {
      this.busy.set(false);
    }
  }
}
