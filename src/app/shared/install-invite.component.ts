import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { InstallService } from '../pwa/install.service';

/**
 * RG_41 / RT_55 — invitation à installer l'application.
 *
 * Deux présentations du même contenu : `banner` (accueil, fermable — une fois
 * fermé il ne réapparaît plus sur cet appareil) et `block` (bloc
 * « Application » des Réglages, présent tant que l'installation n'est pas
 * faite). Le contenu dépend du navigateur : bouton d'installation quand il en
 * propose une, marche à suivre « Partager » sur iPhone et iPad.
 */
@Component({
  selector: 'app-install-invite',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (variant() === 'block' ? install.canInvite() : install.showBanner()) {
      <section class="invite" [class.banner]="variant() === 'banner'" aria-label="Installer l'application">
        <div class="body">
          @if (install.mode() === 'prompt') {
            <p>
              Installez l'application pour l'ouvrir depuis votre écran d'accueil, en plein écran,
              même sans réseau.
            </p>
            <ion-button size="small" (click)="promptInstall()">
              <ion-icon name="download-outline" slot="start" aria-hidden="true"></ion-icon>
              Installer l'application
            </ion-button>
          } @else {
            <p>
              Installez l'application : touchez
              <ion-icon name="share-outline" class="inline-icon" aria-label="Partager"></ion-icon>
              <strong>Partager</strong>, puis <strong>« Sur l'écran d'accueil »</strong>.
            </p>
            <!-- RG_41: sur iOS, l'application installée a son propre stockage. -->
            <p class="warning">
              Installez l'application avant d'importer vos listes : celles importées dans le
              navigateur n'y seront pas reprises.
            </p>
          }
        </div>
        @if (variant() === 'banner') {
          <ion-button
            class="dismiss"
            fill="clear"
            aria-label="Fermer l'invitation à installer"
            (click)="install.dismissBanner()"
          >
            <ion-icon name="close" slot="icon-only" aria-hidden="true"></ion-icon>
          </ion-button>
        }
      </section>
    }
  `,
  styles: `
    // RT_29: surface et texte toujours en couple ; RT_30: échelle à 5 crans.
    .invite {
      display: flex;
      align-items: flex-start;
      gap: 4px;
      padding: 10px 12px;
      color: var(--app-text);
      font-size: var(--app-font-sm);
    }

    .banner {
      margin: 12px;
      border-radius: var(--app-radius-md);
      background: var(--app-surface-raised);
      border: 1px solid var(--app-border-subtle);
    }

    .body {
      flex: 1;

      p {
        margin: 0 0 8px;
      }
    }

    .warning {
      color: var(--app-text-secondary);
    }

    .inline-icon {
      vertical-align: -3px;
      font-size: var(--app-font-md);
    }

    // RT_31: cibles tactiles d'au moins 44 px.
    ion-button {
      min-height: var(--app-touch-min);
    }

    .dismiss {
      min-width: var(--app-touch-min);
      margin: -8px -8px 0 0;
      --color: var(--app-text-secondary);
    }
  `,
})
export class InstallInviteComponent {
  protected readonly install = inject(InstallService);

  readonly variant = input<'banner' | 'block'>('banner');

  protected promptInstall(): void {
    void this.install.promptInstall();
  }
}
