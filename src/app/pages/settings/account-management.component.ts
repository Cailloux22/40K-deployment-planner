import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AlertController } from '@ionic/angular/lazy';

import { AuthError, AuthService, PASSWORD_MAX, PASSWORD_MIN } from '../../net/auth.service';
import { SyncService } from '../../net/sync.service';

type AccountAction = 'password' | 'email' | 'delete';

/**
 * RG_52 — gestion du compte connecté, depuis le bloc Compte des Réglages
 * (RG_18) : changer le mot de passe, changer l'adresse, supprimer le compte.
 * Chaque action exige le mot de passe courant et n'est proposée qu'en ligne
 * (RG_09). Aucune ne déconnecte les appareils (RG_53), sauf la suppression.
 */
@Component({
  selector: 'app-account-management',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="actions">
      <ion-button fill="clear" size="small" [disabled]="!online()" (click)="open('password')">
        Changer le mot de passe
      </ion-button>
      <ion-button fill="clear" size="small" [disabled]="!online()" (click)="open('email')">
        Changer l'adresse email
      </ion-button>
      <ion-button fill="clear" size="small" color="danger" [disabled]="!online()" (click)="open('delete')">
        Supprimer le compte
      </ion-button>
    </div>

    @if (action(); as current) {
      <div class="form">
        @if (current === 'email') {
          <ion-item>
            <ion-input
              label="Nouvelle adresse email"
              labelPlacement="stacked"
              type="email"
              autocomplete="email"
              inputmode="email"
              [value]="newEmail()"
              (ionInput)="newEmail.set($any($event.target).value)"
            ></ion-input>
          </ion-item>
        }
        <ion-item>
          <ion-input
            label="Mot de passe actuel"
            labelPlacement="stacked"
            type="password"
            autocomplete="current-password"
            [value]="password()"
            (ionInput)="password.set($any($event.target).value)"
          >
            <ion-input-password-toggle slot="end"></ion-input-password-toggle>
          </ion-input>
        </ion-item>
        @if (current === 'password') {
          <ion-item>
            <ion-input
              label="Nouveau mot de passe"
              labelPlacement="stacked"
              type="password"
              autocomplete="new-password"
              [maxlength]="passwordMax"
              [value]="newPassword()"
              (ionInput)="newPassword.set($any($event.target).value)"
            >
              <ion-input-password-toggle slot="end"></ion-input-password-toggle>
            </ion-input>
          </ion-item>
          <ion-note class="hint">{{ passwordMin }} à {{ passwordMax }} caractères.</ion-note>
        }
        @if (current === 'delete') {
          <ion-note color="danger" class="hint">
            Les listes et déploiements enregistrés sur le serveur seront définitivement supprimés.
            Ceux de cet appareil sont conservés.
          </ion-note>
        }

        @if (message(); as text) {
          <ion-note [color]="failed() ? 'danger' : 'success'" class="hint">{{ text }}</ion-note>
        }

        <div class="buttons">
          <ion-button fill="clear" size="small" (click)="close()">Annuler</ion-button>
          <ion-button
            size="small"
            [color]="current === 'delete' ? 'danger' : 'primary'"
            [disabled]="!canSubmit()"
            (click)="submit(current)"
          >
            {{ submitLabel(current) }}
          </ion-button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .actions {
        display: flex;
        flex-wrap: wrap;
        padding: 0 8px;
      }
      .form {
        padding-bottom: 8px;
      }
      .hint {
        display: block;
        padding: 4px 16px;
        font-size: var(--app-font-sm);
      }
      .buttons {
        display: flex;
        justify-content: flex-end;
        padding: 0 8px;
      }
    `,
  ],
})
export class AccountManagementComponent {
  private readonly auth = inject(AuthService);
  private readonly sync = inject(SyncService);
  private readonly alerts = inject(AlertController);

  readonly online = this.auth.canAuthenticate;
  readonly passwordMin = PASSWORD_MIN;
  readonly passwordMax = PASSWORD_MAX;

  readonly action = signal<AccountAction | null>(null);
  readonly password = signal('');
  readonly newPassword = signal('');
  readonly newEmail = signal('');
  readonly busy = signal(false);
  readonly message = signal<string | null>(null);
  readonly failed = signal(false);

  readonly canSubmit = computed(() => {
    if (this.busy() || !this.online() || !this.password()) return false;
    switch (this.action()) {
      case 'password':
        // RG_50: 8 à 128 caractères, sans autre contrainte de composition.
        return this.newPassword().length >= PASSWORD_MIN && this.newPassword().length <= PASSWORD_MAX;
      case 'email':
        return this.newEmail().includes('@');
      default:
        return true;
    }
  });

  open(action: AccountAction): void {
    this.action.set(this.action() === action ? null : action);
    this.password.set('');
    this.newPassword.set('');
    this.newEmail.set('');
    this.message.set(null);
  }

  close(): void {
    this.action.set(null);
    this.password.set('');
    this.newPassword.set('');
    this.message.set(null);
  }

  submitLabel(action: AccountAction): string {
    return action === 'delete' ? 'Supprimer définitivement' : 'Enregistrer';
  }

  async submit(action: AccountAction): Promise<void> {
    if (action === 'delete') {
      await this.confirmDelete();
      return;
    }
    await this.run(async () => {
      if (action === 'password') {
        await this.auth.changePassword(this.password(), this.newPassword());
        return 'Mot de passe changé. Vos appareils restent connectés.';
      }
      const user = await this.auth.changeEmail(this.newEmail().trim(), this.password());
      return `Adresse changée : ${user.email}.`;
    });
  }

  /** RG_52/RG_08: suppression confirmée explicitement, immédiate et totale côté serveur. */
  private async confirmDelete(): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Supprimer le compte ?',
      message:
        'Le compte, et les listes et déploiements enregistrés sur le serveur, seront supprimés ' +
        'immédiatement et définitivement. Les listes et déploiements de cet appareil sont conservés.',
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        {
          text: 'Supprimer',
          role: 'destructive',
          handler: () => {
            void this.run(async () => {
              await this.auth.deleteAccount(this.password());
              // RG_10: l'appareil repasse aussitôt en usage local.
              this.sync.forgetAccount();
              return null;
            });
          },
        },
      ],
    });
    await alert.present();
  }

  private async run(work: () => Promise<string | null>): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      const done = await work();
      this.failed.set(false);
      this.password.set('');
      this.newPassword.set('');
      if (done) this.message.set(done);
      else this.action.set(null);
    } catch (err) {
      this.failed.set(true);
      this.message.set(err instanceof AuthError ? err.message : `Action impossible : ${(err as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }
}
